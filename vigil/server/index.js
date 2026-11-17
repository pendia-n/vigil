import { handleAuth } from "./auth.js";
import { handleBilling, handleStripeWebhook } from "./billing.js";

function withCors(response, request, env) {
	const origin = request.headers.get("origin");
	if (!origin) return response;
	const allowed = new Set([new URL(request.url).origin, ...(env.EXTENSION_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)]);
	if (!allowed.has(origin)) return response;
	const headers = new Headers(response.headers);
	headers.set("access-control-allow-origin", origin);
	headers.set("access-control-allow-credentials", "true");
	headers.set("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
	headers.set("access-control-allow-headers", "content-type, stripe-signature");
	headers.append("vary", "Origin");
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		let response;

		if (url.pathname.startsWith("/api/")) {
			if (request.method === "OPTIONS") {
				response = new Response(null, { status: 204 });
			} else if (url.pathname === "/api/health" && request.method === "GET") {
				response = Response.json({ name: "Vigil", status: "ok", accounts: Boolean(env.DB), billing: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID) });
			} else if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
				response = await handleStripeWebhook(request, env);
			} else if (url.pathname.startsWith("/api/auth/")) {
				response = await handleAuth(request, env, url.pathname);
			} else if (url.pathname.startsWith("/api/billing/")) {
				response = await handleBilling(request, env, url.pathname);
			} else {
				response = Response.json({ error: "Not found" }, { status: 404 });
			}
			return withCors(response, request, env);
		}

		return env.ASSETS.fetch(request);
	},
};
