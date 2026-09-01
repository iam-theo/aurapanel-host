import { useEffect, useState, useRef } from 'react'
import { Bot, Folder, Play, Square, RefreshCw, Cpu, FileCode, Terminal, Layers, Clock, Check, AlertCircle, Loader2, ExternalLink, Copy, Shield, Activity, Server, Package, ScrollText } from 'lucide-react'
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

  // Host path browser
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

  useEffect(() => {
    if (selectedProject) loadProjectDetail(selectedProject)
  }, [selectedProject])

  // SSE for active run
  useEffect(() => {
    if (!activeRun) return
    setEvents([])
    const token = localStorage.getItem('panel_token')
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

  if (loading) return <div className="p-8 animate-pulse space-y-4"><div className="h-24 bg-panel-card rounded" /><div className="h-64 bg-panel-card rounded" /></div>

  return (
    <div className="p-6 space-y-6">
      {toast && <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm max-w-md">{toast}</div>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center"><Bot size={20} className="text-white" /></div>
          <div>
            <h1 className="text-xl font-bold">Aurex — Coding Agent <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 ml-2">Full Server Mode</span></h1>
            <p className="text-xs text-panel-muted">Entire server: apps · services · logs · updates — Aurex sees everything</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border cursor-pointer" style={{ borderColor: serverMode ? '#8b5cf6' : '#2a2f45', background: serverMode ? 'rgba(139,92,246,0.12)' : 'transparent' }}>
            <input type="checkbox" checked={serverMode} onChange={e => setServerMode(e.target.checked)} className="accent-violet-600" />
            <Server size={12} /> Server Mode
          </label>
          <span className={`status-badge ${workspace ? 'online' : 'offline'}`}>{workspace ? 'Workspace ready' : 'Workspace not ready'}</span>
          <button className="btn-ghost" onClick={() => { loadProjects(); loadHostPath(hostPath); loadWorkspace(); loadServerContext() }}><RefreshCw size={16} /></button>
          <a href="https://aurex.sflbk.com" target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink size={14} /> Aurex Web</a>
        </div>
      </div>

      {/* Server-wide live snapshot — only in Server Mode */}
      {serverMode && serverCtx && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="panel-card !p-3">
            <p className="text-xs text-panel-muted flex items-center gap-1"><Activity size={12} /> Apps</p>
            <p className="text-lg font-bold">{Array.isArray(serverCtx.pm2) ? serverCtx.pm2.length : '—'} <span className="text-xs font-normal text-panel-muted">PM2</span></p>
            <p className="text-xs text-panel-muted truncate">{Array.isArray(serverCtx.pm2) ? serverCtx.pm2.filter(a=>a.status==='online').length + ' online · ' + serverCtx.pm2.filter(a=>a.status!=='online').length + ' stopped' : ''}</p>
            <p className="text-xs text-panel-muted truncate">Docker: {Array.isArray(serverCtx.docker) ? serverCtx.docker.length : '—'} containers</p>
          </div>
          <div className="panel-card !p-3">
            <p className="text-xs text-panel-muted flex items-center gap-1"><Server size={12} /> Services</p>
            <p className="text-lg font-bold">{serverCtx.services?.filter(s=>s.active==='active').length ?? '—'}<span className="text-xs font-normal text-panel-muted">/{serverCtx.services?.length ?? '?'} active</span></p>
            <p className="text-xs text-panel-muted truncate">{serverCtx.services?.filter(s=>s.active!=='active').map(s=>s.name).join(', ') || 'all nominal'}</p>
            <p className="text-xs text-panel-muted">Nginx sites: {serverCtx.nginx?.count ?? 0}</p>
          </div>
          <div className="panel-card !p-3">
            <p className="text-xs text-panel-muted flex items-center gap-1"><Package size={12} /> Updates</p>
            <p className="text-xs text-panel-muted truncate max-w-full" title={String(serverCtx.updates || '').slice(0, 200)}>{serverCtx.updates ? String(serverCtx.updates).split('\n').length + ' lines' : 'checking…'}</p>
            <p className="text-xs truncate">{String(serverCtx.updates || '').split('\n').slice(0,2).join(' · ').slice(0,80) || 'apt upgradable preview'}</p>
            <a href="#updates" className="text-xs text-violet-400 hover:underline">/api/updates</a>
          </div>
          <div className="panel-card !p-3">
            <p className="text-xs text-panel-muted flex items-center gap-1"><ScrollText size={12} /> System</p>
            <p className="text-xs font-mono truncate">{serverCtx.system?.hostname} · {serverCtx.system?.uptime}</p>
            <p className="text-xs text-panel-muted">CPU {serverCtx.system?.cpu?.load ?? '?'}% · MEM {serverCtx.system?.memory?.pct ?? '?'}%</p>
            <p className="text-xs text-panel-muted truncate">{serverCtx.system?.disk?.[0]?.mount}: {serverCtx.system?.disk?.[0]?.use}% used</p>
          </div>
        </div>
      )}
      {serverMode && capabilities && (
        <div className="panel-card !py-2 !px-3 flex items-center gap-2 flex-wrap text-xs">
          <Shield size={12} className="text-emerald-400" /> <span className="font-medium">Panel tools:</span> {capabilities.tools} · {capabilities.capabilities?.join(' · ')}
          <span className="ml-auto flex gap-1">
            <a href="/api/aurex/server-context" target="_blank" className="text-violet-400 hover:underline">server-context</a> · <a href="/api/aurex/tools" target="_blank" className="text-violet-400 hover:underline">tools</a> · <a href="/api/logs" target="_blank" className="text-violet-400 hover:underline">logs</a> · <a href="/api/updates" target="_blank" className="text-violet-400 hover:underline">updates</a>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Host Path Selector */}
        <div className="panel-card">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Folder size={16} className="text-panel-blue" /> Host Path — Agent Environment</h3>
          <div className="bg-panel-bg rounded-md p-2 border border-panel-border flex items-center gap-2 mb-3">
            <code className="flex-1 text-xs font-mono truncate">{hostPath}</code>
            <button onClick={() => navigator.clipboard?.writeText(hostPath)} className="btn-ghost !px-2 !py-1"><Copy size={12} /></button>
          </div>
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {(hostData?.allowedRoots || []).slice(0, 5).map(r => (
              <button key={r} onClick={() => loadHostPath(r)} className="text-xs px-2 py-1 rounded bg-panel-bg border border-panel-border hover:bg-panel-accent/10 truncate max-w-[140px]">{r}</button>
            ))}
          </div>
          <div className="border border-panel-border rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
            <div className="flex items-center gap-2 p-2 border-b border-panel-border bg-panel-bg/50">
              <button disabled={hostPath === '/'} onClick={() => loadHostPath(hostPath.split('/').slice(0, -1).join('/') || '/')} className="text-xs btn-ghost !py-1 disabled:opacity-40">↑ Up</button>
              <span className="text-xs text-panel-muted truncate flex-1">{hostPath}</span>
              <button onClick={createProjectFromHost} className="btn-accent !py-1 !px-3 text-xs">Link to Aurex</button>
            </div>
            {hostData?.entries?.map(e => (
              <button key={e.path} onClick={() => e.isDirectory && loadHostPath(e.path)} className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-panel-accent/10 text-sm ${e.isDirectory ? 'text-panel-text' : 'text-panel-muted'}`}>
                <span className="flex items-center gap-2 truncate"><Folder size={13} className={e.isDirectory ? 'text-panel-blue' : 'text-panel-muted'} />{e.name}</span>
                <span className="text-xs text-panel-muted">{e.isDirectory ? '' : formatBytes(e.size)}</span>
              </button>
            ))}
            {hostData?.entries?.length === 0 && <p className="p-4 text-sm text-panel-muted text-center">Empty directory</p>}
          </div>
          <p className="text-xs text-panel-muted mt-3">The agent will receive this host path as context in its <code className="font-mono bg-panel-bg px-1 rounded">task</code>. Use “Link to Aurex” to create a project from this directory, then run tasks.</p>
        </div>

        {/* Projects & Task — Run Task always visible */}
        <div className="panel-card xl:col-span-2">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Layers size={16} className="text-panel-purple" /> Projects & Tasks</h3>
          {/* Run Task — always visible */}
          <div className="bg-panel-accent/5 border border-panel-accent/20 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-panel-text flex items-center gap-2 mb-3"><Play size={14} className="text-panel-accent" /> Run Task — {serverMode ? 'Full server context will be injected' : 'Agent will work in the selected host path'}</p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-panel-muted">Project (required)</label>
                  <select value={selectedProject || ''} onChange={e => setSelectedProject(e.target.value || null)} className="input-field !py-2 text-sm mt-1">
                    <option value="">Select project…</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p._count?.runs ?? p.runs?.length ?? 0} runs)</option>)}
                  </select>
                  {projects.length === 0 && <p className="text-xs text-panel-muted mt-1">No projects — click “Link to Aurex” on the left first</p>}
                </div>
                <div>
                  <label className="text-xs text-panel-muted">Host path context (auto-injected)</label>
                  <div className="bg-panel-bg rounded-md px-3 py-2 border border-panel-border mt-1">
                    <code className="text-xs font-mono text-panel-accent truncate block">{hostPath}</code>
                  </div>
                </div>
              </div>
              <textarea value={task} onChange={e => setTask(e.target.value)} placeholder={serverMode ? "Describe task with full server awareness… e.g. 'Check all PM2 apps for errors in logs, restart failed ones, check apt updates and report, fix nginx site example.com'" : "Describe the task for the coding agent… e.g. 'Fix the nginx config for /home/panel/apps/myapp, add tests, and commit'"} rows={4} className="input-field resize-none" />
              {serverMode && (
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    'Audit all apps, services and report health',
                    'Tail logs for errors in last hour and fix',
                    'Check apt updates and apply security patches',
                    'Restart failed PM2/Docker services',
                  ].map(p => (
                    <button key={p} onClick={() => setTask(p)} className="text-xs px-2 py-1 rounded-full bg-violet-600/15 border border-violet-600/25 hover:bg-violet-600/25">{p}</button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <select value={model} onChange={e => setModel(e.target.value)} className="input-field !py-2 text-xs flex-1">
                  <option value="opencode/big-pickle">opencode/big-pickle</option>
                  {models.map(m => <option key={m.model || m.id} value={m.model}>{m.label || m.model}</option>)}
                </select>
                <button onClick={createRun} disabled={!selectedProject || !task.trim()} className="btn-accent !px-6 disabled:opacity-40"><Play size={14} /> Run Task</button>
              </div>
              {!selectedProject && <p className="text-xs text-panel-yellow">Select a project above to enable Run Task</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs text-panel-muted mb-2">Aurex Projects ({projects.length}) — click to view runs</p>
              <div className="border border-panel-border rounded-md max-h-[220px] overflow-y-auto">
                {projects.map(p => (
                  <button key={p.id} onClick={() => setSelectedProject(p.id)} className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-panel-accent/10 ${selectedProject === p.id ? 'bg-panel-accent/15 border-l-2 border-panel-accent' : ''}`}>
                    <span className="font-medium text-sm truncate">{p.name}</span>
                    <span className="text-xs text-panel-muted">{p._count?.runs ?? p.runs?.length ?? 0} runs</span>
                  </button>
                ))}
                {projects.length === 0 && <p className="p-4 text-sm text-panel-muted">No projects — link a host path on the left</p>}
              </div>
            </div>
            <div className="border border-dashed border-panel-border rounded-md p-4 flex flex-col items-center justify-center text-center">
              <p className="text-sm font-medium">Quick Link</p>
              <p className="text-xs text-panel-muted mt-1">Host <code className="font-mono bg-panel-bg px-1 rounded">{hostPath}</code></p>
              <button onClick={createProjectFromHost} className="btn-ghost !py-1.5 text-xs mt-3">Link this path to new Aurex project</button>
            </div>
          </div>

          {/* Runs for selected project */}
          {projectDetail && (
            <div>
              <p className="text-xs text-panel-muted mb-2">Recent Runs for <span className="font-mono text-panel-text">{projectDetail.name}</span></p>
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {runs.map(r => (
                  <div key={r.id} className={`flex items-center justify-between p-3 rounded-md border ${activeRun === r.id ? 'bg-panel-accent/10 border-panel-accent' : 'bg-panel-bg border-panel-border'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{r.task?.slice(0, 80)}</p>
                      <p className="text-xs text-panel-muted flex items-center gap-2"><Clock size={10} />{new Date(r.createdAt).toLocaleString()} • <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.status === 'completed' ? 'bg-panel-green/15 text-panel-green' : r.status === 'failed' ? 'bg-panel-red/15 text-panel-red' : r.status === 'running' ? 'bg-panel-yellow/15 text-panel-yellow animate-pulse' : 'bg-panel-muted/15'}`}>{r.status}</span></p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setActiveRun(r.id)} className="btn-ghost !px-2 !py-1 text-xs">Watch</button>
                      {(r.status === 'running' || r.status === 'queued') && <button onClick={() => abortRun(r.id)} className="btn !px-2 !py-1 !bg-panel-red/20 !text-panel-red"><Square size={12} /></button>}
                    </div>
                  </div>
                ))}
                {runs.length === 0 && <p className="text-sm text-panel-muted text-center py-4">No runs yet</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat UI — like aurex.sflbk.com */}
      {activeRun && (
        <div className="panel-card flex flex-col" style={{ height: '520px' }}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h3 className="font-semibold flex items-center gap-2"><Terminal size={16} className="text-panel-green" /> Chat — Live Agent <span className="font-mono text-xs text-panel-muted">{activeRun.slice(0, 8)}</span> <span className="text-xs px-2 py-0.5 rounded bg-panel-yellow/15 text-panel-yellow animate-pulse">● live</span></h3>
            <div className="flex gap-2">
              <button onClick={() => setActiveRun(null)} className="btn-ghost !py-1 text-xs">Close</button>
              <button onClick={() => abortRun(activeRun)} className="btn !py-1 !bg-panel-red/20 !text-panel-red text-xs"><Square size={12} /> Abort</button>
            </div>
          </div>
          {/* Messages — chat bubbles + tool cards */}
          <div ref={eventRef} className="flex-1 overflow-y-auto space-y-3 bg-[#0b0e14] rounded-md p-4 border border-panel-border">
            {events.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-panel-muted">
                <Loader2 size={20} className="animate-spin mb-2" />
                <p className="text-xs">Waiting for agent… (tools: read, write, edit, bash, grep, todo)</p>
                <p className="text-xs mt-1">Host: <code className="font-mono bg-white/10 px-1 rounded">{hostPath}</code></p>
              </div>
            ) : events.map((e, i) => {
              const d = e.data || {}
              const isUser = d.role === 'user' || e.type === 'message'
              const isTool = d.part?.tool
              const isQuestion = e.type === 'question' || d.questions
              if (isQuestion && d.questions) {
                return (
                  <div key={i} className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                    <p className="text-xs font-semibold text-amber-400 mb-2">Agent asks:</p>
                    {d.questions.map((q, qi) => (
                      <div key={qi} className="mb-2">
                        <p className="text-sm text-white">{q.question}</p>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          {q.options?.map((opt, oi) => (
                            <button key={oi} onClick={() => answerQuestions(d.requestId, [[opt.label]])} className="text-xs px-3 py-1 rounded-full bg-white text-black hover:bg-white/90">{opt.label}</button>
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
                  <div key={i} className="bg-white/[0.04] border border-white/10 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <span className="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px]">{(part.tool || '').slice(0, 2)}</span>
                      <span className="font-mono text-white">{title}</span>
                      <span className="ml-auto text-[10px]">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    </div>
                    {input.filePath && <p className="text-xs font-mono text-white/50 mt-1 truncate">{input.filePath}</p>}
                    {input.command && <p className="text-xs font-mono bg-black/30 rounded px-2 py-1 mt-1">$ {input.command}</p>}
                    {output && <pre className="text-xs font-mono bg-black/40 rounded p-2 mt-2 max-h-[120px] overflow-y-auto whitespace-pre-wrap">{output.slice(0, 1500)}</pre>}
                  </div>
                )
              }
              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isUser ? 'bg-violet-600 text-white' : 'bg-white/10 text-white border border-white/10'}`}>
                    <p className="whitespace-pre-wrap">{d.text || d.part?.text || JSON.stringify(d).slice(0, 800)}</p>
                    <p className="text-[10px] opacity-60 mt-1">{new Date(e.createdAt).toLocaleTimeString()} • {e.type}</p>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Composer — like aurex.sflbk.com */}
          <div className="mt-3 flex gap-2 shrink-0">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="Ask follow-up… (Shift+Enter for newline)"
              className="input-field flex-1 !py-2.5"
            />
            <button onClick={sendMessage} disabled={!chatInput.trim() || sending} className="btn-accent !px-5 disabled:opacity-40">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <span className="flex items-center gap-1.5"><Terminal size={14} /> Send</span>}
            </button>
          </div>
          <p className="text-xs text-panel-muted mt-2">Host path <code className="font-mono bg-panel-bg px-1 rounded">{hostPath}</code> • Agent runs in isolated Docker, host bridged via “Link to Aurex”</p>
        </div>
      )}

      <div className="panel-card bg-panel-blue/5 border-panel-blue/20">
        <h4 className="font-medium text-panel-text flex items-center gap-2"><Cpu size={14} className="text-panel-blue" /> How it works</h4>
        <ol className="text-sm text-panel-muted mt-2 space-y-1 list-decimal list-inside">
          <li>Browse host filesystem on the left and pick the directory where the agent should work (e.g. <code className="font-mono">/home/panel/apps/myapp</code>).</li>
          <li>Click <b>Link to Aurex</b> — creates an Aurex project linked to that host path.</li>
          <li>Select the project, type a coding task, pick a model, hit <b>Run Agent</b>. The task is enriched with <code className="font-mono">[HOST PATH: …]</code> context.</li>
          <li>Watch live tool execution (file reads/writes, shell, tests) in the terminal below — streamed via SSE from <code className="font-mono">/api/aurex/runs/:id/events</code>.</li>
          <li>Results persist in Aurex (project → runs → events) and can be exported as ZIP via Aurex web.</li>
        </ol>
      </div>
    </div>
  )
}
