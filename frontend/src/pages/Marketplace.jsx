import { useEffect, useState, useMemo } from 'react'
import { Search, Download, Check, Package, Boxes, Globe, Database, Server, Activity, Copy, RefreshCw, Trash2, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import Pagination, { paginate } from '../components/Pagination.jsx'
import BulkBar, { useBulk } from '../components/BulkBar.jsx'

const PAGE_SIZE = 12

const CAT_ICON = {
  web: Globe, database: Database, runtime: Boxes, devops: Boxes, monitoring: Activity, security: Server, tools: Package, network: Server, system: Server,
}

export default function Marketplace() {
  const [activeTab, setActiveTab] = useState('marketplace') // marketplace | installed
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const [data, setData] = useState({ packages: [], categories: [], total: 0 })
  const [installed, setInstalled] = useState({ packages: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [toast, setToast] = useState(null)
  const [installing, setInstalling] = useState(new Set())

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const loadMarketplace = async () => {
    setLoading(true)
    try {
      const d = await api.get(`/packages/marketplace?category=${category}&q=${encodeURIComponent(q)}`)
      setData(d)
    } catch (e) { toastMsg(e.message) } finally { setLoading(false) }
  }
  const loadInstalled = async () => {
    try {
      const d = await api.get('/packages/installed')
      setInstalled(d)
    } catch (e) { toastMsg(e.message) }
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
      toastMsg(`Installing ${id} — job ${r.jobId?.slice(0, 8)}`)
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
            toastMsg(j.status === 'done' ? `${id} installed` : `${id} failed`)
            loadMarketplace(); loadInstalled()
          }
        } catch {}
      }, 4000)
    } catch (e) { toastMsg(e.message); setInstalling(s => { const n = new Set(s); n.delete(id); return n }) }
  }

  const bulkInstall = async () => {
    for (const id of bulk.selected) await install(id)
    bulk.clear()
  }

  const copyCmd = (cmd) => { navigator.clipboard?.writeText(cmd); toastMsg('Copied install command') }

  return (
    <div className="p-6 space-y-6">
      {toast && <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">{toast}</div>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-panel-text">Package Marketplace</h1>
          <p className="text-xs text-panel-muted">Install system packages with one click — apt, npm, docker and more</p>
        </div>
        <button className="btn-ghost" onClick={() => { loadMarketplace(); loadInstalled() }}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      <div className="flex gap-2 bg-panel-card p-1 rounded-lg border border-panel-border w-fit">
        <button className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'marketplace' ? 'bg-panel-accent text-white' : 'text-panel-muted'}`} onClick={() => setActiveTab('marketplace')}>Marketplace <span className="ml-1 text-xs opacity-70">{data.total}</span></button>
        <button className={`px-4 py-2 rounded-md text-sm font-medium ${activeTab === 'installed' ? 'bg-panel-accent text-white' : 'text-panel-muted'}`} onClick={() => setActiveTab('installed')}>Installed <span className="ml-1 text-xs opacity-70">{installed.total}</span></button>
      </div>

      {activeTab === 'marketplace' && (
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-panel-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search packages (nginx, redis, docker...)" className="input-field pl-9" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {data.categories.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)} className={`px-3 py-1.5 rounded-full text-xs border ${category === c.id ? 'bg-panel-accent border-panel-accent text-white' : 'bg-panel-card border-panel-border text-panel-muted hover:text-panel-text'}`}>{c.label}</button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'marketplace' && bulk.count > 0 && (
        <BulkBar count={bulk.count} onClear={bulk.clear} actions={[{ label: 'Install selected', icon: <Download size={13} />, onClick: bulkInstall }]} />
      )}

      {loading ? (
        <div className="panel-card h-40 flex items-center justify-center animate-pulse text-panel-muted">Loading packages...</div>
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
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isInst ? 'bg-panel-green/15 text-panel-green' : 'bg-panel-accent/15 text-panel-accent'}`}><Icon size={18} /></div>
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
