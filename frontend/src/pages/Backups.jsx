import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Trash2, Download, Database, Folder, RotateCcw, Archive } from 'lucide-react'
import { api } from '../lib/api'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'
import { formatBytes } from '../lib/utils'

export default function Backups() {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [confirmRestore, setConfirmRestore] = useState(null)
  const [toast, setToast] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    try {
      const d = await api.get('/backups')
      setBackups(d)
    } catch (e) { toastMsg(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  const filtered = q ? backups.filter(b => b.name.toLowerCase().includes(q.toLowerCase())) : backups
  const { paged, totalPages } = paginate(filtered, page, 9)
  const bulk = useBulk(paged, b => b.name)
  const bulkDelete = async () => { if (!confirm(`Delete ${bulk.count} backups?`)) return; for (const n of bulk.selected) try { await api.del(`/backups/${n}`) } catch {}; await load(); bulk.clear() }

  const del = async (name) => {
    try { await api.del(`/backups/${name}`); await load(); toastMsg('Backup deleted') }
    catch (e) { toastMsg(e.message) }
  }

  const restore = async (b) => {
    try {
      const db = confirmRestore.type === 'database'
      if (db) {
        await api.post('/backups/restore/database', { filename: b.name, database: confirmRestore.targetDb || '', cluster: confirmRestore.cluster })
      } else {
        await api.post('/backups/restore/directory', { filename: b.name, destination: confirmRestore.dest })
      }
      toastMsg('Restore completed')
    } catch (e) { toastMsg(e.message) }
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast msg={toast} />}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold">{backups.length}</p>
          <p className="text-xs text-panel-muted">Backups stored</p>
        </div>
        <div className="flex gap-2 items-center">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Search backups..." className="input-field !py-1.5 text-sm w-44" />
          <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn-accent" onClick={() => setShowCreate(true)}><Plus size={16} /> New Backup</button>
        </div>
      </div>

      {filtered.length > 0 && <div className="flex items-center gap-2 text-xs"><label className="flex items-center gap-2 text-panel-muted"><input type="checkbox" checked={paged.length>0 && paged.every(b => bulk.has(b.name))} onChange={e => bulk.toggleAll(paged.map(b => b.name), e.target.checked)} /> Select page</label><span className="text-panel-muted">• {filtered.length} total</span></div>}
      {bulk.count > 0 && <BulkBar count={bulk.count} onClear={bulk.clear} actions={[{ label: 'Delete', icon: <Trash2 size={13} />, onClick: bulkDelete }]} />}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {paged.map(b => (
          <div key={b.path} className="panel-card panel-card-hover">
            <div className="flex items-start gap-3 mb-3">
              <label className="flex items-center pt-1"><input type="checkbox" checked={bulk.has(b.name)} onChange={() => bulk.toggle(b.name)} /></label>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-lg bg-panel-purple/15 flex items-center justify-center shrink-0">
                  {b.type === 'database' ? <Database size={20} className="text-panel-purple" /> : <Archive size={20} className="text-panel-blue" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-panel-text truncate">{b.name}</p>
                  <p className="text-xs text-panel-muted">{formatBytes(b.size)} • {new Date(b.modified).toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1.5 pt-3 border-t border-panel-border">
              <a href={`/api/backups/download/${b.name}`} className="btn btn-ghost !py-1.5 flex-1"><Download size={14} /> Download</a>
              <button className="btn-ghost !py-1.5" onClick={() => setConfirmRestore({ name: b.name, type: b.type === 'database' ? 'database' : 'directory' })} title="Restore"><RotateCcw size={14} /></button>
              <button className="btn !py-1.5 !bg-panel-red/20 !text-panel-red" onClick={() => setConfirmDel(b)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={9} />

      {filtered.length === 0 && !loading && <EmptyState icon={Archive} title="No backups yet" subtitle="Create your first backup" />}

      <CreateBackupModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(m) => { toastMsg(m); load() }} />
      <ConfirmModal open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && del(confirmDel.name)} title="Delete backup" confirmText="Delete" message={`Delete backup '${confirmDel?.name}'? This cannot be undone.`} />

      {confirmRestore && (
        <RestoreModal backup={confirmRestore} onClose={() => setConfirmRestore(null)} onRestored={(m) => { toastMsg(m) }} />
      )}
    </div>
  )
}

function Toast({ msg }) { if (!msg) return null; return <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">{msg}</div> }

function CreateBackupModal({ open, onClose, onCreated }) {
  const [type, setType] = useState('database')
  const [form, setForm] = useState({ database: '', cluster: '17/main', label: '', source: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (type === 'database' && !form.database) return setErr('Pick a database')
    if (type === 'directory' && !form.source) return setErr('Source path required')
    setBusy(true); setErr(null)
    try {
      if (type === 'database') {
        await api.post('/backups/database', { database: form.database, cluster: form.cluster, label: form.label })
      } else {
        await api.post('/backups/directory', { source: form.source, label: form.label })
      }
      onCreated('Backup created')
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Backup">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button className={`p-3 rounded-md border text-sm flex items-center justify-center gap-2 ${type === 'database' ? 'bg-panel-accent/20 border-panel-accent text-panel-accentLight' : 'bg-panel-bg border-panel-border text-panel-muted'}`} onClick={() => setType('database')}><Database size={15} /> Database</button>
          <button className={`p-3 rounded-md border text-sm flex items-center justify-center gap-2 ${type === 'directory' ? 'bg-panel-accent/20 border-panel-accent text-panel-accentLight' : 'bg-panel-bg border-panel-border text-panel-muted'}`} onClick={() => setType('directory')}><Folder size={15} /> Directory</button>
        </div>

        {type === 'database' ? (
          <>
            <Field label="Database name"><input className="input-field" placeholder="myapp_db" value={form.database} onChange={e => setForm({ ...form, database: e.target.value })} /></Field>
            <Field label="Cluster">
              <select className="input-field" value={form.cluster} onChange={e => setForm({ ...form, cluster: e.target.value })}>
                <option value="17/main">PostgreSQL 17 (5433)</option><option value="14/main">PostgreSQL 14 (5432)</option>
              </select>
            </Field>
          </>
        ) : (
          <Field label="Source directory" hint="Full path to back up"><input className="input-field" placeholder="/var/www/mysite" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></Field>
        )}

        <Field label="Label (optional)"><input className="input-field" placeholder="nightly" value={form.label} onChange={e => setForm({ ...form, label: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} /></Field>

        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">
          Backups are stored in <code className="font-mono">/home/digital-auracle/backups</code>. Database backups require PostgreSQL superuser access.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating...' : 'Create Backup'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function RestoreModal({ backup, onClose, onRestored }) {
  const [targetDb, setTargetDb] = useState('')
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (backup.type === 'database' && !targetDb) return setErr('Target database required')
    if (backup.type === 'directory' && !dest) return setErr('Destination path required')
    setBusy(true); setErr(null)
    try {
      if (backup.type === 'database') {
        await api.post('/backups/restore/database', { filename: backup.name, database: targetDb, cluster: '17/main' })
      } else {
        await api.post('/backups/restore/directory', { filename: backup.name, destination: dest })
      }
      onRestored('Restore completed')
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Restore: ${backup.name}`}>
      <div className="space-y-4">
        {backup.type === 'database' ? (
          <Field label="Restore into database"><input className="input-field" placeholder="target_db" value={targetDb} onChange={e => setTargetDb(e.target.value)} /></Field>
        ) : (
          <Field label="Extract to directory"><input className="input-field" placeholder="/home/digital-auracle/restore" value={dest} onChange={e => setDest(e.target.value)} /></Field>
        )}
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-sm text-panel-yellow bg-panel-yellow/10 rounded-md p-3 border border-panel-yellow/20">This will overwrite existing data. Proceed with caution.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="red" onClick={submit} disabled={busy}>{busy ? 'Restoring...' : 'Restore'}</Button>
        </div>
      </div>
    </Modal>
  )
}
