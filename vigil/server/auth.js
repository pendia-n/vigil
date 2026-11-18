const encoder = new TextEncoder();
const SESSION_COOKIE = "vigil_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const RESET_LIMIT_MS = 60 * 60 * 24 * 1000;
// Cloudflare Workers WebCrypto currently caps PBKDF2 at 100,000 iterations.
const PASSWORD_ITERATIONS = 100000;
const JWT_ISSUER = "vigil";
const JWT_AUDIENCE = "vigil";

function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...headers }
	});
}

function toBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJson(value) {
	return toBase64Url(encoder.encode(JSON.stringify(value)));
}

function fromBase64Url(value) {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
	return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function randomToken(size = 32) {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function signJwt(payload, secret) {
	const header = encodeJson({ alg: "HS256", typ: "JWT" });
	const body = encodeJson(payload);
	const unsigned = `${header}.${body}`;
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(unsigned)));
	return `${unsigned}.${toBase64Url(signature)}`;
}

async function verifyJwt(token, secret) {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
		const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
		if (header.alg !== "HS256" || header.typ !== "JWT" || payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
		const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
		const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
		if (!valid || typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
		return payload;
	} catch {
		return null;
	}
}

function randomRecoveryCode() {
	return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function digest(value) {
	return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function passwordHash(password, salt) {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
	return toBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left, right) {
	const a = encoder.encode(String(left));
	const b = encoder.encode(String(right));
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
	return diff === 0;
}

function cookieValue(request, name) {
	const prefix = name + "=";
	for (const part of (request.headers.get("cookie") || "").split(";")) {
		const value = part.trim();
		if (value.startsWith(prefix)) return value.slice(prefix.length);
	}
	return "";
}

function sessionCookie(token, maxAge = SESSION_SECONDS) {
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export async function authenticatedAccount(request, env) {
	if (!env.DB || !env.JWT_SECRET) return null;
	const token = cookieValue(request, SESSION_COOKIE);
	if (!token) return null;
	const claims = await verifyJwt(token, env.JWT_SECRET);
	if (!claims) return null;
	const tokenHash = await digest(token);
	const now = Date.now();
	const result = await env.DB.prepare(
		`SELECT a.id, a.username, a.subscription_status, a.subscription_period_end, a.stripe_customer_id, a.stripe_subscription_id
		 FROM sessions s JOIN accounts a ON a.id = s.account_id
		 WHERE s.token_hash = ? AND s.account_id = ? AND s.expires_at > ?`
	).bind(tokenHash, claims.sub, now).first();
	return result || null;
}

async function newSession(env, accountId) {
	const db = env.DB;
	const now = Date.now();
	const expiresAt = now + SESSION_SECONDS * 1000;
	const token = await signJwt({
		sub: accountId,
		jti: randomToken(32),
		iss: JWT_ISSUER,
		aud: JWT_AUDIENCE,
		iat: Math.floor(now / 1000),
		exp: Math.floor(expiresAt / 1000)
	}, env.JWT_SECRET);
	await db.prepare("INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
		.bind(await digest(token), accountId, expiresAt, now).run();
	return token;
}

async function rateLimit(db, key, maxAttempts, windowMs) {
	const now = Date.now();
	const cutoff = now - windowMs;
	const row = await db.prepare(
		`INSERT INTO auth_attempts (attempt_key, window_started_at, attempts) VALUES (?, ?, 1)
		 ON CONFLICT(attempt_key) DO UPDATE SET
		 attempts = CASE WHEN auth_attempts.window_started_at <= ? THEN 1 ELSE auth_attempts.attempts + 1 END,
		 window_started_at = CASE WHEN auth_attempts.window_started_at <= ? THEN ? ELSE auth_attempts.window_started_at END
		 RETURNING attempts, window_started_at`
	).bind(key, now, cutoff, cutoff, now).first();
	return row.attempts <= maxAttempts;
}

function validPassword(value) {
	return typeof value === "string" && value.length >= 12 && value.length <= 256;
}

function validUsername(value) {
	return typeof value === "string" && /^[a-zA-Z0-9_]{3,32}$/.test(value);
}

async function bodyJson(request) {
	try { return await request.json(); } catch { return null; }
}

function accountResponse(account) {
	const active = account.subscription_status === "active" && Number(account.subscription_period_end || 0) > Date.now();
	return { id: account.id, username: account.username, plan: active ? "plus" : "free", subscriptionStatus: account.subscription_status };
}

export async function handleAuth(request, env, pathname) {
	if (!env.DB || !env.JWT_SECRET) return json({ error: "Account service is not configured yet." }, 503);
	const now = Date.now();

	if (pathname === "/api/auth/register" && request.method === "POST") {
		const body = await bodyJson(request);
		const username = String(body?.username || "").trim();
		const password = body?.password;
		if (!validUsername(username)) return json({ error: "Username must be 3–32 letters, numbers, or underscores." }, 400);
		if (!validPassword(password)) return json({ error: "Use a password between 12 and 256 characters." }, 400);
		const rateKey = await digest(`register:${request.headers.get("cf-connecting-ip") || "unknown"}`);
		if (!await rateLimit(env.DB, rateKey, 8, 60 * 60 * 1000)) return json({ error: "Too many signup attempts. Try again later." }, 429);
		const id = crypto.randomUUID();
		const salt = randomToken(16);
		const recoveryCode = randomRecoveryCode();
		let storedPasswordHash;
		let storedRecoveryCodeHash;
		try {
			storedPasswordHash = await passwordHash(password, salt);
			storedRecoveryCodeHash = await digest(`${id}:${recoveryCode}`);
		} catch (error) {
			console.error("Vigil signup credential hashing failed", error);
			return json({ error: "Secure signup is temporarily unavailable. Please try again." }, 500);
		}
		try {
			await env.DB.prepare(
				`INSERT INTO accounts (id, username, password_salt, password_hash, recovery_code_hash, password_changed_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			).bind(id, username, salt, storedPasswordHash, storedRecoveryCodeHash, now, now, now).run();
		} catch (error) {
			const message = String(error?.message || error);
			if (/UNIQUE constraint failed: accounts\.username/i.test(message)) {
				return json({ error: "That username is unavailable." }, 409);
			}
			console.error("Vigil signup database insert failed", error);
			return json({ error: "We couldn’t create your account right now. Please try again." }, 500);
		}
		const token = await newSession(env, id);
		return json({ account: { id, username, plan: "free" }, recoveryCode }, 201, { "set-cookie": sessionCookie(token) });
	}

	if (pathname === "/api/auth/login" && request.method === "POST") {
		const body = await bodyJson(request);
		const username = String(body?.username || "").trim();
		const ipKey = await digest(`login:${request.headers.get("cf-connecting-ip") || "unknown"}:${username.toLowerCase()}`);
		if (!await rateLimit(env.DB, ipKey, 12, 15 * 60 * 1000)) return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
		const account = await env.DB.prepare("SELECT id, username, password_salt, password_hash, subscription_status, subscription_period_end FROM accounts WHERE username = ? COLLATE NOCASE")
			.bind(username).first();
		const candidate = account ? await passwordHash(String(body?.password || ""), account.password_salt) : await passwordHash(String(body?.password || "invalid"), randomToken(16));
		if (!account || !constantTimeEqual(candidate, account.password_hash)) return json({ error: "Username or password is incorrect." }, 401);
		await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").bind(ipKey).run();
		const token = await newSession(env, account.id);
		return json({ account: accountResponse(account) }, 200, { "set-cookie": sessionCookie(token) });
	}

	if (pathname === "/api/auth/me" && request.method === "GET") {
		const account = await authenticatedAccount(request, env);
		if (!account) return json({ error: "Sign in to continue." }, 401);
		const refund = await env.DB.prepare("SELECT status FROM refund_requests WHERE account_id = ? ORDER BY created_at DESC LIMIT 1").bind(account.id).first();
		return json({ account: { ...accountResponse(account), refundPending: refund?.status === "pending" || refund?.status === "failed" } });
	}

	if (pathname === "/api/auth/logout" && request.method === "POST") {
		const token = cookieValue(request, SESSION_COOKIE);
		if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(token)).run();
		return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
	}

	if (pathname === "/api/auth/password/change" && request.method === "POST") {
		const account = await authenticatedAccount(request, env);
		if (!account) return json({ error: "Sign in to change your password." }, 401);
		const body = await bodyJson(request);
		if (!validPassword(body?.password)) return json({ error: "Use a password between 12 and 256 characters." }, 400);
		const salt = randomToken(16);
		await env.DB.prepare("UPDATE accounts SET password_salt = ?, password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?")
			.bind(salt, await passwordHash(body.password, salt), now, now, account.id).run();
		await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id).run();
		const token = await newSession(env, account.id);
		return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
	}

	if (pathname === "/api/auth/password/reset" && request.method === "POST") {
		const body = await bodyJson(request);
		const username = String(body?.username || "").trim();
		const recoveryCode = String(body?.recoveryCode || "").trim().toUpperCase();
		if (!validPassword(body?.password)) return json({ error: "Use a password between 12 and 256 characters." }, 400);
		const attemptKey = await digest(`recovery:${request.headers.get("cf-connecting-ip") || "unknown"}:${username.toLowerCase()}`);
		if (!await rateLimit(env.DB, attemptKey, 8, 60 * 60 * 1000)) return json({ error: "Too many recovery attempts. Try again later." }, 429);
		const account = await env.DB.prepare("SELECT id, username, recovery_code_hash, last_recovery_at FROM accounts WHERE username = ? COLLATE NOCASE")
			.bind(username).first();
		if (!account || !constantTimeEqual(await digest(`${account.id}:${recoveryCode}`), account.recovery_code_hash)) {
			return json({ error: "Username or recovery code is incorrect." }, 401);
		}
		if (account.last_recovery_at && now - Number(account.last_recovery_at) < RESET_LIMIT_MS) {
			return json({ error: "A recovery reset was already used in the last 24 hours." }, 429);
		}
		const salt = randomToken(16);
		const nextRecoveryCode = randomRecoveryCode();
		await env.DB.prepare(
			"UPDATE accounts SET password_salt = ?, password_hash = ?, recovery_code_hash = ?, password_changed_at = ?, last_recovery_at = ?, updated_at = ? WHERE id = ?"
		).bind(salt, await passwordHash(body.password, salt), await digest(`${account.id}:${nextRecoveryCode}`), now, now, now, account.id).run();
		await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").bind(attemptKey).run();
		await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id).run();
		const token = await newSession(env, account.id);
		return json({ ok: true, recoveryCode: nextRecoveryCode }, 200, { "set-cookie": sessionCookie(token) });
	}

	return json({ error: "Not found" }, 404);
}
