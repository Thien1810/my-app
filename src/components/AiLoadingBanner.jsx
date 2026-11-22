import { useEffect, useState } from 'react'

export default function AiLoadingBanner({
  active = false,
  label = 'AI Studio đang viết nội dung...',
  estimatedSeconds = 15,
}) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!active) {
      setElapsedMs(0)
      return undefined
    }
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - start)
    }, 100)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  const elapsedSec = Math.floor(elapsedMs / 1000)
  // Đường cong tiệm cận mượt (tăng nhanh lúc đầu, chậm dần gần 94% không bao giờ giật cục)
  const ratio = 1 - Math.exp(-(elapsedMs / 1000) / Math.max(4, estimatedSeconds * 0.6))
  const pct = Math.min(94, Math.max(6, ratio * 94))

  return (
    <div className="ai-loading-banner" role="status" aria-live="polite">
      <div className="ai-loading-row">
        <span className="ai-spinner" aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: '#14532d', fontSize: 13.5 }}>{label}</div>
          <div className="text-xs text-muted">
            Đang xử lý ({elapsedSec}s / thường mất ~{estimatedSeconds}s) — vui lòng không đóng trang...
          </div>
        </div>
      </div>
      <div className="ai-loading-track">
        <div className="ai-loading-fill ai-loading-shimmer" style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
    </div>
  )
}
