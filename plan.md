# Vigil: a browser based focus assistant

**Product plan — revised November 17, 2026**

## Product in one sentence
Vigil helps desktop browser users follow a focus plan they chose by pausing access to selected distracting websites and making it easy to return to their task.

## Product direction
Vigil launches as a desktop browser extension for Chrome and Brave, with a companion website for account access, subscription billing, and settings sync. The core blocking loop remains useful for free users and works locally; a paid subscription unlocks the higher-value features described below. Firefox is deferred.

There will be no native iOS or Android app in the launch plan. The founder wants to avoid App Store fees and Xcode-based iOS compilation. A mobile-friendly website may support account or settings access, but it cannot provide the extension's cross-site blocking. Do not promise phone-wide blocking or describe a PWA as a substitute for a browser extension.

## Initial user and job
**Audience hypothesis:** people who work or study on a desktop browser and repeatedly open a few distracting sites during time they intended to spend on a task.

**Job:** “When I decide to focus, help me keep that commitment without shaming me or making it hard to override when I need to.”

This is a hypothesis to validate, not a proven market or health claim. Start with individual users and one supported browser. Teams, families, mobile users, and AI-agent customers are outside the initial target.

## Problem and product promise
Generic blockers may feel too rigid or require too much setup. Vigil tests whether a calm, user-controlled interruption can help someone return to a task they selected.

Vigil promises only to apply the user's own site rules during chosen focus periods. It does not promise to prevent all distraction, measure productivity, detect mental state, or save a specific number of minutes.

## Core experience
### Setup
1. Install the desktop browser extension.
2. See a plain explanation of requested permissions and what Vigil does not collect.
3. Select sites to pause and choose a schedule or manually started focus session.
4. Optionally enter a short task label. No calendar connection or voice recording is required.

### Focus session
1. The user starts a session or a chosen schedule becomes active.
2. The extension compares the current site with the user's local rules.
3. For a matching site, Vigil shows a calm pause page with the timer and optional task label.
4. The user may return to the task, wait until the pause ends, or deliberately override the block.
5. Vigil keeps only minimal local event data needed for a session summary, which the user can clear.

Blocking must be predictable, reversible, and user-controlled. Provide an obvious override. Never block an essential service unless the user explicitly added it.

## Scope
### Launch
- Desktop browser extension for Chrome and Brave.
- User-defined site rules.
- A focus timer, manual sessions, and recurring schedules; recurring schedules are a paid feature.
- Pause page with return, timer, and override actions.
- Local settings and, if useful, a basic session/override summary.
- A public product page, username/password accounts, and account settings.
- Stripe subscription checkout at $4.99 USD/month, billing management, verified webhooks, paid access enforcement, and the defined 30% refund flow.
- Opt-in settings sync, history, and backup for paid subscribers.

### Later, only if user evidence supports it
- Additional desktop browsers, including Firefox.
- Optional, clearly labeled AI task suggestions or focus routines.

### Out of launch scope
- Native iOS or Android apps, app-store submission, and Xcode workflow.
- System-wide mobile blocking or mobile feed filtering.
- Continuous browsing surveillance, page-text collection, keystroke tracking, or behavioral profiling.
- Voice-based energy/mood scoring, wearables, calendar access, health claims, or inferred diagnoses.
- Public AI-agent API, agent permissions, vector search, RAG, or network-effect claims.
- Arbitrary feed modification as a launch requirement.
- Claims of an uncopyable personal model or guaranteed behavior change.

## Minimum viable product
The first paid release should answer: **will users repeatedly use a gentle, user-controlled browser pause, and will they pay $4.99 USD per month for expanded controls and cross-device continuity?**

Build only:
- Extension installation and permission explanation.
- Add/remove a blocked domain.
- Start/end a focus session and optionally set its duration.
- Pause page with return-to-task and override controls.
- Local settings and minimal session counts for free accounts.
- Clear/reset controls.
- Username/password signup and sign-in. Do not require an email address or email-based recovery.
- Generate one high-entropy recovery code per account at signup, store only its hash, and show it once. Reset a forgotten password with username, recovery code, and a new strong password.
- Allow a logged-in user to change the password by entering a new strong password. Limit forgotten-password recovery to one reset per account in any rolling 24-hour period, rate-limit failed recovery attempts, and invalidate other sessions after a credential change.
- Use secure, HttpOnly, Secure, SameSite cookies for sessions. Do not store bearer JWTs in browser local storage or ship signing secrets to the extension.
- Cloudflare Worker API and D1 for accounts, recovery-code hashes, sessions, subscriptions, webhook event deduplication, and synced settings. No Supabase requirement.
- Stripe Checkout for subscriptions and Stripe Customer Portal for billing management and cancellation.
- A signature-verified, idempotent Stripe webhook updates subscription entitlements. Do not grant paid access from the checkout success page alone.
- Grant paid access only while Stripe reports an eligible active subscription and paid invoices. A refund cancels the subscription and revokes paid access immediately.
- Refund 30% of a successful subscription charge only if requested within 24 hours of that charge. Refund issuance also cancels the subscription and immediately removes paid access. Preserve any consumer rights that legally require another remedy or period.
- Do not add AI, calendar integrations, analytics dashboards, or agent endpoints to launch.

## Validation plan
Before building, interview desktop browser users about specific recent distractions, show a clickable flow or manually operated prototype, and recruit a small group to try their own site rules during real work or study.

Measure install to first rule creation, first rule to first blocked visit, whether the pause leads to return/wait/override, repeat sessions during the following week and continued use by week four, disable/uninstall reasons, permission concerns, requests for sync, and willingness to pay after repeated use.

