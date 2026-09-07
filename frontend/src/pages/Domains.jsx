import { useEffect, useState } from 'react'
import { Globe, Lock, RefreshCw, ArrowLeft, FileCode, Plus, Trash2, Power, Check } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'

export default function Domains() {
  const notify = useNotify()
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = async () => {
    try {
      const s = await api.get('/nginx/sites')
      setSites(s)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = sites.filter(s => {
    if (statusFilter === 'enabled' && !s.enabled) return false
    if (statusFilter === 'disabled' && s.enabled) return false
    if (!q) return true
    return s.name.toLowerCase().includes(q.toLowerCase()) || (s.serverNames || []).join(' ').toLowerCase().includes(q.toLowerCase())
  })
  const { paged, totalPages } = paginate(filtered, page, 8)
  const bulk = useBulk(paged, s => s.name)
  const bulkDelete = async () => { if (!(await notify.confirm(`Delete ${bulk.count} sites?`, { title: 'Delete sites', confirmText: 'Delete' }))) return; for (const n of bulk.selected) try { await api.del(`/nginx/sites/${n}`) } catch {}; await load(); bulk.clear() }
  const bulkToggle = async (action) => { for (const n of bulk.selected) try { await api.post(`/nginx/sites/${n}/${action}`) } catch {}; await load(); bulk.clear() }

  const toggleSite = async (name, action) => {
    try {
      await api.post(`/nginx/sites/${name}/${action}`)
      await load()
      notify.success(action === 'enable' ? 'Site enabled' : 'Site disabled')
    } catch (e) { notify.error(e.message) }
  }

  const delSite = async (name) => {
    try {
      await api.del(`/nginx/sites/${name}`)
      await load()
      notify.success(`Site '${name}' deleted`)
    } catch (e) { notify.error(e.message) }
  }

  const activeSites = sites.filter(s => s.enabled)
  const sslCount = sites.filter(s => s.hasSsl).length

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Network / HTTP <span className="text-panel-muted normal-case">nginx</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Domains</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase bg-panel-cardHover text-panel-green">
              {activeSites.length}/{sites.length} ACTIVE
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={load}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <button className="btn-accent !py-2" onClick={() => setShowCreate(true)}><Plus size={15} /> New Site</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Sites</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{sites.length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">server blocks</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Enabled</p>
          <p className="font-mono text-2xl font-bold text-panel-green mt-2">{activeSites.length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">serving traffic</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">SSL</p>
          <p className="font-mono text-2xl font-bold text-panel-blue mt-2">{sslCount}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">certificates</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Disabled</p>
          <p className="font-mono text-2xl font-bold text-panel-muted mt-2">{sites.length - activeSites.length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">parked</p>
        </div>
      </div>

      {!selected && (
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border flex-1 max-w-xl">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="grep site name or server_name..."
              className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
            <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
          </div>
          <div className="flex items-center gap-1.5">
            {['all', 'enabled', 'disabled'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg font-mono text-xs whitespace-nowrap capitalize ${statusFilter === s ? 'bg-panel-cardHover text-panel-accent font-semibold' : 'bg-panel-card text-panel-muted hover:text-panel-text border border-panel-border'}`}>
                {s === 'all' ? `All (${sites.length})` : s === 'enabled' ? `Enabled (${activeSites.length})` : `Disabled (${sites.length - activeSites.length})`}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="panel-card border-panel-red/40 text-panel-red text-sm">{error}</div>}

      {!selected ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paged.map(site => (
              <div key={site.name} className="panel-card panel-card-hover">
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center"><input type="checkbox" checked={bulk.has(site.name)} onChange={() => bulk.toggle(site.name)} className="accent-panel-accent" /></label>
                  <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setSelected(site)}>
                    <div className="w-10 h-10 rounded-lg bg-panel-blue/15 flex items-center justify-center">
                      <Globe size={20} className="text-panel-blue" />
                    </div>
                    <div>
                      <p className="font-mono font-semibold text-[13px] text-panel-text">{site.name}</p>
                      <p className="text-[11px] text-panel-muted font-mono break-all">{site.serverNames.join(', ') || site.root}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`status-badge ${site.enabled ? 'online' : 'offline'}`}>{site.enabled ? 'Enabled' : 'Disabled'}</span>
                    {site.hasSsl && <span className="status-badge bg-panel-green/15 text-panel-green"><Lock size={10} /> SSL</span>}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-panel-border">
                  <div className="flex gap-1.5">
                    <button className="btn-ghost !px-2 !py-1" onClick={() => setSelected(site)}><FileCode size={14} /></button>
                    <button
                      className={`btn !px-2 !py-1 ${site.enabled ? '!bg-panel-yellow/20 !text-panel-yellow' : '!bg-panel-green/20 !text-panel-green'}`}
                      onClick={() => toggleSite(site.name, site.enabled ? 'disable' : 'enable')}
                      title={site.enabled ? 'Disable' : 'Enable'}
                    ><Power size={14} /></button>
                    <button className="btn !px-2 !py-1 !bg-panel-red/20 !text-panel-red" onClick={() => setConfirmDel(site)} title="Delete"><Trash2 size={14} /></button>
                  </div>
                  <span className="text-xs text-panel-muted font-mono truncate max-w-[40%]">{site.root}</span>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={8} />
          {filtered.length === 0 && !loading && (
            <EmptyState icon={Globe} title="No sites configured" subtitle="Create your first website" />
          )}
        </>
      ) : (
        <div className="panel-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border bg-panel-card">
            <div className="flex items-center gap-3">
              <button className="btn-ghost !px-2 !py-1" onClick={() => setSelected(null)}><ArrowLeft size={16} /></button>
              <span className="font-medium font-mono">{selected.name}</span>
              <span className={`status-badge ${selected.enabled ? 'online' : 'offline'}`}>{selected.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow label="Server names" value={selected.serverNames.join(', ') || '-'} />
              <InfoRow label="Web root" value={selected.root || '-'} />
              <InfoRow label="PHP" value={selected.hasPhp ? 'Enabled' : 'No'} />
              <InfoRow label="SSL" value={selected.hasSsl ? 'Configured' : 'Not configured'} />
            </div>
            <div>
              <p className="text-xs text-panel-muted mb-2">Configuration</p>
              <ViewConfig name={selected.name} />
            </div>
          </div>
        </div>
      )}

      <CreateSiteModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(msg) => { notify.success(msg); load() }} />

      <ConfirmModal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && delSite(confirmDel.name)}
        title="Delete site"
        message={`Delete site '${confirmDel?.name}'? This removes the nginx config. Your web files will be kept.`}
        confirmText="Delete Site"
      />
    </div>
  )
}

function ViewConfig({ name }) {
  const [config, setConfig] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    api.get(`/nginx/config/${name}`).then(res => {
      setConfig(res)
      setLoaded(true)
    }).catch(() => { setConfig(`Unable to load config for ${name}`); setLoaded(true) })
  }, [name])
  if (!loaded) return <div className="h-24 animate-pulse bg-panel-bg rounded-md" />
  return <pre className="p-3 bg-panel-bg border border-panel-border rounded-md text-xs font-mono text-panel-text overflow-x-auto whitespace-pre-wrap">{config}</pre>
}

function InfoRow({ label, value }) {
  return (
    <div className="bg-panel-bg rounded-md p-3 border border-panel-border">
      <p className="text-xs text-panel-muted mb-1">{label}</p>
      <p className="font-medium text-panel-text break-all">{value}</p>
    </div>
  )
}

function CreateSiteModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', serverName: '', php: false, hsts: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!form.name || !form.serverName) return setErr('Name and server name are required')
    setBusy(true); setErr(null)
    try {
      await api.post('/nginx/sites', form)
      onCreated(`Site '${form.name}' created`)
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Website">
      <div className="space-y-4">
        <Field label="Site name">
          <input className="input-field" placeholder="mysite" value={form.name} onChange={e => setForm({ ...form, name: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Domain / Server name">
          <input className="input-field" placeholder="mysite.com" value={form.serverName} onChange={e => setForm({ ...form, serverName: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <ToggleLabel label="PHP support" checked={form.php} onChange={v => setForm({ ...form, php: v })} />
          <ToggleLabel label="HSTS header" checked={form.hsts} onChange={v => setForm({ ...form, hsts: v })} />
        </div>
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">
          Creates <code className="font-mono">/etc/nginx/sites-available/{form.name || '&lt;name&gt;'}</code> with a PHP/static config and enables it. Web root defaults to <code className="font-mono">/var/www/{form.name || '&lt;name&gt;'}</code>.
        </p>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating...' : 'Create Site'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function ToggleLabel({ label, checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center justify-between gap-2 bg-panel-bg rounded-md p-3 border border-panel-border text-sm">
      <span className="text-panel-text">{label}</span>
      <span className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-panel-accent' : 'bg-panel-border'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
