import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Cpu, MemoryStick, HardDrive, Wifi, Copy, Terminal, RotateCcw, Camera,
  ScrollText, Shield, Server, Boxes, Activity, ChevronRight,
  ArrowDownRight, ArrowUpRight,
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { api } from '../lib/api'
import { useSWR } from '../lib/useSWR'
import { useTheme, panelVar } from '../context/ThemeContext'
import { useNotify } from '../context/NotifyContext'
import { useAuth } from '../context/AuthContext'
import { PageLoader } from '../components/ui.jsx'
import { formatBytes } from '../lib/utils'

const JOURNAL_POLL = 8000

export default function Dashboard() {
  const notify = useNotify()
  const { user } = useAuth()
  const nav = useNavigate()
  const auditRef = useRef(null)
  const canOperate = user?.role === 'admin' || user?.role === 'operator'

  const { data, error: dataErr, isLoading } = useSWR('/system/overview', () => api.get('/system/overview'), { refreshInterval: 12000, dedupingInterval: 5000 })
  const { data: pm2 } = useSWR('/pm2/summary', () => api.get('/pm2/summary'), { refreshInterval: 15000, dedupingInterval: 5000 })
  const { data: docker } = useSWR('/docker/containers', () => api.get('/docker/containers'), { refreshInterval: 15000, dedupingInterval: 5000 })
  const { data: networkStats } = useSWR('/system/network-stats', () => api.get('/system/network-stats'), { refreshInterval: 12000, dedupingInterval: 4000 })
  const { data: services, mutate: reloadServices } = useSWR('/services', () => api.get('/services'), { refreshInterval: 30000, dedupingInterval: 10000 })
  const { data: procData } = useSWR('/system/processes', () => api.get('/system/processes'), { refreshInterval: 10000, dedupingInterval: 5000 })

  const [cpuHistory, setCpuHistory] = useState([])
  const [journal, setJournal] = useState([])
  const [journalUnit, setJournalUnit] = useState('')
  const [journalFilter, setJournalFilter] = useState('')

  const { theme } = useTheme()
  const chart = {
    accent: panelVar('--panel-accent') || '#4cd7f6',
  }

  // CPU sparkline history
  useEffect(() => {
    let t
    const tick = async () => {
      try {
        const h = await api.get('/system/cpu-history')
        setCpuHistory(prev => [...prev, { t: Date.now(), usage: h.total }].slice(-40))
      } catch {}
    }
    tick()
    t = setInterval(tick, 10000)
    return () => clearInterval(t)
  }, [])

  // Live journal tail
  useEffect(() => {
    let stop = false
    let t
    const tail = async () => {
      try {
        const params = new URLSearchParams({ lines: '25', since: '1h' })
        if (journalUnit.trim()) params.set('unit', journalUnit.trim())
        const d = await api.get(`/logs/journal?${params}`)
        if (!stop) setJournal(String(d.logs || '').split('\n').filter(Boolean).slice(-25))
      } catch {}
    }
    tail()
    t = setInterval(tail, JOURNAL_POLL)
    return () => { stop = true; clearInterval(t) }
  }, [journalUnit])

  if (dataErr) {
    return (
      <div className="p-8">
        <div className="panel-card border-panel-red/40">
          <p className="text-panel-red font-medium">Failed to load server data</p>
          <p className="text-sm text-panel-muted mt-1">{String(dataErr.message)} — is the backend API running?</p>
        </div>
      </div>
    )
  }
  if (isLoading && !data) {
    return (
      <div className="p-8">
        <PageLoader label="Loading server overview..." className="min-h-[50vh]" />
      </div>
    )
  }
  if (!data) return null

  const primaryNet = (data.network || []).find(n => n.ip4 && !n.ip4.startsWith('127.')) || data.network?.[0]
  const mainDisk = (data.disk || []).find(d => d.mount === '/') || [...(data.disk || [])].sort((a, b) => b.size - a.size)[0] || {}
  const mem = data.memory || {}
  const cacheBytes = (mem.buffers || 0) + (mem.cached || 0)
  const cachePct = mem.total ? (cacheBytes / mem.total) * 100 : 0
  const netTotals = (networkStats || []).reduce((acc, n) => ({
    rx: acc.rx + (n.rxBytes || 0), tx: acc.tx + (n.txBytes || 0),
    rxSec: acc.rxSec + (n.rxSec || 0), txSec: acc.txSec + (n.txSec || 0),
  }), { rx: 0, tx: 0, rxSec: 0, txSec: 0 })
  const topProcs = (procData?.list || []).slice(0, 5)
  const shownServices = (services || []).slice(0, 6)
  const healthyServices = (services || []).filter(s => s.active).length

  const copyText = (text, label) => {
    try { navigator.clipboard?.writeText(text); notify.success(`${label} copied`) }
    catch { notify.error('Copy failed') }
  }

  const restartService = async (name) => {
    if (!(await notify.confirm(`Restart ${name}?`, { title: 'Restart service', confirmText: 'Restart' }))) return
    try {
      await api.post(`/services/${name}/restart`)
      notify.success(`${name} restarted`)
      reloadServices()
    } catch (e) { notify.error(e.message) }
  }

  const rebootHost = async () => {
    if (!(await notify.confirm('Reboot this host now? The panel will go offline for a minute.', { title: 'Reboot host', confirmText: 'Reboot' }))) return
    try {
      await api.post('/system/reboot')
      notify.warning('Reboot initiated — panel going offline')
    } catch (e) { notify.error(e.message) }
  }

  const filteredJournal = journalFilter.trim()
    ? journal.filter(l => l.toLowerCase().includes(journalFilter.trim().toLowerCase()))
    : journal

  return (
    <div className="p-6 space-y-4">
      {/* Host overview banner */}
      <div className="panel-card overflow-hidden">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-lg text-panel-text tracking-tight truncate">{data.hostname}</span>
              <button title="Copy hostname" className="p-1 rounded hover:bg-panel-cardHover text-panel-muted hover:text-panel-text shrink-0"
                onClick={() => copyText(data.hostname, 'Hostname')}>
                <Copy size={14} />
              </button>
            </div>
            <p className="font-mono text-xs text-panel-muted truncate mt-0.5">
              {data.os.distro} {data.os.release} · {data.os.kernel} ({data.os.arch})
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-panel-cardHover text-panel-green font-mono text-xs font-semibold shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-panel-green animate-pulse" />
            ACTIVE
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 pt-3 font-mono text-xs text-panel-muted">
          <span>LAN <span className="text-panel-text">{primaryNet?.ip4 || '—'}</span> <span className="opacity-60">{primaryNet?.iface || ''}</span></span>
          <span className="ml-auto">uptime <span className="text-panel-text">{data.uptime}</span></span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-4">
          <button className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-panel-cardHover hover:bg-panel-border/50 text-panel-accent font-mono text-xs font-semibold transition-colors"
            onClick={() => copyText(`ssh root@${primaryNet?.ip4 || data.hostname}`, 'SSH command')}>
            <Terminal size={14} /> SSH
          </button>
          <button className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-panel-cardHover hover:bg-panel-border/50 text-panel-text font-mono text-xs font-semibold transition-colors disabled:opacity-40"
            disabled={user?.role !== 'admin'} title={user?.role !== 'admin' ? 'Admin only' : 'Reboot host'} onClick={rebootHost}>
            <RotateCcw size={14} /> Restart
          </button>
          <button className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-panel-cardHover hover:bg-panel-border/50 text-panel-text font-mono text-xs font-semibold transition-colors"
            onClick={() => nav('/backups')}>
            <Camera size={14} /> Snap
          </button>
          <button className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-panel-cardHover hover:bg-panel-border/50 text-panel-text font-mono text-xs font-semibold transition-colors"
            onClick={() => auditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <ScrollText size={14} /> Logs
          </button>
        </div>
      </div>

      {/* Telemetry gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">CPU utilization</span>
            <span className="font-mono text-xs text-panel-accent font-bold">{data.cpu.cores} vCPU</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-3xl font-bold text-panel-text">{Number(data.cpu.usage).toFixed(1)}</span>
            <span className="font-mono text-sm text-panel-accent">%</span>
          </div>
          <div className="py-1 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuHistory}>
                <defs>
                  <linearGradient id="dashCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chart.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="usage" stroke={chart.accent} fill="url(#dashCpu)" strokeWidth={1.75} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 pt-1 font-mono text-xs text-panel-muted">
            {(data.cpu.loadAvg || []).map((v, i) => (
              <span key={i}>{['1m', '5m', '15m'][i]}: <strong className="text-panel-text">{Number(v).toFixed(2)}</strong></span>
            ))}
          </div>
        </div>

        <div className="panel-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Memory</span>
            <span className="font-mono text-xs text-panel-blue font-bold">{formatBytes(mem.total || 0)}</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-3xl font-bold text-panel-text">{formatBytes(mem.used || 0).split(' ')[0]}</span>
            <span className="font-mono text-sm text-panel-muted">{formatBytes(mem.used || 0).split(' ')[1] || ''}</span>
          </div>
          <div className="py-2">
            <div className="w-full h-2.5 bg-panel-cardHover rounded-full overflow-hidden flex">
              <div className="h-full bg-panel-blue" style={{ width: `${mem.usagePercent || 0}%` }} title={`Used ${mem.usagePercent || 0}%`} />
              <div className="h-full bg-panel-accent/50" style={{ width: `${cachePct}%` }} title={`Cache ${cachePct.toFixed(1)}%`} />
            </div>
            <div className="flex justify-between font-mono text-xs text-panel-muted pt-1">
              <span>Alloc: {(mem.usagePercent || 0).toFixed(1)}%</span>
              <span>Cache: {formatBytes(cacheBytes)}</span>
            </div>
          </div>
          <div className="font-mono text-xs text-panel-muted">
            Free: <strong className="text-panel-text">{formatBytes(mem.free || 0)}</strong>
          </div>
        </div>

        <div className="panel-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Storage · {mainDisk.mount || '—'}</span>
            <span className="font-mono text-xs text-panel-green font-bold">{mainDisk.fs || ''}</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-3xl font-bold text-panel-text">{formatBytes(mainDisk.used || 0).split(' ')[0]}</span>
            <span className="font-mono text-sm text-panel-muted">/ {formatBytes(mainDisk.size || 0)}</span>
          </div>
          <div className="py-2">
            <div className="w-full h-2 bg-panel-cardHover rounded-full overflow-hidden">
              <div className="h-full bg-panel-green" style={{ width: `${mainDisk.usagePercent || 0}%` }} />
            </div>
          </div>
          <div className="font-mono text-xs text-panel-muted">
            {(mainDisk.usagePercent || 0).toFixed(1)}% used · {formatBytes(mainDisk.available || 0)} free
          </div>
        </div>

        <div className="panel-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Network I/O</span>
            <span className="font-mono text-xs text-panel-accent font-bold">{primaryNet?.iface || ''}</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-3xl font-bold text-panel-text">{formatBytes(netTotals.rxSec || 0).split(' ')[0]}</span>
            <span className="font-mono text-sm text-panel-accent">{formatBytes(netTotals.rxSec || 0).split(' ')[1] || ''}/s</span>
          </div>
          <div className="py-2 flex flex-col gap-1 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-panel-green flex items-center gap-1"><ArrowDownRight size={13} /> {formatBytes(netTotals.rx || 0)} total</span>
              <span className="text-panel-accent flex items-center gap-1"><ArrowUpRight size={13} /> {formatBytes(netTotals.tx || 0)} total</span>
            </div>
          </div>
          <div className="font-mono text-xs text-panel-muted">
            ↑ {formatBytes(netTotals.txSec || 0)}/s · {(data.network || []).length} interface(s)
          </div>
        </div>
      </div>

      {/* Workload strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button className="panel-card panel-card-hover text-left" onClick={() => nav('/applications')}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-panel-blue/15 flex items-center justify-center"><Activity size={20} className="text-panel-blue" /></div>
            <div>
              <p className="text-2xl font-bold font-mono text-panel-text">{pm2?.online || 0}</p>
              <p className="text-xs text-panel-muted">PM2 apps online</p>
            </div>
            <ChevronRight size={16} className="ml-auto text-panel-muted" />
          </div>
        </button>
        <button className="panel-card panel-card-hover text-left" onClick={() => nav('/containers')}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-panel-purple/15 flex items-center justify-center"><Boxes size={20} className="text-panel-purple" /></div>
            <div>
              <p className="text-2xl font-bold font-mono text-panel-text">{docker?.filter(c => c.state === 'running').length || 0}</p>
              <p className="text-xs text-panel-muted">Containers running ({docker?.length || 0} total)</p>
            </div>
            <ChevronRight size={16} className="ml-auto text-panel-muted" />
          </div>
        </button>
        <div className="panel-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-panel-green/15 flex items-center justify-center"><Shield size={20} className="text-panel-green" /></div>
            <div>
              <p className="text-2xl font-bold font-mono text-panel-text">{healthyServices}<span className="text-panel-muted text-lg">/{(services || []).length}</span></p>
              <p className="text-xs text-panel-muted">Systemd units active</p>
            </div>
          </div>
        </div>
      </div>

      {/* Units + processes */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="panel-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-panel-text flex items-center gap-2"><Server size={16} className="text-panel-green" /> Systemd Units</h3>
            <span className="px-2 py-0.5 rounded bg-panel-cardHover text-panel-green font-mono text-xs font-semibold">
              {healthyServices} / {(services || []).length} healthy
            </span>
          </div>
          <div className="space-y-1.5">
            {shownServices.map(s => (
              <div key={s.name} className="flex items-center justify-between p-2 rounded-lg bg-panel-bg hover:bg-panel-cardHover transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${s.active ? 'bg-panel-green animate-pulse' : 'bg-panel-red'}`} />
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-semibold text-panel-text truncate">{s.name}</p>
                    <p className="font-mono text-[11px] text-panel-muted truncate">{s.label} · {s.enabled ? 'enabled' : 'disabled'}</p>
                  </div>
                </div>
                {canOperate && (
                  <button title={`Restart ${s.name}`} className="p-1.5 rounded text-panel-muted hover:text-panel-accent hover:bg-panel-border/40 shrink-0"
                    onClick={() => restartService(s.name)}>
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="mt-3 text-xs text-panel-accent hover:underline flex items-center gap-1" onClick={() => nav('/services')}>
            All services <ChevronRight size={13} />
          </button>
        </div>

        <div className="panel-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-panel-text flex items-center gap-2"><Cpu size={16} className="text-panel-accent" /> Top Processes</h3>
            <span className="font-mono text-xs text-panel-muted">Sort: <span className="text-panel-accent font-bold">CPU%</span></span>
          </div>
          <div className="rounded-lg overflow-hidden bg-panel-bg border border-panel-border/50">
            <div className="grid grid-cols-12 gap-1 px-3 py-1.5 bg-panel-cardHover font-mono text-[11px] text-panel-muted uppercase">
              <span className="col-span-3">PID / User</span>
              <span className="col-span-5">Command</span>
              <span className="col-span-2 text-right">CPU</span>
              <span className="col-span-2 text-right">MEM</span>
            </div>
            {topProcs.map(p => (
              <div key={p.pid} className="grid grid-cols-12 gap-1 px-3 py-2 items-center hover:bg-panel-cardHover transition-colors">
                <div className="col-span-3 min-w-0">
                  <p className="font-mono text-xs text-panel-text font-semibold">{p.pid}</p>
                  <p className="font-mono text-[11px] text-panel-muted truncate">{p.user}</p>
                </div>
                <p className="col-span-5 font-mono text-xs text-panel-text truncate">{p.command || p.name}</p>
                <p className="col-span-2 text-right font-mono text-xs font-bold text-panel-text">{p.cpu}%</p>
                <p className="col-span-2 text-right font-mono text-xs text-panel-muted">{p.mem}%</p>
              </div>
            ))}
          </div>
          <button className="mt-3 text-xs text-panel-accent hover:underline flex items-center gap-1" onClick={() => nav('/processes')}>
            All processes <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Live audit feed */}
      <div ref={auditRef} className="panel-card scroll-mt-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-panel-text flex items-center gap-2"><Shield size={16} className="text-panel-accent" /> Kernel Security Audit</h3>
          <div className="flex items-center gap-2">
            <input value={journalUnit} onChange={e => setJournalUnit(e.target.value)} placeholder="unit e.g. ssh"
              className="input-field !py-1 !px-2 text-xs font-mono w-32" />
            <input value={journalFilter} onChange={e => setJournalFilter(e.target.value)} placeholder="filter text"
              className="input-field !py-1 !px-2 text-xs font-mono w-32" />
            <span className="flex items-center gap-1 font-mono text-xs text-panel-green">
              <span className="w-1.5 h-1.5 rounded-full bg-panel-green animate-ping" /> LIVE TAIL
            </span>
          </div>
        </div>
        <div className="bg-panel-bg rounded-lg p-3 flex flex-col gap-1 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-64 overflow-y-auto border border-panel-border/50">
          {filteredJournal.length === 0 && <p className="text-panel-muted">No journal lines in the last hour.</p>}
          {filteredJournal.map((line, i) => <JournalLine key={`${i}-${line.slice(0, 24)}`} line={line} />)}
          <div className="flex items-center gap-1 text-panel-accent pt-0.5">
            <span>&gt;</span>
            <span className="w-2 h-3.5 bg-panel-accent animate-pulse inline-block" />
          </div>
        </div>
      </div>

      {/* Fleet cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
        <InfoItem label="CPU Model" value={`${data.cpu.manufacturer || ''} ${data.cpu.brand || ''}`.trim()} />
        <InfoItem label="Memory" value={formatBytes(mem.total || 0)} />
        <InfoItem label="Disk Total" value={formatBytes(mainDisk.size || 0)} />
        <InfoItem label="Interfaces" value={(data.network || []).map(n => `${n.iface} ${n.ip4}`).join(' · ') || '—'} />
      </div>
    </div>
  )
}

function JournalLine({ line }) {
  const cls = /fail|error|denied|refus|crit|alert|warn/i.test(line)
    ? 'text-panel-red'
    : /allow|accept|started|success|pass/i.test(line)
      ? 'text-panel-green'
      : 'text-panel-muted'
  const parts = line.split(/(\bfail\w*|\berror\w*|\bdenied\b|\ballow\w*|\baccept\w*|\bstarted\b|\bsuccess\w*)/i)
  return (
    <div className={`${cls} whitespace-nowrap`}>
      {parts.map((p, i) => /fail\w*|error\w*|denied|allow\w*|accept\w*|started|success\w*/i.test(p) && p.length > 2
        ? <strong key={i} className="font-bold">{p}</strong>
        : <span key={i}>{p}</span>)}
    </div>
  )
}

function InfoItem({ label, value }) {
  return (
    <div className="panel-card !p-4">
      <p className="text-xs text-panel-muted mb-1">{label}</p>
      <p className="font-medium font-mono text-[13px] text-panel-text break-words">{value}</p>
    </div>
  )
}
