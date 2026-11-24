import { describe, it, expect } from 'vitest'
import { calcPnl } from './pnl'

const M = '2026-12'
const A = {
  id: 'A', status: 'done', start_date: '2026-12-05', lead_source: 'meta_ads',
  warehouse_code: 'xuan_loc', contractValue: 10000000, totalCost: 4000000,
}
const B = {
  id: 'B', status: 'quote', start_date: '2026-12-20', lead_source: 'meta_ads',
  warehouse_code: 'xuan_loc', contractValue: 8000000, totalCost: 0,
}
const ads = [{ spend_date: '2026-12-10', month: '2026-12', channel: 'meta', warehouse_code: null, spend: 1000000, messages: 20, leads: 5 }]
const fixed = [{ month: '2026-12', warehouse_code: null, amount: 2000000 }]
const shares = [{ code: 'xuan_loc', share: 0.7 }, { code: 'vinh_loc', share: 0.3 }]

const base = (over = {}) => ({
  month: M, scope: 'all', projects: [A, B], adsRows: ads, fixedCosts: fixed, shares,
  advances: [], history: [], ...over,
})
const wh = (r, code) => r.byWarehouse.find((w) => w.code === code)

describe('calcPnl - ví dụ CODE_HANDOFF', () => {
  const r = calcPnl(base())
  it('doanh thu, dự kiến, lãi gộp, lãi ròng', () => {
    expect(r.revenue).toBe(10000000)
    expect(r.expectedRevenue).toBe(8000000)
    expect(r.grossProfit).toBe(6000000)
    expect(r.netProfit).toBe(3000000)
  })
  it('CAC, ROAS', () => {
    expect(r.cac).toBe(1000000)
    expect(r.roas).toBe(10)
  })
  it('chi phí chung chia theo share', () => {
    expect(wh(r, 'xuan_loc').fixedShared).toBeCloseTo(1400000)
    expect(wh(r, 'vinh_loc').fixedShared).toBeCloseTo(600000)
  })
})

