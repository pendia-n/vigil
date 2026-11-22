const api = globalThis.browser || globalThis.chrome;

const SESSION_ALARM = "vigil-session-end";
const OVERRIDE_ALARM_PREFIX = "vigil-override-";
const SERVICE = "https://vigil.pendia-community.workers.dev";
const STATUS_ALARM = "vigil-account-check";
const ONLINE_WINDOW_MS = 75000;
const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

async function serviceRequest(path, options = {}) {
	const { accessToken } = await api.storage.local.get("accessToken");
	const response = await fetch(SERVICE + path, {
		...options,
		cache: "no-store",
		credentials: "omit",
		headers: { ...(accessToken ? { authorization: "Bearer " + accessToken } : {}), ...options.headers },
		signal: AbortSignal.timeout(12000)
	});
	if (!response.ok) {
		if (response.status === 401) await api.storage.local.remove("accessToken");
		const data = await response.json().catch(() => ({}));
		throw new Error(data.error || "Connect to the internet to use Vigil.");
	}
	return response;
}

async function refreshOnline() {
	const { accessToken } = await api.storage.local.get("accessToken");
	try {
		if (!accessToken) throw new Error("Sign in to use Vigil.");
		const response = await serviceRequest("/api/extension/status");
		const status = await response.json();
		await api.storage.local.set({ accountStatus: { ...status, online: true, verifiedAt: Date.now(), error: "" } });
	} catch (error) {
		const { accountStatus } = await api.storage.local.get("accountStatus");
		await api.storage.local.set({ accountStatus: { username: accountStatus?.username || "", online: false, plan: "free", error: error.message || "Connect to the internet to use Vigil." }, session: null });
		await api.alarms.clear(SESSION_ALARM);
		await clearOverrides();
	}
	await syncBlockingRules();
}

async function clearOverrides() {
	const rules = await api.declarativeNetRequest.getSessionRules();
	if (rules.length) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
}

async function requireOnline() {
	await refreshOnline();
	const data = await getData();
	if (!data.online) throw new Error(data.account.error || "Sign in and connect to the internet to use Vigil.");
	return data;
}

function rankedSites(domains, triggers) {
	const cutoff = Date.now() - HISTORY_MS;
	const score = domain => {
		const recent = (triggers[domain] || []).filter(entry => entry.day >= cutoff);
		return { count: recent.reduce((total, entry) => total + entry.count, 0), last: Math.max(0, ...recent.map(entry => entry.last)) };
	};
	return [...domains].sort((a, b) => {
		const left = score(a), right = score(b);
		return right.count - left.count || right.last - left.last || domains.indexOf(a) - domains.indexOf(b);
	});
}

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
	const data = await api.storage.local.get({ domains: [], session: null, stats: { sessions: 0, pauses: 0, overrides: 0 }, accountStatus: {}, triggers: {} });
	const domains = Array.isArray(data.domains) ? data.domains : [];
	const account = data.accountStatus;
	const online = account.online && Date.now() - account.verifiedAt < ONLINE_WINDOW_MS;
	const plus = online && account.plan === "plus" && Number(account.paidUntil) > Date.now();
	const activeDomains = plus ? domains : rankedSites(domains, data.triggers).slice(0, 5);
	return { domains, activeDomains, session: data.session, stats: data.stats, account, online, plus };
}

async function syncBlockingRules() {
	const data = await getData();
	const active = data.online && data.session && data.session.endsAt > Date.now();
	const permitted = active ? await Promise.all(data.activeDomains.map(async domain => ({
		domain, allowed: await api.permissions.contains({ origins: [domainPattern(domain)] })
	}))) : [];
	const rules = permitted.filter(item => item.allowed).map(({ domain }, index) => ({
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
	}));
	const current = await api.declarativeNetRequest.getDynamicRules();
	await api.declarativeNetRequest.updateDynamicRules({
		removeRuleIds: current.map(rule => rule.id),
		addRules: rules
	});
}

async function finishSession() {
	await api.storage.local.set({ session: null });
	await api.alarms.clear(SESSION_ALARM);
	await clearOverrides();
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
	return { domains: data.domains, activeDomains: data.online ? data.activeDomains : [], session, stats: data.stats, online: Boolean(data.online), plan: data.plus ? "plus" : "free", username: data.account.username || "", connectionError: data.account.error || "", music: Boolean(data.account.music) };
}

