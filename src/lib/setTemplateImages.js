// Ảnh của mẫu set: thứ tự trong form sửa, kế hoạch ghi DB, chuyển ảnh (kể cả base64 cũ) sang File/Blob.
import { orderTemplateImages } from './setTemplates'

export const MAX_TEMPLATE_IMAGES = 12

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Danh sách ảnh trong form sửa. Phần tử đầu là ảnh bìa. kind: 'legacy' (image_url cũ, vd base64),
// 'existing' (dòng set_template_images), 'new' (vừa chọn, chưa tải lên).
export function buildEditorImages(template, rows) {
  const clean = (rows ?? []).filter((row) => trimText(row?.url))
  const byUrl = new Map()
  for (const row of clean) {
    const url = trimText(row.url)
    if (!byUrl.has(url)) byUrl.set(url, row)
  }
  return orderTemplateImages(template, clean).map((url) => {
    const row = byUrl.get(url)
    return row
      ? { key: `row-${row.id}`, kind: 'existing', id: row.id, url, storagePath: row.storage_path || null }
      : { key: 'legacy', kind: 'legacy', url }
  })
}

// orderTemplateImages luôn xếp ảnh cũ ngay sau ảnh bìa (hoặc đứng đầu nếu nó là bìa),
// nên form phải giữ đúng quy tắc đó để thứ tự lưu xong đọc lại không bị đảo.
export function normalizeEditorImages(list) {
  const legacy = list.find((image) => image.kind === 'legacy')
  if (!legacy) return list
  const others = list.filter((image) => image !== legacy)
  if (list[0] === legacy || others.length === 0) return [legacy, ...others]
  return [others[0], legacy, ...others.slice(1)]
}

export function moveEditorImage(list, index, delta) {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return normalizeEditorImages(next)
}

export function setEditorCover(list, index) {
  if (index <= 0 || index >= list.length) return list
  const next = [list[index], ...list.filter((_, i) => i !== index)]
  return normalizeEditorImages(next)
}

// Kế hoạch ghi: xóa dòng bị bỏ, cập nhật dòng còn lại, thêm dòng mới.
// Ảnh cũ (legacy) không có dòng trong bảng: nó là bìa khi đứng đầu và không có dòng nào is_cover.
export function planImageSave(list, existingRows) {
  const keptIds = new Set(list.filter((image) => image.kind === 'existing').map((image) => image.id))
  const deleteRows = (existingRows ?? []).filter((row) => !keptIds.has(row.id))
  const updates = []
  const adds = []
  list.forEach((image, index) => {
    if (image.kind === 'legacy') return
    const entry = { sort_order: index, is_cover: index === 0 }
    if (image.kind === 'existing') updates.push({ id: image.id, ...entry })
    else adds.push({ image, ...entry })
  })
  return { deleteRows, updates, adds, hasLegacy: list.some((image) => image.kind === 'legacy') }
}

export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl || '')
  if (!match) throw new Error('Ảnh không hợp lệ.')
  const mime = match[1] || 'application/octet-stream'
  const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export function mimeToExt(mime) {
  if (/webp/i.test(mime)) return 'webp'
  if (/png/i.test(mime)) return 'png'
  return 'jpg'
}

export function safeFileBase(name) {
  const base = String(name || 'mau-set')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'mau-set'
}

// Tải ảnh (URL công khai hoặc base64 cũ) thành File để chia sẻ / tải về.
export async function imageUrlToFile(url, baseName, index) {
  let blob
  if (String(url).startsWith('data:')) {
    blob = dataUrlToBlob(url)
  } else {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) throw new Error(`Không tải được ảnh (HTTP ${response.status}).`)
    blob = await response.blob()
  }
  const type = blob.type || 'image/jpeg'
  return new File([blob], `${safeFileBase(baseName)}-${index + 1}.${mimeToExt(type)}`, { type })
}
