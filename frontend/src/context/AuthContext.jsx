import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api, decodeTokenExp, getTokenExpiry } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [expiresAt, setExpiresAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const timer = useRef(null)

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }

  // Schedule automatic logout exactly when the session expires, so a
  // stale token never lingers in the UI past its validity.
  const scheduleAutoLogout = (exp) => {
    clearTimer()
    if (!exp) return
    const delay = exp - Date.now()
    if (delay <= 0) {
      doLogout('expired')
      return
    }
    // setTimeout caps at ~24.8 days; sessions are hours, but clamp anyway.
    timer.current = setTimeout(() => doLogout('expired'), Math.min(delay, 2147483647))
  }

  const applySession = (u, exp) => {
    setUser(u)
    const resolved = exp || getTokenExpiry() || 0
    setExpiresAt(resolved)
    scheduleAutoLogout(resolved)
  }

  const doLogout = async (reason) => {
    clearTimer()
    try { await api.logout() } catch {}
    setUser(null)
    setExpiresAt(0)
    // Hard redirect guarantees no protected UI stays mounted with a dead
    // session (covers background expiry while the tab is open).
    const target = reason === 'expired' ? '/login?expired=1' : '/login'
    if (window.location.pathname !== '/login') window.location.href = target
    else if (reason === 'expired' && !window.location.search.includes('expired')) {
      window.history.replaceState(null, '', '/login?expired=1')
    }
  }

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      const token = localStorage.getItem('panel_token')
      if (!token) { setLoading(false); return }
      // Fail fast on refresh with an already-expired token: bounce to login
      // without flashing protected UI or firing a doomed /me request.
      const storedExp = Number(localStorage.getItem('panel_expires_at') || 0)
      const exp = storedExp || decodeTokenExp(token)
      if (exp && exp <= Date.now()) {
        localStorage.removeItem('panel_token')
        localStorage.removeItem('panel_expires_at')
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const d = await api.me()
        if (cancelled) return
        applySession(d.user, d.expiresAt || exp)
      } catch {
        if (cancelled) return
        localStorage.removeItem('panel_token')
        localStorage.removeItem('panel_expires_at')
        setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    // prime CSRF
    api.csrf().catch(() => {})

    // Fired by api.js on any 401 (expired/invalid token mid-session).
    const onExpired = (e) => {
      const wasAuthed = localStorage.getItem('panel_token')
      localStorage.removeItem('panel_token')
      localStorage.removeItem('panel_expires_at')
      setUser(null)
      setExpiresAt(0)
      clearTimer()
      const expired = e?.detail?.expired
      if (window.location.pathname !== '/login') {
        window.location.href = expired ? '/login?expired=1' : '/login'
      }
      void wasAuthed
    }
    window.addEventListener('auth:expired', onExpired)
    return () => {
      cancelled = true
      clearTimer()
      window.removeEventListener('auth:expired', onExpired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (username, password, opts) => {
    const d = await api.login(username, password, opts)
    applySession(d.user, d.expiresAt)
    await api.csrf().catch(() => {})
    return d
  }
  const logout = async () => {
    await doLogout('manual')
  }

  return (
    <AuthContext.Provider value={{ user, expiresAt, loading, login, logout, isAuthed: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
