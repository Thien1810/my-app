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

// Luôn định dạng dấu chấm (.) giữa mỗi 3 chữ số: 10.000; 250.000; 1.000.000
export function formatPriceDots(value) {
  const num = Math.round(Number(value || 0))
  if (Number.isNaN(num)) return '0'
  const sign = num < 0 ? '-' : ''
  const absStr = String(Math.abs(num))
  return sign + absStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function parsePriceInput(str) {
  if (typeof str === 'number') return Math.round(str)
  const digits = String(str || '').replace(/[^\d-]/g, '')
  const parsed = parseInt(digits, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function formatCurrency(value) {
  return formatPriceDots(value) + ' ₫'
}

export function formatNumber(value) {
  const num = Number(value || 0)
  if (Number.isNaN(num)) return '0'
  const isInt = Number.isInteger(num)
  if (isInt) return formatPriceDots(num)
  const [intPart, decPart] = num.toFixed(2).replace(/\.?0+$/, '').split('.')
  const formattedInt = formatPriceDots(Number(intPart))
  return decPart ? `${formattedInt},${decPart}` : formattedInt
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


// ---------- QUY TẮC ĐẶT MÃ CHUẨN NGÀNH TRANG TRÍ ----------
// Vật tư: [TH|TSD]-[NHÓM]-[001]
// Dự án:  DA-[YYMM]-[001]
export const ITEM_CATEGORY_PRESETS = [
  { name: 'Hoa & Lá', code: 'HOA', defaultKind: 'consumable', unit: 'bó' },
  { name: 'Phụ kiện & Vật tư phụ', code: 'PHU', defaultKind: 'consumable', unit: 'cái' },
  { name: 'Khung & Backdrop', code: 'KHUNG', defaultKind: 'reusable', unit: 'bộ' },
  { name: 'Đèn & Ánh sáng', code: 'DEN', defaultKind: 'reusable', unit: 'cái' },
  { name: 'Vải, Rèm & Thảm', code: 'VAI', defaultKind: 'reusable', unit: 'tấm' },
]

export function toCategoryCode(category = '') {
  const clean = category.trim()
  if (!clean) return 'VT'
  const preset = ITEM_CATEGORY_PRESETS.find(
    (p) => p.name.toLowerCase() === clean.toLowerCase()
  )
  if (preset) return preset.code

  // Bỏ dấu tiếng Việt và lấy chữ cái đầu hoặc từ đầu tiên
  const ascii = clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
  const words = ascii.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'VT'
  if (words.length === 1) return words[0].slice(0, 6)
  return words[0].slice(0, 5)
}

export function findDuplicateCode(code = '', list = [], excludeId = null) {
  const clean = (code || '').trim().toUpperCase()
  if (!clean) return null
  return (
    list.find(
      (entry) =>
        entry.id !== excludeId &&
        (entry.code || '').trim().toUpperCase() === clean
    ) || null
  )
}

export function generateItemCode(
  kind = 'consumable',
  category = '',
  existingItems = [],
  excludeId = null
) {
  const kindPrefix = kind === 'reusable' ? 'TSD' : 'TH'
  const catCode = toCategoryCode(category)
  const prefix = `${kindPrefix}-${catCode}-`

  const usedSet = new Set(
    existingItems
      .filter((i) => i.id !== excludeId && i.code)
      .map((i) => i.code.trim().toUpperCase())
  )

  let maxNum = 0
  for (const c of usedSet) {
    if (c.startsWith(prefix)) {
      const numPart = parseInt(c.slice(prefix.length), 10)
      if (!Number.isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart
      }
    }
  }

  let candidateNum = maxNum + 1
  let candidate = `${prefix}${String(candidateNum).padStart(3, '0')}`
  while (usedSet.has(candidate)) {
    candidateNum += 1
    candidate = `${prefix}${String(candidateNum).padStart(3, '0')}`
  }
  return candidate
}

export function generateProjectCode(
  startDate = '',
  existingProjects = [],
  excludeId = null
) {
  const d = startDate ? new Date(startDate) : new Date()
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d
  const yy = String(validDate.getFullYear()).slice(-2)
  const mm = String(validDate.getMonth() + 1).padStart(2, '0')
  const prefix = `DA-${yy}${mm}-`

  const usedSet = new Set(
    existingProjects
      .filter((p) => p.id !== excludeId && p.code)
      .map((p) => p.code.trim().toUpperCase())
  )

  let maxNum = 0
  for (const c of usedSet) {
    if (c.startsWith(prefix)) {
      const numPart = parseInt(c.slice(prefix.length), 10)
      if (!Number.isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart
      }
    }
  }

  let candidateNum = maxNum + 1
  let candidate = `${prefix}${String(candidateNum).padStart(3, '0')}`
  while (usedSet.has(candidate)) {
    candidateNum += 1
    candidate = `${prefix}${String(candidateNum).padStart(3, '0')}`
  }
  return candidate
}

export function translateAuthError(message = '') {
  const msg = String(message || '')
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login credentials')) {
    return 'Email hoặc mật khẩu chưa đúng (hoặc bạn chưa bấm "Đăng ký" tài khoản trên database mới này).'
  }
  if (lower.includes('email not confirmed')) {
    return 'Email chưa được xác nhận. Vui lòng kiểm tra hộp thư email hoặc tắt "Confirm email" trong Supabase > Authentication > Providers > Email.'
  }
  if (lower.includes('user already registered')) {
    return 'Email này đã được đăng ký. Vui lòng chuyển sang mục Đăng nhập.'
  }
  if (lower.includes('password should be at least')) {
    return 'Mật khẩu phải có ít nhất 6 ký tự.'
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Bạn thao tác quá nhanh, vui lòng đợi khoảng 1 phút rồi thử lại.'
  }
  return msg || 'Đã xảy ra lỗi. Vui lòng thử lại.'
}


// ---------- MÀU SẮC VẬT TƯ NGÀNH CƯỚI ----------
export const ITEM_COLOR_PRESETS = [
  { name: 'Trắng', hex: '#ffffff', border: '#cbd5e1' },
  { name: 'Trắng kem', hex: '#fef3c7', border: '#fcd34d' },
  { name: 'Hồng Pastel', hex: '#fce7f3', border: '#f9a8d4' },
  { name: 'Hồng phấn', hex: '#f472b6', border: '#ec4899' },
  { name: 'Đỏ tươi', hex: '#ef4444', border: '#dc2626' },
  { name: 'Đỏ rượu (Burgundy)', hex: '#881337', border: '#881337' },
  { name: 'Vàng đồng (Gold)', hex: '#eab308', border: '#ca8a04' },
  { name: 'Vàng Champagne', hex: '#fde68a', border: '#f59e0b' },
  { name: 'Xanh lá', hex: '#22c55e', border: '#16a34a' },
  { name: 'Xanh dương Pastel', hex: '#bae6fd', border: '#38bdf8' },
  { name: 'Tím Pastel', hex: '#e9d5ff', border: '#c084fc' },
  { name: 'Nâu gỗ', hex: '#92400e', border: '#78350f' },
  { name: 'Bạc (Silver)', hex: '#cbd5e1', border: '#94a3b8' },
  { name: 'Đen', hex: '#1e293b', border: '#0f172a' },
  { name: 'Trong suốt', hex: '#f8fafc', border: '#94a3b8' },
  { name: 'Nhiều màu', hex: '#16a34a', border: '#16a34a' },
]

export function getColorSwatch(colorName = '') {
  const clean = (colorName || '').trim().toLowerCase()
  if (!clean) return null
  const found = ITEM_COLOR_PRESETS.find((c) => c.name.toLowerCase() === clean)
  if (found) return found
  if (clean.includes('trắng')) return ITEM_COLOR_PRESETS[0]
  if (clean.includes('kem')) return ITEM_COLOR_PRESETS[1]
  if (clean.includes('hồng')) return ITEM_COLOR_PRESETS[2]
  if (clean.includes('đỏ')) return ITEM_COLOR_PRESETS[4]
  if (clean.includes('vàng') || clean.includes('gold')) return ITEM_COLOR_PRESETS[6]
  if (clean.includes('xanh lá') || clean.includes('rêu')) return ITEM_COLOR_PRESETS[8]
  if (clean.includes('xanh')) return ITEM_COLOR_PRESETS[9]
  if (clean.includes('tím')) return ITEM_COLOR_PRESETS[10]
  if (clean.includes('nâu') || clean.includes('gỗ')) return ITEM_COLOR_PRESETS[11]
  if (clean.includes('bạc')) return ITEM_COLOR_PRESETS[12]
  if (clean.includes('đen')) return ITEM_COLOR_PRESETS[13]
  return { name: colorName, hex: '#e2e8f0', border: '#94a3b8' }
}

const COLOR_TAG_REGEX = /^\[Màu:\s*([^\]]+)\]\s*/i

export function extractItemColor(item) {
  if (!item) return ''
  if (item.color && String(item.color).trim()) {
    return String(item.color).trim()
  }
  const note = String(item.note || '')
  const match = note.match(COLOR_TAG_REGEX)
  return match ? match[1].trim() : ''
}

export function extractItemCleanNote(item) {
  if (!item) return ''
  const note = String(item.note || '')
  return note.replace(COLOR_TAG_REGEX, '').trim()
}

export function packNoteWithColorFallback(color = '', cleanNote = '') {
  const c = (color || '').trim()
  const n = (cleanNote || '').replace(COLOR_TAG_REGEX, '').trim()
  if (!c) return n || null
  return n ? `[Màu: ${c}] ${n}` : `[Màu: ${c}]`
}
