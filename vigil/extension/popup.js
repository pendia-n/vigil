const api = globalThis.browser || globalThis.chrome;
const $ = selector => document.querySelector(selector);
let selectedSites = new Set();
let knownSites = new Set();
let currentState = { domains: [], session: null, stats: { pauses: 0, overrides: 0 } };

function showMessage(text) {
	$("#message").textContent = text || "";
}

async function send(type, data = {}) {
	const result = await api.runtime.sendMessage({ type, ...data });
	if (result && result.error) throw new Error(result.error);
	return result;
}

function selectedMinutes() {
	return $("#duration").value === "custom" ? Number($("#duration-value").value) * Number($("#duration-unit").value) : Number($("#duration").value);
}
function formatTime(seconds) {
	const safe = Math.max(0, Math.ceil(seconds) || 0);
	const days = Math.floor(safe / 86400);
	const hours = Math.floor(safe / 3600) % 24;
	const minutes = Math.floor(safe / 60) % 60;
	const tail = String(minutes).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
	return days ? days + "d " + String(hours).padStart(2, "0") + ":" + tail : safe >= 3600 ? Math.floor(safe / 3600) + ":" + tail : tail;
}

function render() {
	const online = Boolean(currentState.online);
	$("#connection").textContent = online
		? currentState.username + " · " + (currentState.plan === "plus" ? "Plus" : "Free") + " · Connected"
		: currentState.connectionError || "Sign in and connect to use Vigil.";
	$("#login-form").hidden = online;
	$("#logout").hidden = !currentState.username;
	$("#domain").disabled = !online;
	$("#site-form button").disabled = !online;
	$("#plan-note").textContent = currentState.plan === "plus"
		? "Plus blocks all saved sites, within browser limits. Music is selected randomly."
		: "Free blocks five sites. After downgrade, the five most-triggered sites in the last 30 days stay active. Others stay saved.";
	const active = currentState.session && currentState.session.endsAt > Date.now();
	const left = active && currentState.sessions?.length >= (currentState.plan === "plus" ? 5 : 1) ? Math.ceil((currentState.session.endsAt - Date.now()) / 1000) : selectedMinutes() * 60;
	$("#timer").textContent = formatTime(left);
	$("#live-dot").classList.toggle("active", Boolean(active));
	$("#live-dot").setAttribute("aria-label", active ? "Session active" : "Session inactive");
	$("#session-state").textContent = active ? "FOCUS IS IN SESSION" : "READY WHEN YOU ARE";
	$("#task-copy").textContent = active
		? (currentState.session.taskLabel || "Your chosen sites are paused for this session.")
		: "Choose a few sites, then start a session.";
	const sessions = currentState.sessions || [];
	const atLimit = sessions.length >= (currentState.plan === "plus" ? 5 : 1);
	$("#session-actions").classList.toggle("hidden", atLimit);
	$("#locked-note").hidden = !active;
	$("#locked-note").textContent = "Active commitments stay locked. Separate paid site unlocks are offered after repeated visits. " + (currentState.plan === "plus" ? sessions.length + " / 5 sessions active." : "Free allows one active session.");
	$("#logout").disabled = Boolean(active);
	$("#clear-data").disabled = Boolean(active);
	$("#active-sessions").replaceChildren();
	for (const session of sessions) {
		const row = document.createElement("p"); row.className = "permission-note";
		row.textContent = (session.taskLabel || "Focus") + " · " + formatTime((session.endsAt - Date.now()) / 1000) + " · " + session.domains.join(", ");
		$("#active-sessions").append(row);
	}
	$("#session-site-options").replaceChildren();
	for (const domain of currentState.activeDomains || []) {
		if (!knownSites.has(domain)) { selectedSites.add(domain); knownSites.add(domain); }
		const label = document.createElement("label");
		const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selectedSites.has(domain);
		checkbox.addEventListener("change", () => { if (checkbox.checked) selectedSites.add(domain); else selectedSites.delete(domain); render(); });
		label.append(checkbox, document.createTextNode(domain)); $("#session-site-options").append(label);
	}
	$("#start").disabled = !online || atLimit || !(currentState.activeDomains || []).some(domain => selectedSites.has(domain));
	$("#site-count").textContent = String(currentState.activeDomains?.length || 0) + " active / " + currentState.domains.length + " saved";
	$("#pause-count").textContent = String(currentState.stats.pauses || 0);
	const list = $("#sites");
	list.replaceChildren();
	for (const domain of currentState.domains) {
		const item = document.createElement("li");
		item.className = "site-item";
		const activeSite = currentState.activeDomains?.includes(domain);
		item.classList.toggle("inactive", !activeSite);
		const label = document.createElement("span");
		label.textContent = domain + (activeSite ? "" : " · inactive");
		const remove = document.createElement("button");
		remove.type = "button";
		remove.textContent = "×";
		remove.disabled = sessions.some(session => session.domains.includes(domain));
		remove.setAttribute("aria-label", "Remove " + domain);
		remove.addEventListener("click", async () => {
			try {
				currentState = await send("remove-domain", { domain });
				showMessage("");
				render();
			} catch (error) { showMessage(error.message); }
		});
		item.append(label, remove);
		list.append(item);
	}
	$("#empty-sites").classList.toggle("hidden", currentState.domains.length > 0);
}

