import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, RotateCcw, Trash2, RefreshCw, Rocket, ChevronRight, GitBranch } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import { formatBytes, relativeTime } from '../lib/utils'
import Modal, { Field, Button, ConfirmModal } from '../components/ui.jsx'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const STATUS_DOT = {
  online: 'bg-panel-green',
  stopped: 'bg-panel-muted',
  errored: 'bg-panel-red',
  launching: 'bg-panel-yellow',
}
const PAGE_SIZE = 9

export default function Applications() {
  const notify = useNotify()
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const navigate = useNavigate()

  const load = async () => {
    try {
      const d = await api.get('/pm2')
      setApps(d)
      setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])

  const filtered = useMemo(() => {
    return apps.filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      if (!q) return true
      const s = q.toLowerCase()
      return a.name.toLowerCase().includes(s) || a.status?.toLowerCase().includes(s)
    })
  }, [apps, q, statusFilter])

  const { paged, totalPages } = paginate(filtered, page, PAGE_SIZE)
  const bulk = useBulk(paged, a => a.name)

  const action = async (name, op) => {
    try {
      await api.post(`/pm2/${name}/${op}`)
      await load()
      notify.success(`App '${name}' ${op}ed`)
    } catch (e) { notify.error(e.message) }
  }

  const delApp = async (name) => {
    try {
      await api.post(`/pm2/${name}/delete`)
      await load()
      notify.success(`App '${name}' deleted`)
    } catch (e) { notify.error(e.message) }
  }

  const bulkAction = async (op) => {
    for (const name of bulk.selected) await action(name, op)
    bulk.clear()
  }
  const bulkDelete = async () => {
    if (!(await notify.confirm(`Delete ${bulk.count} selected apps?`, { title: 'Delete apps', confirmText: 'Delete' }))) return
    for (const name of bulk.selected) await delApp(name)
    bulk.clear()
  }

  const onlineCount = apps.filter(a => a.status === 'online').length
  const stoppedCount = apps.filter(a => a.status === 'stopped').length
  const totalMem = apps.reduce((a, x) => a + (x.memory || 0), 0)
  const totalRestarts = apps.reduce((a, x) => a + (x.restarts || 0), 0)
  const statuses = ['all', ...new Set(apps.map(a => a.status).filter(Boolean))]

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Runtime / Worker <span className="text-panel-muted normal-case">pm2</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Applications</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase flex items-center gap-1.5 bg-panel-cardHover text-panel-green">
              <span className="w-1.5 h-1.5 rounded-full bg-panel-green animate-pulse" />
              {onlineCount}/{apps.length} ONLINE
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={load}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="btn-accent !py-2" onClick={() => setShowDeploy(true)}><Rocket size={15} /> Deploy App</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Apps</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{apps.length} <span className="text-xs text-panel-muted font-normal">TOTAL</span></p>
          <p className="font-mono text-xs mt-1">
            <span className="text-panel-green font-semibold">{onlineCount} UP</span>
            <span className="text-panel-muted"> / </span>
            <span className="text-panel-red">{stoppedCount} DOWN</span>
          </p>
          <div className="h-1 bg-panel-cardHover rounded-full overflow-hidden mt-2">
            <div className="h-full bg-panel-green" style={{ width: `${apps.length ? (onlineCount / apps.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Memory</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{formatBytes(totalMem).split(' ')[0]} <span className="text-xs text-panel-muted font-normal">{formatBytes(totalMem).split(' ')[1] || ''}</span></p>
          <p className="font-mono text-xs text-panel-muted mt-1">across all apps</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Restarts</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{totalRestarts}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">cumulative</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Attention</p>
          <p className={`font-mono text-2xl font-bold mt-2 ${apps.length - onlineCount ? 'text-panel-red' : 'text-panel-green'}`}>{apps.length - onlineCount}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">{apps.length - onlineCount ? 'apps not online' : 'fleet healthy'}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border flex-1 max-w-xl">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="grep app name or status..."
            className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
          <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {statuses.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs whitespace-nowrap capitalize ${statusFilter === s ? 'bg-panel-cardHover text-panel-accent font-semibold' : 'bg-panel-card text-panel-muted hover:text-panel-text border border-panel-border'}`}>
              {s === 'all' ? `All (${apps.length})` : `${s} (${apps.filter(a => a.status === s).length})`}
            </button>
          ))}
        </div>
      </div>

      {bulk.count > 0 && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[
          { label: 'Start', icon: <Play size={13} />, onClick: () => bulkAction('start') },
          { label: 'Stop', icon: <Square size={13} />, onClick: () => bulkAction('stop') },
          { label: 'Restart', icon: <RotateCcw size={13} />, onClick: () => bulkAction('restart') },
          { label: 'Delete', icon: <Trash2 size={13} />, onClick: bulkDelete },
        ]} />
      )}

      {error && <div className="panel-card border-panel-red/40 text-panel-red text-sm">{error}</div>}

      <div className="panel-card p-0 overflow-hidden">
        <div className="px-4 py-2.5 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Apps Table</span>
          <span className="font-mono text-[11px] text-panel-muted">Showing {paged.length} of {filtered.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-left text-[11px] text-panel-muted border-b border-panel-border bg-panel-bg/50 uppercase tracking-wider">
                <th className="px-2 py-2.5"><input type="checkbox" className="accent-panel-accent" checked={paged.length > 0 && paged.every(a => bulk.has(a.name))} onChange={e => bulk.toggleAll(paged.map(a => a.name), e.target.checked)} /></th>
                <th className="px-2 py-2.5 text-center w-10">State</th>
                <th className="px-4 py-2.5 font-medium">App / Entry</th>
                <th className="px-4 py-2.5 font-medium w-28">CPU %</th>
                <th className="px-4 py-2.5 font-medium hidden md:table-cell">Memory</th>
                <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Uptime</th>
                <th className="px-4 py-2.5 font-medium hidden xl:table-cell">Restarts</th>
                <th className="px-4 py-2.5 font-medium text-right">Quick Ops</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(app => {
                const online = app.status === 'online'
                return (
                  <tr key={app.name}
                    onClick={() => navigate(`/applications/${app.name}`)}
                    className="border-b border-panel-border/50 cursor-pointer hover:bg-panel-cardHover/50 transition-colors">
                    <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="accent-panel-accent" checked={bulk.has(app.name)} onChange={() => bulk.toggle(app.name)} />
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className="inline-flex relative items-center justify-center" title={app.status}>
                        <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[app.status] || 'bg-panel-muted'}`} />
                        {online && <span className="absolute w-4 h-4 rounded-full bg-panel-green/20 animate-ping" />}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-semibold text-panel-text truncate">{app.name}</p>
                      <p className="text-[11px] text-panel-muted truncate">{app.script?.split('/').pop() || app.name}{app.port ? ` · :${app.port}` : ''} · {app.status}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-panel-cardHover rounded-full overflow-hidden">
                          <div className="h-full bg-panel-blue rounded-full" style={{ width: `${Math.min(app.cpu || 0, 100)}%` }} />
                        </div>
                        <span className="text-xs text-panel-text">{app.cpu?.toFixed?.(1) || '0'}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-panel-muted hidden md:table-cell">{formatBytes(app.memory)}</td>
                    <td className="px-4 py-3 text-xs text-panel-muted hidden lg:table-cell whitespace-nowrap">{relativeTime(app.uptime)}</td>
                    <td className="px-4 py-3 text-xs text-panel-muted hidden xl:table-cell">{app.restarts ?? '—'}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {online
                          ? <button className="btn !px-2 !py-1" title="Stop" onClick={() => action(app.name, 'stop')}><Square size={13} className="text-panel-red" /></button>
                          : <button className="btn !px-2 !py-1" title="Start" onClick={() => action(app.name, 'start')}><Play size={13} className="text-panel-green" /></button>}
                        <button className="btn !px-2 !py-1" title="Restart" onClick={() => action(app.name, 'restart')}><RotateCcw size={13} /></button>
                        <button className="btn !px-2 !py-1" title="Open detail" onClick={() => navigate(`/applications/${app.name}`)}><ChevronRight size={13} /></button>
                        <button className="btn !px-2 !py-1" title="Delete" onClick={() => setConfirmDel(app)}><Trash2 size={13} className="text-panel-red" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {paged.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-panel-muted text-sm font-sans">
                  {loading ? 'Loading…' : q ? `No match for "${q}"` : 'No applications — deploy your first app'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4"><Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
      </div>

      <DeployModal open={showDeploy} onClose={() => setShowDeploy(false)} onDeployed={(m) => { notify.success(m); load() }} />
      <ConfirmModal
        open={!!confirmDel} onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && delApp(confirmDel.name)}
        title="Delete application" confirmText="Delete"
        message={`Delete '${confirmDel?.name}'? The PM2 process and its directory (if in /root/apps) will be removed.`} />
    </div>
  )
}

function DeployModal({ open, onClose, onDeployed }) {
  const [mode, setMode] = useState('blank')
  const [form, setForm] = useState({ name: '', port: '', gitRepo: '', branch: '', entry: 'index.js', env: '', instances: 1 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!form.name) return setErr('App name required')
    if (!form.port || isNaN(form.port)) return setErr('Valid port required')
    if (mode === 'git' && !form.gitRepo) return setErr('Git repository URL required')
    setBusy(true); setErr(null)
    try {
      const body = {
        name: form.name,
        type: 'node',
        entry: mode === 'git' ? (form.entry || 'index.js') : 'index.js',
        port: Number(form.port),
        instances: Number(form.instances) || 1,
        ...(mode === 'git' ? { gitRepo: form.gitRepo, branch: form.branch } : {}),
      }
      if (mode === 'git' && form.entry) body.entry = form.entry
      await api.post('/pm2', body)
      onDeployed(`App '${form.name}' deployed to port ${form.port}`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Deploy New Application">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button className={`p-3 rounded-md border text-sm flex items-center justify-center gap-2 transition-colors ${mode === 'blank' ? 'bg-panel-accent/20 border-panel-accent text-panel-accentLight' : 'bg-panel-bg border-panel-border text-panel-muted'}`} onClick={() => setMode('blank')}><Rocket size={15} /> New Node app</button>
          <button className={`p-3 rounded-md border text-sm flex items-center justify-center gap-2 transition-colors ${mode === 'git' ? 'bg-panel-accent/20 border-panel-accent text-panel-accentLight' : 'bg-panel-bg border-panel-border text-panel-muted'}`} onClick={() => setMode('git')}><GitBranch size={15} /> Clone from Git</button>
        </div>

        <Field label="Application name"><input className="input-field" placeholder="myapp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Port"><input className="input-field" placeholder="3000" value={form.port} onChange={e => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Instances"><select className="input-field" value={form.instances} onChange={e => setForm({ ...form, instances: e.target.value })}><option value={1}>1</option><option value={2}>2</option><option value={4}>4</option></select></Field>
        </div>

        {mode === 'git' && (
          <>
            <Field label="Git repository URL"><input className="input-field" placeholder="https://github.com/user/repo.git" value={form.gitRepo} onChange={e => setForm({ ...form, gitRepo: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Branch"><input className="input-field" placeholder="main" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} /></Field>
              <Field label="Entry file"><input className="input-field" placeholder="index.js" value={form.entry} onChange={e => setForm({ ...form, entry: e.target.value })} /></Field>
            </div>
          </>
        )}

        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">
          App is created under <code className="font-mono">/root/apps/{form.name || '&lt;name&gt;'}</code> and started via PM2 in cluster mode.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Deploying...' : 'Deploy'}</Button>
        </div>
      </div>
    </Modal>
  )
}
