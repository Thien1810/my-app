import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from '../../lib/formatters'
import { PROJECT_LEAD_SOURCES, WAREHOUSE_HUBS } from '../../lib/metaAdsClient'
import { leadToProjectSource, leadToWarehouse } from '../../lib/leadConvert'

// 6 giá trị lead_source hợp lệ của projects (5 nguồn + không rõ)
const SOURCE_OPTIONS = [...PROJECT_LEAD_SOURCES, { id: 'unknown', label: 'Không rõ nguồn' }]

// Hộp thoại trong trang: xác nhận tạo Khách & Dự án từ lead, cho sửa nguồn và kho.
// onConfirm({ leadSource, warehouseCode }), onCancel().
export default function ConvertLeadDialog({ lead, saving = false, onConfirm, onCancel }) {
  const inferred = useMemo(() => leadToProjectSource(lead), [lead])
  const [leadSource, setLeadSource] = useState(inferred.source)
  const [warehouse, setWarehouse] = useState(() => leadToWarehouse(lead))
  const submitted = useRef(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  // Cha đặt saving=false lại (vd. lỗi) thì cho bấm lại
  useEffect(() => {
    if (!saving) submitted.current = false
  }, [saving])

  const submit = () => {
    if (saving || submitted.current) return
    submitted.current = true
    onConfirm({ leadSource, warehouseCode: warehouse })
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} onClick={() => !saving && onCancel()}>
      <div
        className="modal-card"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-label="Tạo khách và dự án"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Tạo Khách &amp; Dự án Báo giá</h3>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: 12, overflowWrap: 'anywhere', fontSize: 14 }}>
            <div>
              <strong>{lead.customer_name}</strong> · {lead.phone || 'Chưa có SĐT'}
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
              Dịch vụ: {lead.service_interest || '—'} · Ngày:{' '}
              {lead.event_date ? formatDate(lead.event_date) : 'Chưa rõ'} · Khu vực: {lead.location || '—'}
            </div>
          </div>

          <div className="form-group">
            <label>Nguồn khách</label>
            <select value={leadSource} onChange={(e) => setLeadSource(e.target.value)} disabled={saving}>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>{inferred.reason}</div>
            {leadSource === 'unknown' && (
              <div className="lead-dup-warning" role="alert">
                Dự án nguồn không rõ sẽ không tính vào CAC/ROAS
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Kho phụ trách</label>
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} disabled={saving}>
              {WAREHOUSE_HUBS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} disabled={saving} onClick={onCancel}>
              Hủy
            </button>
            <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} disabled={saving} onClick={submit}>
              {saving ? 'Đang tạo...' : 'Tạo khách & dự án'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
