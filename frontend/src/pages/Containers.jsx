import { useEffect, useState } from 'react'
import { Play, Square, RotateCcw, Trash2, RefreshCw, Box, Image as ImageIcon, Network, Database as DbIcon, Plus, FileCode2 } from 'lucide-react'
import { api } from '../lib/api'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'

const TABS = [
  { id: 'containers', label: 'Containers', icon: Box },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'networks', label: 'Networks', icon: Network },
  { id: 'volumes', label: 'Volumes', icon: DbIcon },
]

export default function Containers() {
  const [tab, setTab] = useState('containers')
  const [containers, setContainers] = useState([])
  const [images, setImages] = useState([])
  const [networks, setNetworks] = useState([])
  const [volumes, setVolumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedLogs, setSelectedLogs] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [toast, setToast] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    try {
      const [c, i, n, v] = await Promise.all([
        api.get('/docker/containers'), api.get('/docker/images'),
        api.get('/docker/networks'), api.get('/docker/volumes'),
      ])
      setContainers(c); setImages(i); setNetworks(n); setVolumes(v)
    } catch (e) { toastMsg(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])

  const action = async (id, op) => {
    try {
      await api.post(`/docker/containers/${id}/${op}`)
      await load(); toastMsg(`Container ${op}ed`)
    } catch (e) { toastMsg(e.message) }
  }

  const filtered = q ? containers.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || c.image.toLowerCase().includes(q.toLowerCase())) : containers
  const { paged: pagedContainers, totalPages } = paginate(filtered, page, 8)
  const bulk = useBulk(pagedContainers, c => c.id)
  const bulkAction = async (op) => { for (const id of bulk.selected) { try { await api.post(`/docker/containers/${id}/${op}`) } catch {} } await load(); bulk.clear() }
  const bulkDelete = async () => { if (!confirm(`Delete ${bulk.count} containers?`)) return; for (const id of bulk.selected) { try { await api.del(`/docker/containers/${id}?force=true`) } catch {} } await load(); bulk.clear() }

  const delContainer = async (id) => {
    try {
      await api.del(`/docker/containers/${id}?force=true`)
      await load(); toastMsg('Container removed')
    } catch (e) { toastMsg(e.message) }
  }

  const viewLogs = async (id) => {
    try {
      const d = await api.get(`/docker/containers/${id}/logs?lines=150`)
      setSelectedLogs({ id, logs: d.logs })
    } catch (e) { toastMsg(e.message) }
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">{toast}</div>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-panel-card p-1 rounded-lg border border-panel-border">
          {TABS.map(t => (
            <button key={t.id}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm ${tab === t.id ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text'}`}
              onClick={() => setTab(t.id)}>
              <t.icon size={15} /> {t.label}
              <span className="text-xs opacity-70">{t.id === 'containers' ? containers.length : t.id === 'images' ? images.length : t.id === 'networks' ? networks.length : volumes.length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Search containers..." className="input-field !py-1.5 text-sm w-44" />
          <button className="btn-ghost" onClick={() => setShowCompose(true)}><FileCode2 size={16} /> Compose</button>
          <button className="btn-accent" onClick={() => setShowCreate(true)}><Plus size={16} /> New Container</button>
        </div>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
                <th className="px-2 py-3"><input type="checkbox" checked={pagedContainers.length>0 && pagedContainers.every(c => bulk.has(c.id))} onChange={e => bulk.toggleAll(pagedContainers.map(c => c.id), e.target.checked)} /></th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Image</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Ports</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedContainers.map(c => {
                const running = c.state === 'running'
                return (
                  <tr key={c.id} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50">
                    <td className="px-2 py-3"><input type="checkbox" checked={bulk.has(c.id)} onChange={() => bulk.toggle(c.id)} /></td>
                    <td className="px-4 py-3 font-medium"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${running ? 'bg-panel-green' : 'bg-panel-red'}`} />{c.name}<span className="text-xs text-panel-muted font-mono hidden sm:inline">{c.id?.slice(0, 12)}</span></div></td>
                    <td className="px-4 py-3 text-xs text-panel-muted font-mono">{c.image}</td>
                    <td className="px-4 py-3"><span className={`status-badge ${running ? 'online' : 'offline'}`}>{c.state}</span></td>
                    <td className="px-4 py-3 text-xs text-panel-muted font-mono max-w-[200px] truncate hidden md:table-cell">{c.ports}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {running
                          ? <button className="btn !px-2 !py-1" onClick={() => action(c.id, 'stop')}><Square size={13} className="text-panel-red" /></button>
                          : <button className="btn !px-2 !py-1" onClick={() => action(c.id, 'start')}><Play size={13} className="text-panel-green" /></button>}
                        <button className="btn !px-2 !py-1" onClick={() => action(c.id, 'restart')}><RotateCcw size={13} /></button>
                        <button className="btn !px-2 !py-1" onClick={() => viewLogs(c.id)}><RefreshCw size={13} /></button>
                        <button className="btn !px-2 !py-1" onClick={() => setConfirmDel(c)}><Trash2 size={13} className="text-panel-red" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4"><Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={8} /></div>
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
                  <td className="px-4 py-3 text-xs text-panel-muted">{img.size}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted">{img.created}</td>
                  <td className="px-4 py-3 text-right"><button className="btn !px-2 !py-1 !bg-panel-red/20 !text-panel-red" onClick={async () => { try { await api.del(`/docker/images/${img.id}`); toastMsg('Image removed'); load() } catch (e) { toastMsg(e.message) } }}><Trash2 size={13} /></button></td>
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
              <th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">{tab === 'networks' ? 'Driver' : 'Type'}</th><th className="px-4 py-3 font-medium">Details</th>
            </tr></thead>
            <tbody>
              {(tab === 'networks' ? networks : volumes).map((item, i) => (
                <tr key={i} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted">{item.driver}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted">{item.internal !== undefined ? (item.internal ? 'Internal' : 'External') : 'local'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSelectedLogs(null)} />
          <div className="relative w-full max-w-3xl bg-panel-card border border-panel-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
              <span className="font-medium font-mono text-sm">Container logs: {selectedLogs.id}</span>
              <button className="btn-ghost !px-2 !py-1" onClick={() => setSelectedLogs(null)}>Close</button>
            </div>
            <pre className="p-4 text-xs font-mono text-panel-text bg-panel-bg overflow-x-auto max-h-[70vh] whitespace-pre-wrap">{selectedLogs.logs}</pre>
          </div>
        </div>
      )}

      <CreateContainerModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(m) => { toastMsg(m); load() }} images={images} networks={networks} />
      <ComposeModal open={showCompose} onClose={() => setShowCompose(false)} onCreated={(m) => { toastMsg(m); load() }} />
      <ConfirmModal open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && delContainer(confirmDel.id)} title="Remove container" confirmText="Remove" message={`Force-remove container '${confirmDel?.name}'?`} />
    </div>
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
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">Saved to <code className="font-mono">/home/digital-auracle/compose/{name || '&lt;name&gt;'}/docker-compose.yml</code> and run with <code className="font-mono">docker compose up -d</code>.</p>
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
