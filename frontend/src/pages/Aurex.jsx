import { useEffect, useState, useRef } from 'react'
import { Bot, RefreshCw, Clock, Loader2, ExternalLink, Shield, Activity, Server, Package, ScrollText, Sparkles, Globe, Zap, ArrowUpRight, MessageSquare, Plus, Square, Send, ChevronDown, Wrench, FileCode, Terminal, Search, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'

export default function Aurex() {
  const [hostPath] = useState('/home/digital-auracle/apps')
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectDetail, setProjectDetail] = useState(null)
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
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const eventRef = useRef(null)
  const textareaRef = useRef(null)

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const loadProjects = async () => {
    try {
      const d = await api.get('/aurex/projects')
      const arr = Array.isArray(d) ? d : d.projects || []
      setProjects(arr)
      if (!selectedProject && arr.length) setSelectedProject(arr[0].id)
      return arr
    } catch (e) { toastMsg('Aurex API: ' + e.message); return [] }
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
  const loadWorkspace = async () => { try { const d = await api.get('/aurex/workspaces/me'); setWorkspace(d) } catch {} }
  const loadServerContext = async () => { try { const d = await api.get('/aurex/server-context'); setServerCtx(d) } catch {} }
  const loadCapabilities = async () => { try { const d = await api.get('/aurex/capabilities'); setCapabilities(d) } catch {} }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      const projs = await loadProjects()
      await Promise.allSettled([loadModels(), loadWorkspace(), loadServerContext(), loadCapabilities()])
      if (projs.length) loadProjectDetail(projs[0].id)
      setLoading(false)
    }
    init()
    const t = setInterval(loadProjects, 15000)
    const t2 = setInterval(() => { if (serverMode) loadServerContext() }, 20000)
    return () => { clearInterval(t); clearInterval(t2) }
  }, [])
  useEffect(() => { if (serverMode) loadServerContext() }, [serverMode])
  useEffect(() => { if (selectedProject) loadProjectDetail(selectedProject) }, [selectedProject])

  // SSE
  useEffect(() => {
    if (!activeRun) return
    setEvents([])
    const url = `/api/aurex/runs/${activeRun}/events`
    const es = new EventSource(url)
    es.addEventListener('event', (e) => {
      try {
        const d = JSON.parse(e.data)
        setEvents(prev => [...prev, d])
        setTimeout(() => eventRef.current?.scrollTo({ top: eventRef.current.scrollHeight, behavior: 'smooth' }), 50)
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
  }, [activeRun, selectedProject])

  const ensureProjectId = async () => {
    if (selectedProject) return selectedProject
    if (projects.length) { setSelectedProject(projects[0].id); return projects[0].id }
    // create a default server project
    try {
      const r = await api.post('/aurex/bridge/import', { hostPath, projectName: 'Server Chat' })
      const id = r.project?.id
      if (id) { await loadProjects(); setSelectedProject(id); return id }
    } catch (e) { toastMsg(e.message) }
    throw new Error('No project available — link a host path first')
  }

  const handleComposerSend = async () => {
    const text = composer.trim()
    if (!text || sending) return
    setSending(true)
    try {
      if (!activeRun) {
        const pid = await ensureProjectId()
        const r = await api.post('/aurex/runs', { projectId: pid, task: text, model, hostPath, serverMode })
        toastMsg(`Started ${r.id?.slice(0, 8)}`)
        setComposer('')
        setActiveRun(r.id)
        // optimistic user bubble
        setEvents(prev => [...prev, { type: 'message', data: { role: 'user', text }, createdAt: new Date().toISOString() }])
        loadProjectDetail(pid)
      } else {
        await api.post(`/aurex/runs/${activeRun}/messages`, { text })
        setEvents(prev => [...prev, { type: 'message', data: { role: 'user', text }, createdAt: new Date().toISOString() }])
        setComposer('')
        toastMsg('Message sent')
      }
    } catch (e) { toastMsg(e.message) } finally { setSending(false) }
  }

  const abortRun = async (id) => {
    try { await api.post(`/aurex/runs/${id || activeRun}/abort`); toastMsg('Abort requested') } catch (e) { toastMsg(e.message) }
  }
  const answerQuestions = async (requestId, answers) => {
    if (!activeRun) return
    try { await api.post(`/aurex/runs/${activeRun}/questions`, { requestId, answers }); toastMsg('Answers sent') } catch (e) { toastMsg(e.message) }
  }
  const newChat = () => { setActiveRun(null); setEvents([]); setComposer('') }

  // auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }, [composer])

  if (loading) return (
    <div className="p-8 space-y-4 bg-[#0f1115] min-h-full">
      <div className="h-28 bg-[#1a1d24] rounded-2xl animate-pulse border border-white/5" />
      <div className="max-w-3xl mx-auto space-y-3 pt-12">
        <div className="h-6 w-2/3 bg-white/5 rounded-full animate-pulse mx-auto" />
        <div className="h-4 w-1/2 bg-white/5 rounded-full animate-pulse mx-auto" />
        <div className="grid grid-cols-2 gap-3 pt-6"><div className="h-20 bg-white/[0.03] rounded-2xl animate-pulse" /><div className="h-20 bg-white/[0.03] rounded-2xl animate-pulse" /><div className="h-20 bg-white/[0.03] rounded-2xl animate-pulse" /><div className="h-20 bg-white/[0.03] rounded-2xl animate-pulse" /></div>
      </div>
    </div>
  )

  const suggestions = [
    { icon: Activity, title: 'Audit server health', desc: 'Check PM2, Docker & services', prompt: 'Audit all PM2 apps, Docker containers and systemd services — report health, restarts and failures' },
    { icon: ScrollText, title: 'Fix error logs', desc: 'Tail logs from last hour', prompt: 'Tail error logs from the last hour across syslog, PM2 and Docker — summarize issues and fix them' },
    { icon: Package, title: 'Security updates', desc: 'Review apt upgrades', prompt: 'Check apt security updates, list upgradable packages and assess if a reboot is required' },
    { icon: AlertTriangle, title: 'Recover failed services', desc: 'Restart stopped apps', prompt: 'Find and restart any failed or stopped PM2 apps and Docker containers, then verify they are online' },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#0f1115]">
      {toast && <div className="fixed top-5 right-5 z-50 bg-[#1a1d24] border border-violet-500/30 text-white px-4 py-3 rounded-xl text-sm shadow-2xl flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />{toast}</div>}

      {/* Enterprise header — slim */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0f1115]/80 backdrop-blur supports-[backdrop-filter]:bg-[#0f1115]/60">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow shadow-violet-600/20 ring-1 ring-white/10 shrink-0"><Bot size={16} className="text-white" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white tracking-tight">Aurex</span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60"><Sparkles size={10} className="text-violet-400" />Enterprise</span>
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${serverMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'}`}><span className={`w-1.5 h-1.5 rounded-full ${serverMode ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />{serverMode ? 'Full server' : 'Host only'}</span>
              </div>
              <div className="hidden md:flex items-center gap-1.5 text-[11px] text-white/35 mt-0.5">
                <Globe size={11} />{serverCtx?.system?.hostname || 'digital-auracle'} <span className="w-1 h-1 rounded-full bg-white/15" /> {serverCtx?.system?.uptime || ''} <span className="w-1 h-1 rounded-full bg-white/15" /> {capabilities?.tools || 38} tools
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={newChat} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white text-[#0f1115] text-xs font-semibold hover:bg-white/90"><Plus size={13} />New chat</button>
            <div className="hidden sm:flex items-center gap-1 ml-1">
              <button onClick={() => setShowHistory(v=>!v)} className={`px-3 py-2 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 ${showHistory ? 'bg-white text-[#0f1115] border-white' : 'bg-white/[0.06] border-white/10 text-white/70 hover:text-white'}`}><MessageSquare size={13} />History<ChevronDown size={12} className={`transition-transform ${showHistory?'rotate-180':''}`} /></button>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white/60 hover:text-white cursor-pointer"><Server size={12} /><input type="checkbox" checked={serverMode} onChange={e=>setServerMode(e.target.checked)} className="sr-only" />{serverMode?'Server':'Host'}</label>
              <span className={`hidden lg:inline-flex items-center gap-1 px-2.5 py-2 rounded-full text-xs border ${workspace ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}><span className={`w-1.5 h-1.5 rounded-full ${workspace?'bg-emerald-400':'bg-amber-400'} animate-pulse`} />{workspace?'Ready':'Pending'}</span>
            </div>
            <button onClick={() => { loadProjects(); if(selectedProject) loadProjectDetail(selectedProject); loadServerContext() }} className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/50 hover:text-white"><RefreshCw size={13} /></button>
            <a href="https://aurex.sflbk.com" target="_blank" rel="noreferrer" className="hidden md:inline-flex w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 items-center justify-center text-white/50 hover:text-white"><ExternalLink size={13} /></a>
          </div>
        </div>
        {/* compact server bar */}
        {serverMode && serverCtx && (
          <div className="px-4 md:px-6 pb-3 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><Activity size={11} className="text-violet-400" />{Array.isArray(serverCtx.pm2)?serverCtx.pm2.filter(a=>a.status==='online').length:0} PM2 online · {Array.isArray(serverCtx.docker)?serverCtx.docker.length:0} Docker</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><Server size={11} className="text-emerald-400" />{serverCtx.services?.filter(s=>s.active==='active').length ?? 0}/{serverCtx.services?.length ?? 0} services</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><Package size={11} className="text-amber-400" />{String(serverCtx.updates||'').split('\n').filter(Boolean).length || 0} updates</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><ScrollText size={11} className="text-sky-400" />CPU {serverCtx.system?.cpu?.load ?? '?'}% · MEM {serverCtx.system?.memory?.pct ?? '?'}%</span>
            <span className="ml-auto hidden lg:inline-flex items-center gap-1 text-white/25"><Shield size={11} className="text-emerald-400" />{capabilities?.tools || 38} tools · server-context · logs · updates</span>
          </div>
        )}
        {/* history dropdown */}
        {showHistory && (
          <div className="px-4 md:px-6 pb-3">
            <div className="rounded-2xl bg-[#1a1d24] border border-white/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-white/60">Recent chats</span>
                <select value={selectedProject || ''} onChange={e=>setSelectedProject(e.target.value)} className="bg-[#0f1115] border border-white/10 rounded-full px-2.5 py-1 text-xs text-white">
                  <option value="">Select project</option>
                  {projects.map(p=> <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1 max-h-[220px] overflow-y-auto">
                {runs.slice(0, 10).map(r=> (
                  <button key={r.id} onClick={()=>{ setActiveRun(r.id); setShowHistory(false)}} className={`w-full text-left px-3 py-2 rounded-xl border flex items-center justify-between ${activeRun===r.id ? 'bg-violet-600/15 border-violet-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-white/70 hover:bg-white/[0.06]'}`}>
                    <span className="text-xs truncate pr-3">{r.task?.slice(0, 70) || 'Untitled'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${r.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/20': r.status==='running'?'bg-amber-500/15 text-amber-300 border-amber-500/20':'bg-white/5 text-white/40 border-white/10'}`}>{r.status}</span>
                  </button>
                ))}
                {runs.length===0 && <p className="text-xs text-white/30 text-center py-6">No chats yet — start a new one</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat thread — ChatGPT/Claude/Gemini style */}
      <div ref={eventRef} className="flex-1 overflow-y-auto">
        <div className="max-w-[800px] mx-auto w-full px-4 md:px-6 py-8">
          {!activeRun && events.length===0 ? (
            <div className="space-y-8">
              <div className="text-center pt-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-violet-600/20 ring-1 ring-white/10"><Bot size={22} className="text-white" /></div>
                <h2 className="text-[22px] font-semibold text-white tracking-tight mt-4">How can Aurex help?</h2>
                <p className="text-sm text-white/45 mt-2 max-w-[520px] mx-auto leading-relaxed">Chat with your server operator — Aurex can monitor apps, read logs, manage services and apply updates. Full server context is already loaded.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {suggestions.map(s=> (
                  <button key={s.title} onClick={()=> setComposer(s.prompt)} className="text-left p-4 rounded-2xl bg-[#1a1d24] border border-white/[0.06] hover:border-white/10 hover:bg-[#1e2128] transition-colors group">
                    <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center group-hover:bg-violet-600/15 group-hover:border-violet-500/20 transition-colors"><s.icon size={14} className="text-white/60 group-hover:text-violet-300" /></div>
                    <p className="text-sm font-medium text-white mt-3">{s.title}</p>
                    <p className="text-xs text-white/40 mt-1">{s.desc}</p>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/25">
                <span className="inline-flex items-center gap-1"><Zap size={10} />Try:</span>
                <button onClick={()=>setComposer('Summarize the last hour of nginx and PM2 error logs')} className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 hover:bg-white/[0.06] text-white/50 hover:text-white/80">Summarize error logs</button>
                <button onClick={()=>setComposer('Show pending security updates and whether a reboot is needed')} className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 hover:bg-white/[0.06] text-white/50 hover:text-white/80">Security updates</button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* active run header */}
              {activeRun && (
                <div className="flex items-center justify-between text-xs text-white/30 border border-white/5 rounded-full px-3 py-2 bg-white/[0.02]">
                  <span className="inline-flex items-center gap-2"><MessageSquare size={12} />{activeRun.slice(0, 8)} · {events.length} events</span>
                  <span className="inline-flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />live <button onClick={()=>abortRun()} className="ml-2 px-2 py-1 rounded-full bg-red-500/15 border border-red-500/20 text-red-300 hover:bg-red-500/20 inline-flex items-center gap-1"><Square size={10} />Stop</button></span>
                </div>
              )}
              {events.map((e, i) => {
                const d = e.data || {}
                const isUser = d.role === 'user' || (!d.part?.tool && d.text && e.type === 'message')
                const isTool = !!d.part?.tool
                const isQuestion = e.type === 'question' || d.questions
                if (isQuestion && d.questions) {
                  return (
                    <div key={i} className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4">
                      <p className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5"><AlertTriangle size={12} />Aurex needs input</p>
                      {d.questions.map((q, qi)=> (
                        <div key={qi} className="mb-3 last:mb-0">
                          <p className="text-sm text-white">{q.question}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {q.options?.map((opt, oi)=> (
                              <button key={oi} onClick={()=>answerQuestions(d.requestId, [[opt.label]])} className="text-xs px-3 py-1.5 rounded-full bg-white text-[#0f1115] hover:bg-white/90 font-medium">{opt.label}</button>
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
                  const title = part?.state?.title || part?.tool || 'tool'
                  const icon = title.toLowerCase().includes('read') ? FileCode : title.toLowerCase().includes('bash') || title.toLowerCase().includes('exec') ? Terminal : title.toLowerCase().includes('grep') || title.toLowerCase().includes('search') ? Search : Wrench
                  const Icon = icon
                  return (
                    <div key={i} className="rounded-2xl bg-[#1a1d24] border border-white/[0.06] overflow-hidden">
                      <div className="px-4 py-3 flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center"><Icon size={13} className="text-white/60" /></span>
                        <span className="text-sm font-medium text-white/80">{title}</span>
                        <span className="text-[11px] font-mono text-white/25 truncate flex-1">{input.filePath || input.command || input.pattern || ''}</span>
                        <span className="text-[11px] text-white/20">{new Date(e.createdAt).toLocaleTimeString()}</span>
                      </div>
                      {(input.filePath || input.command) && (
                        <div className="mx-3 mb-3 rounded-xl bg-[#0f1115] border border-white/5 px-3 py-2">
                          {input.filePath && <p className="text-xs font-mono text-white/40 truncate">{input.filePath}</p>}
                          {input.command && <p className="text-xs font-mono text-violet-300">$ {input.command}</p>}
                        </div>
                      )}
                      {output && <pre className="mx-3 mb-3 rounded-xl bg-[#0f1115] border border-white/5 p-3 text-xs font-mono text-white/55 max-h-[180px] overflow-y-auto whitespace-pre-wrap">{output.slice(0, 2500)}</pre>}
                    </div>
                  )
                }
                // regular chat bubbles — ChatGPT/Claude style: user right, assistant left with avatar
                const text = d.text || d.part?.text || (typeof d === 'string' ? d : '') || JSON.stringify(d).slice(0, 800)
                if (!text) return null
                return (
                  <div key={i} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {!isUser && <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shrink-0 mt-1"><Bot size={13} className="text-white" /></div>}
                    <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap ${isUser ? 'bg-violet-600 text-white shadow shadow-violet-600/20' : 'bg-[#1e2128] text-white/85 border border-white/[0.06]'}`}>
                      {text}
                      <div className={`text-[10px] mt-2 flex items-center gap-1 ${isUser ? 'text-white/60 justify-end' : 'text-white/25'}`}><Clock size={10} />{new Date(e.createdAt).toLocaleTimeString()} · {e.type}</div>
                    </div>
                    {isUser && <div className="w-7 h-7 rounded-full bg-white text-[#0f1115] flex items-center justify-center shrink-0 mt-1 text-xs font-semibold">You</div>}
                  </div>
                )
              })}
              {events.length>0 && events[events.length-1]?.type !== 'message' && <div className="flex gap-3"><div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center"><Bot size={13} className="text-white" /></div><div className="rounded-2xl bg-[#1e2128] border border-white/[0.06] px-4 py-3 text-sm text-white/60 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Aurex is working…</div></div>}
            </div>
          )}
        </div>
      </div>

      {/* Composer — ChatGPT / Claude / Gemini style */}
      <div className="shrink-0 border-t border-white/[0.06] bg-[#0f1115]">
        <div className="max-w-[800px] mx-auto w-full px-4 md:px-6 py-4">
          <div className="rounded-2xl bg-[#1a1d24] border border-white/[0.08] shadow-xl shadow-black/20 focus-within:border-violet-500/30 focus-within:ring-2 focus-within:ring-violet-500/10 transition-all">
            <textarea
              ref={textareaRef}
              value={composer}
              onChange={e=>setComposer(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleComposerSend() } }}
              placeholder={activeRun ? 'Ask follow-up… (Shift+Enter for newline)' : 'Ask Aurex anything — audit services, fix logs, check updates…'}
              rows={1}
              className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm text-white placeholder:text-white/30 focus:outline-none resize-none max-h-[160px]"
            />
            <div className="flex items-center justify-between px-3 pb-3 pt-2">
              <div className="flex items-center gap-2">
                <select value={model} onChange={e=>setModel(e.target.value)} className="bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1.5 text-xs text-white/70 focus:outline-none">
                  <option value="opencode/big-pickle">big-pickle</option>
                  {models.map(m=> <option key={m.model||m.id} value={m.model}>{m.label||m.model}</option>)}
                </select>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-white/25"><Shield size={10} className="text-emerald-400" />{serverMode ? 'Full server context' : 'Host path only'}</span>
              </div>
              <div className="flex items-center gap-2">
                {activeRun && <button onClick={()=>abortRun()} className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/60 hover:text-white"><Square size={13} /></button>}
                <button onClick={handleComposerSend} disabled={!composer.trim() || sending} className="w-9 h-9 rounded-full bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white shadow shadow-violet-600/20">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} className="ml-0.5" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-center text-white/20 mt-2">Aurex can monitor and execute — review actions before applying to production. <span className="text-white/30">{hostPath}</span> · {serverMode ? 'server-mode' : 'host-mode'}</p>
        </div>
      </div>
    </div>
  )
}
