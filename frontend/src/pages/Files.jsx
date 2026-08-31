import { useEffect, useState } from 'react'
import {
  Folder, File, ChevronRight, ChevronLeft, FolderPlus, FileEdit,
  Trash2, RefreshCw, Save, X, ArrowUp,
} from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes } from '../lib/utils'

const iconFor = (name, isDir) => {
  if (isDir) return 'folder'
  const ext = name.split('.').pop()?.toLowerCase()
  const code = ['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'yml', 'yaml', 'md', 'sh', 'env', 'conf', 'sql', 'c', 'cpp', 'h', 'go', 'rb', 'php']
  if (code.includes(ext)) return 'code'
  return 'file'
}

const EXT_COLORS = {
  js: 'text-yellow-400', jsx: 'text-yellow-400', ts: 'text-blue-400', tsx: 'text-blue-400',
  py: 'text-green-400', json: 'text-yellow-400', html: 'text-orange-400', css: 'text-purple-400',
  md: 'text-panel-muted', sh: 'text-green-400', yml: 'text-red-400', yaml: 'text-red-400',
  sql: 'text-blue-400', conf: 'text-panel-muted', env: 'text-panel-muted',
}

export default function Files() {
  const [path, setPath] = useState('/home/digital-auracle')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editorContent, setEditorContent] = useState('')
  const [newDir, setNewDir] = useState('')

  const load = async (p) => {
    setLoading(true)
    try {
      const d = await api.get(`/files?path=${encodeURIComponent(p || path)}`)
      setItems(d.items)
      if (p) setPath(d.path)
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(path) }, [])

  const openPath = (item) => {
    if (item.isDirectory) {
      setPath(item.path)
      load(item.path)
    } else {
      viewFile(item)
    }
  }

  const viewFile = async (item) => {
    try {
      const d = await api.get(`/files/read?path=${encodeURIComponent(item.path)}`)
      setSelectedFile(d)
      setShowEditor(true)
    } catch (e) {
      alert(e.message)
    }
  }

  const saveFile = async () => {
    if (!selectedFile) return
    try {
      await api.post('/files/write', { path: selectedFile.path, content: editorContent })
      setShowEditor(false)
      await load()
    } catch (e) {
      alert(e.message)
    }
  }

  const createDir = async () => {
    if (!newDir) return
    try {
      await api.post('/files/mkdir', { path: `${path}/${newDir}` })
      setNewDir('')
      await load()
    } catch (e) {
      alert(e.message)
    }
  }

  const delItem = async (item) => {
    if (!confirm(`Delete ${item.name}?`)) return
    try {
      await api.del(`/files/delete?path=${encodeURIComponent(item.path)}`)
      await load()
    } catch (e) {
      alert(e.message)
    }
  }

  const segments = path.split('/').filter(Boolean)

  const sortItems = (list) =>
    [...list].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-panel-card border border-panel-border rounded-lg px-3 py-2 text-sm overflow-x-auto flex-1">
          <button className="btn-ghost !px-2 !py-1" onClick={() => load('/')}><Folder size={15} /></button>
          <span className="text-panel-muted">{path}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => load(path)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn-ghost" onClick={() => { setNewDir('new-folder'); setTimeout(() => createDir(), 100) }}><FolderPlus size={16} /></button>
        </div>
      </div>

      {newDir && (
        <div className="flex items-center gap-2">
          <input className="input-field max-w-xs" placeholder="New folder name..." autoFocus
            value={newDir} onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createDir(); if (e.key === 'Escape') setNewDir('') }} />
          <button className="btn-accent" onClick={createDir}>Create</button>
          <button className="btn-ghost" onClick={() => setNewDir('')}><X size={15} /></button>
        </div>
      )}

      <div className="panel-card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Modified</th>
              <th className="px-4 py-3 font-medium">Permissions</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {path !== '/' && (
              <tr className="hover:bg-panel-cardHover/50 cursor-pointer" onClick={() => {
                const parent = segments.slice(0, -1).join('/') || '/'
                setPath(parent)
                load(parent)
              }}>
                <td className="px-4 py-2.5 font-medium text-panel-muted flex items-center gap-2">
                  <ArrowUp size={15} /> ..
                </td>
                <td colSpan={4} />
              </tr>
            )}
            {sortItems(items).map(item => {
              const type = iconFor(item.name, item.isDirectory)
              return (
                <tr key={item.path} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50 cursor-pointer" onClick={() => openPath(item)}>
                  <td className="px-4 py-2.5 font-medium flex items-center gap-2.5">
                    {type === 'folder' ? (
                      <Folder size={16} className="text-panel-blue shrink-0" />
                    ) : type === 'code' ? (
                      <FileEdit size={16} className={`shrink-0 ${EXT_COLORS[item.name.split('.').pop()?.toLowerCase()] || 'text-panel-muted'}`} />
                    ) : (
                      <File size={16} className="text-panel-muted shrink-0" />
                    )}
                    <span className="truncate">{item.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-panel-muted">
                    {item.isDirectory ? '—' : formatBytes(item.size)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-panel-muted">
                    {item.modified ? new Date(item.modified).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-panel-muted">{item.permissions}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                      {!item.isDirectory && (
                        <button className="btn !px-2 !py-1" title="Edit" onClick={() => viewFile(item)}>
                          <FileEdit size={13} />
                        </button>
                      )}
                      <button className="btn !px-2 !py-1" title="Delete" onClick={() => delItem(item)}>
                        <Trash2 size={13} className="text-panel-red" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showEditor && selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowEditor(false)} />
          <div className="relative w-full max-w-4xl bg-panel-card border border-panel-border rounded-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
              <div className="flex items-center gap-2 font-mono text-sm">
                <ChevronRight size={15} className="text-panel-muted" />
                <span className="font-medium">{selectedFile.path}</span>
              </div>
              <div className="flex gap-2">
                <button className="btn-accent !py-1.5" onClick={saveFile}><Save size={14} /> Save</button>
                <button className="btn-ghost !py-1.5" onClick={() => setShowEditor(false)}><X size={14} /> Close</button>
              </div>
            </div>
            <textarea
              className="flex-1 p-4 bg-panel-bg text-sm font-mono text-panel-text focus:outline-none resize-none min-h-[400px]"
              value={editorContent}
              onChange={e => setEditorContent(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
