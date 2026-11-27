import { describe, it, expect } from 'vitest'
import {
  isMissingSchemaError,
  issueBlockReason,
  outstandingReusable,
  cancelMonthOf,
  statusChangeBlockReason,
  calcIssueByPlanLines,
  buildTemplateAddMap,
  planDuplicates,
  mergePlanRows,
} from './projectRules'

const itemMap = new Map([
  [1, { id: 1, name: 'Ghế', unit: 'cái', kind: 'reusable' }],
  [2, { id: 2, name: 'Hoa giấy', unit: 'bó', kind: 'consumable' }],
  [3, { id: 3, name: 'Khung', unit: 'cái', kind: 'reusable' }],
])
const mv = (type, item_id, qty) => ({ type, item_id, qty })

describe('isMissingSchemaError', () => {
  it('nhận đủ 4 mã thiếu bảng/hàm', () => {
    for (const code of ['42P01', 'PGRST205', 'PGRST202', '42883']) {
      expect(isMissingSchemaError({ code })).toBe(true)
    }
    expect(isMissingSchemaError({ code: '23505' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })
})

describe('issueBlockReason', () => {
  it('cho xuất khi Đang chuẩn bị / Đang thi công', () => {
    expect(issueBlockReason({ status: 'preparing' })).toBe('')
    expect(issueBlockReason({ status: 'in_progress' })).toBe('')
  })
  it('chặn các trạng thái khác, kèm hướng dẫn', () => {
    for (const status of ['quote', 'awaiting_return', 'done', 'cancelled']) {
      expect(issueBlockReason({ status })).toMatch(/Chỉ xuất kho/)
    }
    expect(issueBlockReason({ status: 'quote' }, { canChangeStatus: true })).toMatch(/ô "Trạng thái"/)
    expect(issueBlockReason({ status: 'quote' })).toMatch(/Quản lý\/Quản trị/)
  })
  it('chặn dự án đã lưu trữ', () => {
    expect(issueBlockReason({ status: 'in_progress', archived_at: '2026-11-01T00:00:00Z' })).toMatch(/lưu trữ/)
  })
})

describe('outstandingReusable', () => {
  it('chỉ lấy đồ tái sử dụng còn ở dự án', () => {
    const r = outstandingReusable(
      [mv('issue', 1, 5), mv('return_good', 1, 2), mv('return_lost', 1, 1), mv('issue', 2, 10), mv('issue', 3, 2), mv('return_damaged', 3, 2)],
      itemMap
    )
    expect(r).toEqual([{ item_id: 1, name: 'Ghế', unit: 'cái', qty: 2 }])
  })
})

describe('cancelMonthOf', () => {
  it('ưu tiên cancelled_at, rơi về start_date', () => {
    expect(cancelMonthOf({ cancelled_at: '2026-10-05', start_date: '2026-12-01' })).toBe('2026-10')
    expect(cancelMonthOf({ start_date: '2026-12-01' })).toBe('2026-12')
    expect(cancelMonthOf({})).toBeNull()
  })
})

describe('statusChangeBlockReason', () => {
  const out = [{ item_id: 1, name: 'Ghế', unit: 'cái', qty: 2 }]
  it('không đổi trạng thái thì không chặn', () => {
    expect(statusChangeBlockReason({ prevStatus: 'done', nextStatus: 'done' })).toBe('')
  })
  it('chặn sang Hoàn thành / Đã hủy khi còn đồ, nêu tên đồ', () => {
    const msg = statusChangeBlockReason({ prevStatus: 'in_progress', nextStatus: 'done', projectName: 'A', outstanding: out })
    expect(msg).toMatch(/Hoàn thành/)
    expect(msg).toMatch(/Ghế: 2 cái/)
    expect(statusChangeBlockReason({ prevStatus: 'quote', nextStatus: 'cancelled', outstanding: out })).toMatch(/Đã hủy/)
  })
  it('không tải được phiếu kho thì chặn', () => {
    expect(statusChangeBlockReason({ prevStatus: 'quote', nextStatus: 'done', outstanding: null })).toMatch(/Không tải được/)
  })
  it('hết đồ thì cho đóng', () => {
    expect(statusChangeBlockReason({ prevStatus: 'awaiting_return', nextStatus: 'done', outstanding: [] })).toBe('')
  })
  it('rời Đã hủy: chặn khi có Mất cọc hoặc tháng hủy đã khóa', () => {
    const base = { prevStatus: 'cancelled', nextStatus: 'preparing', cancelMonth: '2026-10' }
    expect(statusChangeBlockReason({ ...base, hasForfeit: true, cancelMonthLocked: false })).toMatch(/Mất cọc/)
    expect(statusChangeBlockReason({ ...base, hasForfeit: false, cancelMonthLocked: true })).toMatch(/2026-10 đã khóa sổ/)
    expect(statusChangeBlockReason({ ...base, hasForfeit: false, cancelMonthLocked: false })).toBe('')
    expect(statusChangeBlockReason({ ...base, hasForfeit: null, cancelMonthLocked: false })).toMatch(/Không tải được/)
  })
  it('Đã hủy -> Hoàn thành vẫn kiểm đồ', () => {
    expect(statusChangeBlockReason({ prevStatus: 'cancelled', nextStatus: 'done', outstanding: out, hasForfeit: false, cancelMonthLocked: false })).toMatch(/Ghế/)
  })
})

describe('calcIssueByPlanLines', () => {
  it('tái sử dụng: kế hoạch − (đã xuất − đã thu hồi); tiêu hao: kế hoạch − đã xuất', () => {
    const plan = [{ item_id: 1, qty: 10 }, { item_id: 2, qty: 10 }, { item_id: 3, qty: 4 }]
    const moves = [mv('issue', 1, 10), mv('return_good', 1, 3), mv('return_damaged', 1, 1), mv('issue', 2, 6), mv('return_good', 2, 2)]
    expect(calcIssueByPlanLines(plan, moves, itemMap)).toEqual([
      { item_id: 1, qty: 4 },
      { item_id: 2, qty: 4 },
      { item_id: 3, qty: 4 },
    ])
  })
  it('đã xuất đủ thì không còn dòng nào', () => {
    expect(calcIssueByPlanLines([{ item_id: 1, qty: 2 }], [mv('issue', 1, 2)], itemMap)).toEqual([])
  })
  it('thu hồi vượt (dữ liệu cũ) không làm xuất quá kế hoạch', () => {
    expect(calcIssueByPlanLines([{ item_id: 1, qty: 2 }], [mv('issue', 1, 1), mv('return_good', 1, 3)], itemMap)).toEqual([{ item_id: 1, qty: 2 }])
  })
})

describe('nạp mẫu set vào kế hoạch', () => {
  const templates = [
    { id: 7, items: [{ item_id: 1, qty: 4 }, { item_id: 2, qty: 1 }] },
    { id: 8, items: [{ item_id: 1, qty: 2 }] },
  ]
  it('gộp nhiều mẫu, nhân số bộ', () => {
    const m = buildTemplateAddMap(templates, [{ template_id: 7, mult: 2 }, { template_id: 8 }])
    expect([...m.entries()]).toEqual([[1, 10], [2, 2]])
  })
  it('tìm vật tư trùng', () => {
    const add = new Map([[1, 10], [2, 2]])
    expect(planDuplicates(add, new Map([[1, 3], [5, 1]]))).toEqual([{ item_id: 1, current: 3, add: 10 }])
  })
  it('Cộng thêm và Thay thế chỉ đụng vật tư trong mẫu', () => {
    const add = new Map([[2, 2], [1, 10]])
    const existing = new Map([[1, 3], [5, 1]])
    expect(mergePlanRows({ projectId: 9, addMap: add, existingMap: existing, mode: 'add' })).toEqual([
      { project_id: 9, item_id: 1, qty: 13 },
      { project_id: 9, item_id: 2, qty: 2 },
    ])
    const rep = mergePlanRows({ projectId: 9, addMap: add, existingMap: existing, mode: 'replace' })
    expect(rep).toEqual([
      { project_id: 9, item_id: 1, qty: 10 },
      { project_id: 9, item_id: 2, qty: 2 },
    ])
    expect(rep.some((r) => r.item_id === 5)).toBe(false)
  })
})
