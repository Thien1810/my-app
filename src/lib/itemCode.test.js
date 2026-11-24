import { describe, expect, it } from 'vitest'
import { generateItemCodeFromCategory } from './itemCode'
import { generateItemCode } from './formatters'

describe('generateItemCodeFromCategory', () => {
  it('bắt đầu từ 001 khi chưa có vật tư nào', () => {
    expect(generateItemCodeFromCategory('consumable', 'HOA', [])).toBe('TH-HOA-001')
    expect(generateItemCodeFromCategory('reusable', 'KHUNG', [])).toBe('TSD-KHUNG-001')
  })

  it('lấy số lớn nhất cùng tiền tố rồi cộng 1, bỏ qua loại và nhóm khác', () => {
    const items = [
      { id: 1, code: 'TH-HOA-001' },
      { id: 2, code: 'th-hoa-007' },
      { id: 3, code: 'TSD-HOA-050' },
      { id: 4, code: 'TH-HOA2-099' },
      { id: 5, code: null },
    ]
    expect(generateItemCodeFromCategory('consumable', 'HOA', items)).toBe('TH-HOA-008')
  })

  it('chuẩn hóa mã nhóm (in hoa, bỏ khoảng trắng) và dùng VT khi rỗng', () => {
    expect(generateItemCodeFromCategory('consumable', ' hoa ', [])).toBe('TH-HOA-001')
    expect(generateItemCodeFromCategory('consumable', '', [])).toBe('TH-VT-001')
    expect(generateItemCodeFromCategory('reusable', null, [])).toBe('TSD-VT-001')
  })

  it('loại trừ chính vật tư đang sửa khi tính số kế tiếp', () => {
    const items = [{ id: 9, code: 'TH-HOA-003' }]
    expect(generateItemCodeFromCategory('consumable', 'HOA', items, 9)).toBe('TH-HOA-001')
    expect(generateItemCodeFromCategory('consumable', 'HOA', items)).toBe('TH-HOA-004')
  })

  it('cho kết quả giống generateItemCode khi mã nhóm trùng mã suy ra từ tên', () => {
    const items = [{ id: 1, code: 'TSD-DEN-002' }]
    expect(generateItemCodeFromCategory('reusable', 'DEN', items))
      .toBe(generateItemCode('reusable', 'Đèn & Ánh sáng', items))
  })
})
