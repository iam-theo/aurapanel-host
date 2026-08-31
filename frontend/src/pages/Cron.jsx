import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Trash2, Play, Clock } from 'lucide-react'
import { api } from '../lib/api'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'

const PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Sun midnight)', value: '0 0 * * 0' },
  { label: 'Monthly (1st, midnight)', value: '0 0 1 * *' },
]

export default function Cron() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [toast, setToast] = useState(null)
  const [page, setPage] = useState(1)

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    try {
      const d = await api.get('/cron')
      setJobs(d.jobs)
    } catch (e) { toastMsg(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const { paged, totalPages } = paginate(jobs, page, 8)
  const bulk = useBulk(paged, j => j.id)
  const bulkDelete = async () => { if (!confirm(`Delete ${bulk.count} jobs?`)) return; for (const id of bulk.selected) try { await api.del(`/cron/${id}`) } catch {}; await load(); bulk.clear() }

  const del = async (id) => {
    try { await api.del(`/cron/${id}`); await load(); toastMsg('Cron job deleted') }
    catch (e) { toastMsg(e.message) }
  }

  const run = async (id) => {
    try {
      const d = await api.post(`/cron/${id}/run`)
      toastMsg(d.output?.split('\n').slice(-3).join(' '))
    } catch (e) { toastMsg(e.message) }
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm max-w-md">{toast}</div>}

      {bulk.count > 0 && <BulkBar count={bulk.count} onClear={bulk.clear} actions={[{ label: 'Delete', icon: <Trash2 size={13} />, onClick: bulkDelete }]} />}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold">{jobs.length}</p>
          <p className="text-xs text-panel-muted">Cron jobs</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn-accent" onClick={() => setShowCreate(true)}><Plus size={16} /> New Job</button>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="panel-card space-y-2">
          <p className="text-xs text-panel-muted mb-3">Crontab for <code className="font-mono">digital-auracle</code> • {jobs.length} jobs</p>
          <label className="flex items-center gap-2 text-xs text-panel-muted mb-2"><input type="checkbox" checked={paged.length>0 && paged.every(j => bulk.has(j.id))} onChange={e => bulk.toggleAll(paged.map(j => j.id), e.target.checked)} /> Select page</label>
          {paged.map(job => (
            <div key={job.id} className="flex items-center justify-between gap-4 bg-panel-bg rounded-md p-3 border border-panel-border group">
              <label className="flex items-center"><input type="checkbox" checked={bulk.has(job.id)} onChange={() => bulk.toggle(job.id)} /></label>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-xs text-panel-accentLight bg-panel-accent/10 px-2 py-0.5 rounded">{job.minute} {job.hour} {job.dayOfMonth} {job.month} {job.dayOfWeek}</span>
                <p className="text-sm text-panel-text font-mono truncate mt-2">{job.command}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button className="btn !px-2 !py-1" onClick={() => run(job.id)} title="Run now"><Play size={13} className="text-panel-green" /></button>
                <button className="btn !px-2 !py-1 !bg-panel-red/20 !text-panel-red" onClick={() => setConfirmDel(job)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={jobs.length} pageSize={8} />
        </div>
      )}

      {jobs.length === 0 && !loading && <EmptyState icon={Clock} title="No cron jobs" subtitle="Schedule automated tasks" />}

      <CreateJobModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(m) => { toastMsg(m); load() }} />
      <ConfirmModal open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && del(confirmDel.id)} title="Delete cron job" confirmText="Delete" message="Delete this cron job? It will be removed from the crontab." />
    </div>
  )
}

function CreateJobModal({ open, onClose, onCreated }) {
  const [preset, setPreset] = useState('*/5 * * * *')
  const [command, setCommand] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!command) return setErr('Command required')
    setBusy(true); setErr(null)
    try {
      await api.post('/cron', { schedule: preset, command, label })
      onCreated('Cron job created')
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Cron Job">
      <div className="space-y-4">
        <Field label="Schedule preset">
          <select className="input-field" value={preset} onChange={e => setPreset(e.target.value)}>
            {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label} — {p.value}</option>)}
          </select>
        </Field>
        <Field label="Command" hint="Runs as user digital-auracle via bash"><input className="input-field" placeholder="/usr/bin/php /var/www/site/backup.php" value={command} onChange={e => setCommand(e.target.value)} /></Field>
        <Field label="Label (optional)"><input className="input-field" placeholder="Site backup" value={label} onChange={e => setLabel(e.target.value)} /></Field>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">Schedule: <code className="font-mono">{preset}</code></p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating...' : 'Create Job'}</Button>
        </div>
      </div>
    </Modal>
  )
}
