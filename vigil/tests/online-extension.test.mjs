import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHmac, createHash, webcrypto } from "node:crypto";
import Stripe from "stripe";
import { handleExtension } from "../server/extension.js";
import { handleStripeWebhook } from "../server/billing.js";

const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

function storage(initial = {}) {
	const values = structuredClone(initial);
	return {
		values,
		async get(keys) {
			if (typeof keys === "string") return { [keys]: values[keys] };
			if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, values[key]]));
			return { ...keys, ...values };
		},
		async set(update) { Object.assign(values, structuredClone(update)); },
		async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
		async clear() { for (const key of Object.keys(values)) delete values[key]; }
	};
}

function harness() {
	const local = storage({ accessToken: "test-token" });
	let rules = [];
	let sessionRules = [];
	const events = () => ({ addListener() {} });
	const h = { plan: "free", online: true, local, calls: 0 };
	const api = {
		runtime: { id: "test-extension", getURL: path => "chrome-extension://test/" + path, onMessage: events(), onInstalled: events(), onStartup: events() },
		storage: { local, session: storage() },
		permissions: { contains: async () => true, remove: async () => true, onRemoved: events() },
		alarms: { create: async () => {}, clear: async () => {}, getAll: async () => [], onAlarm: events() },
		declarativeNetRequest: {
			getDynamicRules: async () => rules,
			updateDynamicRules: async ({ addRules = [] }) => { rules = addRules; },
			getSessionRules: async () => sessionRules,
			updateSessionRules: async ({ addRules = [] }) => { sessionRules = addRules; }
		}
	};
	h.context = vm.createContext({
		chrome: api, URL, AbortSignal, Response, Date, btoa,
		fetch: async () => {
			h.calls++;
			if (!h.online) throw new Error("Network unavailable");
			return Response.json({ username: "tester", plan: h.plan, paidUntil: Date.now() + 86400000, music: true });
		}
	});
	vm.runInContext(background, h.context);
	h.run = expression => vm.runInContext(expression, h.context);
	h.rules = () => rules;
	return h;
}

test("Free rejects a sixth site and creates only five blocking rules", async () => {
	const h = harness();
	for (let i = 0; i < 5; i++) await h.run('addDomain("site' + i + '.com")');
	await assert.rejects(h.run('addDomain("sixth.com")'), /Free includes five/);
	await h.run('startSession(25, "Write proposal")');
	assert.equal(h.rules().length, 5);
});

test("Plus downgrade retains the five recently most-triggered sites without deleting others", async () => {
	const h = harness();
	h.plan = "plus";
	const now = Date.now();
	h.local.values.domains = ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com"];
	h.local.values.triggers = {
		"a.com": [{ day: now - 40 * 86400000, count: 100, last: now - 40 * 86400000 }],
		"b.com": [{ day: now, count: 2, last: now }],
		"c.com": [{ day: now, count: 7, last: now }],
		"d.com": [{ day: now, count: 5, last: now }],
		"e.com": [{ day: now, count: 4, last: now - 1 }],
		"f.com": [{ day: now, count: 4, last: now }],
		"g.com": [{ day: now, count: 3, last: now }]
	};
	await h.run('startSession(25, "Work")');
	assert.equal(h.rules().length, 7);
	h.plan = "free";
	await h.run("refreshOnline()");
	const state = await h.run("getState()");
	assert.deepEqual(Array.from(state.activeDomains), ["c.com", "d.com", "f.com", "e.com", "g.com"]);
	assert.equal(state.domains.length, 7);
	assert.equal(h.rules().length, 5);
	h.plan = "plus";
	await h.run("refreshOnline()");
	assert.equal(h.rules().length, 7);
});

test("Lost connection ends the session and removes blocking rules", async () => {
	const h = harness();
	await h.run('addDomain("netflix.com")');
	await h.run('startSession(25, "Work")');
	assert.equal(h.rules().length, 1);
	h.online = false;
	await h.run("refreshOnline()");
	assert.equal(h.local.values.session, null);
	assert.equal(h.local.values.accountStatus.online, false);
	assert.equal(h.rules().length, 0);
	await assert.rejects(h.run('startSession(25, "Work")'), /Network unavailable/);
});

