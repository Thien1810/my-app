import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase.js'
import { createLeadProject, isLeadProjectConflict } from './leadConvertApi.js'

vi.mock('./supabase.js', () => ({ supabase: { from: vi.fn() } }))

function mockQueries(resolve) {
  supabase.from.mockImplementation((table) => {
    const request = { table }
    const query = {
      select(columns) { request.columns = columns; return query },
      eq() { return query },
      order() { return query },
      insert(row) { request.insert = { ...row }; return query },
      range() { return resolve(request) },
      single() { return resolve(request) },
    }
    return query
  })
}

const result = (data) => ({ data, error: null })
const lead = { id: 7, customer_name: 'Chị Hương', phone: '84918809096', event_date: '2026-11-26' }
const input = { lead, leadSource: 'referral', warehouseCode: 'xuan_loc', customerChoice: 'new' }
const codeConflict = { code: '23505', message: 'duplicate key value violates unique constraint "projects_code_key"' }
const leadConflict = { code: '23505', details: 'Key (site_lead_id)=(7) already exists.' }
const unavailable = { code: '42501', message: 'permission denied for table projects' }

beforeEach(() => vi.resetAllMocks())

describe('Tạo dự án từ lead', () => {
  it('dùng đúng hồ sơ đã tạo khi xác nhận lại và giữ hồ sơ của các lead độc lập', async () => {
    const anotherLead = { ...lead, id: 8, customer_name: 'Chị Hoa', phone: 'chưa có SĐT' }
    const createCustomer = vi.fn(({ name }) => result({ id: name === lead.customer_name ? 41 : 42 }))
    const insertProject = vi.fn()
      .mockReturnValueOnce({ error: unavailable })
      .mockReturnValueOnce({ error: unavailable })
      .mockReturnValueOnce(result({ id: 91 }))
      .mockReturnValueOnce(result({ id: 92 }))
    mockQueries(({ table, insert }) => {
      if (table === 'partners') return insert ? createCustomer(insert) : result([])
      return insert ? insertProject(insert) : result([])
    })

    const createdCustomerIds = new Map()
    const convertAnother = { ...input, lead: anotherLead, customerChoice: '' }
    await expect(createLeadProject(input, createdCustomerIds)).rejects.toBe(unavailable)
    await expect(createLeadProject(convertAnother, createdCustomerIds)).rejects.toBe(unavailable)
    expect(createdCustomerIds).toEqual(new Map([[lead.id, 41], [anotherLead.id, 42]]))

    await expect(createLeadProject(input, createdCustomerIds)).resolves.toMatchObject({ project: { id: 91 } })
    await expect(createLeadProject(convertAnother, createdCustomerIds)).resolves.toMatchObject({ project: { id: 92 } })
    expect(createCustomer).toHaveBeenCalledTimes(2)
    expect(insertProject.mock.calls.map(([row]) => [row.site_lead_id, row.customer_id]))
      .toEqual([[7, 41], [8, 42], [7, 41], [8, 42]])
    expect(createdCustomerIds.size).toBe(0)
  })

  it('đọc lại mã sau khi trùng và giữ nguyên khách, nguồn và liên kết lead', async () => {
    const customers = [{ id: 41, kind: 'customer', phone: '0918809096' }]
    const readCodes = vi.fn()
      .mockReturnValueOnce(result([{ id: 1, code: 'DA-2611-001' }]))
      .mockReturnValueOnce(result([{ id: 3, code: 'DA-2611-003' }]))
    const insertProject = vi.fn()
      .mockReturnValueOnce({ error: codeConflict })
      .mockReturnValueOnce(result({ id: 91 }))
    mockQueries(({ table, insert }) => {
      if (table === 'partners' && !insert) return result(customers)
      if (table === 'projects') return insert ? insertProject(insert) : readCodes()
      throw new Error('Yêu cầu ngoài dự kiến')
    })

    await expect(createLeadProject({ ...input, customerChoice: '41' }, new Map()))
      .resolves.toEqual({ project: { id: 91 }, code: 'DA-2611-004' })
    expect(readCodes).toHaveBeenCalledTimes(2)
    const [first, second] = insertProject.mock.calls.map(([row]) => row)
    expect(first).toMatchObject({ code: 'DA-2611-002', customer_id: 41, site_lead_id: 7, lead_source: 'referral', warehouse_code: 'xuan_loc' })
    expect(second).toEqual({ ...first, code: 'DA-2611-004' })
  })

  it('giữ fallback khi thiếu site_lead_id và thử mã khác đúng một lần', async () => {
    const readCodes = vi.fn(() => result([]))
    const missingColumn = { code: 'PGRST204', message: 'site_lead_id schema cache' }
    const insertProject = vi.fn()
      .mockReturnValueOnce({ error: missingColumn })
      .mockReturnValue({ error: codeConflict })
    mockQueries(({ table, insert }) => {
      if (table !== 'projects') throw new Error('Đã có khách từ lần trước')
      return insert ? insertProject(insert) : readCodes()
    })

    const createdCustomerIds = new Map([[lead.id, 41]])
    await expect(createLeadProject(input, createdCustomerIds)).rejects.toBe(codeConflict)
    expect(readCodes).toHaveBeenCalledTimes(2)
    expect(insertProject.mock.calls.map(([row]) => [row.site_lead_id, row.code])).toEqual([
      [7, 'DA-2611-001'], [undefined, 'DA-2611-001'], [undefined, 'DA-2611-002'],
    ])
    expect(createdCustomerIds.get(lead.id)).toBe(41)
  })

  it('nhận diện xung đột liên kết lead và không thử thêm mã khi gặp xung đột đó', async () => {
    const readCodes = vi.fn(() => result([]))
    const insertProject = vi.fn().mockReturnValue({ error: leadConflict })
    mockQueries(({ table, insert }) => {
      if (table !== 'projects') throw new Error('Đã có khách từ lần trước')
      return insert ? insertProject(insert) : readCodes()
    })

    await expect(createLeadProject(input, new Map([[lead.id, 41]]))).rejects.toBe(leadConflict)
    expect(isLeadProjectConflict(leadConflict)).toBe(true)
    expect(isLeadProjectConflict(codeConflict)).toBe(false)
    expect(readCodes).toHaveBeenCalledTimes(1)
    expect(insertProject).toHaveBeenCalledTimes(1)
  })
})
