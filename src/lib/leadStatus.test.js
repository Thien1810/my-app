import { describe, it, expect } from 'vitest'
import { LEAD_STATUS_META, LEAD_STATUS_ORDER, countLeadsByStatus, filterLeads } from './leadStatus'

describe('LEAD_STATUS', () => {
  it('giữ bộ trạng thái hiện tại', () => {
    expect(LEAD_STATUS_ORDER).toEqual(['new', 'contacted', 'converted', 'closed'])
    expect(Object.keys(LEAD_STATUS_META)).toEqual(LEAD_STATUS_ORDER)
    expect(LEAD_STATUS_META.new.label).toBe('Mới đăng ký')
    expect(LEAD_STATUS_META.closed.cls).toBe('badge-gray')
  })
})

describe('countLeadsByStatus', () => {
  it('đếm theo trạng thái', () => {
    const c = countLeadsByStatus([
      { status: 'new' }, { status: 'new' }, { status: 'contacted' }, { status: 'converted' }, { status: 'x' },
    ])
    expect(c).toEqual({ total: 5, new: 2, contacted: 1, converted: 1, closed: 0 })
  })
  it('rỗng hoặc undefined', () => {
    expect(countLeadsByStatus(undefined).total).toBe(0)
    expect(countLeadsByStatus([]).new).toBe(0)
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
    expect(filterLeads(leads, { status: 'closed' }).map((l) => l.id)).toEqual([2])
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
