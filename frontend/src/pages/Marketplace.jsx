import { useEffect, useState, useMemo } from 'react'
import { Search, Download, Check, Package, Boxes, Globe, Database, Server, Activity, Copy, RefreshCw, Trash2, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import { PageLoader } from '../components/ui.jsx'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const PAGE_SIZE = 12

const CAT_ICON = {
  web: Globe, database: Database, runtime: Boxes, devops: Boxes, monitoring: Activity, security: Server, tools: Package, network: Server, system: Server,
}

export default function Marketplace() {
  const notify = useNotify()
  const [activeTab, setActiveTab] = useState('marketplace') // marketplace | installed
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const [data, setData] = useState({ packages: [], categories: [], total: 0 })
  const [installed, setInstalled] = useState({ packages: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [installing, setInstalling] = useState(new Set())
  // First load shows the spinner; later refreshes keep stale results visible
  const [initialized, setInitialized] = useState(false)

  const loadMarketplace = async () => {
    setLoading(true)
    try {
      const d = await api.get(`/packages/marketplace?category=${category}&q=${encodeURIComponent(q)}`)
      setData(d)
    } catch (e) { notify.error(e.message) } finally { setLoading(false); setInitialized(true) }
  }
  const loadInstalled = async () => {
    try {
      const d = await api.get('/packages/installed')
      setInstalled(d)
    } catch (e) { notify.error(e.message) }
  }

  useEffect(() => { loadMarketplace(); loadInstalled() }, [])
  useEffect(() => { setPage(1); loadMarketplace() }, [category])
  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); loadMarketplace() }, 300)
    return () => clearTimeout(t)
  }, [q])

  const source = activeTab === 'marketplace' ? data.packages : installed.packages
  const { paged, totalPages } = paginate(source, page, PAGE_SIZE)
  const bulk = useBulk(paged, x => x.id)

  const install = async (id) => {
    setInstalling(s => new Set([...s, id]))
    try {
      const r = await api.post('/packages/install', { id })
      notify.info(`Installing ${id} — job ${r.jobId?.slice(0, 8)}`)
      // poll job
      const jobId = r.jobId
      let tries = 0
      const poll = setInterval(async () => {
        tries++
        if (tries > 60) { clearInterval(poll); setInstalling(s => { const n = new Set(s); n.delete(id); return n }); return }
        try {
          const j = await api.get(`/packages/jobs/${jobId}`)
          if (j.status !== 'running') {
            clearInterval(poll)
            setInstalling(s => { const n = new Set(s); n.delete(id); return n })
            if (j.status === 'done') notify.success(`${id} installed`)
            else notify.error(`${id} install failed`)
            loadMarketplace(); loadInstalled()
          }
        } catch {}
      }, 4000)
    } catch (e) { notify.error(e.message); setInstalling(s => { const n = new Set(s); n.delete(id); return n }) }
  }

  const bulkInstall = async () => {
    for (const id of bulk.selected) await install(id)
    bulk.clear()
  }

  const copyCmd = (cmd) => { navigator.clipboard?.writeText(cmd); notify.success('Copied install command') }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-panel-accent uppercase tracking-wider">
            Automation / Packages <span className="text-panel-muted normal-case">apt · system</span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-panel-text tracking-tight">Marketplace</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase bg-panel-cardHover text-panel-green">
              {installed.total} INSTALLED
            </span>
          </div>
        </div>
        <button className="btn-ghost !py-2 font-mono text-xs" onClick={() => { loadMarketplace(); loadInstalled() }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Catalog</p>
          <p className="font-mono text-2xl font-bold text-panel-text mt-2">{data.total}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">packages</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Installed</p>
          <p className="font-mono text-2xl font-bold text-panel-green mt-2">{installed.total}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">on host</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Categories</p>
          <p className="font-mono text-2xl font-bold text-panel-blue mt-2">{data.categories.length}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">groups</p>
        </div>
        <div className="panel-card !p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-panel-muted">Working</p>
          <p className="font-mono text-2xl font-bold text-panel-accent mt-2">{installing.size}</p>
          <p className="font-mono text-xs text-panel-muted mt-1">installing</p>
        </div>
      </div>

      <div className="flex gap-2 bg-panel-card p-1 rounded-lg border border-panel-border w-fit">
        <button className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'marketplace' ? 'bg-panel-accent text-panel-onaccent' : 'text-panel-muted'}`} onClick={() => setActiveTab('marketplace')}>Marketplace <span className="ml-1 text-xs opacity-70">{data.total}</span></button>
        <button className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'installed' ? 'bg-panel-accent text-panel-onaccent' : 'text-panel-muted'}`} onClick={() => setActiveTab('installed')}>Installed <span className="ml-1 text-xs opacity-70">{installed.total}</span></button>
      </div>

      {activeTab === 'marketplace' && (
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-panel-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search packages (nginx, redis, docker...)" className="input-field pl-9" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {data.categories.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)} className={`px-3 py-1.5 rounded-full text-xs border ${category === c.id ? 'bg-panel-accent border-panel-accent text-panel-onaccent' : 'bg-panel-card border-panel-border text-panel-muted hover:text-panel-text'}`}>{c.label}</button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'marketplace' && bulk.count > 0 && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[{ label: 'Install selected', icon: <Download size={13} />, onClick: bulkInstall }]} />
      )}

      {!initialized ? (
        <PageLoader label="Loading packages..." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paged.map(pkg => {
              const Icon = CAT_ICON[pkg.category] || Package
              const isInst = pkg.installed
              const isBusy = installing.has(pkg.id)
              return (
                <div key={pkg.id} className="panel-card flex flex-col">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isInst ? 'bg-panel-green/15 text-panel-green' : 'bg-panel-accent/15 text-panel-accentLight'}`}><Icon size={18} /></div>
                      <div>
                        <p className="font-semibold text-panel-text text-sm">{pkg.name}</p>
                        <p className="text-xs text-panel-muted capitalize">{pkg.category} • <span className="font-mono">{pkg.id}</span></p>
                      </div>
                    </div>
                    {activeTab === 'marketplace' && <label className="flex items-center"><input type="checkbox" checked={bulk.has(pkg.id)} onChange={() => bulk.toggle(pkg.id)} className="accent-panel-accent" /></label>}
                    {isInst && <span className="status-badge online flex items-center gap-1"><Check size={12} /> Installed</span>}
                  </div>
                  <p className="text-sm text-panel-muted mb-3 line-clamp-2">{pkg.desc}</p>
                  <div className="bg-panel-bg rounded-md p-2 border border-panel-border flex items-center gap-2 mb-3">
                    <code className="flex-1 text-xs font-mono text-panel-text truncate">{pkg.install}</code>
                    <button onClick={() => copyCmd(pkg.install)} className="btn-ghost !px-2 !py-1"><Copy size={13} /></button>
                  </div>
                  <div className="mt-auto flex gap-2">
                    {isInst ? <span className="btn-ghost !py-1.5 flex-1 justify-center text-xs opacity-60">Installed</span> : <button disabled={isBusy} onClick={() => install(pkg.id)} className="btn-accent flex-1 justify-center !py-1.5 text-xs">{isBusy ? <><Loader2 size={13} className="animate-spin" /> Installing...</> : <><Download size={13} /> Install</>}</button>}
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={source.length} pageSize={PAGE_SIZE} />
          {paged.length === 0 && <div className="text-center py-12 text-panel-muted">No packages found</div>}
        </>
      )}
    </div>
  )
}
