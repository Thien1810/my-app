import { useState } from 'react'
import CurrencyInput from './CurrencyInput'

// Nhóm ô Doanh số / Ưu đãi / Doanh thu.
// Doanh thu = Doanh số - Ưu đãi (số khách thực trả, lưu ở project_finance.contract_value).
// canSeeDiscount = false (Thủ kho, vai trò khác): chỉ thấy Doanh thu, read-only.
// Giá trị ưu đãi đang gõ được giữ nội bộ (draft) để hiện lỗi; onChange chỉ được gọi khi hợp lệ.
// Cha nên đặt key theo dự án/lần mở form để draft được khởi tạo lại.
export default function ContractValueFields({
  grossSales = 0,
  discount = 0,
  onChange,
  onValidChange, // tùy chọn: báo true/false để cha chặn lưu khi đang nhập sai
  canEdit = false,
  canSeeDiscount = false,
}) {
  const [draftGross, setDraftGross] = useState(Number(grossSales) || 0)
  const [draftDiscount, setDraftDiscount] = useState(Number(discount) || 0)

  if (!canSeeDiscount) {
    const revenue = (Number(grossSales) || 0) - (Number(discount) || 0)
    return (
      <div className="form-group">
        <label>Doanh thu (khách thanh toán) (₫)</label>
        <CurrencyInput value={revenue} onChange={() => {}} disabled />
      </div>
    )
  }

  const error =
    draftDiscount < 0
      ? 'Ưu đãi không được âm.'
      : draftDiscount > draftGross
        ? 'Ưu đãi không được lớn hơn doanh số.'
        : ''
  const revenue = error ? 0 : draftGross - draftDiscount

  const emit = (g, d) => {
    const ok = d >= 0 && d <= g
    onValidChange?.(ok)
    if (!ok) return // không gọi onChange với giá trị sai
    onChange?.({ grossSales: g, discount: d, revenue: g - d })
  }

  const handleGross = (num) => {
    const g = Math.max(0, Number(num) || 0)
    setDraftGross(g)
    emit(g, draftDiscount)
  }

  const handleDiscount = (num) => {
    const d = Number(num) || 0
    setDraftDiscount(d)
    emit(draftGross, d)
  }

  return (
    <>
      <div className="form-group">
        <label>Doanh số (giá gói) (₫)</label>
        <CurrencyInput
          value={draftGross}
          onChange={handleGross}
          disabled={!canEdit}
          placeholder="VD: 10.000.000"
        />
      </div>
      <div className="form-group">
        <label>Ưu đãi (₫)</label>
        <CurrencyInput
          value={draftDiscount}
          onChange={handleDiscount}
          disabled={!canEdit}
          placeholder="VD: 1.000.000"
        />
        {error && (
          <div style={{ color: '#dc2626', fontSize: '0.85em', marginTop: 4 }}>{error}</div>
        )}
      </div>
      <div className="form-group">
        <label>Doanh thu (khách thanh toán) (₫)</label>
        <CurrencyInput value={revenue} onChange={() => {}} disabled />
      </div>
    </>
  )
}
