import { describe, it, expect } from 'vitest'
import {
  prefixForMovementType,
  isMissingReceiptColumnError,
  withReceiptCode,
  savedReceiptMessage,
} from './receiptCode'

describe('receiptCode', () => {
  it('tiền tố theo loại phiếu', () => {
    expect(prefixForMovementType('purchase')).toBe('PN')
    expect(prefixForMovementType('adjust')).toBe('KK')
    expect(prefixForMovementType('repair_done')).toBe('DH')
    expect(prefixForMovementType('dispose')).toBe('DH')
    expect(prefixForMovementType('issue')).toBeNull()
  })
  it('nhận diện lỗi thiếu cột receipt_code', () => {
    expect(isMissingReceiptColumnError({ code: 'PGRST204', message: 'x' })).toBe(true)
    expect(isMissingReceiptColumnError({ code: '42703', message: 'x' })).toBe(true)
    expect(isMissingReceiptColumnError({ message: "Could not find the 'receipt_code' column" })).toBe(true)
    expect(isMissingReceiptColumnError({ code: '23505', message: 'duplicate' })).toBe(false)
    expect(isMissingReceiptColumnError(null)).toBe(false)
  })
  it('withReceiptCode chỉ thêm cột khi có mã', () => {
    const rows = [{ a: 1 }, { a: 2 }]
    expect(withReceiptCode(rows, 'PN-2611-001')).toEqual([
      { a: 1, receipt_code: 'PN-2611-001' },
      { a: 2, receipt_code: 'PN-2611-001' },
    ])
    expect(withReceiptCode(rows, null)).toBe(rows)
  })
  it('thông báo lưu phiếu', () => {
    expect(savedReceiptMessage('PN-2611-001', 3, 'cũ')).toBe('Đã lưu phiếu PN-2611-001 (3 dòng)')
    expect(savedReceiptMessage(null, 3, 'cũ')).toBe('cũ')
  })
})
