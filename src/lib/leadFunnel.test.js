import { describe, it, expect } from 'vitest'
import {
  STAGES,
  stageIndexOfLead,
  buildFunnel,
  groupLeads,
  funnelByChannel,
  funnelByCampaign,
  funnelByLanding,
  unknownSourceStats,
  filterByRange,
  presetRange,
  vnDateOf,
  NO_CAMPAIGN_LABEL,
  NO_LANDING_LABEL,
} from './leadFunnel'

const L = (status, extra = {}) => ({ status, ...extra })

describe('stageIndexOfLead', () => {
  it('ánh xạ trạng thái', () => {
    expect(STAGES.map((s) => stageIndexOfLead(L(s.key)))).toEqual([0, 1, 2, 3, 4])
  })
  it('lead mất chỉ đạt bước đầu', () => {
    expect(stageIndexOfLead(L('lost'))).toBe(0)
  })
  it('trạng thái cũ và lạ', () => {
    expect(stageIndexOfLead(L('contacted'))).toBe(1)
    expect(stageIndexOfLead(L('converted'))).toBe(2)
    expect(stageIndexOfLead(L('closed'))).toBe(0)
    expect(stageIndexOfLead(L('xyz'))).toBe(0)
    expect(stageIndexOfLead(null)).toBe(0)
  })
})

describe('buildFunnel', () => {
  it('rỗng không chia 0', () => {
    const f = buildFunnel([])
    expect(f.total).toBe(0)
    expect(f.winRate).toBe(0)
    expect(f.stages.every((s) => s.count === 0 && s.pctOfTotal === 0 && s.pctOfPrev === 0)).toBe(true)
    expect(buildFunnel(undefined).total).toBe(0)
  })
  it('đếm lũy tiến và tỷ lệ', () => {
    const leads = [
      L('new'), L('new'), L('consulting'), L('quoted'), L('deposited'), L('completed'),
      L('lost', { lost_reason: 'gia_cao' }), L('lost', { lost_reason: 'gia_cao' }), L('lost'), L('lost', { lost_reason: 'khac' }),
    ]
    const f = buildFunnel(leads)
    expect(f.total).toBe(10)
    expect(f.stages.map((s) => s.count)).toEqual([10, 4, 3, 2, 1])
    expect(f.stages[1].pctOfTotal).toBe(40)
    expect(f.stages[1].pctOfPrev).toBe(40)
    expect(f.stages[2].pctOfPrev).toBe(75)
    expect(f.stages[3].pctOfPrev).toBeCloseTo(66.7, 1)
    expect(f.lost).toBe(4)
    expect(f.lostByReason).toEqual({ gia_cao: 2, unspecified: 1, khac: 1 })
    expect(f.winRate).toBe(20)
  })
  it('winRate làm tròn 1 chữ số', () => {
    const f = buildFunnel([L('deposited'), L('new'), L('new')])
    expect(f.winRate).toBe(33.3)
  })
  it('pctOfPrev khi bước trước = 0', () => {
    const f = buildFunnel([L('new')])
    expect(f.stages[2].pctOfPrev).toBe(0)
  })
})

