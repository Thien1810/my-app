import { describe, it, expect } from 'vitest'
import { stripAccents, filterItems, getItemGroup, getItemGroups, buildPickerList } from './itemSearch'

const items = [
  { id: 1, code: 'VT001', name: 'Đèn LED Điện Quang', in_stock: 5, in_repair: 0, active: true },
  { id: 2, code: 'MK02', name: 'Máy khoan', in_stock: 0, in_repair: 2, active: true },
  { id: 3, code: 'XX', name: 'Đã ngưng', in_stock: 9, in_repair: 0, active: false },
]

describe('itemSearch', () => {
  it('stripAccents xử lý dấu và đ', () => {
    expect(stripAccents('Đèn Điện')).toBe('den dien')
  })
  it('không dấu / hoa thường', () => {
    expect(filterItems(items, 'DEN led').map((i) => i.id)).toEqual([1])
    expect(filterItems(items, 'may khoan').map((i) => i.id)).toEqual([2])
  })
  it('khớp mã', () => {
    expect(filterItems(items, 'mk0').map((i) => i.id)).toEqual([2])
  })
  it('onlyWithStock theo stockField', () => {
    expect(filterItems(items, '', { onlyWithStock: true }).map((i) => i.id)).toEqual([1])
    expect(
      filterItems(items, '', { onlyWithStock: true, stockField: 'in_repair' }).map((i) => i.id),
    ).toEqual([2])
  })
  it('limit, query rỗng, bỏ inactive', () => {
    expect(filterItems(items, '').map((i) => i.id)).toEqual([1, 2])
    expect(filterItems(items, '', { limit: 1 })).toHaveLength(1)
  })
})

describe('nhóm và gợi ý', () => {
  const list = [
    { id: 1, code: 'TSD-KHUNG-001', name: 'Khung A', active: true },
    { id: 2, code: 'TH-HOA-012', name: 'Hoa hồng', active: true },
    { id: 3, code: 'TH-KEO-003', name: 'Keo', active: true },
    { id: 4, code: 'TH-HOA-013', name: 'Hoa cúc', active: true },
    { id: 5, code: 'TH-OLD-001', name: 'Cũ', active: false },
    { id: 6, code: 'VT001', name: 'Không mã nhóm', active: true },
  ]
  it('getItemGroup', () => {
    expect(getItemGroup('TSD-KHUNG-001')).toBe('KHUNG')
    expect(getItemGroup('th-hoa-012')).toBe('HOA')
    expect(getItemGroup('VT001')).toBe('')
    expect(getItemGroup('TH--001')).toBe('')
    expect(getItemGroup(null)).toBe('')
  })
  it('getItemGroups unique, A-Z, bỏ inactive/rỗng', () => {
    expect(getItemGroups(list)).toEqual(['HOA', 'KEO', 'KHUNG'])
  })
  it('buildPickerList: gợi ý đứng trước khi ô trống', () => {
    const r = buildPickerList(list, '', { suggestedIds: [3, '4', 5, 99, 3] })
    expect(r.list.map((i) => i.id)).toEqual([3, 4, 1, 2, 6])
    expect(r.suggestedCount).toBe(2)
  })
  it('buildPickerList: gõ thì lọc như cũ, lọc theo nhóm', () => {
    expect(buildPickerList(list, 'hoa', { suggestedIds: [3] }).suggestedCount).toBe(0)
    expect(buildPickerList(list, '', { group: 'HOA' }).list.map((i) => i.id)).toEqual([2, 4])
    expect(buildPickerList(list, 'cuc', { group: 'HOA' }).list.map((i) => i.id)).toEqual([4])
  })
  it('buildPickerList: giới hạn gợi ý 10 và tổng limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, code: `TH-A-${i}`, name: `n${i}`, active: true }))
    const r = buildPickerList(many, '', { suggestedIds: many.map((i) => i.id).reverse(), limit: 12 })
    expect(r.suggestedCount).toBe(10)
    expect(r.list).toHaveLength(12)
    expect(r.list[0].id).toBe(30)
  })
})
