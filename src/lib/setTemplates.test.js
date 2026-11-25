import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PRESET_SET_CATEGORIES,
  buildCategoryOptions,
  DESCRIPTION_RULES,
  buildDescriptionPrompt,
  buildShareText,
  categoryKey,
  normalizeCategoryName,
  orderTemplateImages,
  sanitizeDescription,
} from './setTemplates'

describe('nhóm mẫu set', () => {
  it('giữ dấu khi hiển thị và quy đ về d khi tạo khóa bỏ dấu', () => {
    expect(normalizeCategoryName('  Đám\t hỏi\n mùa thu ')).toBe('Đám hỏi mùa thu')
    expect(categoryKey('  ĐÁM HỎI ')).toBe('dam hoi')
    expect(categoryKey('dam hoi')).toBe('dam hoi')
    expect(normalizeCategoryName(null)).toBe('')
    expect(categoryKey(' \t ')).toBe('')
  })

  it('giữ tên nhóm mặc định và sắp xếp các nhóm mới theo tiếng Việt', () => {
    const templates = Object.freeze([
      Object.freeze({ category: ' đón   khách' }),
      Object.freeze({ category: 'GIA TIEN' }),
      Object.freeze({ category: 'Dạm ngõ' }),
      Object.freeze({ category: 'am-anh' }),
      Object.freeze({ category: 'đon khach' }),
      Object.freeze({ category: 'MÂM QUẢ' }),
      Object.freeze({ category: null }),
      Object.freeze({ category: ' ' }),
    ])

    expect(buildCategoryOptions(templates)).toEqual([
      'Gia tiên', 'Ngoài gia tiên', 'Mâm quả', 'am-anh', 'Dạm ngõ', 'đón khách',
    ])
    expect(buildCategoryOptions()).toEqual(PRESET_SET_CATEGORIES)
  })
})

describe('orderTemplateImages', () => {
  it('xếp ảnh bìa và ảnh cũ lên trước theo thứ tự, bỏ URL trùng', () => {
    const template = Object.freeze({ image_url: ' /legacy.jpg  ' })
    const images = Object.freeze([
      Object.freeze({ url: ' /detail-b.jpg ', sort_order: 4 }),
      Object.freeze({ url: '/cover-b.jpg', is_cover: true, sort_order: 3 }),
      Object.freeze({ url: '/detail-a.jpg', sort_order: 1 }),
      Object.freeze({ url: '/detail-c.jpg', sort_order: 1 }),
      Object.freeze({ url: '/cover-a.jpg', is_cover: true, sort_order: 2 }),
      Object.freeze({ url: ' /cover-a.jpg ', sort_order: -2 }),
      Object.freeze({ url: ' ', is_cover: true, sort_order: 0 }),
      Object.freeze({ url: '/legacy.jpg', sort_order: 1 }),
    ])

    expect(orderTemplateImages(template, images)).toEqual([
      '/legacy.jpg', '/cover-a.jpg', '/cover-b.jpg', '/detail-a.jpg', '/detail-c.jpg', '/detail-b.jpg',
    ])
    expect(images[0].url).toBe(' /detail-b.jpg ')
  })

  it('bổ sung ảnh cũ khi chưa có trong danh sách và xử lý dữ liệu rỗng', () => {
    const template = { image_url: '/legacy.jpg' }
    const gallery = [{ url: '/gallery.jpg', sort_order: 0 }]

    expect(orderTemplateImages(template, gallery)).toEqual(['/legacy.jpg', '/gallery.jpg'])
    expect(orderTemplateImages(template)).toEqual(['/legacy.jpg'])
    expect(orderTemplateImages(null, [null, { url: '' }])).toEqual([])
  })
})

describe('buildShareText', () => {
  it('chỉ đọc tên, hạng mục và mô tả để tạo tin nhắn cho khách', () => {
    const template = Object.freeze({
      name: '  Mẫu   Hồng  ',
      category: ' Mâm quả ',
      description: '  Sắc hồng dịu nhẹ.  ',
      get items() { throw new Error('Đã đọc danh sách vật tư') },
      get quantity() { throw new Error('Đã đọc số lượng') },
      get cost() { throw new Error('Đã đọc chi phí') },
      get price() { throw new Error('Đã đọc giá') },
    })

    expect(buildShareText(template)).toBe([
      'Mẫu Hồng',
      'Hạng mục: Mâm quả',
      'Sắc hồng dịu nhẹ.',
      'Đặng Wedding — nhắn em để được tư vấn thêm nhé.',
    ].join('\n\n'))
  })

  it('dùng Gia tiên khi thiếu hạng mục và bỏ các đoạn rỗng', () => {
    expect(buildShareText({ name: 'Mẫu lụa', category: null, description: '  ' })).toBe(
      'Mẫu lụa\n\nHạng mục: Gia tiên\n\nĐặng Wedding — nhắn em để được tư vấn thêm nhé.',
    )
  })
})

