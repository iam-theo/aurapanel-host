const API_BASE = '/api'

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[2]) : null
}

// --- Session expiry helpers (decode JWT exp without a dependency) ---
export function decodeTokenExp(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return 0
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return json.exp ? json.exp * 1000 : 0
  } catch {
    return 0
  }
}

export function getTokenExpiry() {
  const stored = Number(localStorage.getItem('panel_expires_at') || 0)
  if (stored) return stored
  const token = localStorage.getItem('panel_token')
  return token ? decodeTokenExp(token) : 0
}

export function isTokenExpired(skewMs = 5000) {
  const exp = getTokenExpiry()
  return !!exp && exp - skewMs <= Date.now()
}

function clearSession() {
  localStorage.removeItem('panel_token')
  localStorage.removeItem('panel_expires_at')
}

function handleUnauthorized(data) {
  const code = data?.code || ''
  const expired = code === 'TOKEN_EXPIRED'
  clearSession()
  // Notify AuthContext (auto-logout timer path) — api layer stays router-free.
  try {
    window.dispatchEvent(new CustomEvent('auth:expired', { detail: { code, expired } }))
  } catch {}
  if (window.location.pathname !== '/login') {
    window.location.href = expired ? '/login?expired=1' : '/login'
  }
}

function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  } catch {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

async function request(path, options = {}, _retriedCsrf = false) {
  const headers = { ...(options.headers || {}) }
  // Idempotency: every mutating request carries a key so a network-level
  // retry (e.g. after the CSRF re-prime below) never executes twice.
  // Callers can pass their own Idempotency-Key to dedupe double-submits.
  const method = (options.method || 'GET').toUpperCase()
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !headers['Idempotency-Key'] && !headers['idempotency-key']) {
    const key = newIdempotencyKey()
    headers['Idempotency-Key'] = key
    // Persist onto options so the CSRF retry below reuses the SAME key.
    options = { ...options, headers }
  }
  // CSRF double-submit
  const csrf = getCookie('csrf_token')
  if (csrf && !['GET', 'HEAD'].includes(method)) {
    headers['x-csrf-token'] = csrf
  }
  // JWT bearer if stored (also cookie is sent automatically)
  const token = localStorage.getItem('panel_token')
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Ensure we send cookies (for httpOnly)
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options, headers })
  // Try to parse JSON; if 401, redirect to login unless we're already there
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text.slice(0, 500) } }
  if (!res.ok) {
    // Cookie may be missing/stale (e.g. cleared mid-session): prime it once and retry
    if (res.status === 403 && (data.error || '').includes('CSRF') && !_retriedCsrf
        && !['GET', 'HEAD'].includes(method)) {
      try { await request('/auth/csrf') } catch {}
      return request(path, options, true)
    }
    if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/csrf')) {
      handleUnauthorized(data)
    }
    const err = new Error(data.error || `Request failed: ${res.status}`)
    err.status = res.status
    err.code = data.code || ''
    err.retryAfter = data.retryAfter || Number(res.headers.get('Retry-After')) || 0
    throw err
  }
  return data
}

function storeSession(data) {
  if (data.token) localStorage.setItem('panel_token', data.token)
  const exp = data.expiresAt || (data.token ? decodeTokenExp(data.token) : 0)
  if (exp) localStorage.setItem('panel_expires_at', String(exp))
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts = {}) => request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  }),
  put: (path, body, opts = {}) => request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  }),
  patch: (path, body, opts = {}) => request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  }),
  del: (path, opts = {}) => request(path, { method: 'DELETE', ...(opts || {}) }),
  upload: (path, formData, opts = {}) => request(path, {
    method: 'POST',
    body: formData,
    ...(opts || {}),
  }),
  // Auth helpers
  login: async (username, password, opts = {}) => {
    const data = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: JSON.stringify({ username, password }),
    })
    storeSession(data)
    return data
  },
  logout: async () => {
    try { await request('/auth/logout', { method: 'POST' }) } catch {}
    clearSession()
  },
  me: async () => {
    const data = await request('/auth/me')
    if (data.expiresAt) localStorage.setItem('panel_expires_at', String(data.expiresAt))
    return data
  },
  csrf: () => request('/auth/csrf'),
}
