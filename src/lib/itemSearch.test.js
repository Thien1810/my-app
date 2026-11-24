import { describe, it, expect } from 'vitest'
import { stripAccents, filterItems } from './itemSearch'

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
