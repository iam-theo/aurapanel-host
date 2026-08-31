import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, RotateCcw, Trash2, RefreshCw, Plus, Cpu, MemoryStick, GitBranch, Rocket } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes, relativeTime } from '../lib/utils'
import Modal, { Field, Button, ConfirmModal } from '../components/ui.jsx'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const STATUS_STYLES = {
  online: 'bg-panel-green/15 text-panel-green',
  stopped: 'bg-panel-red/15 text-panel-red',
  errored: 'bg-panel-orange/15 text-panel-orange',
  launching: 'bg-panel-yellow/15 text-panel-yellow',
}
const PAGE_SIZE = 6

export default function Applications() {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [toast, setToast] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

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
    if (!q) return apps
    const s = q.toLowerCase()
    return apps.filter(a => a.name.toLowerCase().includes(s) || a.status?.toLowerCase().includes(s))
  }, [apps, q])

  const { paged, totalPages } = paginate(filtered, page, PAGE_SIZE)
  const bulk = useBulk(paged, a => a.name)

  const action = async (name, op) => {
    try {
      await api.post(`/pm2/${name}/${op}`)
      await load()
      toastMsg(`App '${name}' ${op}ed`)
    } catch (e) { toastMsg(e.message) }
  }

  const delApp = async (name) => {
    try {
      await api.post(`/pm2/${name}/delete`)
      await load()
      toastMsg(`App '${name}' deleted`)
    } catch (e) { toastMsg(e.message) }
  }

  const bulkAction = async (op) => {
    for (const name of bulk.selected) await action(name, op)
    bulk.clear()
  }
  const bulkDelete = async () => {
    if (!confirm(`Delete ${bulk.count} selected apps?`)) return
    for (const name of bulk.selected) await delApp(name)
    bulk.clear()
  }

  const onlineCount = apps.filter(a => a.status === 'online').length

  return (
    <div className="p-6 space-y-6">
      {toast && <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">{toast}</div>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-2xl font-bold">{onlineCount}<span className="text-panel-muted text-lg">/{apps.length}</span></p>
          <p className="text-xs text-panel-muted">Applications online</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Search apps..." className="input-field !py-1.5 text-sm w-48" />
          <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn-accent" onClick={() => setShowDeploy(true)}><Rocket size={16} /> Deploy App</button>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-2 text-panel-muted">
            <input type="checkbox" checked={paged.length > 0 && paged.every(a => bulk.has(a.name))} onChange={e => bulk.toggleAll(paged.map(a => a.name), e.target.checked)} /> Select page
          </label>
          <span className="text-panel-muted">• {filtered.length} total</span>
        </div>
      )}

      {bulk.count > 0 && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[
          { label: 'Start', icon: <Play size={13} />, onClick: () => bulkAction('start') },
          { label: 'Stop', icon: <Square size={13} />, onClick: () => bulkAction('stop') },
          { label: 'Restart', icon: <RotateCcw size={13} />, onClick: () => bulkAction('restart') },
          { label: 'Delete', icon: <Trash2 size={13} />, onClick: bulkDelete },
        ]} />
      )}

      {error && <div className="panel-card border-panel-red/40 text-panel-red text-sm">{error}</div>}

      <div className="grid grid-cols-1 gap-3">
        {paged.map(app => {
          const online = app.status === 'online'
          return (
            <div key={app.name} className="panel-card panel-card-hover flex items-center gap-3">
              <input type="checkbox" checked={bulk.has(app.name)} onChange={() => bulk.toggle(app.name)} className="shrink-0" />
              <div className="flex items-center justify-between gap-4 flex-1 cursor-pointer min-w-0" onClick={() => navigate(`/applications/${app.name}`)}>
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${online ? 'bg-panel-green/15' : 'bg-panel-cardHover'}`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-panel-green' : 'bg-panel-muted'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-panel-text truncate">{app.name}</p>
                      <span className={`status-badge px-2 py-0.5 text-[11px] ${STATUS_STYLES[app.status] || 'bg-panel-muted/15 text-panel-muted'}`}>{app.status}</span>
                    </div>
                    <p className="text-xs text-panel-muted truncate mt-0.5">{app.script?.split('/').pop() || app.name} {app.port && `• port ${app.port}`}</p>
                  </div>
                </div>

                <div className="hidden md:flex items-center gap-6 text-sm">
                  <div className="text-center"><p className="flex items-center gap-1 text-panel-muted text-xs"><Cpu size={12} /> CPU</p><p className="font-medium">{app.cpu?.toFixed?.(1) || '0'}%</p></div>
                  <div className="text-center"><p className="flex items-center gap-1 text-panel-muted text-xs"><MemoryStick size={12} /> Memory</p><p className="font-medium">{formatBytes(app.memory)}</p></div>
                  <div className="text-center"><p className="text-panel-muted text-xs">Uptime</p><p className="font-medium">{relativeTime(app.uptime)}</p></div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {online
                  ? <button className="btn !px-3 !py-1.5 !bg-panel-red/20 !text-panel-red" onClick={() => action(app.name, 'stop')} title="Stop"><Square size={14} /></button>
                  : <button className="btn !px-3 !py-1.5 !bg-panel-green/20 !text-panel-green" onClick={() => action(app.name, 'start')} title="Start"><Play size={14} /></button>}
                <button className="btn-ghost !px-3 !py-1.5" onClick={() => action(app.name, 'restart')} title="Restart"><RotateCcw size={14} /></button>
                <button className="btn-ghost !px-3 !py-1.5 !bg-panel-red/10 !text-panel-red" onClick={() => setConfirmDel(app)} title="Delete"><Trash2 size={14} /></button>
              </div>
            </div>
          )
        })}
        {paged.length === 0 && !loading && (
          <div className="text-center py-16 text-panel-muted panel-card"><p className="text-lg">No applications</p><p className="text-sm mt-1">{q ? `No match for "${q}"` : 'Deploy your first app'}</p></div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} />

      <DeployModal open={showDeploy} onClose={() => setShowDeploy(false)} onDeployed={(m) => { toastMsg(m); load() }} />
      <ConfirmModal
        open={!!confirmDel} onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && delApp(confirmDel.name)}
        title="Delete application" confirmText="Delete"
        message={`Delete '${confirmDel?.name}'? The PM2 process and its directory (if in /home/digital-auracle/apps) will be removed.`} />
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
          App is created under <code className="font-mono">/home/digital-auracle/apps/{form.name || '&lt;name&gt;'}</code> and started via PM2 in cluster mode.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Deploying...' : 'Deploy'}</Button>
        </div>
      </div>
    </Modal>
  )
}