Do not treat registrations, blocked-visit counts, or positive interview comments as proof of retention or payment demand. Ask whether the interruption helped users return to their chosen task and compare answers with observed repeat use.

## Privacy and trust
- Request only permissions needed for the selected blocking behavior; explain them before use.
- Match domains locally where possible. Do not collect full URLs, page contents, searches, or keystrokes by default.
- Keep settings and basic history on-device in the first version. If sync is added, make it opt-in and explain storage, retention, export, and deletion.
- Any later AI call must be optional, explicit, and server-side; never put provider secrets in the extension.
- Do not infer mental health, fatigue, or emotional state from browsing. A user-entered focus label is not a diagnosis or measurement.
- Keep blocking understandable, reversible, and easy to override.

## Success criteria
The first test is promising if users can configure Vigil without help, encounter a real block during a chosen focus period, say it helped them return to the task, and continue using it after the novelty wears off. Set numerical thresholds after recruiting testers and collecting a baseline; do not invent performance claims in advance.

## Business model
The free tier includes up to five blocked sites, focus sessions, pause/override, and basic on-device counts. Vigil Plus costs $4.99 USD/month and includes unlimited sites, recurring schedules, opt-in cross-browser/device sync, longer history, and backup/restore. Keep return, override, clear/delete, and export controls available to every user. Treat the selected price as a launch decision, not validated willingness-to-pay evidence.

## Implementation boundaries
The extension owns site matching, session state, pause-page behavior, and local settings. The Worker and D1 provide account sessions, sync, and subscription entitlements. Stripe owns payment collection and billing; verified webhooks are the source of truth for paid access. Strongly hash passwords and recovery codes, store session credentials only in secure cookies, and never expose API or signing secrets to the browser or extension. Before accepting payments in each launch market, review applicable subscription disclosure, cancellation, refund, privacy, and tax obligations; enable Stripe Tax only after required registrations are active.

## Distribution and platform
- Launch support targets Chrome and Brave. Brave may use direct manual installation; broad Chrome distribution should use the Chrome Web Store rather than asking ordinary customers to load an unpacked extension.
- Review current store policies and permission disclosures before submission.
- No native iOS or Android app, App Store fee, or Xcode build is part of this plan.
- A responsive website may be visited on a phone but does not block other apps or sites system-wide.
- Firefox is deferred until user requests and repeat use support the work.

## Roadmap
1. Verify the existing extension's blocking, timer, pause, override, reset, and persistence behavior in Brave and Chrome.
2. Build Cloudflare D1 account storage, username/password signup/sign-in, one-time recovery codes, and rate-limited password resets/changes.
3. Add Stripe Checkout at $4.99 USD/month, Customer Portal, signature-verified idempotent subscription webhooks, refund handling, and server-side entitlement checks.
4. Add a dashboard or encrypted sync only if users need settings across installations.
5. Test payment only after repeat use and a clear paid feature emerge.
6. Consider more desktop browsers or optional AI assistance only when demand supports the work.

There is no promised mobile launch or fixed multi-year expansion plan. Future scope depends on retention, user feedback, platform constraints, operating cost, and founder capacity.

## Questions to resolve through testing
- Do users prefer scheduled rules, manually started sessions, or both?
- Is a pause page helpful, or do users prefer immediate blocking?
- Which override choices feel supportive without making blocking meaningless?
- Is local-only storage sufficient?
- Does the extension alone deliver enough value, or is a dashboard needed?
- Do users return after the first week and month?
- What repeated value, if any, would justify payment?

## Summary
Vigil launches as a desktop browser extension that applies focus rules selected by the user. Its first job is a reliable, calm pause on chosen websites, with a clear route back to work and an easy override. The first release avoids native mobile apps, Xcode, cloud accounts, AI, health claims, and background surveillance. Add complexity only when observed user behavior shows it is needed.

## Approved paid-release updates — November 17, 2026

This section supersedes earlier statements in this plan that exclude accounts, cloud storage, or subscriptions, and supersedes the old validation-first roadmap.

- **Platforms:** launch for Chrome and Brave; defer Firefox.
- **Free tier:** five blocked sites, focus sessions, pause and override, basic local counts, and clear/delete/export controls.
- **Vigil Plus:** $4.99 USD per month for unlimited sites, recurring schedules, opt-in settings sync, longer history, and backup/restore.
- **Accounts:** username and password only. No email address, email login, or email recovery. Use secure HttpOnly cookies for sessions.
- **Recovery:** generate one high-entropy recovery code at signup, store only its hash, and show it once. Forgotten-password recovery requires username, recovery code, and a new strong password; limit that recovery reset to once per account per rolling 24 hours. Logged-in password changes require only a new strong password. Rate-limit failed recovery attempts and invalidate other sessions after a credential change.
- **Billing:** Stripe Checkout and Customer Portal, with signature-verified, idempotent webhooks as the source of truth for paid access. A 30% refund is available only when requested within 24 hours of a successful charge. Issuing that refund cancels the subscription and immediately revokes Plus access. Preserve mandatory consumer rights that require a different remedy or period.
- **Backend:** Cloudflare Worker and D1 for accounts, recovery-code hashes, sessions, subscription state, webhook event deduplication, and opt-in synced settings. No Supabase requirement. Never put Stripe or signing secrets in extension/frontend code.
- **Implementation order:** verify blocking in Brave/Chrome; implement account/recovery/session controls; implement Stripe checkout/webhooks/refund/access rules; implement paid feature limits and sync/backup; prepare Chrome Web Store distribution and Brave manual install; review applicable consumer, privacy, and tax obligations before accepting payments.
- **No AI dependency** is part of this paid release.
