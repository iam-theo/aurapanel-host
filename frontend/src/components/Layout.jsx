import { useState, useEffect } from 'react'
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Boxes, Database, Globe, FolderOpen,
  Cpu, Settings as SettingsIcon, Activity, Terminal, ChevronDown,
  Menu, X, ChevronRight, Archive, Clock, KeyRound, LogOut, Package,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useSWR } from '../lib/useSWR'

const navGroups = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Overview', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Compute',
    items: [
      { to: '/applications', label: 'Applications', icon: Activity },
      { to: '/containers', label: 'Containers', icon: Boxes },
      { to: '/processes', label: 'Processes', icon: Cpu },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/databases', label: 'Databases', icon: Database },
      { to: '/backups', label: 'Backups', icon: Archive },
    ],
  },
  {
    title: 'Web',
    items: [
      { to: '/domains', label: 'Domains', icon: Globe },
      { to: '/files', label: 'File Manager', icon: FolderOpen },
    ],
  },
  {
    title: 'Platform',
    items: [
      { to: '/marketplace', label: 'Marketplace', icon: Package },
      { to: '/services', label: 'Services', icon: Server },
      { to: '/cron', label: 'Cron Jobs', icon: Clock },
      { to: '/ssh-keys', label: 'SSH Keys', icon: KeyRound },
    ],
  },
]
const mainNav = navGroups.flatMap(g => g.items)

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: summary } = useSWR('/pm2/summary', () => api.get('/pm2/summary'), { refreshInterval: 30000, dedupingInterval: 10000 })

  const pageTitle = mainNav.find(n => 
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
              <p className="text-xs text-panel-muted">digital-auracle</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="status-badge online">
              <span className="w-2 h-2 rounded-full bg-panel-green animate-pulse" />
              All systems normal
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-panel-card border border-panel-border">
                <div className="w-7 h-7 rounded-full bg-panel-accent flex items-center justify-center text-xs font-bold text-white">
                  {(user?.username || 'DA').slice(0, 2).toUpperCase()}
                </div>
                <span className="text-sm hidden sm:block">{user?.username || 'digital-auracle'}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-accent/20 text-panel-accent hidden sm:block">{user?.role || 'admin'}</span>
              </div>
              <button onClick={async () => { await logout(); navigate('/login') }} title="Sign out" className="p-2 rounded-md hover:bg-panel-card border border-transparent hover:border-panel-border text-panel-muted hover:text-panel-text">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Sidebar({ summary, onClose }) {
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
        {navGroups.map(group => (
          <div key={group.title} className="mb-2">
            <p className="px-3 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-panel-muted/60">{group.title}</p>
            {group.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <item.icon size={18} />
                <span className="flex-1">{item.label}</span>
                <ChevronRight size={14} className="text-panel-muted opacity-0 group-hover:opacity-100" />
              </NavLink>
            ))}
          </div>
        ))}
        <p className="px-3 pt-5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-panel-muted/70">System</p>
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onClose}>
          <SettingsIcon size={18} />
          <span>Settings</span>
        </NavLink>
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onClose}>
          <Terminal size={18} />
          <span>Terminal</span>
        </NavLink>
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
