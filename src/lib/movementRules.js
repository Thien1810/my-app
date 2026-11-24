// Quy tắc thuần cho phiếu sổ kho (không gọi Supabase). Số liệu tồn lấy từ view item_stock.

const num = (v) => {
  if (v === null || v === undefined) return NaN
  if (typeof v === 'string' && v.trim() === '') return NaN
  return Number(v)
}
const fmt = (n) => String(Math.round(n * 100) / 100)

// Kiểm tra phiếu đơn dòng (adjust | repair_done | dispose) -> { ok, error }.
// stock: dòng item_stock của vật tư { in_stock, in_repair }.
export function validateSingleMovement({ type, qty, stock, note } = {}) {
  const q = num(qty)
  if (!Number.isFinite(q) || q === 0) return { ok: false, error: 'Số lượng không được để trống hoặc bằng 0.' }
  if (type === 'adjust') {
    if (!String(note || '').trim()) {
      return { ok: false, error: 'Phiếu điều chỉnh bắt buộc phải ghi lý do điều chỉnh.' }
    }
    if (q < 0) {
      const inStock = Number(stock?.in_stock) || 0
      if (-q > inStock) {
        return {
          ok: false,
          error: `Điều chỉnh giảm ${fmt(-q)} vượt quá tồn trong kho hiện có (${fmt(Math.max(0, inStock))}). Tồn kho không được âm.`,
        }
      }
    }
    return { ok: true, error: '' }
  }
  if (q < 0) return { ok: false, error: 'Số lượng không được là số âm.' }
  if (type === 'repair_done' || type === 'dispose') {
    const inRepair = Number(stock?.in_repair) || 0
    if (q > inRepair) {
      const label = type === 'repair_done' ? 'sửa xong' : 'thanh lý'
      return {
        ok: false,
        error: `Số lượng ${label} (${fmt(q)}) vượt quá số đang chờ sửa (${fmt(Math.max(0, inRepair))}).`,
      }
    }
  }
  return { ok: true, error: '' }
}

// Kiểm tồn khi xuất cho dự án -> { ok, error, shortages:[{ item_id, name, need, have }] }.
// lines: [{ item_id, qty }] (cùng vật tư nhiều dòng thì cộng dồn); stockMap: Map hoặc object
// theo item_id -> { name, in_stock } lấy từ item_stock mới nhất. Vật tư không có trong stockMap
// coi như còn 0.
export function checkIssueStock(lines, stockMap) {
  const need = new Map()
  for (const l of lines || []) {
    const q = num(l?.qty)
    if (!Number.isFinite(q) || q <= 0 || l?.item_id === '' || l?.item_id == null) continue
    const key = Number(l.item_id)
    need.set(key, (need.get(key) || 0) + q)
  }
  const get = (id) => (stockMap instanceof Map ? stockMap.get(id) : stockMap?.[id])
  const shortages = []
  for (const [item_id, n] of need) {
    const s = get(item_id)
    const have = Math.max(0, Number(s?.in_stock) || 0)
    // Làm tròn 2 chữ số để số lẻ (0.1 + 0.2) không báo thiếu nhầm
    if (Math.round(n * 100) > Math.round(have * 100)) {
      shortages.push({ item_id, name: s?.name || `Vật tư #${item_id}`, need: n, have })
    }
  }
  if (shortages.length === 0) return { ok: true, error: '', shortages: [] }
  const detail = shortages
    .map((s) => `- ${s.name}: cần ${fmt(s.need)}, trong kho còn ${fmt(s.have)} (thiếu ${fmt(s.need - s.have)})`)
    .join('\n')
  return {
    ok: false,
    error: `Không đủ tồn trong kho để xuất, chưa ghi phiếu nào:\n${detail}`,
    shortages,
  }
}

// Dòng nhập mua hoàn toàn trống (chưa chọn vật tư, chưa nhập giá, số lượng mặc định/0) thì được bỏ qua.
export function isBlankPurchaseLine(l) {
  const q = num(l?.qty)
  const qtyBlank = !Number.isFinite(q) || q === 0 || q === 1
  return !l?.item_id && !(Number(l?.unit_cost) > 0) && qtyBlank
}

