import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase.js'
import {
  archivePartner,
  changeKindAllowed,
  deletePartnerSafe,
  getPartnerHistory,
  isMissingPartnersSchemaError,
  listPartners,
  unarchivePartner,
} from './partnersApi.js'

vi.mock('./supabase.js', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

function mockQueries(resolve) {
  supabase.from.mockImplementation((table) => {
    const request = { table, filters: {}, orders: [] }
    const query = {
      select(columns) { request.columns = columns; return query },
      eq(column, value) { request.filters[column] = value; return query },
      is(column, value) { return query.eq(column, value) },
      order(column) { request.orders.push(column); return query },
      range(from, to) { request.range = [from, to]; return query },
      update(values) { request.update = values; return query },
      delete() { request.delete = true; return query },
      maybeSingle() { return query },
      limit(count) { request.limit = count; return query },
      then(fulfill, reject) { return Promise.resolve().then(() => resolve(request)).then(fulfill, reject) },
    }
    return query
  })
}

const rows = (data) => ({ data, error: null })
const dbError = (code) => ({ data: null, error: { code } })

beforeEach(() => {
  vi.resetAllMocks()
  supabase.rpc.mockResolvedValue(rows('manager'))
})

describe('listPartners', () => {
  it('tìm số đã chuẩn hóa sau mốc 1.000 dòng và phân trang kết quả', async () => {
    const records = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, kind: 'customer', name: 'Khách' }))
    records[1000].phone = '+84 918.809-096'
    const resolve = vi.fn(({ range: [from, to] }) => rows(records.slice(from, to + 1)))
    mockQueries(resolve)
    const result = await listPartners({ kind: 'customer', search: '0918809096', page: 1 })
    expect(result).toMatchObject({ ok: true, data: [records[1000]], total: 1, hasMore: false })
    expect(resolve.mock.calls.map(([request]) => request.range)).toEqual([[0, 999], [1000, 1999]])
    expect(resolve.mock.calls[0][0]).toMatchObject({
      filters: { kind: 'customer', archived_at: null },
      orders: ['name', 'id'],
    })
  })

  it('giới hạn nhân viên ở nhà cung cấp và từ chối truy vấn khách hàng', async () => {
    supabase.rpc.mockResolvedValue(rows('staff'))
    const resolve = vi.fn(() => rows([{ kind: 'customer' }, { kind: 'supplier' }]))
    mockQueries(resolve)
    expect(await listPartners({ includeArchived: true })).toMatchObject({ data: [{ kind: 'supplier' }] })
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ filters: { kind: 'supplier' } }))
    expect(await listPartners({ kind: 'customer' })).toMatchObject({ ok: false, data: null })
  })

  it('bỏ kết quả trang trước khi một trang sau bị lỗi', async () => {
    mockQueries(({ range: [from] }) => from === 0 ? rows(Array(1000).fill({ kind: 'customer' })) : dbError('PGRST205'))
    expect(await listPartners()).toMatchObject({ ok: false, data: null, schemaMissing: true, code: 'PGRST205' })
  })
})

