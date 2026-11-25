export const PRESET_SET_CATEGORIES = Object.freeze(['Gia tiên', 'Ngoài gia tiên', 'Mâm quả'])

const MAX_DESCRIPTION_LENGTH = 400
const MAX_ITEM_NAMES = 12
const SHARE_SIGNOFF = 'Đặng Wedding — nhắn em để được tư vấn thêm nhé.'

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeCategoryName(value) {
  return trimText(value).replace(/\s+/g, ' ')
}

export function categoryKey(value) {
  return normalizeCategoryName(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
}

export function buildCategoryOptions(templates) {
  const seen = new Set(PRESET_SET_CATEGORIES.map(categoryKey))
  const extras = []

  for (const template of templates ?? []) {
    const category = normalizeCategoryName(template?.category)
    const key = categoryKey(category)
    if (!key || seen.has(key)) continue
    seen.add(key)
    extras.push(category)
  }

  return [...PRESET_SET_CATEGORIES, ...extras.sort((a, b) => a.localeCompare(b, 'vi'))]
}

export function orderTemplateImages(template, images) {
  const legacyUrl = trimText(template?.image_url)
  const gallery = []

  for (const image of images ?? []) {
    const url = trimText(image?.url)
    if (!url) continue

    // Nếu có nhiều ảnh bìa, xếp chúng theo sort_order rồi theo thứ tự đầu vào.
    const isCover = image.is_cover === true || url === legacyUrl
    const sortOrder = image.sort_order ?? 0
    gallery.push({ url, isCover, sortOrder })
  }

  if (legacyUrl && !gallery.some(({ url }) => url === legacyUrl)) {
    // Ảnh cũ chưa có trong thư viện đứng sau các ảnh bìa đã có thứ tự.
    gallery.push({ url: legacyUrl, isCover: true, sortOrder: Infinity })
  }

  gallery.sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder)
  return [...new Set(gallery.map(({ url }) => url))]
}

export function buildShareText(template) {
  const { name, category, description } = template ?? {}
  return [
    normalizeCategoryName(name),
    `Hạng mục: ${normalizeCategoryName(category) || PRESET_SET_CATEGORIES[0]}`,
    trimText(description),
    SHARE_SIGNOFF,
  ].filter(Boolean).join('\n\n')
}

// Quy tắc viết mô tả. api/ai-seo.js (mode set_description) dùng đúng các dòng này; có test đối chiếu hai bên.
export const DESCRIPTION_RULES = Object.freeze([
  'Viết 2–3 câu, dài khoảng 180–320 ký tự và tối đa 380 ký tự, dùng tối đa 1 emoji.',
  'Giọng ấm áp, trang nhã, mang văn hóa cưới hỏi Việt Nam (gia tiên, sum vầy hai họ, khoảnh khắc lên hình); gọi "cô dâu chú rể" và "hai bên gia đình".',
  'Không xưng "chúng tôi" hay "shop", không gọi "quý khách"; tránh từ sáo rỗng như "đẳng cấp", "siêu phẩm", "hoàn hảo tuyệt đối".',
  'Chỉ chọn điểm nhấn thẩm mỹ (tông màu, hoa, phông rèm, chữ Hỷ, ánh sáng, bàn họ, mâm quả); bỏ qua vật tư kỹ thuật như khung sắt, formex, băng keo, dây rút, chân đế, ổ điện.',
  'Không bịa hạng mục ngoài danh sách tên vật tư được cung cấp.',
  'Tuyệt đối không nêu số lượng hay định mức, kể cả con số có trong tên vật tư.',
  'Không dùng các từ giá, báo giá, chi phí, tiết kiệm, ưu đãi.',
  'Không viết câu kêu gọi liên hệ ở cuối.',
])

export function buildDescriptionPrompt(template) {
  const { name, category, itemNames } = template ?? {}
  const names = new Map()

  for (const value of Array.isArray(itemNames) ? itemNames : []) {
    const itemName = normalizeCategoryName(value)
    const key = categoryKey(itemName)
    if (!key || names.has(key)) continue
    names.set(key, itemName)
    if (names.size === MAX_ITEM_NAMES) break
  }

  return [
    'Viết mô tả bằng tiếng Việt cho mẫu set trang trí cưới hỏi.',
    ...DESCRIPTION_RULES.map((rule) => `- ${rule}`),
    `Tên mẫu: ${normalizeCategoryName(name) || 'Chưa đặt tên'}`,
    `Hạng mục: ${normalizeCategoryName(category) || PRESET_SET_CATEGORIES[0]}`,
    `Tên vật tư: ${[...names.values()].join(', ') || 'Không có'}`,
  ].join('\n')
}

// Câu nêu số lượng vật tư hiển nhiên (vd "12 bộ đèn", "2 mâm") bị loại khỏi mô tả.
const QUANTITY_SENTENCE = /\d+(?:[.,]\d+)?\s*(?:bộ|chiếc|cái|cặp|đôi|mâm|bình|lọ|cây|bó|giỏ|món|set|mét|m2|m²)(?!\p{L})/iu

function dropQuantitySentences(description) {
  const sentences = description.split(/(?<=[.!?…])\s+/u)
  const kept = sentences.filter((sentence) => !QUANTITY_SENTENCE.test(sentence))
  return kept.length > 0 && kept.length < sentences.length ? kept.join(' ') : description
}

export function sanitizeDescription(text) {
  let description = trimText(text)
    .replace(/\*\*/g, '')
    .replace(/^[^\S\r\n]*(?:#+[^\S\r\n]*|-(?:[^\S\r\n]+|$))/gm, '')
    .trim()
  description = dropQuantitySentences(description)
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description

  // Xét thêm một ký tự để nhận biết ranh giới ngay sau ký tự thứ 400.
  const preview = description.slice(0, MAX_DESCRIPTION_LENGTH + 1)
  const sentences = [...preview.matchAll(/[.!?…]+["”’)]*(?=\s)/gu)]
  const lastSentence = sentences.at(-1)
  if (lastSentence) return preview.slice(0, lastSentence.index + lastSentence[0].length).trimEnd()

  const lastSpace = preview.search(/\s\S*$/u)
  if (lastSpace > 0) return preview.slice(0, lastSpace).trimEnd()

  // Chuỗi một từ quá dài vẫn phải nằm trong giới hạn, kể cả khi chứa emoji.
  return preview.slice(0, MAX_DESCRIPTION_LENGTH).replace(/[\uD800-\uDBFF]$/u, '')
}
