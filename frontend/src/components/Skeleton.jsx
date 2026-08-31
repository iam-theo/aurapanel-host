export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-panel-border/60 rounded ${className}`} />
}
export function CardSkeleton() {
  return <div className="panel-card space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-6 w-1/2" /><Skeleton className="h-2 w-full" /></div>
}
