import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { changeKindAllowed, listPartners } from '../../lib/partnersApi'
import {
  findDuplicatePartners,
  formatPhoneDisplay,
  validatePartnerInput,
} from '../../lib/partnerInput'
import { PARTNER_KIND_LABELS } from '../../lib/formatters'
import { listPartnersFallback } from './partnersFallback'
import PartnerModal from './PartnerModal'
import './Partners.css'

function formatSavePartnerError(error) {
  if (error?.code === '42501') {
    return 'Bạn không có quyền thực hiện thao tác này.'
  }
  if (error?.code === '23503') {
    return error?.message || 'Không thể lưu đối tác do có dữ liệu liên quan.'
  }
  return 'Không thể lưu đối tác. Vui lòng kiểm tra mạng và thử lại.'
}

export default function PartnerFormModal({
  editingPartner,
  defaultKind = 'customer',
  role,
  schemaMissing,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => ({
    kind: editingPartner?.kind || defaultKind,
    name: editingPartner?.name || '',
    phone: editingPartner?.phone || '',
    address: editingPartner?.address || '',
    note: editingPartner?.note || '',
  }))
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [dupState, setDupState] = useState(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const alertRef = useRef(null)

  useEffect(() => {
    if (submitError || dupState) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [submitError, dupState])

  const handleFieldChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setDupState(null)
    setSubmitError('')
  }

  const performSave = async (cleanData, { skipDuplicateCheck = false } = {}) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSubmitError('')

    try {
      if (editingPartner && cleanData.kind !== editingPartner.kind) {
        const kindRes = await changeKindAllowed(editingPartner)
        if (!kindRes.ok) {
          setSubmitError(kindRes.error || 'Không thể kiểm tra liên kết của đối tác.')
          return
        }
        if (!kindRes.data?.allowed) {
          setSubmitError(kindRes.data?.reason || 'Không thể đổi loại đối tác.')
          return
        }
      }

      if (!skipDuplicateCheck) {
        let dupRes = schemaMissing
          ? await listPartnersFallback({ role, kind: 'all' })
          : await listPartners({ kind: 'all', includeArchived: true })

        if (!dupRes.ok && dupRes.schemaMissing && !schemaMissing) {
          dupRes = await listPartnersFallback({ role, kind: 'all' })
        }

        if (!dupRes.ok) {
          setDupState({
            type: 'error',
            message: dupRes.error || 'Không thể kiểm tra trùng đối tác.',
            pendingData: cleanData,
          })
          return
        }

        const duplicates = findDuplicatePartners(cleanData, dupRes.data || [], {
          excludeId: editingPartner?.id,
        })
        if (duplicates.length > 0) {
          setDupState({
            type: 'duplicates',
            items: duplicates,
            pendingData: cleanData,
          })
          return
        }
      }

      const query = editingPartner
        ? supabase.from('partners').update(cleanData).eq('id', editingPartner.id).select('id').maybeSingle()
        : supabase.from('partners').insert([cleanData]).select('id').maybeSingle()

      const { data: savedRow, error } = await query
      if (error) throw error
      if (!savedRow) {
        setSubmitError('Không tìm thấy đối tác hoặc bạn không có quyền lưu thông tin này.')
        return
      }

      onSaved(cleanData.kind)
    } catch (err) {
      setSubmitError(formatSavePartnerError(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (savingRef.current) return

    const validation = validatePartnerInput(form)
    if (!validation.ok) {
      setFieldErrors(validation.errors)
      return
    }
    setFieldErrors({})
    performSave(validation.data, { skipDuplicateCheck: false })
  }

  return (
    <PartnerModal
      title={editingPartner ? 'Cập nhật đối tác' : 'Thêm đối tác mới'}
      onClose={onClose}
      onSubmit={handleSubmit}
      closeOnBackdrop={false}
      escapeDisabled={saving}
      footer={
        <>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--sm"
            disabled={saving}
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            type="submit"
            className={`ui-btn ui-btn--primary ui-btn--sm${saving ? ' is-loading' : ''}`}
            disabled={saving}
          >
            {saving ? 'Đang lưu...' : 'Lưu đối tác'}
          </button>
        </>
      }
    >
      <div className="ui-stack">
        {(submitError || dupState) && (
          <div ref={alertRef} className="ui-stack">
            {submitError && <div className="ui-alert ui-alert--danger">{submitError}</div>}

            {dupState?.type === 'duplicates' && (
              <div className="ui-alert ui-alert--warn">
                <strong>Phát hiện đối tác có thể bị trùng:</strong>
                <ul className="ptn-dup-list">
                  {dupState.items.map(({ partner, match }) => (
                    <li key={partner.id}>
                      <strong>{partner.name}</strong> — {formatPhoneDisplay(partner.phone)} —{' '}
                      {PARTNER_KIND_LABELS[partner.kind] || partner.kind} —{' '}
                      {partner.archived_at ? 'Đã lưu trữ' : 'Đang hoạt động'}{' '}
                      ({match === 'phone' ? 'trùng SĐT' : 'tên tương tự'})
                    </li>
                  ))}
                </ul>
                <div className="ptn-dup-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn--secondary ui-btn--sm"
                    disabled={saving}
                    onClick={() => setDupState(null)}
                  >
                    Quay lại sửa
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary ui-btn--sm"
                    disabled={saving}
                    onClick={() => performSave(dupState.pendingData, { skipDuplicateCheck: true })}
                  >
                    Vẫn lưu
                  </button>
                </div>
              </div>
            )}

            {dupState?.type === 'error' && (
              <div className="ui-alert ui-alert--danger">
                <div>
                  <strong>Không thể kiểm tra trùng đối tác:</strong> {dupState.message}
                </div>
                <div className="ptn-dup-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn--secondary ui-btn--sm"
                    disabled={saving}
                    onClick={() => setDupState(null)}
                  >
                    Quay lại sửa
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary ui-btn--sm"
                    disabled={saving}
                    onClick={() => performSave(dupState.pendingData, { skipDuplicateCheck: true })}
                  >
                    Vẫn lưu
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`ui-field${fieldErrors.kind ? ' is-invalid' : ''}`}>
          <label htmlFor="ptn-kind">
            Loại đối tác<span className="ui-required">*</span>
          </label>
          <select
            id="ptn-kind"
            className="ui-select"
            value={form.kind}
            disabled={saving}
            onChange={(e) => handleFieldChange('kind', e.target.value)}
          >
            <option value="customer">Khách hàng (Thuê trang trí / Sự kiện)</option>
            <option value="supplier">Nhà cung cấp (Bán vật tư / Phụ kiện)</option>
          </select>
          {fieldErrors.kind && <span className="ui-error">{fieldErrors.kind}</span>}
        </div>

        <div className={`ui-field${fieldErrors.name ? ' is-invalid' : ''}`}>
          <label htmlFor="ptn-name">
            Tên đối tác / Công ty<span className="ui-required">*</span>
          </label>
          <input
            id="ptn-name"
            type="text"
            className="ui-input"
            placeholder="VD: Chị Hương / Kho Hoa Lụa Sài Gòn"
            value={form.name}
            disabled={saving}
            onChange={(e) => handleFieldChange('name', e.target.value)}
          />
          {fieldErrors.name && <span className="ui-error">{fieldErrors.name}</span>}
        </div>

        <div className={`ui-field${fieldErrors.phone ? ' is-invalid' : ''}`}>
          <label htmlFor="ptn-phone">Số điện thoại</label>
          <input
            id="ptn-phone"
            type="tel"
            inputMode="tel"
            className="ui-input"
            placeholder="090xxxxxxx"
            value={form.phone}
            disabled={saving}
            onChange={(e) => handleFieldChange('phone', e.target.value)}
          />
          {fieldErrors.phone && <span className="ui-error">{fieldErrors.phone}</span>}
        </div>

        <div className="ui-field">
          <label htmlFor="ptn-address">Địa chỉ</label>
          <input
            id="ptn-address"
            type="text"
            className="ui-input"
            placeholder="Địa chỉ liên hệ..."
            value={form.address}
            disabled={saving}
            onChange={(e) => handleFieldChange('address', e.target.value)}
          />
        </div>

        <div className="ui-field">
          <label htmlFor="ptn-note">Ghi chú</label>
          <textarea
            id="ptn-note"
            className="ui-textarea"
            rows={2}
            value={form.note}
            disabled={saving}
            onChange={(e) => handleFieldChange('note', e.target.value)}
          />
        </div>
      </div>
    </PartnerModal>
  )
}
