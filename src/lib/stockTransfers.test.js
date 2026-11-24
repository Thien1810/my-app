import { describe, it, expect } from 'vitest'
import { validateTransferInput, calcWarehouseHoldings, canDeleteTransfer, todayVN } from './stockTransfers'

const base = { item_id: 1, from_wh: 'a', to_wh: 'b', qty: 2, available: 5 }

describe('validateTransferInput', () => {
  it('hợp lệ', () => expect(validateTransferInput(base)).toEqual({ ok: true, error: '' }))
  it('cho phép chuyển đúng bằng tồn', () => expect(validateTransferInput({ ...base, qty: 5 }).ok).toBe(true))
  it.each([0, -1, NaN, '', 'abc', null, undefined])('qty %s bị từ chối', (qty) => {
    const r = validateTransferInput({ ...base, qty })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/lớn hơn 0/)
  })
  it('thiếu vật tư/kho', () => {
    expect(validateTransferInput({ ...base, item_id: '' }).error).toMatch(/vật tư/)
    expect(validateTransferInput({ ...base, from_wh: '' }).error).toMatch(/kho đi/)
    expect(validateTransferInput({ ...base, to_wh: '' }).error).toMatch(/kho đến/)
  })
  it('cùng kho', () => expect(validateTransferInput({ ...base, to_wh: 'a' }).error).toMatch(/khác nhau/))
  it('vượt tồn', () => {
    const r = validateTransferInput({ ...base, qty: 6 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/vượt quá/)
  })
  it('available không hợp lệ coi như 0', () => expect(validateTransferInput({ ...base, available: undefined }).ok).toBe(false))
})

describe('calcWarehouseHoldings', () => {
  const items = [
    { id: 1, name: 'Đèn', code: 'D1', kind: 'reusable', cost: 100, in_stock: 6, at_project: 3, in_repair: 1, active: true },
    { id: 2, name: 'Keo', code: 'K1', kind: 'consumable', cost: 10, in_stock: 50, at_project: 0, in_repair: 0, active: true },
    { id: 3, name: 'Cũ', code: 'C1', kind: 'reusable', cost: 10, in_stock: 5, at_project: 0, in_repair: 0, active: false },
    { id: 4, name: 'Âm', code: 'A1', kind: 'reusable', cost: 10, in_stock: -3, at_project: 2, in_repair: 0, active: true },
  ]
  it('ban đầu toàn bộ ở kho chính, loại tiêu hao và không hoạt động, max(0)', () => {
    const r = calcWarehouseHoldings({ items, transfers: [], mainWarehouseCode: 'main' })
    expect(r.map((x) => x.item_id)).toEqual([1, 4])
    expect(r[0].total).toBe(10)
    expect(r[0].byWarehouse).toEqual({ main: 10 })
    expect(r[1].total).toBe(2)
  })
  it('phiếu qua lại', () => {
    const transfers = [
      { item_id: 1, from_wh: 'main', to_wh: 'x', qty: 4 },
      { item_id: 1, from_wh: 'x', to_wh: 'main', qty: 1 },
      { item_id: 1, from_wh: 'x', to_wh: 'y', qty: 2 },
      { item_id: 2, from_wh: 'main', to_wh: 'x', qty: 9 },
    ]
    const r = calcWarehouseHoldings({ items, transfers, mainWarehouseCode: 'main' })
    expect(r.find((x) => x.item_id === 1).byWarehouse).toEqual({ main: 7, x: 1, y: 2 })
    expect(r.find((x) => x.item_id === 2)).toBeUndefined()
  })
  it('đầu vào rỗng', () => expect(calcWarehouseHoldings()).toEqual([]))
})

describe('canDeleteTransfer', () => {
  it('không phải admin', () => {
    expect(canDeleteTransfer({ role: 'manager', transferDate: '2026-11-05', lockedMonths: [] }).ok).toBe(false)
    expect(canDeleteTransfer({ role: 'storekeeper', transferDate: '2026-11-05', lockedMonths: [] }).ok).toBe(false)
    expect(canDeleteTransfer({}).ok).toBe(false)
  })
  it('tháng khóa', () => {
    const r = canDeleteTransfer({ role: 'admin', transferDate: '2026-10-31', lockedMonths: ['2026-10'] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/2026-10/)
  })
  it('admin tháng chưa khóa', () => {
    expect(canDeleteTransfer({ role: 'admin', transferDate: '2026-11-05', lockedMonths: ['2026-10'] }).ok).toBe(true)
  })
})

describe('todayVN', () => {
  it('lấy ngày theo giờ Việt Nam', () => {
    expect(todayVN(new Date('2026-11-24T18:00:00Z'))).toBe('2026-11-25')
    expect(todayVN(new Date('2026-11-24T16:00:00Z'))).toBe('2026-11-24')
  })
})
