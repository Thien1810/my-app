// Test mô tả HÀNH VI HIỆN TẠI của src/lib/calc.js (chưa sửa logic).
// Các test có nhãn "hành vi hiện tại, đang sai" ghi nhận lỗi đã biết để sửa sau:
// khi sửa calc.js thì cập nhật lại kỳ vọng của đúng các test đó.
import { describe, it, expect } from 'vitest'
import {
  datesOverlap,
  calcScheduleConflicts,
  calcProjectItemStats,
  calcProjectFinancialSummary,
} from './calc'

const makeStockMap = (items) => new Map(items.map((i) => [i.id, i]))

const HOA = { id: 1, name: 'Hoa tươi', code: 'TH-HOA-001', kind: 'consumable', cost: 10000 }
const KHUNG = {
  id: 2,
  name: 'Khung backdrop',
  code: 'TSD-KHUNG-001',
  kind: 'reusable',
  cost: 1000000,
  expected_uses: 20,
  in_stock: 3,
  at_project: 1,
}
const DEN_KHONG_SO_LAN = {
  id: 3,
  name: 'Đèn chưa có số lần dùng',
  code: 'TSD-DEN-001',
  kind: 'reusable',
  cost: 500000,
  expected_uses: null,
}

describe('datesOverlap', () => {
  it('hai khoảng ngày giao nhau thì trả về true', () => {
    expect(datesOverlap('2026-11-01', '2026-11-03', '2026-11-03', '2026-11-05')).toBe(true)
  })

  it('hai khoảng ngày tách rời thì trả về false', () => {
    expect(datesOverlap('2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05')).toBe(false)
  })

  it('thiếu ngày kết thúc thì dùng ngày bắt đầu làm ngày kết thúc', () => {
    expect(datesOverlap('2026-11-03', null, '2026-11-01', '2026-11-05')).toBe(true)
  })

  it('một bên không có ngày nào thì trả về false', () => {
    expect(datesOverlap(null, null, '2026-11-01', '2026-11-05')).toBe(false)
  })
})

describe('calcScheduleConflicts', () => {
  const current = { id: 10, name: 'Đám A', status: 'confirmed', start_date: '2026-12-01', end_date: '2026-12-02' }
  const overlap = { id: 11, name: 'Đám B', status: 'confirmed', start_date: '2026-12-02', end_date: '2026-12-03' }
  const done = { id: 12, name: 'Đám C', status: 'done', start_date: '2026-12-01', end_date: '2026-12-02' }
  const stockMap = makeStockMap([HOA, KHUNG])

  it('không có dự án hiện tại thì trả về object rỗng', () => {
    expect(calcScheduleConflicts(null, [], [], stockMap)).toEqual({})
  })

  it('cộng SL kế hoạch đồ tái sử dụng của các dự án trùng lịch và báo thiếu so với tổng sở hữu (in_stock + at_project)', () => {
    const plans = [
      { project_id: 10, item_id: 2, qty: 3 },
      { project_id: 11, item_id: 2, qty: 2 },
    ]
    const result = calcScheduleConflicts(current, [current, overlap], plans, stockMap)
    expect(result[2]).toEqual({
      itemId: 2,
      totalPlanned: 5,
      totalOwned: 4,
      shortage: 1,
      hasShortage: true,
      otherProjects: [{ id: 11, name: 'Đám B', qty: 2 }],
    })
  })

  it('bỏ qua vật tư tiêu hao và dự án đã xong/đã hủy', () => {
    const plans = [
      { project_id: 10, item_id: 1, qty: 100 },
      { project_id: 10, item_id: 2, qty: 1 },
      { project_id: 12, item_id: 2, qty: 10 },
    ]
    const result = calcScheduleConflicts(current, [current, done], plans, stockMap)
    expect(result[1]).toBeUndefined()
    expect(result[2].totalPlanned).toBe(1)
    expect(result[2].hasShortage).toBe(false)
  })
})

describe('calcProjectItemStats', () => {
  it('tiêu hao: netConsumed = xuất - dư, không có outstanding', () => {
    const movements = [
      { item_id: 1, type: 'issue', qty: 10 },
      { item_id: 1, type: 'return_good', qty: 3 },
    ]
    const [row] = calcProjectItemStats(movements, makeStockMap([HOA]))
    expect(row.issued).toBe(10)
    expect(row.return_good).toBe(3)
    expect(row.netConsumed).toBe(7)
    expect(row.outstanding).toBe(0)
  })

  it('tái sử dụng: outstanding = xuất - tốt - hỏng - mất, không có netConsumed', () => {
    const movements = [
      { item_id: 2, type: 'issue', qty: 5 },
      { item_id: 2, type: 'return_good', qty: 2 },
      { item_id: 2, type: 'return_damaged', qty: 1 },
      { item_id: 2, type: 'return_lost', qty: 1 },
    ]
    const [row] = calcProjectItemStats(movements, makeStockMap([KHUNG]))
    expect(row.outstanding).toBe(1)
    expect(row.netConsumed).toBe(0)
  })

  it('vật tư không có trong kho thì tạo bản ghi tạm, coi như tiêu hao giá 0', () => {
    const [row] = calcProjectItemStats([{ item_id: 99, type: 'issue', qty: 2 }], new Map())
    expect(row.item.name).toBe('Vật tư #99')
    expect(row.item.kind).toBe('consumable')
    expect(row.netConsumed).toBe(2)
  })
})

