function json(body, status = 200) {
 return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}
function identifier(value) {
 return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
export async function unlockReleases(env, accountId, installation) {
 if (!identifier(installation)) return [];
 const rows = await env.DB.prepare("SELECT domain, session_ids FROM unlock_orders WHERE account_id = ? AND installation_id = ? AND status = 'paid' AND expires_at > ?")
  .bind(accountId, installation, Date.now()).all();
 return rows.results.map(row => ({ domain: row.domain, sessionIds: JSON.parse(row.session_ids) }));
}
async function attemptScope(env, accountId, installation, domain) {
 const result = await env.DB.prepare("SELECT session_id, COUNT(*) AS attempts, MAX(ends_at) AS ends_at FROM unlock_attempts WHERE account_id = ? AND installation_id = ? AND domain = ? AND ends_at > ? GROUP BY session_id ORDER BY session_id")
  .bind(accountId, installation, domain, Date.now()).all();
 const releases = await unlockReleases(env, accountId, installation);
 const rows = result.results.filter(row => !releases.some(release => release.domain === domain && release.sessionIds.includes(row.session_id)));
 const attempts = Math.max(0, ...rows.map(row => row.attempts));
 return { rows, attempts, amount: attempts > 5 ? 140 : attempts >= 2 ? 300 : null };
}
export async function fulfillUnlock(env, stripe, session) {
 const orderId = session.metadata?.unlock_order_id;
 if (!orderId || session.metadata?.purchase_type !== "domain_unlock") return false;
 const order = await env.DB.prepare("SELECT * FROM unlock_orders WHERE id = ?").bind(orderId).first();
 if (!order || session.client_reference_id !== order.account_id || session.amount_total !== order.amount || session.currency !== "usd" || session.mode !== "payment") throw new Error("Unlock payment does not match its order.");
 if (session.payment_status !== "paid") return true;
 const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
 const payment = await stripe.paymentIntents.retrieve(intent, { expand: ["latest_charge"] });
 if (payment.status !== "succeeded" || payment.latest_charge?.refunded || payment.latest_charge?.amount_refunded > 0 || payment.latest_charge?.disputed) return true;
 await env.DB.prepare("UPDATE unlock_orders SET status = 'paid', checkout_id = ?, payment_intent = ? WHERE id = ? AND status = 'pending'")
  .bind(session.id, intent, order.id).run();
 return true;
}
export async function unlockEvent(event, env, stripe) {
 const object = event.data.object;
 if (event.type.startsWith("checkout.session.") && object.metadata?.purchase_type === "domain_unlock") {
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) await fulfillUnlock(env, stripe, object);
  return true;
 }
 if (event.type === "charge.refunded" || event.type === "charge.dispute.created" || event.type === "radar.early_fraud_warning.created") {
  const charge = event.type === "charge.refunded" ? object : await stripe.charges.retrieve(typeof object.charge === "string" ? object.charge : object.charge?.id);
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intent) return false;
  let order = await env.DB.prepare("SELECT id FROM unlock_orders WHERE payment_intent = ?").bind(intent).first();
  if (!order) {
   const payment = await stripe.paymentIntents.retrieve(intent);
   if (payment.metadata?.purchase_type === "domain_unlock") {
    order = await env.DB.prepare("SELECT id FROM unlock_orders WHERE id = ?").bind(payment.metadata.unlock_order_id).first();
    if (!order) return true;
   }
  }
  if (!order) return false;
  await env.DB.prepare("UPDATE unlock_orders SET status = 'revoked' WHERE id = ?").bind(order.id).run();
  return true;
 }
 return false;
}
export async function handleUnlock(request, env, account, stripe) {
 const url = new URL(request.url);
 const body = request.method === "POST" ? await request.json().catch(() => ({})) : Object.fromEntries(url.searchParams);
 const installation = body.installation;
 if (!identifier(installation)) return json({error: "Invalid browser installation."}, 400);
 if (url.pathname.endsWith("/releases")) return json({ releases: await unlockReleases(env, account.id, installation) });
 if (url.pathname.endsWith("/confirm")) {
  const order = await env.DB.prepare("SELECT * FROM unlock_orders WHERE id = ? AND account_id = ? AND installation_id = ?").bind(body.orderId || "", account.id, installation).first();
  if (!order) return json({error: "Unlock order not found."}, 404);
  if (order.status === "pending" && order.checkout_id) await fulfillUnlock(env, stripe, await stripe.checkout.sessions.retrieve(order.checkout_id));
  return json({ releases: await unlockReleases(env, account.id, installation), status: (await env.DB.prepare("SELECT status FROM unlock_orders WHERE id = ?").bind(order.id).first()).status, expiresAt: order.expires_at });
 }
 const domain = body.domain;
 if (typeof domain !== "string" || domain.length > 253 || !/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(domain)) return json({error: "Invalid domain."}, 400);
 if (url.pathname.endsWith("/attempt")) {
  if (!identifier(body.attemptId) || !Array.isArray(body.sessions) || !body.sessions.length || body.sessions.length > 5) return json({error: "Invalid focus sessions."}, 400);
  const now = Date.now();
  const valid = body.sessions.every(session => identifier(session.id) && Number.isSafeInteger(session.endsAt) && session.endsAt > now && session.endsAt <= now + 366 * 86400000);
  if (!valid) return json({error: "Invalid focus session deadline."}, 400);
  await env.DB.batch(body.sessions.map(session => env.DB.prepare("INSERT OR IGNORE INTO unlock_attempts (account_id, installation_id, session_id, domain, ends_at, attempt_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
   .bind(account.id, installation, session.id, domain, session.endsAt, body.attemptId, now)));
  const scope = await attemptScope(env, account.id, installation, domain);
  return json({ attempts: scope.attempts, amount: scope.amount });
 }
 if (!url.pathname.endsWith("/checkout") || request.method !== "POST") return json({error: "Not found."}, 404);
 const scope = await attemptScope(env, account.id, installation, domain);
 if (!scope.amount) return json({error: "Unlocks become available on the second visit."}, 409);
 const sessionIds = scope.rows.map(row => row.session_id);
 const scopeKey = JSON.stringify([account.id, installation, domain, sessionIds]);
 const id = crypto.randomUUID();
 await env.DB.prepare("INSERT OR IGNORE INTO unlock_orders (id, account_id, installation_id, domain, session_ids, scope_key, amount, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
  .bind(id, account.id, installation, domain, JSON.stringify(sessionIds), scopeKey, scope.amount, Math.max(...scope.rows.map(row => row.ends_at)), Date.now()).run();
 let order = await env.DB.prepare("SELECT * FROM unlock_orders WHERE scope_key = ?").bind(scopeKey).first();
 if (order.status !== "pending") return json({error: "This unlock has already been processed."}, 409);
 // Replace an unpaid old quote when more attempts change the price.
 if (order.amount !== scope.amount) {
  if (order.checkout_id) await stripe.checkout.sessions.expire(order.checkout_id);
  await env.DB.prepare("UPDATE unlock_orders SET amount = ?, checkout_id = NULL, checkout_url = NULL WHERE id = ? AND status = 'pending'").bind(scope.amount, order.id).run();
  order = {...order, amount: scope.amount, checkout_id: null, checkout_url: null};
 }
 if (order.checkout_id) {
  const existing = await stripe.checkout.sessions.retrieve(order.checkout_id);
  if (existing.status === "complete") { await fulfillUnlock(env, stripe, existing); return json({error: "Payment received. Return to the blocked page."}, 409); }
  if (existing.status === "open") return json({url: order.checkout_url, orderId: order.id});
  await env.DB.prepare("UPDATE unlock_orders SET generation = generation + 1, checkout_id = NULL, checkout_url = NULL WHERE id = ? AND status = 'pending'").bind(order.id).run();
  order = await env.DB.prepare("SELECT * FROM unlock_orders WHERE id = ?").bind(order.id).first();
 }
 const session = await stripe.checkout.sessions.create({
  mode: "payment", payment_method_types: ["card"], client_reference_id: account.id,
  ...(account.stripe_customer_id ? {customer: account.stripe_customer_id} : {}),
  metadata: { purchase_type: "domain_unlock", unlock_order_id: order.id },
  payment_intent_data: { metadata: { purchase_type: "domain_unlock", unlock_order_id: order.id } },
  line_items: [{price_data: {currency: "usd", unit_amount: order.amount, product_data: {name: "Vigil unlock — " + domain, description: "Release this site from all current sessions in this browser. Other sites remain blocked."}}, quantity: 1}],
  custom_text: {submit: {message: "One-time payment. No self-service refunds for delivered unlocks. Statutory rights apply. This does not purchase Plus."}},
  success_url: url.origin + "/unlock-result.html", cancel_url: url.origin + "/unlock-result.html?canceled=1"
 }, {idempotencyKey: "unlock-" + order.id + "-" + order.amount + "-" + order.generation});
 await env.DB.prepare("UPDATE unlock_orders SET checkout_id = ?, checkout_url = ? WHERE id = ? AND status = 'pending'").bind(session.id, session.url, order.id).run();
 return json({url: session.url, orderId: order.id});
}
