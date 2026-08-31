import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Shield, Loader2 } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      nav('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-panel-bg p-4">
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
        <button disabled={loading} className="w-full bg-panel-blue hover:bg-panel-blue/90 text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {loading && <Loader2 size={16} className="animate-spin" />} Sign in
        </button>
        <p className="text-xs text-panel-muted text-center">Default: admin / admin123 — change immediately</p>
      </form>
    </div>
  )
}
