import { useEffect, useState } from 'react'
import { Database, RefreshCw, Boxes, Server, Cpu, Plus, Trash2, User as UserIcon, KeyRound, Copy } from 'lucide-react'
import { api } from '../lib/api'
import Modal, { Field, Button, EmptyState, ConfirmModal } from '../components/ui.jsx'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const CATEGORIES = [
  { id: 'relational', label: 'Relational', tabs: [{ id: 'postgres', label: 'PostgreSQL', icon: Database }] },
  { id: 'cache', label: 'Cache', tabs: [{ id: 'redis', label: 'Redis', icon: Boxes }, { id: 'memcached', label: 'Memcached', icon: Boxes }] },
  { id: 'messaging', label: 'Messaging', tabs: [{ id: 'rabbitmq', label: 'RabbitMQ', icon: Server }] },
  { id: 'ai', label: 'AI', tabs: [{ id: 'ollama', label: 'Ollama', icon: Cpu }] },
]
const TABS = CATEGORIES.flatMap(c => c.tabs)

export default function Databases() {
  const [tab, setTab] = useState('postgres')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [createDb, setCreateDb] = useState(null)
  const [createUser, setCreateUser] = useState(null)

  const toastMsg = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    try {
      const results = await Promise.allSettled([
        api.get('/databases/postgres'),
        api.get('/databases/redis'),
        api.get('/databases/memcached'),
        api.get('/databases/rabbitmq'),
        api.get('/databases/ollama'),
      ])
      const [pgR, redisR, memR, rmqR, olaR] = results
      const pg = pgR.status === 'fulfilled' ? pgR.value : []
      const redis = redisR.status === 'fulfilled' ? redisR.value : { port: 6379, version: 'N/A', running: false, error: redisR.reason?.message }
      const mem = memR.status === 'fulfilled' ? memR.value : { running: false }
      const rmq = rmqR.status === 'fulfilled' ? rmqR.value : { running: false }
      const ola = olaR.status === 'fulfilled' ? olaR.value : { models: [], running: false }
      setData({ postgres: pg, redis, memcached: mem, rabbitmq: rmq, ollama: ola })
      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length) toastMsg(`${failed.length} service(s) unavailable — showing available data`)
    } catch (e) { toastMsg(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast msg={toast} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3 bg-panel-card p-2 rounded-lg border border-panel-border overflow-x-auto">
          {CATEGORIES.map(cat => (
            <div key={cat.id} className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted/60 px-1">{cat.label}</span>
              <div className="flex gap-1">
                {cat.tabs.map(t => (
                  <button key={t.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap ${tab === t.id ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text hover:bg-panel-bg'}`}
                    onClick={() => setTab(t.id)}>
                    <t.icon size={14} /> {t.label}
                  </button>
                ))}
              </div>
              {cat.id !== CATEGORIES[CATEGORIES.length-1].id && <div className="w-px h-6 bg-panel-border mx-2" />}
            </div>
          ))}
        </div>
        {tab === 'postgres' && data.postgres?.length > 0 && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            <button className="btn-accent" onClick={() => setCreateDb(data.postgres[0])}><Plus size={16} /> New Database</button>
          </div>
        )}
      </div>

      {tab === 'postgres' && <PostgresTab servers={data.postgres} onNewDb={setCreateDb} onNewUser={setCreateUser} reload={load} toast={toastMsg} />}
      {tab === 'redis' && <RedisTab data={data.redis} toast={toastMsg} />}
      {tab === 'memcached' && <MemcachedTab data={data.memcached} />}
      {tab === 'rabbitmq' && <RabbitmqTab data={data.rabbitmq} />}
      {tab === 'ollama' && <OllamaTab data={data.ollama} />}

      {createDb && (
        <CreateDbModal server={createDb} onClose={() => setCreateDb(null)} onCreated={(m) => { toastMsg(m); load() }} />
      )}
      {createUser && (
        <CreateUserModal server={createUser} onClose={() => setCreateUser(null)} onCreated={(m) => { toastMsg(m); load() }} />
      )}
    </div>
  )
}

function Toast({ msg }) {
  return <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">{msg}</div>
}

function PostgresTab({ servers, onNewDb, onNewUser, reload, toast }) {
  const [confirmDel, setConfirmDel] = useState(null)
  const [expandDb, setExpandDb] = useState(null)

  if (!servers) return <Loading />
  if (servers.length === 0) return <EmptyState icon={Database} title="PostgreSQL not reachable" subtitle="Create a database to get started" />

  const delDb = async (name, cluster) => {
    try {
      await api.del(`/databases/postgres/databases/${name}?cluster=${cluster}`)
      toast(`Database '${name}' dropped`)
      reload()
    } catch (e) { toast(e.message) }
  }

  return (
    <div className="space-y-6">
      {servers.map(server => (
        <div key={server.cluster} className="panel-card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-panel-blue/15 flex items-center justify-center"><Database size={20} className="text-panel-blue" /></div>
              <div>
                <p className="font-semibold">{server.label}</p>
                <p className="text-xs text-panel-muted">Port {server.port} • {server.databases.length} databases</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5" onClick={() => onNewDb(server)}><Plus size={14} /> DB</button>
              <button className="btn-ghost !py-1.5" onClick={() => onNewUser(server)}><UserIcon size={14} /> User</button>
            </div>
          </div>

          <p className="text-xs text-panel-muted uppercase tracking-wider mb-2">Databases</p>
          <div className="space-y-2 mb-4">
            {server.databases.map(db => (
              <div key={db} className="flex items-center justify-between bg-panel-bg rounded-md px-3 py-2 border border-panel-border group">
                <button className="font-mono text-sm text-panel-text flex-1 text-left" onClick={() => setExpandDb(expandDb === db ? null : db)}>
                  {db}
                </button>
                <button className="btn !px-2 !py-1 opacity-0 group-hover:opacity-100 transition-opacity !bg-panel-red/20 !text-panel-red" onClick={() => setConfirmDel({ type: 'db', name: db, cluster: server.cluster })} title="Drop">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {server.databases.length === 0 && <p className="text-sm text-panel-muted">No databases</p>}
          </div>

          <p className="text-xs text-panel-muted uppercase tracking-wider mb-2">Users / Roles</p>
          <div className="space-y-2">
            {server.users.map(user => (
              <div key={user} className="flex items-center justify-between bg-panel-bg rounded-md px-3 py-2 border border-panel-border group">
                <span className="font-mono text-sm text-panel-text flex items-center gap-2"><UserIcon size={13} className="text-panel-purple" /> {user}</span>
                <button className="btn !px-2 !py-1 opacity-0 group-hover:opacity-100 transition-opacity !bg-panel-red/20 !text-panel-red" onClick={() => setConfirmDel({ type: 'user', name: user, cluster: server.cluster })} title="Drop role">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {server.users.length === 0 && <p className="text-sm text-panel-muted">No users</p>}
          </div>

          {expandDb && <DbDetails db={expandDb} server={server} />}
        </div>
      ))}

      <ConfirmModal open={!!confirmDel} onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel?.type === 'db'
          ? delDb(confirmDel.name, confirmDel.cluster)
          : (async () => { try { await api.del(`/databases/postgres/users/${confirmDel.name}?cluster=${confirmDel.cluster}`); toast(`User '${confirmDel.name}' dropped`); reload() } catch (e) { toast(e.message) } })()}
        title={confirmDel?.type === 'db' ? 'Drop database' : 'Drop user'}
        message={confirmDel?.type === 'db'
          ? `Drop database '${confirmDel?.name}'? All data will be permanently deleted.`
          : `Drop user/role '${confirmDel?.name}' and revoke all ownership?`}
        confirmText="Drop" />
    </div>
  )
}

function DbDetails({ db, server }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    api.get(`/databases/postgres/config/${db}?cluster=${server.cluster}`).then(setInfo).catch(() => setInfo({ size: 'N/A', owner: 'N/A' }))
  }, [db, server])
  return (
    <div className="mt-3 bg-panel-bg/50 rounded-md p-3 border border-panel-border text-sm">
      <p className="font-medium text-panel-text mb-2">{db} details</p>
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-panel-muted">Size</p><p className="font-mono">{info?.size ?? '...'}</p></div>
        <div><p className="text-xs text-panel-muted">Owner</p><p className="font-mono">{info?.owner ?? '...'}</p></div>
      </div>
    </div>
  )
}

function CreateDbModal({ server, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async () => {
    if (!name) return setErr('Database name required')
    setBusy(true); setErr(null)
    try {
      await api.post('/databases/postgres/databases', { name, cluster: server.cluster })
      onCreated(`Database '${name}' created on ${server.label}`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Create Database — ${server.label}`}>
      <div className="space-y-4">
        <Field label="Database name">
          <input className="input-field" placeholder="myapp_db" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        </Field>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">Note: creates the database on the {server.label} cluster (port {server.port}).</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating...' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function CreateUserModal({ server, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState(generatePassword())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async () => {
    if (!name || !password) return setErr('Username and password required')
    setBusy(true); setErr(null)
    try {
      await api.post('/databases/postgres/users', { name, password, cluster: server.cluster })
      onCreated(`User '${name}' created`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Create Database User — ${server.label}`}>
      <div className="space-y-4">
        <Field label="Username">
          <input className="input-field" placeholder="app_user" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        </Field>
        <Field label="Password" hint="Click to regenerate a secure random password">
          <div className="flex gap-2">
            <input className="input-field" value={password} onChange={e => setPassword(e.target.value)} />
            <button className="btn-ghost" onClick={() => setPassword(generatePassword())}><KeyRound size={16} /></button>
          </div>
        </Field>
        <button className="btn-ghost !py-1.5 text-xs" onClick={() => { navigator.clipboard?.writeText(password) }}><Copy size={12} /> Copy</button>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating...' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function generatePassword(len = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  let pw = ''
  for (let i = 0; i < len; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

function RedisTab({ data, toast }) {
  if (!data) return <Loading />
  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-panel-red/15 flex items-center justify-center"><Boxes size={20} className="text-panel-red" /></div>
          <div><p className="font-semibold">Redis Server</p><p className="text-xs text-panel-muted">v{data.version} • Port {data.port}</p></div>
        </div>
        <span className="status-badge online">Running</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniMetric label="Connected Clients" value={data.connectedClients} />
        <MiniMetric label="Memory Used" value={formatBytes(data.usedMemory)} />
        <MiniMetric label="Total Commands" value={data.totalCommands?.toLocaleString()} />
        <MiniMetric label="Uptime" value={`${Math.floor((data.uptimeSeconds || 0) / 3600)}h`} />
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-red !py-1.5" onClick={async () => { if (confirm('Flush ALL Redis data?')) { try { await api.post('/databases/redis/flush'); toast('Redis flushed') } catch (e) { toast(e.message) } } }}>Flush All</button>
      </div>
    </div>
  )
}

function MemcachedTab({ data }) {
  if (!data) return <Loading />
  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-panel-purple/15 flex items-center justify-center"><Boxes size={20} className="text-panel-purple" /></div>
          <div><p className="font-semibold">Memcached</p><p className="text-xs text-panel-muted">Port {data.port} • PID {data.pid}</p></div>
        </div>
        <span className="status-badge online">Running</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniMetric label="Current Items" value={data.currItems} />
        <MiniMetric label="Total Items" value={data.totalItems} />
        <MiniMetric label="Bytes Used" value={formatBytes(data.bytes)} />
        <MiniMetric label="Connections" value={data.currConnections} />
      </div>
    </div>
  )
}

function RabbitmqTab({ data }) {
  if (!data) return <Loading />
  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-panel-orange/15 flex items-center justify-center"><Server size={20} className="text-panel-orange" /></div>
          <div><p className="font-semibold">RabbitMQ Message Broker</p><p className="text-xs text-panel-muted">AMQP :{data.port} • Management :{data.managementPort}</p></div>
        </div>
        <span className={`status-badge ${data.running ? 'online' : 'offline'}`}>{data.running ? 'Running' : 'Down'}</span>
      </div>
      {data.queuesRaw && <div className="bg-panel-bg rounded-lg p-4 border border-panel-border font-mono text-xs overflow-x-auto"><pre className="whitespace-pre-wrap text-panel-text">{data.queuesRaw}</pre></div>}
    </div>
  )
}

function OllamaTab({ data }) {
  if (!data) return <Loading />
  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-panel-green/15 flex items-center justify-center"><Cpu size={20} className="text-panel-green" /></div>
          <div><p className="font-semibold">Ollama AI Runtime</p><p className="text-xs text-panel-muted">Port {data.port} • {data.models?.length || 0} models</p></div>
        </div>
        <span className="status-badge online">Running</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.models?.map(m => (
          <div key={m.name} className="bg-panel-bg rounded-lg p-4 border border-panel-border">
            <p className="font-mono font-medium text-panel-text">{m.name}</p>
            <p className="text-xs text-panel-muted mt-1">Size: {formatBytes(m.size || 0)}</p>
          </div>
        ))}
        {data.models?.length === 0 && <p className="text-sm text-panel-muted">No models installed</p>}
      </div>
    </div>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="bg-panel-bg rounded-lg p-4 border border-panel-border">
      <p className="text-xs text-panel-muted mb-1">{label}</p>
      <p className="text-lg font-semibold text-panel-text">{value ?? '-'}</p>
    </div>
  )
}

function Loading() { return <div className="panel-card h-40 flex items-center justify-center animate-pulse text-panel-muted">Loading...</div> }

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
