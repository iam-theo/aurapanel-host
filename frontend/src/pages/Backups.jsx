import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Trash2, Download, Database, Folder, RotateCcw, Archive } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'
import { formatBytes } from '../lib/utils'

export default function Backups() {
  const notify = useNotify()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [confirmRestore, setConfirmRestore] = useState(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const load = async () => {
    try {
      const d = await api.get('/backups')
      setBackups(d)
    } catch (e) { notify.error(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  const filtered = backups.filter(b => {
    if (typeFilter !== 'all' && b.type !== typeFilter) return false
    if (!q) return true
    return b.name.toLowerCase().includes(q.toLowerCase())
  })
  const { paged, totalPages } = paginate(filtered, page, 9)
  const bulk = useBulk(paged, b => b.name)
  const bulkDelete = async () => { if (!(await notify.confirm(`Delete ${bulk.count} backups?`, { title: 'Delete backups', confirmText: 'Delete' }))) return; for (const n of bulk.selected) try { await api.del(`/backups/${n}`) } catch {}; await load(); bulk.clear() }

  const del = async (name) => {
    try { await api.del(`/backups/${name}`); await load(); notify.success('Backup deleted') }
    catch (e) { notify.error(e.message) }
  }

  const restore = async (b) => {
    try {
      const db = confirmRestore.type === 'database'
      if (db) {
        await api.post('/backups/restore/database', { filename: b.name, database: confirmRestore.targetDb || '', cluster: confirmRestore.cluster })
      } else {
        await api.post('/backups/restore/directory', { filename: b.name, destination: confirmRestore.dest })
      }
      notify.success('Restore completed')
    } catch (e) { notify.error(e.message) }
  }

  const totalBytes = backups.reduce((a, b) => a + (b.size || 0), 0)
  const dbCount = backups.filter(b => b.type === 'database').length
  const types = ['all', ...new Set(backups.map(b => b.type).filter(Boolean))]

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Data / Snapshots <span className="text-panel-muted normal-case">retention vault</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Backups</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase bg-panel-cardHover text-panel-green">
              {backups.length} STORED
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={load}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <button className="btn-accent !py-2" onClick={() => setShowCreate(true)}><Plus size={15} /> New Backup</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Archives</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{backups.length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">{formatBytes(totalBytes)} stored</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Database</p>
          <p className="font-mono text-2xl font-bold text-panel-purple mt-2">{dbCount}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">dumps</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Directory</p>
          <p className="font-mono text-2xl font-bold text-panel-blue mt-2">{backups.length - dbCount}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">tarballs</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Footprint</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{formatBytes(totalBytes).split(' ')[0]} <span className="text-xs text-panel-muted font-normal">{formatBytes(totalBytes).split(' ')[1] || ''}</span></p>
          <p className="font-mono text-xs text-panel-muted mt-1">on disk</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border flex-1 max-w-xl">
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="grep backup name..."
            className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
          <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {types.map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs whitespace-nowrap capitalize ${typeFilter === t ? 'bg-panel-cardHover text-panel-accent font-semibold' : 'bg-panel-card text-panel-muted hover:text-panel-text border border-panel-border'}`}>
              {t === 'all' ? `All (${backups.length})` : `${t} (${backups.filter(b => b.type === t).length})`}
            </button>
          ))}
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
                  <p className="font-mono font-semibold text-[13px] text-panel-text truncate">{b.name}</p>
                  <p className="text-[11px] text-panel-muted font-mono">{formatBytes(b.size)} • {new Date(b.modified).toLocaleString()}</p>
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

      <CreateBackupModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(m) => { notify.success(m); load() }} />
      <ConfirmModal open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && del(confirmDel.name)} title="Delete backup" confirmText="Delete" message={`Delete backup '${confirmDel?.name}'? This cannot be undone.`} />

      {confirmRestore && (
        <RestoreModal backup={confirmRestore} onClose={() => setConfirmRestore(null)} onRestored={(m) => { notify.success(m) }} />
      )}
    </div>
  )
}

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
          Backups are stored in <code className="font-mono">/root/backups</code>. Database backups require PostgreSQL superuser access.
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
          <Field label="Extract to directory"><input className="input-field" placeholder="/root/restore" value={dest} onChange={e => setDest(e.target.value)} /></Field>
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
