// Quy đổi lead (public.site_leads) -> dự án (public.projects). Hàm thuần, không gọi Supabase.
import { getLeadChannel, getLeadAttribution } from './leadSource'
import { normalizeLeadStatus } from './leadStatus'
import { inferHubFromLocation, parseLeadAdsSource, WAREHOUSE_HUBS } from './metaAdsClient'
import { phoneKey } from './partnerInput'

const REFERRAL_HEARD = ['Bạn bè, người thân giới thiệu', 'Đã từng dùng dịch vụ Đặng Wedding']

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim()
}

// Trả { source, reason }. source thuộc: meta_ads | tiktok_ads | google_seo | referral | unknown
export function leadToProjectSource(lead) {
  const l = lead || {}
  const channel = getLeadChannel(l)
  const attr = getLeadAttribution(l)
  const entry = clean(l.entry_source)
  const heard = clean(attr.heard_from)

  if (channel.key === 'meta_ads') return { source: 'meta_ads', reason: `Suy ra từ: ${channel.label}` }
  if (channel.key === 'tiktok_ads') return { source: 'tiktok_ads', reason: `Suy ra từ: ${channel.label}` }
  if (channel.key === 'google_ads' || channel.key === 'google_organic') {
    return { source: 'google_seo', reason: `Suy ra từ: ${channel.label}` }
  }
  if (entry === 'Messenger từ quảng cáo') {
    return { source: 'meta_ads', reason: `Suy ra từ: nguồn nhập tay "${entry}"` }
  }
  if (entry === 'Giới thiệu') {
    return { source: 'referral', reason: `Suy ra từ: nguồn nhập tay "${entry}"` }
  }
  if (heard === 'Google tìm kiếm') {
    return { source: 'google_seo', reason: `Suy ra từ: khách chọn "${heard}"` }
  }
  if (REFERRAL_HEARD.includes(heard)) {
    return { source: 'referral', reason: `Suy ra từ: khách chọn "${heard}"` }
  }
  const basis = entry || heard || (channel.key === 'unknown' ? '' : channel.label)
  return {
    source: 'unknown',
    reason: basis ? `Suy ra từ: "${basis}" (không đủ căn cứ xác định nguồn)` : 'Suy ra từ: không có thông tin nguồn',
  }
}

// Trả id hub hợp lệ (xuan_loc | vinh_loc). Nguồn Ads chứa vinhloc/xuanloc được ưu tiên.
export function leadToWarehouse(lead) {
  const l = lead || {}
  const attr = getLeadAttribution(l)
  const adsText = [parseLeadAdsSource(l.note), attr.utm_source, attr.utm_campaign, attr.utm_content]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  let hub
  if (adsText.includes('vinhloc')) hub = 'vinh_loc'
  else if (adsText.includes('xuanloc')) hub = 'xuan_loc'
  else hub = inferHubFromLocation(clean(l.location))
  return WAREHOUSE_HUBS.some((h) => h.id === hub) ? hub : WAREHOUSE_HUBS[0].id
}

// Chỉ lead Mới / Tư vấn và chưa có dự án liên kết mới được tạo dự án.
export function canConvertLead({ status, linkedProject } = {}) {
  if (linkedProject) {
    return { ok: false, reason: `Lead này đã có dự án ${linkedProject.code || ''}`.trim() }
  }
  const s = normalizeLeadStatus(status)
  if (s === 'new' || s === 'consulting') return { ok: true, reason: '' }
  return { ok: false, reason: 'Chỉ khách ở trạng thái Mới hoặc Tư vấn mới được tạo dự án' }
}

// Chỉ trùng SĐT KHÁCH, kể cả hồ sơ lưu trữ; tên giống không tự quyết định việc dùng lại.
export function findLeadCustomerMatches(lead, partners = []) {
  const key = phoneKey(lead?.phone)
  return key ? partners.filter((p) => p.kind === 'customer' && phoneKey(p.phone) === key) : []
}

// Không mặc định chọn khách đầu tiên. 'auto' chỉ được dùng khi chưa thấy khách trùng;
// Bên gọi phải tìm lại khách trước khi ghi.
export function resolveLeadCustomerChoice(matches = [], choice = '') {
  if (choice === 'new') return { ok: true, customerChoice: 'new', customerId: null }
  const selected = matches.find((p) => String(p.id) === String(choice))
  if (selected) return { ok: true, customerChoice: 'existing', customerId: selected.id }
  if (!matches.length && !choice) return { ok: true, customerChoice: 'auto', customerId: null }
  return { ok: false, reason: 'Chọn dùng khách cũ hoặc tạo khách mới.' }
}

export function leadConversionError(error) {
  if (['42703', '42P01', 'PGRST202', 'PGRST204', 'PGRST205', '42883'].includes(error?.code)) {
    return 'Chưa thể chuyển lead: anh Thiện cần chạy supabase/partners_v2.sql và các SQL phụ thuộc ghi đầu file.'
  }
  if (error?.code === '42501') return 'Chỉ quản trị hoặc quản lý được tạo dự án từ lead.'
  if (error?.code === 'P0001') return error.message || 'Dữ liệu đã thay đổi. Hãy tải lại khách trùng và thử lại.'
  return 'Không thể tạo dự án. Hãy kiểm tra kết nối rồi thử lại; hệ thống sẽ kiểm tra dự án đã tạo trước đó.'
}

export function isMissingLeadLinkColumn(error) {
  return ['42703', 'PGRST204'].includes(error?.code) && /site_lead_id/i.test(error?.message || '')
}
