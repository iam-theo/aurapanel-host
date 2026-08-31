import { useState, useEffect } from 'react'
import {
  Cpu, MemoryStick, HardDrive, Globe2, Wifi, Activity, Users,
  ArrowUpRight, ArrowDownRight, Server, Shield,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { api } from '../lib/api'
import { useSWR } from '../lib/useSWR'
import { formatBytes, formatUptime } from '../lib/utils'

export default function Dashboard() {
  // SWR with deduping + 12s poll (was 5s) — backend caches overview 60s / cpu 3s / net 4s
  const { data, error: dataErr, isLoading } = useSWR('/system/overview', () => api.get('/system/overview'), { refreshInterval: 12000, dedupingInterval: 5000 })
  const { data: pm2 } = useSWR('/pm2/summary', () => api.get('/pm2/summary'), { refreshInterval: 15000, dedupingInterval: 5000 })
  const { data: docker } = useSWR('/docker/containers', () => api.get('/docker/containers'), { refreshInterval: 15000, dedupingInterval: 5000 })
  const { data: networkStats } = useSWR('/system/network-stats', () => api.get('/system/network-stats'), { refreshInterval: 12000, dedupingInterval: 4000 })

  const [cpuHistory, setCpuHistory] = useState([])
  const [cpuErr, setCpuErr] = useState(null)

  useEffect(() => {
    let t
    const tick = async () => {
      try {
        const h = await api.get('/system/cpu-history')
        setCpuHistory(prev => [...prev, { time: new Date().toLocaleTimeString(), usage: h.total }].slice(-30))
      } catch (e) { setCpuErr(e.message) }
    }
    tick()
    t = setInterval(tick, 10000)
    return () => clearInterval(t)
  }, [])

  const error = dataErr?.message || cpuErr
  const isInitial = isLoading && !data

  if (error) {
    return (
      <div className="p-8">
        <div className="panel-card border-panel-red/40">
          <p className="text-panel-red font-medium">Failed to load server data</p>
          <p className="text-sm text-panel-muted mt-1">{String(error)} — is the backend API running on port 3500?</p>
        </div>
      </div>
    )
  }

  if (isInitial) {
    return (
      <div className="p-8 space-y-6 animate-pulse">
        {[0, 1, 2].map(i => (
          <div key={i} className="panel-card h-24 bg-panel-card/50" />
        ))}
      </div>
    )
  }
  if (!data) return null

  const memPct = data.memory.usagePercent
  const mainDisk = data.disk[0] || {}

  return (
    <div className="p-6 space-y-6">
      {/* Top resource cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ResourceCard
          icon={Cpu}
          label="CPU Usage"
          value={`${data.cpu.usage}%`}
          sub={`${data.cpu.cores} cores • ${data.cpu.brand}`}
          color="text-panel-blue"
          bar={data.cpu.usage}
          barColor="bg-panel-blue"
        />
        <ResourceCard
          icon={MemoryStick}
          label="Memory"
          value={`${memPct}%`}
          sub={`${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`}
          color="text-panel-purple"
          bar={memPct}
          barColor="bg-panel-purple"
        />
        <ResourceCard
          icon={HardDrive}
          label="Disk"
          value={`${mainDisk.usagePercent || 0}%`}
          sub={`${formatBytes(mainDisk.used || 0)} / ${formatBytes(mainDisk.size || 0)}`}
          color="text-panel-yellow"
          bar={mainDisk.usagePercent || 0}
          barColor="bg-panel-yellow"
        />
        <ResourceCard
          icon={Activity}
          label="Uptime"
          value={data.uptime.replace('up ', '')}
          sub={data.hostname}
          color="text-panel-green"
          bar={100}
          barColor="bg-panel-green"
          isUptime
        />
      </div>

      {/* CPU chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="panel-card xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-panel-text">CPU History</h3>
            <span className="text-xs text-panel-muted">Live update</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={cpuHistory}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6c5ce7" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#6c5ce7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d35" />
              <XAxis dataKey="time" stroke="#8b8f9a" fontSize={11} tickLine={false} />
              <YAxis stroke="#8b8f9a" fontSize={11} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: '#1a1d24', border: '1px solid #2a2d35', borderRadius: 8, color: '#e4e7ec' }}
              />
              <Area type="monotone" dataKey="usage" stroke="#6c5ce7" fill="url(#cpuGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Network */}
        <div className="panel-card">
          <h3 className="font-medium text-panel-text mb-4">Network</h3>
          <div className="space-y-3">
            {networkStats?.slice(0, 3).map(net => (
              <div key={net.iface} className="bg-panel-bg rounded-lg p-3 border border-panel-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Wifi size={14} className="text-panel-blue" />
                    {net.iface}
                  </span>
                  <span className="text-xs text-panel-muted">{formatBytes(net.rxSec)}/s</span>
                </div>
                <div className="flex items-center justify-between text-xs text-panel-muted">
                  <span className="flex items-center gap-1">
                    <ArrowDownRight size={12} className="text-panel-green" />
                    {formatBytes(net.rxSec)}/s
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowUpRight size={12} className="text-panel-blue" />
                    {formatBytes(net.txSec)}/s
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-panel-border">
            <p className="text-xs text-panel-muted mb-2 flex items-center gap-1.5">
              <Globe2 size={14} className="text-panel-green" /> Public address
            </p>
            {data.network.map(n => (
              <div key={n.iface} className="flex justify-between text-sm py-1">
                <span className="text-panel-muted">{n.iface}</span>
                <span className="font-mono text-panel-text">{n.ip4}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Process count + apps + containers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="panel-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-panel-blue/15 flex items-center justify-center">
              <Activity size={20} className="text-panel-blue" />
            </div>
            <div>
              <p className="text-2xl font-bold text-panel-text">{pm2?.online || 0}</p>
              <p className="text-xs text-panel-muted">PM2 applications</p>
            </div>
          </div>
          <p className="text-sm text-panel-muted">
            {pm2?.stopped || 0} stopped • total memory {pm2 ? formatBytes(pm2.totalMemory) : '-'}
          </p>
        </div>
        <div className="panel-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-panel-purple/15 flex items-center justify-center">
              <Server size={20} className="text-panel-purple" />
            </div>
            <div>
              <p className="text-2xl font-bold text-panel-text">{docker?.length || 0}</p>
              <p className="text-xs text-panel-muted">Docker containers</p>
            </div>
          </div>
          <p className="text-sm text-panel-muted">
            {docker?.filter(c => c.state === 'running').length || 0} running now
          </p>
        </div>
        <div className="panel-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-panel-green/15 flex items-center justify-center">
              <Shield size={20} className="text-panel-green" />
            </div>
            <div>
              <p className="text-2xl font-bold text-panel-text">Active</p>
              <p className="text-xs text-panel-muted">Security protection</p>
            </div>
          </div>
          <p className="text-sm text-panel-muted">Firewall, monitoring and backups running.</p>
        </div>
      </div>

      {/* Server info */}
      <div className="panel-card">
        <h3 className="font-medium text-panel-text mb-4">Server Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <InfoItem label="Operating System" value={`${data.os.distro} ${data.os.release}`} />
          <InfoItem label="Kernel" value={data.os.kernel} />
          <InfoItem label="Architecture" value={data.os.arch} />
          <InfoItem label="CPU Model" value={`${data.cpu.manufacturer} ${data.cpu.brand}`} />
          <InfoItem label="Memory" value={formatBytes(data.memory.total)} />
          <InfoItem label="Hostname" value={data.hostname} />
          <InfoItem label="Uptime" value={data.uptime} />
          <InfoItem label="Disk Total" value={formatBytes(mainDisk.size || 0)} />
        </div>
      </div>
    </div>
  )
}

function ResourceCard({ icon: Icon, label, value, sub, color, bar, barColor, isUptime }) {
  return (
    <div className="panel-card panel-card-hover">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-2 text-sm text-panel-muted">
          <Icon size={16} className={color} />
          {label}
        </span>
        {!isUptime && <span className="text-xs font-mono text-panel-text">{value}</span>}
      </div>
      {isUptime ? (
        <p className="text-2xl font-bold text-panel-text">{value}</p>
      ) : (
        <div className="h-2 bg-panel-bg rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-500`}
            style={{ width: `${Math.min(bar, 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-panel-muted mt-3">{sub}</p>
    </div>
  )
}

function InfoItem({ label, value }) {
  return (
    <div>
      <p className="text-xs text-panel-muted mb-1">{label}</p>
      <p className="font-medium text-panel-text break-words">{value}</p>
    </div>
  )
}