test("Repeated pause messages count once and preserve per-site trigger totals", async () => {
	const h = harness();
	await h.run('addDomain("netflix.com")');
	await h.run('startSession(25, "Work")');
	const message = 'handleMessage({type:"pause-shown", target:"https://www.netflix.com"}, {tab:{id:7}})';
	await h.run(message);
	await h.run(message);
	assert.equal(h.local.values.triggers["netflix.com"][0].count, 1);
	assert.equal(h.local.values.stats.pauses, 1);
});

function serviceFixture(plan = "free") {
	const secret = "test-jwt-signing-secret";
	const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
	const unsigned = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ iss: "vigil", aud: "vigil", sub: "account-test", exp: Math.floor(Date.now() / 1000) + 600 });
	const token = unsigned + "." + createHmac("sha256", secret).update(unsigned).digest("base64url");
	const tokenHash = createHash("sha256").update(token).digest("base64url");
	const account = { id: "account-test", username: "tester", subscription_status: plan === "plus" ? "active" : "free", subscription_period_end: Date.now() + 86400000, billing_checked_at: Date.now() };
	const state = { account, keys: [], updates: [] };
	const DB = {
		prepare(sql) {
			let bindings;
			return {
				bind(...values) { bindings = values; return this; },
				async first() {
					if (sql.includes("FROM sessions")) return bindings[0] === tokenHash && bindings[1] === account.id ? account : null;
					if (sql.includes("FROM accounts")) return account;
					return null;
				},
				async run() {
					state.updates.push({ sql, bindings });
					if (sql.includes("SET subscription_status = CASE")) account.subscription_status = bindings[0];
					if (sql.includes("subscription_status = 'past_due'")) account.subscription_status = "past_due";
					return { meta: { changes: 1 } };
				}
			};
		}
	};
	const env = { DB, JWT_SECRET: secret, STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", MUSIC: {
		async get(key) {
			state.keys.push(key);
			return { body: new Uint8Array([73, 68, 51]), size: 3 };
		}
	} };
	const request = path => new Request("https://vigil.test/api/extension/" + path, { headers: { authorization: "Bearer " + token } });
	return { env, state, request };
}

test("Authenticated music is restricted to Vigil for Free and randomized from three R2 keys for Plus", async () => {
	const fixture = serviceFixture();
	for (let i = 0; i < 4; i++) {
		const response = await handleExtension(fixture.request("music"), fixture.env, "/api/extension/music");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
	}
	assert.equal(new Set(fixture.state.keys).size, 1);
	assert.equal(fixture.state.keys[0], "VIGIL_MODE_Cybernetic_Serenade.mp3");
	fixture.state.account.subscription_status = "active";
	for (let i = 0; i < 40; i++) await handleExtension(fixture.request("music?track=chosen"), fixture.env, "/api/extension/music");
	assert.equal(new Set(fixture.state.keys).size, 3);
	const response = await handleExtension(new Request("https://vigil.test/api/extension/music"), fixture.env, "/api/extension/music");
	assert.equal(response.status, 401);
});

test("Failed renewal webhook and later subscription events preserve Free access until payment recovers", async () => {
	const fixture = serviceFixture("plus");
	fixture.state.account.stripe_subscription_id = "sub_test";
	const previousFetch = globalThis.fetch;
	let invoiceStatus = "open";
	globalThis.fetch = async () => Response.json({
		id: "sub_test", status: "active",
		latest_invoice: { id: "in_test", status: invoiceStatus },
		items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 }] }
	});
	try {
		for (const type of ["invoice.payment_failed", "customer.subscription.updated", "invoice.paid"]) {
			if (type === "invoice.paid") invoiceStatus = "paid";
			const object = type.startsWith("invoice.") ? { id: "in_test", customer: "cus_test", subscription: "sub_test" } : { id: "sub_test", customer: "cus_test" };
			const payload = JSON.stringify({ id: "evt_" + type, type, data: { object } });
			const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: fixture.env.STRIPE_WEBHOOK_SECRET });
			const request = new Request("https://vigil.test/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload });
			const response = await handleStripeWebhook(request, fixture.env);
			assert.equal(response.status, 200);
			assert.equal(fixture.state.account.subscription_status, type === "invoice.paid" ? "active" : "past_due");
		}
	} finally { globalThis.fetch = previousFetch; }
});

if (!globalThis.crypto) globalThis.crypto = webcrypto;
