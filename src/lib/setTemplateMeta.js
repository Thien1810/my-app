// Siêu dữ liệu mẫu set: loại set (category là text), tương thích khi DB chưa có cột, nhận diện lỗi thiếu schema.
import {
  PRESET_SET_CATEGORIES,
  categoryKey,
  normalizeCategoryName,
} from './setTemplates'

export const NEW_CATEGORY = '__new__'
export const MAX_CATEGORY_LENGTH = 40

const PRESET_STYLE = {
  'gia tien': { icon: '🏮', variant: 'success' },
  'ngoai gia tien': { icon: '🌿', variant: 'accent' },
  'mam qua': { icon: '🎁', variant: 'info' },
}

export function categoryIcon(category) {
  return PRESET_STYLE[categoryKey(category)]?.icon || '✨'
}

export function categoryBadgeVariant(category) {
  return PRESET_STYLE[categoryKey(category)]?.variant || 'neutral'
}

// ProjectQuoteTab vẫn dùng danh sách loại cố định này để lọc và chọn loại cho dòng báo giá.
export const SET_CATEGORY_OPTIONS = PRESET_SET_CATEGORIES.map((value) => ({
  value,
  label: `${categoryIcon(value)} ${value}`,
  badgeClass: `ui-badge--${categoryBadgeVariant(value)}`,
}))

// Hỗ trợ đọc/ghi tương thích ngay cả khi database chưa chạy ALTER TABLE thêm cột category, image_url
const META_PREFIX = '__SETMETA__'
const META_SUFFIX = '__ENDMETA__'

export function parseTemplateMeta(tpl) {
  if (!tpl) return { category: 'Gia tiên', image_url: '', cleanNote: '' }
  let category = tpl.category || ''
  let image_url = tpl.image_url || ''
  let cleanNote = tpl.note || ''

  if (cleanNote.startsWith(META_PREFIX)) {
    const endIdx = cleanNote.indexOf(META_SUFFIX)
    if (endIdx !== -1) {
      const jsonStr = cleanNote.slice(META_PREFIX.length, endIdx)
      cleanNote = cleanNote.slice(endIdx + META_SUFFIX.length).trim()
      try {
        const parsed = JSON.parse(jsonStr)
        if (!category && parsed.category) category = parsed.category
        if (!image_url && parsed.image_url) image_url = parsed.image_url
      } catch {
        // ignore parse errors
      }
    }
  }

  return {
    category: normalizeCategoryName(category) || 'Gia tiên',
    image_url: image_url || '',
    cleanNote,
  }
}

export function packTemplateNoteFallback(category, image_url, cleanNote) {
  const meta = JSON.stringify({
    category: category || 'Gia tiên',
    image_url: image_url || '',
  })
  const noteText = (cleanNote || '').trim()
  return `${META_PREFIX}${meta}${META_SUFFIX}${noteText ? ' ' + noteText : ''}`
}

// Đưa loại về đúng cách viết của danh sách (chống trùng theo categoryKey).
export function canonicalCategory(category, options) {
  const key = categoryKey(category)
  return (options || []).find((option) => categoryKey(option) === key) || normalizeCategoryName(category)
}

// Kết quả chọn loại trong form: { category, error }. choice = tên loại có sẵn hoặc NEW_CATEGORY.
export function resolveCategoryChoice(choice, newName, options) {
  if (choice !== NEW_CATEGORY) {
    const category = canonicalCategory(choice, options) || PRESET_SET_CATEGORIES[0]
    return { category, error: '' }
  }
  const name = normalizeCategoryName(newName)
  if (!name) return { category: '', error: 'Hãy nhập tên loại mới.' }
  if (name.length > MAX_CATEGORY_LENGTH) {
    return { category: '', error: `Tên loại quá dài (tối đa ${MAX_CATEGORY_LENGTH} ký tự).` }
  }
  const match = (options || []).find((option) => categoryKey(option) === categoryKey(name))
  return { category: match || name, error: '', duplicateOf: match || '' }
}

// ----- Nhận diện lỗi khi DB chưa chạy supabase/set_templates_v2.sql -----
function errorText(error) {
  return `${error?.code || ''} ${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase()
}

// Bảng set_template_images chưa có (42P01 / PGRST205), hoặc quan hệ nhúng không tìm thấy (PGRST200).
export function isMissingImagesSchema(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  return code === 'PGRST200' && errorText(error).includes('set_template_images')
}

// Cột description chưa có (42703 / PGRST204).
export function isMissingDescriptionColumn(error) {
  if (!error) return false
  const code = String(error.code || '')
  return (code === '42703' || code === 'PGRST204') && errorText(error).includes('description')
}
