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

async function installationId() {
	let { installationId } = await api.storage.local.get("installationId");
	if (!installationId) {
		installationId = crypto.randomUUID();
		await api.storage.local.set({ installationId });
	}
	return installationId;
}
function released(session, domain, releases) {
	return (releases || []).some(release => release.domain === domain && release.sessionIds.includes(session.id));
}
async function syncUnlocks() {
	const id = await installationId();
	const { unlockOrders = [] } = await api.storage.local.get("unlockOrders");
	for (const orderId of unlockOrders) {
		const response = await serviceRequest("/api/extension/unlock/confirm", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({installation: id, orderId})});
		const result = await response.json();
		if (result.status !== "pending" || result.expiresAt <= Date.now()) {
			const latest = await api.storage.local.get({unlockOrders: []});
			await api.storage.local.set({unlockOrders: latest.unlockOrders.filter(value => value !== orderId)});
		}
	}
	const response = await serviceRequest("/api/extension/unlock/releases?installation=" + encodeURIComponent(id));
	const { releases = [] } = await response.json();
	await api.storage.local.set({ unlockReleases: releases });
}
async function unlockAction(path, body) {
	const response = await serviceRequest("/api/extension/unlock/" + path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({installation: await installationId(), ...body})});
	return response.json();
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
		await api.storage.local.set({ accountStatus: { username: accountStatus?.username || "", online: false, plan: "free", error: error.message || "Connect to the internet to use Vigil." } });
		await clearOverrides();
	}
	try { await syncUnlocks(); } catch { /* Keep existing blocking if payment checks are unavailable. */ }
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

function domainPatterns(domain) {
	return ["http://*." + domain + "/*", "https://*." + domain + "/*"];
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
	const data = await api.storage.local.get({ domains: [], session: null, stats: { sessions: 0, pauses: 0, overrides: 0 }, accountStatus: {}, triggers: {}, sessions: null, unlockReleases: [] });
	const domains = Array.isArray(data.domains) ? data.domains : [];
	const account = data.accountStatus;
	const online = account.online && Date.now() - account.verifiedAt < ONLINE_WINDOW_MS;
	const plus = online && account.plan === "plus" && Number(account.paidUntil) > Date.now();
	const activeDomains = plus ? domains : rankedSites(domains, data.triggers).slice(0, 5);
	const sessions = (Array.isArray(data.sessions) ? data.sessions : data.session ? [{ ...data.session, id: "legacy", domains: [...domains] }] : []).filter(session => session.endsAt > Date.now());
	return { domains, activeDomains, sessions, releases: data.unlockReleases, session: sessions[0] || null, stats: data.stats, account, online, plus };
}

