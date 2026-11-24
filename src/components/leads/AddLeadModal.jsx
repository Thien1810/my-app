import { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../../lib/formatters'
import { normalizeLeadStatus, LEAD_STATUS_META } from '../../lib/leadStatus'
import {
  MANUAL_ENTRY_SOURCES,
  LEAD_SERVICE_OPTIONS,
  validateNewLead,
  findDuplicatePhone,
} from '../../lib/leadInput'
import './leads.css'

function ReqMark() {
  return <span style={{ color: '#dc2626' }}> *</span>
}

const EMPTY = {
  customer_name: '',
  phone: '',
  service_interest: '',
  event_date: '',
  location: '',
  note: '',
  entry_source: '', // bắt buộc chọn, không mặc định
}

// Modal trong trang: thêm lead thủ công. onSubmit(input) trả Promise<boolean|string|void>:
// lỗi -> nhà gọi hiện thông báo qua prop `error`. onClose() khi hủy.
export default function AddLeadModal({ leads, saving = false, error = '', onSubmit, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [touched, setTouched] = useState(false) // đã bấm Lưu ít nhất một lần
  const [confirmDup, setConfirmDup] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const { errors } = useMemo(() => validateNewLead(form), [form])
  const duplicate = useMemo(() => findDuplicatePhone(leads, form.phone), [leads, form.phone])

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (k === 'phone') setConfirmDup(false)
  }
  const showErr = (k) => touched && errors[k]

  const submit = () => {
    if (saving) return
    setTouched(true)
    if (Object.keys(errors).length > 0) return
    if (duplicate && !confirmDup) {
      setConfirmDup(true)
      return
    }
    onSubmit(form)
  }

  const errStyle = (k) => (showErr(k) ? { borderColor: '#dc2626' } : undefined)
  const dupStatus = duplicate ? LEAD_STATUS_META[normalizeLeadStatus(duplicate.status)].label : ''

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} onClick={() => !saving && onClose()}>
      <div
        className="modal-card"
        style={{ maxWidth: 560 }}
        role="dialog"
        aria-modal="true"
        aria-label="Thêm khách"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Thêm khách</h3>
        </div>
        <div className="modal-body">
          <div className="form-grid-2">
            <div className="form-group">
              <label>
                Tên khách<ReqMark />
              </label>
              <input
                type="text"
                value={form.customer_name}
                onChange={set('customer_name')}
                style={errStyle('customer_name')}
                autoFocus
              />
              {showErr('customer_name') && <div className="lead-field-error">{errors.customer_name}</div>}
            </div>
            <div className="form-group">
              <label>
                Số điện thoại<ReqMark />
              </label>
              <input
                type="text"
                inputMode="tel"
                value={form.phone}
                onChange={set('phone')}
                style={errStyle('phone')}
              />
              {showErr('phone') && <div className="lead-field-error">{errors.phone}</div>}
            </div>
          </div>

          <div className="form-group">
            <label>
              Nguồn khách<ReqMark />
            </label>
            <select value={form.entry_source} onChange={set('entry_source')} style={errStyle('entry_source')}>
              <option value="">-- Chọn nguồn --</option>
              {MANUAL_ENTRY_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {showErr('entry_source') && <div className="lead-field-error">{errors.entry_source}</div>}
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Dịch vụ quan tâm</label>
              <select value={form.service_interest} onChange={set('service_interest')}>
                <option value="">-- Chưa rõ --</option>
                {LEAD_SERVICE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Ngày cưới</label>
              <input type="date" value={form.event_date} onChange={set('event_date')} />
            </div>
          </div>

          <div className="form-group">
            <label>Khu vực</label>
            <input type="text" value={form.location} onChange={set('location')} />
          </div>
          <div className="form-group">
            <label>Ghi chú</label>
            <textarea rows={3} value={form.note} onChange={set('note')} />
          </div>

          {duplicate && (
            <div className="lead-dup-warning" role="alert">
              SĐT này đã có lead: {duplicate.customer_name}
              {duplicate.created_at ? `, ${formatDate(duplicate.created_at)}` : ''}, trạng thái {dupStatus}.
              {confirmDup && ' Bấm "Vẫn thêm" để lưu thêm một lead mới.'}
            </div>
          )}
          {error && (
            <div className="lead-dup-warning" role="alert" style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' }}>
              {error}
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} disabled={saving} onClick={onClose}>
              Hủy
            </button>
            <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} disabled={saving} onClick={submit}>
              {saving ? 'Đang lưu...' : duplicate && confirmDup ? 'Vẫn thêm' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
