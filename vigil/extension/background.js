const api = globalThis.browser || globalThis.chrome;

const SESSION_ALARM = "vigil-session-end";
const OVERRIDE_ALARM_PREFIX = "vigil-override-";
const MAX_DOMAINS = 100;

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function domainPattern(domain) {
	return "*://*." + domain + "/*";
}

function domainRegex(domain) {
	return "^https?://(?:[^/?#]+\\.)*" + escapeRegex(domain) + "(?::[0-9]+)?(?:[/?#].*)?$";
}

function normalizeDomain(value) {
	const source = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
	if (!source || /[/?#@]/.test(source) || source.includes(":")) {
		throw new Error("Enter a site domain only, such as youtube.com.");
	}
	let hostname;
	try {
		hostname = new URL("https://" + source).hostname;
	} catch {
		throw new Error("That site domain does not look valid.");
	}
	if (hostname !== source || hostname.split(".").length < 2 || hostname.length > 253) {
		throw new Error("Enter a root domain, such as youtube.com.");
	}
	return hostname;
}

async function getData() {
	const data = await api.storage.local.get({
		domains: [],
		session: null,
		stats: { sessions: 0, pauses: 0, overrides: 0 }
	});
	return {
		domains: Array.isArray(data.domains) ? data.domains : [],
		session: data.session || null,
		stats: data.stats || { sessions: 0, pauses: 0, overrides: 0 }
	};
}

async function syncBlockingRules() {
	const data = await getData();
	const active = data.session && data.session.endsAt > Date.now();
	const rules = active ? data.domains.map((domain, index) => ({
		id: index + 1,
		priority: 1,
		action: {
			type: "redirect",
			redirect: { regexSubstitution: api.runtime.getURL("pause.html") + "#\\0" }
		},
		condition: {
			regexFilter: domainRegex(domain),
			resourceTypes: ["main_frame"]
		}
	})) : [];
	const current = await api.declarativeNetRequest.getDynamicRules();
	await api.declarativeNetRequest.updateDynamicRules({
		removeRuleIds: current.map(rule => rule.id),
		addRules: rules
	});
}

async function finishSession() {
	await api.storage.local.set({ session: null });
	await api.alarms.clear(SESSION_ALARM);
	await syncBlockingRules();
}

async function expireSessionIfNeeded() {
	const data = await getData();
	if (data.session && data.session.endsAt <= Date.now()) {
		await finishSession();
		return null;
	}
	return data.session;
}

async function getState() {
	const session = await expireSessionIfNeeded();
	const data = await getData();
	return { domains: data.domains, session, stats: data.stats };
}

async function addDomain(value) {
	const domain = normalizeDomain(value);
	const pattern = domainPattern(domain);
	const permission = await api.permissions.contains({ origins: [pattern] });
	if (!permission) throw new Error("Allow Vigil to access this site, then add it again.");
	const data = await getData();
	if (data.domains.includes(domain)) return getState();
	if (data.domains.length >= MAX_DOMAINS) throw new Error("You can add up to 100 sites.");
	const domains = [...data.domains, domain].sort();
	await api.storage.local.set({ domains });
	await syncBlockingRules();
	return getState();
}

async function removeDomain(value) {
	const domain = normalizeDomain(value);
	const data = await getData();
	const domains = data.domains.filter(item => item !== domain);
	await api.storage.local.set({ domains });
	await syncBlockingRules();
	const stillCovered = domains.some(item => item === domain || item.endsWith("." + domain) || domain.endsWith("." + item));
	if (!stillCovered) {
		try {
			await api.permissions.remove({ origins: [domainPattern(domain)] });
		} catch {
			// A permission may already have been removed in browser settings.
		}
	}
	return getState();
}

async function clearLocalData() {
	const data = await getData();
	await api.storage.local.clear();
	const alarms = await api.alarms.getAll();
	for (const alarm of alarms) {
		if (alarm.name === SESSION_ALARM || alarm.name.startsWith(OVERRIDE_ALARM_PREFIX)) {
			await api.alarms.clear(alarm.name);
		}
	}
	await syncBlockingRules();
	const sessionRules = await api.declarativeNetRequest.getSessionRules();
	const ids = sessionRules.filter(rule => rule.condition && Array.isArray(rule.condition.tabIds)).map(rule => rule.id);
	if (ids.length) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
	if (data.domains.length) {
		try {
			await api.permissions.remove({ origins: data.domains.map(domainPattern) });
		} catch {
			// Browser settings may have already changed these optional permissions.
		}
	}
	return getState();
}

async function startSession(minutes, taskLabel) {
	const data = await getData();
	if (!data.domains.length) throw new Error("Add at least one site before starting a focus session.");
	const duration = Math.max(5, Math.min(180, Number(minutes) || 25));
	const now = Date.now();
	const session = {
		startedAt: now,
		endsAt: now + duration * 60 * 1000,
		durationMinutes: duration,
		taskLabel: String(taskLabel || "").trim().slice(0, 80)
	};
	const stats = { ...data.stats, sessions: Number(data.stats.sessions || 0) + 1 };
	await api.storage.local.set({ session, stats });
	await api.alarms.create(SESSION_ALARM, { when: session.endsAt });
	await syncBlockingRules();
	return getState();
}

async function clearOverrideForTab(tabId) {
	const rules = await api.declarativeNetRequest.getSessionRules();
	const ids = rules.filter(rule => rule.condition && Array.isArray(rule.condition.tabIds) && rule.condition.tabIds.includes(tabId)).map(rule => rule.id);
	if (ids.length) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
	await api.alarms.clear(OVERRIDE_ALARM_PREFIX + tabId);
}

async function allowTargetForTab(target, tabId) {
	if (!Number.isInteger(tabId) || tabId < 0) throw new Error("Could not identify this tab.");
	const session = await expireSessionIfNeeded();
	if (!session) throw new Error("The focus session has ended.");
	let targetUrl;
	try {
		targetUrl = new URL(target);
	} catch {
		throw new Error("The return address is not valid.");
	}
	if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") throw new Error("Vigil can only continue to regular web sites.");
	const data = await getData();
	const domain = data.domains.find(item => targetUrl.hostname === item || targetUrl.hostname.endsWith("." + item));
	if (!domain) throw new Error("That site is not in your Vigil list.");
	const existing = await api.declarativeNetRequest.getSessionRules();
	const id = existing.reduce((next, rule) => Math.max(next, rule.id + 1), 100000);
	await clearOverrideForTab(tabId);
	await api.declarativeNetRequest.updateSessionRules({
		addRules: [{
			id,
			priority: 100,
			action: { type: "allow" },
			condition: { regexFilter: domainRegex(domain), resourceTypes: ["main_frame"], tabIds: [tabId] }
		}]
	});
	const stats = { ...data.stats, overrides: Number(data.stats.overrides || 0) + 1 };
	await api.storage.local.set({ stats });
	await api.alarms.create(OVERRIDE_ALARM_PREFIX + tabId, { when: Date.now() + 5 * 60 * 1000 });
	await api.tabs.update(tabId, { url: targetUrl.href });
	return { ok: true };
}

async function handleMessage(message, sender) {
	switch (message && message.type) {
		case "get-state":
			return getState();
		case "add-domain":
			return addDomain(message.domain);
		case "remove-domain":
			return removeDomain(message.domain);
		case "clear-data":
			return clearLocalData();
		case "start-session":
			return startSession(message.minutes, message.taskLabel);
		case "end-session":
			await finishSession();
			return getState();
		case "pause-shown": {
			const data = await getData();
			const stats = { ...data.stats, pauses: Number(data.stats.pauses || 0) + 1 };
			await api.storage.local.set({ stats });
			return { ok: true };
		}
		case "continue-site":
			return allowTargetForTab(message.target, sender && sender.tab ? sender.tab.id : -1);
		case "close-pause-tab": {
			const tabId = sender && sender.tab ? sender.tab.id : -1;
			if (!Number.isInteger(tabId) || tabId < 0) throw new Error("Could not identify this tab.");
			await api.tabs.remove(tabId);
			return { ok: true };
		}
		default:
			throw new Error("Unknown Vigil action.");
	}
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
	handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ error: error.message || "Vigil could not complete that action." }));
	return true;
});

api.alarms.onAlarm.addListener(alarm => {
	if (alarm.name === SESSION_ALARM) {
		finishSession().catch(() => {});
		return;
	}
	if (alarm.name.startsWith(OVERRIDE_ALARM_PREFIX)) {
		const tabId = Number(alarm.name.slice(OVERRIDE_ALARM_PREFIX.length));
		clearOverrideForTab(tabId).catch(() => {});
	}
});

async function reconcile() {
	const session = await expireSessionIfNeeded();
	if (session) await api.alarms.create(SESSION_ALARM, { when: session.endsAt });
	await syncBlockingRules();
}

api.runtime.onInstalled.addListener(() => { reconcile().catch(() => {}); });
api.runtime.onStartup.addListener(() => {
	api.declarativeNetRequest.getSessionRules().then(rules => {
		const ids = rules.filter(rule => rule.condition && Array.isArray(rule.condition.tabIds)).map(rule => rule.id);
		return ids.length ? api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }) : undefined;
	}).then(reconcile).catch(() => {});
});
