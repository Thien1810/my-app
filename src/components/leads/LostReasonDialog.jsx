import { useEffect, useState } from 'react'
import { LEAD_LOST_REASONS } from '../../lib/leadStatus'

// Hộp thoại trong trang: bắt buộc chọn lý do mất lead rồi mới lưu.
// onResult(reasonKey) khi lưu, onResult(null) khi hủy.
export default function LostReasonDialog({ leadName, saving = false, onResult }) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onResult(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onResult, saving])

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} onClick={() => !saving && onResult(null)}>
      <div
        className="modal-card"
        style={{ maxWidth: 440 }}
        role="dialog"
        aria-modal="true"
        aria-label="Lý do mất khách"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Lý do mất khách</h3>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: 10, overflowWrap: 'anywhere' }}>
            Chọn lý do mất khách "{leadName}" (bắt buộc):
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {LEAD_LOST_REASONS.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="lead-lost-reason"
                  value={r.key}
                  checked={reason === r.key}
                  onChange={() => setReason(r.key)}
                />
                {r.label}
              </label>
            ))}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline"
              style={{ minHeight: 40 }}
              disabled={saving}
              onClick={() => onResult(null)}
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 40 }}
              disabled={!reason || saving}
              onClick={() => onResult(reason)}
            >
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
