export function stripAccents(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

export function filterItems(items, query, opts = {}) {
  const { stockField = 'in_stock', onlyWithStock = false, limit = 50 } = opts
  const q = stripAccents(query).trim()
  const out = []
  for (const it of items || []) {
    if (it.active === false) continue
    if (onlyWithStock && !(Number(it[stockField]) > 0)) continue
    if (q && !stripAccents(it.code).includes(q) && !stripAccents(it.name).includes(q)) continue
    out.push(it)
    if (out.length >= limit) break
  }
  return out
}

// Mã vật tư dạng [TH|TSD]-[NHÓM]-[3 số] -> trả về NHÓM (in hoa), '' nếu không đúng dạng.
export function getItemGroup(code) {
  const m = /^(?:TH|TSD)-(.+)-\d{3}$/i.exec(String(code ?? '').trim())
  if (!m) return ''
  return m[1].trim().toUpperCase()
}

// Danh sách nhóm (unique, bỏ rỗng, A-Z) từ các vật tư còn hoạt động.
export function getItemGroups(items) {
  const set = new Set()
  for (const it of items || []) {
    if (it.active === false) continue
    const g = getItemGroup(it.code)
    if (g) set.add(g)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

// Danh sách cho ItemPicker: mục "Nhập gần đây" (suggestedIds, tối đa maxSuggested) đứng trước
// khi ô tìm kiếm trống, rồi tới phần còn lại (tổng không quá limit).
// Trả về { list, suggestedCount }.
export function buildPickerList(items, query, opts = {}) {
  const {
    stockField = 'in_stock',
    onlyWithStock = false,
    limit = 50,
    group = '',
    suggestedIds = [],
    maxSuggested = 10,
  } = opts
  const base = { stockField, onlyWithStock, limit: Infinity }
  let all = filterItems(items, query, base)
  if (group) all = all.filter((it) => getItemGroup(it.code) === group)
  const hasQuery = stripAccents(query).trim() !== ''
  if (hasQuery || !suggestedIds || suggestedIds.length === 0) {
    return { list: all.slice(0, limit), suggestedCount: 0 }
  }
  const byId = new Map(all.map((it) => [String(it.id), it]))
  const suggested = []
  const used = new Set()
  for (const id of suggestedIds) {
    const key = String(id)
    if (used.has(key)) continue
    const it = byId.get(key)
    if (!it) continue
    used.add(key)
    suggested.push(it)
    if (suggested.length >= maxSuggested) break
  }
  const rest = all.filter((it) => !used.has(String(it.id)))
  return { list: [...suggested, ...rest].slice(0, limit), suggestedCount: suggested.length }
}
