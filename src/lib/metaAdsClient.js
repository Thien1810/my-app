// =====================================================================
// HỆ THỐNG QUẢN TRỊ CHI PHÍ MARKETING (META API) + CHI PHÍ CỨNG CỐ ĐỊNH
// & ĐỊNH DANH NGUỒN KHÁCH / ĐẦU KHO (CHUẨN P&L 2 TẦNG - CHỈ ADMIN/MANAGER)
// =====================================================================

const META_CONFIG_STORAGE_KEY = 'dw_meta_ads_config_v1'
const MANUAL_ADS_LOGS_STORAGE_KEY = 'dw_ads_spend_logs_v1'
const FIXED_COSTS_STORAGE_KEY = 'dw_fixed_overhead_costs_v1'
const FIXED_TEMPLATE_STORAGE_KEY = 'dw_fixed_overhead_template_v1'

export const WAREHOUSE_HUBS = [
  { id: 'xuan_loc', label: 'Kho Xuân Lộc (Đồng Nai)', shortLabel: 'Kho Xuân Lộc' },
  { id: 'vinh_loc', label: 'Kho Vĩnh Lộc (TP.HCM)', shortLabel: 'Kho Vĩnh Lộc' },
]

export const PROJECT_LEAD_SOURCES = [
  { id: 'meta_ads', label: 'Meta Ads (Facebook / Instagram)', isPaidAds: true },
  { id: 'tiktok_ads', label: 'TikTok / Reels Ads', isPaidAds: true },
  { id: 'google_seo', label: 'Website dangwed.com / SEO Google', isPaidAds: false },
  { id: 'referral', label: 'Khách quen / Giới thiệu (0đ Ads)', isPaidAds: false },
  { id: 'partner', label: 'Đối tác Studio / Nhà hàng', isPaidAds: false },
]

export const FIXED_COST_CATEGORIES = [
  '🏠 Thuê mặt bằng / Kho bãi (Xuân Lộc & Vĩnh Lộc)',
  '👨‍💼 Lương cứng nhân sự cố định / Quản lý / Trực page',
  '⚡ Điện, Nước, Internet, Zalo OA / Viễn thông',
  '🌐 Server, Tên miền (dangwed.com), Phần mềm & AI',
  '🚚 Bảo dưỡng xe tải / Khấu hao thiết bị chung',
  '📌 Chi phí cố định khác',
]

export const DEFAULT_FIXED_COST_TEMPLATE = [
  {
    category: '🏠 Thuê mặt bằng / Kho bãi (Xuân Lộc & Vĩnh Lộc)',
    title: 'Chi phí kho chính Xuân Lộc & kho trung chuyển Vĩnh Lộc',
    hub: 'all',
    amount: 3000000,
  },
  {
    category: '👨‍💼 Lương cứng nhân sự cố định / Quản lý / Trực page',
    title: 'Phụ cấp trực page tư vấn & quản lý kho cố định',
    hub: 'all',
    amount: 2500000,
  },
  {
    category: '⚡ Điện, Nước, Internet, Zalo OA / Viễn thông',
    title: 'Điện nước kho, Wifi & cước hotline/Zalo',
    hub: 'all',
    amount: 600000,
  },
  {
    category: '🌐 Server, Tên miền (dangwed.com), Phần mềm & AI',
    title: 'Duy trì hệ thống web dangwed.com & công cụ AI',
    hub: 'all',
    amount: 300000,
  },
]

export const DEFAULT_META_ADS_CONFIG = {
  adAccountId: '', // VD: act_1234567890
  accessToken: '', // System User Token hoặc User Token có quyền ads_read
  pixelId: '', // Meta Pixel ID gắn trên dangwed.com
  monthlyBudget: 4000000, // 4.000.000đ (trong khung 3 - 5 triệu)
  targetCplMin: 35000,
  targetCplMax: 55000,
  killCplThreshold: 75000,
}

