const API_BASE = '/api'

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[2]) : null
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  // CSRF double-submit
  const csrf = getCookie('csrf_token')
  if (csrf && options.method && !['GET', 'HEAD'].includes(options.method)) {
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
    if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/csrf')) {
      // Clear stale token and bounce to login
      localStorage.removeItem('panel_token')
      if (window.location.pathname !== '/login') window.location.href = '/login'
    }
    throw new Error(data.error || `Request failed: ${res.status}`)
  }
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  put: (path, body) => request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  patch: (path, body) => request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  del: (path) => request(path, { method: 'DELETE' }),
  // Auth helpers
  login: async (username, password) => {
    const data = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (data.token) localStorage.setItem('panel_token', data.token)
    return data
  },
  logout: async () => {
    try { await request('/auth/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('panel_token')
  },
  me: () => request('/auth/me'),
  csrf: () => request('/auth/csrf'),
}
