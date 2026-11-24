// Nguồn khách của lead (public.site_leads). Hàm thuần, không gọi Supabase.
// Ưu tiên cột (utm_*, fbclid, landing_path, referrer, heard_from); thiếu cột thì đọc thẻ trong note (A3).

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim()
}

// Đọc thẻ "[Biết qua: ...]" và "[Nguồn Ads: nguồn / chiến dịch / nội dung]" trong note.
export function parseNoteTags(note) {
  const text = clean(note)
  const result = { heardFrom: '', adsSource: null }
  if (!text) return result
  const heard = text.match(/\[Biết qua:\s*([^\]]*)\]/i)
  if (heard) result.heardFrom = heard[1].trim()
  const ads = text.match(/\[Nguồn Ads:\s*([^\]]*)\]/i)
  if (ads) {
    const parts = ads[1].split('/').map((p) => p.trim())
    const raw = parts.filter(Boolean).join(' / ')
    if (raw) {
      result.adsSource = {
        raw,
        utm_source: parts[0] || '',
        utm_campaign: parts[1] || '',
        utm_content: parts[2] || '',
      }
    }
  }
  return result
}

export function getLeadAttribution(lead) {
  const l = lead || {}
  const { heardFrom, adsSource } = parseNoteTags(l.note)
  const pick = (col, fallback) => clean(l[col]) || fallback || ''
  return {
    utm_source: pick('utm_source', adsSource && adsSource.utm_source),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign', adsSource && adsSource.utm_campaign),
    utm_content: pick('utm_content', adsSource && adsSource.utm_content),
    fbclid: pick('fbclid'),
    landing_path: pick('landing_path'),
    referrer: pick('referrer'),
    heard_from: pick('heard_from', heardFrom),
  }
}

// Tách utm_source thành các "từ" (ranh giới = ký tự không phải chữ/số) để tránh khớp nhầm 'fb' trong chuỗi khác.
function sourceTokens(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

const META_TOKENS = ['facebook', 'fb', 'fbads', 'instagram', 'ig', 'meta']

export const CHANNELS = {
  meta_ads: { key: 'meta_ads', label: 'Facebook / Instagram Ads', group: 'ads' },
  tiktok_ads: { key: 'tiktok_ads', label: 'TikTok Ads', group: 'ads' },
  google_ads: { key: 'google_ads', label: 'Google Ads', group: 'ads' },
  google_organic: { key: 'google_organic', label: 'Google tìm kiếm tự nhiên', group: 'organic' },
  social_organic: { key: 'social_organic', label: 'Mạng xã hội (không quảng cáo)', group: 'organic' },
  unknown: { key: 'unknown', label: 'Trực tiếp / không rõ nguồn', group: 'unknown' },
}

// Suy ra kênh theo bảng B1, kiểm tra từ trên xuống.
export function getLeadChannel(lead) {
  const a = getLeadAttribution(lead)
  const src = a.utm_source.toLowerCase()
  const medium = a.utm_medium.toLowerCase()
  const tokens = sourceTokens(src)
  const referrer = a.referrer.toLowerCase()
  const hasUtm = Boolean(src || medium || a.utm_campaign || a.utm_content)

  if (tokens.some((t) => META_TOKENS.includes(t)) || a.fbclid) return CHANNELS.meta_ads
  if (src.includes('tiktok')) return CHANNELS.tiktok_ads
  if (src.includes('google') && medium === 'cpc') return CHANNELS.google_ads
  if (!hasUtm && referrer.includes('google.')) return CHANNELS.google_organic
  if (
    !hasUtm &&
    (referrer.includes('facebook.') ||
      referrer.includes('instagram.') ||
      referrer.includes('tiktok.') ||
      referrer.includes('zalo'))
  ) {
    return CHANNELS.social_organic
  }
  if (a.heard_from) return { key: 'heard_from', label: a.heard_from, group: 'organic' }
  const createdVia = clean(lead && lead.created_via).toLowerCase()
  const entrySource = clean(lead && lead.entry_source)
  if (createdVia === 'manual' && entrySource) {
    return { key: 'manual', label: 'Nhập tay: ' + entrySource, group: 'manual' }
  }
  return CHANNELS.unknown
}

export const CHANNEL_FILTER_OPTIONS = [
  { key: 'all', label: 'Tất cả kênh' },
  { key: 'meta_ads', label: CHANNELS.meta_ads.label },
  { key: 'tiktok_ads', label: CHANNELS.tiktok_ads.label },
  { key: 'google_ads', label: CHANNELS.google_ads.label },
  { key: 'google_organic', label: CHANNELS.google_organic.label },
  { key: 'social_organic', label: CHANNELS.social_organic.label },
  { key: 'heard_from', label: 'Khách tự chọn "biết qua"' },
  { key: 'manual', label: 'Nhập tay (tất cả nguồn)' },
  { key: 'unknown', label: CHANNELS.unknown.label },
]
