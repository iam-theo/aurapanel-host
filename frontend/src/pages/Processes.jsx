import { useEffect, useState } from 'react'
import { RefreshCw, Search, Cpu, MemoryStick } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes } from '../lib/utils'

export default function Processes() {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const d = await api.get('/system/processes')
      setData(d)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  const filtered = data?.list?.filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    (p.command || '').toLowerCase().includes(filter.toLowerCase())
  ) || []

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-2xl font-bold text-panel-text">{data?.total || 0}</p>
            <p className="text-xs text-panel-muted">Total processes</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-panel-green">{data?.running || 0}</p>
            <p className="text-xs text-panel-muted">Running</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-panel-yellow">{data?.sleeping || 0}</p>
            <p className="text-xs text-panel-muted">Sleeping</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-panel-muted" />
            <input
              className="input-field pl-9 w-64"
              placeholder="Search processes..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="panel-card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
              <th className="px-4 py-3 font-medium">PID</th>
              <th className="px-4 py-3 font-medium">Process</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium flex items-center gap-1"><Cpu size={12} /> CPU</th>
              <th className="px-4 py-3 font-medium flex items-center gap-1"><MemoryStick size={12} /> Memory</th>
              <th className="px-4 py-3 font-medium">Command</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.pid} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-panel-muted">{p.pid}</td>
                <td className="px-4 py-2.5 font-medium text-panel-text">{p.name}</td>
                <td className="px-4 py-2.5 text-xs text-panel-muted">{p.user}</td>
                <td className="px-4 py-2.5">
                  <span className={`status-badge ${p.state === 'running' ? 'online' : 'offline'}`}>
                    {p.state}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-panel-bg rounded-full overflow-hidden">
                      <div className="h-full bg-panel-blue rounded-full" style={{ width: `${Math.min(p.cpu, 100)}%` }} />
                    </div>
                    <span className="text-xs">{p.cpu.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-xs">{formatBytes(p.mem * 1024 * 1024)}</td>
                <td className="px-4 py-2.5 text-xs text-panel-muted font-mono truncate max-w-[300px]">{p.command}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
