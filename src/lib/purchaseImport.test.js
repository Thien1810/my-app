import { describe, it, expect } from 'vitest'
import {
  normalizeCode,
  parseNumberVN,
  parsePurchaseRows,
  buildTemplateWorkbookData,
} from './purchaseImport'

const items = [
  { id: 1, code: 'TH-HOA-001', name: 'Hoa hồng', unit: 'bó', kind: 'consumable', cost: 100000, active: true },
  { id: 2, code: 'TSD-BAN-001', name: 'Bàn', unit: 'cái', kind: 'reusable', cost: 0, active: true },
  { id: 3, code: 'TH-OLD-001', name: 'Cũ', unit: 'cái', kind: 'consumable', cost: 5, active: false },
  { id: 4, code: 'A-001', name: 'A', unit: 'cái', kind: 'consumable', cost: 10, active: true },
]
const H = ['Mã vật tư *', 'Tên vật tư (chỉ để tham khảo)', 'Số lượng *', 'Đơn giá nhập (₫) *', 'Ghi chú']
const row = (code, qty, cost, note = '', name = '') => ({
  [H[0]]: code, [H[1]]: name, [H[2]]: qty, [H[3]]: cost, [H[4]]: note,
})

describe('normalizeCode', () => {
  it('trim, hoa, gộp khoảng trắng', () => {
    expect(normalizeCode('  th-hoa   001 ')).toBe('TH-HOA 001')
    expect(normalizeCode(null)).toBe('')
  })
})

describe('parseNumberVN', () => {
  it('các dạng hợp lệ', () => {
    expect(parseNumberVN(500000)).toBe(500000)
    expect(parseNumberVN('500000')).toBe(500000)
    expect(parseNumberVN('500.000')).toBe(500000)
    expect(parseNumberVN('500,000')).toBe(500000)
    expect(parseNumberVN('1.250.000')).toBe(1250000)
    expect(parseNumberVN('12,5')).toBe(12.5)
    expect(parseNumberVN(' 20 ')).toBe(20)
    expect(parseNumberVN('1.250.000,5')).toBe(1250000.5)
  })
  it('không hợp lệ', () => {
    expect(parseNumberVN('abc')).toBeNaN()
    expect(parseNumberVN('')).toBeNaN()
    expect(parseNumberVN(null)).toBeNaN()
    expect(parseNumberVN('1.2.3')).toBeNaN()
  })
})

