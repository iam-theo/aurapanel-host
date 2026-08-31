import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('panel_token')
    if (!token) { setLoading(false); return }
    api.me().then(d => setUser(d.user)).catch(() => {
      localStorage.removeItem('panel_token')
    }).finally(() => setLoading(false))
    // prime CSRF
    api.csrf().catch(() => {})
  }, [])

  const login = async (username, password) => {
    const d = await api.login(username, password)
    setUser(d.user)
    await api.csrf().catch(() => {})
    return d
  }
  const logout = async () => {
    await api.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthed: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
