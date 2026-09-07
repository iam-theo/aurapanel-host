import { X, Loader2 } from 'lucide-react'

export default function Modal({ open, onClose, title, children, className }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={`relative w-full max-w-lg bg-panel-card border border-panel-border rounded-lg overflow-hidden shadow-xl ${className || ''}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-panel-border">
          <h3 className="font-semibold text-panel-text">{title}</h3>
          <button onClick={onClose} className="text-panel-muted hover:text-panel-text">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm text-panel-muted">{label}</label>
      {children}
      {hint && <p className="text-xs text-panel-muted/70">{hint}</p>}
    </div>
  )
}

export function Button({ children, variant = 'accent', className = '', ...props }) {
  const variants = {
    accent: 'btn-accent',
    ghost: 'btn-ghost',
    green: 'btn-green',
    red: 'btn-red',
  }
  return (
    <button {...props} className={`${variants[variant]} ${className}`}>{children}</button>
  )
}

export function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="panel-card text-center py-14">
      <Icon size={40} className="mx-auto mb-3 opacity-40" />
      <p className="text-lg text-panel-text">{title}</p>
      {subtitle && <p className="text-sm text-panel-muted mt-1">{subtitle}</p>}
    </div>
  )
}

// Inline spinner for buttons and refresh indicators
export function Spinner({ size = 16, className = '' }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-hidden />
}

// Centered page/section loader — use for initial loads and route
// transitions instead of flashing skeleton blocks. Background refreshes
// must keep stale content visible and use Spinner, not this.
export function PageLoader({ label = 'Loading...', className = '' }) {
  return (
    <div role="status" aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-20 text-panel-muted ${className}`}>
      <Loader2 size={30} className="animate-spin text-panel-accent" aria-hidden />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmText = 'Confirm' }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-panel-text mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="red" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Button>
      </div>
    </Modal>
  )
}
