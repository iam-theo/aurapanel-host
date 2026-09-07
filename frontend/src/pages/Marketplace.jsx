import { useEffect, useState, useMemo, useRef } from 'react'
import { Search, Download, Check, Package, Boxes, Globe, Database, Server, Activity, RefreshCw, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { useNotify } from '../context/NotifyContext'
import { PageLoader, Spinner } from '../components/ui.jsx'
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
  // Install overlay: { id, name, jobId, idx, total, startedAt, log: [] }
  const [overlay, setOverlay] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const logRef = useRef(null)
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

  // Overlay elapsed timer
  useEffect(() => {
    if (!overlay) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [overlay?.jobId])

  // Keep overlay log tail pinned to bottom
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [overlay?.log?.length])

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  // Run one install with the overlay; resolves true on success
  const installOne = async (id, idx = 1, total = 1) => {
    const pkg = [...data.packages, ...installed.packages].find(p => p.id === id)
    const name = pkg?.name || id
    setInstalling(s => new Set([...s, id]))
    try {
      const r = await api.post('/packages/install', { id })
      setOverlay({ id, name, jobId: r.jobId, idx, total, startedAt: Date.now(), log: ['Starting install…'] })
      // poll until terminal state (up to ~10 min)
      for (let i = 0; i < 300; i++) {
        await sleep(2000)
        try {
          const j = await api.get(`/packages/jobs/${r.jobId}`)
          const lines = String(j.log || '').split('\n').filter(Boolean)
          setOverlay(o => o && o.jobId === r.jobId ? { ...o, log: lines.slice(-60) } : o)
          if (j.status !== 'running') {
            setOverlay(null)
            setInstalling(s => { const n = new Set(s); n.delete(id); return n })
            if (j.status === 'done') {
              notify.banner(`'${name}' installed successfully${total > 1 ? ` (${idx}/${total})` : ''}`, 'success', { title: 'Install complete' })
              return true
            }
            const lastLine = lines.slice(-1)[0] || 'unknown error'
            notify.banner(`'${name}' install failed${total > 1 ? ` (${idx}/${total})` : ''} — ${lastLine.slice(0, 160)}`, 'error', { title: 'Install failed' })
            return false
          }
        } catch {}
      }
      setOverlay(null)
      setInstalling(s => { const n = new Set(s); n.delete(id); return n })
      notify.banner(`'${name}' install timed out waiting for the job — check manually`, 'warning', { title: 'Install timed out' })
      return false
    } catch (e) {
      setOverlay(null)
      setInstalling(s => { const n = new Set(s); n.delete(id); return n })
      notify.banner(`'${name}' install failed to start — ${e.message}`, 'error', { title: 'Install failed' })
      return false
    }
  }

  const install = (id) => installOne(id).finally(() => { loadMarketplace(); loadInstalled() })

  const bulkInstall = async () => {
    const ids = [...bulk.selected]
    bulk.clear()
    for (let i = 0; i < ids.length; i++) {
      await installOne(ids[i], i + 1, ids.length)
      loadMarketplace(); loadInstalled()
    }
  }

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
          <div className="panel-card p-0 overflow-hidden">
            <div className="px-4 py-2.5 bg-panel-cardHover/50 border-b border-panel-border flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-panel-muted">
                {activeTab === 'marketplace' ? 'Package Index' : 'Installed Packages'}
              </span>
              <span className="font-mono text-[11px] text-panel-muted">Showing {paged.length} of {source.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-panel-muted border-b border-panel-border bg-panel-bg/50 uppercase tracking-wider">
                    {activeTab === 'marketplace' && <th className="px-2 py-2.5 w-8" />}
                    <th className="px-4 py-2.5 font-medium">Package</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">Description</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(pkg => {
                    const Icon = CAT_ICON[pkg.category] || Package
                    const isInst = pkg.installed
                    const isBusy = installing.has(pkg.id)
                    return (
                      <tr key={pkg.id} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50 transition-colors">
                        {activeTab === 'marketplace' && (
                          <td className="px-2 py-3"><input type="checkbox" className="accent-panel-accent" checked={bulk.has(pkg.id)} onChange={() => bulk.toggle(pkg.id)} /></td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isInst ? 'bg-panel-green/15 text-panel-green' : 'bg-panel-accent/15 text-panel-accentLight'}`}>
                              <Icon size={17} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-panel-text text-[13px] truncate">{pkg.name}</p>
                              <p className="text-[11px] text-panel-muted font-mono truncate">{pkg.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-panel-muted hidden md:table-cell max-w-[320px]"><span className="line-clamp-2">{pkg.desc}</span></td>
                        <td className="px-4 py-3"><span className="text-[11px] px-2 py-0.5 rounded-full bg-panel-cardHover text-panel-muted capitalize whitespace-nowrap">{pkg.category}</span></td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {isInst
                            ? <span className="status-badge online inline-flex items-center gap-1"><Check size={12} /> Installed</span>
                            : isBusy
                              ? <span className="inline-flex items-center gap-1.5 text-xs text-panel-accent"><Spinner size={13} /> Installing…</span>
                              : <span className="text-xs text-panel-muted">Available</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isInst
                            ? <span className="text-xs text-panel-muted font-mono">—</span>
                            : <button disabled={isBusy || overlay} onClick={() => install(pkg.id)}
                              className="btn-accent !py-1.5 !px-3 text-xs disabled:opacity-50">
                              {isBusy ? <><Loader2 size={13} className="animate-spin" /> Working…</> : <><Download size={13} /> Install</>}
                            </button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4"><Pagination page={page} totalPages={totalPages} onChange={setPage} total={source.length} pageSize={PAGE_SIZE} /></div>
          </div>
          {paged.length === 0 && <div className="text-center py-12 text-panel-muted">No packages found</div>}
        </>
      )}

      {/* Install overlay */}
      {overlay && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative w-full max-w-lg panel-card">
            <div className="flex items-center gap-3 mb-1">
              <Spinner size={22} className="text-panel-accent shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-panel-text truncate">Installing {overlay.name}</p>
                <p className="font-mono text-[11px] text-panel-muted">
                  {overlay.total > 1 ? `package ${overlay.idx} of ${overlay.total} · ` : ''}{elapsed}s elapsed · {overlay.log.length} log lines
                </p>
              </div>
            </div>
            <div className="h-1.5 bg-panel-cardHover rounded-full overflow-hidden my-3">
              <div className="route-progress h-full bg-panel-accent rounded-r" />
            </div>
            <div ref={logRef} className="bg-panel-bg border border-panel-border/50 rounded-lg p-3 font-mono text-[11px] leading-relaxed h-44 overflow-y-auto flex flex-col gap-0.5">
              {overlay.log.slice(-30).map((line, i) => (
                <div key={i} className="text-panel-muted whitespace-pre-wrap break-all">{line}</div>
              ))}
              <div className="flex items-center gap-1 text-panel-accent">
                <span>&gt;</span>
                <span className="w-2 h-3 bg-panel-accent animate-pulse inline-block" />
              </div>
            </div>
            <p className="text-[11px] text-panel-muted mt-3 font-mono">Running on the host — this can take a few minutes. The job continues server-side.</p>
          </div>
        </div>
      )}
    </div>
  )
}