describe('groupLeads / funnelBy*', () => {
  const leads = [
    L('completed', { utm_source: 'facebook', utm_campaign: 'a', landing_path: '/khu-vuc/x' }),
    L('new', { utm_source: 'facebook', utm_campaign: 'a', landing_path: '/khu-vuc/x' }),
    L('lost', { utm_source: 'facebook', utm_campaign: 'b' }),
    L('deposited', { utm_source: 'tiktok' }),
    L('new', {}),
    L('new', {}),
    L('new', {}),
  ]
  it('theo kênh, giảm dần', () => {
    const rows = funnelByChannel(leads)
    expect(rows[0].total).toBeGreaterThanOrEqual(rows[1].total)
    const unk = rows.find((r) => r.label === 'Trực tiếp / không rõ nguồn')
    expect(unk.total).toBe(3)
    const meta = rows.find((r) => r.label === 'Facebook / Instagram Ads')
    expect(meta).toMatchObject({ total: 3, consulting: 1, completed: 1, deposited: 1, lost: 1 })
    expect(meta.winRate).toBeCloseTo(33.3, 1)
    const tk = rows.find((r) => r.label === 'TikTok Ads')
    expect(tk.winRate).toBe(100)
  })
  it('theo chiến dịch, trống gom chung', () => {
    const rows = funnelByCampaign(leads)
    expect(rows.find((r) => r.label === NO_CAMPAIGN_LABEL).total).toBe(4)
    expect(rows.find((r) => r.label === 'a').total).toBe(2)
    expect(rows.find((r) => r.label === 'b').lost).toBe(1)
  })
  it('theo trang vào', () => {
    const rows = funnelByLanding(leads)
    expect(rows.find((r) => r.label === NO_LANDING_LABEL).total).toBe(5)
    expect(rows.find((r) => r.label === '/khu-vuc/x').total).toBe(2)
  })
  it('đọc chiến dịch từ thẻ note', () => {
    const rows = funnelByCampaign([L('new', { note: '[Nguồn Ads: fb / tet / v1]' })])
    expect(rows[0].label).toBe('tet')
  })
  it('groupLeads tùy ý', () => {
    const rows = groupLeads([L('new'), L('quoted')], () => ({ key: 'k', label: 'K' }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ total: 2, quoted: 1 })
    expect(groupLeads([], () => ({ key: 'k', label: 'K' }))).toEqual([])
  })
})

describe('unknownSourceStats', () => {
  it('đếm lead và dự án không rõ nguồn', () => {
    const leads = [L('new', { utm_source: 'facebook' }), L('new'), L('new'), L('new')]
    const projects = [
      { lead_source: 'unknown', status: 'active' },
      { lead_source: '', status: 'active' },
      { lead_source: null, status: 'completed' },
      { lead_source: 'unknown', status: 'cancelled' },
      { lead_source: 'meta_ads', status: 'active' },
    ]
    const s = unknownSourceStats(leads, projects)
    expect(s).toEqual({ leadsUnknown: 3, leadsTotal: 4, pct: 75, projectsUnknown: 3, projectsTotal: 4 })
  })
  it('rỗng', () => {
    expect(unknownSourceStats([], null)).toEqual({ leadsUnknown: 0, leadsTotal: 0, pct: 0, projectsUnknown: 0, projectsTotal: 0 })
  })
})

describe('khoảng thời gian (giờ VN)', () => {
  it('vnDateOf cộng 7 giờ', () => {
    expect(vnDateOf('2026-03-10T17:30:00Z')).toBe('2026-03-11')
    expect(vnDateOf('2026-03-10T16:59:00Z')).toBe('2026-03-10')
    expect(vnDateOf('bad')).toBe('')
    expect(vnDateOf(null)).toBe('')
  })
  it('presetRange', () => {
    const now = Date.parse('2026-03-15T20:00:00Z') // 16/03 giờ VN
    expect(presetRange('month', now)).toEqual({ from: '2026-03-01', to: '2026-03-16' })
    expect(presetRange('30d', now)).toEqual({ from: '2026-02-15', to: '2026-03-16' })
    expect(presetRange('90d', now)).toEqual({ from: '2025-12-17', to: '2026-03-16' })
    expect(presetRange('all', now)).toEqual({ from: null, to: null })
  })
  it('filterByRange', () => {
    const leads = [
      { id: 1, created_at: '2026-02-28T17:00:00Z' }, // 01/03 VN
      { id: 2, created_at: '2026-03-10T05:00:00Z' },
      { id: 3, created_at: '2026-03-31T17:00:00Z' }, // 01/04 VN
      { id: 4 },
    ]
    expect(filterByRange(leads, { from: '2026-03-01', to: '2026-03-31' }).map((l) => l.id)).toEqual([1, 2])
    expect(filterByRange(leads, { from: '2026-03-02' }).map((l) => l.id)).toEqual([2, 3])
    expect(filterByRange(leads, { to: '2026-03-10' }).map((l) => l.id)).toEqual([1, 2])
    expect(filterByRange(leads, {})).toHaveLength(4)
    expect(filterByRange(null, { from: '2026-01-01' })).toEqual([])
  })
})
