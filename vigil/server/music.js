import { authenticatedAccount } from "./auth.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export async function handleWeeklySong(request, env) {
	const headers = { "cache-control": "private, no-store" };
	const json = (data, status = 200) => Response.json(data, { status, headers });
	if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Open your Vigil account to generate a song." }, 403);
	const account = await authenticatedAccount(request, env);
	if (!account) return json({ error: "Sign in to continue." }, 401);
	if (account.subscription_status !== "active" || !(Number(account.subscription_period_end) > Date.now())) {
		return json({ error: "An active Vigil Plus subscription is required." }, 403);
	}

	const now = Date.now();
	const { window_started_at: issuedAt } = await env.DB.prepare(
		`INSERT INTO auth_attempts (attempt_key, window_started_at, attempts) VALUES (?, ?, 1)
		 ON CONFLICT(attempt_key) DO UPDATE SET window_started_at =
		 CASE WHEN auth_attempts.window_started_at <= ? THEN excluded.window_started_at ELSE auth_attempts.window_started_at END
		 RETURNING window_started_at`
	).bind(`weekly-song:${account.id}`, now, now - WEEK).first();
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${account.id}:${issuedAt}`));
	return json({ seed: new DataView(bytes).getUint32(0), nextSongAt: issuedAt + WEEK });
}