describe('calcProjectFinancialSummary — chi phí vật tư', () => {
  it('tiêu hao: chi phí = (xuất - dư) * giá', () => {
    const r = calcProjectFinancialSummary({
      movements: [
        { item_id: 1, type: 'issue', qty: 10 },
        { item_id: 1, type: 'return_good', qty: 4 },
      ],
      itemStockMap: makeStockMap([HOA]),
    })
    expect(r.consumableCost).toBe(60000)
  })

  it('tái sử dụng: khấu hao = SL xuất * giá / expected_uses, cộng (hỏng + mất) * giá', () => {
    const r = calcProjectFinancialSummary({
      movements: [
        { item_id: 2, type: 'issue', qty: 2 },
        { item_id: 2, type: 'return_good', qty: 1 },
        { item_id: 2, type: 'return_lost', qty: 1 },
      ],
      itemStockMap: makeStockMap([KHUNG]),
    })
    expect(r.depreciationCost).toBe(100000)
    expect(r.damagedLostCost).toBe(1000000)
  })

  it('tái sử dụng thiếu expected_uses thì không tính khấu hao và liệt kê tên vật tư', () => {
    const r = calcProjectFinancialSummary({
      movements: [{ item_id: 3, type: 'issue', qty: 1 }],
      itemStockMap: makeStockMap([DEN_KHONG_SO_LAN]),
    })
    expect(r.depreciationCost).toBe(0)
    expect(r.missingExpectedUsesItems).toEqual(['Đèn chưa có số lần dùng'])
  })

  it('lợi nhuận = giá trị hợp đồng - tổng chi phí', () => {
    const r = calcProjectFinancialSummary({
      movements: [{ item_id: 1, type: 'issue', qty: 10 }],
      itemStockMap: makeStockMap([HOA]),
      otherCosts: [{ kind: 'Nhân công', amount: 500000 }],
      contractValue: 5000000,
    })
    expect(r.totalCost).toBe(600000)
    expect(r.profit).toBe(4400000)
  })
})

describe('calcProjectFinancialSummary — chi phí khác và Ads', () => {
  const base = { movements: [], itemStockMap: new Map() }

  it('nhận biết khoản Ads theo kind "quảng cáo", "marketing" hoặc ghi chú [ADS-SYNC:', () => {
    const r = calcProjectFinancialSummary({
      ...base,
      otherCosts: [
        { kind: 'Quảng cáo Facebook', amount: 100000 },
        { kind: 'Marketing', amount: 200000 },
        { kind: 'Khác', note: '[ADS-SYNC:123]', amount: 300000 },
        { kind: 'Nhân công', amount: 400000 },
      ],
    })
    expect(r.adsCostTotal).toBe(600000)
    expect(r.otherCostTotal).toBe(1000000)
  })

  it('hành vi hiện tại, đang sai: adsCostTotal vẫn nằm trong otherCostTotal và totalCost, nên lợi nhuận dự án đã trừ Ads; tab P&L (MetaAdsManagerTab) lại trừ chi phí Ads từ sổ Ads thêm lần nữa', () => {
    const r = calcProjectFinancialSummary({
      ...base,
      otherCosts: [
        { kind: 'Ads Facebook', amount: 1000000 },
        { kind: 'Nhân công', amount: 500000 },
      ],
      contractValue: 5000000,
    })
    expect(r.adsCostTotal).toBe(1000000)
    expect(r.otherCostTotal).toBe(1500000)
    expect(r.totalCost).toBe(1500000)
    expect(r.profit).toBe(3500000)
  })

  it('hành vi hiện tại, đang sai: nhận biết Ads bằng kind.includes("ads") nên khớp nhầm cả khoản không phải quảng cáo (ví dụ "Thuê pads/loa")', () => {
    const r = calcProjectFinancialSummary({
      ...base,
      otherCosts: [{ kind: 'Thuê pads/loa', amount: 250000 }],
    })
    expect(r.adsCostTotal).toBe(250000)
  })

  it('hành vi hiện tại, đang sai: kind viết không dấu "quang cao" thì không được nhận là Ads', () => {
    const r = calcProjectFinancialSummary({
      ...base,
      otherCosts: [{ kind: 'Chi quang cao', amount: 300000 }],
    })
    expect(r.adsCostTotal).toBe(0)
  })

  it('amount dạng chuỗi hoặc thiếu thì được ép kiểu số / coi là 0', () => {
    const r = calcProjectFinancialSummary({
      ...base,
      otherCosts: [{ kind: 'Vận chuyển', amount: '150000' }, { kind: 'Khác' }],
    })
    expect(r.otherCostTotal).toBe(150000)
  })
})

// ROAS không nằm trong calc.js mà nằm trong useMemo của
// src/components/MetaAdsManagerTab.jsx (roas = totalRevenue / totalAdsSpend).
// Chưa test được nếu không tách logic ra khỏi component (ngoài phạm vi bước này).
describe('P&L trong MetaAdsManagerTab (chưa test được từ calc.js)', () => {
  it.todo(
    'hành vi hiện tại, đang sai: ROAS chia trên toàn bộ doanh thu thay vì doanh thu từ dự án có nguồn Ads trả phí (paidAdsRevenue)'
  )
  it.todo(
    'hành vi hiện tại, đang sai: lợi nhuận ròng P&L = lãi gộp (đã trừ Ads trong chi phí khác) - tổng chi phí Ads từ sổ Ads, nên Ads bị trừ 2 lần'
  )
})
