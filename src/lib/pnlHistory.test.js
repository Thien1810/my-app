import { describe, it, expect } from 'vitest'
import { toPnlProjects, buildPnlHistory, calcBySource } from './pnlHistory'

const P = (o) => ({
  id: 'x',
  status: 'done',
  start_date: '2026-03-10',
  lead_source: 'meta_ads',
  warehouse_code: 'XL',
  contractValue: 10000000,
  totalCost: 4000000,
  ...o,
})

describe('toPnlProjects', () => {
  it('anh xa truong can thiet', () => {
    const out = toPnlProjects([
      {
        project: { id: 'a', status: 'done', start_date: '2026-03-01', lead_source: 'referral', warehouse_code: 'VL', name: 'x' },
        contractValue: '5000000',
        totalCost: 2000000,
      },
    ])
    expect(out).toEqual([
      { id: 'a', status: 'done', start_date: '2026-03-01', lead_source: 'referral', warehouse_code: 'VL', contractValue: 5000000, totalCost: 2000000 },
    ])
  })
  it('chiu duoc mang rong/null', () => {
    expect(toPnlProjects(null)).toEqual([])
    expect(toPnlProjects([null, {}])).toEqual([])
  })
})

describe('buildPnlHistory', () => {
  it('lay dung 3 thang truoc, gan nhat truoc', () => {
    const h = buildPnlHistory({ projects: [P({ start_date: '2026-02-05' })], month: '2026-03', scope: 'all' })
    expect(h.map((x) => x.month)).toEqual(['2026-02', '2026-01', '2025-12'])
    expect(h[0]).toEqual({ month: '2026-02', grossProfit: 6000000, weddingCount: 1 })
  })
  it('vat qua nam', () => {
    const h = buildPnlHistory({ projects: [], month: '2026-01', scope: 'all' })
    expect(h.map((x) => x.month)).toEqual(['2025-12', '2025-11', '2025-10'])
  })
  it('thang khong co du an van tra phan tu voi 0', () => {
    const h = buildPnlHistory({ projects: [], month: '2026-05' })
    expect(h).toHaveLength(3)
    h.forEach((x) => expect(x).toMatchObject({ grossProfit: 0, weddingCount: 0 }))
  })
  it('khong tinh thang hien tai va thang cu hon 3 thang', () => {
    const h = buildPnlHistory({
      projects: [P({ start_date: '2026-03-01' }), P({ start_date: '2025-10-01' })],
      month: '2026-03',
    })
    expect(h.reduce((s, x) => s + x.weddingCount, 0)).toBe(0)
  })
  it('loc theo scope kho', () => {
    const projects = [
      P({ start_date: '2026-02-01', warehouse_code: 'XL' }),
      P({ start_date: '2026-02-02', warehouse_code: 'VL', contractValue: 8000000, totalCost: 3000000 }),
      P({ start_date: '2026-02-03', warehouse_code: null }),
    ]
    expect(buildPnlHistory({ projects, month: '2026-03', scope: 'VL' })[0]).toMatchObject({ weddingCount: 1, grossProfit: 5000000 })
    expect(buildPnlHistory({ projects, month: '2026-03', scope: 'all' })[0].weddingCount).toBe(3)
  })
  it('loai quote va cancelled', () => {
    const projects = [
      P({ start_date: '2026-02-01', status: 'quote' }),
      P({ start_date: '2026-02-01', status: 'cancelled' }),
      P({ start_date: '2026-02-01', status: 'awaiting_return' }),
    ]
    expect(buildPnlHistory({ projects, month: '2026-03' })[0].weddingCount).toBe(1)
  })
})

describe('calcBySource', () => {
  it('gom theo nguon ke ca unknown, chi du an tinh doanh thu cua thang', () => {
    const projects = [
      P({ lead_source: 'meta_ads' }),
      P({ lead_source: 'meta_ads', contractValue: 6000000, totalCost: 1000000 }),
      P({ lead_source: null }),
      P({ lead_source: 'unknown' }),
      P({ lead_source: 'referral', status: 'quote' }),
      P({ lead_source: 'referral', start_date: '2026-04-01' }),
    ]
    const out = calcBySource({ projects, month: '2026-03', scope: 'all' })
    const meta = out.find((r) => r.source === 'meta_ads')
    expect(meta).toEqual({ source: 'meta_ads', count: 2, revenue: 16000000, grossProfit: 11000000 })
    expect(out.find((r) => r.source === 'unknown').count).toBe(2)
    expect(out.find((r) => r.source === 'referral')).toBeUndefined()
  })
  it('loc theo scope', () => {
    const projects = [P({ warehouse_code: 'XL' }), P({ warehouse_code: 'VL', lead_source: 'partner' })]
    const out = calcBySource({ projects, month: '2026-03', scope: 'VL' })
    expect(out.map((r) => r.source)).toEqual(['partner'])
  })
})
