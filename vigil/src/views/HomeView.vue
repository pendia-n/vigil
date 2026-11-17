<script setup>
const installOptions = [
  {
    name: 'Chrome + Brave',
    label: 'Chromium build',
    description: 'Brave supports manual installation from this ZIP. Chrome users can load the unpacked build for testing; a store listing is needed for a simple public install.',
    href: '/downloads/vigil-chrome-brave.zip',
    action: 'Download for Chrome / Brave',
    instructions: 'chrome://extensions or brave://extensions · Developer mode · Load unpacked',
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
            Choose the sites that pull you away. Start a focus session. When you drift, Vigil gives you a moment to choose what happens next.
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
          <h2>Not another willpower test.<br /><span>A little space to choose.</span></h2>
          <p>Vigil is a small browser companion for the moment your attention starts to wander. It keeps the decision yours: return to your task, wait out the pause, or continue when you need to.</p>
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
            <p>Start a 25, 50, or 90 minute session. Add a short task label if it helps you remember what you came to do.</p>
          </article>
          <article class="step-card">
            <span class="step-number">03 / DECIDE</span>
            <div class="step-symbol symbol-choice" aria-hidden="true"><span>↗</span><span>↙</span></div>
            <h3>Choose the next move.</h3>
            <p>When a selected site opens, pause and return to work—or deliberately continue to that site for five minutes.</p>
          </article>
        </div>
      </section>

      <section class="privacy-section page-wrap" id="privacy">
        <div class="privacy-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="privacy-copy">
          <p class="eyebrow">PRIVATE BY DEFAULT</p>
          <h2>Your focus belongs<br /><em>to you.</em></h2>
          <p>Free settings stay in your browser. If you opt in to Plus sync, Vigil stores only the settings and summaries needed for that feature—not full browsing history or page contents.</p>
        </div>
        <ul class="privacy-points">
          <li><span>01</span><span>Only the sites you choose</span></li>
          <li><span>02</span><span>Free focus works without an account</span></li>
          <li><span>03</span><span>Clear or remove your rules anytime</span></li>
        </ul>
      </section>

      <section class="install-section pricing-section" id="pricing">
        <div class="page-wrap install-wrap">
          <div class="install-heading">
            <div><p class="eyebrow">SIMPLE PLANS</p><h2>Start free.<br /><em>Go further with Plus.</em></h2></div>
            <p>The core focus loop stays free. Plus supports longer-term routines and keeps your setup available across devices.</p>
          </div>
          <div class="download-grid pricing-grid">
            <article class="download-card"><div class="download-card-top"><span class="download-label">FREE</span></div><h3>$0</h3><p>Up to five sites, focus sessions, pause and override, and basic on-device counts.</p><a class="button button-light" href="#install">Download Vigil</a></article>
            <article class="download-card plus-card"><div class="download-card-top"><span class="download-label">VIGIL PLUS</span></div><h3>$4.99 <small>/ month</small></h3><p>Unlimited sites, recurring schedules, opt-in sync, longer history, and backup.</p><a class="button button-light" href="/account">Start Plus</a></article>
          </div>
          <p class="pricing-note">Plus checkout will be available after account and billing setup is complete.</p>
        </div>
      </section>

      <section class="install-section" id="install">
        <div class="page-wrap install-wrap">
          <div class="install-heading">
            <div>
              <p class="eyebrow">A FIRST RELEASE, READY TO TRY</p>
              <h2>Bring a little<br /><em>quiet with you.</em></h2>
            </div>
            <p>Vigil is an early test build. Install it in your desktop browser, choose a site, and try one focus session.</p>
          </div>
          <div class="download-grid">
            <article v-for="option in installOptions" :key="option.name" class="download-card">
              <div class="download-card-top"><span class="download-label">{{ option.label }}</span><span class="download-arrow" aria-hidden="true">↗</span></div>
              <h3>{{ option.name }}</h3>
              <p>{{ option.description }}</p>
              <a class="button button-light" :href="option.href" :download="option.href.split('/').pop()">{{ option.action }}</a>
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
    </footer>
  </div>
</template>
