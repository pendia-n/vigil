const api = globalThis.browser || globalThis.chrome;
const $ = selector => document.querySelector(selector);
let currentState = { domains: [], session: null, stats: { pauses: 0, overrides: 0 } };

function showMessage(text) {
	$("#message").textContent = text || "";
}

async function send(type, data = {}) {
	const result = await api.runtime.sendMessage({ type, ...data });
	if (result && result.error) throw new Error(result.error);
	return result;
}

function formatTime(seconds) {
	const safe = Math.max(0, seconds);
	return String(Math.floor(safe / 60)).padStart(2, "0") + ":" + String(safe % 60).padStart(2, "0");
}

function render() {
	const active = currentState.session && currentState.session.endsAt > Date.now();
	const left = active ? Math.ceil((currentState.session.endsAt - Date.now()) / 1000) : 25 * 60;
	$("#timer").textContent = formatTime(left);
	$("#live-dot").classList.toggle("active", Boolean(active));
	$("#live-dot").setAttribute("aria-label", active ? "Session active" : "Session inactive");
	$("#session-state").textContent = active ? "FOCUS IS IN SESSION" : "READY WHEN YOU ARE";
	$("#task-copy").textContent = active
		? (currentState.session.taskLabel || "Your chosen sites are paused for this session.")
		: "Choose a few sites, then start a session.";
	$("#session-actions").classList.toggle("hidden", Boolean(active));
	$("#stop").classList.toggle("hidden", !active);
	$("#start").disabled = currentState.domains.length === 0;
	$("#site-count").textContent = String(currentState.domains.length);
	$("#pause-count").textContent = String(currentState.stats.pauses || 0);
	$("#override-count").textContent = String(currentState.stats.overrides || 0);
	const list = $("#sites");
	list.replaceChildren();
	for (const domain of currentState.domains) {
		const item = document.createElement("li");
		item.className = "site-item";
		const label = document.createElement("span");
		label.textContent = domain;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.textContent = "×";
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
		currentState = await send("get-state");
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
	const pattern = "*://*." + hostname + "/*";
	try {
		const granted = await api.permissions.request({ origins: [pattern] });
		if (!granted) {
			showMessage("Site access was not granted. You can add it later.");
			return;
		}
		currentState = await send("add-domain", { domain: hostname });
		field.value = "";
		showMessage("");
		render();
	} catch (error) {
		showMessage(error.message || "Could not add that site.");
	}
});

$("#start").addEventListener("click", async () => {
	try {
		currentState = await send("start-session", {
			minutes: Number($("#duration").value),
			taskLabel: $("#task").value
		});
		showMessage("");
		render();
	} catch (error) { showMessage(error.message); }
});

$("#stop").addEventListener("click", async () => {
	try {
		currentState = await send("end-session");
		showMessage("Session ended. Your sites are available again.");
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
const loopSong = $("#loop-song");
api.storage.local.get(["focusSound", "loopSong"]).then(settings => {
	sound.checked = Boolean(settings.focusSound);
	loopSong.checked = Boolean(settings.loopSong);
}).catch(error => showMessage(error.message));

sound.addEventListener("change", () => {
	api.storage.local.set({ focusSound: sound.checked }).catch(error => showMessage(error.message));
});
loopSong.addEventListener("change", () => {
	api.storage.local.set({ loopSong: loopSong.checked }).catch(error => showMessage(error.message));
});

$("#song-file").addEventListener("change", event => {
	const file = event.target.files[0];
	if (!file) return;
	event.target.value = "";
	if (!/\.(mp3|wav)$/i.test(file.name) || !file.size || file.size > 6 * 1024 * 1024) {
		showMessage("Choose an MP3 or WAV file under 6 MB.");
		return;
	}
	const type = /\.wav$/i.test(file.name) ? "audio/wav" : "audio/mpeg";
	const reader = new FileReader();
	reader.onerror = () => showMessage("Could not read this audio file.");
	reader.onload = async () => {
		try {
			await api.storage.local.set({ focusSong: "data:" + type + ";base64," + reader.result.split(",")[1], focusSound: true });
			sound.checked = true;
			showMessage("Your song is ready for the next pause.");
		} catch { showMessage("Could not save this song."); }
	};
	reader.readAsDataURL(file);
});
$("#remove-song").addEventListener("click", async () => {
	try {
		await api.storage.local.remove("focusSong");
		showMessage("Vigil will use the bundled sound.");
	} catch (error) { showMessage(error.message); }
});
api.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes.focusSound) sound.checked = Boolean(changes.focusSound.newValue);
	if (changes.loopSong) loopSong.checked = Boolean(changes.loopSong.newValue);
});

refresh();
setInterval(() => { if (currentState.session) render(); }, 1000);
