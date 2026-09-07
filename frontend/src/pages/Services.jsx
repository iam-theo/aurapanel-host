import { useEffect, useState, useRef } from 'react'
import { Play, Square, RotateCcw, Power, RefreshCw, Server, ScrollText, X } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const PAGE_SIZE = 9
const JOURNAL_POLL = 6000

const GROUP_COLORS = {
  web: 'bg-panel-blue/15 text-panel-blue',
  database: 'bg-panel-purple/15 text-panel-purple',
  containers: 'bg-panel-green/15 text-panel-green',
  application: 'bg-panel-yellow/15 text-panel-yellow',
  network: 'bg-panel-orange/15 text-panel-orange',
  remote: 'bg-panel-red/15 text-panel-red',
  iot: 'bg-panel-green/15 text-panel-green',
}

export default function Services() {
  const notify = useNotify()
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [statusOut, setStatusOut] = useState('')
  const [journal, setJournal] = useState([])
  const [lockScroll, setLockScroll] = useState(true)
  const streamRef = useRef(null)

  const load = async () => {
    try {
      const d = await api.get('/services')
      setServices(Array.isArray(d) ? d : [])
    } catch (e) {
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  // Status + journal tail for the selected unit
  useEffect(() => {
    if (!selected) { setStatusOut(''); setJournal([]); return }
    let stop = false
    const fetchStatus = async () => {
      try {
        const d = await api.get(`/services/${selected.name}/status`)
        if (!stop) setStatusOut(String(d.status || ''))
      } catch (e) { if (!stop) setStatusOut(`status failed: ${e.message}`) }
    }
    const tail = async () => {
      try {
        const d = await api.get(`/logs/journal?unit=${encodeURIComponent(selected.name)}&lines=40&since=1h`)
        if (!stop) {
          const lines = String(d.logs || '').split('\n').filter(Boolean).slice(-40)
          setJournal(d.notice ? [`# ${d.notice}`, ...lines] : lines)
          if (lockScroll) setTimeout(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }), 30)
        }
      } catch {}
    }
    fetchStatus(); tail()
    const t = setInterval(tail, JOURNAL_POLL)
    return () => { stop = true; clearInterval(t) }
  }, [selected?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const action = async (name, op) => {
    setBusy(`${name}:${op}`)
    try {
      await api.post(`/services/${name}/${op}`)
      notify.success(`${name} ${op}ed`)
      setTimeout(load, 800)
    } catch (e) {
      notify.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const groups = ['all', ...new Set(services.map(s => s.group))]
  const activeCount = services.filter(s => s.active).length
  const enabledCount = services.filter(s => s.enabled).length
  const failedCount = services.filter(s => !s.active).length
  const filtered = services.filter(s => {
    if (activeTab !== 'all' && s.group !== activeTab) return false
    if (!q) return true
    return `${s.name} ${s.label}`.toLowerCase().includes(q.toLowerCase())
  })
  const { paged, totalPages } = paginate(filtered, page, PAGE_SIZE)
  const bulk = useBulk(paged, s => s.name)
  const bulkAction = async (op) => { for (const n of bulk.selected) await action(n, op); bulk.clear() }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Subsystem / Daemon <span className="text-panel-muted normal-case">systemd</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Systemd Services</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase flex items-center gap-1.5 bg-panel-cardHover text-panel-green">
              <span className="w-1.5 h-1.5 rounded-full bg-panel-green animate-pulse" />
              {activeCount}/{services.length} ACTIVE
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={load}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Units</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{services.length} <span className="text-xs text-panel-muted font-normal">TOTAL</span></p>
          <p className="font-mono text-xs mt-1">
            <span className="text-panel-green font-semibold">{activeCount} ACTIVE</span>
            <span className="text-panel-muted"> / </span>
            <span className="text-panel-red">{failedCount} DOWN</span>
          </p>
          <div className="h-1 bg-panel-cardHover rounded-full overflow-hidden mt-2">
            <div className="h-full bg-panel-green" style={{ width: `${services.length ? (activeCount / services.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Auto-start</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{enabledCount} <span className="text-xs text-panel-muted font-normal">ENABLED</span></p>
          <p className="font-mono text-xs text-panel-muted mt-1">{services.length - enabledCount} manual start</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Groups</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{groups.length - 1}</p>
          <p className="font-mono text-xs text-panel-muted mt-1 truncate">{groups.slice(1, 4).join(' · ')}{groups.length > 4 ? ' …' : ''}</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Attention</p>
          <p className={`font-mono text-2xl font-bold mt-2 ${failedCount ? 'text-panel-red' : 'text-panel-green'}`}>{failedCount}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">{failedCount ? 'units need action' : 'all units healthy'}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border flex-1 max-w-xl">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="grep unit name or label..."
            className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
          <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {groups.map(g => (
            <button key={g} onClick={() => { setActiveTab(g); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs capitalize whitespace-nowrap ${activeTab === g ? 'bg-panel-cardHover text-panel-accent font-semibold' : 'bg-panel-card text-panel-muted hover:text-panel-text border border-panel-border'}`}>
              {g === 'all' ? `All Groups (${services.length})` : `${g} (${services.filter(s => s.group === g).length})`}
            </button>
          ))}
        </div>
      </div>

      {bulk.count > 0 && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[
          { label: 'Start', icon: <Play size={13} />, onClick: () => bulkAction('start') },
          { label: 'Stop', icon: <Square size={13} />, onClick: () => bulkAction('stop') },
          { label: 'Restart', icon: <RotateCcw size={13} />, onClick: () => bulkAction('restart') },
        ]} />
      )}

      <div className="panel-card p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Units Table</span>
          <span className="font-mono text-[11px] text-panel-muted">Showing {paged.length} of {filtered.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left text-[11px] text-panel-muted border-b border-panel-border bg-panel-bg/50 uppercase tracking-wider">
                <th className="px-2 py-2.5"><input type="checkbox" className="accent-panel-accent" checked={paged.length > 0 && paged.every(s => bulk.has(s.name))} onChange={e => bulk.toggleAll(paged.map(s => s.name), e.target.checked)} /></th>
                <th className="px-2 py-2.5 text-center w-10">State</th>
                <th className="px-4 py-2.5 font-medium">Unit / Label</th>
                <th className="px-4 py-2.5 font-medium hidden md:table-cell">Group</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Auto-start</th>
                <th className="px-4 py-2.5 font-medium text-right">Quick Ops</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(svc => {
                const isBusy = busy?.startsWith(`${svc.name}:`)
                const isSel = selected?.name === svc.name
                return (
                  <tr key={svc.name}
                    onClick={() => setSelected(isSel ? null : svc)}
                    className={`border-b border-panel-border/50 cursor-pointer transition-colors ${isSel ? 'bg-panel-accent/10' : 'hover:bg-panel-cardHover/50'}`}>
                    <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="accent-panel-accent" checked={bulk.has(svc.name)} onChange={() => bulk.toggle(svc.name)} />
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className="inline-flex relative items-center justify-center" title={svc.status}>
                        <span className={`w-2.5 h-2.5 rounded-full ${svc.active ? 'bg-panel-green' : svc.status === 'failed' ? 'bg-panel-red' : 'bg-panel-muted'}`} />
                        {svc.active && <span className="absolute w-4 h-4 rounded-full bg-panel-green/20 animate-ping" />}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className={`text-[13px] font-semibold truncate ${isSel ? 'text-panel-accent' : 'text-panel-text'}`}>{svc.label}</p>
                      <p className="text-[11px] text-panel-muted">{svc.name}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${GROUP_COLORS[svc.group] || 'bg-panel-muted/15 text-panel-muted'}`}>{svc.group}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-panel-muted">{svc.status}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1.5 text-xs text-panel-muted">
                        <span className={`w-1.5 h-1.5 rounded-full ${svc.enabled ? 'bg-panel-green' : 'bg-panel-muted'}`} />
                        {svc.enabled ? 'enabled' : 'manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {svc.active
                          ? <button className="btn !px-2 !py-1" title="Stop" disabled={isBusy} onClick={() => action(svc.name, 'stop')}><Square size={13} className="text-panel-red" /></button>
                          : <button className="btn !px-2 !py-1" title="Start" disabled={isBusy} onClick={() => action(svc.name, 'start')}><Play size={13} className="text-panel-green" /></button>}
                        <button className="btn !px-2 !py-1" title="Restart" disabled={isBusy} onClick={() => action(svc.name, 'restart')}><RotateCcw size={13} className={isBusy ? 'animate-spin' : ''} /></button>
                        <button className="btn !px-2 !py-1" title={svc.enabled ? 'Disable auto-start' : 'Enable auto-start'} disabled={isBusy}
                          onClick={() => action(svc.name, svc.enabled ? 'disable' : 'enable')}>
                          <Power size={13} className={svc.enabled ? 'text-panel-green' : 'text-panel-muted'} />
                        </button>
                        <button className="btn !px-2 !py-1" title="Status & logs" onClick={() => { setSelected(svc); setTimeout(() => streamRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50) }}><ScrollText size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {paged.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-panel-muted text-sm font-sans">No units match</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4"><Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
      </div>

      {/* Status + journal detail */}
      {selected && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="panel-card !p-0 overflow-hidden">
            <div className="px-4 py-3 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
              <span className="font-mono text-[13px] font-semibold text-panel-text">systemctl status <span className="text-panel-accent">{selected.name}</span></span>
              <button className="px-2 py-0.5 rounded bg-panel-cardHover text-panel-muted hover:text-panel-text" onClick={() => setSelected(null)}><X size={12} /></button>
            </div>
            <pre className="p-4 font-mono text-[11px] text-panel-text bg-panel-bg overflow-auto max-h-80 whitespace-pre-wrap">{statusOut || '# loading status…'}</pre>
          </div>
          <div className="panel-card !p-0 overflow-hidden">
            <div className="px-4 py-3 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScrollText size={14} className="text-panel-accent" />
                <span className="font-mono text-[13px] font-semibold text-panel-text">Journal tail</span>
                <span className="px-1.5 py-0.5 rounded bg-panel-bg text-panel-accent font-mono text-[11px]">{selected.name}</span>
              </div>
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-panel-green">
                <span className="w-1.5 h-1.5 rounded-full bg-panel-green animate-pulse" /> TAIL -F
              </span>
            </div>
            <div ref={streamRef} className="p-4 font-mono text-[11px] bg-panel-bg overflow-y-auto max-h-80 min-h-60 flex flex-col gap-1 leading-relaxed">
              {journal.length === 0 && <p className="text-panel-muted"># waiting for journal output…</p>}
              {journal.map((line, i) => <JournalLine key={i} line={line} />)}
              <div className="flex items-center gap-1 text-panel-accent pt-0.5">
                <span>&gt;&gt;</span>
                <span className="w-2 h-3.5 bg-panel-accent animate-pulse inline-block" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function JournalLine({ line }) {
  if (line.startsWith('#')) return <div className="text-panel-yellow whitespace-pre-wrap break-all">{line}</div>
  const cls = /fail|error|denied|refus|crit|alert/i.test(line)
    ? 'text-panel-red'
    : /started|active|success|pass|accept/i.test(line)
      ? 'text-panel-green'
      : 'text-panel-muted'
  return <div className={`${cls} whitespace-pre-wrap break-all`}>{line}</div>
}
