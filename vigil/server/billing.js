import Stripe from "stripe";
import { authenticatedAccount } from "./auth.js";

function json(data, status = 200) {
	return Response.json(data, { status });
}

function stripeClient(env) {
	if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
	return new Stripe(env.STRIPE_SECRET_KEY, {
		apiVersion: "2026-09-30.endive",
		httpClient: Stripe.createFetchHttpClient(),
		cryptoProvider: Stripe.createSubtleCryptoProvider()
	});
}

function integrationLabel() {
	const suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => String.fromCharCode(97 + (byte % 26))).join("");
	return `vigil_plus_${suffix}`;
}

async function getOrCreateCustomer(stripe, env, account) {
	if (account.stripe_customer_id) return account.stripe_customer_id;
	const customer = await stripe.customers.create(
		{ name: account.username, metadata: { vigil_account_id: account.id } },
		{ idempotencyKey: `vigil-customer-${account.id}` }
	);
	await env.DB.prepare("UPDATE accounts SET stripe_customer_id = ?, updated_at = ? WHERE id = ?")
		.bind(customer.id, Date.now(), account.id).run();
	return customer.id;
}

export async function handleBilling(request, env, pathname) {
	if (!env.DB) return json({ error: "Billing service is not configured yet." }, 503);
	const account = await authenticatedAccount(request, env);
	if (!account) return json({ error: "Sign in to continue." }, 401);
	if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe is not configured yet." }, 503);
	const stripe = stripeClient(env);
	const origin = new URL(request.url).origin;

	if (pathname === "/api/billing/checkout" && request.method === "POST") {
		if (!env.STRIPE_PRICE_ID) return json({ error: "Subscription pricing is not configured yet." }, 503);
		if (account.subscription_status === "active" && Number(account.subscription_period_end || 0) > Date.now()) {
			return json({ error: "Your Plus subscription is already active." }, 409);
		}
		const customerId = await getOrCreateCustomer(stripe, env, account);
		const session = await stripe.checkout.sessions.create({
			mode: "subscription",
			customer: customerId,
			client_reference_id: account.id,
			line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
			subscription_data: { metadata: { vigil_account_id: account.id } },
			success_url: `${origin}/account?checkout=success`,
			cancel_url: `${origin}/account?checkout=cancelled`,
			integration_identifier: integrationLabel()
		});
		return json({ url: session.url });
	}

	if (pathname === "/api/billing/portal" && request.method === "POST") {
		if (!account.stripe_customer_id) return json({ error: "No billing profile is linked to this account." }, 404);
		const portal = await stripe.billingPortal.sessions.create({ customer: account.stripe_customer_id, return_url: `${origin}/account` });
		return json({ url: portal.url });
	}

	if (pathname === "/api/billing/refund" && request.method === "POST") {
		if (!account.stripe_customer_id || !account.stripe_subscription_id) {
			return json({ error: "There is no active paid subscription to refund." }, 409);
		}
		const charges = await stripe.charges.list({ customer: account.stripe_customer_id, limit: 10 });
		const latestCharge = charges.data.find(charge => charge.paid && charge.status === "succeeded" && charge.amount_refunded < charge.amount);
		if (!latestCharge) {
			return json({ error: "A 30% refund is only available within 24 hours of a successful charge." }, 409);
		}
		const prior = await env.DB.prepare("SELECT id, status FROM refund_requests WHERE stripe_charge_id = ?")
			.bind(latestCharge.id).first();
		if (prior?.status === "succeeded") return json({ error: "A refund has already been completed for this charge." }, 409);
		if (!prior && (account.subscription_status !== "active" || Date.now() - latestCharge.created * 1000 > 24 * 60 * 60 * 1000)) {
			return json({ error: "A 30% refund is only available within 24 hours of a successful charge." }, 409);
		}
		const refundAmount = Math.floor(latestCharge.amount * 0.3);
		if (refundAmount < 1) return json({ error: "This payment is too small to refund 30%." }, 409);
		const requestId = prior?.id || crypto.randomUUID();
		if (!prior) {
			await env.DB.prepare("INSERT INTO refund_requests (id, account_id, stripe_charge_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
				.bind(requestId, account.id, latestCharge.id, Date.now()).run();
		}
		try {
			if (account.subscription_status === "active") {
				await stripe.subscriptions.cancel(account.stripe_subscription_id);
				await env.DB.prepare("UPDATE accounts SET subscription_status = 'canceled', subscription_period_end = ?, updated_at = ? WHERE id = ?")
					.bind(Date.now(), Date.now(), account.id).run();
			}
			const refund = await stripe.refunds.create(
				{ charge: latestCharge.id, amount: refundAmount, reason: "requested_by_customer", metadata: { vigil_account_id: account.id } },
				{ idempotencyKey: `vigil-refund-${latestCharge.id}` }
			);
			await env.DB.prepare("UPDATE refund_requests SET stripe_refund_id = ?, status = 'succeeded' WHERE id = ?")
				.bind(refund.id, requestId).run();
			await env.DB.prepare("UPDATE accounts SET subscription_status = 'canceled', subscription_period_end = ?, updated_at = ? WHERE id = ?")
				.bind(Date.now(), Date.now(), account.id).run();
			return json({ ok: true, canceled: true, refundedAmount: refund.amount, currency: refund.currency });
		} catch {
			await env.DB.prepare("UPDATE refund_requests SET status = 'failed' WHERE id = ?").bind(requestId).run();
			return json({ error: "The refund could not be completed. If cancellation succeeded, Plus access is already removed. You can retry the refund request from this account." }, 502);
		}
	}

	return json({ error: "Not found" }, 404);
}

function subscriptionId(invoice) {
	if (typeof invoice.subscription === "string") return invoice.subscription;
	const nested = invoice.parent?.subscription_details?.subscription;
	return typeof nested === "string" ? nested : nested?.id || null;
}

async function applyEvent(event, env, stripe) {
	const object = event.data.object;
	if (event.type.startsWith("customer.subscription.")) {
		const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
		const account = await env.DB.prepare("SELECT id FROM accounts WHERE stripe_customer_id = ?").bind(customerId).first();
		if (!account) return;
		const status = object.status === "active" || object.status === "trialing" ? "active" : object.status;
		const periodEnd = Number(object.current_period_end || 0) * 1000;
		await env.DB.prepare("UPDATE accounts SET stripe_subscription_id = ?, subscription_status = ?, subscription_period_end = ?, updated_at = ? WHERE id = ?")
			.bind(object.id, status, periodEnd, Date.now(), account.id).run();
		return;
	}

	if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
		const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
		const account = await env.DB.prepare("SELECT id FROM accounts WHERE stripe_customer_id = ?").bind(customerId).first();
		if (!account) return;
		const id = subscriptionId(object);
		const status = event.type === "invoice.paid" ? "active" : "past_due";
		await env.DB.prepare("UPDATE accounts SET stripe_subscription_id = COALESCE(?, stripe_subscription_id), subscription_status = ?, last_paid_at = CASE WHEN ? = 'active' THEN ? ELSE last_paid_at END, updated_at = ? WHERE id = ?")
			.bind(id, status, status, Date.now(), Date.now(), account.id).run();
		return;
	}

	if (event.type === "checkout.session.completed") {
		const accountId = object.client_reference_id || object.metadata?.vigil_account_id;
		const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
		if (accountId && customerId) {
			await env.DB.prepare("UPDATE accounts SET stripe_customer_id = COALESCE(stripe_customer_id, ?), updated_at = ? WHERE id = ?")
				.bind(customerId, Date.now(), accountId).run();
		}
		return;
	}

	if (event.type === "charge.refunded" && Number(object.amount_refunded || 0) > 0) {
		const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
		const account = await env.DB.prepare("SELECT id, stripe_subscription_id FROM accounts WHERE stripe_customer_id = ?").bind(customerId).first();
		if (!account) return;
		if (account.stripe_subscription_id) {
			try { await stripe.subscriptions.cancel(account.stripe_subscription_id); } catch { /* Already canceled or no longer cancellable. */ }
		}
		await env.DB.prepare("UPDATE accounts SET subscription_status = 'canceled', subscription_period_end = ?, updated_at = ? WHERE id = ?")
			.bind(Date.now(), Date.now(), account.id).run();
	}

	if (event.type === "charge.dispute.created" || event.type === "radar.early_fraud_warning.created") {
		const chargeId = typeof object.charge === "string" ? object.charge : object.charge?.id;
		if (!chargeId) return;
		const charge = await stripe.charges.retrieve(chargeId);
		const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
		const account = await env.DB.prepare("SELECT id, stripe_subscription_id FROM accounts WHERE stripe_customer_id = ?").bind(customerId).first();
		if (!account) return;
		if (account.stripe_subscription_id) {
			try { await stripe.subscriptions.cancel(account.stripe_subscription_id); } catch { /* Already canceled or no longer cancellable. */ }
		}
		await env.DB.prepare("UPDATE accounts SET subscription_status = 'risk_hold', subscription_period_end = ?, updated_at = ? WHERE id = ?")
			.bind(Date.now(), Date.now(), account.id).run();
	}
}

export async function handleStripeWebhook(request, env) {
	if (!env.DB || !env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return json({ error: "Stripe webhook is not configured." }, 503);
	const stripe = stripeClient(env);
	const signature = request.headers.get("stripe-signature");
	if (!signature) return json({ error: "Missing Stripe signature." }, 400);
	let event;
	try {
		const payload = await request.text();
		event = await stripe.webhooks.constructEventAsync(payload, signature, env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider());
	} catch {
		return json({ error: "Invalid webhook signature." }, 400);
	}
	const inserted = await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)")
		.bind(event.id, event.type, Date.now()).run();
	if (!inserted.meta?.changes) return json({ received: true, duplicate: true });
	try {
		await applyEvent(event, env, stripe);
	} catch {
		await env.DB.prepare("DELETE FROM webhook_events WHERE event_id = ?").bind(event.id).run();
		return json({ error: "Webhook processing failed." }, 500);
	}
	return json({ received: true });
}
