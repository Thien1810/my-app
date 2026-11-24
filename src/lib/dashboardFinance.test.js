import { describe, it, expect } from 'vitest'
import { buildMonthlyFinanceSeries } from './dashboardFinance'

const P = (o) => ({ status: 'done', start_date: '2026-10-05', contractValue: 0, totalCost: 0, ...o })

describe('buildMonthlyFinanceSeries', () => {
  it('bỏ báo giá và dự án thiếu start_date (đếm skipped)', () => {
    const { rows, skippedCount } = buildMonthlyFinanceSeries([
      P({ contractValue: 1000, totalCost: 400 }),
      P({ status: 'quote', contractValue: 9999 }),
      P({ start_date: null, contractValue: 500 }),
    ])
    expect(rows).toEqual([{ month: '2026-10', doanhThu: 1000, chiPhi: 400, loiNhuan: 600 }])
    expect(skippedCount).toBe(1)
  })
  it('dự án hủy: doanh thu 0, chi phí theo tháng hủy', () => {
    const { rows } = buildMonthlyFinanceSeries([
      P({ status: 'cancelled', contractValue: 5000, totalCost: 300, cancelled_at: '2026-11-02T01:00:00Z' }),
    ])
    expect(rows).toEqual([{ month: '2026-11', doanhThu: 0, chiPhi: 300, loiNhuan: -300 }])
  })
  it('chỉ làm tròn ở cuối', () => {
    const { rows } = buildMonthlyFinanceSeries([
      P({ contractValue: 0.4, totalCost: 0 }),
      P({ contractValue: 0.4, totalCost: 0 }),
      P({ contractValue: 0.4, totalCost: 0 }),
    ])
    expect(rows[0].doanhThu).toBe(1)
  })
})
