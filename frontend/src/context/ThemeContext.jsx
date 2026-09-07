import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

const ThemeContext = createContext({ theme: 'dark', toggle: () => {}, setTheme: () => {} })
const STORAGE_KEY = 'panel-theme'

function systemTheme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function storedTheme() {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s === 'light' || s === 'dark') return s
  } catch {}
  return null
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => storedTheme() || systemTheme())

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    try { document.documentElement.style.colorScheme = theme } catch {}
  }, [theme])

  // Follow OS changes until the user makes an explicit choice
  useEffect(() => {
    let mq
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)')
      const onChange = (e) => {
        if (!storedTheme()) setThemeState(e.matches ? 'light' : 'dark')
      }
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    } catch {
      return undefined
    }
  }, [])

  const setTheme = useCallback((t) => {
    if (t !== 'light' && t !== 'dark') return
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
    setThemeState(t)
  }, [])

  const toggle = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'light' ? 'dark' : 'light'
      try { localStorage.setItem(STORAGE_KEY, next) } catch {}
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

// Read a panel CSS variable as a usable color string (for canvas/SVG libs
// like recharts that can't consume Tailwind classes). Re-evaluate after
// theme changes (subscribe via useTheme so the component re-renders).
export function panelVar(name, alpha = 1) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!v) return undefined
    return alpha === 1 ? `rgb(${v})` : `rgb(${v} / ${alpha})`
  } catch {
    return undefined
  }
}
