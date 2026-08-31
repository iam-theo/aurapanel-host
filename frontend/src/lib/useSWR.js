import { useEffect, useState, useRef, useCallback } from 'react'

const cache = new Map() // key -> { data, ts }

export function useSWR(key, fetcher, { refreshInterval = 0, dedupingInterval = 2000, keepPreviousData = true } = {}) {
  const [data, setData] = useState(() => {
    const hit = cache.get(key)
    return hit ? hit.data : undefined
  })
  const [error, setError] = useState(null)
  const [isLoading, setIsLoading] = useState(!cache.has(key))
  const [isValidating, setIsValidating] = useState(false)
  const timerRef = useRef(null)
  const mounted = useRef(true)

  const revalidate = useCallback(async () => {
    const hit = cache.get(key)
    // dedupe: if we fetched within dedupingInterval, reuse
    if (hit && Date.now() - hit.ts < dedupingInterval) {
      if (mounted.current) {
        setData(hit.data)
        setIsLoading(false)
      }
      return hit.data
    }
    setIsValidating(true)
    try {
      const fresh = await fetcher(key)
      cache.set(key, { data: fresh, ts: Date.now() })
      if (mounted.current) {
        setData(fresh)
        setError(null)
        setIsLoading(false)
      }
      return fresh
    } catch (e) {
      if (mounted.current) setError(e)
      throw e
    } finally {
      if (mounted.current) setIsValidating(false)
    }
  }, [key, fetcher, dedupingInterval])

  useEffect(() => {
    mounted.current = true
    revalidate().catch(() => {})
    if (refreshInterval > 0) {
      timerRef.current = setInterval(() => revalidate().catch(() => {}), refreshInterval)
    }
    return () => {
      mounted.current = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [revalidate, refreshInterval])

  return { data, error, isLoading, isValidating, mutate: revalidate }
}

export function mutate(key, data) {
  if (data === undefined) cache.delete(key)
  else cache.set(key, { data, ts: Date.now() })
}
