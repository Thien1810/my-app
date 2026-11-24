// Quy đổi lead (public.site_leads) -> dự án (public.projects). Hàm thuần, không gọi Supabase.
import { getLeadChannel, getLeadAttribution } from './leadSource'
import { normalizeLeadStatus } from './leadStatus'
import { inferHubFromLocation, parseLeadAdsSource, WAREHOUSE_HUBS } from './metaAdsClient'

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