async function refresh() {
	try {
		currentState = await send("complete-sites");
		currentState = await send("get-state");
		if (currentState.addError) showMessage(currentState.addError);
		render();
	} catch (error) {
		showMessage(error.message || "Vigil could not load your local settings.");
	}
}

$("#site-form").addEventListener("submit", async event => {
	event.preventDefault();
	const field = $("#domain");
	const input = field.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
	const hostname = input.split(/[/?#]/)[0];
	if (!hostname || hostname.includes(":")) {
		showMessage("Enter a site domain, like youtube.com.");
		return;
	}
	const patterns = ["http://*." + hostname + "/*", "https://*." + hostname + "/*"];
	try {
		// Start both operations in the click handler. The background owns completion if this popup closes.
		const prepared = send("prepare-site", { domain: hostname });
		const permission = api.permissions.request({ origins: patterns });
		await prepared;
		const granted = await permission;
		if (!granted) {
			await send("cancel-site", { domain: hostname });
			showMessage("Site access was not granted.");
			return;
		}
		currentState = await send("complete-sites");
		if (currentState.addError) throw new Error(currentState.addError);
		field.value = "";
		showMessage("");
		render();
	} catch (error) {
		showMessage(error.message || "Could not add that site.");
	}
});

$("#start").addEventListener("click", async () => {
	try {
		const minutes = selectedMinutes();
		if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) throw new Error("Choose one minute to 365 days.");
		if (!window.confirm("Block the selected sites for " + formatTime(minutes * 60) + "? A separate paid site unlock becomes available after repeated visits.")) return;
		currentState = await send("start-session", {
			minutes: selectedMinutes(),
			domains: (currentState.activeDomains || []).filter(domain => selectedSites.has(domain)),
			taskLabel: $("#task").value
		});
		showMessage("");
		render();
	} catch (error) { showMessage(error.message); }
});

$("#clear-data").addEventListener("click", async () => {
	if (!window.confirm("Clear your site list, focus session, and local counts from this browser?")) return;
	try {
		currentState = await send("clear-data");
		$("#task").value = "";
		showMessage("Your local Vigil data has been cleared.");
		render();
	} catch (error) { showMessage(error.message); }
});

const sound = $("#sound");
api.storage.local.get("focusSound").then(settings => {
	sound.checked = Boolean(settings.focusSound);
}).catch(error => showMessage(error.message));

sound.addEventListener("change", () => {
	api.storage.local.set({ focusSound: sound.checked }).catch(error => showMessage(error.message));
});
api.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes.focusSound) sound.checked = Boolean(changes.focusSound.newValue);
	if (changes.domains || changes.sessions || changes.addError) {
		send("get-state").then(state => { currentState = state; render(); if (state.addError) showMessage(state.addError); }).catch(error => showMessage(error.message));
	}
});

$("#login-form").addEventListener("submit", async event => {
	event.preventDefault();
	$("#login").disabled = true;
	try {
		currentState = await send("login", { username: $("#username").value.trim(), password: $("#password").value });
		$("#password").value = "";
		render();
		showMessage(currentState.connectionError || "Connected.");
	} catch (error) { showMessage(error.message); }
	finally { $("#password").value = ""; $("#login").disabled = false; }
});
$("#logout").addEventListener("click", async () => {
	try { currentState = await send("logout"); render(); }
	catch (error) { showMessage(error.message); }
});
window.addEventListener("offline", () => {
	send("offline").finally(refresh);
});
window.addEventListener("online", refresh);

for (const selector of ["#duration", "#duration-value", "#duration-unit"]) {
	$(selector).addEventListener("change", () => { $("#custom-duration").hidden = $("#duration").value !== "custom"; render(); });
	$(selector).addEventListener("input", render);
}
refresh();
setInterval(refresh, 5000);
setInterval(() => {
	if (currentState.session && currentState.sessions?.length >= (currentState.plan === "plus" ? 5 : 1)) $("#timer").textContent = formatTime((currentState.session.endsAt - Date.now()) / 1000);
	if (currentState.sessions?.some(session => session.endsAt <= Date.now())) refresh();
}, 1000);
