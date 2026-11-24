import { describe, it, expect } from 'vitest'
import {
  parseNoteTags,
  getLeadAttribution,
  getLeadChannel,
  CHANNEL_FILTER_OPTIONS,
} from './leadSource'

describe('parseNoteTags', () => {
  it('note rỗng', () => {
    expect(parseNoteTags('')).toEqual({ heardFrom: '', adsSource: null })
    expect(parseNoteTags(null)).toEqual({ heardFrom: '', adsSource: null })
  })
  it('đọc đủ hai thẻ', () => {
    const r = parseNoteTags(
      'Cần gấp [Biết qua: TikTok] [Nguồn Ads: facebook / dw_gia_tien / album1]'
    )
    expect(r.heardFrom).toBe('TikTok')
    expect(r.adsSource).toEqual({
      raw: 'facebook / dw_gia_tien / album1',
      utm_source: 'facebook',
      utm_campaign: 'dw_gia_tien',
      utm_content: 'album1',
    })
  })
  it('thiếu chiến dịch/nội dung và fb_ads / facebook_click', () => {
    expect(parseNoteTags('[Nguồn Ads: google]').adsSource.utm_source).toBe('google')
    const r = parseNoteTags('[Nguồn Ads: fb_ads / facebook_click]').adsSource
    expect(r.utm_source).toBe('fb_ads')
    expect(r.utm_campaign).toBe('facebook_click')
    expect(r.utm_content).toBe('')
  })
})

describe('getLeadAttribution', () => {
  it('ưu tiên cột hơn thẻ', () => {
    const a = getLeadAttribution({
      utm_source: ' tiktok ',
      heard_from: 'Khác',
      note: '[Biết qua: TikTok] [Nguồn Ads: facebook / c1 / x1]',
    })
    expect(a.utm_source).toBe('tiktok')
    expect(a.heard_from).toBe('Khác')
    expect(a.utm_campaign).toBe('c1')
    expect(a.utm_content).toBe('x1')
  })
  it('lead cũ thiếu cột không lỗi', () => {
    const a = getLeadAttribution({ customer_name: 'A' })
    expect(a.utm_source).toBe('')
    expect(a.landing_path).toBe('')
    expect(getLeadAttribution(null).referrer).toBe('')
  })
  it('lấy heard_from từ note khi cột trống', () => {
    expect(
      getLeadAttribution({ heard_from: '', note: '[Biết qua: Google tìm kiếm]' }).heard_from
    ).toBe('Google tìm kiếm')
  })
})

describe('getLeadChannel', () => {
  const key = (l) => getLeadChannel(l).key
  it('meta ads theo utm_source đa dạng', () => {
    for (const s of ['facebook', 'FB', 'fb_ads', 'Instagram', 'ig', 'meta', ' Facebook ', 'fb-ads']) {
      expect(key({ utm_source: s })).toBe('meta_ads')
    }
    expect(getLeadChannel({ utm_source: 'facebook' }).label).toBe('Facebook / Instagram Ads')
  })
  it('có fbclid là meta ads', () => {
    expect(key({ fbclid: 'abc' })).toBe('meta_ads')
  })
  it('không khớp nhầm fb/ig trong chuỗi khác', () => {
    expect(key({ utm_source: 'webfb' })).toBe('unknown')
    expect(key({ utm_source: 'bigbang' })).toBe('unknown')
    expect(key({ utm_source: 'newsletter' })).toBe('unknown')
  })
  it('tiktok ads', () => {
    expect(key({ utm_source: 'TikTok' })).toBe('tiktok_ads')
  })
  it('google ads cần medium cpc', () => {
    expect(key({ utm_source: 'google', utm_medium: 'CPC' })).toBe('google_ads')
    expect(key({ utm_source: 'google', utm_medium: 'organic' })).toBe('unknown')
  })
  it('google tự nhiên theo referrer, không có UTM', () => {
    expect(key({ referrer: 'https://www.google.com/' })).toBe('google_organic')
    expect(key({ referrer: 'https://www.google.com/', utm_source: 'newsletter' })).toBe('unknown')
  })
  it('mạng xã hội tự nhiên', () => {
    expect(key({ referrer: 'https://l.facebook.com/' })).toBe('social_organic')
    expect(key({ referrer: 'https://zalo.me/x' })).toBe('social_organic')
    expect(key({ referrer: 'https://www.tiktok.com/' })).toBe('social_organic')
    expect(key({ referrer: 'https://instagram.com/' })).toBe('social_organic')
  })
  it('heard_from dùng nội dung khách chọn', () => {
    const c = getLeadChannel({ heard_from: 'Bạn bè, người thân giới thiệu' })
    expect(c.key).toBe('heard_from')
    expect(c.label).toBe('Bạn bè, người thân giới thiệu')
  })
  it('heard_from từ note', () => {
    expect(getLeadChannel({ note: 'x [Biết qua: Khác]' }).label).toBe('Khác')
  })
  it('nhập tay', () => {
    const c = getLeadChannel({ created_via: 'manual', entry_source: 'Zalo' })
    expect(c).toMatchObject({ key: 'manual', label: 'Nhập tay: Zalo' })
    expect(key({ created_via: 'manual' })).toBe('unknown')
    expect(key({ entry_source: 'Zalo' })).toBe('unknown')
  })
  it('thứ tự ưu tiên', () => {
    expect(
      key({ utm_source: 'facebook', referrer: 'https://google.com', heard_from: 'TikTok' })
    ).toBe('meta_ads')
    expect(key({ referrer: 'https://google.com', heard_from: 'TikTok' })).toBe('google_organic')
    expect(key({ heard_from: 'TikTok', created_via: 'manual', entry_source: 'Zalo' })).toBe(
      'heard_from'
    )
  })
  it('lead cũ và đầu vào lạ', () => {
    expect(getLeadChannel({}).label).toBe('Trực tiếp / không rõ nguồn')
    expect(key(null)).toBe('unknown')
  })
  it('đọc nguồn từ thẻ note khi thiếu cột', () => {
    expect(key({ note: '[Nguồn Ads: tiktok / c1]' })).toBe('tiktok_ads')
    expect(key({ note: '[Nguồn Ads: fb_ads / facebook_click]' })).toBe('meta_ads')
  })
})

describe('CHANNEL_FILTER_OPTIONS', () => {
  it('có all đầu tiên và key duy nhất', () => {
    expect(CHANNEL_FILTER_OPTIONS[0].key).toBe('all')
    const keys = CHANNEL_FILTER_OPTIONS.map((o) => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
