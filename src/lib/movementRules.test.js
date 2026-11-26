import { describe, it, expect } from 'vitest'
import {
  validateSingleMovement,
  validatePurchaseLines,
  canDeleteMovement,
  isBlankPurchaseLine,
  priceDeviation,
  checkIssueStock,
  validateReturnInputs,
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
    expect(r.errors[0].field).toBe('unit_cost')
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

describe('validatePurchaseLines field', () => {
  it('đánh dấu đúng ô lỗi theo dòng', () => {
    const r = validatePurchaseLines([
      { item_id: '1', qty: 1, unit_cost: 5 },
      { item_id: '', qty: 3, unit_cost: '' },
    ])
    expect(r.errors.map((e) => [e.row, e.field]).sort()).toEqual([[2, 'item_id'], [2, 'unit_cost']])
  })
  it('đơn giá để trống chuỗi rỗng báo lỗi unit_cost', () => {
    const r = validatePurchaseLines([{ item_id: '1', qty: 2, unit_cost: '' }])
    expect(r.errors[0].field).toBe('unit_cost')
  })
})

describe('priceDeviation', () => {
  it('lệch cao hơn 30% thì cảnh báo', () => {
    expect(priceDeviation(140, 100)).toEqual({ warn: true, pct: 40 })
  })
  it('lệch thấp hơn 30% thì cảnh báo', () => {
    expect(priceDeviation(60, 100)).toEqual({ warn: true, pct: -40 })
  })
  it('đúng 30% hoặc ít hơn thì không cảnh báo', () => {
    expect(priceDeviation(130, 100).warn).toBe(false)
    expect(priceDeviation(100, 100).warn).toBe(false)
  })
  it('thiếu giá lần trước hoặc giá trống thì không cảnh báo', () => {
    expect(priceDeviation(100, 0).warn).toBe(false)
    expect(priceDeviation('', 100).warn).toBe(false)
    expect(priceDeviation(100, null).warn).toBe(false)
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

describe('checkIssueStock', () => {
  const map = new Map([
    [1, { name: 'Ghế', in_stock: 5 }],
    [2, { name: 'Hoa', in_stock: 0 }],
  ])
  it('đủ tồn thì ok', () => {
    expect(checkIssueStock([{ item_id: 1, qty: 5 }], map).ok).toBe(true)
  })
  it('thiếu thì liệt kê tên, cần, còn', () => {
    const r = checkIssueStock([{ item_id: 1, qty: 6 }, { item_id: 2, qty: 1 }], map)
    expect(r.ok).toBe(false)
    expect(r.shortages).toEqual([
      { item_id: 1, name: 'Ghế', need: 6, have: 5 },
      { item_id: 2, name: 'Hoa', need: 1, have: 0 },
    ])
    expect(r.error).toContain('Ghế')
  })
  it('cộng dồn dòng trùng vật tư', () => {
    const r = checkIssueStock([{ item_id: '1', qty: 3 }, { item_id: 1, qty: 3 }], map)
    expect(r.ok).toBe(false)
    expect(r.shortages[0].need).toBe(6)
  })
  it('vật tư không có trong map coi như hết; dòng rỗng bị bỏ qua', () => {
    expect(checkIssueStock([{ item_id: 9, qty: 1 }], map).ok).toBe(false)
    expect(checkIssueStock([{ item_id: '', qty: 1 }, { item_id: 1, qty: 0 }], map).ok).toBe(true)
  })
})

describe('validateReturnInputs', () => {
  const ghe = { item_id: 1, item: { name: 'Ghế', kind: 'reusable' }, issued: 10, return_good: 2, return_damaged: 1, return_lost: 0 }
  const hoa = { item_id: 2, item: { name: 'Hoa', kind: 'consumable' }, issued: 5, return_good: 1, return_damaged: 0, return_lost: 0 }
  const stats = [ghe, hoa]

  it('tái sử dụng: tốt + hỏng + mất bằng đúng số còn ở dự án là hợp lệ', () => {
    const r = validateReturnInputs(stats, { 1: { good: '5', damaged: '1', lost: '1' } })
    expect(r.ok).toBe(true)
    expect(r.lines).toEqual([{ item_id: 1, good: 5, damaged: 1, lost: 1 }])
  })

  it('tái sử dụng: vượt số còn ở dự án thì báo đúng dòng', () => {
    const r = validateReturnInputs(stats, { 1: { good: 6, damaged: 1, lost: 1 } })
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].item_id).toBe(1)
    expect(r.error).toContain('Ghế')
    expect(r.error).toContain('7')
    expect(r.lines).toEqual([])
  })

  it('tiêu hao: SL dư không vượt đã xuất − đã thu', () => {
    expect(validateReturnInputs(stats, { 2: { good: 4 } }).ok).toBe(true)
    const r = validateReturnInputs(stats, { 2: { good: 4.5 } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Hoa')
  })

  it('tiêu hao: không nhận hỏng/mất', () => {
    expect(validateReturnInputs(stats, { 2: { good: 1, damaged: 1 } }).ok).toBe(false)
  })

  it('số âm hoặc không phải số thì lỗi', () => {
    expect(validateReturnInputs(stats, { 1: { good: -1 } }).ok).toBe(false)
    expect(validateReturnInputs(stats, { 1: { good: 'abc' } }).ok).toBe(false)
  })

  it('một dòng sai thì không trả dòng nào để ghi', () => {
    const r = validateReturnInputs(stats, { 1: { good: 1 }, 2: { good: 99 } })
    expect(r.ok).toBe(false)
    expect(r.lines).toEqual([])
  })

  it('bỏ qua dòng trống; không có gì để ghi thì báo', () => {
    const r = validateReturnInputs(stats, { 1: { good: '', damaged: '', lost: '' } })
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual([])
    expect(r.lines).toEqual([])
  })

  it('làm tròn 2 chữ số: 0.1 + 0.2 không báo vượt 0.3', () => {
    const s = [{ item_id: 3, item: { name: 'Vải', kind: 'reusable' }, issued: 0.3, return_good: 0, return_damaged: 0, return_lost: 0 }]
    expect(validateReturnInputs(s, { 3: { good: 0.1, damaged: 0.2 } }).ok).toBe(true)
  })
})
