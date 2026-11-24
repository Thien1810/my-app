// Quy tắc khóa/mở khóa sổ tháng - hàm thuần, không DB/React.
// Giờ Việt Nam = UTC+7 (không có giờ mùa hè).

const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const COUNTED = ['preparing', 'in_progress', 'awaiting_return', 'done']
const OPEN_STATUSES = ['quote', 'preparing', 'in_progress', 'awaiting_return']

// Tháng hiện tại theo giờ Việt Nam, dạng 'YYYY-MM'.
export function currentMonthVN(now = new Date()) {
  const d = new Date(new Date(now).getTime() + VN_OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// true khi tháng đã kết thúc (nhỏ hơn tháng hiện tại theo giờ VN).
export function isPastMonth(month, now = new Date()) {
  if (!MONTH_RE.test(month || '')) return false
  return month < currentMonthVN(now)
}

export function formatMonthVN(month) {
  if (!MONTH_RE.test(month || '')) return month || ''
  const [y, m] = month.split('-')
  return `${m}/${y}`
}

export function canLockMonth({ role, month, isLocked, now = new Date() } = {}) {
  if (role !== 'admin' && role !== 'manager') return { ok: false, reason: 'Chỉ admin hoặc quản lý mới khóa được sổ.' }
  if (!MONTH_RE.test(month || '')) return { ok: false, reason: 'Tháng không hợp lệ.' }
  if (isLocked) return { ok: false, reason: 'Tháng này đã khóa sổ.' }
  if (!isPastMonth(month, now)) return { ok: false, reason: 'Chỉ khóa được tháng đã kết thúc.' }
  return { ok: true, reason: '' }
}

export function canUnlockMonth({ role, isLocked } = {}) {
  if (role !== 'admin') return { ok: false, reason: 'Chỉ admin mới mở khóa được sổ.' }
  if (!isLocked) return { ok: false, reason: 'Tháng này chưa khóa sổ.' }
  return { ok: true, reason: '' }
}

const monthOf = (v) => (typeof v === 'string' ? v.slice(0, 7) : '')

// Danh sách kiểm tra trước khi khóa. Cảnh báo không chặn khóa.
// Mục nào thiếu dữ liệu đầu vào (mảng không truyền) thì bỏ.
export function buildLockChecklist({ month, adsRows, fixedCosts, projects } = {}) {
  const items = []
  const label = formatMonthVN(month)

  if (Array.isArray(adsRows)) {
    const n = adsRows.filter((r) => r && (monthOf(r.spend_date) || monthOf(r.month)) === month).length
    items.push(
      n === 0
        ? { key: 'ads', level: 'warn', text: `Chưa có dòng chi phí Ads nào trong tháng ${label}.` }
        : { key: 'ads', level: 'ok', text: `Sổ Ads có ${n} dòng.` },
    )
  }

  if (Array.isArray(fixedCosts)) {
    const n = fixedCosts.filter((r) => r && (!r.month || r.month === month)).length
    items.push(
      n === 0
        ? { key: 'fixed', level: 'warn', text: `Chưa có chi phí cứng nào trong tháng ${label}.` }
        : { key: 'fixed', level: 'ok', text: `Chi phí cứng có ${n} khoản.` },
    )
  }

  if (Array.isArray(projects)) {
    const inMonth = projects.filter((p) => p && monthOf(p.start_date) === month)
    const unknown = inMonth.filter(
      (p) => COUNTED.includes(p.status) && (!p.lead_source || p.lead_source === 'unknown'),
    ).length
    items.push(
      unknown > 0
        ? { key: 'unknown', level: 'warn', text: `${unknown} dự án chưa chọn nguồn khách (không tính vào CAC/ROAS).` }
        : { key: 'unknown', level: 'ok', text: 'Mọi dự án đều đã chọn nguồn khách.' },
    )
    const open = inMonth.filter((p) => OPEN_STATUSES.includes(p.status)).length
    items.push(
      open > 0
        ? {
            key: 'open',
            level: 'warn',
            text: `${open} dự án trong tháng còn đang báo giá/chuẩn bị/thi công/chờ thu hồi, số liệu có thể còn đổi.`,
          }
        : { key: 'open', level: 'ok', text: 'Không còn dự án dở dang trong tháng.' },
    )
  }
  return items
}