async function addDomain(value) {
	await requireOnline();
	const domain = normalizeDomain(value);
	const pattern = domainPattern(domain);
	const permission = await api.permissions.contains({ origins: [pattern] });
	if (!permission) throw new Error("Allow Vigil to access this site, then add it again.");
	const data = await getData();
	if (data.domains.includes(domain)) return getState();
	if (!data.plus && data.domains.length >= 5) throw new Error("Free includes five sites. Remove a saved site or subscribe to Plus.");
	const ruleLimit = Math.min(api.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES || 1000, api.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES || 5000);
	if (data.domains.length >= ruleLimit) throw new Error("You have reached this browser’s blocking rule limit.");
	const domains = [...data.domains, domain];
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
	const data = await requireOnline();
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
	await requireOnline();
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
	const domain = data.activeDomains.find(item => targetUrl.hostname === item || targetUrl.hostname.endsWith("." + item));
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
	const popup = sender.url === api.runtime.getURL("popup.html");
	if (["login", "logout"].includes(message?.type) && !popup) throw new Error("Open Vigil to sign in.");
	if (message?.type === "login") {
		const response = await serviceRequest("/api/extension/login", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: message.username, password: message.password })
		});
		const { token } = await response.json();
		await api.storage.local.set({ accessToken: token });
		await refreshOnline();
		return getState();
	}
	if (message?.type === "logout") {
		try { await serviceRequest("/api/extension/logout", { method: "POST" }); } catch {}
		await api.storage.local.remove("accessToken");
		await refreshOnline();
		return getState();
	}
	if (message?.type === "offline") {
		await api.storage.local.set({ accountStatus: { online: false, error: "Connect to the internet to use Vigil." }, session: null });
		await clearOverrides();
		await syncBlockingRules();
		return { ok: true };
	}
	if (message?.type === "get-music") {
		const data = await requireOnline();
		if (!data.session || data.session.endsAt <= Date.now()) throw new Error("Your focus session ended.");
		const response = await serviceRequest("/api/extension/music");
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.length > 8 * 1024 * 1024) throw new Error("This music file is too large.");
		let binary = "";
		for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
		return { audio: btoa(binary), title: decodeURIComponent(response.headers.get("x-vigil-track") || "Vigil music"), plan: response.headers.get("x-vigil-plan") };
	}
	switch (message && message.type) {
		case "get-state":
			await refreshOnline();
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
			const data = await requireOnline();
			let hostname;
			try { hostname = new URL(message.target).hostname; } catch { return { ok: false }; }
			if (!data.session || data.session.endsAt <= Date.now()) return { ok: false };
			const domain = data.activeDomains.find(item => hostname === item || hostname.endsWith("." + item));
			if (!domain) return { ok: false };
			const tabId = sender.tab?.id;
			const marker = "pauseSeen:" + tabId;
			const seen = (await api.storage.session.get(marker))[marker];
			if (seen && seen.domain === domain && Date.now() - seen.at < 10000) return { ok: true };
			await api.storage.session.set({ [marker]: { domain, at: Date.now() } });
			const { triggers = {} } = await api.storage.local.get("triggers");
			const now = Date.now();
			const day = Math.floor(now / 86400000) * 86400000;
			const entries = (triggers[domain] || []).filter(entry => entry.day >= now - HISTORY_MS);
			let entry = entries.find(entry => entry.day === day);
			if (!entry) { entry = { day, count: 0, last: now }; entries.push(entry); }
			entry.count++;
			entry.last = now;
			triggers[domain] = entries;
			const stats = { ...data.stats, pauses: Number(data.stats.pauses || 0) + 1 };
			await api.storage.local.set({ stats, triggers });
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

let operations = Promise.resolve();
function enqueue(action) {
	const result = operations.catch(() => {}).then(action);
	operations = result.catch(() => {});
	return result;
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (sender.id !== api.runtime.id) return false;
	enqueue(() => handleMessage(message, sender)).then(sendResponse).catch(error => sendResponse({ error: error.message || "Vigil could not complete that action." }));
	return true;
});

api.alarms.onAlarm.addListener(alarm => {
	enqueue(async () => {
		if (alarm.name === STATUS_ALARM) { await refreshOnline(); await expireSessionIfNeeded(); }
		else if (alarm.name === SESSION_ALARM) await finishSession();
		else if (alarm.name.startsWith(OVERRIDE_ALARM_PREFIX)) await clearOverrideForTab(Number(alarm.name.slice(OVERRIDE_ALARM_PREFIX.length)));
	}).catch(() => {});
});

async function reconcile() {
	await api.alarms.create(STATUS_ALARM, { periodInMinutes: 1 });
	await refreshOnline();
	const session = await expireSessionIfNeeded();
	if (session) await api.alarms.create(SESSION_ALARM, { when: session.endsAt });
	await syncBlockingRules();
}

api.runtime.onInstalled.addListener(() => { enqueue(reconcile).catch(() => {}); });
api.runtime.onStartup.addListener(() => {
	api.declarativeNetRequest.getSessionRules().then(rules => {
		const ids = rules.filter(rule => rule.condition && Array.isArray(rule.condition.tabIds)).map(rule => rule.id);
		return ids.length ? api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }) : undefined;
	}).then(() => enqueue(reconcile)).catch(() => {});
});

api.permissions.onRemoved.addListener(() => { enqueue(syncBlockingRules).catch(() => {}); });
