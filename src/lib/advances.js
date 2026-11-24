// Hàm thuần cho tạm ứng/cọc dự án (không import supabase).
// received = Σ advance - Σ refund (forfeit không tính vào đã thu);
// outstanding = contractValue - received. Tiền cọc/tạm ứng KHÔNG phải doanh thu.

export const ADVANCE_KINDS = ['advance', 'refund', 'forfeit']

export const ADVANCE_KIND_LABELS = {
  advance: 'Khách đưa',
  refund: 'Hoàn lại khách',
  forfeit: 'Mất cọc (khách hủy)',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// Dùng Math.abs để chịu cả hai dấu trong DB (refund lưu số âm).
export function summarizeAdvances(rows, contractValue) {
  let advanceTotal = 0
  let refundTotal = 0
  let forfeitTotal = 0
  for (const r of rows || []) {
    const a = Math.abs(Number(r?.amount) || 0)
    if (r?.kind === 'advance') advanceTotal += a
    else if (r?.kind === 'refund') refundTotal += a
    else if (r?.kind === 'forfeit') forfeitTotal += a
  }
  const received = advanceTotal - refundTotal
  return {
    advanceTotal,
    refundTotal,
    forfeitTotal,
    received,
    outstanding: (Number(contractValue) || 0) - received,
  }
}

// Tiền mặt vào trong tháng (chỉ theo dõi dòng tiền, KHÔNG phải doanh thu):
// Σ advance - Σ refund có received_date thuộc month ('YYYY-MM'); forfeit không tính.
export function monthlyCashIn(rows, month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return 0
  let total = 0
  for (const r of rows || []) {
    if (!isValidDate(r?.received_date) || r.received_date.slice(0, 7) !== month) continue
    const a = Math.abs(Number(r?.amount) || 0)
    if (r.kind === 'advance') total += a
    else if (r.kind === 'refund') total -= a
  }
  return total
}

// Trả chuỗi lỗi tiếng Việt, hoặc '' nếu hợp lệ. amount là số dương người dùng nhập.
export function validateAdvanceInput({ kind, amount, receivedDate, rows }) {
  if (!ADVANCE_KINDS.includes(kind)) return 'Loại khoản không hợp lệ.'
  const n = Number(amount)
  if (amount === '' || amount === null || amount === undefined || !Number.isFinite(n) || !(n > 0)) {
    return 'Số tiền phải lớn hơn 0.'
  }
  if (!isValidDate(receivedDate)) return 'Ngày phải có dạng YYYY-MM-DD hợp lệ.'
  if (kind === 'refund' || kind === 'forfeit') {
    const s = summarizeAdvances(rows, 0)
    const held = s.received - s.forfeitTotal
    if (n > held) {
      return kind === 'refund'
        ? 'Số hoàn lại không được lớn hơn số tiền đang giữ của khách.'
        : 'Số mất cọc không được lớn hơn số tiền đang giữ của khách.'
    }
  }
  return ''
}

// Hàng để insert: refund lưu số ÂM, còn lại DƯƠNG.
export function toAdvanceRow({ projectId, kind, amount, receivedDate, note }) {
  const a = Math.abs(Number(amount) || 0)
  const trimmed = typeof note === 'string' ? note.trim() : ''
  return {
    project_id: projectId,
    kind,
    amount: kind === 'refund' ? -a : a,
    received_date: receivedDate,
    note: trimmed || null,
  }
}
