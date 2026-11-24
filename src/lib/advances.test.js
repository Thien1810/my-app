import { describe, it, expect } from 'vitest'
import { summarizeAdvances, validateAdvanceInput, toAdvanceRow } from './advances'

const adv = (amount, kind = 'advance') => ({ amount, kind })

describe('summarizeAdvances', () => {
  it('HĐ 9.000.000, cọc 3.000.000 -> còn 6.000.000', () => {
    const s = summarizeAdvances([adv(3000000)], 9000000)
    expect(s.received).toBe(3000000)
    expect(s.outstanding).toBe(6000000)
  })
  it('hoàn lại làm giảm đã thu', () => {
    const s = summarizeAdvances([adv(3000000), adv(1000000, 'refund')], 9000000)
    expect(s.refundTotal).toBe(1000000)
    expect(s.received).toBe(2000000)
    expect(s.outstanding).toBe(7000000)
  })
  it('forfeit không tính vào đã thu', () => {
    const s = summarizeAdvances([adv(3000000), adv(500000, 'forfeit')], 9000000)
    expect(s.forfeitTotal).toBe(500000)
    expect(s.received).toBe(3000000)
  })
  it('amount âm trong DB vẫn tính đúng', () => {
    const s = summarizeAdvances([adv(3000000), adv(-1000000, 'refund'), adv(-200000, 'forfeit')], 9000000)
    expect(s.refundTotal).toBe(1000000)
    expect(s.forfeitTotal).toBe(200000)
    expect(s.received).toBe(2000000)
  })
  it('thu dư thì outstanding âm', () => {
    expect(summarizeAdvances([adv(10000000)], 9000000).outstanding).toBe(-1000000)
  })
  it('kind lạ bị bỏ qua, rows rỗng/null an toàn', () => {
    expect(summarizeAdvances([adv(5, 'x')], 100).received).toBe(0)
    expect(summarizeAdvances(null, 100)).toMatchObject({ received: 0, outstanding: 100 })
  })
})

describe('validateAdvanceInput', () => {
  const ok = { kind: 'advance', amount: 1000, receivedDate: '2026-11-24', rows: [] }
  it('hợp lệ', () => expect(validateAdvanceInput(ok)).toBe(''))
  it('amount 0 hoặc âm bị chặn', () => {
    expect(validateAdvanceInput({ ...ok, amount: 0 })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, amount: -5 })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, amount: '' })).not.toBe('')
  })
  it('ngày sai bị chặn', () => {
    expect(validateAdvanceInput({ ...ok, receivedDate: '24/11/2026' })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, receivedDate: '2026-02-30' })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, receivedDate: '' })).not.toBe('')
  })
  it('kind sai bị chặn', () => {
    expect(validateAdvanceInput({ ...ok, kind: 'abc' })).not.toBe('')
  })
  it('refund quá số đã thu bị chặn, bằng thì được', () => {
    const rows = [adv(3000000)]
    expect(validateAdvanceInput({ ...ok, kind: 'refund', amount: 3000001, rows })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, kind: 'refund', amount: 3000000, rows })).toBe('')
  })
  it('forfeit quá số đang giữ (đã trừ forfeit có sẵn) bị chặn', () => {
    const rows = [adv(3000000), adv(2000000, 'forfeit')]
    expect(validateAdvanceInput({ ...ok, kind: 'forfeit', amount: 1000001, rows })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, kind: 'forfeit', amount: 1000000, rows })).toBe('')
  })
  it('refund/forfeit khi chưa thu gì bị chặn', () => {
    expect(validateAdvanceInput({ ...ok, kind: 'refund', amount: 1 })).not.toBe('')
    expect(validateAdvanceInput({ ...ok, kind: 'forfeit', amount: 1 })).not.toBe('')
  })
})

describe('toAdvanceRow', () => {
  const base = { projectId: 'p1', amount: 500, receivedDate: '2026-11-24' }
  it('advance và forfeit dương, refund âm', () => {
    expect(toAdvanceRow({ ...base, kind: 'advance' }).amount).toBe(500)
    expect(toAdvanceRow({ ...base, kind: 'forfeit' }).amount).toBe(500)
    expect(toAdvanceRow({ ...base, kind: 'refund' }).amount).toBe(-500)
  })
  it('note rỗng -> null, có note thì cắt khoảng trắng', () => {
    expect(toAdvanceRow({ ...base, kind: 'advance', note: '  ' }).note).toBeNull()
    expect(toAdvanceRow({ ...base, kind: 'advance', note: ' cọc ' }).note).toBe('cọc')
    expect(toAdvanceRow({ ...base, kind: 'advance' })).toMatchObject({ project_id: 'p1', received_date: '2026-11-24' })
  })
})
