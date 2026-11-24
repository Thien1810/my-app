import { getLeadAttribution, getLeadChannel } from './leadSource'
import { normalizeLeadStatus } from './leadStatus'

// Phễu lead & báo cáo nguồn khách. Hàm thuần, không gọi Supabase.
// GIỚI HẠN: DB chỉ lưu trạng thái HIỆN TẠI của lead (không có lịch sử). Lead 'lost' không biết đã
// đi tới bước nào nên CHỈ được tính là đã đạt bước đầu (new).

export const STAGES = [
  { key: 'new', label: 'Lead' },
  { key: 'consulting', label: 'Tư vấn' },
  { key: 'quoted', label: 'Báo giá' },
  { key: 'deposited', label: 'Cọc' },
  { key: 'completed', label: 'Hoàn thành' },
]

export const NO_CAMPAIGN_LABEL = 'Không có chiến dịch'
export const NO_LANDING_LABEL = 'Không rõ trang vào'

// Chỉ số bước cao nhất lead đã đạt (0..4). Lead mất -> 0 (xem giới hạn ở đầu file).
export function stageIndexOfLead(lead) {
  const s = normalizeLeadStatus(lead && lead.status)
  if (s === 'lost') return 0
  const i = STAGES.findIndex((st) => st.key === s)
  return i < 0 ? 0 : i
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function pct(a, b) {
  return b > 0 ? round1((a / b) * 100) : 0
}

export function buildFunnel(leads) {
  const list = leads || []
  const total = list.length
  const reached = STAGES.map(() => 0)
  let lost = 0
  const lostByReason = {}
  for (const l of list) {
    const idx = stageIndexOfLead(l)
    for (let i = 0; i <= idx; i++) reached[i] += 1
    if (normalizeLeadStatus(l.status) === 'lost') {
      lost += 1
      const r = (l.lost_reason && String(l.lost_reason).trim()) || 'unspecified'
      lostByReason[r] = (lostByReason[r] || 0) + 1
    }
  }
  const stages = STAGES.map((st, i) => ({
    key: st.key,
    label: st.label,
    count: reached[i],
    pctOfTotal: pct(reached[i], total),
    pctOfPrev: i === 0 ? (total > 0 ? 100 : 0) : pct(reached[i], reached[i - 1]),
  }))
  const winRate = pct(reached[3], total)
  return { total, stages, lost, lostByReason, winRate }
}

// Gom lead theo keyFn(lead) -> { key, label }. Trả mảng dòng, sắp theo số lead giảm dần.
export function groupLeads(leads, keyFn) {
  const map = new Map()
  for (const l of leads || []) {
    const { key, label } = keyFn(l)
    if (!map.has(key)) map.set(key, { key, label, leads: [] })
    map.get(key).leads.push(l)
  }
  const rows = []
  for (const g of map.values()) {
    const f = buildFunnel(g.leads)
    rows.push({
      key: g.key,
      label: g.label,
      total: f.total,
      consulting: f.stages[1].count,
      quoted: f.stages[2].count,
      deposited: f.stages[3].count,
      completed: f.stages[4].count,
      lost: f.lost,
      winRate: f.winRate,
    })
  }
  rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'vi'))
  return rows
}

export function funnelByChannel(leads) {
  return groupLeads(leads, (l) => {
    const c = getLeadChannel(l)
    return { key: c.key + ':' + c.label, label: c.label }
  })
}

export function funnelByCampaign(leads) {
  return groupLeads(leads, (l) => {
    const c = getLeadAttribution(l).utm_campaign
    return c ? { key: c, label: c } : { key: '', label: NO_CAMPAIGN_LABEL }
  })
}

export function funnelByLanding(leads) {
  return groupLeads(leads, (l) => {
    const p = getLeadAttribution(l).landing_path
    return p ? { key: p, label: p } : { key: '', label: NO_LANDING_LABEL }
  })
}

// Lead có kênh 'unknown'; dự án có lead_source 'unknown' hoặc rỗng (bỏ qua dự án đã hủy).
export function unknownSourceStats(leads, projects) {
  const ls = leads || []
  const leadsUnknown = ls.filter((l) => getLeadChannel(l).key === 'unknown').length
  const ps = (projects || []).filter((p) => p.status !== 'cancelled')
  const projectsUnknown = ps.filter((p) => {
    const s = p.lead_source === null || p.lead_source === undefined ? '' : String(p.lead_source).trim().toLowerCase()
    return s === '' || s === 'unknown'
  }).length
  return {
    leadsUnknown,
    leadsTotal: ls.length,
    pct: pct(leadsUnknown, ls.length),
    projectsUnknown,
    projectsTotal: ps.length,
  }
}

// ----- Khoảng thời gian (giờ Việt Nam, UTC+7 cố định) -----
const VN_OFFSET_MS = 7 * 3600 * 1000

// 'YYYY-MM-DD' theo giờ Việt Nam của một mốc thời gian; '' nếu không hợp lệ.
export function vnDateOf(ts) {
  if (!ts) return ''
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return ''
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const RANGE_PRESETS = [
  { key: 'month', label: 'Tháng này' },
  { key: '30d', label: '30 ngày' },
  { key: '90d', label: '90 ngày' },
  { key: 'all', label: 'Tất cả' },
]

// Preset -> { from, to } (ngày VN, gồm cả hai đầu; null = không giới hạn).
export function presetRange(preset, now = Date.now()) {
  const today = vnDateOf(now)
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today }
  if (preset === '30d') return { from: addDays(today, -29), to: today }
  if (preset === '90d') return { from: addDays(today, -89), to: today }
  return { from: null, to: null }
}

// Lọc theo created_at (ngày VN). from/to dạng 'YYYY-MM-DD', gồm cả hai đầu, null/rỗng = bỏ qua.
// Lead không có created_at hợp lệ bị loại khi có giới hạn.
export function filterByRange(leads, { from = null, to = null } = {}) {
  if (!from && !to) return leads || []
  return (leads || []).filter((l) => {
    const d = vnDateOf(l && l.created_at)
    if (!d) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}
