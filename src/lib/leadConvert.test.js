import { describe, it, expect } from 'vitest'
import { leadToProjectSource, leadToWarehouse, canConvertLead, findLeadCustomerMatches, resolveLeadCustomerChoice, isMissingLeadLinkColumn } from './leadConvert'

const src = (l) => leadToProjectSource(l).source

describe('chọn khách khi chuyển lead', () => {
  const customers = [
    { id: 1, kind: 'customer', phone: '0918.809.096', archived_at: '2026-01-01' },
    { id: 2, kind: 'customer', phone: '+84 918809096' },
    { id: 3, kind: 'supplier', phone: '0918809096' },
    { id: 4, kind: 'customer', phone: '0900000000' },
  ]
  it('chuẩn hóa phoneKey, giữ mọi khách trùng kể cả lưu trữ, bỏ NCC', () => {
    expect(findLeadCustomerMatches({ phone: '+840918-809-096' }, customers)).toEqual(customers.slice(0, 2))
  })
  it('không gộp điện thoại rỗng hoặc không hợp lệ', () => {
    for (const phone of [null, '', 'abc', '123', '(0918)809096']) {
      expect(findLeadCustomerMatches({ phone }, customers)).toEqual([])
    }
  })
  it('không chọn sẵn và không chấp nhận id ngoài danh sách', () => {
    expect(resolveLeadCustomerChoice(customers, '').ok).toBe(false)
    expect(resolveLeadCustomerChoice(customers, '99').ok).toBe(false)
    expect(resolveLeadCustomerChoice([], '1').ok).toBe(false)
  })
  it('dùng khách cũ chỉ khi chọn rõ; tạo mới dù có khách trùng', () => {
    expect(resolveLeadCustomerChoice(customers, '1')).toEqual({ ok: true, customerChoice: 'existing', customerId: 1 })
    expect(resolveLeadCustomerChoice(customers, 'new')).toEqual({ ok: true, customerChoice: 'new', customerId: null })
    expect(resolveLeadCustomerChoice([])).toEqual({ ok: true, customerChoice: 'auto', customerId: null })
  })
  it('fallback chỉ khi thiếu đúng cột site_lead_id', () => {
    expect(isMissingLeadLinkColumn({ code: '42703', message: 'column site_lead_id does not exist' })).toBe(true)
    expect(isMissingLeadLinkColumn({ code: 'PGRST204', message: 'site_lead_id schema cache' })).toBe(true)
    expect(isMissingLeadLinkColumn({ code: '42501', message: 'site_lead_id permission denied' })).toBe(false)
    expect(isMissingLeadLinkColumn({ code: '42703', message: 'lead_source missing' })).toBe(false)
  })
})

describe('leadToProjectSource', () => {
  it('Facebook/Instagram Ads', () => {
    expect(src({ utm_source: 'facebook' })).toBe('meta_ads')
    expect(src({ fbclid: 'abc' })).toBe('meta_ads')
    expect(leadToProjectSource({ fbclid: 'abc' }).reason).toMatch(/^Suy ra từ:/)
  })
  it('Messenger từ quảng cáo nhập tay', () => {
    expect(src({ created_via: 'manual', entry_source: 'Messenger từ quảng cáo' })).toBe('meta_ads')
  })
  it('TikTok Ads', () => expect(src({ utm_source: 'tiktok' })).toBe('tiktok_ads'))
  it('Google Ads và Google tự nhiên -> google_seo', () => {
    expect(src({ utm_source: 'google', utm_medium: 'cpc' })).toBe('google_seo')
    expect(src({ referrer: 'https://www.google.com/' })).toBe('google_seo')
  })
  it('heard_from Google tìm kiếm', () => expect(src({ heard_from: 'Google tìm kiếm' })).toBe('google_seo'))
  it('referral', () => {
    expect(src({ heard_from: 'Bạn bè, người thân giới thiệu' })).toBe('referral')
    expect(src({ heard_from: 'Đã từng dùng dịch vụ Đặng Wedding' })).toBe('referral')
    expect(src({ created_via: 'manual', entry_source: 'Giới thiệu' })).toBe('referral')
  })
  it('còn lại -> unknown', () => {
    expect(src({ heard_from: 'TikTok' })).toBe('unknown')
    expect(src({ heard_from: 'Facebook / Instagram' })).toBe('unknown')
    expect(src({ heard_from: 'Khác' })).toBe('unknown')
    expect(src({ created_via: 'manual', entry_source: 'Messenger tự nhiên' })).toBe('unknown')
    expect(src({ created_via: 'manual', entry_source: 'Zalo' })).toBe('unknown')
    expect(src({ created_via: 'manual', entry_source: 'Gọi điện' })).toBe('unknown')
    expect(src({ referrer: 'https://www.facebook.com/' })).toBe('unknown')
    expect(src({})).toBe('unknown')
    expect(src(null)).toBe('unknown')
    expect(leadToProjectSource({}).reason).toMatch(/^Suy ra từ:/)
  })
})

describe('leadToWarehouse', () => {
  it('theo khu vực', () => {
    expect(leadToWarehouse({ location: 'Long Khánh, Đồng Nai' })).toBe('xuan_loc')
    expect(leadToWarehouse({ location: 'Quận 7, HCM' })).toBe('vinh_loc')
    expect(leadToWarehouse({})).toBe('xuan_loc')
  })
  it('nguồn Ads ưu tiên', () => {
    expect(leadToWarehouse({ location: 'Long Khánh', note: '[Nguồn Ads: facebook / dw_vinhloc / a]' })).toBe('vinh_loc')
    expect(leadToWarehouse({ location: 'Quận 7', utm_campaign: 'dw_xuanloc_t11' })).toBe('xuan_loc')
  })
})

describe('canConvertLead', () => {
  it('new và consulting được', () => {
    expect(canConvertLead({ status: 'new' }).ok).toBe(true)
    expect(canConvertLead({ status: 'consulting' }).ok).toBe(true)
    expect(canConvertLead({ status: 'contacted' }).ok).toBe(true)
    expect(canConvertLead({ status: null }).ok).toBe(true)
  })
  it('trạng thái khác không được', () => {
    for (const s of ['quoted', 'deposited', 'completed', 'lost', 'converted', 'closed']) {
      const r = canConvertLead({ status: s })
      expect(r.ok).toBe(false)
      expect(r.reason).toBeTruthy()
    }
  })
  it('đã có dự án thì không', () => {
    const r = canConvertLead({ status: 'new', linkedProject: { id: 1, code: 'DA-2611-001' } })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('DA-2611-001')
  })
})