export function getSavedMetaAdsConfig() {
  try {
    const raw = localStorage.getItem(META_CONFIG_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_META_ADS_CONFIG }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_META_ADS_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_META_ADS_CONFIG }
  }
}

export function saveMetaAdsConfig(nextConfig = {}) {
  const merged = { ...getSavedMetaAdsConfig(), ...nextConfig }
  try {
    localStorage.setItem(META_CONFIG_STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // ignore
  }
  return merged
}

export function getSavedManualAdsLogs() {
  try {
    const raw = localStorage.getItem(MANUAL_ADS_LOGS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveManualAdsLogs(logs = []) {
  try {
    localStorage.setItem(MANUAL_ADS_LOGS_STORAGE_KEY, JSON.stringify(logs))
  } catch {
    // ignore
  }
  return logs
}

// =====================================================================
// SỔ CHI PHÍ CỨNG / PHÍ CỐ ĐỊNH HÀNG THÁNG (FIXED OVERHEAD COSTS)
// =====================================================================

export function getSavedFixedCosts() {
  try {
    const raw = localStorage.getItem(FIXED_COSTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFixedCosts(list = []) {
  try {
    localStorage.setItem(FIXED_COSTS_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
  return list
}

export function getSavedFixedCostTemplate() {
  try {
    const raw = localStorage.getItem(FIXED_TEMPLATE_STORAGE_KEY)
    if (!raw) return DEFAULT_FIXED_COST_TEMPLATE
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_FIXED_COST_TEMPLATE
  } catch {
    return DEFAULT_FIXED_COST_TEMPLATE
  }
}

export function saveFixedCostTemplate(list = []) {
  try {
    localStorage.setItem(FIXED_TEMPLATE_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
  return list
}

// =====================================================================
// ĐỊNH DANH NGUỒN KHÁCH & ĐẦU KHO TRÊN DỰ ÁN ([DW_ATTR:{"source":...,"hub":...}])
// Lưu gọn trong projects.note giống cơ chế [FB_META:...] để không phá schema DB
// =====================================================================

const DW_ATTR_REGEX = /\n?\[DW_ATTR:(\{.*?\})\]/g

export function stripProjectAttributionFromNote(note = '') {
  if (!note) return ''
  return String(note).replace(DW_ATTR_REGEX, '').trim()
}

export function attachProjectAttributionToNote(note = '', { source = 'meta_ads', hub = 'xuan_loc' } = {}) {
  const clean = stripProjectAttributionFromNote(note)
  const payload = JSON.stringify({
    source: source || 'meta_ads',
    hub: hub || 'xuan_loc',
  })
  return clean ? `${clean}\n[DW_ATTR:${payload}]` : `[DW_ATTR:${payload}]`
}

export function inferHubFromLocation(locationStr = '') {
  const loc = String(locationStr || '').toLowerCase()
  if (
    loc.includes('vĩnh lộc') ||
    loc.includes('bình chánh') ||
    loc.includes('bình tân') ||
    loc.includes('tân phú') ||
    loc.includes('hóc môn') ||
    loc.includes('gò vấp') ||
    loc.includes('quận ') ||
    loc.includes('q.') ||
    loc.includes('hcm') ||
    loc.includes('hồ chí minh') ||
    loc.includes('long an') ||
    loc.includes('bình dương')
  ) {
    return 'vinh_loc'
  }
  return 'xuan_loc'
}

export function extractProjectAttribution(project) {
  const rawNote = String(project?.note || '')
  const match = /\[DW_ATTR:(\{.*?\})\]/.exec(rawNote)
  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1])
      const srcObj =
        PROJECT_LEAD_SOURCES.find((s) => s.id === parsed.source) || PROJECT_LEAD_SOURCES[0]
      const hubObj =
        WAREHOUSE_HUBS.find((h) => h.id === parsed.hub) || WAREHOUSE_HUBS[0]
      return {
        source: srcObj.id,
        sourceLabel: srcObj.label,
        isPaidAds: srcObj.isPaidAds,
        hub: hubObj.id,
        hubLabel: hubObj.label,
        hubShortLabel: hubObj.shortLabel,
        isExplicit: true,
      }
    } catch {
      // fallback below
    }
  }

  // Tự động suy luận thông minh cho các dự án cũ chưa gắn tag [DW_ATTR:...]
  const lowerNote = rawNote.toLowerCase()
  let source = 'referral'
  if (lowerNote.includes('tiktok')) {
    source = 'tiktok_ads'
  } else if (lowerNote.includes('fb_ads') || lowerNote.includes('nguồn ads') || lowerNote.includes('facebook')) {
    source = 'meta_ads'
  } else if (lowerNote.includes('dangwed.com') || lowerNote.includes('website')) {
    source = 'google_seo'
  }

  const hub = inferHubFromLocation(`${project?.location || ''} ${rawNote}`)
  const srcObj = PROJECT_LEAD_SOURCES.find((s) => s.id === source) || PROJECT_LEAD_SOURCES[3]
  const hubObj = WAREHOUSE_HUBS.find((h) => h.id === hub) || WAREHOUSE_HUBS[0]

  return {
    source: srcObj.id,
    sourceLabel: srcObj.label,
    isPaidAds: srcObj.isPaidAds,
    hub: hubObj.id,
    hubLabel: hubObj.label,
    hubShortLabel: hubObj.shortLabel,
    isExplicit: false,
  }
}

/**
 * Bóc tách số lượng Tin nhắn / Lead từ mảng actions của Meta Graph API Insights
 */
export function extractMessagesAndLeadsFromActions(actions = []) {
  if (!Array.isArray(actions)) return { messages: 0, leads: 0, totalResults: 0 }

  const findVal = (typeName) => {
    const found = actions.find((a) => a.action_type === typeName)
    return found ? Number(found.value || 0) : 0
  }

  const msgStarted7d = findVal('onsite_conversion.messaging_conversation_started_7d')
  const msgFirstReply = findVal('onsite_conversion.messaging_first_reply')
  const msgTotalConn = findVal('onsite_conversion.total_messaging_connection')
  const messages = msgStarted7d || msgFirstReply || msgTotalConn || 0

  const leadGrouped = findVal('onsite_conversion.lead_grouped')
  const pixelLead = findVal('lead')
  const offsiteLead = findVal('offsite_conversion.fb_pixel_lead')
  const leads = leadGrouped || pixelLead || offsiteLead || 0

  return {
    messages,
    leads,
    totalResults: messages + leads,
  }
}

/**
 * Đánh giá tự động theo Quy tắc 3 Mốc Vàng của Đặng Wedding
 */
export function evaluateAdPerformance({ spend = 0, totalResults = 0, config = DEFAULT_META_ADS_CONFIG }) {
  const numSpend = Number(spend || 0)
  const numResults = Number(totalResults || 0)
  const cpl = numResults > 0 ? Math.round(numSpend / numResults) : 0
  const scaleLimit = Number(config.targetCplMax || 55000)
  const killLimit = Number(config.killCplThreshold || 75000)

  if (numResults === 0) {
    if (numSpend >= 150000) {
      return {
        status: 'kill',
        cpl: 0,
        badgeCls: 'badge-danger',
        label: '🔴 Chưa ra khách (>150k) — Nên tắt / Đổi Hook',
      }
    }
    return {
      status: 'learning',
      cpl: 0,
      badgeCls: 'badge-gray',
      label: '⏳ Máy học đang phân phối (<72h)',
    }
  }

  if (cpl <= scaleLimit) {
    return {
      status: 'scale',
      cpl,
      badgeCls: 'badge-green',
      label: '🟢 Tốt (<55k) — Giữ & Tăng +20% ngân sách',
    }
  }

  if (cpl <= killLimit) {
    return {
      status: 'watch',
      cpl,
      badgeCls: 'badge-amber',
      label: '🟡 Theo dõi thêm (55k – 75k/mess)',
    }
  }

  return {
    status: 'kill',
    cpl,
    badgeCls: 'badge-danger',
    label: '🔴 CPL cao (>75k) — Cân nhắc tắt mẫu',
  }
}

/**
 * Gọi trực tiếp Meta Marketing API (Graph API v21.0) lấy chỉ số Insights
 */
export async function fetchMetaAdsInsights({
  adAccountId,
  accessToken,
  level = 'adset',
  datePreset = 'this_month',
  since = '',
  until = '',
  config = DEFAULT_META_ADS_CONFIG,
}) {
  const cleanAcc = String(adAccountId || '')
    .trim()
    .replace(/^act_/i, '')
  const cleanToken = String(accessToken || '').trim()

  if (!cleanAcc || !cleanToken) {
    throw new Error('Vui lòng nhập Ad Account ID (act_...) và Access Token (ads_read).')
  }

  const fields = [
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'cpc',
    'ctr',
    'actions',
    'date_start',
    'date_stop',
  ].join(',')

  const params = new URLSearchParams({
    level,
    fields,
    limit: '100',
    access_token: cleanToken,
  })

  if (datePreset === 'custom' && since && until) {
    params.set('time_range', JSON.stringify({ since, until }))
  } else {
    params.set('date_preset', datePreset || 'this_month')
  }

  const url = `https://graph.facebook.com/v21.0/act_${cleanAcc}/insights?${params.toString()}`
  const response = await fetch(url)
  const json = await response.json()

  if (!response.ok || json.error) {
    const errMsg =
      json?.error?.message ||
      'Không thể kết nối Meta Marketing API. Hãy kiểm tra lại Ad Account ID và quyền ads_read của Token.'
    throw new Error(errMsg)
  }

  const rows = Array.isArray(json.data) ? json.data : []
  return rows.map((row, idx) => {
    const spend = Math.round(Number(row.spend || 0))
    const impressions = Number(row.impressions || 0)
    const reach = Number(row.reach || 0)
    const clicks = Number(row.clicks || 0)
    const ctr = Number(Number(row.ctr || 0).toFixed(2))
    const cpc = Math.round(Number(row.cpc || 0))
    const { messages, leads, totalResults } = extractMessagesAndLeadsFromActions(row.actions)
    const evalMeta = evaluateAdPerformance({ spend, totalResults, config })

    const combinedName = `${row.campaign_name || ''} ${row.adset_name || ''} ${row.ad_name || ''}`.toLowerCase()
    let hubId = 'xuan_loc'
    let hubTag = 'Kho Xuân Lộc (Đồng Nai)'
    if (
      combinedName.includes('vinhloc') ||
      combinedName.includes('vĩnh lộc') ||
      combinedName.includes('hcm') ||
      combinedName.includes('tphcm')
    ) {
      hubId = 'vinh_loc'
      hubTag = 'Kho Vĩnh Lộc (TP.HCM)'
    }

    return {
      id: row.ad_id || row.adset_id || row.campaign_id || `meta_${idx}`,
      campaign_name: row.campaign_name || 'Chiến dịch Meta Ads',
      adset_name: row.adset_name || '—',
      ad_name: row.ad_name || '—',
      hubId,
      hubTag,
      spend,
      impressions,
      reach,
      clicks,
      ctr,
      cpc,
      messages,
      leads,
      totalResults,
      cpl: evalMeta.cpl,
      status: evalMeta.status,
      badgeCls: evalMeta.badgeCls,
      statusLabel: evalMeta.label,
      date_start: row.date_start || since || '',
      date_stop: row.date_stop || until || '',
      month: String(row.date_stop || row.date_start || new Date().toISOString()).slice(0, 7),
      source: 'Meta API',
    }
  })
}

/**
 * Dữ liệu mô phỏng chuẩn theo Kế hoạch Tháng 1 (2 Đầu kho Xuân Lộc & Vĩnh Lộc)
 */
export function getSampleTwoHubAdsInsights(config = DEFAULT_META_ADS_CONFIG, targetMonth = '') {
  const today = new Date().toISOString().slice(0, 10)
  const monthPrefix = targetMonth || today.slice(0, 7)
  const monthStart = `${monthPrefix}-01`
  const sampleRaw = [
    {
      id: 'sample_xl_combo',
      campaign_name: 'DW_MESS_THANG1_2KHO',
      adset_name: 'KHO_XUANLOC_DONGNAI_18KM',
      ad_name: 'AD_01B_Combo_GiaTien_MamQua_6tr5_12tr',
      hubId: 'xuan_loc',
      hubTag: 'Kho Xuân Lộc (Đồng Nai)',
      spend: 1250000,
      impressions: 24800,
      reach: 16400,
      clicks: 620,
      ctr: 2.5,
      cpc: 2016,
      messages: 29,
      leads: 3,
      totalResults: 32,
      date_start: monthStart,
      date_stop: `${monthPrefix}-15`,
      month: monthPrefix,
      source: 'Meta API (Mô phỏng)',
    },
    {
      id: 'sample_xl_moi',
      campaign_name: 'DW_MESS_THANG1_2KHO',
      adset_name: 'KHO_XUANLOC_DONGNAI_18KM',
      ad_name: 'AD_01A_GiaTien_TieuChuan_3tr5_5tr5',
      hubId: 'xuan_loc',
      hubTag: 'Kho Xuân Lộc (Đồng Nai)',
      spend: 650000,
      impressions: 14200,
      reach: 9800,
      clicks: 310,
      ctr: 2.18,
      cpc: 2096,
      messages: 13,
      leads: 1,
      totalResults: 14,
      date_start: monthStart,
      date_stop: `${monthPrefix}-15`,
      month: monthPrefix,
      source: 'Meta API (Mô phỏng)',
    },
    {
      id: 'sample_vl_moi',
      campaign_name: 'DW_MESS_THANG1_2KHO',
      adset_name: 'KHO_VINHLOC_TPHCM_12KM',
      ad_name: 'AD_02A_GiaTien_TieuChuan_3tr5_5tr5',
      hubId: 'vinh_loc',
      hubTag: 'Kho Vĩnh Lộc (TP.HCM)',
      spend: 1150000,
      impressions: 21500,
      reach: 15100,
      clicks: 495,
      ctr: 2.3,
      cpc: 2323,
      messages: 21,
      leads: 2,
      totalResults: 23,
      date_start: monthStart,
      date_stop: `${monthPrefix}-15`,
      month: monthPrefix,
      source: 'Meta API (Mô phỏng)',
    },
    {
      id: 'sample_vl_combo',
      campaign_name: 'DW_MESS_THANG1_2KHO',
      adset_name: 'KHO_VINHLOC_TPHCM_12KM',
      ad_name: 'AD_02B_Combo_GiaTien_MamQua_6tr5_12tr',
      hubId: 'vinh_loc',
      hubTag: 'Kho Vĩnh Lộc (TP.HCM)',
      spend: 480000,
      impressions: 8400,
      reach: 6200,
      clicks: 140,
      ctr: 1.66,
      cpc: 3428,
      messages: 5,
      leads: 0,
      totalResults: 5,
      date_start: monthStart,
      date_stop: `${monthPrefix}-15`,
      month: monthPrefix,
      source: 'Meta API (Mô phỏng)',
    },
  ]

  return sampleRaw.map((r) => {
    const evalMeta = evaluateAdPerformance({
      spend: r.spend,
      totalResults: r.totalResults,
      config,
    })
    return {
      ...r,
      cpl: evalMeta.cpl,
      status: evalMeta.status,
      badgeCls: evalMeta.badgeCls,
      statusLabel: evalMeta.label,
    }
  })
}

/**
 * Bóc tách nhãn Nguồn Ads / UTM từ ghi chú của Lead
 */
export function parseLeadAdsSource(note = '') {
  if (!note) return null
  const match = String(note).match(/\[Nguồn Ads:\s*([^\]]+)\]/i)
  if (!match) return null
  return match[1].trim()
}
