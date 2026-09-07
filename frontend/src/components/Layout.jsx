import { useState, useEffect } from 'react'
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Boxes, Database, Globe, FolderOpen,
  Cpu, Settings as SettingsIcon, Activity, Terminal, ChevronDown,
  Menu, X, ChevronRight, Archive, Clock, KeyRound, LogOut, Package, Bot,
  Sun, Moon, Blocks,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { AlertBanner } from '../context/NotifyContext'
import { useSWR } from '../lib/useSWR'

const navGroups = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/processes', label: 'Processes', icon: Cpu },
    ],
  },
  {
    title: 'Workloads',
    items: [
      { to: '/applications', label: 'Applications', icon: Activity },
      { to: '/containers', label: 'Containers', icon: Boxes },
      { to: '/services', label: 'Services', icon: Server },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/databases', label: 'Databases', icon: Database },
      { to: '/backups', label: 'Backups', icon: Archive },
      { to: '/files', label: 'File Manager', icon: FolderOpen },
    ],
  },
  {
    title: 'Network',
    items: [
      { to: '/domains', label: 'Domains', icon: Globe },
    ],
  },
  {
    title: 'Automation',
    items: [
      { to: '/cron', label: 'Cron Jobs', icon: Clock },
      { to: '/aurex', label: 'Aurex Agent', icon: Bot },
      { to: '/marketplace', label: 'Marketplace', icon: Package },
      { to: '/integrations', label: 'Integrations', icon: Blocks },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/ssh-keys', label: 'SSH Keys', icon: KeyRound },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/', label: 'Terminal', icon: Terminal },
    ],
  },
]
const allGroups = navGroups
const NAV_OPEN_KEY = 'panel-nav-open'

