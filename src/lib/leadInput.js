// Nhập lead thủ công (khách nhắn Messenger / Zalo / gọi điện). Hàm thuần, không gọi Supabase.

// Nguồn nhập tay (bắt buộc chọn, không có mặc định). Lưu nguyên nhãn vào cột entry_source.
export const MANUAL_ENTRY_SOURCES = [
  'Messenger từ quảng cáo',
  'Messenger tự nhiên',
  'Zalo',
  'Gọi điện',
  'Giới thiệu',
  'Khác',
]

// Dịch vụ: đúng danh sách form trên website dangwed.com (siteContent.js SERVICES + "Trọn gói").
export const LEAD_SERVICE_OPTIONS = [
  'Trang trí Gia tiên',
  'Mâm quả cưới hỏi',
  'Cổng hoa cưới',
  'Backdrop tiệc cưới',
  'Cho thuê rạp & bàn ghế',
  'Trọn gói nhiều hạng mục',
]

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim()
}

// Chỉ giữ chữ số; +84 / 84 đầu -> 0. Ví dụ '0918.809.096', '+84 918-809-096' -> '0918809096'.
export function normalizePhone(s) {
  const raw = clean(s)
  if (!raw) return ''
  const hadPlus84 = /^\+\s*84/.test(raw)
  let digits = raw.replace(/\D/g, '')
  if (hadPlus84 || (digits.startsWith('84') && digits.length >= 11)) {
    digits = digits.replace(/^84/, '')
    if (!digits.startsWith('0')) digits = '0' + digits
  }
  // '+84 0918...' (có số 0 thừa) -> bỏ 0 thừa
  digits = digits.replace(/^00+/, '0')
  return digits
}

export function isValidVnPhone(s) {
  return /^0\d{8,10}$/.test(normalizePhone(s))
}

export function validateNewLead(input) {
  const i = input || {}
  const errors = {}
  if (!clean(i.customer_name)) errors.customer_name = 'Nhập tên khách.'
  if (!clean(i.phone)) errors.phone = 'Nhập số điện thoại.'
  else if (!isValidVnPhone(i.phone)) errors.phone = 'Số điện thoại không hợp lệ (9-11 chữ số, bắt đầu bằng 0).'
  if (!clean(i.entry_source)) errors.entry_source = 'Chọn nguồn khách.'
  else if (!MANUAL_ENTRY_SOURCES.includes(clean(i.entry_source))) errors.entry_source = 'Nguồn khách không hợp lệ.'
  return { ok: Object.keys(errors).length === 0, errors }
}

// Dòng insert vào site_leads. Không gửi cột utm_*.
export function buildManualLeadRow(input) {
  const i = input || {}
  return {
    customer_name: clean(i.customer_name),
    phone: normalizePhone(i.phone),
    event_date: clean(i.event_date) || null,
    location: clean(i.location) || null,
    service_interest: clean(i.service_interest) || null,
    note: clean(i.note) || null,
    status: 'new',
    entry_source: clean(i.entry_source),
    created_via: 'manual',
  }
}

// Tìm lead có cùng SĐT (so khớp theo SĐT đã chuẩn hóa). Trả lead đầu tiên (leads thường mới nhất trước) hoặc null.
export function findDuplicatePhone(leads, phone) {
  const target = normalizePhone(phone)
  if (!target) return null
  return (leads || []).find((l) => normalizePhone(l && l.phone) === target) || null
}

// Lỗi do cột entry_source/created_via chưa có (chưa chạy site_leads_workflow.sql).
export function isMissingLeadColumnErr(err) {
  if (!err) return false
  const msg = String(err.message || '')
  return (
    err.code === 'PGRST204' ||
    err.code === '42703' ||
    /entry_source|created_via/i.test(msg)
  )
}
