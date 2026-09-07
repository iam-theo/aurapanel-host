import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { ConfirmModal } from '../components/ui.jsx'

const NotifyContext = createContext(null)

let seq = 1
const nextId = () => seq++

const TOAST_DURATION = { success: 4000, info: 4500, warning: 6000, error: 8000 }
const MAX_TOASTS = 5

const TYPE_STYLE = {
  success: { icon: CheckCircle2, ring: 'border-panel-green/40 bg-panel-green/10 text-panel-green' },
  error: { icon: XCircle, ring: 'border-panel-red/40 bg-panel-red/10 text-panel-red' },
  warning: { icon: AlertTriangle, ring: 'border-panel-yellow/40 bg-panel-yellow/10 text-panel-yellow' },
  info: { icon: Info, ring: 'border-panel-blue/40 bg-panel-blue/10 text-panel-blue' },
}

export function NotifyProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [banners, setBanners] = useState([])
  const [confirmReq, setConfirmReq] = useState(null)
  const timers = useRef(new Map())
  const confirmResolver = useRef(null)

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const tm = timers.current.get(id)
    if (tm) { clearTimeout(tm); timers.current.delete(id) }
  }, [])

  const push = useCallback((type, message, opts = {}) => {
    if (!TYPE_STYLE[type]) type = 'info'
    const id = nextId()
    setToasts(prev => [...prev, { id, type, message: String(message ?? ''), title: opts.title }].slice(-MAX_TOASTS))
    const ms = opts.duration ?? TOAST_DURATION[type]
    if (ms > 0) {
      const prevTimer = timers.current.get(id)
      if (prevTimer) clearTimeout(prevTimer)
      timers.current.set(id, setTimeout(() => dismissToast(id), ms))
    }
    return id
  }, [dismissToast])

  const dismissBanner = useCallback((id) => {
    setBanners(prev => prev.filter(b => b.id !== id))
  }, [])

  const clearBanners = useCallback(() => setBanners([]), [])

  const banner = useCallback((message, type = 'info', opts = {}) => {
    if (!TYPE_STYLE[type]) type = 'info'
    const id = nextId()
    setBanners(prev => [...prev, { id, type, message: String(message ?? ''), title: opts.title }])
    if (opts.duration > 0) setTimeout(() => dismissBanner(id), opts.duration)
    return id
  }, [dismissBanner])

  // Promise-based replacement for window.confirm — renders a styled modal
  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      if (confirmResolver.current) confirmResolver.current(false)
      confirmResolver.current = resolve
      setConfirmReq({
        message: String(message ?? ''),
        title: opts.title || 'Please confirm',
        confirmText: opts.confirmText || 'Confirm',
      })
    })
  }, [])

  const answerConfirm = useCallback((val) => {
    setConfirmReq(null)
    const r = confirmResolver.current
    confirmResolver.current = null
    if (r) r(val)
  }, [])

  const value = useMemo(() => ({
    toast: (message, opts) => push('info', message, opts),
    success: (message, opts) => push('success', message, opts),
    error: (message, opts) => push('error', message, opts),
    warning: (message, opts) => push('warning', message, opts),
    info: (message, opts) => push('info', message, opts),
    dismiss: dismissToast,
    banner,
    dismissBanner,
    clearBanners,
    confirm,
    banners,
  }), [push, dismissToast, banner, dismissBanner, clearBanners, confirm, banners])

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ConfirmModal
        open={!!confirmReq}
        title={confirmReq?.title || 'Please confirm'}
        message={confirmReq?.message || ''}
        confirmText={confirmReq?.confirmText || 'Confirm'}
        onClose={() => answerConfirm(false)}
        onConfirm={() => answerConfirm(true)}
      />
    </NotifyContext.Provider>
  )
}

export function useNotify() {
  const ctx = useContext(NotifyContext)
  if (!ctx) throw new Error('useNotify must be used inside <NotifyProvider>')
  return ctx
}

// Fixed top-right stack, visible on every page (including login)
function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,380px)] pointer-events-none">
      {toasts.map(t => {
        const st = TYPE_STYLE[t.type] || TYPE_STYLE.info
        const Icon = st.icon
        return (
          <div key={t.id} role="alert"
            className={`toast-enter pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-3 shadow-xl bg-panel-card/95 backdrop-blur ${st.ring}`}>
            <Icon size={17} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {t.title && <p className="text-sm font-semibold text-panel-text leading-tight">{t.title}</p>}
              <p className="text-sm text-panel-text/90 leading-snug break-words">{t.message}</p>
            </div>
            <button onClick={() => onDismiss(t.id)} className="shrink-0 text-panel-muted hover:text-panel-text" aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// In-flow global alert banner — mount once at the top of the app content area
export function AlertBanner() {
  const ctx = useContext(NotifyContext)
  if (!ctx || !ctx.banners?.length) return null
  const { banners, dismissBanner } = ctx
  return (
    <div className="px-6 pt-4 space-y-2">
      {banners.map(b => {
        const st = TYPE_STYLE[b.type] || TYPE_STYLE.info
        const Icon = st.icon
        return (
          <div key={b.id} role="alert" className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm bg-panel-card ${st.ring}`}>
            <Icon size={17} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              {b.title && <p className="font-semibold text-panel-text leading-tight mb-0.5">{b.title}</p>}
              <p className="text-panel-text/90 leading-snug break-words">{b.message}</p>
            </div>
            <button onClick={() => dismissBanner(b.id)} className="shrink-0 text-panel-muted hover:text-panel-text" aria-label="Dismiss alert">
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