describe('parsePurchaseRows', () => {
  it('dòng hợp lệ, đánh số dòng từ 2', () => {
    const r = parsePurchaseRows([row('TH-HOA-001', 5, 100000, 'ghi chú')], items)
    expect(r.fatal).toBeUndefined()
    expect(r.lines[0]).toMatchObject({
      rowNo: 2, item_id: 1, code: 'TH-HOA-001', name: 'Hoa hồng', qty: 5,
      unit_cost: 100000, note: 'ghi chú', status: 'ok',
    })
    expect(r.summary).toEqual({ ok: 1, warn: 0, error: 0, total: 1 })
  })

  it('tiêu đề không dấu, không *, thừa khoảng trắng, hoa/thường', () => {
    const rows = [{ ' MA VAT TU ': 'th-hoa-001', 'so luong': '3', 'Don gia nhap': '100.000', 'ghi chu': '' }]
    const r = parsePurchaseRows(rows, items)
    expect(r.fatal).toBeUndefined()
    expect(r.lines[0].status).toBe('ok')
    expect(r.lines[0].unit_cost).toBe(100000)
  })

  it('thiếu cột -> fatal nêu tên cột', () => {
    const r = parsePurchaseRows([{ 'Mã vật tư': 'A-001', 'Số lượng': 1 }], items)
    expect(r.fatal).toContain('Đơn giá nhập')
    expect(r.fatal).not.toContain('Số lượng')
  })

  it('mã hoa/thường khớp; mã không tồn tại hoặc không active -> lỗi', () => {
    const r = parsePurchaseRows([row('a-001', 1, 10), row('ZZZ', 1, 10), row('TH-OLD-001', 1, 5)], items)
    expect(r.lines[0].status).toBe('ok')
    expect(r.lines[1].status).toBe('error')
    expect(r.lines[1].messages[0]).toContain('Không tìm thấy mã vật tư ZZZ')
    expect(r.lines[2].status).toBe('error')
  })

  it('tên trong file không dùng để khớp', () => {
    const r = parsePurchaseRows([row('', 1, 10, '', 'Hoa hồng')], items)
    expect(r.lines[0].status).toBe('error')
  })

  it('qty 0, âm, chữ -> lỗi', () => {
    const r = parsePurchaseRows([row('A-001', 0, 10), row('TH-HOA-001', -2, 100000), row('TSD-BAN-001', 'abc', 10)], items)
    expect(r.lines.every((l) => l.status === 'error')).toBe(true)
    expect(r.summary.error).toBe(3)
  })

  it('giá 0 -> lỗi, nhắc ghi đè giá vốn', () => {
    const r = parsePurchaseRows([row('A-001', 1, 0)], items)
    expect(r.lines[0].status).toBe('error')
    expect(r.lines[0].messages.join(' ')).toContain('ghi đè giá vốn')
  })

  it('giá "500.000" và "500,000"', () => {
    const r = parsePurchaseRows([row('TSD-BAN-001', 1, '500.000'), row('A-001', 1, '500,000')], items)
    expect(r.lines[0].unit_cost).toBe(500000)
    expect(r.lines[1].unit_cost).toBe(500000)
  })

  it('trùng mã trong file', () => {
    const r = parsePurchaseRows([row('A-001', 1, 10), row('a-001', 2, 10)], items)
    expect(r.lines[0].status).toBe('ok')
    expect(r.lines[1].status).toBe('error')
    expect(r.lines[1].messages.join(' ')).toContain('trùng với dòng 2')
  })

  it('cảnh báo lệch giá > 30%, không chặn', () => {
    const r = parsePurchaseRows([row('TH-HOA-001', 1, 150000), row('TH-HOA-001x', 1, 1), row('TSD-BAN-001', 1, 999)], items)
    expect(r.lines[0].status).toBe('warn')
    expect(r.lines[0].messages[0]).toContain('+50%')
    expect(r.lines[2].status).toBe('ok') // lastCost = 0 -> không cảnh báo
    expect(r.summary.warn).toBe(1)
  })

  it('giá lệch trong 30% là ok', () => {
    const r = parsePurchaseRows([row('TH-HOA-001', 1, 120000)], items)
    expect(r.lines[0].status).toBe('ok')
  })

  it('bỏ qua dòng trống nhưng giữ số dòng Excel', () => {
    const r = parsePurchaseRows([row('', '', ''), row('A-001', 1, 10)], items)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].rowNo).toBe(3)
  })

  it('vượt maxRows -> fatal', () => {
    const rows = Array.from({ length: 201 }, () => row('A-001', 1, 10))
    expect(parsePurchaseRows(rows, items).fatal).toContain('200')
    expect(parsePurchaseRows(rows.slice(0, 200), items).fatal).toBeUndefined()
  })

  it('không có dòng -> fatal', () => {
    expect(parsePurchaseRows([], items).fatal).toBeTruthy()
  })
})

describe('buildTemplateWorkbookData', () => {
  it('đúng cấu trúc mẫu', () => {
    const t = buildTemplateWorkbookData(items)
    expect(t.nhapHang[0]).toEqual(H)
    expect(t.nhapHang).toHaveLength(4)
    expect(t.nhapHang[1][4]).toBe('Ví dụ - xóa dòng này')
    expect(t.nhapHang[1][0]).toBe('A-001')
    expect(t.huongDan).toHaveLength(8)
    expect(t.huongDan[0][0]).toBe('HƯỚNG DẪN')
    expect(t.danhMuc[0]).toEqual(['Mã vật tư', 'Tên vật tư', 'Đơn vị', 'Loại (Tiêu hao/Tái sử dụng)', 'Giá nhập lần trước (₫)'])
    expect(t.danhMuc).toHaveLength(4) // 3 active + header
    expect(t.danhMuc[2][3]).toBe('Tiêu hao')
    expect(t.danhMuc.map((r) => r[0])).not.toContain('TH-OLD-001')
  })
  it('ít hơn 3 vật tư', () => {
    expect(buildTemplateWorkbookData([items[0]]).nhapHang).toHaveLength(2)
    expect(buildTemplateWorkbookData([]).nhapHang).toHaveLength(1)
  })
})
