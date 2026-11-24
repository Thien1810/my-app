import { describe, it, expect } from 'vitest'
import { calcProjectClosure, deleteBlockMessage } from './projectArchive'

const kinds = new Map([
  [1, 'reusable'],
  [2, 'consumable'],
])
const cancelled = { status: 'cancelled', cancelled_at: '2026-01-01' }
const base = { project: cancelled, movements: [], costs: [], advances: [], itemKindMap: kinds, today: '2026-03-01' }
const mv = (type, qty, item_id = 1, moved_at = '2026-01-05') => ({ type, qty, item_id, moved_at })
const adv = (kind, amount, received_date = '2026-01-02') => ({ kind, amount, received_date })

describe('calcProjectClosure', () => {
  it('dự án trống', () => {
    const r = calcProjectClosure({ ...base, project: { status: 'quote' } })
    expect(r.isEmpty).toBe(true)
    expect(r.counts).toEqual({ movements: 0, costs: 0, advances: 0 })
    expect(r.lastActivityDate).toBeNull()
    expect(r.daysSinceLastActivity).toBeNull()
    expect(r.canArchive).toBe(false)
    expect(r.reasons).toContain('Dự án chưa ở trạng thái Đã hủy')
  })

  it('có phiếu kho thì không trống', () => {
    const r = calcProjectClosure({ ...base, movements: [mv('issue', 3, 2)] })
    expect(r.isEmpty).toBe(false)
    expect(r.counts.movements).toBe(1)
    expect(r.outstandingItems).toEqual([]) // tiêu hao không tính
  })

  it('đồ tái sử dụng còn ở dự án', () => {
    const r = calcProjectClosure({
      ...base,
      movements: [mv('issue', 5), mv('return_good', 2), mv('return_damaged', 1)],
    })
    expect(r.outstandingItems).toEqual([{ itemId: 1, qty: 2 }])
    expect(r.settled).toBe(false)
    expect(r.canArchive).toBe(false)
    expect(r.reasons[0]).toMatch(/Còn 1 món đồ tái sử dụng/)
  })

  it('đã thu hồi hết (gồm hỏng/mất)', () => {
    const r = calcProjectClosure({
      ...base,
      movements: [mv('issue', 5), mv('return_good', 3), mv('return_lost', 2)],
    })
    expect(r.outstandingItems).toEqual([])
    expect(r.settled).toBe(true)
    expect(r.canArchive).toBe(true)
  })

  it('còn giữ cọc', () => {
    const r = calcProjectClosure({ ...base, advances: [adv('advance', 1000000)] })
    expect(r.heldAmount).toBe(1000000)
    expect(r.settled).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/Còn giữ tiền cọc/)
  })

  it('đã hoàn hết cọc', () => {
    const r = calcProjectClosure({
      ...base,
      advances: [adv('advance', 1000000), adv('refund', -1000000)],
    })
    expect(r.heldAmount).toBe(0)
    expect(r.canArchive).toBe(true)
  })

  it('mất cọc hết', () => {
    const r = calcProjectClosure({
      ...base,
      advances: [adv('advance', 1000000), adv('forfeit', 1000000)],
    })
    expect(r.heldAmount).toBe(0)
    expect(r.settled).toBe(true)
  })

  it('ngày cuối cùng lấy đúng max', () => {
    const r = calcProjectClosure({
      ...base,
      movements: [mv('issue', 1, 2, '2026-01-10T08:00:00Z')],
      costs: [{ cost_date: '2026-02-01' }, { cost_date: '2026-01-20' }],
      advances: [adv('advance', 5, '2026-01-15'), adv('refund', 5, '2026-01-16')],
    })
    expect(r.lastActivityDate).toBe('2026-02-01')
    expect(r.daysSinceLastActivity).toBe(28)
  })

  it('ngày hủy cũng được tính', () => {
    const r = calcProjectClosure({ ...base, project: { ...cancelled, cancelled_at: '2026-02-10' } })
    expect(r.lastActivityDate).toBe('2026-02-10')
  })

  it('ngày thứ 29 chưa gợi ý, ngày thứ 30 gợi ý', () => {
    const p = { ...cancelled, cancelled_at: '2026-01-01' }
    const d29 = calcProjectClosure({ ...base, project: p, today: '2026-01-30' })
    expect(d29.daysSinceLastActivity).toBe(29)
    expect(d29.canArchive).toBe(true)
    expect(d29.suggestArchive).toBe(false)
    const d30 = calcProjectClosure({ ...base, project: p, today: '2026-01-31' })
    expect(d30.daysSinceLastActivity).toBe(30)
    expect(d30.suggestArchive).toBe(true)
  })

  it('chưa hủy thì không lưu trữ được', () => {
    const r = calcProjectClosure({ ...base, project: { status: 'completed' } })
    expect(r.canArchive).toBe(false)
    expect(r.suggestArchive).toBe(false)
  })

  it('đã lưu trữ rồi', () => {
    const r = calcProjectClosure({ ...base, project: { ...cancelled, archived_at: '2026-02-01T00:00:00Z' } })
    expect(r.canArchive).toBe(false)
    expect(r.reasons).toContain('Dự án đã được lưu trữ')
  })

  it('itemKindMap dạng object', () => {
    const r = calcProjectClosure({ ...base, itemKindMap: { 1: 'reusable' }, movements: [mv('issue', 2)] })
    expect(r.outstandingItems).toEqual([{ itemId: 1, qty: 2 }])
  })
})

describe('deleteBlockMessage', () => {
  it('trống thì không chặn', () => {
    expect(deleteBlockMessage({ movements: 0, costs: 0, advances: 0 })).toBe('')
  })
  it('liệt kê đủ ba mục', () => {
    expect(deleteBlockMessage({ movements: 2, costs: 3, advances: 1 })).toBe(
      'Dự án đã có 2 phiếu kho, 3 khoản chi phí, 1 khoản tạm ứng nên không xóa được. Hãy chuyển sang trạng thái Đã hủy rồi Lưu trữ.'
    )
  })
  it('chỉ liệt kê mục > 0', () => {
    expect(deleteBlockMessage({ movements: 0, costs: 4, advances: 0 })).toBe(
      'Dự án đã có 4 khoản chi phí nên không xóa được. Hãy chuyển sang trạng thái Đã hủy rồi Lưu trữ.'
    )
  })
})
