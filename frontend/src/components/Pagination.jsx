import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({ page, totalPages, onChange, pageSize, total }) {
  if (totalPages <= 1) return null
  const pages = []
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className="flex items-center justify-between gap-4 py-3 flex-wrap">
      <p className="text-xs text-panel-muted">
        {total !== undefined ? `${total} total • ` : ''}Page {page} of {totalPages}{pageSize ? ` • ${pageSize}/page` : ''}
      </p>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="btn-ghost !px-2 !py-1.5 disabled:opacity-40"><ChevronLeft size={16} /></button>
        {start > 1 && <><button onClick={() => onChange(1)} className="btn-ghost !px-3 !py-1.5 text-xs">1</button>{start > 2 && <span className="text-panel-muted px-1">…</span>}</>}
        {pages.map(p => (
          <button key={p} onClick={() => onChange(p)} className={`${p === page ? 'btn-accent' : 'btn-ghost'} !px-3 !py-1.5 text-xs`}>{p}</button>
        ))}
        {end < totalPages && <>{end < totalPages - 1 && <span className="text-panel-muted px-1">…</span>}<button onClick={() => onChange(totalPages)} className="btn-ghost !px-3 !py-1.5 text-xs">{totalPages}</button></>}
        <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="btn-ghost !px-2 !py-1.5 disabled:opacity-40"><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

export function usePagination(items, pageSize = 10) {
  // hook helper: returns { page, totalPages, paged, setPage }
  // Usage: const { page, totalPages, paged, setPage } = usePagination(filtered, 12)
  // But we implement as function, caller manages page state; simpler: just slice util
  return null
}

// util: paginate array
export function paginate(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const p = Math.min(Math.max(1, page), totalPages)
  const start = (p - 1) * pageSize
  return { paged: items.slice(start, start + pageSize), totalPages, page: p }
}