describe('buildDescriptionPrompt', () => {
  it('đưa tối đa 12 tên vật tư duy nhất và bỏ đối tượng cùng thông tin nội bộ', () => {
    const itemNames = Object.freeze([
      '  Đèn\t lồng ', 'den long', '', null,
      Object.freeze({ name: 'Vật tư nội bộ', quantity: 9, price: 123456 }),
      ...Array.from({ length: 12 }, (_, index) => `Hoa ${index + 1}`),
    ])
    const template = Object.freeze({ name: 'Mẫu lụa', category: '', itemNames, cost: 'CHI PHÍ NỘI BỘ' })
    const prompt = buildDescriptionPrompt(template)

    expect(prompt.split('\n').at(-1)).toBe(
      'Tên vật tư: Đèn lồng, Hoa 1, Hoa 2, Hoa 3, Hoa 4, Hoa 5, Hoa 6, Hoa 7, Hoa 8, Hoa 9, Hoa 10, Hoa 11',
    )
    for (const rule of DESCRIPTION_RULES) expect(prompt).toContain(rule)
    expect(prompt).toContain('2–3 câu')
    expect(prompt).toContain('tối đa 1 emoji')
    expect(prompt).toContain('tối đa 380 ký tự')
    expect(prompt).toContain('Không xưng "chúng tôi"')
    expect(prompt).toContain('Không bịa hạng mục ngoài danh sách tên vật tư')
    expect(prompt).toContain('Tuyệt đối không nêu số lượng hay định mức')
    expect(prompt).not.toMatch(/Vật tư nội bộ|123456|CHI PHÍ NỘI BỘ/)
  })

  it('xử lý khi thiếu danh sách tên vật tư', () => {
    expect(buildDescriptionPrompt()).toContain('Tên vật tư: Không có')
  })
})

describe('quy tắc mô tả dùng chung với máy chủ', () => {
  it('api/ai-seo.js dùng đúng các dòng quy tắc của DESCRIPTION_RULES', () => {
    const api = readFileSync(new URL('../../api/ai-seo.js', import.meta.url), 'utf8')
    for (const rule of DESCRIPTION_RULES) expect(api).toContain(rule)
  })
})

describe('sanitizeDescription', () => {
  it('loại câu nêu số lượng vật tư hiển nhiên nhưng không xóa sạch mô tả', () => {
    expect(sanitizeDescription('Tông kem dịu nhẹ. Gồm 12 bộ đèn lồng. Hai họ sum vầy.')).toBe(
      'Tông kem dịu nhẹ. Hai họ sum vầy.',
    )
    expect(sanitizeDescription('Gồm 2 mâm quả.')).toBe('Gồm 2 mâm quả.')
  })

  it('bỏ cú pháp tiêu đề, in đậm và danh sách, giữ gạch nối trong câu', () => {
    expect(sanitizeDescription('  ## **Mẫu cưới**\n  - Tông trắng - kem\n- Hoa hồng.  ')).toBe(
      'Mẫu cưới\nTông trắng - kem\nHoa hồng.',
    )
    expect(sanitizeDescription(' **  ')).toBe('')
    expect(sanitizeDescription(null)).toBe('')
  })

  it('giữ mô tả vừa đủ 400 ký tự và ưu tiên cắt sau câu hoàn chỉnh', () => {
    const exact = `${'a'.repeat(399)}!`
    expect(sanitizeDescription(exact)).toBe(exact)
    expect(sanitizeDescription(`${exact} Câu tiếp theo.`)).toBe(exact)
    expect(sanitizeDescription(`“Tông kem nhẹ nhàng!” ${'Một đoạn chưa kết thúc '.repeat(25)}`)).toBe(
      '“Tông kem nhẹ nhàng!”',
    )
  })

  it('cắt theo ranh giới từ khi chưa có câu hoàn chỉnh', () => {
    expect(sanitizeDescription(`Mẫu lụa ${'x'.repeat(400)}`)).toBe('Mẫu lụa')
    expect(sanitizeDescription(`${'x'.repeat(400)} yyy`)).toBe('x'.repeat(400))
  })

  it('giới hạn một từ quá dài và giữ nguyên cặp mã của emoji', () => {
    expect(sanitizeDescription('x'.repeat(401))).toBe('x'.repeat(400))
    expect(sanitizeDescription(`x${'🌸'.repeat(200)}`)).toBe(`x${'🌸'.repeat(199)}`)
  })
})