async function syncBlockingRules() {
	const data = await getData();
	const active = data.online && data.session && data.session.endsAt > Date.now();
	const blockedDomains = data.activeDomains.filter(domain => data.sessions.some(session => session.domains.includes(domain) && !released(session, domain, data.releases)));
	const permitted = active ? await Promise.all(blockedDomains.map(async domain => ({
		domain, allowed: await api.permissions.contains({ origins: domainPatterns(domain) })
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

async function scheduleSessions() {
	const { sessions } = await getData();
	await api.alarms.clear(SESSION_ALARM);
	if (sessions.length) await api.alarms.create(SESSION_ALARM, { when: Math.min(...sessions.map(session => session.endsAt)) });
}

async function expireSessionIfNeeded() {
	const data = await getData();
	const stored = await api.storage.local.get(["sessions", "session"]);
	if (stored.session || JSON.stringify(stored.sessions || []) !== JSON.stringify(data.sessions)) {
		await api.storage.local.set({ sessions: data.sessions, session: null });
	}
	await scheduleSessions();
	await syncBlockingRules();
	return data.session;
}

async function assertUnlocked(domain) {
	const { sessions } = await getData();
	if (sessions.some(session => !domain || session.domains.includes(domain))) {
		throw new Error("This focus commitment stays locked until its timer ends.");
	}
}

async function getState(target = "") {
	await expireSessionIfNeeded();
	const data = await getData();
	let hostname;
	try { hostname = new URL(target).hostname; } catch {}
	const matching = hostname ? data.sessions.filter(session => session.domains.some(domain => (hostname === domain || hostname.endsWith("." + domain)) && !released(session, domain, data.releases))) : data.sessions;
	const session = [...matching].sort((a, b) => b.endsAt - a.endsAt)[0] || null;
	const { addError = "" } = await api.storage.local.get("addError");
	return { domains: data.domains, activeDomains: data.online ? data.activeDomains : [], sessions: data.sessions, session, stats: data.stats, online: Boolean(data.online), plan: data.plus ? "plus" : "free", username: data.account.username || "", connectionError: data.account.error || "", music: Boolean(data.account.music), addError };
}

async function completePendingSites() {
	const { pendingSites = {} } = await api.storage.local.get("pendingSites");
	for (const [domain, created] of Object.entries(pendingSites)) {
		if (Date.now() - created < 300000 && !(await api.permissions.contains({ origins: domainPatterns(domain) }))) continue;
		try {
			if (Date.now() - created < 300000) await addDomain(domain);
			await api.storage.local.set({ addError: "" });
		} catch (error) { await api.storage.local.set({ addError: error.message }); }
		delete pendingSites[domain];
	}
	await api.storage.local.set({ pendingSites });
}

async function addDomain(value) {
	await requireOnline();
	const domain = normalizeDomain(value);
	const patterns = domainPatterns(domain);
	const permission = await api.permissions.contains({ origins: patterns });
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
	await assertUnlocked(domain);
	const data = await getData();
	const domains = data.domains.filter(item => item !== domain);
	await api.storage.local.set({ domains });
	await syncBlockingRules();
	const stillCovered = domains.some(item => item === domain || item.endsWith("." + domain) || domain.endsWith("." + item));
	if (!stillCovered) {
		try {
			await api.permissions.remove({ origins: domainPatterns(domain) });
		} catch {
			// A permission may already have been removed in browser settings.
		}
	}
	return getState();
}

async function clearLocalData() {
	await assertUnlocked();
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
			await api.permissions.remove({ origins: data.domains.flatMap(domainPatterns) });
		} catch {
			// Browser settings may have already changed these optional permissions.
		}
	}
	return getState();
}

async function startSession(minutes, taskLabel, selectedDomains) {
	const data = await requireOnline();
	if (!data.domains.length) throw new Error("Add at least one site before starting a focus session.");
	if (data.sessions.length >= (data.plus ? 5 : 1)) throw new Error(data.plus ? "Plus allows five concurrent sessions." : "Free allows one active session. Plus allows five.");
	const duration = Number(minutes);
	if (!Number.isFinite(duration) || duration < 1 || duration > 525600) throw new Error("Choose a duration between one minute and 365 days.");
	if (selectedDomains !== undefined && !Array.isArray(selectedDomains)) throw new Error("Choose a valid site list.");
	const domains = [...new Set(selectedDomains === undefined ? data.activeDomains : selectedDomains)];
	if (!domains.length || domains.some(domain => !data.activeDomains.includes(domain))) throw new Error("Select at least one active saved site for this session.");
	const now = Date.now();
	const session = {
		id: crypto.randomUUID(),
		domains,
		startedAt: now,
		endsAt: now + duration * 60 * 1000,
		durationMinutes: duration,
		taskLabel: String(taskLabel || "").trim().slice(0, 80)
	};
	const stats = { ...data.stats, sessions: Number(data.stats.sessions || 0) + 1 };
	await api.storage.local.set({ sessions: [...data.sessions, session], session: null, stats });
	await scheduleSessions();
	await syncBlockingRules();
	return getState();
}

async function clearOverrideForTab(tabId) {
	const rules = await api.declarativeNetRequest.getSessionRules();
	const ids = rules.filter(rule => rule.condition && Array.isArray(rule.condition.tabIds) && rule.condition.tabIds.includes(tabId)).map(rule => rule.id);
	if (ids.length) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
	await api.alarms.clear(OVERRIDE_ALARM_PREFIX + tabId);
}

async function handleMessage(message, sender) {
	const popup = sender.url === api.runtime.getURL("popup.html");
	if (["login", "logout"].includes(message?.type) && !popup) throw new Error("Open Vigil to sign in.");
	if (["login", "logout"].includes(message?.type)) await assertUnlocked();
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
		await api.storage.local.set({ accountStatus: { online: false, error: "Connect to the internet to use Vigil." } });
		await clearOverrides();
		await syncBlockingRules();
		return { ok: true };
	}
	if (message?.type === "get-music") {
		const data = await requireOnline();
		if (!(await getState(message.target)).session) throw new Error("Your focus session ended.");
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
			return getState(message.target);
		case "prepare-site": {
			if (!popup) throw new Error("Open Vigil to add a site.");
			const domain = normalizeDomain(message.domain);
			const { pendingSites = {} } = await api.storage.local.get("pendingSites");
			pendingSites[domain] = Date.now();
			await api.storage.local.set({ pendingSites, addError: "" });
			return { ok: true };
		}
		case "cancel-site": {
			const { pendingSites = {} } = await api.storage.local.get("pendingSites");
			delete pendingSites[message.domain];
			await api.storage.local.set({ pendingSites });
			return { ok: true };
		}
		case "complete-sites":
			await completePendingSites();
			return getState();
		case "add-domain":
			return addDomain(message.domain);
		case "remove-domain":
			return removeDomain(message.domain);
		case "clear-data":
			return clearLocalData();
		case "start-session":
			return startSession(message.minutes, message.taskLabel, message.domains);
		case "end-session":
			await assertUnlocked();
			return getState();
		case "unlock-checkout": {
			const hostname = new URL(message.target).hostname;
			const data = await requireOnline();
			const domain = data.activeDomains.find(domain => hostname === domain || hostname.endsWith("." + domain));
			if (!domain) throw new Error("That site is not blocked.");
			const result = await unlockAction("checkout", {domain});
			const { unlockOrders = [] } = await api.storage.local.get("unlockOrders");
			await api.storage.local.set({unlockOrders: [...new Set([...unlockOrders, result.orderId])]});
			await api.tabs.create({url: result.url});
			return {ok: true};
		}
		case "pause-shown": {
			const data = await requireOnline();
			let hostname;
			try { hostname = new URL(message.target).hostname; } catch { return {ok: false}; }
			const domain = data.activeDomains.find(domain => hostname === domain || hostname.endsWith("." + domain));
			const sessions = domain ? data.sessions.filter(session => session.domains.includes(domain) && !released(session, domain, data.releases)) : [];
			if (!sessions.length) return {ok: false};
			const attemptId = sender.documentId || message.attemptId;
			if (!attemptId) throw new Error("Could not identify this visit.");
			const offer = await unlockAction("attempt", {domain, attemptId, sessions: sessions.map(session => ({id: session.id, endsAt: session.endsAt}))});
			const marker = "pauseSeen:" + (sender.tab?.id || "") + ":" + domain;
			const seen = (await api.storage.session.get(marker))[marker];
			if (seen === attemptId) return offer;
			await api.storage.session.set({[marker]: attemptId});
			const {triggers = {}} = await api.storage.local.get("triggers");
			const now = Date.now();
			const day = Math.floor(now / 86400000) * 86400000;
			const entries = (triggers[domain] || []).filter(entry => entry.day >= now - HISTORY_MS);
			let entry = entries.find(entry => entry.day === day);
			if (!entry) { entry = {day, count: 0, last: now}; entries.push(entry); }
			entry.count++; entry.last = now; triggers[domain] = entries;
			await api.storage.local.set({triggers, stats: {...data.stats, pauses: Number(data.stats.pauses || 0) + 1}});
			return offer;
		}
		case "continue-site":
			throw new Error("Sites stay blocked until every matching focus session ends.");
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
		else if (alarm.name === SESSION_ALARM) await expireSessionIfNeeded();
		else if (alarm.name.startsWith(OVERRIDE_ALARM_PREFIX)) await clearOverrideForTab(Number(alarm.name.slice(OVERRIDE_ALARM_PREFIX.length)));
	}).catch(() => {});
});

async function reconcile() {
	await api.alarms.create(STATUS_ALARM, { periodInMinutes: 1 });
	await clearOverrides();
	await refreshOnline();
	await completePendingSites();
	const session = await expireSessionIfNeeded();
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

api.permissions.onAdded.addListener(() => { enqueue(completePendingSites).catch(() => {}); });
