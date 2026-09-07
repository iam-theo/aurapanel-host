import { useEffect, useState, useRef, useMemo } from 'react'
import {
  Box, Play, Square, RotateCcw, Trash2, RefreshCw, Plus, FileCode2,
  Terminal, Download, Eye, HardDrive, Network, Eraser, X, ChevronRight,
} from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import Modal, { Field, Button, EmptyState, ConfirmModal, PageHeader, Spinner } from '../components/ui.jsx'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const PAGE_SIZE = 8
const STATS_POLL = 5000
const LOGS_POLL = 4000

function parsePct(s) {
  const v = parseFloat(String(s || '').replace('%', ''))
  return Number.isFinite(v) ? v : 0
}

function parseSize(s) {
  const m = /^\s*([\d.]+)\s*([KMGT]?i?B)\s*$/i.exec(String(s || '').trim())
  if (!m) return 0
  const units = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 }
  return parseFloat(m[1]) * (units[m[2].toUpperCase()] || 0)
}

function formatApprox(bytes) {
  if (!bytes) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++ }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

function splitPair(s) {
  const parts = String(s || '').split('/').map(x => x.trim())
  return [parts[0] || '—', parts[1] || '—']
}

const STATE_DOT = {
  running: 'bg-panel-green',
  paused: 'bg-panel-yellow',
  exited: 'bg-panel-muted',
  created: 'bg-panel-muted',
  dead: 'bg-panel-red',
  restarting: 'bg-panel-yellow',
}

