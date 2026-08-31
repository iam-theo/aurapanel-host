import { Trash2, Play, Square, RotateCcw, Download, X } from 'lucide-react'

export default function BulkBar({ count, onClear, actions }) {
  if (!count) return null
  return (
    <div className="sticky top-0 z-10 bg-panel-accent text-white px-4 py-2.5 rounded-lg flex items-center gap-3 mb-3 flex-wrap">
      <span className="font-medium text-sm">{count} selected</span>
      <div className="h-5 w-px bg-white/20" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {actions.map(a => (
          <button key={a.label} onClick={a.onClick} className="bg-white text-panel-accent px-3 py-1.5 rounded-md text-xs font-medium hover:bg-white/90 flex items-center gap-1.5">
            {a.icon} {a.label}
          </button>
        ))}
      </div>
      <button onClick={onClear} className="ml-auto text-white/80 hover:text-white p-1"><X size={16} /></button>
    </div>
  )
}

// hook for bulk selection
import { useState, useCallback } from 'react'
export function useBulk(items, keyFn = (x) => x.id || x.name || x) {
  const [selected, setSelected] = useState(new Set())
  const toggle = useCallback((key) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }, [])
  const toggleAll = useCallback((ids, checked) => {
    if (checked) setSelected(new Set(ids)); else setSelected(new Set())
  }, [])
  const clear = useCallback(() => setSelected(new Set()), [])
  return { selected, toggle, toggleAll, clear, has: (k) => selected.has(k), count: selected.size }
}
