import { useEffect, useState } from 'react'
import { RefreshCw, Cpu, OctagonX, Ban, X } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import { formatBytes } from '../lib/utils'

const PAGE_NOTE = 'top 25 by CPU'

export default function Processes() {
  const notify = useNotify()
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [killing, setKilling] = useState(null)

  const load = async () => {
    try {
      const d = await api.get('/system/processes')
      setData(d)
    } catch (e) {
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  const list = data?.list || []
  const states = ['all', ...new Set(list.map(p => p.state).filter(Boolean))]
  const filtered = list.filter(p => {
    if (stateFilter !== 'all' && p.state !== stateFilter) return false
    if (!filter) return true
    return `${p.name} ${p.pid} ${p.command || ''}`.toLowerCase().includes(filter.toLowerCase())
  })
  const topCpu = list.length ? [...list].sort((a, b) => b.cpu - a.cpu)[0] : null

  const kill = async (pid, signal) => {
    const label = signal === 'KILL' ? 'SIGKILL' : 'SIGTERM'
    if (!(await notify.confirm(`Send ${label} to PID ${pid}?`, { title: `${label} process`, confirmText: label }))) return
    setKilling(pid)
    try {
      await api.post(`/system/processes/${pid}/kill?signal=${signal}`)
      notify.success(`${label} sent to ${pid}`)
      if (selected?.pid === pid) setSelected(null)
      setTimeout(load, 800)
    } catch (e) { notify.error(e.message) } finally { setKilling(null) }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Subsystem / Kernel <span className="text-panel-muted normal-case">/proc</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Processes</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase bg-panel-cardHover text-panel-green">
              {data?.total || 0} TOTAL
            </span>
          </div>
        </div>
        <button className="btn-ghost !py-2 font-mono text-xs" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Total</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{data?.total || 0}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">{PAGE_NOTE}</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Running</p>
          <p className="font-mono text-2xl font-bold text-panel-green mt-2">{data?.running || 0}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">active now</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Sleeping</p>
          <p className="font-mono text-2xl font-bold text-panel-yellow mt-2">{data?.sleeping || 0}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">waiting</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Top CPU</p>
          <p className="font-mono text-2xl font-bold text-panel-accent mt-2 truncate">{topCpu ? `${topCpu.cpu.toFixed(1)}%` : '—'}</p>
          <p className="font-mono text-xs text-panel-muted mt-1 truncate">{topCpu ? `${topCpu.name} · ${topCpu.pid}` : '—'}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border flex-1 max-w-xl">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="grep name, pid, or command..."
            className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
          <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {states.map(s => (
            <button key={s} onClick={() => setStateFilter(s)}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs whitespace-nowrap capitalize ${stateFilter === s ? 'bg-panel-cardHover text-panel-accent font-semibold' : 'bg-panel-card text-panel-muted hover:text-panel-text border border-panel-border'}`}>
              {s === 'all' ? `All (${list.length})` : `${s} (${list.filter(p => p.state === s).length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-card p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Process Table</span>
          <span className="font-mono text-[11px] text-panel-muted">Showing {filtered.length} of {list.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left text-[11px] text-panel-muted border-b border-panel-border bg-panel-bg/50 uppercase tracking-wider">
                <th className="px-2 py-2.5 text-center w-10">State</th>
                <th className="px-4 py-2.5 font-medium">PID / User</th>
                <th className="px-4 py-2.5 font-medium">Command</th>
                <th className="px-4 py-2.5 font-medium w-40">CPU %</th>
                <th className="px-4 py-2.5 font-medium">Mem</th>
                <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Started</th>
                <th className="px-4 py-2.5 font-medium text-right">Quick Ops</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const isSel = selected?.pid === p.pid
                return (
                  <tr key={p.pid}
                    onClick={() => setSelected(isSel ? null : p)}
                    className={`border-b border-panel-border/50 cursor-pointer transition-colors ${isSel ? 'bg-panel-accent/10' : 'hover:bg-panel-cardHover/50'}`}>
                    <td className="px-2 py-2.5 text-center">
                      <span className="inline-flex items-center justify-center" title={p.state}>
                        <span className={`w-2.5 h-2.5 rounded-full ${p.state === 'running' ? 'bg-panel-green' : p.state === 'sleeping' ? 'bg-panel-yellow' : 'bg-panel-muted'}`} />
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-xs font-semibold ${isSel ? 'text-panel-accent' : 'text-panel-text'}`}>{p.pid}</p>
                      <p className="text-[11px] text-panel-muted truncate max-w-[120px]">{p.user}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-xs text-panel-text font-semibold truncate max-w-[200px]">{p.name}</p>
                      <p className="text-[11px] text-panel-muted truncate max-w-[320px]">{p.command}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-panel-cardHover rounded-full overflow-hidden">
                          <div className="h-full bg-panel-blue rounded-full" style={{ width: `${Math.min(p.cpu, 100)}%` }} />
                        </div>
                        <span className="text-xs text-panel-text">{p.cpu.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-panel-muted">{formatBytes((p.mem || 0) * 1024 * 1024)}</td>
                    <td className="px-4 py-2.5 text-xs text-panel-muted hidden lg:table-cell whitespace-nowrap">{p.started || '—'}</td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button className="btn !px-2 !py-1" title="SIGTERM" disabled={killing === p.pid} onClick={() => kill(p.pid, 'TERM')}><Ban size={13} /></button>
                        <button className="btn !px-2 !py-1" title="SIGKILL" disabled={killing === p.pid} onClick={() => kill(p.pid, 'KILL')}><OctagonX size={13} className="text-panel-red" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-panel-muted text-sm font-sans">No processes match</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail context */}
      {selected && (
        <div className="panel-card">
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-[13px] font-semibold text-panel-text">
              PID <span className="text-panel-accent">{selected.pid}</span> <span className="text-panel-muted">· {selected.name}</span>
            </span>
            <button className="px-2 py-0.5 rounded bg-panel-cardHover text-panel-muted hover:text-panel-text" onClick={() => setSelected(null)}><X size={12} /></button>
          </div>
          <pre className="p-3 bg-panel-bg border border-panel-border/50 rounded-lg text-[11px] font-mono text-panel-text overflow-x-auto whitespace-pre-wrap break-all">{selected.command || selected.name}</pre>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 font-mono text-xs">
            {[['User', selected.user], ['State', selected.state], ['Started', selected.started || '—'],
              ['CPU', `${selected.cpu.toFixed(1)}%`], ['Mem', formatBytes((selected.mem || 0) * 1024 * 1024)]].map(([k, v]) => (
              <div key={k} className="p-2.5 rounded-lg bg-panel-bg border border-panel-border/50">
                <p className="text-[10px] uppercase text-panel-muted">{k}</p>
                <p className="text-panel-text font-semibold mt-1 truncate">{v}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ghost !py-1.5 text-xs" disabled={killing === selected.pid} onClick={() => kill(selected.pid, 'TERM')}>
              <Ban size={13} /> SIGTERM
            </button>
            <button className="btn-ghost !py-1.5 text-xs !text-panel-red" disabled={killing === selected.pid} onClick={() => kill(selected.pid, 'KILL')}>
              <OctagonX size={13} /> SIGKILL
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
