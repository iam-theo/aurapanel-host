import { useEffect, useState } from 'react'
import { useLocation, useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { Shield, Loader2, Sun, Moon } from 'lucide-react'

function newSubmitKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  } catch {}
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

export default function Login() {
  const { user, loading: authLoading, login } = useAuth()
  const { theme, toggle } = useTheme()
  const nav = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const from = location.state?.from || '/'

  useEffect(() => {
    if (params.get('expired') === '1') {
      setInfo('Your session expired. Please sign in again.')
    }
  }, [params])

  // Rate-limit cooldown countdown.
  useEffect(() => {
    if (!cooldown) return
    const t = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(t); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [cooldown])

  // Already signed in (e.g. refresh with a valid session, or back-nav to
  // /login): don't strand authed users on the login form.
  if (!authLoading && user) {
    return <Navigate to={from} replace />
  }

  const submit = async (e) => {
    e.preventDefault()
    if (loading || cooldown > 0) return // double-submit / rate-limit guard
    setError('')
    setInfo('')
    setLoading(true)
    try {
      // Fresh key per user-initiated submit: safe network retries reuse it,
      // a new submit never replays an old attempt.
      await login(username, password, { headers: { 'Idempotency-Key': newSubmitKey() } })
      nav(from, { replace: true })
    } catch (err) {
      if (err.status === 429) {
        const wait = err.retryAfter || 60
        setCooldown(wait)
        setError(`Too many attempts. Try again in ${wait}s.`)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || cooldown > 0

  return (
    <div className="min-h-screen flex items-center justify-center bg-panel-bg p-4 relative">
      <button
        onClick={toggle}
        title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        className="absolute top-4 right-4 p-2 rounded-md hover:bg-panel-card border border-transparent hover:border-panel-border text-panel-muted hover:text-panel-text"
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
      <form onSubmit={submit} className="panel-card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-panel-blue/15 flex items-center justify-center">
            <Shield className="text-panel-blue" size={20} />
          </div>
          <div>
            <h1 className="font-bold text-panel-text">Server Panel</h1>
            <p className="text-xs text-panel-muted">Sign in to continue</p>
          </div>
        </div>
        {info && <div className="bg-panel-blue/10 border border-panel-blue/30 text-panel-blue text-sm rounded-lg p-3">{info}</div>}
        {error && <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-sm rounded-lg p-3">{error}</div>}
        <div>
          <label className="text-sm text-panel-muted">Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"
            className="mt-1 w-full bg-panel-bg border border-panel-border rounded-lg px-3 py-2 text-sm text-panel-text outline-none focus:border-panel-blue" placeholder="admin" />
        </div>
        <div>
          <label className="text-sm text-panel-muted">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
            className="mt-1 w-full bg-panel-bg border border-panel-border rounded-lg px-3 py-2 text-sm text-panel-text outline-none focus:border-panel-blue" placeholder="••••••••" />
        </div>
        <button disabled={disabled} className="w-full bg-panel-blue hover:bg-panel-blue/90 text-panel-onaccent rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {loading && <Loader2 size={16} className="animate-spin" />}
          {cooldown > 0 ? `Locked — retry in ${cooldown}s` : 'Sign in'}
        </button>
        <p className="text-xs text-panel-muted text-center">Default: admin / admin123 — change immediately</p>
      </form>
    </div>
  )
}
