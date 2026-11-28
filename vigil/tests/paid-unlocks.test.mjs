import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleUnlock, fulfillUnlock, unlockEvent, unlockReleases } from '../server/unlocks.js';

const schema = await readFile(new URL('../migrations/0003_paid_unlocks.sql', import.meta.url), 'utf8');
function fixture() {
 const database = new DatabaseSync(':memory:');
 database.exec(schema);
 const DB = {
  prepare(sql) {
   const statement = database.prepare(sql);
   let values = [];
   return {
    bind(...bindings) { values = bindings; return this; },
    async first() { return statement.get(...values) || null; },
    async all() { return {results: statement.all(...values)}; },
    async run() { return {meta: statement.run(...values)}; }
   };
  },
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
 };
 const account = {id: 'test-account'};
 const sessions = [{id: 'session-a', endsAt: Date.now()+3600000}, {id: 'session-b', endsAt: Date.now()+7200000}];
 let checkouts = 0;
 const checkoutMap = new Map();
 const stripe = {
  checkout: {sessions: {
   async create(body, options) {
    const id = 'cs_' + (++checkouts);
    const session = {...body, id, status: 'open', payment_status: 'unpaid', amount_total: body.line_items[0].price_data.unit_amount, currency: 'usd', payment_intent: 'pi_test', url:'https://checkout.stripe.com/' + id};
    checkoutMap.set(id, session);
    return session;
   },
   async retrieve(id) { return checkoutMap.get(id); },
   async expire(id) { const session = checkoutMap.get(id); if(session.status !== 'open') throw new Error('Not open'); session.status = 'expired'; }
  }},
  paymentIntents: {async retrieve() {return {status:'succeeded', latest_charge:{amount_refunded:0}, metadata:{purchase_type:'domain_unlock', unlock_order_id:database.prepare('SELECT id FROM unlock_orders LIMIT 1').get()?.id}};}}
 };
 const request = (route, body) => handleUnlock(new Request('https://vigil.test/api/extension/unlock/'+route, {method:'POST', body: JSON.stringify({installation:'browser-one', domain:'reddit.com', ...body})}), {DB}, account, stripe);
 const attempt = id => request('attempt', {attemptId:id, sessions});
 return {database, env:{DB}, sessions, stripe, request, attempt, checkoutMap, count:()=>checkouts};
}

test('Visits count once per navigation and price changes at the exact thresholds', async () => {
 const f = fixture();
 assert.deepEqual(await (await f.attempt('visit-1')).json(), {attempts:1, amount:null});
 assert.deepEqual(await (await f.attempt('visit-1')).json(), {attempts:1, amount:null});
 assert.equal((await f.request('checkout')).status, 409);
 for(let visit=2; visit<=5; visit++) assert.deepEqual(await (await f.attempt('visit-'+visit)).json(), {attempts:visit, amount:300});
 assert.deepEqual(await (await f.attempt('visit-6')).json(), {attempts:6, amount:140});
});

test('A paid unlock releases both current sessions, survives duplicate fulfillment, and excludes future sessions', async () => {
 const f = fixture(); await f.attempt('one'); await f.attempt('two');
 const order = await (await f.request('checkout')).json();
 assert.equal((await (await f.request('checkout')).json()).orderId, order.orderId);
 assert.equal(f.count(), 1);
 const checkout = [...f.checkoutMap.values()][0];
 await fulfillUnlock(f.env, f.stripe, checkout);
 assert.equal((await unlockReleases(f.env, 'test-account', 'browser-one')).length, 0);
 checkout.payment_status = 'paid'; checkout.status = 'complete';
 await fulfillUnlock(f.env, f.stripe, checkout); await fulfillUnlock(f.env, f.stripe, checkout);
 const releases = await unlockReleases(f.env, 'test-account', 'browser-one');
 assert.equal(releases.length, 1);
 assert.deepEqual(releases[0].sessionIds, ['session-a','session-b']);
 assert.ok(!releases[0].sessionIds.includes('future-session'));
 assert.equal((await unlockReleases(f.env, 'test-account', 'other-browser')).length, 0);
 assert.equal(await unlockEvent({type:'charge.refunded', data:{object:{payment_intent:'pi_test'}}},f.env,f.stripe), true);
 assert.equal((await unlockReleases(f.env, 'test-account', 'browser-one')).length, 0);
 await fulfillUnlock(f.env, f.stripe, checkout);
 assert.equal((await unlockReleases(f.env, 'test-account', 'browser-one')).length, 0);
});

test('Checkout retries reuse an order and a cheaper quote expires the old checkout', async () => {
 const f = fixture(); await f.attempt('one'); await f.attempt('two');
 const first = await (await f.request('checkout')).json();
 const original = [...f.checkoutMap.values()][0];
 assert.equal(original.amount_total, 300);
 for(let visit=3;visit<=6;visit++) await f.attempt('visit-'+visit);
 const next = await (await f.request('checkout')).json();
 assert.equal(first.orderId, next.orderId);
 assert.equal(original.status, 'expired');
 assert.equal([...f.checkoutMap.values()][1].amount_total, 140);
 [...f.checkoutMap.values()][1].status = 'expired';
 assert.equal((await f.request('checkout')).status, 200);
 assert.equal(f.count(), 3);
});

test('Payment amount tampering cannot grant an unlock', async () => {
 const f = fixture(); await f.attempt('one'); await f.attempt('two'); await f.request('checkout');
 const checkout = [...f.checkoutMap.values()][0]; checkout.amount_total = 1; checkout.payment_status = 'paid';
 await assert.rejects(fulfillUnlock(f.env, f.stripe, checkout), /does not match/);
 assert.equal((await unlockReleases(f.env, 'test-account', 'browser-one')).length, 0);
});
