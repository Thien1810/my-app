// Logic thuần cho phiếu chuyển kho tài sản tái sử dụng (không gọi Supabase).

const r2 = (n) => Math.round(n * 100) / 100

// Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD), không phụ thuộc múi giờ máy.
export function todayVN(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts
}

// Kiểm tra dữ liệu form chuyển kho -> { ok, error }.
export function validateTransferInput({ item_id, from_wh, to_wh, qty, available } = {}) {
  if (!item_id) return { ok: false, error: 'Hãy chọn vật tư cần chuyển.' }
  if (!from_wh) return { ok: false, error: 'Hãy chọn kho đi.' }
  if (!to_wh) return { ok: false, error: 'Hãy chọn kho đến.' }
  if (from_wh === to_wh) return { ok: false, error: 'Kho đi và kho đến phải khác nhau.' }
  const q = typeof qty === 'string' ? (qty.trim() === '' ? NaN : Number(qty)) : Number(qty)
  if (qty === null || qty === undefined || !Number.isFinite(q) || q <= 0) {
    return { ok: false, error: 'Số lượng phải là số lớn hơn 0.' }
  }
  const av = Number(available)
  if (!Number.isFinite(av) || q > av) {
    const shown = Number.isFinite(av) ? Math.max(0, av) : 0
    return { ok: false, error: `Số lượng chuyển (${q}) vượt quá số đang có ở kho đi (${shown}).` }
  }
  return { ok: true, error: '' }
}

// Số lượng từng vật tư tái sử dụng ở từng kho (cùng quy ước view warehouse_asset_value).
// Trả về mảng { item_id, name, code, cost, total, byWarehouse: { [mãKho]: sốLượng } }.
export function calcWarehouseHoldings({ items, transfers, mainWarehouseCode } = {}) {
  const map = new Map()
  for (const it of items || []) {
    if (!it || it.kind !== 'reusable' || !it.active) continue
    const total =
      Math.max(0, Number(it.in_stock) || 0) + Math.max(0, Number(it.at_project) || 0) + Math.max(0, Number(it.in_repair) || 0)
    map.set(String(it.id), {
      item_id: it.id,
      name: it.name,
      code: it.code,
      cost: Number(it.cost) || 0,
      total,
      byWarehouse: mainWarehouseCode ? { [mainWarehouseCode]: total } : {},
    })
  }
  for (const t of transfers || []) {
    const row = map.get(String(t?.item_id))
    if (!row) continue // vật tư tiêu hao / không hoạt động: bỏ qua như view SQL
    const q = Number(t.qty) || 0
    if (t.to_wh) row.byWarehouse[t.to_wh] = (row.byWarehouse[t.to_wh] || 0) + q
    if (t.from_wh) row.byWarehouse[t.from_wh] = (row.byWarehouse[t.from_wh] || 0) - q
  }
  const out = [...map.values()]
  for (const row of out) {
    for (const k of Object.keys(row.byWarehouse)) row.byWarehouse[k] = r2(row.byWarehouse[k])
  }
  return out
}

// Quyền xóa phiếu: chỉ admin, và tháng của ngày chuyển chưa khóa sổ.
export function canDeleteTransfer({ role, transferDate, lockedMonths } = {}) {
  if (role !== 'admin') return { ok: false, reason: 'Chỉ admin mới được xóa phiếu chuyển kho.' }
  const month = String(transferDate || '').slice(0, 7)
  if (/^\d{4}-\d{2}$/.test(month) && (lockedMonths || []).includes(month)) {
    return { ok: false, reason: `Tháng ${month} đã khóa sổ, không xóa được phiếu.` }
  }
  return { ok: true, reason: '' }
}