describe('getPartnerHistory', () => {
  it.each(['admin', 'manager'])('đọc doanh thu dự án cho %s theo vai trò DB', async (role) => {
    supabase.rpc.mockResolvedValue(rows(role))
    const resolve = vi.fn(() => rows([
      { id: 1, name: 'Đám cưới', status: 'done', project_finance: [{ contract_value: '9000000' }] },
      { id: 2, name: 'Đám hủy', status: 'cancelled', project_finance: { contract_value: 1000000 } },
      { id: 3, name: 'Báo giá', status: 'quote', project_finance: { contract_value: 1000000 } },
    ]))
    mockQueries(resolve)
    const result = await getPartnerHistory({ id: 11, kind: 'customer' })
    expect(result).toMatchObject({ ok: true, data: { totalRevenue: 9000000 } })
    expect(result.data.projects.map((project) => project.revenue)).toEqual([9000000, 0, 0])
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      columns: expect.stringContaining('project_finance(contract_value)'),
      filters: { customer_id: 11 },
    }))
  })

  it('không truy vấn doanh thu cho thủ kho và chặn lịch sử khách hàng của nhân viên', async () => {
    const resolve = vi.fn(() => rows([{ id: 1, project_finance: { contract_value: 100 } }]))
    mockQueries(resolve)
    supabase.rpc.mockResolvedValue(rows('storekeeper'))
    const partner = { id: 11, kind: 'customer', role: 'admin' }
    const result = await getPartnerHistory(partner)
    expect(result.data.projects[0]).not.toHaveProperty('revenue')
    expect(result.data).not.toHaveProperty('totalRevenue')
    expect(resolve.mock.calls[0][0].columns).not.toContain('project_finance')
    supabase.rpc.mockResolvedValue(rows('staff'))
    expect(await getPartnerHistory(partner)).toMatchObject({ ok: false, data: null })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it.each(['admin', 'manager', 'storekeeper'])('tính tiền và gộp dòng thiếu giá theo mã phiếu cho %s', async (role) => {
    supabase.rpc.mockResolvedValue(rows(role))
    const resolve = vi.fn(() => rows([
      { id: 1, qty: '2.50', unit_cost: '1200', receipt_code: 'PN-01' },
      { id: 2, qty: 1, unit_cost: null, receipt_code: 'PN-01' },
      { id: 3, qty: 5, unit_cost: null, receipt_code: 'PN-01' },
      { id: 4, qty: 3, unit_cost: 0, receipt_code: null },
    ]))
    mockQueries(resolve)
    const result = await getPartnerHistory({ id: 11, kind: 'supplier' })
    expect(result).toMatchObject({ ok: true, data: { totalSpent: 3000, missingPriceReceiptCount: 2 } })
    expect(result.data.purchases.map((row) => row.amount)).toEqual([3000, null, null, null])
    expect(result.data).not.toHaveProperty('debt')
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ filters: { partner_id: 11, type: 'purchase' } }))
  })

  it.each([false, true])('không truy vấn hay trả tiền cho nhân viên, kể cả khi thiếu cột mã phiếu (%s)', async (missingReceiptCode) => {
    supabase.rpc.mockResolvedValue(rows('staff'))
    const movement = { id: 1, moved_at: '2026-11-26', qty: 2, unit_cost: 1200, amount: 2400 }
    const resolve = vi.fn(({ columns }) => {
      if (!columns.includes('receipt_code')) return rows([movement])
      if (!missingReceiptCode) return rows([{ ...movement, receipt_code: ' PN-01 ' }])
      return { data: null, error: { code: '42703', message: 'column receipt_code does not exist' } }
    })
    mockQueries(resolve)
    const result = await getPartnerHistory({ id: 11, kind: 'supplier', role: 'admin' })
    expect(result.ok).toBe(true)
    expect(result.schemaMissing).toBe(missingReceiptCode)
    expect(result.data).toEqual({
      kind: 'supplier',
      missingReceiptCode,
      purchases: [{ id: 1, moved_at: '2026-11-26', qty: 2, receipt_code: missingReceiptCode ? null : 'PN-01' }],
    })
    expect(resolve.mock.calls.map(([request]) => request.columns)).toEqual(missingReceiptCode
      ? ['id,moved_at,qty,receipt_code', 'id,moved_at,qty']
      : ['id,moved_at,qty,receipt_code'])
  })

  it('dùng từng dòng nếu cơ sở dữ liệu chưa có cột mã phiếu', async () => {
    mockQueries(({ columns }) => columns.includes('receipt_code') ? { data: null, error: { code: '42703', message: 'column receipt_code does not exist' } } : rows([
      { id: 1, qty: 1, unit_cost: null },
      { id: 2, qty: 1, unit_cost: null },
    ]))
    expect(await getPartnerHistory({ id: 11, kind: 'supplier' })).toMatchObject({
      ok: true,
      schemaMissing: true,
      warning: expect.stringContaining('stock_receipts.sql'),
      data: { missingPriceReceiptCount: 2 },
    })
  })
})

describe('Thao tác với đối tác', () => {
  it('lưu trữ và khôi phục bằng cờ archived_at', async () => {
    const resolve = vi.fn(({ filters, update }) => rows({ id: filters.id, ...update }))
    mockQueries(resolve)
    expect(await archivePartner({ id: 2 })).toMatchObject({ data: { id: 2, archived_at: expect.any(String) } })
    expect(await unarchivePartner(2)).toMatchObject({ data: { id: 2, archived_at: null } })
  })

  it('kiểm tra cả hai liên kết và chặn xóa/đổi loại khi khác phân loại', async () => {
    const resolve = vi.fn(({ table }) => rows(table === 'stock_movements' ? [{ id: 1 }] : []))
    mockQueries(resolve)
    const partner = { id: 14, kind: 'customer' }
    const references = { projects: false, stockMovements: true }
    expect(await changeKindAllowed(partner)).toMatchObject({ ok: true, data: { allowed: false, references } })
    expect(await deletePartnerSafe(partner)).toMatchObject({ ok: false, references })
    expect(resolve.mock.calls.map(([request]) => request.table))
      .toEqual(['projects', 'stock_movements', 'projects', 'stock_movements'])
  })

  it('báo lỗi tiếng Việt nếu liên kết được tạo sau khi đã kiểm tra', async () => {
    mockQueries(({ table }) => table === 'partners' ? dbError('23503') : rows([]))
    expect(await deletePartnerSafe(14)).toMatchObject({ ok: false, code: '23503', error: expect.stringContaining('lưu trữ') })
  })

  it('dừng khi truy vấn kiểm tra lỗi hoặc ném ngoại lệ', async () => {
    const resolve = vi.fn(({ table }) => {
      if (table === 'projects') throw { code: '42P01' }
      return rows([])
    })
    mockQueries(resolve)
    expect(await deletePartnerSafe(14)).toMatchObject({ ok: false, data: null, schemaMissing: true })
    expect(await changeKindAllowed(14)).toMatchObject({ ok: false, data: null, schemaMissing: true })
    expect(resolve.mock.calls.some(([request]) => request.delete)).toBe(false)
  })
})

it.each(['42703', '42P01', 'PGRST204', 'PGRST205'])('nhận diện lỗi thiếu cấu trúc %s', (code) => {
  expect(isMissingPartnersSchemaError({ code })).toBe(true)
})
