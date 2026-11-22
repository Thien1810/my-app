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


// ---------- QUY TẮC ĐẶT MÃ CHUẨN NGÀNH TRANG TRÍ ----------
// Vật tư: [TH|TSD]-[NHÓM]-[001]
// Dự án:  DA-[YYMM]-[001]
export const ITEM_CATEGORY_PRESETS = [
  { name: 'Hoa tươi', code: 'HOA', defaultKind: 'consumable', unit: 'bó' },
  { name: 'Bóng bay', code: 'BONG', defaultKind: 'consumable', unit: 'bịch' },
  { name: 'Băng keo & Phụ liệu', code: 'PHU', defaultKind: 'consumable', unit: 'cuộn' },
  { name: 'In ấn & Formex', code: 'IN', defaultKind: 'consumable', unit: 'tấm' },
  { name: 'Nến & Hiệu ứng', code: 'NEN', defaultKind: 'consumable', unit: 'hộp' },
  { name: 'Khung & Backdrop', code: 'KHUNG', defaultKind: 'reusable', unit: 'bộ' },
  { name: 'Đèn & Ánh sáng', code: 'DEN', defaultKind: 'reusable', unit: 'cái' },
  { name: 'Vải, Rèm & Thảm', code: 'VAI', defaultKind: 'reusable', unit: ' tấm' },
  { name: 'Hoa lụa & Cây giả', code: 'HOALUA', defaultKind: 'reusable', unit: 'cành' },
  { name: 'Bàn ghế & Bục', code: 'BAN', defaultKind: 'reusable', unit: 'cái' },
  { name: 'Đạo cụ & Phụ kiện', code: 'DAOCU', defaultKind: 'reusable', unit: 'cái' },
  { name: 'Dụng cụ thi công', code: 'DC', defaultKind: 'reusable', unit: 'cái' },
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

export function generateItemCode(kind = 'consumable', category = '', existingItems = []) {
  const kindPrefix = kind === 'reusable' ? 'TSD' : 'TH'
  const catCode = toCategoryCode(category)
  const prefix = `${kindPrefix}-${catCode}-`

  let maxNum = 0
  for (const item of existingItems) {
    const c = (item.code || '').toUpperCase().trim()
    if (c.startsWith(prefix)) {
      const numPart = parseInt(c.slice(prefix.length), 10)
      if (!Number.isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart
      }
    }
  }
  const nextNum = String(maxNum + 1).padStart(3, '0')
  return `${prefix}${nextNum}`
}

export function generateProjectCode(startDate = '', existingProjects = []) {
  const d = startDate ? new Date(startDate) : new Date()
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d
  const yy = String(validDate.getFullYear()).slice(-2)
  const mm = String(validDate.getMonth() + 1).padStart(2, '0')
  const prefix = `DA-${yy}${mm}-`

  let maxNum = 0
  for (const p of existingProjects) {
    const c = (p.code || '').toUpperCase().trim()
    if (c.startsWith(prefix)) {
      const numPart = parseInt(c.slice(prefix.length), 10)
      if (!Number.isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart
      }
    }
  }
  const nextNum = String(maxNum + 1).padStart(3, '0')
  return `${prefix}${nextNum}`
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
