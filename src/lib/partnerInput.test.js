import { describe, expect, it } from 'vitest'
import {
  buildCallLink,
  buildZaloLink,
  canExportPartners,
  canSeePartnerKind,
  findDuplicatePartners,
  formatPhoneDisplay,
  normalizePhone,
  phoneKey,
  validatePartnerInput,
} from './partnerInput.js'

describe('Số điện thoại đối tác', () => {
  it('chuẩn hóa +84 và 84 kèm đúng 9 chữ số, giữ nguyên số 9 chữ số', () => {
    expect(normalizePhone(' +84 918.809-096 ')).toBe('0918809096')
    expect(normalizePhone('+84 0918 809 096')).toBe('0918809096')
    expect(normalizePhone('918.809.096')).toBe('918809096')
    expect(phoneKey('84 918.809-096')).toBe('0918809096')
    expect(phoneKey('84918809096')).toBe('0918809096')
    expect(phoneKey('849188090')).toBe('849188090')
    expect(phoneKey('918809096')).toBe('918809096')
  })

  it('giữ định dạng nhập khi lưu và hiển thị, chỉ chuẩn hóa liên kết', () => {
    const phone = '+84 918.809-096'
    expect(validatePartnerInput({ kind: 'customer', name: '  Chị Hương  ', phone }))
      .toMatchObject({ ok: true, data: { name: 'Chị Hương', phone }, phoneKey: '0918809096' })
    expect(formatPhoneDisplay(phone)).toBe('0918 809 096')
    expect(formatPhoneDisplay('918.809.096')).toBe('918 809 096')
    expect(phoneKey(phone)).toBe('0918809096')
    expect(phoneKey('abc0918809096')).toBe('')
    expect(buildCallLink(phone)).toBe('tel:0918809096')
    expect(buildZaloLink('918.809.096')).toBe('https://zalo.me/918809096')
    expect(buildCallLink('abc0918809096')).toBeNull()
  })

  it('cho bỏ trống số và báo lỗi tên trống hoặc số không hợp lệ', () => {
    expect(validatePartnerInput({ kind: 'supplier', name: 'Kho Hoa' }))
      .toMatchObject({ ok: true, data: { phone: null }, phoneKey: '' })
    expect(validatePartnerInput({ kind: 'supplier', name: ' ', phone: '0918x809096' }))
      .toMatchObject({ ok: false, errors: { name: expect.any(String), phone: expect.any(String) }, phoneKey: '' })
    expect(validatePartnerInput({ kind: 'supplier', name: 'Kho Hoa', phone: '918809096' }))
      .toMatchObject({ ok: true, phoneKey: '918809096' })
  })
})

it('gợi ý trùng số qua hai loại, tên gần giống và bỏ bản ghi đang sửa', () => {
  const input = { kind: 'customer', name: 'Chị Hương', phone: '0918.809.096' }
  const partners = [
    { id: 1, kind: 'customer', name: 'Chị Hương', phone: input.phone },
    { id: 2, kind: 'supplier', name: 'Kho Hoa', phone: '+84 918 809 096' },
    { id: 3, kind: 'customer', name: 'Chị Hườn' },
    { id: 4, kind: 'customer', name: 'Chị Hồng', phone: '84918809096' },
    { id: 5, kind: 'supplier', name: 'CHI HUONG' },
  ]
  expect(findDuplicatePartners(input, partners, { excludeId: '1' })).toEqual([
    { partner: partners[1], sameKind: false, match: 'phone' },
    { partner: partners[3], sameKind: true, match: 'phone' },
    { partner: partners[2], sameKind: true, match: 'name' },
    { partner: partners[4], sameKind: false, match: 'name' },
  ])
})

it('chỉ cho quản lý và quản trị xuất dữ liệu và hạn chế nhân viên theo loại', () => {
  expect(['admin', 'manager', 'storekeeper', 'staff', 'pending'].map(canExportPartners))
    .toEqual([true, true, false, false, false])
  expect(canSeePartnerKind('staff', 'supplier')).toBe(true)
  expect(canSeePartnerKind('staff', 'customer')).toBe(false)
  expect(canSeePartnerKind('storekeeper', 'customer')).toBe(true)
  expect(canSeePartnerKind('pending', 'supplier')).toBe(false)
})
