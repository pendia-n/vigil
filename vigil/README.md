# Vigil

Vigil is an online desktop browser focus extension for Firefox, Chrome, and Brave. Add the websites you want to pause, choose a focus session, then decide whether to return to your task or continue to a site for five minutes.

## First release

- Chrome and Brave use the Chromium Manifest V3 package. Firefox 142 and later use the separate Firefox package.
- The extension stores sites, session timing, and 30 days of per-site trigger counts locally. Both tiers require sign-in and an internet connection.
- Access to the Vigil service is required. Other site access is requested when a site is added.
- The promotional landing page is served as static assets by a Cloudflare Worker.
- Free users get up to five blocked sites, focus sessions, pause/override, and basic local counts.
- Vigil Plus costs $4.99 USD/month for sites up to browser rule limits and random R2 playback from all three tracks.
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

The Worker serves the landing page and account and billing APIs. Apply all migrations in `migrations/` to a Cloudflare D1 database and bind it as `DB`. Configure `JWT_SECRET`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` as Worker secrets. Checkout sends the $4.99 USD monthly price directly to Stripe. Set `EXTENSION_ORIGINS` only to trusted published extension origins. The session is a signed JWT in an HttpOnly, Secure cookie.

Run `pnpm run deploy` from an authenticated Cloudflare environment to build and deploy the Worker named `vigil`. Configure the Stripe endpoint to send subscription, invoice, checkout, and refund events to `/api/stripe/webhook`.

## Online extension release (0.3.0)

Create an account on the website, then sign in inside the extension with the same username and password. Free activates five sites and plays Vigil Mode. Plus activates all saved sites within browser rule limits and receives a random one of the three R2 tracks on each pause. Users cannot select the track. Music is optional and browser autoplay restrictions may require clicking Play.

The extension checks D1-backed account status through the Worker before starting sessions and fetching music, when its popup opens, and once a minute in the background. Failed checks stop the session, remove blocking rules, and stop music. Open pause pages also check every 30 seconds. Browser suspension can delay alarms until wake.

Failed renewal removes Plus. Sites are ranked by triggers in the last 30 days, then latest trigger, then saved order. Free activates the top five. Excess sites stay saved as inactive and are restored on upgrade. Counts remain local.

Apply all migrations with global Wrangler. Bind D1 as DB and the private vigil-music R2 bucket as MUSIC. Upload VIGIL_MODE_Cybernetic_Serenade.mp3, I_live_in_an_island_song.mp3, and cds_song.mp3 using those exact keys. ZIPs contain no music files or provider secrets. The authenticated Worker chooses and serves audio. The extension uses its own bearer session, while website sessions use HttpOnly cookies. Do not expose R2 publicly.

Subscription webhooks retrieve the current subscription and latest invoice from Stripe to avoid stale events restoring failed payments. Plan checks reconcile subscriptions at most once a minute to recover missed webhooks. Billing reads fail closed when reconciliation is unavailable. No scheduled generation, sync, or backup is included.
