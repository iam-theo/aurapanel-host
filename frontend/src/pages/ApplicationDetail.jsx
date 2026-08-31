import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Square, RotateCcw, RefreshCw, Cpu, MemoryStick, Terminal } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes, relativeTime } from '../lib/utils'

export default function ApplicationDetail() {
  const { name } = useParams()
  const navigate = useNavigate()
  const [app, setApp] = useState(null)
  const [logs, setLogs] = useState('')
  const [logType, setLogType] = useState('out')
  const [loading, setLoading] = useState(true)

  const loadApp = async () => {
    try {
      const apps = await api.get('/pm2')
      setApp(apps.find(a => a.name === name) || null)
    } catch {}
  }

  const loadLogs = async () => {
    try {
      const d = await api.get(`/pm2/${name}/logs?lines=200`)
      setLogs(d.logs)
    } catch {}
  }

  useEffect(() => {
    loadApp()
    loadLogs()
    const t = setInterval(() => {
      loadApp()
      loadLogs()
    }, 5000)
    return () => clearInterval(t)
  }, [name])

  const action = async (op) => {
    try {
      await api.post(`/pm2/${name}/${op}`)
      await loadApp()
    } catch {}
  }

  if (!app) {
    return (
      <div className="p-8">
        <div className="panel-card text-center py-16">
          <p className="text-panel-muted">Application not found</p>
          <button className="btn-accent mt-4" onClick={() => navigate('/applications')}>Back to applications</button>
        </div>
      </div>
    )
  }

  const online = app.status === 'online'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button className="btn-ghost !px-3 !py-2" onClick={() => navigate('/applications')}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-panel-text">{app.name}</h2>
            <span className={`status-badge ${online ? 'online' : 'offline'}`}>{app.status}</span>
          </div>
          <p className="text-xs text-panel-muted mt-0.5 font-mono">{app.script}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="PID" value={app.pid || '-'} />
        <MetricCard label="CPU Usage" value={`${app.cpu?.toFixed?.(1) || '0'}%`} />
        <MetricCard label="Memory" value={formatBytes(app.memory)} />
        <MetricCard label="Restarts" value={app.restarts} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard label="Uptime" value={relativeTime(app.uptime)} />
        <MetricCard label="Working Directory" value={app.cwd} small />
        <MetricCard label="Port" value={app.port || '-'} />
        <MetricCard label="PM2 ID" value={app.pmId} />
      </div>

      <div className="flex items-center gap-2">
        {online ? (
          <button className="btn-red" onClick={() => action('stop')}><Square size={14} /> Stop</button>
        ) : (
          <button className="btn-green" onClick={() => action('start')}><Play size={14} /> Start</button>
        )}
        <button className="btn-accent" onClick={() => action('restart')}><RotateCcw size={14} /> Restart</button>
        <button className="btn-ghost" onClick={() => { action('restart'); setTimeout(loadLogs, 1000) }}><RefreshCw size={14} /> Reload</button>
      </div>

      <div className="panel-card overflow-hidden p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border bg-panel-card">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-panel-green" />
            <span className="font-medium">Logs</span>
          </div>
          <div className="flex gap-1">
            <button className={`px-3 py-1 rounded-md text-xs ${logType === 'out' ? 'bg-panel-accent/20 text-panel-accentLight' : 'text-panel-muted hover:text-panel-text'}`}
              onClick={() => setLogType('out')}>stdout</button>
            <button className={`px-3 py-1 rounded-md text-xs ${logType === 'err' ? 'bg-panel-accent/20 text-panel-accentLight' : 'text-panel-muted hover:text-panel-text'}`}
              onClick={() => setLogType('err')}>stderr</button>
          </div>
        </div>
        <pre className="p-4 text-xs font-mono text-panel-text bg-panel-bg overflow-x-auto max-h-[500px] whitespace-pre-wrap">
          {logs || 'Loading logs...'}
        </pre>
      </div>
    </div>
  )
}

function MetricCard({ label, value, small }) {
  return (
    <div className="panel-card">
      <p className="text-xs text-panel-muted mb-1">{label}</p>
      <p className={`font-semibold text-panel-text ${small ? 'text-sm break-all' : 'text-lg'}`}>{value}</p>
    </div>
  )
}
