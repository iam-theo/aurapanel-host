import { useEffect, useState, useRef } from 'react'
import { Bot, Folder, Play, Square, RefreshCw, Layers, Clock, Loader2, ExternalLink, Copy, Shield, Activity, Server, Package, ScrollText, Sparkles, ChevronRight, Globe, Zap, ArrowUpRight } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes } from '../lib/utils'

export default function Aurex() {
  const [hostPath, setHostPath] = useState('/home/digital-auracle/apps')
  const [hostData, setHostData] = useState(null)
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectDetail, setProjectDetail] = useState(null)
  const [task, setTask] = useState('')
  const [model, setModel] = useState('opencode/big-pickle')
  const [models, setModels] = useState([])
  const [runs, setRuns] = useState([])
  const [activeRun, setActiveRun] = useState(null)
  const [events, setEvents] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [serverMode, setServerMode] = useState(true)
  const [serverCtx, setServerCtx] = useState(null)
  const [capabilities, setCapabilities] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const eventRef = useRef(null)

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const loadHostPath = async (path) => {
    try {
      const d = await api.get(`/aurex/host-paths?path=${encodeURIComponent(path)}`)
      setHostData(d); setHostPath(d.path)
    } catch (e) { toastMsg(e.message) }
  }
  const loadProjects = async () => {
    try {
      const d = await api.get('/aurex/projects')
      setProjects(Array.isArray(d) ? d : d.projects || [])
    } catch (e) { toastMsg('Aurex API: ' + e.message) }
  }
  const loadProjectDetail = async (id) => {
    try {
      const d = await api.get(`/aurex/projects/${id}`)
      setProjectDetail(d); setRuns(d.runs || [])
    } catch (e) { toastMsg(e.message) }
  }
  const loadModels = async () => {
    try {
      const d = await api.get('/aurex/models');
      const arr = Array.isArray(d) ? d : Array.isArray(d.models) ? d.models : Array.isArray(d?.models) ? d.models : [];
      setModels(arr);
    } catch {}
  }
  const loadWorkspace = async () => {
    try { const d = await api.get('/aurex/workspaces/me'); setWorkspace(d) } catch {}
  }
  const loadServerContext = async () => {
    try { const d = await api.get('/aurex/server-context'); setServerCtx(d) } catch {}
  }
  const loadCapabilities = async () => {
    try { const d = await api.get('/aurex/capabilities'); setCapabilities(d) } catch {}
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.allSettled([loadHostPath(hostPath), loadProjects(), loadModels(), loadWorkspace(), loadServerContext(), loadCapabilities()])
      setLoading(false)
    }
    init()
    const t = setInterval(loadProjects, 15000)
    const t2 = setInterval(() => { if (serverMode) loadServerContext() }, 20000)
    return () => { clearInterval(t); clearInterval(t2) }
  }, [])
  useEffect(() => { if (serverMode) loadServerContext() }, [serverMode])
  useEffect(() => { if (selectedProject) loadProjectDetail(selectedProject) }, [selectedProject])

  useEffect(() => {
    if (!activeRun) return
    setEvents([])
    const url = `/api/aurex/runs/${activeRun}/events`
    const es = new EventSource(url)
    es.addEventListener('event', (e) => {
      try {
        const d = JSON.parse(e.data)
        setEvents(prev => [...prev, d])
        eventRef.current?.scrollTo(0, eventRef.current.scrollHeight)
      } catch {}
    })
    es.addEventListener('run', (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.status) toastMsg(`Run ${d.status}`)
        if (d.status === 'completed' || d.status === 'failed') loadProjectDetail(selectedProject)
      } catch {}
    })
    es.onerror = () => { es.close() }
    return () => es.close()
  }, [activeRun])

  const createProjectFromHost = async () => {
    const name = hostPath.split('/').filter(Boolean).pop() || 'Host Project'
    try {
      const r = await api.post('/aurex/bridge/import', { hostPath, projectName: name })
      toastMsg(`Linked host ${hostPath} → project ${r.project?.name || name}`)
      await loadProjects()
      if (r.project?.id) setSelectedProject(r.project.id)
    } catch (e) { toastMsg(e.message) }
  }
  const createRun = async () => {
    if (!selectedProject || !task.trim()) return toastMsg('Select project and enter task')
    try {
      const r = await api.post('/aurex/runs', { projectId: selectedProject, task: task.trim(), model, hostPath, serverMode })
      toastMsg(`Run queued: ${r.id?.slice(0, 8)}${serverMode ? ' — server-mode (full context)' : ''}`)
      setTask('')
      setActiveRun(r.id)
      loadProjectDetail(selectedProject)
    } catch (e) { toastMsg(e.message) }
  }
  const abortRun = async (id) => {
    try { await api.post(`/aurex/runs/${id}/abort`); toastMsg('Abort requested') } catch (e) { toastMsg(e.message) }
  }
  const sendMessage = async () => {
    if (!activeRun || !chatInput.trim() || sending) return
    const text = chatInput.trim()
    setSending(true)
    try {
      await api.post(`/aurex/runs/${activeRun}/messages`, { text })
      setChatInput('')
      toastMsg('Message sent')
    } catch (e) { toastMsg(e.message) } finally { setSending(false) }
  }
  const answerQuestions = async (requestId, answers) => {
    if (!activeRun) return
    try {
      await api.post(`/aurex/runs/${activeRun}/questions`, { requestId, answers })
      toastMsg('Answers sent')
    } catch (e) { toastMsg(e.message) }
  }

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-28 bg-panel-card/50 rounded-2xl animate-pulse border border-white/5" />
      <div className="grid grid-cols-4 gap-4"><div className="h-24 bg-panel-card/40 rounded-xl animate-pulse" /><div className="h-24 bg-panel-card/40 rounded-xl animate-pulse" /><div className="h-24 bg-panel-card/40 rounded-xl animate-pulse" /><div className="h-24 bg-panel-card/40 rounded-xl animate-pulse" /></div>
      <div className="h-96 bg-panel-card/30 rounded-2xl animate-pulse" />
    </div>
  )

  return (
    <div className="p-6 md:p-8 space-y-6 bg-[#0f1115] min-h-full">
      {toast && <div className="fixed top-5 right-5 z-50 bg-[#1a1d24] border border-violet-500/30 text-white px-4 py-3 rounded-xl text-sm shadow-2xl flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />{toast}</div>}

      {/* Enterprise header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#1a1d24] via-[#1e2128] to-[#161a22] p-6 md:p-7">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-600/[0.04] via-transparent to-indigo-600/[0.04]" />
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-600/20 ring-1 ring-white/10">
              <Bot size={22} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[22px] font-semibold tracking-tight text-white">Aurex</h1>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-widest uppercase px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-white/80">
                  <Sparkles size={11} className="text-violet-400" /> Enterprise
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Full Server Mode
                </span>
              </div>
              <p className="text-[13px] text-white/55 mt-1.5 max-w-[560px] leading-relaxed">Autonomous operator for the entire server — applications, services, logs, updates and infrastructure. One agent, complete visibility.</p>
              <div className="flex items-center gap-2 mt-3 text-[11px] text-white/40">
                <span className="inline-flex items-center gap-1"><Globe size={11} /> {serverCtx?.system?.hostname || 'digital-auracle'}</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span className="inline-flex items-center gap-1"><Clock size={11} /> {serverCtx?.system?.uptime || '—'}</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span className="text-white/60">{capabilities?.tools || 38} tools</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className={`group relative inline-flex items-center gap-2.5 px-4 py-2 rounded-full border text-xs font-medium cursor-pointer transition-all ${serverMode ? 'bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-600/20' : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.06]'}`}>
              <input type="checkbox" checked={serverMode} onChange={e => setServerMode(e.target.checked)} className="sr-only" />
              <Server size={13} className={serverMode ? 'text-white' : 'text-white/60'} />
              Server Mode
              <span className={`w-7 h-4 rounded-full p-0.5 flex items-center transition-colors ${serverMode ? 'bg-white/20 justify-end' : 'bg-white/10 justify-start'}`}>
                <span className="w-3 h-3 rounded-full bg-white shadow" />
              </span>
            </label>
            <span className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border ${workspace ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${workspace ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />{workspace ? 'Workspace ready' : 'Workspace pending'}
            </span>
            <button className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors" onClick={() => { loadProjects(); loadHostPath(hostPath); loadWorkspace(); loadServerContext() }} title="Refresh"><RefreshCw size={15} /></button>
            <a href="https://aurex.sflbk.com" target="_blank" rel="noreferrer" className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white text-[#0f1115] text-xs font-semibold hover:bg-white/90 transition-colors">Open Aurex <ArrowUpRight size={13} /></a>
          </div>
        </div>
      </div>

      {/* Live snapshot — enterprise metrics */}
      {serverMode && serverCtx && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Applications', icon: Activity, value: Array.isArray(serverCtx.pm2) ? serverCtx.pm2.length : '—', sub: Array.isArray(serverCtx.pm2) ? `${serverCtx.pm2.filter(a=>a.status==='online').length} online · ${serverCtx.pm2.filter(a=>a.status!=='online').length} stopped` : '', meta: `Docker: ${Array.isArray(serverCtx.docker) ? serverCtx.docker.length : '—'} containers`, accent: 'violet' },
            { label: 'Services', icon: Server, value: `${serverCtx.services?.filter(s=>s.active==='active').length ?? '—'}`, total: `/${serverCtx.services?.length ?? '?'}`, sub: serverCtx.services?.filter(s=>s.active!=='active').map(s=>s.name).join(', ') || 'All nominal', meta: `Nginx: ${serverCtx.nginx?.count ?? 0} sites`, accent: 'emerald' },
            { label: 'Updates', icon: Package, value: serverCtx.updates ? `${String(serverCtx.updates).split('\n').filter(Boolean).length}` : '—', sub: 'packages', meta: String(serverCtx.updates || 'checking…').split('\n').slice(0,1).join('').slice(0,52) || 'apt upgradable', accent: 'amber' },
            { label: 'System', icon: ScrollText, value: `${serverCtx.system?.cpu?.load ?? '?'}%`, sub: 'CPU load', meta: `MEM ${serverCtx.system?.memory?.pct ?? '?'}% · ${serverCtx.system?.disk?.[0]?.use ?? '?'}% disk`, accent: 'blue' },
          ].map(card => (
            <div key={card.label} className="relative overflow-hidden rounded-2xl bg-[#1a1d24] border border-white/[0.06] p-4 hover:border-white/[0.09] transition-colors group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-widest uppercase text-white/40 flex items-center gap-1.5"><card.icon size={12} className="text-white/50" />{card.label}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${card.accent==='violet'?'bg-violet-400':card.accent==='emerald'?'bg-emerald-400':card.accent==='amber'?'bg-amber-400':'bg-sky-400'}`} />
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[26px] font-semibold tracking-tight text-white leading-none">{card.value}</span>
                  {card.total && <span className="text-xs text-white/40 font-medium">{card.total}</span>}
                  {card.sub && <span className="text-xs text-white/40 ml-1">{card.sub}</span>}
                </div>
                <p className="text-[11px] text-white/35 mt-1.5 truncate">{card.meta}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {serverMode && capabilities && (
        <div className="flex flex-wrap items-center gap-3 text-xs px-4 py-3 rounded-2xl bg-[#1a1d24] border border-white/[0.06]">
          <span className="inline-flex items-center gap-1.5 text-white/60"><Shield size={13} className="text-emerald-400" /> <span className="font-medium text-white/80">Control plane</span> — {capabilities.tools} tools · {capabilities.capabilities?.slice(0,4).join(' · ')}</span>
          <span className="h-4 w-px bg-white/10 hidden sm:block" />
          <span className="text-white/30 hidden sm:inline">{capabilities.capabilities?.slice(4).join(' · ')}</span>
          <span className="ml-auto inline-flex items-center gap-2">
            <a href="/api/aurex/server-context" target="_blank" className="text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">server-context <ArrowUpRight size={11} /></a>
            <span className="text-white/15">·</span>
            <a href="/api/aurex/tools" target="_blank" className="text-violet-300 hover:text-violet-200">tools</a>
            <span className="text-white/15">·</span>
            <a href="/api/logs" target="_blank" className="text-violet-300 hover:text-violet-200">logs</a>
            <span className="text-white/15">·</span>
            <a href="/api/updates" target="_blank" className="text-violet-300 hover:text-violet-200">updates</a>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Host Path — enterprise file explorer */}
        <div className="xl:col-span-4 rounded-2xl bg-[#1a1d24] border border-white/[0.06] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center"><Folder size={14} className="text-white/70" /></span>Environment</h3>
            <span className="text-[11px] px-2 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/50 font-mono">Host FS</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#0f1115] border border-white/[0.06]">
              <div className="w-6 h-6 rounded-lg bg-violet-600/15 border border-violet-500/20 flex items-center justify-center"><Server size={11} className="text-violet-300" /></div>
              <code className="flex-1 text-xs font-mono text-white/80 truncate">{hostPath}</code>
              <button onClick={() => navigator.clipboard?.writeText(hostPath)} className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"><Copy size={12} /></button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(hostData?.allowedRoots || []).slice(0, 6).map(r => (
                <button key={r} onClick={() => loadHostPath(r)} className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${hostPath===r ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:bg-white/[0.06]'}`}>{r.split('/').pop() || '/'}</button>
              ))}
            </div>
          </div>
          <div className="mx-4 rounded-xl border border-white/[0.06] overflow-hidden bg-[#0f1115] flex-1 flex flex-col min-h-[280px]">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
              <button disabled={hostPath === '/'} onClick={() => loadHostPath(hostPath.split('/').slice(0, -1).join('/') || '/')} className="text-xs px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-white/70 hover:text-white disabled:opacity-30 flex items-center gap-1"><ChevronRight size={12} className="rotate-180" />Up</button>
              <span className="text-[11px] font-mono text-white/30 truncate flex-1 text-center px-2">{hostPath}</span>
              <button onClick={createProjectFromHost} className="text-xs px-3 py-1 rounded-full bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors inline-flex items-center gap-1"><Zap size={11} />Link</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03]">
              {hostData?.entries?.map(e => (
                <button key={e.path} onClick={() => e.isDirectory && loadHostPath(e.path)} className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between hover:bg-white/[0.04] transition-colors group ${e.isDirectory ? 'text-white/80' : 'text-white/40'}`}>
                  <span className="flex items-center gap-2.5 truncate text-[13px]"><span className={`w-6 h-6 rounded-lg flex items-center justify-center border ${e.isDirectory ? 'bg-sky-500/10 border-sky-500/20 text-sky-300' : 'bg-white/[0.04] border-white/10 text-white/30'}`}><Folder size={12} /></span>{e.name}</span>
                  <span className="text-[11px] text-white/25 font-mono flex items-center gap-1">{e.isDirectory ? <ChevronRight size={12} className="text-white/20 group-hover:text-white/40" /> : formatBytes(e.size)}</span>
                </button>
              ))}
              {hostData?.entries?.length === 0 && <p className="p-8 text-sm text-white/30 text-center">Empty directory</p>}
            </div>
          </div>
          <p className="px-5 py-3 text-[11px] leading-relaxed text-white/30 border-t border-white/[0.06] mt-4 bg-white/[0.02]">Linked via <code className="font-mono text-white/50 bg-white/[0.06] px-1 py-0.5 rounded">bridge/import</code> — agent receives host path as task context.</p>
        </div>

        {/* Projects & Tasks */}
        <div className="xl:col-span-8 rounded-2xl bg-[#1a1d24] border border-white/[0.06] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-violet-600/15 border border-violet-500/20 flex items-center justify-center"><Layers size={13} className="text-violet-300" /></span>Projects & Tasks</h3>
            <span className="text-[11px] px-2 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/40">{projects.length} projects</span>
          </div>
          <div className="p-5 space-y-5">
            {/* Run Task */}
            <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-600/[0.08] via-indigo-600/[0.05] to-transparent p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-white flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-violet-600 flex items-center justify-center"><Play size={12} className="text-white fill-white" /></span>Run Task</p>
                <span className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${serverMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'}`}>{serverMode ? 'Full server context' : 'Host path only'}</span>
              </div>
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="text-[11px] font-medium tracking-widest uppercase text-white/40">Project</label>
                    <select value={selectedProject || ''} onChange={e => setSelectedProject(e.target.value || null)} className="mt-1.5 w-full bg-[#0f1115] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/40 focus:ring-2 focus:ring-violet-500/10">
                      <option value="">Select project…</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p._count?.runs ?? p.runs?.length ?? 0} runs)</option>)}
                    </select>
                    {projects.length === 0 && <p className="text-[11px] text-amber-300/70 mt-1.5">No projects — link a host path first</p>}
                  </div>
                  <div>
                    <label className="text-[11px] font-medium tracking-widest uppercase text-white/40">Context</label>
                    <div className="mt-1.5 bg-[#0f1115] rounded-xl px-3 py-2.5 border border-white/[0.06] flex items-center gap-2">
                      <Server size={12} className="text-violet-400 shrink-0" />
                      <code className="text-xs font-mono text-violet-300 truncate">{hostPath}</code>
                    </div>
                  </div>
                </div>
                <textarea value={task} onChange={e => setTask(e.target.value)} placeholder={serverMode ? "Describe task with full server awareness — e.g. 'Audit PM2 + Docker, tail error logs last hour, check apt security updates and report'" : "Describe the task — e.g. 'Fix nginx config for /home/panel/apps/myapp, add tests'"} rows={4} className="w-full bg-[#0f1115] border border-white/[0.08] rounded-xl px-3.5 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/40 focus:ring-2 focus:ring-violet-500/10 resize-none" />
                {serverMode && (
                  <div className="flex gap-1.5 flex-wrap">
                    {['Audit apps & services', 'Tail error logs (1h)', 'Check security updates', 'Restart failed services'].map(p => (
                      <button key={p} onClick={() => setTask(p)} className="text-[11px] px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/60 hover:text-white hover:bg-white/[0.08] hover:border-white/15 transition-colors">{p}</button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2.5">
                  <select value={model} onChange={e => setModel(e.target.value)} className="flex-1 bg-[#0f1115] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-violet-500/40">
                    <option value="opencode/big-pickle">opencode/big-pickle</option>
                    {models.map(m => <option key={m.model || m.id} value={m.model}>{m.label || m.model}</option>)}
                  </select>
                  <button onClick={createRun} disabled={!selectedProject || !task.trim()} className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center gap-2 shadow-lg shadow-violet-600/20 transition-colors"><Play size={14} className="fill-white" />Run</button>
                </div>
                {!selectedProject && <p className="text-xs text-amber-300/60">Select a project to enable Run</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] bg-[#0f1115] overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
                  <p className="text-xs font-medium text-white/60">Projects</p>
                  <span className="text-[11px] text-white/30">{projects.length}</span>
                </div>
                <div className="max-h-[220px] overflow-y-auto divide-y divide-white/[0.04]">
                  {projects.map(p => (
                    <button key={p.id} onClick={() => setSelectedProject(p.id)} className={`w-full text-left px-3.5 py-3 flex items-center justify-between hover:bg-white/[0.04] transition-colors ${selectedProject === p.id ? 'bg-violet-600/[0.08] border-l-2 border-violet-500' : 'border-l-2 border-transparent'}`}>
                      <span className="font-medium text-sm text-white truncate pr-3">{p.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/50 shrink-0">{p._count?.runs ?? p.runs?.length ?? 0}</span>
                    </button>
                  ))}
                  {projects.length === 0 && <p className="p-8 text-sm text-white/30 text-center">No projects — link a host path</p>}
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-5 flex flex-col items-center justify-center text-center">
                <div className="w-9 h-9 rounded-xl bg-violet-600/15 border border-violet-500/20 flex items-center justify-center mb-3"><Zap size={14} className="text-violet-300" /></div>
                <p className="text-sm font-medium text-white">Quick Link</p>
                <p className="text-xs text-white/40 mt-1 font-mono truncate max-w-full">{hostPath}</p>
                <button onClick={createProjectFromHost} className="mt-3 text-xs px-4 py-2 rounded-full bg-white text-[#0f1115] font-semibold hover:bg-white/90 transition-colors">Link this path</button>
              </div>
            </div>

            {projectDetail && (
              <div className="rounded-xl border border-white/[0.06] bg-[#0f1115] overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
                  <span className="text-xs font-medium text-white/60">Recent Runs</span>
                  <span className="text-xs font-mono text-violet-300">{projectDetail.name}</span>
                  <span className="ml-auto text-[11px] text-white/30">{runs.length} runs</span>
                </div>
                <div className="divide-y divide-white/[0.04] max-h-[280px] overflow-y-auto">
                  {runs.map(r => (
                    <div key={r.id} className={`flex items-center justify-between px-3.5 py-3 ${activeRun === r.id ? 'bg-violet-600/[0.06]' : 'hover:bg-white/[0.02]'}`}>
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="text-sm text-white/80 truncate">{r.task?.slice(0, 90) || '—'}</p>
                        <p className="text-xs text-white/30 flex items-center gap-2 mt-1"><Clock size={10} />{new Date(r.createdAt).toLocaleString()} <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${r.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : r.status === 'failed' ? 'bg-red-500/10 text-red-300 border-red-500/20' : r.status === 'running' ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-white/5 text-white/40 border-white/10'}`}>{r.status}</span></p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => setActiveRun(r.id)} className="px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/[0.08]">Watch</button>
                        {(r.status === 'running' || r.status === 'queued') && <button onClick={() => abortRun(r.id)} className="w-8 h-8 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center text-red-300 hover:bg-red-500/20"><Square size={12} /></button>}
                      </div>
                    </div>
                  ))}
                  {runs.length === 0 && <p className="text-sm text-white/30 text-center py-10">No runs yet</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeRun && (
        <div className="rounded-2xl bg-[#1a1d24] border border-white/[0.06] overflow-hidden flex flex-col" style={{ height: '560px' }}>
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0f1115]/50">
            <h3 className="font-semibold text-white flex items-center gap-2.5"><span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center"><ScrollText size={13} className="text-emerald-300" /></span>Live Session <span className="font-mono text-xs text-white/30">{activeRun.slice(0, 8)}</span> <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20 text-amber-300 animate-pulse">● live</span></h3>
            <div className="flex gap-2">
              <button onClick={() => setActiveRun(null)} className="px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white/60 hover:text-white">Close</button>
              <button onClick={() => abortRun(activeRun)} className="px-3 py-1.5 rounded-full bg-red-500/15 border border-red-500/20 text-xs text-red-300 hover:bg-red-500/20 inline-flex items-center gap-1"><Square size={11} />Abort</button>
            </div>
          </div>
          <div ref={eventRef} className="flex-1 overflow-y-auto space-y-3 bg-[#0a0c10] p-4">
            {events.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-white/30">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-3"><Loader2 size={18} className="animate-spin text-white/40" /></div>
                <p className="text-xs">Waiting for agent…</p>
                <p className="text-[11px] text-white/20 mt-1">tools: read · write · edit · bash · grep · todo</p>
              </div>
            ) : events.map((e, i) => {
              const d = e.data || {}
              const isUser = d.role === 'user' || e.type === 'message'
              const isTool = d.part?.tool
              const isQuestion = e.type === 'question' || d.questions
              if (isQuestion && d.questions) {
                return (
                  <div key={i} className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4">
                    <p className="text-xs font-semibold text-amber-300 mb-2">Agent asks</p>
                    {d.questions.map((q, qi) => (
                      <div key={qi} className="mb-2 last:mb-0">
                        <p className="text-sm text-white">{q.question}</p>
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {q.options?.map((opt, oi) => (
                            <button key={oi} onClick={() => answerQuestions(d.requestId, [[opt.label]])} className="text-xs px-3 py-1.5 rounded-full bg-white text-[#0f1115] hover:bg-white/90 font-medium">{opt.label}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
              if (isTool) {
                const part = d.part
                const input = part?.state?.input || {}
                const output = part?.state?.output || part?.state?.metadata?.output || ''
                const title = part?.state?.title || part?.tool
                return (
                  <div key={i} className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5">
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <span className="w-6 h-6 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-[10px] font-mono text-white/70">{(part.tool || '').slice(0, 2)}</span>
                      <span className="font-mono text-white/80 text-xs">{title}</span>
                      <span className="ml-auto text-[10px] text-white/25">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    </div>
                    {input.filePath && <p className="text-xs font-mono text-white/30 mt-2 truncate">{input.filePath}</p>}
                    {input.command && <p className="text-xs font-mono bg-[#0f1115] border border-white/5 rounded-lg px-2.5 py-2 mt-2 text-white/60">$ {input.command}</p>}
                    {output && <pre className="text-xs font-mono bg-[#0f1115] border border-white/5 rounded-lg p-3 mt-2 max-h-[140px] overflow-y-auto whitespace-pre-wrap text-white/60">{output.slice(0, 1500)}</pre>}
                  </div>
                )
              }
              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20' : 'bg-white/[0.06] text-white border border-white/10'}`}>
                    <p className="whitespace-pre-wrap">{d.text || d.part?.text || JSON.stringify(d).slice(0, 800)}</p>
                    <p className="text-[10px] opacity-50 mt-1.5">{new Date(e.createdAt).toLocaleTimeString()} · {e.type}</p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="p-3 border-t border-white/[0.06] bg-[#0f1115]/50 flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} placeholder="Ask follow-up… (Shift+Enter for newline)" className="flex-1 bg-[#1a1d24] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/40" />
            <button onClick={sendMessage} disabled={!chatInput.trim() || sending} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 text-white text-sm font-medium inline-flex items-center gap-1.5">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <><ScrollText size={13} />Send</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
