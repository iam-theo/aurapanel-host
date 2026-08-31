import { useEffect, useState } from 'react'
import { Globe, Lock, RefreshCw, ArrowLeft, FileCode, Plus, Trash2, Power, Check } from 'lucide-react'
import { api } from '../lib/api'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'

export default function Domains() {
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [toast, setToast] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const toastMsg = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

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

  const filtered = q ? sites.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || (s.serverNames||[]).join(' ').toLowerCase().includes(q.toLowerCase())) : sites
  const { paged, totalPages } = paginate(filtered, page, 8)
  const bulk = useBulk(paged, s => s.name)
  const bulkDelete = async () => { if (!confirm(`Delete ${bulk.count} sites?`)) return; for (const n of bulk.selected) try { await api.del(`/nginx/sites/${n}`) } catch {}; await load(); bulk.clear() }
  const bulkToggle = async (action) => { for (const n of bulk.selected) try { await api.post(`/nginx/sites/${n}/${action}`) } catch {}; await load(); bulk.clear() }

  const toggleSite = async (name, action) => {
    try {
      await api.post(`/nginx/sites/${name}/${action}`)
      await load()
      toastMsg(action === 'enable' ? 'Site enabled' : 'Site disabled')
    } catch (e) { toastMsg(e.message) }
  }

  const delSite = async (name) => {
    try {
      await api.del(`/nginx/sites/${name}`)
      await load()
      toastMsg(`Site '${name}' deleted`)
    } catch (e) { toastMsg(e.message) }
  }

  return (
    <div className="p-6 space-y-6">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-2xl font-bold">{sites.filter(s => s.enabled).length}<span className="text-panel-muted text-lg">/{sites.length}</span></p>
            <p className="text-xs text-panel-muted">Active sites</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn-accent" onClick={() => setShowCreate(true)}><Plus size={16} /> New Site</button>
        </div>
      </div>

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
                      <p className="font-semibold text-panel-text">{site.name}</p>
                      <p className="text-xs text-panel-muted break-all">{site.serverNames.join(', ') || site.root}</p>
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

      <CreateSiteModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(msg) => { toastMsg(msg); load() }} />

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