// Kiểm tra các dòng nhập mua -> { ok, error, errors:[{row,field,message}], validLines }.
// field: 'item_id' | 'qty' | 'unit_cost' để tô viền đỏ đúng ô.
// row đánh số từ 1 theo thứ tự trên form.
export function validatePurchaseLines(lines) {
  const errors = []
  const valid = []
  const seen = new Map()
  ;(lines || []).forEach((l, i) => {
    if (isBlankPurchaseLine(l)) return
    const row = i + 1
    const before = errors.length
    if (!l.item_id) errors.push({ row, field: 'item_id', message: `Dòng ${row}: chưa chọn vật tư.` })
    const q = num(l.qty)
    if (!Number.isFinite(q) || q <= 0) {
      errors.push({ row, field: 'qty', message: `Dòng ${row}: số lượng phải lớn hơn 0.` })
    }
    const c = num(l.unit_cost)
    if (!Number.isFinite(c) || c <= 0) {
      errors.push({
        row,
        field: 'unit_cost',
        message: `Dòng ${row}: đơn giá nhập phải lớn hơn 0 (đơn giá này sẽ ghi đè giá vốn của vật tư).`,
      })
    }
    if (l.item_id) {
      const key = String(l.item_id)
      if (seen.has(key)) {
        errors.push({
          row,
          field: 'item_id',
          message: `Dòng ${row}: trùng vật tư với dòng ${seen.get(key)}. Hãy gộp thành một dòng.`,
        })
      } else seen.set(key, row)
    }
    if (errors.length === before) valid.push(l)
  })
  if (errors.length === 0 && valid.length === 0) {
    return {
      ok: false,
      error: 'Vui lòng chọn ít nhất 1 vật tư và nhập số lượng > 0.',
      errors: [],
      validLines: [],
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join('\n'), errors, validLines: [] }
  }
  return { ok: true, error: '', errors: [], validLines: valid }
}

// Xóa phiếu có làm tồn kho âm không -> { ok, reason }.
// movement: { type, qty }; stock: dòng item_stock { in_stock, in_repair, at_project, kind }.
export function canDeleteMovement({ movement, stock } = {}) {
  if (!movement) return { ok: false, reason: 'Không tìm thấy phiếu.' }
  if (!stock) return { ok: true, reason: '' } // không có số liệu: để DB quyết định
  const q = Number(movement.qty) || 0
  const inStock = Number(stock.in_stock) || 0
  const inRepair = Number(stock.in_repair) || 0
  const atProject = Number(stock.at_project) || 0
  const name = stock.name ? `"${stock.name}"` : 'vật tư này'
  const stockFail = (what) => ({
    ok: false,
    reason: `Không xóa được: xóa phiếu ${what} sẽ làm tồn trong kho của ${name} âm (đang có ${fmt(inStock)}, phiếu ${fmt(q)}).`,
  })
  switch (movement.type) {
    case 'purchase':
      return inStock - q < 0 ? stockFail('nhập mua') : { ok: true, reason: '' }
    case 'return_good':
      return inStock - q < 0 ? stockFail('thu hồi tốt') : { ok: true, reason: '' }
    case 'repair_done':
      return inStock - q < 0 ? stockFail('sửa xong') : { ok: true, reason: '' }
    case 'adjust':
      return inStock - q < 0 ? stockFail('điều chỉnh') : { ok: true, reason: '' }
    case 'return_damaged':
      if (inRepair - q < 0) {
        return {
          ok: false,
          reason: `Không xóa được: xóa phiếu thu hồi hỏng sẽ làm số chờ sửa của ${name} âm (đang có ${fmt(inRepair)}, phiếu ${fmt(q)}).`,
        }
      }
      return { ok: true, reason: '' }
    case 'issue':
      if (stock.kind === 'reusable' && atProject - q < 0) {
        return {
          ok: false,
          reason: `Không xóa được: xóa phiếu xuất sẽ làm số đang ở dự án của ${name} âm (đang có ${fmt(atProject)}, phiếu ${fmt(q)}).`,
        }
      }
      return { ok: true, reason: '' }
    default:
      return { ok: true, reason: '' }
  }
}

// Cảnh báo giá nhập lệch quá 30% so với giá lần trước (cao hoặc thấp) -> { warn, pct }.
// pct: phần trăm lệch có dấu (làm tròn số nguyên); 0 nếu thiếu dữ liệu.
export function priceDeviation(cost, last, threshold = 0.3) {
  const c = num(cost)
  const l = num(last)
  if (!Number.isFinite(c) || !Number.isFinite(l) || c <= 0 || l <= 0) return { warn: false, pct: 0 }
  const ratio = (c - l) / l
  return { warn: Math.abs(ratio) > threshold, pct: Math.round(ratio * 100) }
}
