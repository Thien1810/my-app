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
