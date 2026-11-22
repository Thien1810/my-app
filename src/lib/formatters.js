export const ROLE_LABELS = {
  pending: 'Chờ duyệt',
  admin: 'Quản trị',
  manager: 'Quản lý',
  storekeeper: 'Thủ kho',
  staff: 'Nhân viên thi công',
}

export const KIND_LABELS = {
  consumable: 'Tiêu hao',
  reusable: 'Tái sử dụng',
}

export const PARTNER_KIND_LABELS = {
  supplier: 'Nhà cung cấp',
  customer: 'Khách hàng',
}

export const PROJECT_STATUS_LABELS = {
  quote: 'Báo giá',
  preparing: 'Đang chuẩn bị',
  in_progress: 'Đang thi công',
  awaiting_return: 'Chờ thu hồi',
  done: 'Hoàn thành',
  cancelled: 'Đã hủy',
}

export const MOVEMENT_TYPE_LABELS = {
  purchase: 'Nhập mua',
  issue: 'Xuất dự án',
  return_good: 'Thu hồi tốt',
  return_damaged: 'Thu hồi hỏng',
  return_lost: 'Báo mất',
  repair_done: 'Sửa xong',
  dispose: 'Thanh lý',
  adjust: 'Điều chỉnh',
}

export function formatCurrency(value) {
  const num = Number(value || 0)
  return new Intl.NumberFormat('vi-VN').format(Math.round(num)) + ' ₫'
}

export function formatNumber(value) {
  const num = Number(value || 0)
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const str = String(dateStr).slice(0, 10)
  const parts = str.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return String(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

export function todayISO() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