// Warm route chunks so sidebar navigation rarely suspends (which would
// flash the progress bar, then the page spinner — the "double loader").
// Same module URLs as App.jsx lazy() calls; the bundler dedupes them.
const routePrefetchers = {
  '/': () => import('../pages/Dashboard.jsx'),
  '/processes': () => import('../pages/Processes.jsx'),
  '/applications': () => import('../pages/Applications.jsx'),
  '/containers': () => import('../pages/Containers.jsx'),
  '/databases': () => import('../pages/Databases.jsx'),
  '/backups': () => import('../pages/Backups.jsx'),
  '/domains': () => import('../pages/Domains.jsx'),
  '/files': () => import('../pages/Files.jsx'),
  '/services': () => import('../pages/Services.jsx'),
  '/cron': () => import('../pages/Cron.jsx'),
  '/ssh-keys': () => import('../pages/SshKeys.jsx'),
  '/marketplace': () => import('../pages/Marketplace.jsx'),
  '/integrations': () => import('../pages/Integrations.jsx'),
  '/aurex': () => import('../pages/Aurex.jsx'),
  '/settings': () => import('../pages/Settings.jsx'),
}
const prefetchRoute = (to) => {
  try { routePrefetchers[to]?.().catch(() => {}) } catch {}
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: summary } = useSWR('/pm2/summary', () => api.get('/pm2/summary'), { refreshInterval: 30000, dedupingInterval: 10000 })

  // Preload all route chunks when the browser is idle (post-login), plus the
  // app-detail chunk reachable from the Applications page
  useEffect(() => {
    const warm = () => {
      Object.values(routePrefetchers).forEach(fn => { try { fn().catch(() => {}) } catch {} })
      try { import('../pages/ApplicationDetail.jsx').catch(() => {}) } catch {}
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warm, { timeout: 4000 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = setTimeout(warm, 2500)
    return () => clearTimeout(t)
  }, [])

  const pageTitle = allGroups.flatMap(g => g.items).find(n =>
    n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)
  )?.label || 'Panel'

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:flex w-64 flex-col bg-panel-sidebar border-r border-panel-border">
        <Sidebar summary={summary} />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 bg-panel-sidebar">
            <Sidebar summary={summary} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 h-16 bg-panel-sidebar/80 backdrop-blur border-b border-panel-border shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden text-panel-text"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-panel-text">{pageTitle}</h1>
              <p className="text-xs text-panel-muted">{user?.username || 'root'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="status-badge online">
              <span className="w-2 h-2 rounded-full bg-panel-green animate-pulse" />
              All systems normal
            </span>
            <button
              onClick={toggle}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              className="p-2 rounded-md hover:bg-panel-card border border-transparent hover:border-panel-border text-panel-muted hover:text-panel-text"
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-panel-card border border-panel-border">
                <div className="w-7 h-7 rounded-full bg-panel-accent flex items-center justify-center text-xs font-bold text-panel-onaccent">
                  {(user?.username || 'DA').slice(0, 2).toUpperCase()}
                </div>
                <span className="text-sm hidden sm:block">{user?.username || 'root'}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-accent/20 text-panel-accentLight hidden sm:block">{user?.role || 'admin'}</span>
              </div>
              <button onClick={async () => { await logout(); navigate('/login') }} title="Sign out" className="p-2 rounded-md hover:bg-panel-card border border-transparent hover:border-panel-border text-panel-muted hover:text-panel-text">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <AlertBanner />
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Sidebar({ summary, onClose }) {
  const location = useLocation()
  const groupNames = allGroups.map(g => g.title)
  const [open, setOpen] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NAV_OPEN_KEY) || '{}')
      return Object.fromEntries(groupNames.map(n => [n, saved[n] !== false]))
    } catch {
      return Object.fromEntries(groupNames.map(n => [n, true]))
    }
  })

  const toggleGroup = (name) => {
    setOpen(prev => {
      const next = { ...prev, [name]: !prev[name] }
      try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Always reveal the group holding the active route
  useEffect(() => {
    const active = allGroups.find(g => g.items.some(it =>
      it.end ? location.pathname === it.to : location.pathname.startsWith(it.to)
    ))
    if (active && !open[active.title]) {
      setOpen(prev => ({ ...prev, [active.title]: true }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 h-16 border-b border-panel-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-panel-accent to-purple-700 flex items-center justify-center">
          <Server size={18} className="text-white" />
        </div>
        <div>
          <span className="font-bold text-panel-text block leading-tight">ServerPanel</span>
          <span className="text-[10px] text-panel-muted uppercase tracking-wider">Digital Auracle</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-panel-muted hover:text-panel-text">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-4 py-4">
        <div className="bg-panel-card rounded-lg p-3 border border-panel-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-panel-muted">Applications</span>
            <span className="text-xs font-semibold text-panel-accentLight">{summary?.online || 0} online</span>
          </div>
          <div className="h-1.5 bg-panel-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-panel-accent to-panel-green rounded-full"
              style={{ width: `${summary ? (summary.online / summary.total) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-panel-muted">
            <span>{summary?.online || 0} running</span>
            <span>{summary?.stopped || 0} stopped</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {allGroups.map(group => {
          const isOpen = open[group.title] !== false
          return (
            <div key={group.title} className="mb-1">
              <button
                onClick={() => toggleGroup(group.title)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-1 px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-panel-muted/60 hover:text-panel-muted transition-colors"
              >
                <span className="flex-1 text-left">{group.title}</span>
                <ChevronDown size={13} className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
              </button>
              {isOpen && (
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <NavLink
                      key={item.to + item.label}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                      onClick={onClose}
                      onMouseEnter={() => prefetchRoute(item.to)}
                      onFocus={() => prefetchRoute(item.to)}
                    >
                      <item.icon size={18} />
                      <span className="flex-1">{item.label}</span>
                      <ChevronRight size={14} className="text-panel-muted opacity-0 group-hover:opacity-100" />
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="p-4 border-t border-panel-border">
        <div className="bg-panel-card rounded-lg p-3 border border-panel-border text-xs">
          <div className="flex items-center gap-2 text-panel-green mb-1.5">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            Pro plan
          </div>
          <p className="text-panel-muted">Managed server, 24/7 monitoring active.</p>
        </div>
      </div>
    </div>
  )
}
