import { describe, it, expect } from 'vitest'
import {
  MANUAL_ENTRY_SOURCES,
  normalizePhone,
  isValidVnPhone,
  validateNewLead,
  buildManualLeadRow,
  findDuplicatePhone,
  isMissingLeadColumnErr,
} from './leadInput'

describe('normalizePhone', () => {
  it('bỏ khoảng trắng, chấm, gạch', () => {
    expect(normalizePhone('0918.809.096')).toBe('0918809096')
    expect(normalizePhone('0918 809-096')).toBe('0918809096')
  })
  it('+84 và 84 -> 0', () => {
    expect(normalizePhone('+84 918 809 096')).toBe('0918809096')
    expect(normalizePhone('84918809096')).toBe('0918809096')
    expect(normalizePhone('+84 0918809096')).toBe('0918809096')
  })
  it('rỗng', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone(null)).toBe('')
  })
})

describe('isValidVnPhone', () => {
  it('hợp lệ', () => {
    expect(isValidVnPhone('0918.809.096')).toBe(true)
    expect(isValidVnPhone('+84918809096')).toBe(true)
  })
  it('không hợp lệ', () => {
    expect(isValidVnPhone('918809096')).toBe(false)
    expect(isValidVnPhone('091880')).toBe(false)
    expect(isValidVnPhone('abc')).toBe(false)
    expect(isValidVnPhone('0918809096123')).toBe(false)
  })
})

describe('validateNewLead', () => {
  const ok = { customer_name: 'An', phone: '0912345678', entry_source: 'Zalo' }
  it('hợp lệ', () => {
    expect(validateNewLead(ok)).toEqual({ ok: true, errors: {} })
  })
  it('thiếu tên, SĐT, nguồn', () => {
    const r = validateNewLead({})
    expect(r.ok).toBe(false)
    expect(Object.keys(r.errors).sort()).toEqual(['customer_name', 'entry_source', 'phone'])
  })
  it('SĐT sai, nguồn lạ', () => {
    const r = validateNewLead({ ...ok, phone: '123', entry_source: 'Tivi' })
    expect(r.errors.phone).toBeTruthy()
    expect(r.errors.entry_source).toBeTruthy()
  })
  it('6 nguồn đều hợp lệ', () => {
    for (const s of MANUAL_ENTRY_SOURCES) expect(validateNewLead({ ...ok, entry_source: s }).ok).toBe(true)
  })
})

describe('buildManualLeadRow', () => {
  it('chuẩn hóa, không có utm_*', () => {
    const row = buildManualLeadRow({
      customer_name: '  Lan ',
      phone: '+84 912.345.678',
      entry_source: 'Gọi điện',
      note: '',
    })
    expect(row).toEqual({
      customer_name: 'Lan',
      phone: '0912345678',
      event_date: null,
      location: null,
      service_interest: null,
      note: null,
      status: 'new',
      entry_source: 'Gọi điện',
      created_via: 'manual',
    })
    expect(Object.keys(row).some((k) => k.startsWith('utm_'))).toBe(false)
  })
})

describe('findDuplicatePhone', () => {
  const leads = [
    { id: 1, phone: '0918.809.096', customer_name: 'A' },
    { id: 2, phone: '+84912345678', customer_name: 'B' },
  ]
  it('khớp theo SĐT chuẩn hóa', () => {
    expect(findDuplicatePhone(leads, '0918809096').id).toBe(1)
    expect(findDuplicatePhone(leads, '0912 345 678').id).toBe(2)
  })
  it('không trùng / rỗng', () => {
    expect(findDuplicatePhone(leads, '0999999999')).toBeNull()
    expect(findDuplicatePhone(leads, '')).toBeNull()
    expect(findDuplicatePhone(null, '0912345678')).toBeNull()
  })
})

describe('isMissingLeadColumnErr', () => {
  it('nhận diện lỗi thiếu cột', () => {
    expect(isMissingLeadColumnErr({ code: 'PGRST204', message: 'x' })).toBe(true)
    expect(isMissingLeadColumnErr({ code: '42703', message: 'x' })).toBe(true)
    expect(isMissingLeadColumnErr({ message: "Could not find the 'entry_source' column" })).toBe(true)
  })
  it('lỗi khác', () => {
    expect(isMissingLeadColumnErr({ message: 'network' })).toBe(false)
    expect(isMissingLeadColumnErr(null)).toBe(false)
  })
})
