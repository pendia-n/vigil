const api = globalThis.browser || globalThis.chrome;
const target = location.hash.length > 1 ? location.href.slice(location.href.indexOf("#") + 1) : "";
let sessionEndsAt = null;
let waitUntilSessionEnds = false;
let endNavigationPending = false;

function setTargetLabel() {
	try {
		const url = new URL(target);
		document.querySelector("#site").textContent = url.hostname;
	} catch {
		document.querySelector("#site").textContent = "this site";
	}
}

function renderTimer() {
	const remaining = sessionEndsAt ? Math.max(0, Math.ceil((sessionEndsAt - Date.now()) / 1000)) : 0;
	const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
	const seconds = String(remaining % 60).padStart(2, "0");
	document.querySelector("#timer").textContent = sessionEndsAt ? minutes + ":" + seconds : "Ended";
	if (!sessionEndsAt || remaining === 0) {
		document.querySelector("#focus-note").textContent = "Your focus session has ended. This site is available again.";
		document.querySelector("#continue").disabled = false;
		document.querySelector("#wait").disabled = true;
		if (waitUntilSessionEnds) openTargetAfterSession();
	}
}

function openTargetAfterSession() {
	if (endNavigationPending || !(target.startsWith("https://") || target.startsWith("http://"))) return;
	endNavigationPending = true;
	api.runtime.sendMessage({ type: "get-state" }).then(state => {
		if (!state || !state.session) {
			waitUntilSessionEnds = false;
			location.replace(target);
			return;
		}
		endNavigationPending = false;
		setTimeout(renderTimer, 500);
	}).catch(() => {
		endNavigationPending = false;
		document.querySelector("#error").textContent = "Vigil couldn’t confirm the session ended. Keep this page open or return to your task.";
	});
}

setTargetLabel();
api.runtime.sendMessage({ type: "pause-shown" }).catch(() => {});
api.runtime.sendMessage({ type: "get-state" }).then(state => {
	if (state && state.session) {
		sessionEndsAt = state.session.endsAt;
		if (state.session.taskLabel) document.querySelector("#focus-note").textContent = "You planned to work on: " + state.session.taskLabel;
	}
	renderTimer();
}).catch(() => renderTimer());
setInterval(renderTimer, 1000);

document.querySelector("#return").addEventListener("click", () => {
	if (history.length > 1) history.back();
	else api.runtime.sendMessage({ type: "close-pause-tab" }).catch(() => window.close());
});

document.querySelector("#wait").addEventListener("click", () => {
	if (!sessionEndsAt || sessionEndsAt <= Date.now()) return;
	waitUntilSessionEnds = true;
	document.querySelector("#wait").disabled = true;
	document.querySelector("#focus-note").textContent = "We’ll open this site when your focus session ends.";
});

document.querySelector("#continue").addEventListener("click", async event => {
	const button = event.currentTarget;
	button.disabled = true;
	document.querySelector("#error").textContent = "";
	try {
		const result = await api.runtime.sendMessage({ type: "continue-site", target });
		if (result && result.error) throw new Error(result.error);
	} catch (error) {
		document.querySelector("#error").textContent = error.message || "Could not continue to this site.";
		button.disabled = false;
	}
});
