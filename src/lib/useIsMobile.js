import { useEffect, useState } from 'react'

const QUERY = '(max-width: 768px)'

function getMatch() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

// true khi màn hình <= 768px (cùng breakpoint với thanh menu dưới của app). An toàn khi không có matchMedia.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(getMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // Safari cũ (< 14)
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
    return undefined
  }, [])

  return isMobile
}

export default useIsMobile
