import { describe, it, expect } from 'vitest'
import {
  validateSingleMovement,
  validatePurchaseLines,
  canDeleteMovement,
  isBlankPurchaseLine,
} from './movementRules'

const stock = { name: 'Ghế', in_stock: 5, in_repair: 2, at_project: 3, kind: 'reusable' }

describe('validateSingleMovement', () => {
  it('adjust cộng ok khi có lý do', () => {
    expect(validateSingleMovement({ type: 'adjust', qty: 10, stock, note: 'kiểm kê' }).ok).toBe(true)
  })
  it('adjust bắt buộc lý do', () => {
    expect(validateSingleMovement({ type: 'adjust', qty: 1, stock, note: '   ' }).ok).toBe(false)
    expect(validateSingleMovement({ type: 'adjust', qty: -1, stock }).ok).toBe(false)
  })
  it('adjust âm không vượt tồn', () => {
    expect(validateSingleMovement({ type: 'adjust', qty: -5, stock, note: 'x' }).ok).toBe(true)
    const r = validateSingleMovement({ type: 'adjust', qty: -6, stock, note: 'x' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5')
  })
  it('qty 0 hoặc trống bị chặn', () => {
    expect(validateSingleMovement({ type: 'adjust', qty: 0, stock, note: 'x' }).ok).toBe(false)
    expect(validateSingleMovement({ type: 'dispose', qty: '', stock }).ok).toBe(false)
  })
  it('repair_done và dispose không vượt in_repair', () => {
    expect(validateSingleMovement({ type: 'repair_done', qty: 2, stock }).ok).toBe(true)
    expect(validateSingleMovement({ type: 'repair_done', qty: 3, stock }).ok).toBe(false)
    expect(validateSingleMovement({ type: 'dispose', qty: 3, stock }).ok).toBe(false)
  })
  it('repair_done âm bị chặn', () => {
    expect(validateSingleMovement({ type: 'repair_done', qty: -1, stock }).ok).toBe(false)
  })
})

describe('validatePurchaseLines', () => {
  it('hợp lệ', () => {
    const r = validatePurchaseLines([{ item_id: '1', qty: 2, unit_cost: 1000 }])
    expect(r.ok).toBe(true)
    expect(r.validLines).toHaveLength(1)
  })
  it('đơn giá 0 báo lỗi theo dòng', () => {
    const r = validatePurchaseLines([{ item_id: '1', qty: 2, unit_cost: 0 }])
    expect(r.ok).toBe(false)
    expect(r.errors[0].row).toBe(1)
  })
  it('dòng trống bỏ qua, dòng thiếu vật tư báo số thứ tự', () => {
    const lines = [
      { item_id: '', qty: 1, unit_cost: 0 },
      { item_id: '', qty: 3, unit_cost: 500 },
      { item_id: '2', qty: 1, unit_cost: 500 },
    ]
    const r = validatePurchaseLines(lines)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Dòng 2')
    expect(r.error).not.toContain('Dòng 1:')
  })
  it('qty 0 có vật tư báo lỗi', () => {
    expect(validatePurchaseLines([{ item_id: '1', qty: 0, unit_cost: 5 }]).ok).toBe(false)
  })
  it('trùng vật tư bị chặn', () => {
    const r = validatePurchaseLines([
      { item_id: '1', qty: 1, unit_cost: 5 },
      { item_id: 1, qty: 2, unit_cost: 5 },
    ])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Dòng 2')
  })
  it('toàn dòng trống thì báo chọn ít nhất 1', () => {
    expect(validatePurchaseLines([{ item_id: '', qty: 1, unit_cost: 0 }]).ok).toBe(false)
    expect(isBlankPurchaseLine({ item_id: '', qty: 1, unit_cost: 0 })).toBe(true)
  })
})

describe('canDeleteMovement', () => {
  it('xóa nhập mua khi tồn đủ', () => {
    expect(canDeleteMovement({ movement: { type: 'purchase', qty: 5 }, stock }).ok).toBe(true)
  })
  it('xóa nhập mua khi tồn không đủ', () => {
    const r = canDeleteMovement({ movement: { type: 'purchase', qty: 6 }, stock })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('âm')
  })
  it('xóa thu hồi tốt / sửa xong chặn khi thiếu tồn', () => {
    expect(canDeleteMovement({ movement: { type: 'return_good', qty: 9 }, stock }).ok).toBe(false)
    expect(canDeleteMovement({ movement: { type: 'repair_done', qty: 9 }, stock }).ok).toBe(false)
  })
  it('xóa điều chỉnh âm luôn được, điều chỉnh dương cần tồn đủ', () => {
    expect(canDeleteMovement({ movement: { type: 'adjust', qty: -4 }, stock }).ok).toBe(true)
    expect(canDeleteMovement({ movement: { type: 'adjust', qty: 9 }, stock }).ok).toBe(false)
  })
  it('xóa thu hồi hỏng cần in_repair đủ', () => {
    expect(canDeleteMovement({ movement: { type: 'return_damaged', qty: 3 }, stock }).ok).toBe(false)
    expect(canDeleteMovement({ movement: { type: 'return_damaged', qty: 2 }, stock }).ok).toBe(true)
  })
  it('xóa phiếu xuất vật tư tái sử dụng cần at_project đủ', () => {
    expect(canDeleteMovement({ movement: { type: 'issue', qty: 4 }, stock }).ok).toBe(false)
    expect(canDeleteMovement({ movement: { type: 'issue', qty: 3 }, stock }).ok).toBe(true)
  })
  it('không có số liệu tồn thì cho qua', () => {
    expect(canDeleteMovement({ movement: { type: 'purchase', qty: 1 }, stock: null }).ok).toBe(true)
  })
})
