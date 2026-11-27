// Báo giá dự án lưu ở bảng project_quotes (hàm thuần, không import supabase).
// data = { version: 1, quoteNote, lines: [{ uid, template_id, name, category, qty, note, image_source, image_url }] }
// - Không chứa số lượng từng vật tư, giá vốn, giá trị HĐ, ưu đãi (giá trị HĐ/ưu đãi ở project_finance).
// - Ảnh mẫu set chỉ lưu tham chiếu (image_source 'template', image_url ''); ảnh tự tải lên ('custom')
//   mới nằm trong data. Trần 4 MB khớp trigger project_quotes_before_write.
import { parseTemplateMeta } from './setTemplateMeta'

export const QUOTE_DATA_VERSION = 1
export const QUOTE_MAX_BYTES = 4 * 1024 * 1024
export const quoteStorageKey = (projectId) => `dw_quote_project_${projectId}`

export function templateImageMap(templates) {
  const map = new Map()
  for (const t of templates || []) map.set(Number(t.id), parseTemplateMeta(t).image_url || '')
  return map
}

// Đưa dòng (kể cả dòng cũ từ localStorage chưa có image_source) về dạng chuẩn.
// Dòng có mẫu set mà ảnh trùng ảnh mẫu (hoặc trống) -> tham chiếu mẫu.
export function normalizeQuoteLine(line, imageMap) {
  const l = line || {}
  const templateId = l.template_id == null || l.template_id === '' ? null : Number(l.template_id)
  const tplImage = templateId != null && imageMap?.has(templateId) ? imageMap.get(templateId) : null
  let source = l.image_source
  let image = typeof l.image_url === 'string' ? l.image_url : ''
  if (!['template', 'custom', 'none'].includes(source)) {
    if (templateId != null && tplImage != null && (!image || image === tplImage)) source = 'template'
    else source = image ? 'custom' : 'none'
  }
  if (source === 'template') image = ''
  if (source === 'none') image = ''
  const qty = Number(l.qty)
  return {
    uid: String(l.uid || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    template_id: templateId,
    name: String(l.name || ''),
    category: String(l.category || 'Gia tiên'),
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    note: String(l.note || ''),
    image_source: source,
    image_url: image,
  }
}

// Ảnh hiển thị/xuất của dòng.
export function resolveLineImage(line, imageMap) {
  if (line?.image_source === 'template') {
    return (line.template_id != null && imageMap?.get(Number(line.template_id))) || ''
  }
  return line?.image_url || ''
}

export function serializeQuote({ lines, quoteNote }, imageMap) {
  return {
    version: QUOTE_DATA_VERSION,
    quoteNote: String(quoteNote || ''),
    lines: (lines || []).map((l) => normalizeQuoteLine(l, imageMap)),
  }
}

export function deserializeQuote(data, imageMap) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    lines: Array.isArray(d.lines) ? d.lines.map((l) => normalizeQuoteLine(l, imageMap)) : [],
    quoteNote: typeof d.quoteNote === 'string' ? d.quoteNote : '',
  }
}

export function quoteDataBytes(data) {
  const s = JSON.stringify(data ?? {})
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length
}

export function isEmptyQuote(q) {
  return !q || ((q.lines || []).length === 0 && !String(q.quoteNote || '').trim())
}

// Đọc bản lưu cũ trong localStorage; null nếu không có / hỏng / trống.
export function parseLocalQuote(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const q = {
      lines: Array.isArray(parsed?.lines) ? parsed.lines : [],
      quoteNote: typeof parsed?.quoteNote === 'string' ? parsed.quoteNote : '',
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
    }
    return isEmptyQuote(q) ? null : q
  } catch {
    return null
  }
}

// Quyết định khi mở tab: DB là nguồn chính, không bao giờ ghi đè bản trên DB bằng bản máy này.
// Trả 'db' (dùng bản DB) | 'offer_local' (DB trống, máy có bản cũ: hỏi đưa lên) | 'empty'.
export function initialQuoteSource({ dbRow, local }) {
  if (dbRow) return 'db'
  if (local && !isEmptyQuote(local)) return 'offer_local'
  return 'empty'
}

// ----- BẢN NHÁP CHƯA LƯU (chế độ DB) -----
// Mỗi lần sửa ghi ngay một bản nháp vào localStorage, kèm updated_at của bản DB mà nó dựa vào
// (baseUpdatedAt; null = DB chưa có báo giá). Chỉ xóa sau khi lưu DB thành công và không còn sửa mới.
export const quoteDraftKey = (projectId) => `dw_quote_draft_${projectId}`

export function buildQuoteDraft({ lines, quoteNote }, baseUpdatedAt, savedAt = new Date().toISOString()) {
  return { v: 1, baseUpdatedAt: baseUpdatedAt || null, savedAt, lines: lines || [], quoteNote: quoteNote || '' }
}

export function parseQuoteDraft(raw) {
  if (!raw) return null
  try {
    const d = JSON.parse(raw)
    if (!d || d.v !== 1 || !Array.isArray(d.lines)) return null
    return {
      baseUpdatedAt: typeof d.baseUpdatedAt === 'string' ? d.baseUpdatedAt : null,
      savedAt: typeof d.savedAt === 'string' ? d.savedAt : null,
      lines: d.lines,
      quoteNote: typeof d.quoteNote === 'string' ? d.quoteNote : '',
    }
  } catch {
    return null
  }
}

// So 2 mốc updated_at theo thời điểm (chuỗi có thể khác định dạng nhưng cùng một lúc).
function sameInstant(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a === b) return true
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && ta === tb
}

// Khi mở tab mà còn bản nháp:
// 'none'    = không có nháp;
// 'restore' = nháp dựa đúng bản DB hiện tại -> khôi phục vào ô sửa và lưu tiếp (không đè bản mới hơn);
// 'stale'   = DB đã đổi sau khi nháp được tạo -> KHÔNG tự áp dụng, hỏi người dùng.
export function draftDecision({ draft, dbRow }) {
  if (!draft) return 'none'
  return sameInstant(draft.baseUpdatedAt, dbRow?.updated_at || null) ? 'restore' : 'stale'
}

export function formatSavedTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}
