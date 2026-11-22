import { useEffect, useState } from 'react'

export default function AiLoadingBanner({
  active = false,
  label = 'AI Studio đang viết nội dung...',
  estimatedSeconds = 15,
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return undefined
    }
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  const pct = Math.min(92, Math.max(10, Math.round((elapsed / estimatedSeconds) * 90) + 8))

  return (
    <div className="ai-loading-banner" role="status" aria-live="polite">
      <div className="ai-loading-row">
        <span className="ai-spinner" aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: '#14532d', fontSize: 13.5 }}>{label}</div>
          <div className="text-xs text-muted">
            Đang xử lý ({elapsed}s / thường mất ~{estimatedSeconds}s) — vui lòng không đóng trang...
          </div>
        </div>
      </div>
      <div className="ai-loading-track">
        <div className="ai-loading-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
