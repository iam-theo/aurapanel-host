import { useEffect, useState, useRef } from 'react'
import { Bot, RefreshCw, Clock, Loader2, ExternalLink, Shield, Activity, Server, Package, ScrollText, Sparkles, Globe, Zap, ArrowUpRight, MessageSquare, Plus, Square, Send, ChevronDown, Wrench, FileCode, Terminal, Search, AlertTriangle, CheckCircle2, XCircle, Lightbulb, ArrowRight, ListTodo, Check, Circle, SkipForward, CornerDownLeft } from 'lucide-react'
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
  const [runStatus, setRunStatus] = useState(null) // running | completed | failed | aborted | null
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
  const [questionProgress, setQuestionProgress] = useState({}) // requestId -> { idx, answers: string[][], done }
  const [customQuestionInput, setCustomQuestionInput] = useState({}) // requestId -> idx -> text
  const eventRef = useRef(null)
  const textareaRef = useRef(null)
  const esRef = useRef(null)

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

  // follow-up recommendations derived from live server context
  const recommendations = (() => {
    if (!serverCtx) return []
    const recs = []
    const totalUpdates = typeof serverCtx.updates === 'string' ? String(serverCtx.updates).split('\n').filter(Boolean).length : serverCtx.updates?.total
    const upd = serverCtx.updates?.total ?? totalUpdates
    if (upd > 0) recs.push({ icon: Package, title: `Review ${upd} pending updates`, desc: `${serverCtx.updates?.security ?? '?'} security`, prompt: `Show pending apt updates (${upd} total) and recommend which security updates to apply first — check if reboot is required` })
    const stopped = Array.isArray(serverCtx.services) ? serverCtx.services.filter(s=>s.active!=='active') : []
    if (stopped.length) recs.push({ icon: AlertTriangle, title: `Fix ${stopped.length} service${stopped.length>1?'s':''}: ${stopped.slice(0,2).map(s=>s.name).join(', ')}`, desc: 'systemd bottlenecks', prompt: `Investigate why these services are not active: ${stopped.map(s=>s.name).join(', ')} — check logs via journalctl and restart if needed` })
    const failedPm2 = Array.isArray(serverCtx.pm2) ? serverCtx.pm2.filter(p=>p.status!=='online') : []
    if (failedPm2.length) recs.push({ icon: Activity, title: `Recover ${failedPm2.length} PM2 app${failedPm2.length>1?'s':''}`, desc: failedPm2.map(p=>p.name).join(', '), prompt: `Check PM2 apps with status not online: ${failedPm2.map(p=>p.name).join(', ')} — tail logs and restart` })
    if (serverCtx.system?.memory?.pct >= 85) recs.push({ icon: Server, title: `Memory pressure ${serverCtx.system.memory.pct}%`, desc: 'investigate bottleneck', prompt: `Memory is at ${serverCtx.system.memory.pct}% — find top processes, check for leaks and suggest mitigation` })
    else if (serverCtx.system?.cpu?.load >= 80) recs.push({ icon: Activity, title: `CPU load ${serverCtx.system.cpu.load}%`, desc: 'bottleneck check', prompt: `CPU load is ${serverCtx.system.cpu.load}% — identify hot processes and suggest optimization` })
    if (serverCtx.system?.disk?.some(d=>d.use>=85)) {
      const d = serverCtx.system.disk.find(x=>x.use>=85)
      recs.push({ icon: ScrollText, title: `Disk ${d.mount} ${d.use}% full`, desc: 'cleanup needed', prompt: `Disk ${d.mount} is ${d.use}% full — find largest directories and suggest cleanup` })
    }
    if (recs.length===0) recs.push({ icon: Lightbulb, title: 'Deep health audit', desc: 'full report', prompt: 'Run a deep health audit: PM2, Docker, services, logs last hour, updates and disk — summarize risks' })
    return recs.slice(0, 4)
  })()

  // SSE with proper lifecycle — close on completed/failed
  useEffect(() => {
    if (!activeRun) return
    setEvents([])
    setRunStatus('running')
    const url = `/api/aurex/runs/${activeRun}/events`
    const es = new EventSource(url)
    esRef.current = es
    es.addEventListener('event', (e) => {
      try {
        const d = JSON.parse(e.data)
        setEvents(prev => [...prev, d])
        setTimeout(() => eventRef.current?.scrollTo({ top: eventRef.current.scrollHeight, behavior: 'smooth' }), 50)
      } catch {}
    })
    const handleRun = (e) => {
      try {
        const d = JSON.parse(e.data)
        const s = d.status || d.state
        if (s) {
          const norm = String(s).toLowerCase()
          if (['completed','failed','aborted','cancelled','done'].includes(norm)) {
            const final = norm==='done' ? 'completed' : norm==='cancelled' ? 'aborted' : norm
            setRunStatus(final)
            toastMsg(`Run ${final}`)
            if (selectedProject) loadProjectDetail(selectedProject)
            setTimeout(()=> es.close(), 300)
          } else {
            setRunStatus(norm)
            toastMsg(`Run ${norm}`)
          }
        }
      } catch {}
    }
    es.addEventListener('run', handleRun)
    es.addEventListener('status', handleRun)
    es.onerror = () => { es.close(); /* fallback poll will detect */ }
    return () => { es.close(); esRef.current=null }
  }, [activeRun, selectedProject])

  // Fallback polling — fixes spinner that never stops if SSE missed the final event
  useEffect(() => {
    if (!activeRun || runStatus!=='running') return
    let cancelled=false
    const poll = async () => {
      try {
        const r = await api.get(`/aurex/runs/${activeRun}`)
        const s = String(r.status || r.state || '').toLowerCase()
        if (!s) return
        if (['completed','failed','aborted','cancelled','done'].includes(s)) {
          const final = s==='done' ? 'completed' : s==='cancelled' ? 'aborted' : s
          if (!cancelled) {
            setRunStatus(final)
            esRef.current?.close()
            toastMsg(`Run ${final} (polled)`)
            if (selectedProject) loadProjectDetail(selectedProject)
          }
        }
      } catch {}
    }
    const id = setInterval(poll, 4000)
    // also poll immediately after 3s in case SSE dropped right away
    const t = setTimeout(poll, 3000)
    return () => { cancelled=true; clearInterval(id); clearTimeout(t) }
  }, [activeRun, runStatus, selectedProject])

  const ensureProjectId = async () => {
    if (selectedProject) return selectedProject
    if (projects.length) { setSelectedProject(projects[0].id); return projects[0].id }
    try {
      const r = await api.post('/aurex/bridge/import', { hostPath, projectName: 'Server Chat' })
      const id = r.project?.id
      if (id) { await loadProjects(); setSelectedProject(id); return id }
    } catch (e) { toastMsg(e.message) }
    throw new Error('No project available')
  }

  const handleComposerSend = async () => {
    const text = composer.trim()
    if (!text || sending) return
    // if previous run finished, start a fresh run instead of messaging a dead one
    const shouldNewRun = !activeRun || runStatus==='completed' || runStatus==='failed' || runStatus==='aborted'
    setSending(true)
    try {
      if (shouldNewRun) {
        const pid = await ensureProjectId()
        const r = await api.post('/aurex/runs', { projectId: pid, task: text, model, hostPath, serverMode })
        toastMsg(`Started ${r.id?.slice(0, 8)}`)
        setComposer('')
        setActiveRun(r.id)
        setRunStatus('running')
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
    try { await api.post(`/aurex/runs/${id || activeRun}/abort`); setRunStatus('aborted'); esRef.current?.close(); toastMsg('Abort requested') } catch (e) { toastMsg(e.message) }
  }
  const answerQuestions = async (requestId, answers) => {
    if (!activeRun) return
    try {
      await api.post(`/aurex/runs/${activeRun}/questions`, { requestId, answers });
      toastMsg('Answers sent')
      // render answers back to chat so agent sees them and user has confirmation
      const qEvent = events.find(ev => ev.data?.requestId === requestId)
      const qs = qEvent?.data?.questions || []
      const summary = answers.map((a, idx) => {
        const q = qs[idx]
        const label = a && a.length ? a.join(', ') : '(skipped)'
        return `${q?.header || `Q${idx+1}`}: ${label}`
      }).join('  ·  ')
      setEvents(prev => [...prev, { type: 'message', data: { role: 'user', text: `Answered: ${summary}` }, createdAt: new Date().toISOString() }])
      setQuestionProgress(p => ({ ...p, [requestId]: { ...(p[requestId]||{idx:0,answers:[]}), done: true } }))
    } catch (e) { toastMsg(e.message) }
  }
  const handleQuestionOption = (requestId, questions, optLabel, customText) => {
    const cur = questionProgress[requestId] || { idx: 0, answers: questions.map(()=>[]) }
    const idx = cur.idx
    const q = questions[idx]
    const answer = customText ? [customText] : [optLabel]
    const nextAnswers = [...cur.answers]
    nextAnswers[idx] = answer
    // if not last question, advance to next; else send all
    if (idx < questions.length - 1) {
      setQuestionProgress(p => ({ ...p, [requestId]: { idx: idx+1, answers: nextAnswers, done: false } }))
    } else {
      // last — send full matrix, filling any skipped with []
      const final = nextAnswers.map(a => a || [])
      answerQuestions(requestId, final)
    }
  }
  const handleQuestionSkip = (requestId, questions) => {
    const cur = questionProgress[requestId] || { idx: 0, answers: questions.map(()=>[]) }
    const idx = cur.idx
    const nextAnswers = [...cur.answers]
    nextAnswers[idx] = []
    if (idx < questions.length - 1) {
      setQuestionProgress(p => ({ ...p, [requestId]: { idx: idx+1, answers: nextAnswers, done: false } }))
    } else {
      const final = nextAnswers.map(a => a || [])
      answerQuestions(requestId, final)
    }
  }
  const newChat = () => { esRef.current?.close(); setActiveRun(null); setRunStatus(null); setEvents([]); setComposer('') }

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

  const isWorking = runStatus==='running' || runStatus==='queued'

  function CleanMessage({ text }) {
    if (!text) return null
    // hide internal JSON like {"part":{"type":"step-finish"...}}
    if (text.trim().startsWith('{"part"') || text.includes('"type":"step-finish"') || text.includes('"type":"step_start"')) return null
    const codeBlocks = text.split(/(```[\s\S]*?```)/g)
    return (
      <div className="space-y-2 leading-relaxed">
        {codeBlocks.map((block, bi) => {
          if (block.startsWith('```')) {
            const inner = block.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '').trim()
            if (!inner) return null
            // detect PID table style and render as structured rows
            const lines = inner.split('\n').filter(l=>l.trim())
            const isPidBlock = lines.some(l=>l.includes('PID') && l.includes('User'))
            if (isPidBlock) {
              return (
                <div key={bi} className="rounded-xl overflow-hidden border border-white/10 bg-[#0f1115]">
                  {lines.map((ln, li) => {
                    const isHeader = ln.toLowerCase().includes('pid') && ln.toLowerCase().includes('user')
                    return <div key={li} className={`px-3 py-1.5 text-xs font-mono flex gap-4 ${isHeader ? 'bg-white/[0.04] text-white/40 border-b border-white/5' : 'text-white/65'}`}><span className="whitespace-pre">{ln}</span></div>
                  })}
                </div>
              )
            }
            return <pre key={bi} className="rounded-xl bg-[#0f1115] border border-white/10 p-3 text-xs font-mono text-white/70 overflow-x-auto whitespace-pre">{inner}</pre>
          }
          // inline formatting: **bold** and `code` and newlines
          const parts = block.split(/(\*\*.*?\*\*|`[^`]+`)/g)
          return (
            <p key={bi} className="whitespace-pre-wrap break-words">
              {parts.map((p, pi) => {
                if (p.startsWith('**') && p.endsWith('**') && p.length>4) return <strong key={pi} className="font-semibold text-white">{p.slice(2,-2)}</strong>
                if (p.startsWith('`') && p.endsWith('`') && p.length>2) return <code key={pi} className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/10 text-violet-200 text-xs font-mono">{p.slice(1,-1)}</code>
                // handle simple line breaks and bullet-like lines
                return <span key={pi}>{p}</span>
              })}
            </p>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#0f1115]">
      {toast && <div className="fixed top-5 right-5 z-50 bg-[#1a1d24] border border-violet-500/30 text-white px-4 py-3 rounded-xl text-sm shadow-2xl flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />{toast}</div>}

      <div className="shrink-0 border-b border-white/[0.06] bg-[#0f1115]/80 backdrop-blur supports-[backdrop-filter]:bg-[#0f1115]/60">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow shadow-violet-600/20 ring-1 ring-white/10 shrink-0"><Bot size={16} className="text-white" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white tracking-tight">Aurex</span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60"><Sparkles size={10} className="text-violet-400" />Enterprise</span>
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${serverMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-white/5 border-white/10 text-white/40'}`}><span className={`w-1.5 h-1.5 rounded-full ${serverMode ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />{serverMode ? 'Full server' : 'Host only'}</span>
                {runStatus && <span className={`hidden md:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${runStatus==='running'?'bg-amber-500/10 border-amber-500/20 text-amber-300': runStatus==='completed'?'bg-emerald-500/10 border-emerald-500/20 text-emerald-300': runStatus==='failed'?'bg-red-500/10 border-red-500/20 text-red-300':'bg-white/5 border-white/10 text-white/40'}`}>{runStatus==='running'?<Loader2 size={10} className="animate-spin" />: runStatus==='completed'?<CheckCircle2 size={10}/>: runStatus==='failed'?<XCircle size={10}/>:null}{runStatus}</span>}
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
        {serverMode && serverCtx && (
          <div className="px-4 md:px-6 pb-3 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><Activity size={11} className="text-violet-400" />{Array.isArray(serverCtx.pm2)?serverCtx.pm2.filter(a=>a.status==='online').length:0} PM2 online · {Array.isArray(serverCtx.docker)?serverCtx.docker.length:0} Docker</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><Server size={11} className="text-emerald-400" />{serverCtx.services?.filter(s=>s.active==='active').length ?? 0}/{serverCtx.services?.length ?? 0} services</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><Package size={11} className="text-amber-400" />{String(serverCtx.updates||'').split('\n').filter(Boolean).length || serverCtx.updates?.total || 0} updates</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1d24] border border-white/10 text-white/60"><ScrollText size={11} className="text-sky-400" />CPU {serverCtx.system?.cpu?.load ?? '?'}% · MEM {serverCtx.system?.memory?.pct ?? '?'}%</span>
            <span className="ml-auto hidden lg:inline-flex items-center gap-1 text-white/25"><Shield size={11} className="text-emerald-400" />{capabilities?.tools || 38} tools · server-context · logs · updates</span>
          </div>
        )}
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
                  <button key={r.id} onClick={()=>{ setActiveRun(r.id); setRunStatus(r.status); setShowHistory(false)}} className={`w-full text-left px-3 py-2 rounded-xl border flex items-center justify-between ${activeRun===r.id ? 'bg-violet-600/15 border-violet-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-white/70 hover:bg-white/[0.06]'}`}>
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
              {activeRun && (
                <div className="flex items-center justify-between text-xs text-white/30 border border-white/5 rounded-full px-3 py-2 bg-white/[0.02]">
                  <span className="inline-flex items-center gap-2"><MessageSquare size={12} />{activeRun.slice(0, 8)} · {events.length} events {runStatus && <span className={`ml-1 px-1.5 py-0.5 rounded-full border text-[10px] ${runStatus==='running'?'bg-amber-500/15 text-amber-300 border-amber-500/20': runStatus==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/20': runStatus==='failed'?'bg-red-500/15 text-red-300 border-red-500/20':'bg-white/10 text-white/40 border-white/10'}`}>{runStatus}</span>}</span>
                  <span className="inline-flex items-center gap-2">{isWorking ? <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />working</> : runStatus==='completed' ? <><CheckCircle2 size={12} className="text-emerald-400" />done</> : runStatus==='failed' ? <><XCircle size={12} className="text-red-400" />failed</> : null} {isWorking && <button onClick={()=>abortRun()} className="ml-2 px-2 py-1 rounded-full bg-red-500/15 border border-red-500/20 text-red-300 hover:bg-red-500/20 inline-flex items-center gap-1"><Square size={10} />Stop</button>}</span>
                </div>
              )}
              {events.map((e, i) => {
                const d = e.data || {}
                // never show internal step plumbing as chat — filter step_start/step_finish and raw JSON
                const rawType = String(e.type || d.type || d.part?.type || '').toLowerCase()
                if (rawType.includes('step_') || rawType.includes('step-') || d.part?.type === 'step-start' || d.part?.type === 'step-finish') return null
                const isQuestion = e.type === 'question' || d.questions
                if (isQuestion && d.questions) {
                  const prog = questionProgress[d.requestId] || { idx: 0, answers: d.questions.map(()=>[]), done: false }
                  if (prog.done) {
                    return (
                      <div key={i} className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-2 text-xs text-emerald-300">
                        <CheckCircle2 size={13} /> Answered — {d.questions.length} question{d.questions.length>1?'s':''} sent to Aurex
                      </div>
                    )
                  }
                  const q = d.questions[prog.idx]
                  const isLast = prog.idx === d.questions.length - 1
                  const customVal = customQuestionInput[`${d.requestId}:${prog.idx}`] || ''
                  return (
                    <div key={i} className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5"><AlertTriangle size={12} />Aurex asks {d.questions.length>1 ? `(${prog.idx+1}/${d.questions.length})` : ''}</p>
                        {d.questions.length>1 && <span className="text-[11px] text-white/30">Step {prog.idx+1} of {d.questions.length}</span>}
                      </div>
                      <p className="text-[11px] font-medium tracking-widest uppercase text-white/40 mb-1">{q.header}</p>
                      <p className="text-sm text-white leading-relaxed">{q.question}</p>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {q.options?.map((opt, oi)=> (
                          <button key={oi} onClick={()=>handleQuestionOption(d.requestId, d.questions, opt.label)} className="text-xs px-3 py-1.5 rounded-full bg-white text-[#0f1115] hover:bg-white/90 font-medium inline-flex items-center gap-1">{opt.label} <span className="text-[10px] text-black/40 hidden sm:inline">— {opt.description?.slice(0,40)}</span></button>
                        ))}
                      </div>
                      {q.custom && (
                        <div className="mt-3 flex gap-2">
                          <input value={customVal} onChange={e=>setCustomQuestionInput(p=>({ ...p, [`${d.requestId}:${prog.idx}`]: e.target.value }))} onKeyDown={e=>{ if(e.key==='Enter' && customVal.trim()) handleQuestionOption(d.requestId, d.questions, null, customVal.trim()) }} placeholder="Type your own answer..." className="flex-1 bg-[#0f1115] border border-white/10 rounded-full px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/30" />
                          <button disabled={!customVal.trim()} onClick={()=>handleQuestionOption(d.requestId, d.questions, null, customVal.trim())} className="px-3 py-1.5 rounded-full bg-violet-600 text-white text-xs font-medium disabled:opacity-30 inline-flex items-center gap-1"><CornerDownLeft size={12} />Send</button>
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        <button onClick={()=>handleQuestionSkip(d.requestId, d.questions)} className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-white/60 hover:text-white inline-flex items-center gap-1"><SkipForward size={11} />Skip</button>
                        {prog.idx>0 && <button onClick={()=>setQuestionProgress(p=>({ ...p, [d.requestId]: { ...prog, idx: prog.idx-1 }}))} className="text-xs px-2 py-1 rounded-full text-white/40 hover:text-white">← Back</button>}
                        <span className="ml-auto text-[11px] text-white/25">{isLast ? 'Last question — will send all answers' : 'Answer to continue'}</span>
                      </div>
                      {d.questions.length>1 && (
                        <div className="mt-3 flex gap-1">
                          {d.questions.map((_, qi)=> (
                            <span key={qi} className={`h-1 flex-1 rounded-full ${qi < prog.idx ? 'bg-emerald-500/60' : qi===prog.idx ? 'bg-amber-400' : 'bg-white/10'}`} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                const isTool = !!d.part?.tool
                if (isTool) {
                  const part = d.part
                  const input = part?.state?.input || {}
                  let output = part?.state?.output || part?.state?.metadata?.output || ''
                  const title = part?.state?.title || part?.tool || 'tool'
                  const toolName = String(part.tool || '').toLowerCase()
                  const isTodo = toolName.includes('todo') || title.toLowerCase().includes('todo') || (typeof output === 'string' && output.trim().startsWith('[') && output.includes('"content"') && output.includes('"status"'))
                  let todos = null
                  if (isTodo && typeof output === 'string') {
                    try {
                      const parsed = JSON.parse(output)
                      if (Array.isArray(parsed) && parsed.length && parsed[0]?.content) todos = parsed
                      else if (parsed?.todos && Array.isArray(parsed.todos)) todos = parsed.todos
                    } catch {}
                    // also handle output that is already array stringified with newlines
                    if (!todos && typeof output === 'string') {
                      try {
                        const maybe = output.slice(0, 8000).trim()
                        if (maybe.startsWith('[')) {
                          const p2 = JSON.parse(maybe)
                          if (Array.isArray(p2)) todos = p2
                        }
                      } catch {}
                    }
                  }
                  const icon = isTodo ? ListTodo : title.toLowerCase().includes('read') ? FileCode : title.toLowerCase().includes('bash') || title.toLowerCase().includes('exec') ? Terminal : title.toLowerCase().includes('grep') || title.toLowerCase().includes('search') ? Search : Wrench
                  const Icon = icon
                  return (
                    <div key={i} className="rounded-2xl bg-[#1a1d24] border border-white/[0.06] overflow-hidden">
                      <div className="px-4 py-3 flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center"><Icon size={13} className={isTodo ? 'text-violet-300' : 'text-white/60'} /></span>
                        <span className="text-sm font-medium text-white/80">{isTodo ? 'Plan' : title}</span>
                        <span className="text-[11px] font-mono text-white/25 truncate flex-1">{isTodo ? `${todos ? todos.length : ''} tasks` : (input.filePath || input.command || input.pattern || '')}</span>
                        <span className="text-[11px] text-white/20">{new Date(e.createdAt).toLocaleTimeString()}</span>
                      </div>
                      {(input.filePath || input.command) && !isTodo && (
                        <div className="mx-3 mb-3 rounded-xl bg-[#0f1115] border border-white/5 px-3 py-2">
                          {input.filePath && <p className="text-xs font-mono text-white/40 truncate">{input.filePath}</p>}
                          {input.command && <p className="text-xs font-mono text-violet-300">$ {input.command}</p>}
                        </div>
                      )}
                      {isTodo && todos ? (
                        <div className="mx-3 mb-3 rounded-xl bg-[#0f1115] border border-white/5 p-2 space-y-1">
                          {todos.map((t, ti) => {
                            const status = String(t.status || t.state || '').toLowerCase()
                            const isCompleted = status === 'completed' || status === 'done' || t.completed
                            const isProgress = status === 'in_progress' || status === 'in-progress' || status === 'running'
                            return (
                              <div key={ti} className={`flex items-start gap-2 px-2 py-1.5 rounded-lg ${isCompleted ? 'bg-emerald-500/5' : isProgress ? 'bg-amber-500/5' : 'bg-white/[0.02]'}`}>
                                <span className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${isCompleted ? 'bg-emerald-500 border-emerald-500 text-white' : isProgress ? 'bg-amber-500/20 border-amber-500/30 text-amber-300' : 'bg-white/5 border-white/10 text-white/20'}`}>
                                  {isCompleted ? <Check size={11} /> : isProgress ? <Loader2 size={10} className="animate-spin" /> : <Circle size={10} />}
                                </span>
                                <span className={`text-xs leading-relaxed flex-1 ${isCompleted ? 'line-through text-white/35' : isProgress ? 'text-amber-200/80' : 'text-white/65'}`}>{t.content || t.text || t.title || JSON.stringify(t).slice(0,120)}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 capitalize ${isCompleted ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : isProgress ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-white/5 border-white/10 text-white/30'}`}>{status || 'pending'}</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : output ? (
                        <pre className="mx-3 mb-3 rounded-xl bg-[#0f1115] border border-white/5 p-3 text-xs font-mono text-white/55 max-h-[180px] overflow-y-auto whitespace-pre-wrap">{String(output).slice(0, 2500)}</pre>
                      ) : null}
                    </div>
                  )
                }
                const isUser = d.role === 'user' || (!d.part?.tool && d.text && e.type === 'message')
                const rawText = d.text || d.part?.text || (typeof d === 'string' ? d : '')
                // drop empty or internal JSON like {"part":{"type":"step-finish"}}
                if (!rawText || rawText.trim().startsWith('{"part"') || rawText.includes('"type":"step-finish"')) return null
                return (
                  <div key={i} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {!isUser && <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shrink-0 mt-1"><Bot size={13} className="text-white" /></div>}
                    <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${isUser ? 'bg-violet-600 text-white shadow shadow-violet-600/20' : 'bg-[#1e2128] text-white border border-white/[0.06] shadow-sm'}`}>
                      <CleanMessage text={rawText} />
                      <div className={`text-[10px] mt-2 flex items-center gap-1 ${isUser ? 'text-white/60 justify-end' : 'text-white/25'}`}><Clock size={10} />{new Date(e.createdAt).toLocaleTimeString()} · {e.type}</div>
                    </div>
                    {isUser && <div className="w-7 h-7 rounded-full bg-white text-[#0f1115] flex items-center justify-center shrink-0 mt-1 text-xs font-semibold">You</div>}
                  </div>
                )
              })}
              {/* Spinner only while actually running */}
              {isWorking && (
                <div className="flex gap-3"><div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center"><Bot size={13} className="text-white" /></div><div className="rounded-2xl bg-[#1e2128] border border-white/[0.06] px-4 py-3 text-sm text-white/60 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Aurex is working…</div></div>
              )}
              {/* Intent follow-ups when done */}
              {(runStatus==='completed' || runStatus==='failed') && (
                <div className="rounded-2xl bg-gradient-to-br from-violet-600/[0.08] via-indigo-600/[0.06] to-transparent border border-violet-500/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded-xl flex items-center justify-center border ${runStatus==='completed' ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-300' : 'bg-red-500/15 border-red-500/20 text-red-300'}`}>{runStatus==='completed' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}</span>
                    <p className="text-sm font-semibold text-white">{runStatus==='completed' ? 'Run completed — what next?' : 'Run stopped — try a follow-up'}</p>
                    <span className="ml-auto text-xs text-white/30">{events.length} steps</span>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed">Aurex has stopped. Based on live server signals, here are smart next steps — these will start a <b className="text-white/70">new run</b> with full server context.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {recommendations.map(r=> (
                      <button key={r.title} onClick={()=>{ setComposer(r.prompt); setTimeout(()=> textareaRef.current?.focus(), 50)}} className="text-left p-3 rounded-xl bg-[#0f1115] border border-white/10 hover:border-violet-500/30 hover:bg-[#1a1d24] transition-colors group">
                        <span className="flex items-center gap-2 text-sm font-medium text-white group-hover:text-violet-200"><r.icon size={13} className="text-white/40 group-hover:text-violet-300" />{r.title}</span>
                        <span className="text-xs text-white/35 mt-1 block">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={newChat} className="text-xs px-3 py-1.5 rounded-full bg-white text-[#0f1115] font-semibold inline-flex items-center gap-1"><Plus size={12} />New chat</button>
                    <button onClick={()=>{ if(recommendations[0]) setComposer(recommendations[0].prompt)}} className="text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-white/70 hover:text-white inline-flex items-center gap-1">Use top suggestion <ArrowRight size={12} /></button>
                    <span className="text-[11px] text-white/25 ml-auto inline-flex items-center gap-1"><Lightbulb size={11} className="text-amber-400" />Aurex will ask for confirmation before applying changes</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.06] bg-[#0f1115]">
        <div className="max-w-[800px] mx-auto w-full px-4 md:px-6 py-4">
          <div className="rounded-2xl bg-[#1a1d24] border border-white/[0.08] shadow-xl shadow-black/20 focus-within:border-violet-500/30 focus-within:ring-2 focus-within:ring-violet-500/10 transition-all">
            <textarea
              ref={textareaRef}
              value={composer}
              onChange={e=>setComposer(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleComposerSend() } }}
              placeholder={isWorking ? 'Aurex is working… you can queue a follow-up' : activeRun && runStatus==='completed' ? 'Ask follow-up — will start a new run…' : 'Ask Aurex anything — audit services, fix logs, check updates…'}
              rows={1}
              disabled={isWorking && false}
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
                {isWorking && <button onClick={()=>abortRun()} className="w-8 h-8 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center text-red-300 hover:bg-red-500/20"><Square size={13} /></button>}
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
