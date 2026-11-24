// Trạng thái lead (khách đăng ký từ website, bảng public.site_leads) — MỘT nơi duy nhất.
export const LEAD_STATUS_META = {
  new: { label: 'Mới đăng ký', cls: 'badge-amber' },
  contacted: { label: 'Đã liên hệ', cls: 'badge-blue' },
  converted: { label: 'Đã tạo dự án', cls: 'badge-green' },
  closed: { label: 'Đã đóng', cls: 'badge-gray' },
}

export const LEAD_STATUS_ORDER = ['new', 'contacted', 'converted', 'closed']

// Đếm lead theo trạng thái. Trạng thái lạ chỉ tính vào total.
export function countLeadsByStatus(leads) {
  const counts = { total: 0 }
  for (const s of LEAD_STATUS_ORDER) counts[s] = 0
  for (const l of leads || []) {
    counts.total += 1
    if (Object.prototype.hasOwnProperty.call(counts, l.status) && l.status !== 'total') {
      counts[l.status] += 1
    }
  }
  return counts
}

// Lọc theo trạng thái ('all' = tất cả) và ô tìm kiếm (tên, SĐT, khu vực, dịch vụ, mẫu).
export function filterLeads(leads, { status = 'all', search = '' } = {}) {
  const q = (search || '').trim().toLowerCase()
  return (leads || []).filter((l) => {
    if (status !== 'all' && l.status !== status) return false
    if (q) {
      const hay = `${l.customer_name || ''} ${l.phone || ''} ${l.location || ''} ${l.service_interest || ''} ${l.selected_template || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
