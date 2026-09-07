import { useEffect, useState } from 'react'
import { Blocks, Plus, RefreshCw, Trash2, FlaskConical, Github, Container, MessageSquare, Webhook } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import { useAuth } from '../context/AuthContext'
import Modal, { Field, Button, EmptyState, PageHeader } from '../components/ui.jsx'
import { relativeTime } from '../lib/utils'

const PROVIDER_ICONS = {
  github: Github,
  'docker-registry': Container,
  slack: MessageSquare,
  webhook: Webhook,
}

const STATUS_STYLE = {
  ok: 'bg-panel-green/15 text-panel-green',
  error: 'bg-panel-red/15 text-panel-red',
  unknown: 'bg-panel-muted/15 text-panel-muted',
}

export default function Integrations() {
  const notify = useNotify()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [providers, setProviders] = useState([])
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(null) // provider id
  const [testing, setTesting] = useState(null)

  const load = async () => {
    try {
      const d = await api.get('/integrations')
      setProviders(d.providers || [])
      setConnections(d.connections || [])
    } catch (e) { notify.error(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const del = async (conn) => {
    if (!(await notify.confirm(`Remove the '${conn.name}' integration? Stored credentials are deleted.`, { title: 'Remove integration', confirmText: 'Remove' }))) return
    try {
      await api.del(`/integrations/${conn.id}`)
      notify.success(`'${conn.name}' removed`)
      load()
    } catch (e) { notify.error(e.message) }
  }

  const test = async (conn) => {
    setTesting(conn.id)
    try {
      const updated = await api.post(`/integrations/${conn.id}/test`)
      setConnections(prev => prev.map(c => c.id === conn.id ? updated : c))
      notify.success(`'${conn.name}' verified — ${updated.statusDetail || 'ok'}`)
    } catch (e) { notify.error(`'${conn.name}': ${e.message}`); load() } finally { setTesting(null) }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={Blocks}
        title="Integrations"
        subtitle="third-party connections with live verification"
        stats={[{ value: connections.filter(c => c.status === 'ok').length, label: 'healthy' }]}
        actions={
          <>
            <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            {isAdmin && (
              <button className="btn-accent" onClick={() => setShowAdd('github')}><Plus size={16} /> New Integration</button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="panel-card h-40 flex items-center justify-center text-panel-muted text-sm">Loading integrations...</div>
      ) : (
        <>
          {connections.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {connections.map(c => {
                const Icon = PROVIDER_ICONS[c.provider] || Blocks
                return (
                  <div key={c.id} className="panel-card">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-panel-accent/15 flex items-center justify-center shrink-0">
                          <Icon size={18} className="text-panel-accent" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-panel-text truncate">{c.name}</p>
                          <p className="text-xs text-panel-muted capitalize">{c.provider.replace('-', ' ')}</p>
                        </div>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold shrink-0 ${STATUS_STYLE[c.status] || STATUS_STYLE.unknown}`}>
                        {c.status === 'ok' ? 'HEALTHY' : c.status === 'error' ? 'FAILING' : 'UNKNOWN'}
                      </span>
                    </div>
                    <div className="text-xs text-panel-muted space-y-1 font-mono">
                      {c.username && <p>user <span className="text-panel-text">{c.username}</span></p>}
                      {c.baseUrl && <p className="truncate">url <span className="text-panel-text">{c.baseUrl}</span></p>}
                      {c.webhookUrl && <p className="truncate">hook <span className="text-panel-text">{c.webhookUrl}</span></p>}
                      {c.secretHint?.map(s => <p key={s.field}>{s.field} <span className="text-panel-text">{s.hint}</span></p>)}
                      {c.statusDetail && <p className="truncate">last <span className="text-panel-text">{c.statusDetail}</span></p>}
                      {c.lastChecked && <p>checked {relativeTime(c.lastChecked)}</p>}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2 mt-4">
                        <button className="btn-ghost !py-1.5 text-xs" disabled={testing === c.id} onClick={() => test(c)}>
                          <FlaskConical size={13} /> {testing === c.id ? 'Testing…' : 'Test'}
                        </button>
                        <button className="btn-ghost !py-1.5 text-xs !text-panel-red" onClick={() => del(c)}>
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-panel-text mb-3">Connect a provider</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {providers.map(p => {
                const Icon = PROVIDER_ICONS[p.id] || Blocks
                const connected = connections.filter(c => c.provider === p.id).length
                return (
                  <div key={p.id} className="panel-card flex flex-col">
                    <div className="w-10 h-10 rounded-lg bg-panel-accent/15 flex items-center justify-center mb-3">
                      <Icon size={20} className="text-panel-accent" />
                    </div>
                    <p className="font-semibold text-panel-text">{p.label}</p>
                    <p className="text-xs text-panel-muted mt-1 flex-1">{p.description}</p>
                    <div className="flex items-center justify-between mt-4">
                      <span className="text-xs text-panel-muted font-mono">{connected} connected</span>
                      {isAdmin && (
                        <button className="btn !py-1.5 text-xs" onClick={() => setShowAdd(p.id)}>
                          <Plus size={13} /> Connect
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {providers.length === 0 && !loading && (
              <EmptyState icon={Blocks} title="No providers available" subtitle="The integrations API did not return a catalog." />
            )}
          </div>
        </>
      )}

      {showAdd && (
        <ConnectModal
          provider={providers.find(p => p.id === showAdd)}
          onClose={() => setShowAdd(null)}
          onConnected={() => { setShowAdd(null); load() }}
        />
      )}
    </div>
  )
}

function ConnectModal({ provider, onClose, onConnected }) {
  const notify = useNotify()
  const [name, setName] = useState('')
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  if (!provider) return null

  const submit = async () => {
    if (!name.trim()) return setErr('A name is required')
    setBusy(true); setErr(null)
    try {
      const payload = { provider: provider.id, name: name.trim() }
      for (const f of provider.fields) payload[f.key] = values[f.key]?.trim?.() || values[f.key] || ''
      const created = await api.post('/integrations', payload)
      notify.success(`'${created.name}' connected — ${created.statusDetail || 'verified'}`)
      onConnected()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Connect ${provider.label}`}>
      <div className="space-y-4">
        <p className="text-xs text-panel-muted">{provider.description} Credentials are verified live before anything is stored.</p>
        <Field label="Name">
          <input className="input-field" placeholder={`e.g. ${provider.label.toLowerCase()}-prod`} value={name}
            onChange={e => setName(e.target.value)} />
        </Field>
        {provider.fields.map(f => (
          <Field key={f.key} label={f.label} hint={f.help}>
            <input className="input-field font-mono" type={f.type === 'password' ? 'password' : 'text'}
              autoComplete="off" spellCheck={false}
              value={values[f.key] || ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
          </Field>
        ))}
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={submit} disabled={busy}>{busy ? 'Verifying…' : 'Verify & connect'}</Button>
        </div>
      </div>
    </Modal>
  )
}
