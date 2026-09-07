import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Folder, File, ChevronRight, ChevronLeft, FolderPlus, FilePlus, FileEdit,
  Trash2, RefreshCw, Save, X, ArrowUp, Upload, Download, Copy, Scissors,
  Clipboard, Archive, PackageOpen, Home, Eye, EyeOff,
} from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes } from '../lib/utils'
import { useNotify } from '../context/NotifyContext'

const CODE_EXT = ['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'yml', 'yaml', 'md', 'sh', 'env', 'conf', 'sql', 'c', 'cpp', 'h', 'go', 'rb', 'php', 'txt', 'log', 'xml', 'vue', 'svelte', 'toml', 'ini', 'tf']
const EXT_COLORS = {
  js: 'text-yellow-400', jsx: 'text-yellow-400', ts: 'text-blue-400', tsx: 'text-blue-400',
  py: 'text-green-400', json: 'text-yellow-400', html: 'text-orange-400', css: 'text-purple-400',
  md: 'text-panel-muted', sh: 'text-green-400', yml: 'text-red-400', yaml: 'text-red-400',
  sql: 'text-blue-400', conf: 'text-panel-muted', env: 'text-panel-muted', log: 'text-panel-muted',
  zip: 'text-purple-400', gz: 'text-purple-400', tar: 'text-purple-400',
}

const iconType = (name, isDir, type) => {
  if (isDir) return 'folder'
  const ext = name.split('.').pop()?.toLowerCase()
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return 'archive'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'image'
  if (ext === 'sh') return 'shell'
  return CODE_EXT.includes(ext) ? 'code' : 'file'
}

const permStr = (p) => {
  if (!p) return '---'
  const p2 = p.replace(/^0/, '')
  return p2 || '---'
}

export default function Files() {
  const notify = useNotify()
  const [path, setPath] = useState('/root')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showHidden, setShowHidden] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())

  // editor
  const [editing, setEditing] = useState(null) // { path, content, binary, size, name }
  const [editorContent, setEditorContent] = useState('')
  const [saving, setSaving] = useState(false)

  // modals
  const [modal, setModal] = useState(null) // { type: 'newFolder'|'newFile'|'rename'|'delete'|'zip'|'copy', item?, value? }

  // clipboard for copy/move
  const [clipboard, setClipboard] = useState(null) // { action: 'copy'|'move', paths: [..] }

  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async (p, show) => {
    setLoading(true)
    setError(null)
    const target = p ?? path
    const hide = show ?? showHidden
    try {
      const d = await api.get(`/files?path=${encodeURIComponent(target)}&showHidden=${hide ? 'true' : 'false'}`)
      setItems(d.items)
      setPath(d.path)
      setSelected(new Set())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [path, showHidden])

  useEffect(() => { load(path) }, [])

  const navParts = path.split('/').filter(Boolean)

  const navigate = useCallback((p) => { load(p) }, [load])

  const openItem = (item) => {
    if (item.isDirectory) return navigate(item.path)
    readFile(item)
  }

  const readFile = async (item) => {
    try {
      const d = await api.get(`/files/read?path=${encodeURIComponent(item.path)}`)
      setEditing({ path: item.path, name: item.name, binary: d.binary, size: d.size, preview: d.error })
      setEditorContent(d.content || '')
    } catch (e) {
      notify.error(e.message)
    }
  }

  const saveFile = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api.post('/files/write', { path: editing.path, content: editorContent })
      setEditing(null)
      notify.success(`Saved ${editing.name}`)
      load()
    } catch (e) {
      notify.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const ensureName = (name, list) => {
    if (!list.some(i => i.name === name)) return name
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let n = 2
    while (list.some(i => i.name === `${base} (${n})${ext}`)) n++
    return `${base} (${n})${ext}`
  }

  const createItem = async (type) => {
    const name = modal.value.trim()
    if (!name) return
    try {
      if (type === 'folder') {
        await api.post('/files/mkdir', { path: `${path}/${name}` })
      } else {
        await api.post('/files/create', { path, name })
      }
      notify.success(`Created ${name}`)
      setModal(null)
      load()
    } catch (e) {
      notify.error(e.message)
    }
  }

  const renameItem = async () => {
    const item = modal.item
    const newName = modal.value.trim()
    if (!newName || !item) return
    try {
      const newPath = `${item.path.slice(0, item.path.lastIndexOf('/') + 1)}${newName}`
      await api.post('/files/rename', { oldPath: item.path, newPath })
      notify.success(`Renamed to ${newName}`)
      setModal(null)
      load()
    } catch (e) {
      notify.error(e.message)
    }
  }

  const deleteItems = async (itemsToDelete) => {
    try {
      for (const p of itemsToDelete) await api.del(`/files/delete?path=${encodeURIComponent(p)}`)
      const verb = itemsToDelete.length > 1 ? `${itemsToDelete.length} items` : modal?.item?.name || 'item'
      notify.success(`Deleted ${verb}`)
      setModal(null)
      load()
    } catch (e) {
      notify.error(e.message)
    }
  }

  const zipItems = async (targets) => {
    try {
      for (const t of targets) await api.post('/files/zip', { path: t })
      notify.success(targets.length > 1 ? 'Zipped items' : `Zipped ${targets[0].split('/').pop()}`)
      setModal(null)
      load()
    } catch (e) {
      notify.error(e.message)
    }
  }

  const unzipItem = async (item) => {
    try {
      await api.post('/files/unzip', { path: item.path })
      notify.success(`Extracted ${item.name}`)
      load()
    } catch (e) {
      notify.error(e.message)
    }
  }

  const doCopyMove = async (action) => {
    const targets = [...selected]
    if (targets.length === 0) return
    setClipboard({ action, paths: targets })
    notify.success(`${action === 'copy' ? 'Copied' : 'Cut'} ${targets.length} item(s) — navigate & paste`)
  }

  const pasteInto = async (destPath) => {
    if (!clipboard || !clipboard.paths.length) return
    const label = clipboard.action === 'copy' ? 'Copied' : 'Moved'
    setError(null)
    try {
      // auto-rename on collision when pasting into the open folder
      const used = new Set(destPath === path ? items.map(i => i.name) : [])
      for (const p of clipboard.paths) {
        const base = p.split('/').pop()
        let name = base
        if (used.has(name)) name = ensureName(base, [...used].map(n => ({ name: n })))
        used.add(name)
        const dest = `${destPath}/${name}`
        // skip no-op moves (same path)
        if (clipboard.action === 'move' && dest === p) continue
        if (clipboard.action === 'copy') {
          await api.post('/files/copy', { source: p, dest })
        } else {
          await api.post('/files/move', { source: p, dest })
        }
      }
      const verb = clipboard.paths.length > 1 ? `${clipboard.paths.length} items` : clipboard.paths[0].split('/').pop()
      notify.success(`${label} ${verb} → ${destPath}`)
      setClipboard(null)
      load(destPath)
    } catch (e) {
      notify.error(e.message)
    }
  }

  const onUpload = async (e) => {
    const files = [...(e.target.files || [])]
    if (!files.length) return
    setUploading(true)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      const res = await api.upload(`/files/upload?dir=${encodeURIComponent(path)}`, fd)
      notify.success(`Uploaded ${res.count} file(s)`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      load()
    } catch (err) {
      notify.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  const downloadItem = async (item) => {
    try {
      const token = localStorage.getItem('panel_token')
      const res = await fetch(`/api/files/download?path=${encodeURIComponent(item.path)}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.isDirectory ? `${item.name}.zip` : item.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      notify.error(e.message)
    }
  }

  const downloadPath = async (p, downloadName) => {
    try {
      const token = localStorage.getItem('panel_token')
      const res = await fetch(`/api/files/download?path=${encodeURIComponent(p)}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadName
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      notify.error(e.message)
    }
  }

  const toggleSelect = (p) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  }

  const selectAll = () => {
    setSelected(new Set(items.map(i => i.path)))
  }

  const isZip = (name) => /\.zip$/i.test(name)

  const sortItems = (list) => [...list].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const mkTarget = (action, item) => {
    setClipboard({ action, paths: [item.path] })
    notify.success(`${action === 'copy' ? 'Copied' : 'Cut'} ${item.name} — navigate & paste`)
  }

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 bg-panel-card border border-panel-border rounded-lg p-2">
        <span className="flex items-center gap-1 text-xs text-panel-muted px-2">
          <Home size={14} className="text-panel-muted" />
          <span className="font-medium">Path</span>
        </span>
        <button className="btn-ghost !px-2 !py-1.5" onClick={() => navigate('/')} title="Go to / (root)"><Home size={15} /></button>
        <button className="btn-ghost !px-2 !py-1.5" onClick={() => navigate('/root')} title="Go to root home"><Folder size={15} /></button>
        <div className="flex flex-wrap items-center gap-1 font-mono text-sm bg-panel-bg border border-panel-border rounded-md px-3 py-1.5 flex-1 min-w-[120px] overflow-x-auto text-panel-text">
          <button className="text-panel-accent hover:underline font-semibold" onClick={() => navigate('/')}>/</button>
          {navParts.map((part, i) => {
            const p = `/${navParts.slice(0, i + 1).join('/')}`
            return (
              <span key={p} className="flex items-center gap-1 whitespace-nowrap">
                <ChevronRight size={13} className="text-panel-muted" />
                <button className="hover:underline text-panel-text" onClick={() => navigate(p)}>{part}</button>
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-1 border-l border-panel-border pl-2 ml-1">
          <button className="btn-ghost !px-2 !py-1.5" title="Refresh" onClick={() => load(path)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button className="btn-ghost !px-2 !py-1.5" title="Toggle hidden files" onClick={() => { const h = !showHidden; setShowHidden(h); load(path, h) }}>
            {showHidden ? <Eye size={16} className="text-panel-accent" /> : <EyeOff size={16} />}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-accent !py-2 gap-1.5" onClick={() => setModal({ type: 'newFolder', value: 'new-folder' })}><FolderPlus size={15} /> New folder</button>
        <button className="btn !py-2 gap-1.5" onClick={() => setModal({ type: 'newFile', value: 'new-file.txt' })}><FilePlus size={15} /> New file</button>
        <button className="btn !py-2 gap-1.5" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onUpload} />
        {clipboard && (
          <>
            <button className="btn !py-2 gap-1.5 text-panel-accent" onClick={() => pasteInto(path)}>
              <Clipboard size={15} /> Paste {clipboard.action === 'copy' ? 'copy' : 'move'} here
            </button>
            <button className="btn-ghost !py-2" onClick={() => setClipboard(null)}><X size={15} /></button>
          </>
        )}
        <button className="btn !py-2 gap-1.5" disabled={!selected.size}
          onClick={() => doCopyMove('copy')}><Copy size={15} /> Copy</button>
        <button className="btn !py-2 gap-1.5" disabled={!selected.size}
          onClick={() => doCopyMove('move')}><Scissors size={15} /> Cut</button>
        <button className="btn !py-2 gap-1.5" disabled={!selected.size}
          onClick={() => setModal({ type: 'zip', targets: [...selected] })}><Archive size={15} /> Zip</button>
        <button className="btn !py-2 gap-1.5" disabled={!selected.size}
          onClick={() => setModal({ type: 'delete', targets: [...selected] })}><Trash2 size={15} className="text-panel-red" /> Delete</button>
        <div className="ml-auto flex items-center gap-2 text-xs text-panel-muted">
          {selected.size > 0 && <span>{selected.size} selected · </span>}
          <span className="hidden sm:inline">{items.length} item(s) · {path.startsWith('/root') ? 'root home' : 'server'}</span>
          {items.some(i => selected.has(i.path)) && (
            <button className="btn !px-2 !py-1" onClick={() => setSelected(new Set())}>clear</button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-panel-red/10 border border-panel-red/40 text-panel-red text-sm px-4 py-2 rounded-md">
          {error}
        </div>
      )}

      {/* File table */}
      <div className="panel-card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
              <th className="px-3 py-3 w-8">
                <input type="checkbox" className="accent-panel-accent" checked={selected.size === items.length && items.length > 0}
                  onChange={e => e.target.checked ? selectAll() : setSelected(new Set())} />
              </th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Modified</th>
              <th className="px-4 py-3 font-medium">Perms</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {path !== '/' && (
              <tr className="hover:bg-panel-cardHover/50 cursor-pointer text-panel-muted" onClick={() => navigate(path.slice(0, path.lastIndexOf('/')) || '/')}>
                <td className="px-3 py-2.5" />
                <td className="px-4 py-2.5 font-medium flex items-center gap-2" colSpan={2}>
                  <ArrowUp size={15} /> ..
                </td>
                <td colSpan={4} />
              </tr>
            )}
            {sortItems(items).map(item => {
              const itype = iconType(item.name, item.isDirectory, item.type)
              const chez = selected.has(item.path)
              return (
                <tr key={item.path} className={`border-b border-panel-border/50 hover:bg-panel-cardHover/50 cursor-pointer ${chez ? 'bg-panel-accent/10' : ''}`}
                  onClick={(e) => { if (e.target.type !== 'checkbox') openItem(item) }}>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="accent-panel-accent" checked={chez} onChange={() => toggleSelect(item.path)} />
                  </td>
                  <td className="px-4 py-2.5 font-medium flex items-center gap-2.5">
                    {itype === 'folder' ? <Folder size={16} className="text-panel-blue shrink-0" />
                      : itype === 'archive' ? <Archive size={16} className="text-purple-400 shrink-0" />
                      : itype === 'image' ? <File size={16} className="text-panel-green shrink-0" />
                      : itype === 'shell' ? <File size={16} className="text-green-400 shrink-0" />
                      : itype === 'code' ? <FileEdit size={16} className={`shrink-0 ${EXT_COLORS[item.name.split('.').pop()?.toLowerCase()] || 'text-panel-muted'}`} />
                      : <File size={16} className="text-panel-muted shrink-0" />}
                    <span className={`truncate font-mono ${item.name.startsWith('.') ? 'text-panel-muted/70' : ''}`}>{item.name}</span>
                    {item.isSymlink && <span className="text-[10px] px-1.5 rounded bg-panel-accent/15 text-panel-accent">link</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-panel-muted">{item.isDirectory ? '—' : formatBytes(item.size)}</td>
                  <td className="px-4 py-2.5 text-xs text-panel-muted">
                    {item.isDirectory ? 'Folder'
                      : isZip(item.name) ? 'Zip'
                      : item.type === 'binary' ? 'Binary' : 'Text'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-panel-muted">
                    {item.modified ? new Date(item.modified).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-panel-muted">{permStr(item.permissions)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                      {!item.isDirectory && itype !== 'binary' && (
                        <button className="btn !px-2 !py-1" title="Edit" onClick={() => readFile(item)}><FileEdit size={13} /></button>
                      )}
                      {!item.isDirectory && (
                        <button className="btn !px-2 !py-1" title="Download" onClick={() => downloadItem(item)}><Download size={13} /></button>
                      )}
                      {isZip(item.name) && (
                        <button className="btn !px-2 !py-1" title="Extract here" onClick={() => unzipItem(item)}><PackageOpen size={13} /></button>
                      )}
                      <button className="btn !px-2 !py-1" title="Rename" onClick={() => setModal({ type: 'rename', item, value: item.name })}><FileEdit size={13} className="text-panel-accent" /></button>
                      <button className="btn !px-2 !py-1" title="Zip" onClick={() => { setClipboard(null); setModal({ type: 'zip', targets: [item.path] }) }}><Archive size={13} /></button>
                      <button className="btn !px-2 !py-1" title="Copy" onClick={() => mkTarget('copy', item)}><Copy size={13} /></button>
                      <button className="btn !px-2 !py-1" title="Cut" onClick={() => mkTarget('move', item)}><Scissors size={13} /></button>
                      <button className="btn !px-2 !py-1" title="Delete" onClick={() => setModal({ type: 'delete', targets: [item.path], item })}><Trash2 size={13} className="text-panel-red" /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-panel-muted text-sm">This folder is empty</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {modal?.type === 'newFolder' && (
        <SimpleModal title="New folder" onClose={() => setModal(null)} onConfirm={() => createItem('folder')} confirmText="Create">
          <AutoInput value={modal.value} onChange={v => setModal({ ...modal, value: v })} onSubmit={() => createItem('folder')} placeholder="Folder name" />
        </SimpleModal>
      )}
      {modal?.type === 'newFile' && (
        <SimpleModal title="New file" onClose={() => setModal(null)} onConfirm={() => createItem('file')} confirmText="Create file">
          <AutoInput value={modal.value} onChange={v => setModal({ ...modal, value: v })} onSubmit={() => createItem('file')} placeholder="Filename e.g. index.js" />
        </SimpleModal>
      )}
      {modal?.type === 'rename' && (
        <SimpleModal title={`Rename ${modal.item.isDirectory ? 'folder' : 'file'}`} onClose={() => setModal(null)} onConfirm={renameItem} confirmText="Rename">
          <AutoInput value={modal.value} onChange={v => setModal({ ...modal, value: v })} onSubmit={renameItem} placeholder="New name" />
          <p className="text-xs text-panel-muted mt-1 truncate font-mono">{modal.item.path}</p>
        </SimpleModal>
      )}
      {modal?.type === 'delete' && (
        <SimpleModal title="Delete" onClose={() => setModal(null)} onConfirm={() => deleteItems(modal.targets)} confirmText="Delete" danger>
          <p className="text-sm text-panel-text">
            Delete <span className="font-mono">{modal.targets.length > 1 ? `${modal.targets.length} item(s)` : modal.item?.name || modal.targets[0]?.split('/').pop()}</span>? This cannot be undone.
          </p>
        </SimpleModal>
      )}
      {modal?.type === 'zip' && (
        <SimpleModal title="Zip selection" onClose={() => setModal(null)} onConfirm={() => zipItems(modal.targets)} confirmText="Create zip">
          <p className="text-sm text-panel-text">
            Compress <span className="font-mono">{modal.targets.length > 1 ? `${modal.targets.length} item(s)` : modal.targets[0]?.split('/').pop()}</span> into a <code>.zip</code> in this folder?
          </p>
        </SimpleModal>
      )}

      {/* Editor */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setEditing(null)} />
          <div className="relative w-full max-w-4xl bg-panel-card border border-panel-border rounded-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
              <div className="flex items-center gap-2 font-mono text-sm min-w-0">
                <FileEdit size={15} className="text-panel-accent shrink-0" />
                <span className="font-medium truncate">{editing.name}</span>
                <span className="text-xs text-panel-muted truncate">{editing.path}</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn-accent !py-1.5" disabled={saving} onClick={saveFile}><Save size={14} /> {saving ? 'Saving…' : 'Save'} <span className="hidden sm:inline">(Ctrl+S)</span></button>
                <button className="btn-ghost !py-1.5" onClick={() => setEditing(null)}><X size={14} /> Close</button>
              </div>
            </div>
            {editing.binary ? (
              <div className="p-8 text-center text-panel-muted text-sm">
                <Archive size={32} className="mx-auto mb-3 opacity-50" />
                <p className="font-medium text-panel-text mb-1">Binary or uneditable file</p>
                <p className="text-xs">{editing.preview || 'This file cannot be edited as text.'} ({formatBytes(editing.size)})</p>
                <div className="flex gap-2 justify-center mt-4">
                  <a className="btn !py-2 gap-1.5" onClick={() => downloadPath(editing.path, editing.name)}><Download size={14} /> Download</a>
                  <button className="btn-ghost !py-2" onClick={() => setEditing(null)}>Close</button>
                </div>
              </div>
            ) : (
              <textarea
                className="flex-1 p-4 bg-panel-bg text-sm font-mono text-panel-text focus:outline-none resize-none min-h-[400px]"
                value={editorContent}
                onChange={e => setEditorContent(e.target.value)}
                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile() } }}
                spellCheck={false}
                autoFocus
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SimpleModal({ title, children, onClose, onConfirm, confirmText = 'OK', danger }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md bg-panel-card border border-panel-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-panel-border font-medium text-panel-text flex items-center justify-between">
          <span>{title}</span>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="px-4 py-4 space-y-3">{children}</div>
        <div className="px-4 py-3 border-t border-panel-border flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`${danger ? 'bg-panel-red text-white hover:bg-panel-red/90' : 'btn-accent'}`} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}

function AutoInput({ value, onChange, onSubmit, placeholder }) {
  return (
    <input
      className="input-field w-full"
      value={value}
      placeholder={placeholder}
      autoFocus
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onChange('') }}
    />
  )
}