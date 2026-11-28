<script setup>
const installOptions = [
  {
    name: 'Chrome + Brave',
    label: 'Chrome Web Store',
    description: 'Install Vigil from the Chrome Web Store in Chrome or Brave.',
    href: 'https://chromewebstore.google.com/detail/vigil-%E2%80%94-focus-with-intent/ecaidjhmimmhbapjndogjoagdcnioido',
    external: true,
    action: 'Open Chrome Web Store',
    instructions: 'Choose Add to Chrome or Add to Brave on the store page.',
  },
]
</script>

<template>
  <div class="landing-shell">
    <header class="site-header page-wrap">
      <a class="brand" href="#top" aria-label="Vigil home">
        <img src="/vigil.svg" alt="" width="38" height="38" />
        <span>VIGIL</span>
      </a>
      <nav class="main-nav" aria-label="Main navigation">
        <a href="#how">How it works</a>
        <a href="#privacy">Your privacy</a>
        <a href="#pricing">Pricing</a>
        <a href="#install">Install</a>
      </nav>
      <a class="header-cta" href="/account">Sign in <span aria-hidden="true">↗</span></a>
    </header>

    <main id="top">
      <section class="hero page-wrap">
        <div class="hero-copy">
          <p class="eyebrow"><span class="eyebrow-dot"></span> A quieter way to focus</p>
          <h1>Make room for the work <em>you came to do.</em></h1>
          <p class="hero-description">
            Choose the sites that pull you away. Start a focus session. Vigil blocks those sites while your focus timer runs.
          </p>
          <div class="hero-actions">
            <a class="button button-bright" href="#install">Get the extension <span aria-hidden="true">↗</span></a>
            <a class="text-link" href="#how">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <div class="browser-note">
            <span class="browser-mark">✦</span>
            <span>For Chrome and Brave</span>
            <span class="note-divider"></span>
            <span>Runs on your computer</span>
          </div>
        </div>

        <div class="hero-film">
          <div class="film-topline"><span>VIGIL / 001</span><span>PAUSE THE PULL</span></div>
          <video controls muted playsinline preload="metadata" poster="/vigil-promo-poster.png" aria-label="Vigil promotional film">
            <source src="/vigil-promo.mp4" type="video/mp4" />
            Your browser does not support embedded video.
          </video>
          <div class="film-caption"><span class="caption-dot"></span><span>A short film for a longer attention span</span></div>
        </div>
        <div class="hero-orbit orbit-one" aria-hidden="true"></div>
        <div class="hero-orbit orbit-two" aria-hidden="true"></div>
      </section>

      <section class="statement page-wrap" id="how">
        <div class="section-index"><span>01</span><span class="index-line"></span><span>THE PRACTICE</span></div>
        <div class="statement-content">
          <h2>Not another willpower test.<br /><span>Block distractions for the time you choose.</span></h2>
          <p>Choose the sites and end time before you start. Once the timer starts, Vigil gives you a pause page and a way back to your task. After repeated visits, you can choose a separate paid site unlock.</p>
        </div>
      </section>

      <section class="steps-band">
        <div class="page-wrap steps-grid">
          <article class="step-card">
            <span class="step-number">01 / CHOOSE</span>
            <div class="step-symbol symbol-sites" aria-hidden="true"><span></span><span></span><span></span></div>
            <h3>Name the detours.</h3>
            <p>Add a few websites you want to pause during focus time. Vigil asks for access only to the sites you add.</p>
          </article>
          <article class="step-card">
            <span class="step-number">02 / BEGIN</span>
            <div class="step-symbol symbol-time" aria-hidden="true"><span>25</span></div>
            <h3>Set your own pace.</h3>
            <p>Choose a preset or set a custom duration in minutes, hours, or days. Add a short task label if it helps you remember what you came to do.</p>
          </article>
          <article class="step-card">
            <span class="step-number">03 / DECIDE</span>
            <div class="step-symbol symbol-choice" aria-hidden="true"><span>↗</span><span>↙</span></div>
            <h3>Choose the next move.</h3>
            <p>When you try to open a blocked site, see the time left, play optional music, and return to your task.</p>
          </article>
        </div>
      </section>

      <section class="privacy-section page-wrap" id="privacy">
        <div class="privacy-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="privacy-copy">
          <p class="eyebrow">PRIVATE BY DEFAULT</p>
          <h2>Your focus belongs<br /><em>to you.</em></h2>
          <p>Vigil checks your account and subscription online and loads music from private storage. Your selected sites, focus goal, and recent trigger counts stay in your browser.</p>
        </div>
        <ul class="privacy-points">
          <li><span>01</span><span>Only the sites you choose</span></li>
          <li><span>02</span><span>Account and internet required for both plans</span></li>
          <li><span>03</span><span>Manage your site list between sessions</span></li>
        </ul>
      </section>

      <section class="install-section pricing-section" id="pricing">
        <div class="page-wrap install-wrap">
          <div class="install-heading">
            <div><p class="eyebrow">SIMPLE PLANS</p><h2>Start free.<br /><em>Go further with Plus.</em></h2></div>
            <p>Both plans include timed blocking with optional paid site unlocks. A site unlock costs $3 on visits 2–5 and $1.40 from visit 6. It releases that site from current sessions and leaves other sites blocked. Internet access is required. Music plays on the pause page when enabled.</p>
          </div>
          <div class="download-grid pricing-grid">
            <article class="download-card"><div class="download-card-top"><span class="download-label">FREE</span></div><h3>$0</h3><p>Five active sites, one focus session at a time, and the Vigil Mode music track. Create an account and sign in inside the extension.</p><a class="button button-light" href="#install">Download Vigil</a></article>
            <article class="download-card plus-card"><div class="download-card-top"><span class="download-label">VIGIL PLUS</span></div><h3>$4.99 <small>/ month</small></h3><p>Up to five concurrent sessions, each with its own sites and timer. Block more sites within browser limits. Each pause randomly plays one of three tracks. Failed renewal removes Plus access; your five most-triggered sites from the last 30 days remain active.</p><a class="button button-light" href="/account">Start Plus</a></article>
          </div>
        </div>
      </section>

      <section class="install-section" id="install">
        <div class="page-wrap install-wrap">
          <div class="install-heading">
            <div>
              <p class="eyebrow">A FIRST RELEASE, READY TO TRY</p>
              <h2>Bring a little<br /><em>quiet with you.</em></h2>
            </div>
            <p>Install Vigil in Chrome or Brave. Install it in your desktop browser, choose a site, and try one focus session.</p>
          </div>
          <div class="download-grid">
            <article v-for="option in installOptions" :key="option.name" class="download-card">
              <div class="download-card-top"><span class="download-label">{{ option.label }}</span><span class="download-arrow" aria-hidden="true">↗</span></div>
              <h3>{{ option.name }}</h3>
              <p>{{ option.description }}</p>
              <a class="button button-light" :href="option.href" :target="option.external ? '_blank' : undefined" :rel="option.external ? 'noopener noreferrer' : undefined" :download="option.external ? undefined : option.href.split('/').pop()">{{ option.action }}</a>
              <div class="install-instructions"><span>QUICK INSTALL</span><code>{{ option.instructions }}</code></div>
            </article>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer page-wrap">
      <a class="brand" href="#top"><img src="/vigil.svg" alt="" width="28" height="28" /><span>VIGIL</span></a>
      <p>A calmer pause, made for the work that matters to you.</p>
      <a href="#top">Back to top ↑</a>
      <a href="/privacy.html">Privacy policy</a>
    </footer>
  </div>
</template>
