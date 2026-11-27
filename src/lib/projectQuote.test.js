import { describe, it, expect } from 'vitest'
import {
  templateImageMap,
  normalizeQuoteLine,
  resolveLineImage,
  serializeQuote,
  deserializeQuote,
  quoteDataBytes,
  parseLocalQuote,
  initialQuoteSource,
  isEmptyQuote,
  buildQuoteDraft,
  parseQuoteDraft,
  draftDecision,
} from './projectQuote'

describe('bản nháp chưa lưu', () => {
  it('khứ hồi qua JSON', () => {
    const d = buildQuoteDraft({ lines: [{ uid: 'a' }], quoteNote: 'x' }, '2026-11-27T01:02:03.123456+00:00', '2026-11-27T01:05:00Z')
    const back = parseQuoteDraft(JSON.stringify(d))
    expect(back).toMatchObject({ baseUpdatedAt: '2026-11-27T01:02:03.123456+00:00', quoteNote: 'x' })
    expect(parseQuoteDraft('{hỏng')).toBeNull()
    expect(parseQuoteDraft(JSON.stringify({ v: 2, lines: [] }))).toBeNull()
  })
  it('chỉ tự khôi phục khi nháp dựa đúng bản DB hiện tại', () => {
    const draft = { baseUpdatedAt: '2026-11-27T01:02:03.000Z', lines: [] }
    expect(draftDecision({ draft: null, dbRow: null })).toBe('none')
    expect(draftDecision({ draft, dbRow: { updated_at: '2026-11-27T01:02:03+00:00' } })).toBe('restore')
    expect(draftDecision({ draft, dbRow: { updated_at: '2026-11-27T09:00:00+00:00' } })).toBe('stale')
    expect(draftDecision({ draft: { baseUpdatedAt: null, lines: [] }, dbRow: null })).toBe('restore')
    expect(draftDecision({ draft: { baseUpdatedAt: null, lines: [] }, dbRow: { updated_at: 'x' } })).toBe('stale')
    expect(draftDecision({ draft, dbRow: null })).toBe('stale')
  })
})

const templates = [
  { id: 1, name: 'Gia tiên A', image_url: 'https://cdn/a.jpg' },
  { id: 2, name: 'Mâm quả B', image_url: '' },
]
const imgs = templateImageMap(templates)

describe('ảnh mẫu set chỉ lưu tham chiếu', () => {
  it('dòng cũ có ảnh trùng ảnh mẫu -> template, bỏ image_url', () => {
    const l = normalizeQuoteLine({ uid: 'u1', template_id: 1, name: 'A', image_url: 'https://cdn/a.jpg', qty: 2 }, imgs)
    expect(l.image_source).toBe('template')
    expect(l.image_url).toBe('')
    expect(resolveLineImage(l, imgs)).toBe('https://cdn/a.jpg')
  })
  it('ảnh tự tải lên giữ trong dữ liệu', () => {
    const l = normalizeQuoteLine({ uid: 'u2', template_id: 1, image_url: 'data:image/webp;base64,AAA' }, imgs)
    expect(l.image_source).toBe('custom')
    expect(resolveLineImage(l, imgs)).toBe('data:image/webp;base64,AAA')
  })
  it('dòng tự thêm không ảnh -> none; mẫu đã bị xóa mà còn ảnh -> custom', () => {
    expect(normalizeQuoteLine({ uid: 'u3', template_id: null }, imgs).image_source).toBe('none')
    expect(normalizeQuoteLine({ uid: 'u4', template_id: 99, image_url: 'https://x/y.jpg' }, imgs).image_source).toBe('custom')
  })
  it('qty sai -> 1', () => {
    expect(normalizeQuoteLine({ uid: 'u5', qty: -3 }, imgs).qty).toBe(1)
  })
})

describe('serialize / deserialize', () => {
  it('khứ hồi giữ dữ liệu, không có số lượng vật tư hay giá', () => {
    const q = { lines: [{ uid: 'a', template_id: 1, name: 'A', category: 'Gia tiên', qty: 1, note: 'Gồm: hoa', image_url: 'https://cdn/a.jpg' }], quoteNote: 'Trọn gói' }
    const data = serializeQuote(q, imgs)
    expect(data.version).toBe(1)
    expect(JSON.stringify(data)).not.toMatch(/cost|contract|discount|https:\/\/cdn/)
    const back = deserializeQuote(data, imgs)
    expect(back.quoteNote).toBe('Trọn gói')
    expect(back.lines[0]).toMatchObject({ uid: 'a', template_id: 1, image_source: 'template' })
  })
  it('data rỗng / hỏng', () => {
    expect(deserializeQuote(null, imgs)).toEqual({ lines: [], quoteNote: '' })
  })
  it('đếm byte UTF-8', () => {
    expect(quoteDataBytes({ a: 'ệ' })).toBeGreaterThan(JSON.stringify({ a: 'ệ' }).length)
  })
})

describe('bản cũ trong localStorage', () => {
  it('đọc được, trống thì null, hỏng thì null', () => {
    expect(parseLocalQuote(JSON.stringify({ lines: [{ uid: 'a' }], quoteNote: '', updatedAt: '2026-11-20T00:00:00Z' }))?.updatedAt).toBe('2026-11-20T00:00:00Z')
    expect(parseLocalQuote(JSON.stringify({ lines: [], quoteNote: ' ' }))).toBeNull()
    expect(parseLocalQuote('{hỏng')).toBeNull()
    expect(parseLocalQuote(null)).toBeNull()
  })
  it('DB có bản thì luôn dùng DB, không ghi đè', () => {
    expect(initialQuoteSource({ dbRow: { data: {} }, local: { lines: [{}], quoteNote: '' } })).toBe('db')
    expect(initialQuoteSource({ dbRow: null, local: { lines: [{}], quoteNote: '' } })).toBe('offer_local')
    expect(initialQuoteSource({ dbRow: null, local: null })).toBe('empty')
  })
  it('isEmptyQuote', () => {
    expect(isEmptyQuote({ lines: [], quoteNote: '' })).toBe(true)
    expect(isEmptyQuote({ lines: [], quoteNote: 'x' })).toBe(false)
  })
})
