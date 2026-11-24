import { describe, it, expect } from 'vitest'
import {
  toLedgerRows,
  filterLedgerRows,
  defaultFromDate,
  vnTodayISO,
  removeDiacritics,
  groupLedgerRows,
} from './ledgerRows'

const item = { id: 1, code: 'TH-HOA-001', name: 'Hoa hồng đỏ', unit: 'bó', kind: 'consumable' }
const item2 = { id: 2, code: 'TSD-DEN-001', name: 'Đèn LED', unit: 'cái', kind: 'reusable' }

const movements = [
  { id: 1, moved_at: '2026-11-01', type: 'purchase', item_id: 1, qty: 10, unit_cost: 5000, note: 'Hóa đơn 12', project_id: null, item, project: null, partner: { id: 9, name: 'Cửa hàng Hoa Mai' } },
  { id: 2, moved_at: '2026-11-10', type: 'issue', item_id: 2, qty: 3, unit_cost: null, note: null, project_id: 5, item: item2, project: { id: 5, code: 'DA-2611-001', name: 'Đám cưới Lan' }, partner: null },
  { id: 3, moved_at: '2026-11-10', type: 'return_damaged', item_id: 2, qty: 1, unit_cost: null, note: 'Gãy chân', project_id: 5, item: item2, project: { id: 5, code: 'x', name: 'Đám cưới Lan' }, partner: null },
]
const transfers = [
  { id: 7, item_id: 2, from_wh: 'MAIN', to_wh: 'B', qty: 2, transferred_at: '2026-11-10', note: 'đi kho B' },
  { id: 8, item_id: 99, from_wh: 'B', to_wh: 'ZZ', qty: 1, transferred_at: '2026-11-12T08:00:00Z', note: null },
]
const warehouses = [
  { code: 'MAIN', name: 'Kho chính' },
  { code: 'B', name: 'Kho B' },
]

describe('toLedgerRows', () => {
  const rows = toLedgerRows({ movements, transfers, warehouses })

  it('gộp hai nguồn và sắp xếp ngày giảm dần rồi id giảm dần', () => {
    expect(rows.map((r) => r.key)).toEqual(['t-8', 't-7', 'm-3', 'm-2', 'm-1'])
  })

  it('phiếu chuyển lấy tên vật tư từ movements và hiện kho đi → kho đến', () => {
    const t = rows.find((r) => r.key === 't-7')
    expect(t.kind).toBe('transfer')
    expect(t.type).toBe('transfer')
    expect(t.itemName).toBe('Đèn LED')
    expect(t.unit).toBe('cái')
    expect(t.warehouseText).toBe('Kho chính → Kho B')
  })

  it('vật tư không rõ thì để trống tên, mã kho lạ giữ nguyên mã, cắt ngày', () => {
    const t = rows.find((r) => r.key === 't-8')
    expect(t.itemName).toBe('')
    expect(t.itemId).toBe(99)
    expect(t.date).toBe('2026-11-12')
    expect(t.warehouseText).toBe('Kho B → ZZ')
  })

  it('dùng itemsById khi có', () => {
    const r = toLedgerRows({ movements: [], transfers, itemsById: { 99: { code: 'C', name: 'Ghế', unit: 'cái', kind: 'reusable' } } })
    expect(r.find((x) => x.id === 8).itemName).toBe('Ghế')
  })

  it('chuẩn hóa dòng movement', () => {
    const m = rows.find((r) => r.key === 'm-1')
    expect(m).toMatchObject({ kind: 'movement', qty: 10, unitCost: 5000, partnerName: 'Cửa hàng Hoa Mai', unit: 'bó' })
    expect(rows.find((r) => r.key === 'm-2').unitCost).toBeNull()
  })
})

