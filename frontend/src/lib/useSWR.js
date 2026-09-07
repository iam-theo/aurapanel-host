import { useEffect, useState, useRef, useCallback } from 'react'

const cache = new Map() // key -> { data, ts }
const inflight = new Map() // key -> Promise

export function useSWR(key, fetcher, { refreshInterval = 0, dedupingInterval = 2000, keepPreviousData = true } = {}) {
  const [state, setState] = useState(() => {
    const hit = cache.get(key)
    return { data: hit ? hit.data : undefined, error: null, isLoading: !hit, isValidating: false }
  })

  // Hold latest fetcher/key in refs so the retry effect stays stable across
  // renders. Otherwise every re-render (e.g. on error) creates a new fetcher,
  // which re-runs the effect, which refetches, which errors, which re-renders…
  // -> an unbounded request loop that trips the rate limiter.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const keyRef = useRef(key)
  keyRef.current = key

  const mounted = useRef(true)
  const retries = useRef(0)

  const setStateSafe = useCallback((patch) => {
    if (mounted.current) setState(prev => (typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }))
  }, [])

  const revalidate = useCallback(async () => {
    const k = keyRef.current

    // dedupe: reuse a very recent successful fetch
    const hit = cache.get(k)
    if (hit && Date.now() - hit.ts < dedupingInterval) {
      setStateSafe({ data: hit.data, error: null, isLoading: false })
      return hit.data
    }

    // dedupe: reuse an in-flight request so concurrent validations share one call
    const pending = inflight.get(k)
    if (pending) {
      try { return await pending } catch { return undefined }
    }

    const promise = (async () => {
      setStateSafe({ isValidating: true })
      try {
        const fresh = await fetcherRef.current(k)
        cache.set(k, { data: fresh, ts: Date.now() })
        retries.current = 0
        setStateSafe({ data: fresh, error: null, isLoading: false, isValidating: false })
        return fresh
      } catch (e) {
        retries.current += 1
        setStateSafe(prev => ({
          error: e,
          isLoading: false,
          isValidating: false,
          ...(keepPreviousData || cache.has(k) ? {} : { data: undefined }),
        }))
        throw e
      } finally {
        inflight.delete(k)
      }
    })()
    inflight.set(k, promise)
    try { return await promise } catch { return undefined }
  }, [setStateSafe, dedupingInterval, keepPreviousData])

  useEffect(() => {
    mounted.current = true
    revalidate().catch(() => {})

    let stopped = false
    const tick = async () => {
      if (stopped) return
      await revalidate().catch(() => {})
      schedule()
    }
    // chain timeouts instead of setInterval so a slow/busy API never stacks
    // overlapping fetches into a burst
    const schedule = () => {
      if (stopped || refreshInterval <= 0) return
      retryTimer.current = setTimeout(tick, refreshInterval)
    }
    const retryTimer = { current: null }
    schedule()

    return () => {
      stopped = true
      mounted.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [revalidate, key, refreshInterval])

  return { data: state.data, error: state.error, isLoading: state.isLoading, isValidating: state.isValidating, mutate: () => revalidate() }
}

export function mutate(key, data) {
  if (data === undefined) {
    cache.delete(key)
    inflight.delete(key)
  } else {
    cache.set(key, { data, ts: Date.now() })
    inflight.delete(key)
  }
}