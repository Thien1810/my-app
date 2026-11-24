// Mã phiếu kho: PN (nhập mua), KK (kiểm kho), DH (đồ hỏng), CK (chuyển kho).
// Mã do RPC next_receipt_code cấp; app vẫn chạy bình thường khi SQL chưa được chạy (không có mã).

export const RECEIPT_PREFIX = { PURCHASE: 'PN', ADJUST: 'KK', DAMAGED: 'DH', TRANSFER: 'CK' }

// Loại phiếu kho (stock_movements.type) -> tiền tố mã. Loại khác (xuất, thu hồi...) không có mã.
export function prefixForMovementType(type) {
  if (type === 'purchase') return RECEIPT_PREFIX.PURCHASE
  if (type === 'adjust') return RECEIPT_PREFIX.ADJUST
  if (type === 'repair_done' || type === 'dispose') return RECEIPT_PREFIX.DAMAGED
  return null
}

// Lỗi do cột receipt_code chưa tồn tại (SQL chưa chạy): thông báo chứa 'receipt_code' hoặc mã PGRST204 / 42703.
export function isMissingReceiptColumnError(err) {
  if (!err) return false
  const code = String(err.code || '')
  if (code === 'PGRST204' || code === '42703') return true
  return /receipt_code/i.test(String(err.message || ''))
}

// Thêm receipt_code vào mọi dòng khi có mã; không có mã thì trả nguyên dòng (không thêm cột).
export function withReceiptCode(rows, code) {
  if (!code) return rows
  return rows.map((r) => ({ ...r, receipt_code: code }))
}

// Thông báo lưu phiếu; không có mã thì dùng câu cũ (fallback).
export function savedReceiptMessage(code, lineCount, fallback) {
  if (!code) return fallback
  return `Đã lưu phiếu ${code} (${lineCount} dòng)`
}
