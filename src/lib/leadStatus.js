import { getLeadAttribution, getLeadChannel } from './leadSource'

// Trạng thái lead (khách đăng ký từ website, bảng public.site_leads) — MỘT nơi duy nhất.
// Quy trình: Mới -> Tư vấn -> Báo giá -> Cọc -> Hoàn thành, hoặc Mất (kèm lý do).
export const LEAD_STATUS_META = {
  new: { label: 'Mới', cls: 'badge-amber' },
  consulting: { label: 'Tư vấn', cls: 'badge-blue' },
  quoted: { label: 'Báo giá', cls: 'badge-purple' },
  deposited: { label: 'Cọc', cls: 'badge-green' },
  completed: { label: 'Hoàn thành', cls: 'badge-green' },
  lost: { label: 'Mất', cls: 'badge-gray' },
}

export const LEAD_STATUS_ORDER = ['new', 'consulting', 'quoted', 'deposited', 'completed', 'lost']

// Lý do mất lead (khớp check site_leads_lost_reason_check trong supabase/site_leads_workflow.sql).
export const LEAD_LOST_REASONS = [
  { key: 'gia_cao', label: 'Giá cao' },
  { key: 'chon_don_vi_khac', label: 'Chọn đơn vị khác' },
  { key: 'doi_huy_ngay_cuoi', label: 'Đổi hoặc hủy ngày cưới' },
  { key: 'khong_lien_lac_duoc', label: 'Không liên lạc được' },
  { key: 'ngoai_vung', label: 'Ngoài vùng phục vụ' },
  { key: 'khac', label: 'Khác' },
]

export function getLostReasonLabel(key) {
  const f = LEAD_LOST_REASONS.find((r) => r.key === key)
  return f ? f.label : key || ''
}

// Ánh xạ trạng thái cũ -> mới. Giá trị lạ hoặc rỗng -> 'new'.
const LEGACY_STATUS_MAP = { contacted: 'consulting', converted: 'quoted', closed: 'lost' }

export function normalizeLeadStatus(s) {
  if (Object.prototype.hasOwnProperty.call(LEAD_STATUS_META, s)) return s
  if (Object.prototype.hasOwnProperty.call(LEGACY_STATUS_MAP, s)) return LEGACY_STATUS_MAP[s]
  return 'new'
}

// Đếm lead theo trạng thái (đã chuẩn hóa). Luôn có total + mỗi trạng thái mới.
export function countLeadsByStatus(leads) {
  const counts = { total: 0 }
  for (const s of LEAD_STATUS_ORDER) counts[s] = 0
  for (const l of leads || []) {
    counts.total += 1
    counts[normalizeLeadStatus(l.status)] += 1
  }
  return counts
}

// Lọc theo trạng thái ('all' = tất cả), kênh ('all' = tất cả) và ô tìm kiếm
// (tên, SĐT, khu vực, dịch vụ, mẫu, chiến dịch, nội dung, trang vào).
export function filterLeads(leads, { status = 'all', channel = 'all', search = '' } = {}) {
  const q = (search || '').trim().toLowerCase()
  return (leads || []).filter((l) => {
    if (status !== 'all' && normalizeLeadStatus(l.status) !== status) return false
    if (channel !== 'all' && getLeadChannel(l).key !== channel) return false
    if (q) {
      const a = getLeadAttribution(l)
      const hay = `${l.customer_name || ''} ${l.phone || ''} ${l.location || ''} ${l.service_interest || ''} ${l.selected_template || ''} ${a.utm_campaign} ${a.utm_content} ${a.landing_path}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// "N giờ/ngày trước" từ một mốc thời gian (ISO). Trả '' nếu không có hoặc không hợp lệ.
export function formatTimeAgo(iso, now = Date.now()) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.floor((now - t) / 60000))
  if (mins < 60) return 'vừa xong'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}
