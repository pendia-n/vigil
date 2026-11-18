<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

const mode = ref('login')
const account = ref(null)
const recoveryCode = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const resetCode = ref('')
const message = ref('')
const error = ref('')
const busy = ref(false)
async function api(path, data) {
  const response = await fetch(path, {
    method: data ? 'POST' : 'GET',
    credentials: 'include',
    headers: data ? { 'content-type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Try again.')
  return result
}

async function loadAccount() {
  try {
    const result = await api('/api/auth/me')
    account.value = result.account
  } catch {
    account.value = null
  }
}

async function submitAuth() {
  error.value = ''
  message.value = ''
  recoveryCode.value = ''
  if (password.value !== confirmPassword.value && mode.value !== 'login') {
    error.value = 'Those passwords do not match.'
    return
  }
  busy.value = true
  try {
    if (mode.value === 'recover') {
      const result = await api('/api/auth/password/reset', { username: username.value, recoveryCode: resetCode.value, password: password.value })
      recoveryCode.value = result.recoveryCode || ''
      message.value = 'Password changed. Save this new recovery code now; it will only be shown once.'
      password.value = ''
      confirmPassword.value = ''
      resetCode.value = ''
      await loadAccount()
    } else {
      const result = await api(mode.value === 'register' ? '/api/auth/register' : '/api/auth/login', { username: username.value, password: password.value })
      account.value = result.account
      recoveryCode.value = result.recoveryCode || ''
      message.value = recoveryCode.value ? 'Account created. Save your recovery code before leaving this page.' : 'You are signed in.'
      password.value = ''
      confirmPassword.value = ''
    }
  } catch (cause) {
    error.value = cause.message
    await loadAccount()
  } finally {
    busy.value = false
  }
}

async function changePassword() {
  error.value = ''
  message.value = ''
  if (password.value !== confirmPassword.value) {
    error.value = 'Those passwords do not match.'
    return
  }
  busy.value = true
  try {
    await api('/api/auth/password/change', { password: password.value })
    message.value = 'Password updated.'
    password.value = ''
    confirmPassword.value = ''
  } catch (cause) {
    error.value = cause.message
  } finally {
    busy.value = false
  }
}

async function beginCheckout() {
  error.value = ''
  busy.value = true
  try {
    const result = await api('/api/billing/checkout', {})
    location.assign(result.url)
  } catch (cause) {
    error.value = cause.message
    busy.value = false
  }
}

async function openPortal() {
  error.value = ''
  busy.value = true
  try {
    const result = await api('/api/billing/portal', {})
    location.assign(result.url)
  } catch (cause) {
    error.value = cause.message
    busy.value = false
  }
}

async function requestRefund() {
  if (!window.confirm('Request the 30% refund? If it qualifies, your subscription will be canceled and Plus access removed immediately.')) return
  error.value = ''
  busy.value = true
  try {
    await api('/api/billing/refund', {})
    await loadAccount()
    message.value = 'Refund requested. Your subscription was canceled and Plus access removed.'
  } catch (cause) {
    error.value = cause.message
    await loadAccount()
  } finally {
    busy.value = false
  }
}

async function signOut() {
  try { await api('/api/auth/logout', {}) } finally { account.value = null; message.value = 'You are signed out.' }
}

onMounted(loadAccount)
</script>

<template>
  <main class="account-page">
    <header class="account-header">
      <RouterLink class="account-brand" to="/"><img src="/vigil.svg" alt="" width="34" height="34" /> VIGIL</RouterLink>
      <RouterLink class="back-link" to="/">Back to Vigil</RouterLink>
    </header>

    <section class="account-card">
      <p class="eyebrow">YOUR VIGIL ACCOUNT</p>
      <h1>{{ account ? `Welcome, ${account.username}` : mode === 'register' ? 'Make your account.' : mode === 'recover' ? 'Reset your password.' : 'Sign in to Vigil.' }}</h1>
      <p class="intro" v-if="!account">Use a username and password. Vigil does not ask for your email.</p>

      <form v-if="!account" @submit.prevent="submitAuth">
        <label>Username<input v-model="username" autocomplete="username" minlength="3" maxlength="32" required /></label>
        <label v-if="mode === 'recover'">Recovery code<input v-model="resetCode" autocomplete="off" required /></label>
        <label>Password<input v-model="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" type="password" minlength="12" required /></label>
        <label v-if="mode !== 'login'">Confirm password<input v-model="confirmPassword" autocomplete="new-password" type="password" minlength="12" required /></label>
        <p v-if="mode !== 'login'" class="hint">Use at least 12 characters.</p>
        <button class="action-button" type="submit" :disabled="busy">{{ busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'recover' ? 'Reset password' : 'Sign in' }}</button>
      </form>

      <div v-else class="account-panel">
        <div class="plan-row"><span>Current plan</span><strong>{{ account.plan === 'plus' ? 'Vigil Plus · $4.99/month' : 'Free' }}</strong></div>
        <p v-if="account.plan !== 'plus'" class="intro">Free includes five sites and focus sessions. Plus adds unlimited sites, schedules, sync, history, and backup.</p>
        <button v-if="account.plan !== 'plus'" class="action-button" type="button" :disabled="busy" @click="beginCheckout">Subscribe to Plus — $4.99/month</button>
        <button v-else class="action-button" type="button" :disabled="busy" @click="openPortal">Manage subscription</button>
        <button v-if="account.plan === 'plus' || account.refundPending" class="text-button" type="button" :disabled="busy" @click="requestRefund">{{ account.refundPending ? 'Retry 30% refund and cancellation' : 'Request 30% refund and cancel' }}</button>
        <details class="password-section">
          <summary>Change password</summary>
          <form @submit.prevent="changePassword">
            <label>New password<input v-model="password" type="password" autocomplete="new-password" minlength="12" required /></label>
            <label>Confirm new password<input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label>
            <button class="action-button" type="submit" :disabled="busy">Update password</button>
          </form>
        </details>
        <button class="text-button" type="button" @click="signOut">Sign out</button>
      </div>

      <section v-if="recoveryCode" class="recovery-panel" aria-live="polite">
        <strong>Save this recovery code now</strong>
        <code>{{ recoveryCode }}</code>
        <p>Vigil stores only a one-way hash. You won’t be able to view this code again.</p>
        <button class="text-button" type="button" @click="recoveryCode = ''">I saved it</button>
      </section>

      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div v-if="!account && !recoveryCode" class="mode-links">
        <button v-if="mode !== 'login'" type="button" @click="mode = 'login'; error = ''; message = ''">Back to sign in</button>
        <template v-else>
          <button type="button" @click="mode = 'register'; error = ''; message = ''">Create account</button>
          <button type="button" @click="mode = 'recover'; error = ''; message = ''">Forgot password?</button>
        </template>
      </div>
      <p class="fine-print">By subscribing, you agree to recurring monthly billing. You can cancel from your billing page. Eligible refund requests return 30% of the charge within 24 hours and cancel Plus immediately. Statutory consumer rights still apply.</p>
    </section>
  </main>
</template>

<style scoped>
.account-page{min-height:100vh;padding:26px;background:radial-gradient(ellipse at 75% 10%,#76285d42,transparent 35%),#111118;color:#f3eff7;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.account-header{max-width:1050px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
.account-brand{display:flex;gap:10px;align-items:center;color:#fff;text-decoration:none;font-weight:850;letter-spacing:.12em}
.back-link,.mode-links button,.text-button{color:#d8a5cf}
.account-card{width:min(100%,490px);margin:8vh auto;padding:40px;border:1px solid #383340;border-radius:24px;background:#181720ec;box-shadow:0 26px 90px #0008}
.eyebrow{color:#dc86c6;font-size:11px;font-weight:800;letter-spacing:.2em}
h1{margin:10px 0 12px;font-size:clamp(30px,7vw,42px);line-height:1.08;letter-spacing:-.05em}
.intro,.hint,.fine-print{color:#a7a0af;font-size:13px;line-height:1.65}
form{display:grid;gap:14px;margin-top:22px}
label{display:grid;gap:7px;color:#d9d3df;font-size:13px;font-weight:650}
input{width:100%;min-height:46px;padding:11px 13px;border:1px solid #4a4351;border-radius:10px;background:#111118;color:#fff;font:inherit}
.action-button{width:100%;min-height:48px;border:0;border-radius:12px;color:#190f1a;background:linear-gradient(110deg,#efa0ce,#b3a2ff);font-weight:800;cursor:pointer}
.action-button:disabled{opacity:.6;cursor:wait}
.plan-row{display:flex;justify-content:space-between;gap:10px;padding:16px 0;border-bottom:1px solid #393340;font-size:13px}
.account-panel>.action-button{margin:18px 0 8px}
.text-button,.mode-links button{display:inline-block;margin:10px 14px 0 0;padding:4px 0;border:0;background:none;font:inherit;font-size:13px;cursor:pointer}
.password-section{margin-top:22px;padding-top:18px;border-top:1px solid #393340}
.password-section summary{cursor:pointer;color:#ddd5e3;font-size:14px}
.recovery-panel{display:grid;gap:12px;margin-top:22px;padding:18px;border:1px solid #aa77a7;border-radius:14px;background:#231a2a}
.recovery-panel code{overflow-wrap:anywhere;padding:12px;border-radius:9px;background:#111118;color:#fff;font-size:14px;letter-spacing:.05em}
.recovery-panel p,.fine-print{color:#a7a0af;font-size:12px;line-height:1.6}
.notice,.error{font-size:13px;line-height:1.55}.notice{color:#a9dfc3}.error{color:#ff9aba}
.mode-links{display:flex;flex-wrap:wrap;margin-top:18px}
.fine-print{margin-top:24px;padding-top:16px;border-top:1px solid #393340}
@media(max-width:540px){.account-page{padding:18px}.account-card{margin-top:7vh;padding:28px 22px}}
</style>
