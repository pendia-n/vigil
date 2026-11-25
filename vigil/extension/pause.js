const api = globalThis.browser || globalThis.chrome;
const target = location.hash.length > 1 ? location.href.slice(location.href.indexOf("#") + 1) : "";
let sessionEndsAt = null;
let waitUntilSessionEnds = false;
let endNavigationPending = false;
let focusAudio;
let audioUrl;
let loadedPlan;
const soundButton = document.querySelector("#focus-sound");

function stopSound() {
	focusAudio?.pause();
	if (audioUrl) URL.revokeObjectURL(audioUrl);
	audioUrl = null;
	focusAudio = null;
	soundButton.hidden = true;
}

function playSound() {
	focusAudio.play().catch(() => { soundButton.textContent = "Play focus sound"; });
}

async function setupSound() {
	const { focusSound } = await api.storage.local.get("focusSound");
	if (!focusSound || sessionEndsAt <= Date.now()) return;
	stopSound();
	const result = await api.runtime.sendMessage({ type: "get-music", target });
	if (result.error) throw new Error(result.error);
	const latest = await api.storage.local.get(["focusSound", "accountStatus", "session"]);
	if (!latest.focusSound || !latest.accountStatus?.online || !latest.session || sessionEndsAt <= Date.now()) return;
	const bytes = Uint8Array.from(atob(result.audio), char => char.charCodeAt(0));
	audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
	focusAudio = new Audio(audioUrl);
	loadedPlan = result.plan;
	focusAudio.loop = result.plan === "plus";
	focusAudio.volume = 0.4;
	focusAudio.addEventListener("play", () => { soundButton.textContent = "Stop focus sound"; });
	for (const event of ["pause", "ended"]) {
		focusAudio.addEventListener(event, () => { soundButton.textContent = "Play focus sound"; });
	}
	soundButton.hidden = false;
	document.querySelector("#music-title").textContent = result.title;
	if (sessionEndsAt > Date.now()) playSound();
}

soundButton.addEventListener("click", () => {
	if (!focusAudio || sessionEndsAt <= Date.now()) return;
	if (focusAudio.paused) playSound();
	else focusAudio.pause();
});
window.addEventListener("pagehide", stopSound);
window.addEventListener("offline", () => {
	stopSound();
	api.runtime.sendMessage({ type: "offline" }).catch(() => {});
});
api.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && (changes.session && !changes.session.newValue || changes.focusSound && !changes.focusSound.newValue)) {
		focusAudio?.pause();
		soundButton.hidden = true;
	}
	if (area === "local" && changes.accountStatus) {
		const status = changes.accountStatus.newValue;
		if (!status?.online) {
			stopSound();
			sessionEndsAt = null;
			document.querySelector("#error").textContent = status?.error || "Vigil disconnected.";
		} else if (focusAudio && loadedPlan !== status.plan) {
			setupSound().catch(error => { document.querySelector("#error").textContent = error.message; });
		}
	}
});

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
	const days = Math.floor(remaining / 86400);
	const minutes = (days ? days + "d " : "") + String(Math.floor(remaining / 3600) % 24).padStart(2, "0") + ":" + String(Math.floor(remaining / 60) % 60).padStart(2, "0");
	const seconds = String(remaining % 60).padStart(2, "0");
	document.querySelector("#timer").textContent = sessionEndsAt ? minutes + ":" + seconds : "Ended";
	if (!sessionEndsAt || remaining === 0) {
		focusAudio?.pause();
		soundButton.hidden = true;
		document.querySelector("#focus-note").textContent = "Your focus session has ended. This site is available again.";
		document.querySelector("#continue").disabled = false;
		document.querySelector("#continue").textContent = "Open this site";
		document.querySelector("#wait").disabled = true;
		if (waitUntilSessionEnds) openTargetAfterSession();
	}
}

function openTargetAfterSession() {
	if (endNavigationPending || !(target.startsWith("https://") || target.startsWith("http://"))) return;
	endNavigationPending = true;
	api.runtime.sendMessage({ type: "get-state", target }).then(state => {
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
api.runtime.sendMessage({ type: "pause-shown", target }).catch(() => {});
api.runtime.sendMessage({ type: "get-state", target }).then(state => {
	if (state && state.session) {
		sessionEndsAt = state.session.endsAt;
		if (state.session.taskLabel) document.querySelector("#focus-note").textContent = "You planned to work on: " + state.session.taskLabel;
		setupSound().catch(error => { document.querySelector("#error").textContent = error.message; });
	}
	renderTimer();
}).catch(() => renderTimer());
setInterval(renderTimer, 1000);
setInterval(() => {
	api.runtime.sendMessage({ type: "get-state", target }).then(state => {
		if (!state.online || !state.session) {
			stopSound();
			sessionEndsAt = null;
			document.querySelector("#error").textContent = state.connectionError || "Your focus session ended.";
		} else sessionEndsAt = state.session.endsAt;
	}).catch(stopSound);
}, 30000);

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
	if ((!sessionEndsAt || sessionEndsAt <= Date.now()) && /^https?:\/\//.test(target)) {
		location.replace(target);
		return;
	}
	// Access stays locked until all matching sessions end.
});
