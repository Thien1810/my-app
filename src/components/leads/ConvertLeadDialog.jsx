import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from '../../lib/formatters'
import { PROJECT_LEAD_SOURCES, WAREHOUSE_HUBS } from '../../lib/metaAdsClient'
import { leadToProjectSource, leadToWarehouse, resolveLeadCustomerChoice } from '../../lib/leadConvert'

// 6 giá trị lead_source hợp lệ của projects (5 nguồn + không rõ)
const SOURCE_OPTIONS = [...PROJECT_LEAD_SOURCES, { id: 'unknown', label: 'Không rõ nguồn' }]

// Hộp thoại trong trang: xác nhận tạo Khách & Dự án từ lead, cho sửa nguồn và kho.
// onConfirm({ leadSource, warehouseCode, customerChoice }), onCancel().
export default function ConvertLeadDialog({ lead, loadMatches, error, saving = false, onConfirm, onCancel }) {
  const { createdCustomerId } = lead
  const inferred = useMemo(() => leadToProjectSource(lead), [lead])
  const [leadSource, setLeadSource] = useState(inferred.source)
  const [warehouse, setWarehouse] = useState(() => leadToWarehouse(lead))
  const submitted = useRef(false)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [lookupError, setLookupError] = useState('')
  const [reload, setReload] = useState(0)
  const [customerChoice, setCustomerChoice] = useState('')
  const choice = resolveLeadCustomerChoice(matches, customerChoice)
  const canSubmit = createdCustomerId != null || (!loading && !lookupError && choice.ok)

  useEffect(() => {
    if (createdCustomerId != null) return
    let active = true
    loadMatches(lead).then((rows) => {
      if (active) setMatches(rows)
    }).catch(() => {
      if (active) setLookupError('Không thể tìm khách trùng số điện thoại. Hãy thử lại trước khi tạo dự án.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [createdCustomerId, lead, loadMatches, reload])

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

  const submit = async () => {
    if (saving || submitted.current || !canSubmit) return
    submitted.current = true
    try { await onConfirm({ leadSource, warehouseCode: warehouse, customerChoice }) }
    finally { submitted.current = false }
  }

  return (
    <div className="ui-modal-backdrop" style={{ zIndex: 200 }} onClick={() => !saving && onCancel()}>
      <div
        className="ui-modal"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-label="Tạo khách và dự án"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-modal__header">
          <h3>Tạo Khách &amp; Dự án Báo giá</h3>
        </div>
        <div className="ui-modal__body">
          <div style={{ marginBottom: 12, overflowWrap: 'anywhere', fontSize: 14 }}>
            <div>
              <strong>{lead.customer_name}</strong> · {lead.phone || 'Chưa có SĐT'}
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
              Dịch vụ: {lead.service_interest || '—'} · Ngày:{' '}
              {lead.event_date ? formatDate(lead.event_date) : 'Chưa rõ'} · Khu vực: {lead.location || '—'}
            </div>
          </div>

          <div className="ui-field" style={{ marginBottom: 16 }}>
            <label className="ui-label" htmlFor="lead-customer-choice">Khách hàng của dự án</label>
            {createdCustomerId != null ? <p className="ui-hint">Sẽ dùng hồ sơ khách #{createdCustomerId} đã tạo ở lần trước.</p> : loading ? <p role="status">Đang tìm khách trùng SĐT...</p> : lookupError ? (
              <div role="alert">
                <p>{lookupError}</p>
                <button type="button" className="ui-btn ui-btn--secondary" onClick={() => {
                  setLoading(true)
                  setLookupError('')
                  setCustomerChoice('')
                  setReload((v) => v + 1)
                }}>Thử lại</button>
              </div>
            ) : matches.length ? (
              <>
                <p className="ui-hint">Có {matches.length} khách trùng SĐT. Hãy chọn cách xử lý; hệ thống không tự gộp.</p>
                <select id="lead-customer-choice" className="ui-select" value={customerChoice} onChange={(e) => setCustomerChoice(e.target.value)} disabled={saving}>
                  <option value="">— Chọn dùng khách cũ hoặc tạo mới —</option>
                  {matches.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      Dùng khách cũ: {customer.name} · {customer.phone} · #{customer.id}{customer.archived_at ? ' · Đã lưu trữ' : ''}
                    </option>
                  ))}
                  <option value="new">Tạo khách mới (giữ riêng hồ sơ)</option>
                </select>
                {matches.find((customer) => String(customer.id) === customerChoice)?.archived_at && (
                  <p className="ui-hint">Khách đã lưu trữ vẫn được liên kết với dự án; không tự bỏ lưu trữ.</p>
                )}
              </>
            ) : <p className="ui-hint">Không tìm thấy khách trùng SĐT hợp lệ. Sẽ tạo khách mới.</p>}
          </div>
          {error && <p className="ui-error" role="alert">{error}</p>}
          <div className="form-group">
            <label>Nguồn khách</label>
            <select className="ui-select" value={leadSource} onChange={(e) => setLeadSource(e.target.value)} disabled={saving}>
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
            <select className="ui-select" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} disabled={saving}>
              {WAREHOUSE_HUBS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={saving} onClick={onCancel}>
              Hủy
            </button>
            <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={saving || !canSubmit} onClick={submit}>
              {saving ? 'Đang tạo...' : createdCustomerId != null ? 'Tạo dự án' : 'Tạo khách & dự án'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
