import { describe, expect, it } from 'vitest'
import {
  CARD_PAD,
  CARD_WIDTH,
  MAX_CARD_IMAGES,
  TEXT_STYLE,
  coverCrop,
  extractCardDescription,
  gridColumns,
  layoutImages,
  layoutText,
  wrapText,
  buildContactLines,
} from './setTemplateCard'
import { buildShareText } from './setTemplates'

// Mỗi ký tự rộng 10px
const measure = (text) => text.length * 10

describe('wrapText', () => {
  it('ngắt dòng theo độ rộng và giữ nguyên xuống dòng của người dùng', () => {
    expect(wrapText(measure, 'aaa bbb ccc', 70)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapText(measure, 'aa bb\n\ncc dd', 100)).toEqual(['aa bb', '', 'cc dd'])
    expect(wrapText(measure, '', 100)).toEqual([])
    expect(wrapText(measure, null, 100)).toEqual([])
  })

  it('bẻ từ quá dài và cắt bằng "…" khi quá số dòng', () => {
    expect(wrapText(measure, 'abcdefghij', 40)).toEqual(['abcd', 'efgh', 'ij'])
    const lines = wrapText(measure, 'aaa bbb ccc ddd eee', 40, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(lines.every((line) => measure(line) <= 40)).toBe(true)
    expect(wrapText(measure, 'aaa bbb', 100, 1)).toEqual(['aaa bbb'])
  })
})

describe('bố cục ảnh thẻ', () => {
  it('cắt ảnh kiểu cover và căn giữa', () => {
    const wide = coverCrop(2000, 1000, 400, 300)
    expect(wide.sx).toBeCloseTo(1000 / 3)
    expect(wide.sw).toBeCloseTo(4000 / 3)
    expect([wide.sy, wide.sh]).toEqual([0, 1000])
    expect(coverCrop(1000, 2000, 400, 300)).toEqual({ sx: 0, sy: 625, sw: 1000, sh: 750 })
  })

  it('ảnh bìa 4:3 tràn ngang, ảnh còn lại là lưới 2-3 cột, tối đa 9 ảnh', () => {
    expect(layoutImages({ count: 0 })).toEqual({ cover: null, cells: [], bottom: 0 })
    const one = layoutImages({ count: 1 })
    expect(one.cover).toEqual({ x: 0, y: 0, w: CARD_WIDTH, h: 810 })
    expect(one.bottom).toBe(810)

    expect(gridColumns(4)).toBe(2)
    expect(gridColumns(5)).toBe(3)
    const five = layoutImages({ count: 5 })
    expect(five.cells).toHaveLength(4)
    expect(five.cells[0].size).toBe(Math.floor((CARD_WIDTH - 2 * CARD_PAD - 12) / 2))

    const many = layoutImages({ count: 50 })
    expect(many.cells).toHaveLength(MAX_CARD_IMAGES - 1)
    const right = Math.max(...many.cells.map((c) => c.x + c.size))
    expect(right).toBeLessThanOrEqual(CARD_WIDTH - CARD_PAD)
    expect(many.bottom).toBeGreaterThan(many.cover.h)
  })

  it('khối chữ cao hơn khi có thêm dòng và nằm dưới ảnh', () => {
    const short = layoutText({ top: 810, titleLineCount: 1, descLineCount: 2 })
    const long = layoutText({ top: 810, titleLineCount: 3, descLineCount: 7 })
    expect(short.titleY).toBeGreaterThan(810)
    expect(long.height - short.height).toBe(2 * TEXT_STYLE.titleLine + 5 * TEXT_STYLE.descLine)
    expect(layoutText({ top: 0, titleLineCount: 1, descLineCount: 0, hasCategory: false }).pillY).toBeNull()
  })
})

describe('liên hệ ở chân thẻ', () => {
  it('bỏ dòng trống, SĐT in đậm và đứng đầu', () => {
    expect(buildContactLines({ phone: ' 0918.80.90.96 ', address: '', website: 'dangwed.com' })).toEqual([
      { text: 'SĐT / Zalo: 0918.80.90.96', strong: true },
      { text: 'dangwed.com' },
    ])
    expect(buildContactLines(null)).toEqual([])
  })

  it('chân thẻ cao thêm theo số dòng liên hệ', () => {
    const base = { top: 810, titleLineCount: 1, descLineCount: 1 }
    const none = layoutText(base)
    const four = layoutText({ ...base, contactLineCount: 4 })
    expect(four.height - none.height).toBe(60 + 4 * TEXT_STYLE.contactLine - TEXT_STYLE.footerHeight)
  })
})

describe('extractCardDescription', () => {
  it('chỉ giữ phần mô tả, bỏ tên, hạng mục và câu kết', () => {
    const text = buildShareText({ name: 'Mẫu Hồng', category: 'Mâm quả', description: 'Sắc hồng dịu nhẹ.' })
    expect(extractCardDescription(text, { name: 'Mẫu Hồng', category: 'Mâm quả' })).toBe('Sắc hồng dịu nhẹ.')
    expect(extractCardDescription('Mẫu Hồng\n\nHạng mục: Mâm quả', { name: 'Mẫu Hồng', category: 'Mâm quả' })).toBe('')
  })
})
