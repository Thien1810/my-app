import { describe, it, expect } from 'vitest'
import { isPastMonth, canLockMonth, canUnlockMonth, buildLockChecklist, currentMonthVN } from './monthLock'

describe('monthLock', () => {
  it('tính tháng theo giờ VN', () => {
    // 31/10 18:00 UTC = 01/11 01:00 VN
    const now = new Date('2026-10-31T18:00:00Z')
    expect(currentMonthVN(now)).toBe('2026-11')
    expect(isPastMonth('2026-10', now)).toBe(true)
    expect(isPastMonth('2026-11', now)).toBe(false)
    expect(isPastMonth('2027-01', now)).toBe(false)
    expect(isPastMonth('xx', now)).toBe(false)
  })
  it('canLockMonth', () => {
    const now = new Date('2026-11-24T05:00:00Z')
    expect(canLockMonth({ role: 'admin', month: '2026-10', isLocked: false, now }).ok).toBe(true)
    expect(canLockMonth({ role: 'manager', month: '2026-10', isLocked: false, now }).ok).toBe(true)
    expect(canLockMonth({ role: 'staff', month: '2026-10', isLocked: false, now }).ok).toBe(false)
    expect(canLockMonth({ role: 'admin', month: '2026-11', isLocked: false, now }).reason).toContain('đã kết thúc')
    expect(canLockMonth({ role: 'admin', month: '2026-10', isLocked: true, now }).ok).toBe(false)
  })
  it('canUnlockMonth', () => {
    expect(canUnlockMonth({ role: 'admin', isLocked: true }).ok).toBe(true)
    expect(canUnlockMonth({ role: 'manager', isLocked: true }).ok).toBe(false)
    expect(canUnlockMonth({ role: 'admin', isLocked: false }).ok).toBe(false)
  })
  it('buildLockChecklist', () => {
    const list = buildLockChecklist({
      month: '2026-10',
      adsRows: [],
      fixedCosts: [{ month: '2026-10' }],
      projects: [
        { start_date: '2026-10-05', status: 'done', lead_source: 'unknown' },
        { start_date: '2026-10-06', status: 'in_progress', lead_source: 'meta_ads' },
        { start_date: '2026-09-06', status: 'quote' },
      ],
    })
    const by = Object.fromEntries(list.map((i) => [i.key, i.level]))
    expect(by).toEqual({ ads: 'warn', fixed: 'ok', unknown: 'warn', open: 'warn' })
    expect(buildLockChecklist({ month: '2026-10' })).toEqual([])
  })
})
