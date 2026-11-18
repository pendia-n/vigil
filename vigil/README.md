# Vigil

Vigil is a local-first desktop browser focus extension. Add the websites you want to pause, choose a focus session, then decide whether to return to your task or continue to a site for five minutes.

## First release

- Chrome and Brave use the Chromium Manifest V3 package; Firefox is deferred.
- The extension stores selected sites, session timing, and simple counts in the browser’s local storage.
- Host access is requested only when a site is added.
- The promotional landing page is served as static assets by a Cloudflare Worker.
- Free users get up to five blocked sites, focus sessions, pause/override, and basic local counts.
- Vigil Plus is planned at $4.99 USD/month for unlimited sites, schedules, sync, history, and backup.
- Accounts use username/password sign-in with an app-generated recovery code; email is not collected for login or password recovery.
- Stripe Checkout, subscription webhooks, cancellation, refund handling, and server-side entitlements require the production database and Stripe environment values to be configured before launch.
- No AI feature or AI backend is required.

## Build

Install dependencies with `pnpm install`, then run `pnpm run build`. The build creates the landing page and packages the browser downloads under `public/downloads/`.

## Load the extension for testing

### Chrome or Brave

1. Download and unzip `vigil-chrome-brave.zip` from the landing page.
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on Developer mode, choose **Load unpacked**, and select the unzipped folder.

### Firefox

1. Download and unzip `vigil-firefox.zip` from the landing page.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select the package’s `manifest.json` file.

Firefox temporary add-ons are removed when Firefox closes. A permanent Firefox release needs Mozilla signing.

## Local data and permissions

Blocking rules run in the browser. Vigil does not send browsing history, page text, or session data to the Worker. The extension asks for access to a domain only when you add it. Removing a domain removes its rule and its permission when no remaining rule needs that access.

## Worker

The Worker serves the landing page and account and billing APIs. Apply `migrations/0001_paid_accounts.sql` to a Cloudflare D1 database and bind it as `DB`. Configure `JWT_SECRET`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` as Worker secrets. Checkout sends the $4.99 USD monthly price directly to Stripe. Set `EXTENSION_ORIGINS` only to trusted published extension origins. The session is a signed JWT in an HttpOnly, Secure cookie.

Run `pnpm run deploy` from an authenticated Cloudflare environment to build and deploy the Worker named `vigil`. Configure the Stripe endpoint to send subscription, invoice, checkout, and refund events to `/api/stripe/webhook`.
