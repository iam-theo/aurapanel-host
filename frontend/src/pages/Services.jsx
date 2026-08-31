import { useEffect, useState, useMemo } from 'react'
import { Play, Square, RotateCcw, Power, RefreshCw, Server, Check } from 'lucide-react'
import { api } from '../lib/api'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const GROUP_COLORS = {
  web: 'bg-panel-blue/15 text-panel-blue',
  database: 'bg-panel-purple/15 text-panel-purple',
  containers: 'bg-panel-green/15 text-panel-green',
  application: 'bg-panel-yellow/15 text-panel-yellow',
  network: 'bg-panel-orange/15 text-panel-orange',
  remote: 'bg-panel-red/15 text-panel-red',
  iot: 'bg-panel-green/15 text-panel-green',
}

export default function Services() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [page, setPage] = useState(1)

  const load = async () => {
    try {
      const d = await api.get('/services')
      setServices(d)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  const action = async (name, op) => {
    setBusy(`${name}:${op}`)
    try {
      await api.post(`/services/${name}/${op}`)
      setTimeout(load, 500)
    } catch (e) {
      alert(e.message)
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => ['all', ...new Set(services.map(s => s.group))], [services])
  const enabledCount = services.filter(s => s.enabled).length
  const activeCount = services.filter(s => s.active).length
  const filtered = activeTab === 'all' ? services : services.filter(s => s.group === activeTab)
  const { paged, totalPages } = paginate(filtered, page, 9)
  const bulk = useBulk(paged, s => s.name)
  const bulkAction = async (op) => { for (const n of bulk.selected) await action(n, op); bulk.clear() }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-2xl font-bold">{activeCount}<span className="text-panel-muted text-lg">/{services.length}</span></p>
            <p className="text-xs text-panel-muted">Services active</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{enabledCount}</p>
            <p className="text-xs text-panel-muted">Auto-start enabled</p>
          </div>
        </div>
        <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex gap-1 bg-panel-card p-1 rounded-lg border border-panel-border overflow-x-auto w-fit">
        {groups.map(g => (
          <button key={g} onClick={() => { setActiveTab(g); setPage(1) }} className={`px-4 py-2 rounded-md text-sm capitalize whitespace-nowrap ${activeTab === g ? 'bg-panel-accent text-white' : 'text-panel-muted hover:text-panel-text'}`}>{g}{g !== 'all' && <span className="ml-1.5 text-xs opacity-60">({services.filter(s => s.group === g).length})</span>}</button>
        ))}
      </div>

      {bulk.count > 0 && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[
          { label: 'Start', icon: <Play size={13} />, onClick: () => bulkAction('start') },
          { label: 'Stop', icon: <Square size={13} />, onClick: () => bulkAction('stop') },
          { label: 'Restart', icon: <RotateCcw size={13} />, onClick: () => bulkAction('restart') },
        ]} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {paged.map(svc => {
              const grp = svc.group
              const isBusy = busy === `${svc.name}:start` || busy === `${svc.name}:stop` || busy === `${svc.name}:restart`
              return (
                <div key={svc.name} className={`panel-card ${svc.active ? '' : 'opacity-70'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center"><input type="checkbox" checked={bulk.has(svc.name)} onChange={() => bulk.toggle(svc.name)} className="accent-panel-accent" /></label>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${GROUP_COLORS[grp] || 'bg-panel-muted/15 text-panel-muted'}`}>
                        <Server size={18} />
                      </div>
                      <div>
                        <p className="font-semibold text-panel-text">{svc.label}</p>
                        <p className="text-xs text-panel-muted font-mono">{svc.name}</p>
                      </div>
                    </div>
                    <span className={`status-badge ${svc.active ? 'online' : 'offline'}`}>
                      {svc.active ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {svc.active ? (
                      <button className="btn-red !py-1.5 flex-1" onClick={() => action(svc.name, 'stop')} disabled={isBusy}>
                        <Square size={13} /> Stop
                      </button>
                    ) : (
                      <button className="btn-green !py-1.5 flex-1" onClick={() => action(svc.name, 'start')} disabled={isBusy}>
                        <Play size={13} /> Start
                      </button>
                    )}
                    <button className="btn-ghost !py-1.5 flex-1" onClick={() => action(svc.name, 'restart')} disabled={isBusy}>
                      <RotateCcw size={13} className={isBusy ? 'animate-spin' : ''} /> Restart
                    </button>
                    <button
                      className={`btn !py-1.5 ${svc.enabled ? 'btn-green' : 'btn-ghost'}`}
                      onClick={() => action(svc.name, svc.enabled ? 'disable' : 'enable')}
                      title={svc.enabled ? 'Disable auto-start' : 'Enable auto-start'}
                    >
                      <Power size={13} />
                    </button>
                  </div>
                  <p className="text-[11px] text-panel-muted mt-2 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${svc.enabled ? 'bg-panel-green' : 'bg-panel-muted'}`} />
                    {svc.enabled ? 'Auto-start enabled' : 'Manual start'}
                    {' • '}Status: <span className="font-mono">{svc.status}</span>
                  </p>
                </div>
              )
            })}
          </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={9} />
    </div>
  )
}
