import { authenticatedAccount, handleAuth } from "./auth.js";
import { reconcileSubscription } from "./billing.js";

const tracks = [
	{ key: "VIGIL_MODE_Cybernetic_Serenade.mp3", title: "Vigil Mode — Cybernetic Serenade" },
	{ key: "I_live_in_an_island_song.mp3", title: "I Live in an Island" },
	{ key: "cds_song.mp3", title: "CDS Song" }
];

function json(body, status = 200) {
	return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export async function handleExtension(request, env, pathname) {
	if (!env.DB || !env.JWT_SECRET) return json({ error: "Account service is unavailable." }, 503);
	if (pathname === "/api/extension/login" && request.method === "POST") {
		const response = await handleAuth(request, env, "/api/auth/login");
		const body = await response.json();
		if (!response.ok) return json(body, response.status);
		const token = response.headers.get("set-cookie")?.match(/^vigil_session=([^;]+)/)?.[1];
		if (!token) return json({ error: "Could not connect this extension." }, 500);
		return json({ token });
	}
	const bearer = request.headers.get("authorization");
	if (!bearer?.startsWith("Bearer ")) return json({ error: "Sign in to Vigil." }, 401);
	if (pathname === "/api/extension/logout" && request.method === "POST") {
		const headers = new Headers(request.headers);
		headers.set("cookie", "vigil_session=" + bearer.slice(7));
		return handleAuth(new Request(request, { headers }), env, "/api/auth/logout");
	}
	let account = await authenticatedAccount(request, env);
	if (!account) return json({ error: "Your connection expired. Sign in again." }, 401);
	if (account.stripe_customer_id && Date.now() - Number(account.billing_checked_at || 0) >= 60000) {
		try {
			await reconcileSubscription(env, account);
			account = await authenticatedAccount(request, env);
		} catch {
			return json({ error: "Could not verify your subscription. Try again shortly." }, 503);
		}
	}
	const plus = account.subscription_status === "active" && Number(account.subscription_period_end) > Date.now();
	if (pathname === "/api/extension/status" && request.method === "GET") {
		return json({ username: account.username, plan: plus ? "plus" : "free", paidUntil: plus ? account.subscription_period_end : null, checkedAt: Date.now(), music: Boolean(env.MUSIC) });
	}
	if (pathname === "/api/extension/music" && request.method === "GET") {
		if (!env.MUSIC) return json({ error: "Music is temporarily unavailable." }, 503);
		const track = plus ? tracks[crypto.getRandomValues(new Uint32Array(1))[0] % tracks.length] : tracks[0];
		const object = await env.MUSIC.get(track.key);
		if (!object) return json({ error: "This track is temporarily unavailable." }, 503);
		return new Response(object.body, { headers: {
			"content-type": "audio/mpeg", "cache-control": "private, no-store",
			"x-content-type-options": "nosniff", "x-vigil-track": encodeURIComponent(track.title),
			"content-length": String(object.size), "x-vigil-plan": plus ? "plus" : "free"
		} });
	}
	return json({ error: "Not found" }, 404);
}
