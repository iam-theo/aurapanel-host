import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Trash2, Play, Clock } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
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
  const notify = useNotify()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [page, setPage] = useState(1)

  const load = async () => {
    try {
      const d = await api.get('/cron')
      setJobs(d.jobs)
    } catch (e) { notify.error(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filteredJobs = q
    ? jobs.filter(j => `${j.command || ''} ${j.minute} ${j.hour} ${j.dayOfMonth} ${j.month} ${j.dayOfWeek} ${j.label || ''}`.toLowerCase().includes(q.toLowerCase()))
    : jobs
  const { paged, totalPages } = paginate(filteredJobs, page, 8)
  const bulk = useBulk(paged, j => j.id)
  const bulkDelete = async () => { if (!(await notify.confirm(`Delete ${bulk.count} jobs?`, { title: 'Delete jobs', confirmText: 'Delete' }))) return; for (const id of bulk.selected) try { await api.del(`/cron/${id}`) } catch {}; await load(); bulk.clear() }

  const del = async (id) => {
    try { await api.del(`/cron/${id}`); await load(); notify.success('Cron job deleted') }
    catch (e) { notify.error(e.message) }
  }

  const run = async (id) => {
    try {
      const d = await api.post(`/cron/${id}/run`)
      notify.info(d.output?.split('\n').slice(-3).join(' ') || 'Job executed')
    } catch (e) { notify.error(e.message) }
  }

  const [q, setQ] = useState('')

  return (
    <div className="p-6 space-y-4">
      {bulk.count > 0 && <BulkBar count={bulk.count} onClear={bulk.clear} actions={[{ label: 'Delete', icon: <Trash2 size={13} />, onClick: bulkDelete }]} />}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Automation / Scheduler <span className="text-panel-muted normal-case">root crontab</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Cron Jobs</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase bg-panel-cardHover text-panel-green">
              {jobs.length} SCHEDULED
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-2 font-mono text-xs" onClick={load}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <button className="btn-accent !py-2" onClick={() => setShowCreate(true)}><Plus size={15} /> New Job</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Jobs</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{jobs.length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">in crontab</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Frequent</p>
          <p className="font-mono text-2xl font-bold text-panel-accent mt-2">{jobs.filter(j => (j.minute || '').includes('*/') || (j.minute || '').includes('*')).length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">sub-hourly</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Daily+</p>
          <p className="font-mono text-2xl font-bold text-panel-blue mt-2">{jobs.filter(j => !((j.minute || '').includes('*'))).length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">fixed schedules</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Selected</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{bulk.count}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">for bulk ops</p>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-card border border-panel-border max-w-xl">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="grep command or schedule..."
          className="bg-transparent border-none outline-none font-mono text-xs text-panel-text placeholder:text-panel-muted w-full" />
        <span className="px-1.5 rounded bg-panel-cardHover text-panel-muted font-mono text-[11px]">/</span>
      </div>

      {jobs.length > 0 && (
        <div className="panel-card p-0 overflow-hidden">
          <div className="px-4 py-2.5 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">Crontab · root</span>
            <span className="font-mono text-[11px] text-panel-muted">Showing {paged.length} of {filteredJobs.length}</span>
          </div>
          <div className="px-4 pt-3"><label className="flex items-center gap-2 text-xs text-panel-muted"><input type="checkbox" className="accent-panel-accent" checked={paged.length>0 && paged.every(j => bulk.has(j.id))} onChange={e => bulk.toggleAll(paged.map(j => j.id), e.target.checked)} /> Select page</label></div>
          <div className="p-4 pt-2 space-y-2">
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
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filteredJobs.length} pageSize={8} />
          </div>
        </div>
      )}

      {jobs.length === 0 && !loading && <EmptyState icon={Clock} title="No cron jobs" subtitle="Schedule automated tasks" />}

      <CreateJobModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={(m) => { notify.success(m); load() }} />
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
        <Field label="Command" hint="Runs as user root via bash"><input className="input-field" placeholder="/usr/bin/php /var/www/site/backup.php" value={command} onChange={e => setCommand(e.target.value)} /></Field>
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