export default function Containers() {
  const notify = useNotify()
  const [tab, setTab] = useState('containers')
  const [containers, setContainers] = useState([])
  const [images, setImages] = useState([])
  const [networks, setNetworks] = useState([])
  const [volumes, setVolumes] = useState([])
  const [stats, setStats] = useState([])
  const [info, setInfo] = useState(null)
  const [df, setDf] = useState([])
  const [loading, setLoading] = useState(true)
  const [engineErr, setEngineErr] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [stack, setStack] = useState('all')
  const [selected, setSelected] = useState(null) // container object for live stream
  const [inspect, setInspect] = useState(null)
  const [showInspect, setShowInspect] = useState(false)
  const [showMounts, setShowMounts] = useState(false)
  const [logLines, setLogLines] = useState([])
  const [lockScroll, setLockScroll] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showPull, setShowPull] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [pruning, setPruning] = useState(false)
  const streamRef = useRef(null)
  const sparkRef = useRef(new Map())

  const load = async () => {
    try {
      const [c, i, n, v, inf, usage] = await Promise.all([
        api.get('/docker/containers'), api.get('/docker/images'),
        api.get('/docker/networks'), api.get('/docker/volumes'),
        api.get('/docker/info'), api.get('/docker/df').catch(() => []),
      ])
      setContainers(c); setImages(i); setNetworks(n); setVolumes(v); setInfo(inf); setDf(usage)
      setEngineErr(null)
    } catch (e) { setEngineErr(e.message) } finally { setLoading(false) }
  }

  const loadStats = async () => {
    try {
      const s = await api.get('/docker/stats')
      setStats(Array.isArray(s) ? s : [])
      const m = sparkRef.current
      for (const row of (Array.isArray(s) ? s : [])) {
        const hist = m.get(row.name) || []
        hist.push(parsePct(row.cpu))
        m.set(row.name, hist.slice(-24))
      }
    } catch {}
  }

  useEffect(() => {
    load()
    loadStats()
    const t1 = setInterval(load, 15000)
    const t2 = setInterval(loadStats, STATS_POLL)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  // Live log tail for the selected container
  useEffect(() => {
    if (!selected) { setLogLines([]); setInspect(null); return }
    let stop = false
    const tail = async () => {
      try {
        const d = await api.get(`/docker/containers/${selected.id}/logs?lines=150`)
        if (!stop) {
          setLogLines(String(d.logs || '').split('\n').slice(-150))
          if (lockScroll) setTimeout(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }), 30)
        }
      } catch {}
    }
    const insp = async () => {
      try {
        const d = await api.get(`/docker/containers/${selected.id}/inspect`)
        if (!stop) setInspect(Array.isArray(d.inspect) ? d.inspect[0] : d.inspect)
      } catch {}
    }
    tail(); insp()
    const t = setInterval(tail, LOGS_POLL)
    return () => { stop = true; clearInterval(t) }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const action = async (id, op) => {
    try {
      await api.post(`/docker/containers/${id}/${op}`)
      notify.success(`Container ${op}ed`)
      load()
    } catch (e) { notify.error(e.message) }
  }

  const killContainer = async (c) => {
    if (!(await notify.confirm(`Send SIGKILL to '${c.name}'? Unsaved work inside the container is lost.`, { title: 'Kill container', confirmText: 'Kill' }))) return
    action(c.id, 'kill')
  }

  const delContainer = async (id) => {
    try {
      await api.del(`/docker/containers/${id}?force=true`)
      notify.success('Container removed')
      if (selected?.id === id) setSelected(null)
      load()
    } catch (e) { notify.error(e.message) }
  }

  const prune = async () => {
    if (!(await notify.confirm('Prune unused containers, networks and dangling images? Running workloads are untouched.', { title: 'Prune unused', confirmText: 'Prune' }))) return
    setPruning(true)
    try {
      const r = await api.post('/docker/prune')
      notify.success(r.reclaimed ? `Reclaimed ${r.reclaimed}` : 'Prune completed')
      load()
    } catch (e) { notify.error(e.message) } finally { setPruning(false) }
  }

  const statsByName = useMemo(() => Object.fromEntries(stats.map(s => [s.name, s])), [stats])

  const projects = useMemo(() => {
    const set = new Set(containers.map(c => c.project || 'standalone'))
    return ['all', ...[...set].sort()]
  }, [containers])

  const filtered = containers.filter(c => {
    if (stack !== 'all' && (c.project || 'standalone') !== stack) return false
    if (!q) return true
    const s = `${c.name} ${c.image} ${c.id}`.toLowerCase()
    return s.includes(q.toLowerCase())
  })
  const { paged: pagedContainers, totalPages } = paginate(filtered, page, PAGE_SIZE)
  const bulk = useBulk(pagedContainers, c => c.id)
  const bulkAction = async (op) => { for (const id of bulk.selected) { try { await api.post(`/docker/containers/${id}/${op}`) } catch {} } await load(); bulk.clear() }
  const bulkDelete = async () => {
    if (!(await notify.confirm(`Force-remove ${bulk.count} containers?`, { title: 'Delete containers', confirmText: 'Delete' }))) return
    for (const id of bulk.selected) { try { await api.del(`/docker/containers/${id}?force=true`) } catch {} }
    await load(); bulk.clear()
  }

  const running = containers.filter(c => c.state === 'running').length
  const stopped = containers.filter(c => ['exited', 'created', 'paused'].includes(c.state)).length
  const failed = containers.filter(c => ['dead', 'restarting'].includes(c.state)).length
  const footprint = images.reduce((a, i) => a + parseSize(i.size), 0)
  const bridges = networks.filter(n => n.driver === 'bridge')
  const volDf = df.find(r => /volume/i.test(r.type || ''))
  const selStats = selected ? statsByName[selected.name] : null
  const [selRx, selTx] = splitPair(selStats?.net)
  const [selBread, selBwrite] = splitPair(selStats?.block)

  if (engineErr && !containers.length && !loading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader icon={Box} title="Docker & Containers" subtitle="unix:///var/run/docker.sock" />
        <div className="panel-card border-panel-red/40">
          <p className="text-panel-red font-medium">Docker engine unreachable</p>
          <p className="text-sm text-panel-muted mt-1 font-mono">{engineErr}</p>
          <button className="btn-ghost mt-4" onClick={() => { setLoading(true); load() }}><RefreshCw size={14} /> Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Subsystem / Daemon <span className="text-panel-muted normal-case">unix:///var/run/docker.sock</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Docker & Containers</h1>
            <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase flex items-center gap-1.5 ${engineErr ? 'bg-panel-cardHover text-panel-red' : 'bg-panel-cardHover text-panel-green'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${engineErr ? 'bg-panel-red' : 'bg-panel-green animate-pulse'}`} />
              {engineErr ? 'ENGINE DOWN' : 'ENGINE READY'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-2 font-mono text-xs" disabled={pruning} onClick={prune}>
            <Eraser size={14} className="text-panel-muted" /> {pruning ? 'Pruning…' : 'Prune Unused'}
          </button>
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={() => setShowPull(true)}>
            <Download size={14} className="text-panel-accent" /> Registry Hub
          </button>
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={() => setShowCompose(true)}>
            <FileCode2 size={14} className="text-panel-blue" /> Compose Up
          </button>
          <button className="btn-accent !py-2" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Deploy Container
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className="panel-card !p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Containers</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{containers.length} <span className="text-xs text-panel-muted font-normal">TOTAL</span></p>
          <p className="font-mono text-xs mt-1">
            <span className="text-panel-green font-semibold">{running} RUN</span>
            <span className="text-panel-muted"> / </span>
            <span className="text-panel-muted">{stopped} STOP</span>
            <span className="text-panel-muted"> / </span>
            <span className="text-panel-red">{failed} FAIL</span>
          </p>
          <div className="h-1 bg-panel-cardHover rounded-full overflow-hidden mt-2">
            <div className="h-full bg-panel-green" style={{ width: `${containers.length ? (running / containers.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="panel-card !p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Local Images</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{images.length} <span className="text-xs text-panel-muted font-normal">CACHED</span></p>
          <p className="font-mono text-xs text-panel-muted mt-1">Footprint <span className="text-panel-text font-semibold">{formatApprox(footprint)}</span></p>
        </div>
        <div className="panel-card !p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Volumes</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{volumes.length} <span className="text-xs text-panel-green font-normal">MOUNTED</span></p>
          <p className="font-mono text-xs text-panel-muted mt-1">Allocated <span className="text-panel-text font-semibold">{volDf?.size || '—'}</span></p>
        </div>
        <div className="panel-card !p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Bridge Networks</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{bridges.length} <span className="text-xs text-panel-muted font-normal">BRIDGES</span></p>
          <p className="font-mono text-xs text-panel-muted mt-1 truncate">Subnet <span className="text-panel-text font-semibold">{bridges.find(b => b.subnet)?.subnet || '—'}</span></p>
        </div>
        <div className="panel-card !p-4 flex flex-col justify-between col-span-2 md:col-span-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Runtime Engine</p>
          <p className="font-mono text-lg font-bold text-panel-accent mt-2 truncate">v{info?.version || '—'}</p>
          <p className="font-mono text-xs text-panel-muted mt-1 truncate">{info?.storageDriver || ''} · {info?.os || ''}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border flex-1 max-w-xl">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="grep container name, image, or id..."
            className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
          <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {projects.map(p => (
            <button key={p} onClick={() => { setStack(p); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs whitespace-nowrap ${stack === p ? 'bg-panel-cardHover text-panel-accent font-semibold' : 'bg-panel-card text-panel-muted hover:text-panel-text border border-panel-border'}`}>
              {p === 'all' ? `All Stacks (${containers.length})` : p}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-panel-card p-1 rounded-lg border border-panel-border w-fit">
        {[['containers', 'Runtimes'], ['images', 'Images'], ['networks', 'Networks'], ['volumes', 'Volumes']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-md text-sm ${tab === id ? 'bg-panel-accent text-panel-onaccent font-medium' : 'text-panel-muted hover:text-panel-text'}`}>
            {label}
          </button>
        ))}
        <button className="btn-ghost !py-1.5 !px-2 ml-1" onClick={load}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {bulk.count > 0 && tab === 'containers' && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[
          { label: 'Start', icon: <Play size={13} />, onClick: () => bulkAction('start') },
          { label: 'Stop', icon: <Square size={13} />, onClick: () => bulkAction('stop') },
          { label: 'Restart', icon: <RotateCcw size={13} />, onClick: () => bulkAction('restart') },
          { label: 'Delete', icon: <Trash2 size={13} />, onClick: bulkDelete },
        ]} />
      )}

      {tab === 'containers' && (
        <div className="panel-card p-0 overflow-hidden">
          <div className="px-4 py-2.5 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Active Runtimes Table</span>
            <span className="font-mono text-[11px] text-panel-muted">Showing {pagedContainers.length} of {filtered.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="text-left text-[11px] text-panel-muted border-b border-panel-border bg-panel-bg/50 uppercase tracking-wider">
                  <th className="px-2 py-2.5 text-center w-10">State</th>
                  <th className="px-4 py-2.5 font-medium">Container / ID</th>
                  <th className="px-4 py-2.5 font-medium">Image Tag</th>
                  <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Port Mapping</th>
                  <th className="px-4 py-2.5 font-medium w-36">CPU %</th>
                  <th className="px-4 py-2.5 font-medium">RAM / Limit</th>
                  <th className="px-4 py-2.5 font-medium hidden xl:table-cell">Uptime</th>
                  <th className="px-4 py-2.5 font-medium text-right">Quick Ops</th>
                </tr>
              </thead>
              <tbody>
                {pagedContainers.map(c => {
                  const st = statsByName[c.name]
                  const cpu = parsePct(st?.cpu)
                  const [memUsed, memLimit] = splitPair(st?.memUsage)
                  const spark = sparkRef.current.get(c.name) || []
                  const isSel = selected?.id === c.id
                  return (
                    <tr key={c.id}
                      onClick={() => setSelected(isSel ? null : c)}
                      className={`border-b border-panel-border/50 cursor-pointer transition-colors ${isSel ? 'bg-panel-accent/10' : 'hover:bg-panel-cardHover/50'}`}>
                      <td className="px-2 py-3 text-center">
                        <span className="inline-flex relative items-center justify-center" title={c.state}>
                          <span className={`w-2.5 h-2.5 rounded-full ${STATE_DOT[c.state] || 'bg-panel-muted'}`} />
                          {c.state === 'running' && <span className="absolute w-4 h-4 rounded-full bg-panel-green/20 animate-ping" />}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className={`text-[13px] font-semibold truncate ${isSel ? 'text-panel-accent' : 'text-panel-text'}`}>{c.name}</p>
                        <p className="text-[11px] text-panel-muted">{String(c.id || '').slice(0, 12)} · {c.project}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-panel-muted truncate max-w-[220px]">{c.image}</td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {c.ports
                          ? <span className="px-1.5 py-0.5 rounded bg-panel-cardHover text-panel-text text-[11px]">{String(c.ports).split(',')[0].slice(0, 28)}</span>
                          : <span className="text-panel-muted text-[11px]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-panel-text text-xs w-11">{st ? `${cpu}%` : '—'}</span>
                          <svg className="w-14 h-4 overflow-visible" viewBox="0 0 60 16">
                            <SparkPath data={spark} />
                          </svg>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {st ? (
                          <><p className="text-panel-text text-xs font-medium">{memUsed}</p>
                          <p className="text-panel-muted text-[11px]">Limit: {memLimit} ({parsePct(st.memPerc)}%)</p></>
                        ) : <span className="text-panel-muted text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-panel-muted hidden xl:table-cell whitespace-nowrap">{c.status}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button className="btn !px-2 !py-1" title="Stream logs" onClick={() => { setSelected(c); setTimeout(() => streamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50) }}><Terminal size={13} /></button>
                          <button className="btn !px-2 !py-1" title="Restart" onClick={() => action(c.id, 'restart')}><RotateCcw size={13} /></button>
                          <button className="btn !px-2 !py-1" title="Kill (SIGKILL)" onClick={() => killContainer(c)}><Square size={13} className="text-panel-red" /></button>
                          <button className="btn !px-2 !py-1" title="Inspect" onClick={async () => {
                            try {
                              const d = await api.get(`/docker/containers/${c.id}/inspect`)
                              setInspect(Array.isArray(d.inspect) ? d.inspect[0] : d.inspect)
                              setShowInspect(true)
                            } catch (e) { notify.error(e.message) }
                          }}><Eye size={13} /></button>
                          <button className="btn !px-2 !py-1" title="Remove" onClick={() => setConfirmDel(c)}><Trash2 size={13} className="text-panel-red" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {pagedContainers.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-panel-muted text-sm font-sans">
                    {loading ? <span className="inline-flex items-center gap-2"><Spinner size={15} className="text-panel-accent" /> Loading containers…</span> : 'No containers match'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4"><Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </div>
      )}

      {tab === 'images' && (
        <div className="panel-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
              <th className="px-4 py-3 font-medium">Repository</th><th className="px-4 py-3 font-medium">Tag</th><th className="px-4 py-3 font-medium">Size</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr></thead>
            <tbody>
              {images.map((img, i) => (
                <tr key={i} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50">
                  <td className="px-4 py-3 font-medium font-mono">{img.repo}</td>
                  <td className="px-4 py-3"><span className="status-badge bg-panel-blue/15 text-panel-blue">{img.tag}</span></td>
                  <td className="px-4 py-3 text-xs text-panel-muted font-mono">{img.size}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted">{img.created}</td>
                  <td className="px-4 py-3 text-right"><button className="btn !px-2 !py-1 !bg-panel-red/20 !text-panel-red" onClick={async () => { try { await api.del(`/docker/images/${img.id}`); notify.success('Image removed'); load() } catch (e) { notify.error(e.message) } }}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tab === 'networks' || tab === 'volumes') && (
        <div className="panel-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
              <th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">{tab === 'networks' ? 'Driver' : 'Driver'}</th><th className="px-4 py-3 font-medium">Details</th>
            </tr></thead>
            <tbody>
              {(tab === 'networks' ? networks : volumes).map((item, i) => (
                <tr key={i} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50">
                  <td className="px-4 py-3 font-medium font-mono">{item.name}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted">{item.driver}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted font-mono">
                    {tab === 'networks' ? `${item.scope || ''} ${item.subnet ? `· ${item.subnet}` : ''} ${item.internal ? '· internal' : ''}` : 'local volume'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Live stream + context */}
      {selected && tab === 'containers' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8 panel-card !p-0 overflow-hidden">
            <div className="px-4 py-3 bg-panel-cardHover/50 border-b border-panel-border flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-panel-accent" />
                <span className="font-mono text-[13px] font-semibold text-panel-text">Live stdout/stderr stream</span>
                <span className="px-1.5 py-0.5 rounded bg-panel-cardHover text-panel-accent font-mono text-[11px]">{selected.name}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-panel-bg text-panel-green">
                  <span className="w-1.5 h-1.5 rounded-full bg-panel-green animate-pulse" /> TAIL -F
                </span>
                <button className={`px-2 py-0.5 rounded bg-panel-cardHover ${lockScroll ? 'text-panel-text' : 'text-panel-muted'}`}
                  onClick={() => setLockScroll(v => !v)}>{lockScroll ? 'Lock Scroll' : 'Unlocked'}</button>
                <button className="px-2 py-0.5 rounded bg-panel-cardHover text-panel-muted hover:text-panel-text" onClick={() => setLogLines([])}>Clear</button>
                <button className="px-2 py-0.5 rounded bg-panel-cardHover text-panel-muted hover:text-panel-text" onClick={() => setSelected(null)}><X size={12} /></button>
              </div>
            </div>
            <div ref={streamRef} className="p-4 font-mono text-[11px] bg-panel-bg overflow-y-auto max-h-80 min-h-60 flex flex-col gap-1 leading-relaxed">
              {logLines.length === 0 && <p className="text-panel-muted"># waiting for log output…</p>}
              {logLines.map((line, i) => <LogLine key={i} line={line} />)}
              <div className="flex items-center gap-1 text-panel-accent pt-0.5">
                <span>&gt;&gt;</span>
                <span className="w-2 h-3.5 bg-panel-accent animate-pulse inline-block" />
              </div>
            </div>
          </div>

          <div className="xl:col-span-4 flex flex-col gap-4">
            <div className="panel-card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Selected Container Context</span>
                <span className="font-mono text-[11px] text-panel-green">UPTIME: {String(selected.status || '').replace(/^Up\s+/, '') || '—'}</span>
              </div>
              <p className="font-mono text-sm font-semibold text-panel-accent truncate">{selected.name}</p>
              <p className="font-mono text-[11px] text-panel-muted truncate mb-3">sha256:{String(selected.id).slice(0, 12)}…</p>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div className="p-2.5 rounded-lg bg-panel-bg border border-panel-border/50">
                  <p className="text-[10px] uppercase text-panel-muted">Network RX</p>
                  <p className="text-panel-text font-semibold mt-1">{selRx}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-panel-bg border border-panel-border/50">
                  <p className="text-[10px] uppercase text-panel-muted">Network TX</p>
                  <p className="text-panel-text font-semibold mt-1">{selTx}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-panel-bg border border-panel-border/50">
                  <p className="text-[10px] uppercase text-panel-muted">Block Read</p>
                  <p className="text-panel-text font-semibold mt-1">{selBread}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-panel-bg border border-panel-border/50">
                  <p className="text-[10px] uppercase text-panel-muted">Block Write</p>
                  <p className="text-panel-text font-semibold mt-1">{selBwrite}</p>
                </div>
              </div>
              <div className="flex items-center justify-between font-mono text-xs mt-3">
                <span className="text-panel-muted">Main PID <span className="text-panel-text font-semibold">{inspect?.State?.Pid || '—'}</span></span>
                <span className="text-panel-muted">PIDs limit <span className="text-panel-text font-semibold">{inspect?.HostConfig?.PidsLimit || '∞'}</span></span>
              </div>
              {selStats && (
                <div className="w-full h-1.5 rounded-full bg-panel-cardHover overflow-hidden mt-2">
                  <div className="h-full bg-panel-accent" style={{ width: `${Math.min(parsePct(selStats.memPerc), 100)}%` }} />
                </div>
              )}
            </div>

            <div className="panel-card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Isolation & Security</span>
                <span className="px-1.5 py-0.5 rounded bg-panel-cardHover text-panel-green font-mono text-[11px]">
                  {inspect?.HostConfig?.Privileged ? 'PRIVILEGED' : 'CONFINED'}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 font-mono text-xs text-panel-muted">
                <div className="flex justify-between"><span>AppArmor:</span><span className="text-panel-text">{inspect?.AppArmorProfile || '—'}</span></div>
                <div className="flex justify-between"><span>Root FS:</span><span className={inspect?.HostConfig?.ReadonlyRootfs ? 'text-panel-green' : 'text-panel-text'}>{inspect ? (inspect.HostConfig?.ReadonlyRootfs ? 'Read-Only (RO)' : 'Writable (RW)') : '—'}</span></div>
                <div className="flex justify-between"><span>Capabilities:</span><span className="text-panel-text truncate max-w-[160px]">{inspect?.HostConfig?.CapAdd?.join(',') || (inspect ? 'default' : '—')}</span></div>
                <div className="flex justify-between"><span>Network:</span><span className="text-panel-text">{inspect?.HostConfig?.NetworkMode || '—'}</span></div>
                <div className="flex justify-between"><span>IPC / PID:</span><span className="text-panel-text">{inspect ? `${inspect.HostConfig?.IpcMode || '—'} / ${inspect.HostConfig?.PidMode || '—'}` : '—'}</span></div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-ghost !py-1.5 text-xs flex-1" onClick={() => setShowInspect(true)}>Inspect JSON</button>
                <button className="btn-ghost !py-1.5 text-xs flex-1" onClick={() => setShowMounts(true)}>Mounts Map</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CreateContainerModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(m) => { notify.success(m); load() }} images={images} networks={networks} />
      <ComposeModal open={showCompose} onClose={() => setShowCompose(false)} onCreated={(m) => { notify.success(m); load() }} />
      <PullModal open={showPull} onClose={() => setShowPull(false)} onPulled={(m) => { notify.success(m); load() }} />
      <ConfirmModal open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && delContainer(confirmDel.id)} title="Remove container" confirmText="Remove" message={`Force-remove container '${confirmDel?.name}'?`} />
      <InspectModal open={showInspect} onClose={() => setShowInspect(false)} inspect={inspect} name={selected?.name} />
      <MountsModal open={showMounts} onClose={() => setShowMounts(false)} inspect={inspect} />
    </div>
  )
}

function SparkPath({ data }) {
  if (!data || data.length < 2) return <line x1="0" y1="8" x2="60" y2="8" stroke="currentColor" className="text-panel-muted" strokeWidth="1.5" opacity="0.4" />
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 60},${16 - (v / max) * 14}`).join(' ')
  return <polyline points={pts} fill="none" stroke="currentColor" className="text-panel-accent" strokeWidth="1.5" strokeLinecap="round" />
}

function LogLine({ line }) {
  const m = /(\[(INFO|DEBUG|WARN|WARNING|ERROR|FATAL|TRACE)\])/i.exec(line)
  if (!m) {
    const cls = /error|fail|exception|denied|fatal/i.test(line) ? 'text-panel-red' : /warn/i.test(line) ? 'text-panel-yellow' : 'text-panel-muted'
    return <div className={`${cls} whitespace-pre-wrap break-all`}>{line}</div>
  }
  const level = m[2].toUpperCase()
  const color = level === 'ERROR' || level === 'FATAL' ? 'text-panel-red'
    : level === 'WARN' || level === 'WARNING' ? 'text-panel-yellow'
    : level === 'DEBUG' || level === 'TRACE' ? 'text-panel-green' : 'text-panel-accent'
  const idx = line.indexOf(m[1])
  return (
    <div className="whitespace-pre-wrap break-all">
      <span className="text-panel-muted">{line.slice(0, idx)}</span>
      <span className={`${color} font-semibold`}>{m[1]}</span>
      <span className="text-panel-text">{line.slice(idx + m[1].length)}</span>
    </div>
  )
}

function PullModal({ open, onClose, onPulled }) {
  const [image, setImage] = useState('nginx:alpine')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  if (!open) return null
  const submit = async () => {
    if (!image.trim()) return setErr('Image reference required (e.g. nginx:alpine)')
    setBusy(true); setErr(null)
    try {
      await api.post('/docker/images/pull', { image: image.trim() })
      onPulled(`Image '${image.trim()}' pulled`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Pull from Registry Hub">
      <div className="space-y-4">
        <Field label="Image reference" hint="Any registry path, e.g. nginx:alpine or ghcr.io/org/app:1.2">
          <input className="input-field font-mono" value={image} onChange={e => setImage(e.target.value)} spellCheck={false}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} />
        </Field>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Pulling…' : 'Pull image'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function InspectModal({ open, onClose, inspect, name }) {
  if (!open) return null
  return (
    <Modal open onClose={onClose} title={`Inspect — ${name || 'container'}`} className="max-w-3xl">
      <pre className="p-3 bg-panel-bg border border-panel-border rounded-md text-[11px] font-mono text-panel-text overflow-auto max-h-[60vh] whitespace-pre-wrap">
        {inspect ? JSON.stringify(inspect, null, 2) : 'No inspect data — select a running container first.'}
      </pre>
      <div className="flex justify-end mt-4"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

function MountsModal({ open, onClose, inspect }) {
  if (!open) return null
  const mounts = inspect?.Mounts || []
  return (
    <Modal open onClose={onClose} title="Mounts Map" className="max-w-2xl">
      {mounts.length === 0 ? (
        <p className="text-sm text-panel-muted">No mounts — select a running container first.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-panel-muted border-b border-panel-border">
            <th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Destination</th><th className="py-2 font-medium">Mode</th>
          </tr></thead>
          <tbody>
            {mounts.map((m, i) => (
              <tr key={i} className="border-b border-panel-border/50 font-mono text-xs">
                <td className="py-2 pr-3 text-panel-text break-all">{m.Source}</td>
                <td className="py-2 pr-3 text-panel-text break-all">{m.Destination}</td>
                <td className="py-2 text-panel-muted">{m.Mode}{m.RW ? ' rw' : ' ro'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex justify-end mt-4"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

function CreateContainerModal({ open, onClose, onCreated, images, networks }) {
  const [form, setForm] = useState({ name: '', image: '', port: '', internalPort: '', env: '', restart: 'unless-stopped', network: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!form.name || !form.image) return setErr('Name and image required')
    setBusy(true); setErr(null)
    try {
      const env = form.env.split('\n').map(s => s.trim()).filter(Boolean)
      await api.post('/docker/containers', {
        name: form.name,
        image: form.image,
        port: form.port || undefined,
        internalPort: form.internalPort || undefined,
        env,
        restart: form.restart,
        network: form.network || undefined,
      })
      onCreated(`Container '${form.name}' started`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const tagOptions = []
  const seen = new Set()
  images.forEach(i => { if (!seen.has(i.repo)) { seen.add(i.repo); tagOptions.push(i.repo) } })

  return (
    <Modal open={open} onClose={onClose} title="Create Container">
      <div className="space-y-4">
        <Field label="Container name"><input className="input-field" placeholder="myapp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} /></Field>
        <Field label="Image">
          <input className="input-field" list="docker-images" placeholder="nginx:alpine" value={form.image} onChange={e => setForm({ ...form, image: e.target.value })} />
          <datalist id="docker-images">{tagOptions.map(r => <option key={r} value={r}>{r}</option>)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Host port"><input className="input-field" placeholder="8080" value={form.port} onChange={e => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Container port"><input className="input-field" placeholder="80" value={form.internalPort} onChange={e => setForm({ ...form, internalPort: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <Field label="Environment variables" hint="One per line: KEY=VALUE">
          <textarea className="input-field resize-none" rows={3} placeholder="PORT=8080&#10;DEBUG=true" value={form.env} onChange={e => setForm({ ...form, env: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Restart policy">
            <select className="input-field" value={form.restart} onChange={e => setForm({ ...form, restart: e.target.value })}>
              <option value="unless-stopped">unless-stopped</option><option value="always">always</option><option value="no">no</option><option value="on-failure">on-failure</option>
            </select>
          </Field>
          <Field label="Network">
            <select className="input-field" value={form.network} onChange={e => setForm({ ...form, network: e.target.value })}>
              <option value="">bridge (default)</option>
              {networks.filter(n => n.driver === 'bridge').map(n => <option key={n.name} value={n.name}>{n.name}</option>)}
            </select>
          </Field>
        </div>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating...' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function ComposeModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [compose, setCompose] = useState(DEFAULT_COMPOSE)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!name) return setErr('Project name required')
    setBusy(true); setErr(null)
    try {
      await api.post('/docker/compose/deploy', { name, compose })
      onCreated(`Compose project '${name}' started`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Deploy from docker-compose.yml" className="max-w-3xl">
      <div className="space-y-4">
        <Field label="Project name"><input className="input-field" placeholder="myproject" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} /></Field>
        <Field label="docker-compose.yml"><textarea className="input-field resize-none font-mono text-xs" rows={18} value={compose} onChange={e => setCompose(e.target.value)} spellCheck={false} /></Field>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">Saved to <code className="font-mono">/root/compose/{name || '&lt;name&gt;'}/docker-compose.yml</code> and run with <code className="font-mono">docker compose up -d</code>.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Deploying...' : 'Deploy'}</Button>
        </div>
      </div>
    </Modal>
  )
}

const DEFAULT_COMPOSE = `version: '3.8'
services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html
`