describe('filterLedgerRows', () => {
  const rows = toLedgerRows({ movements, transfers, warehouses })

  it('lọc theo khoảng ngày', () => {
    expect(filterLedgerRows(rows, { from: '2026-11-10', to: '2026-11-10' }).map((r) => r.key)).toEqual(['t-7', 'm-3', 'm-2'])
  })

  it('chip Thu hồi gộp 3 loại; Chuyển kho chỉ phiếu chuyển', () => {
    expect(filterLedgerRows(rows, { type: 'return' }).map((r) => r.key)).toEqual(['m-3'])
    expect(filterLedgerRows(rows, { type: 'transfer' })).toHaveLength(2)
    expect(filterLedgerRows(rows, { type: 'issue' })).toHaveLength(1)
  })

  it('lọc loại vật tư và dự án', () => {
    expect(filterLedgerRows(rows, { itemKind: 'consumable' }).map((r) => r.key)).toEqual(['m-1'])
    expect(filterLedgerRows(rows, { projectId: '5' }).map((r) => r.key)).toEqual(['m-3', 'm-2'])
    expect(filterLedgerRows(rows, { projectId: 5 })).toHaveLength(2)
  })

  it('tìm kiếm không phân biệt hoa thường và dấu', () => {
    expect(filterLedgerRows(rows, { search: 'HOA HONG' }).map((r) => r.key)).toEqual(['m-1'])
    expect(filterLedgerRows(rows, { search: 'gay chan' }).map((r) => r.key)).toEqual(['m-3'])
    expect(filterLedgerRows(rows, { search: 'hoa mai' }).map((r) => r.key)).toEqual(['m-1'])
    expect(filterLedgerRows(rows, { search: 'dam cuoi lan' })).toHaveLength(2)
    expect(filterLedgerRows(rows, { search: 'den led' }).length).toBe(3)
    expect(filterLedgerRows(rows, { search: 'khong co' })).toHaveLength(0)
  })

  it('không bộ lọc trả về tất cả', () => {
    expect(filterLedgerRows(rows, {})).toHaveLength(5)
  })
})

describe('defaultFromDate / vnTodayISO', () => {
  it('trừ 30 ngày, qua tháng và năm', () => {
    expect(defaultFromDate('2026-11-24')).toBe('2026-10-25')
    expect(defaultFromDate('2026-01-10', 30)).toBe('2025-12-11')
    expect(defaultFromDate('2026-03-01', 1)).toBe('2026-02-28')
  })

  it('vnTodayISO dùng múi giờ Việt Nam', () => {
    expect(vnTodayISO(new Date('2026-11-24T20:00:00Z'))).toBe('2026-11-25')
    expect(vnTodayISO(new Date('2026-11-24T10:00:00Z'))).toBe('2026-11-24')
  })

  it('removeDiacritics', () => {
    expect(removeDiacritics('Đèn Ánh Sáng')).toBe('den anh sang')
  })
})

describe('mã phiếu trong sổ kho', () => {
  const mv = (id, code, qty, cost, type = 'purchase') => ({
    id, moved_at: '2026-11-20', type, item_id: 1, qty, unit_cost: cost, note: null, item, project: null, partner: null, receipt_code: code,
  })
  const movs = [mv(1, 'PN-2611-001', 2, 1000), mv(2, 'PN-2611-001', 3, 2000), mv(3, null, 1, 500), mv(4, 'KK-2611-001', 1, null, 'adjust')]
  const rows = toLedgerRows({ movements: movs, transfers: [{ id: 5, item_id: 1, from_wh: 'A', to_wh: 'B', qty: 1, transferred_at: '2026-11-20', receipt_code: 'CK-2611-001' }] })

  it('đưa receiptCode vào dòng', () => {
    expect(rows.find((r) => r.key === 'm-1').receiptCode).toBe('PN-2611-001')
    expect(rows.find((r) => r.key === 'm-3').receiptCode).toBe('')
    expect(rows.find((r) => r.key === 't-5').receiptCode).toBe('CK-2611-001')
  })
  it('gom nhóm từ 2 dòng, dòng lẻ/không mã giữ nguyên', () => {
    const g = groupLedgerRows(rows)
    const groups = g.filter((x) => x.kind === 'group')
    expect(groups).toHaveLength(1)
    expect(groups[0].code).toBe('PN-2611-001')
    expect(groups[0].count).toBe(2)
    expect(groups[0].total).toBe(2 * 1000 + 3 * 2000)
    expect(g.filter((x) => x.kind === 'row')).toHaveLength(3)
    expect(g.reduce((n, x) => n + (x.kind === 'group' ? x.rows.length : 1), 0)).toBe(rows.length)
  })
  it('tìm theo mã phiếu (không phân biệt hoa thường)', () => {
    const f = filterLedgerRows(rows, { search: 'pn-2611-001' })
    expect(f.map((r) => r.key).sort()).toEqual(['m-1', 'm-2'])
    expect(filterLedgerRows(rows, { search: 'CK-2611' })).toHaveLength(1)
  })
})
