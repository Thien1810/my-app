import { describe, it, expect } from 'vitest'
import { LEAD_STATUS_META, LEAD_STATUS_ORDER, LEAD_LOST_REASONS, countLeadsByStatus, filterLeads, normalizeLeadStatus, formatTimeAgo } from './leadStatus'

describe('LEAD_STATUS', () => {
  it('bộ trạng thái mới', () => {
    expect(LEAD_STATUS_ORDER).toEqual(['new', 'consulting', 'quoted', 'deposited', 'completed', 'lost'])
    expect(Object.keys(LEAD_STATUS_META)).toEqual(LEAD_STATUS_ORDER)
    expect(LEAD_STATUS_META.new.label).toBe('Mới')
    expect(LEAD_STATUS_META.lost.label).toBe('Mất')
  })
  it('lý do mất', () => {
    expect(LEAD_LOST_REASONS.map((r) => r.key)).toEqual([
      'gia_cao', 'chon_don_vi_khac', 'doi_huy_ngay_cuoi', 'khong_lien_lac_duoc', 'ngoai_vung', 'khac',
    ])
  })
})

describe('normalizeLeadStatus', () => {
  it('ánh xạ cũ sang mới, lạ thành new', () => {
    expect(normalizeLeadStatus('contacted')).toBe('consulting')
    expect(normalizeLeadStatus('converted')).toBe('quoted')
    expect(normalizeLeadStatus('closed')).toBe('lost')
    expect(normalizeLeadStatus('deposited')).toBe('deposited')
    expect(normalizeLeadStatus('x')).toBe('new')
    expect(normalizeLeadStatus(undefined)).toBe('new')
  })
})

describe('countLeadsByStatus', () => {
  it('đếm theo trạng thái, gộp trạng thái cũ', () => {
    const c = countLeadsByStatus([
      { status: 'new' }, { status: 'new' }, { status: 'contacted' }, { status: 'converted' }, { status: 'x' }, { status: 'closed' },
    ])
    expect(c).toEqual({ total: 6, new: 3, consulting: 1, quoted: 1, deposited: 0, completed: 0, lost: 1 })
  })
  it('rỗng hoặc undefined', () => {
    expect(countLeadsByStatus(undefined).total).toBe(0)
    expect(countLeadsByStatus([]).new).toBe(0)
  })
})

describe('formatTimeAgo', () => {
  const now = Date.parse('2026-11-24T12:00:00Z')
  it('giờ, ngày, rỗng', () => {
    expect(formatTimeAgo('2026-11-24T09:00:00Z', now)).toBe('3 giờ trước')
    expect(formatTimeAgo('2026-11-21T12:00:00Z', now)).toBe('3 ngày trước')
    expect(formatTimeAgo(null, now)).toBe('')
  })
})

describe('filterLeads', () => {
  const leads = [
    { id: 1, status: 'new', customer_name: 'Lan', phone: '0911', location: 'Vinh' },
    { id: 2, status: 'closed', customer_name: 'Hùng', selected_template: 'Cổng hoa' },
  ]
  it('all + không tìm kiếm trả hết', () => {
    expect(filterLeads(leads)).toHaveLength(2)
  })
  it('lọc trạng thái', () => {
    expect(filterLeads(leads, { status: 'lost' }).map((l) => l.id)).toEqual([2])
  })
  it('tìm không phân biệt hoa thường, có trim', () => {
    expect(filterLeads(leads, { search: '  cổng ' }).map((l) => l.id)).toEqual([2])
    expect(filterLeads(leads, { search: '0911' }).map((l) => l.id)).toEqual([1])
  })
  it('lọc theo kênh, kết hợp tìm kiếm chiến dịch / trang vào', () => {
    const ls = [
      { id: 1, status: 'new', utm_source: 'facebook', utm_campaign: 'Gia_Tien', landing_path: '/khu-vuc/long-khanh' },
      { id: 2, status: 'new', utm_source: 'tiktok' },
      { id: 3, status: 'closed' },
    ]
    expect(filterLeads(ls, { channel: 'meta_ads' }).map((l) => l.id)).toEqual([1])
    expect(filterLeads(ls, { channel: 'unknown' }).map((l) => l.id)).toEqual([3])
    expect(filterLeads(ls, { search: 'gia_tien' }).map((l) => l.id)).toEqual([1])
    expect(filterLeads(ls, { search: 'long-khanh' }).map((l) => l.id)).toEqual([1])
    expect(filterLeads(ls, { channel: 'tiktok_ads', search: 'gia_tien' })).toHaveLength(0)
  })
})