describe('calcPnl - quy tắc', () => {
  it('ROAS không dùng tổng doanh thu mọi nguồn', () => {
    const ref = { ...A, id: 'R', lead_source: 'referral', contractValue: 5000000, totalCost: 0 }
    const r = calcPnl(base({ projects: [A, B, ref] }))
    expect(r.revenue).toBe(15000000)
    expect(r.roas).toBe(10)
  })
  it('cancelled: không có doanh thu nhưng chi phí vẫn tính (fallback start_date)', () => {
    const c = { ...A, id: 'C', status: 'cancelled' }
    const r = calcPnl(base({ projects: [A, c] }))
    expect(r.revenue).toBe(10000000)
    expect(r.expectedRevenue).toBe(0)
    expect(r.rotatingCost).toBe(4000000)
    expect(r.cancelledCost).toBe(4000000)
    expect(r.cancelledCount).toBe(1)
    expect(r.grossProfit).toBe(2000000)
    expect(r.netProfit).toBe(-1000000)
    expect(r.paidAdsProjectCount).toBe(1)
    expect(r.unknownSourceCount).toBe(0)
    expect(r.cac).toBe(1000000)
    expect(r.roas).toBe(10)
  })
  it('đám hủy tính vào tháng hủy, không vào tháng thi công', () => {
    const c = { ...A, id: 'C', status: 'cancelled', start_date: '2026-10-10', cancelled_at: '2026-12-02' }
    expect(calcPnl(base({ projects: [c] })).cancelledCost).toBe(4000000)
    expect(calcPnl(base({ projects: [c], month: '2026-10' })).cancelledCost).toBe(0)
    const d = { ...A, id: 'D', status: 'cancelled', start_date: '2026-10-10', cancelled_at: '2026-11-05' }
    expect(calcPnl(base({ projects: [d], month: '2026-11' })).cancelledCost).toBe(4000000)
    expect(calcPnl(base({ projects: [d], month: '2026-10' })).cancelledCost).toBe(0)
    expect(calcPnl(base({ projects: [d], month: '2026-10' })).cancelledCount).toBe(0)
  })
  it('đám hủy không cộng contractValue; chi phí giảm lãi gộp và lãi ròng', () => {
    const c = { ...A, id: 'C', status: 'cancelled', contractValue: 99000000, totalCost: 1500000 }
    const r = calcPnl(base({ projects: [A, B, c] }))
    expect(r.revenue).toBe(10000000)
    expect(r.grossProfit).toBe(6000000 - 1500000)
    expect(r.netProfit).toBe(3000000 - 1500000)
  })
  it('scope kho: đám hủy có kho chỉ vào kho đó; tổng kho + chưa gán khớp toàn công ty', () => {
    const c1 = { ...A, id: 'C1', status: 'cancelled', warehouse_code: 'vinh_loc', totalCost: 700000 }
    const c2 = { ...A, id: 'C2', status: 'cancelled', warehouse_code: null, totalCost: 300000 }
    const projects = [A, c1, c2]
    const r = calcPnl(base({ projects }))
    expect(r.cancelledCost).toBe(1000000)
    expect(r.cancelledCount).toBe(2)
    expect(wh(r, 'vinh_loc').cancelledCost).toBe(700000)
    expect(wh(r, 'vinh_loc').grossProfit).toBe(-700000)
    expect(wh(r, 'xuan_loc').cancelledCost).toBe(0)
    expect(r.unassigned.cancelledCost).toBe(300000)
    expect(r.unassigned.cancelledCount).toBe(1)
    const sum = r.byWarehouse.reduce((s, w) => s + w.cancelledCost, 0) + r.unassigned.cancelledCost
    expect(sum).toBe(r.cancelledCost)
    const grossSum =
      r.byWarehouse.reduce((s, w) => s + w.grossProfit, 0) +
      (r.unassigned.revenue - r.unassigned.rotatingCost - r.unassigned.cancelledCost)
    expect(grossSum).toBe(r.grossProfit)
    expect(calcPnl(base({ projects, scope: 'vinh_loc' })).cancelledCost).toBe(700000)
    expect(calcPnl(base({ projects, scope: 'xuan_loc' })).cancelledCost).toBe(0)
  })
  it('dự án tháng khác không vào', () => {
    const o = { ...A, id: 'O', start_date: '2026-11-30' }
    expect(calcPnl(base({ projects: [A, o] })).revenue).toBe(10000000)
  })
  it('lead_source unknown không vào CAC, tăng unknownSourceCount', () => {
    const u = { ...A, id: 'U', lead_source: 'unknown' }
    const r = calcPnl(base({ projects: [A, u] }))
    expect(r.unknownSourceCount).toBe(1)
    expect(r.paidAdsProjectCount).toBe(1)
    expect(r.cac).toBe(1000000)
    expect(r.roas).toBe(10)
  })
  it('chi phí cứng có kho tính thẳng kho đó', () => {
    const fc = [...fixed, { month: '2026-12', warehouse_code: 'vinh_loc', amount: 500000 }]
    const r = calcPnl(base({ fixedCosts: fc }))
    expect(wh(r, 'vinh_loc').fixedDirect).toBe(500000)
    expect(wh(r, 'vinh_loc').fixedCostTotal).toBeCloseTo(1100000)
    expect(wh(r, 'xuan_loc').fixedCostTotal).toBeCloseTo(1400000)
    expect(r.fixedCostTotal).toBe(2500000)
  })
  it('forfeit cộng vào thu nhập khác và lãi ròng', () => {
    const adv = [
      { received_date: '2026-12-15', kind: 'forfeit', amount: 1500000 },
      { received_date: '2026-12-15', kind: 'advance', amount: 3000000 },
      { received_date: '2026-11-15', kind: 'forfeit', amount: 999 },
    ]
    const r = calcPnl(base({ advances: adv }))
    expect(r.otherIncome).toBe(1500000)
    expect(r.netProfit).toBe(4500000)
  })
  it('forfeit có kho -> chỉ vào kho đó, scope all có đủ', () => {
    const adv = [{ received_date: '2026-12-15', kind: 'forfeit', amount: 1000000, warehouse_code: 'vinh_loc' }]
    const r = calcPnl(base({ advances: adv }))
    expect(r.otherIncome).toBe(1000000)
    expect(wh(r, 'vinh_loc').otherIncome).toBe(1000000)
    expect(wh(r, 'xuan_loc').otherIncome).toBe(0)
    expect(calcPnl(base({ advances: adv, scope: 'vinh_loc' })).otherIncome).toBe(1000000)
    expect(calcPnl(base({ advances: adv, scope: 'xuan_loc' })).otherIncome).toBe(0)
  })
  it('forfeit không kho -> chia theo share; tổng các kho khớp toàn công ty', () => {
    const adv = [
      { received_date: '2026-12-15', kind: 'forfeit', amount: 1000000 },
      { received_date: '2026-12-16', kind: 'forfeit', amount: 500000, warehouse_code: 'vinh_loc' },
    ]
    const r = calcPnl(base({ advances: adv }))
    expect(wh(r, 'xuan_loc').otherIncome).toBeCloseTo(700000)
    expect(wh(r, 'vinh_loc').otherIncome).toBeCloseTo(300000 + 500000)
    const sum = r.byWarehouse.reduce((s, w) => s + w.otherIncome, 0)
    expect(sum).toBeCloseTo(r.otherIncome)
    expect(r.otherIncome).toBe(1500000)
    expect(calcPnl(base({ advances: adv, scope: 'xuan_loc' })).otherIncome).toBeCloseTo(700000)
  })
  it('forfeit amount âm vẫn tính dương', () => {
    const adv = [{ received_date: '2026-12-15', kind: 'forfeit', amount: -250000, warehouse_code: 'xuan_loc' }]
    const r = calcPnl(base({ advances: adv }))
    expect(r.otherIncome).toBe(250000)
    expect(wh(r, 'xuan_loc').otherIncome).toBe(250000)
  })
  it('history rỗng => hòa vốn null', () => {
    const r = calcPnl(base())
    expect(r.breakEven).toBeNull()
    expect(r.breakEvenNote).toBe('chưa đủ dữ liệu')
  })
  it('history có dữ liệu => ceil((cứng + Ads) / lãi gộp TB)', () => {
    // TB = 13tr/3 = 4.333.333 ; (2tr+1tr)/4.333.333 = 0.69 => 1
    const history = [
      { month: '2026-11', grossProfit: 5000000, weddingCount: 1 },
      { month: '2026-10', grossProfit: 8000000, weddingCount: 2 },
    ]
    expect(calcPnl(base({ history })).breakEven).toBe(1)
    const big = calcPnl(base({
      history: [{ month: '2026-11', grossProfit: 1000000, weddingCount: 1 }],
    }))
    expect(big.breakEven).toBe(3)
  })
  it('history lãi gộp TB <= 0 hoặc 0 đám => null', () => {
    expect(calcPnl(base({ history: [{ grossProfit: -1, weddingCount: 2 }] })).breakEven).toBeNull()
    expect(calcPnl(base({ history: [{ grossProfit: 5, weddingCount: 0 }] })).breakEven).toBeNull()
  })
  it('scope xuan_loc chỉ tính của kho đó', () => {
    const v = { ...A, id: 'V', warehouse_code: 'vinh_loc', contractValue: 6000000, totalCost: 1000000 }
    const adsKho = [...ads, { spend_date: '2026-12-11', warehouse_code: 'xuan_loc', spend: 500000 }]
    const r = calcPnl(base({ scope: 'xuan_loc', projects: [A, v], adsRows: adsKho }))
    expect(r.revenue).toBe(10000000)
    expect(r.rotatingCost).toBe(4000000)
    expect(r.adsSpend).toBeCloseTo(500000 + 700000)
    expect(r.fixedCostTotal).toBeCloseTo(1400000)
    expect(r.byWarehouse).toBeUndefined()
  })
  it('dữ liệu rỗng không chia 0', () => {
    const r = calcPnl({ month: M, scope: 'all' })
    expect(r.revenue).toBe(0)
    expect(r.netProfit).toBe(0)
    expect(r.grossMarginPct).toBe(0)
    expect(r.netMarginPct).toBe(0)
    expect(r.cac).toBeNull()
    expect(r.roas).toBeNull()
    expect(r.cir).toBeNull()
    expect(r.cpl).toBeNull()
    expect(r.breakEven).toBeNull()
  })
  it('ép số an toàn với null/chuỗi', () => {
    const p = { ...A, contractValue: '10000000', totalCost: null }
    expect(calcPnl(base({ projects: [p] })).grossProfit).toBe(10000000)
  })
})
