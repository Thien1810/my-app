// =====================================================================
// FINANCE API - MỘT chỗ duy nhất truy cập dữ liệu tài chính trên Supabase.
// Tầng dữ liệu thuần: không UI, không React, không localStorage, không token Meta.
//
// KIỂU TRẢ VỀ (nhất quán cho mọi hàm async): { data, error } theo chuẩn supabase-js.
// - Không throw, không nuốt lỗi. Lỗi từ Supabase được trả nguyên trong `error`.
// - Lỗi kiểm tra đầu vào (validate) cũng có dạng { data: null, error: { message } } (tiếng Việt).
// - Hàm thuần (summarizeAdvances, isMonthLockedLocal) trả giá trị trực tiếp, không có error.
//
// GHI CHÚ NGHIỆP VỤ: project_finance.contract_value = doanh thu thực (đã trừ ưu đãi);
// doanh số = contract_value + discount.
// =====================================================================
import { supabase } from './supabase'
import { isMissingReceiptColumnError } from './receiptCode'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const fail = (message) => ({ data: null, error: { message } })
const NO_CLIENT = 'Chưa cấu hình Supabase.'

// Kiểm tra số hợp lệ (hữu hạn)
const isNum = (v) => typeof v === 'number' ? Number.isFinite(v) : v !== '' && v !== null && Number.isFinite(Number(v))

// Lấy client, hoặc null nếu chưa cấu hình
const db = () => supabase

// ---------------------------------------------------------------------
// 1. project_finance
// ---------------------------------------------------------------------

// Lấy contract_value và discount của một dự án (data = null nếu chưa có dòng).
export async function getProjectFinance(projectId) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('project_finance').select('contract_value, discount').eq('project_id', projectId).maybeSingle()
}

// Lưu (upsert theo project_id) giá trị hợp đồng và ưu đãi; chặn số âm.
export async function saveProjectFinance(projectId, { contractValue, discount }) {
  if (!db()) return fail(NO_CLIENT)
  if (!isNum(contractValue) || Number(contractValue) < 0) return fail('Giá trị hợp đồng không được âm.')
  if (!isNum(discount) || Number(discount) < 0) return fail('Ưu đãi không được âm.')
  return db()
    .from('project_finance')
    .upsert(
      { project_id: projectId, contract_value: Number(contractValue), discount: Number(discount) },
      { onConflict: 'project_id' },
    )
    .select('contract_value, discount')
    .single()
}

// ---------------------------------------------------------------------
// 2. ads_spend
// ---------------------------------------------------------------------

// Danh sách chi Ads theo tháng 'YYYY-MM' (mới nhất trước).
export async function listAdsSpend({ month } = {}) {
  if (!db()) return fail(NO_CLIENT)
  if (month && !MONTH_RE.test(month)) return fail('Tháng phải có dạng YYYY-MM.')
  let q = db().from('ads_spend').select('*').order('spend_date', { ascending: false }).order('id', { ascending: false })
  if (month) q = q.eq('month', month)
  return q
}

// Thêm một dòng chi Ads; chặn spend < 0.
export async function createAdsSpend(row) {
  if (!db()) return fail(NO_CLIENT)
  if (!isNum(row?.spend) || Number(row.spend) < 0) return fail('Chi phí Ads không được âm.')
  return db().from('ads_spend').insert(row).select().single()
}

// Sửa một dòng chi Ads theo id; chặn spend < 0 nếu có sửa spend.
export async function updateAdsSpend(id, patch) {
  if (!db()) return fail(NO_CLIENT)
  if (patch && 'spend' in patch && (!isNum(patch.spend) || Number(patch.spend) < 0)) return fail('Chi phí Ads không được âm.')
  return db().from('ads_spend').update(patch).eq('id', id).select().single()
}

// Xóa một dòng chi Ads theo id.
export async function deleteAdsSpend(id) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('ads_spend').delete().eq('id', id)
}

// Upsert hàng loạt (đồng bộ Meta): chỉ nhận dòng có external_id, khớp channel+external_id+spend_date.
export async function upsertAdsSpendBatch(rows) {
  if (!db()) return fail(NO_CLIENT)
  if (!Array.isArray(rows) || rows.length === 0) return { data: [], error: null }
  if (rows.some((r) => !r?.external_id)) return fail('Mọi dòng đồng bộ phải có external_id.')
  if (rows.some((r) => !isNum(r.spend) || Number(r.spend) < 0)) return fail('Chi phí Ads không được âm.')
  return db().from('ads_spend').upsert(rows, { onConflict: 'channel,external_id,spend_date' }).select()
}

// ---------------------------------------------------------------------
// 3. fixed_costs và fixed_cost_templates
// ---------------------------------------------------------------------

// Danh sách chi phí cứng của một tháng 'YYYY-MM'.
export async function listFixedCosts({ month }) {
  if (!db()) return fail(NO_CLIENT)
  if (!MONTH_RE.test(month || '')) return fail('Tháng phải có dạng YYYY-MM.')
  return db().from('fixed_costs').select('*').eq('month', month).order('id')
}

// Thêm một dòng chi phí cứng; chặn amount <= 0.
export async function createFixedCost(row) {
  if (!db()) return fail(NO_CLIENT)
  if (!isNum(row?.amount) || Number(row.amount) <= 0) return fail('Số tiền chi phí cứng phải lớn hơn 0.')
  return db().from('fixed_costs').insert(row).select().single()
}

// Sửa một dòng chi phí cứng; chặn amount <= 0 nếu có sửa amount.
export async function updateFixedCost(id, patch) {
  if (!db()) return fail(NO_CLIENT)
  if (patch && 'amount' in patch && (!isNum(patch.amount) || Number(patch.amount) <= 0)) return fail('Số tiền chi phí cứng phải lớn hơn 0.')
  return db().from('fixed_costs').update(patch).eq('id', id).select().single()
}

// Xóa một dòng chi phí cứng theo id.
export async function deleteFixedCost(id) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('fixed_costs').delete().eq('id', id)
}

// Danh sách mẫu chi phí cứng (theo sort_order).
export async function listFixedCostTemplates() {
  if (!db()) return fail(NO_CLIENT)
  return db().from('fixed_cost_templates').select('*').order('sort_order').order('id')
}

// Thêm một mẫu chi phí cứng; chặn amount <= 0.
export async function createFixedCostTemplate(row) {
  if (!db()) return fail(NO_CLIENT)
  if (!isNum(row?.amount) || Number(row.amount) <= 0) return fail('Số tiền mẫu phải lớn hơn 0.')
  return db().from('fixed_cost_templates').insert(row).select().single()
}

// Sửa một mẫu chi phí cứng; chặn amount <= 0 nếu có sửa amount.
export async function updateFixedCostTemplate(id, patch) {
  if (!db()) return fail(NO_CLIENT)
  if (patch && 'amount' in patch && (!isNum(patch.amount) || Number(patch.amount) <= 0)) return fail('Số tiền mẫu phải lớn hơn 0.')
  return db().from('fixed_cost_templates').update(patch).eq('id', id).select().single()
}

// Xóa một mẫu chi phí cứng theo id.
export async function deleteFixedCostTemplate(id) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('fixed_cost_templates').delete().eq('id', id)
}

// Tạo các dòng fixed_costs của tháng từ templates; từ chối nếu tháng đã có dòng (tránh nhân đôi).
export async function applyFixedCostTemplates(month) {
  if (!db()) return fail(NO_CLIENT)
  if (!MONTH_RE.test(month || '')) return fail('Tháng phải có dạng YYYY-MM.')
  const existing = await db().from('fixed_costs').select('id', { count: 'exact', head: true }).eq('month', month)
  if (existing.error) return { data: null, error: existing.error }
  if (existing.count > 0) return fail(`Tháng ${month} đã có chi phí cứng, không áp mẫu lại để tránh nhân đôi.`)
  const tpl = await listFixedCostTemplates()
  if (tpl.error) return tpl
  if (!tpl.data.length) return fail('Chưa có mẫu chi phí cứng nào.')
  const rows = tpl.data.map((t) => ({
    month,
    category: t.category,
    title: t.title,
    warehouse_code: t.warehouse_code,
    amount: t.amount,
  }))
  return db().from('fixed_costs').insert(rows).select()
}

// ---------------------------------------------------------------------
// 4. project_advances
// ---------------------------------------------------------------------

// Danh sách tạm ứng/cọc của một dự án (cũ nhất trước).
export async function listProjectAdvances(projectId) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('project_advances').select('*').eq('project_id', projectId).order('received_date').order('id')
}

// Thêm một khoản tạm ứng/hoàn/mất cọc; amount phải khác 0.
export async function createProjectAdvance(row) {
  if (!db()) return fail(NO_CLIENT)
  if (!isNum(row?.amount) || Number(row.amount) === 0) return fail('Số tiền tạm ứng phải khác 0.')
  return db().from('project_advances').insert(row).select().single()
}

// Sửa một khoản tạm ứng theo id; amount (nếu sửa) phải khác 0.
export async function updateProjectAdvance(id, patch) {
  if (!db()) return fail(NO_CLIENT)
  if (patch && 'amount' in patch && (!isNum(patch.amount) || Number(patch.amount) === 0)) return fail('Số tiền tạm ứng phải khác 0.')
  return db().from('project_advances').update(patch).eq('id', id).select().single()
}

// Xóa một khoản tạm ứng theo id.
export async function deleteProjectAdvance(id) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('project_advances').delete().eq('id', id)
}

// Mọi dòng project_advances có received_date trong tháng 'YYYY-MM' (gte ngày 1, lt ngày 1 tháng sau).
export async function listAdvancesByMonth(month) {
  if (!db()) return fail(NO_CLIENT)
  if (!MONTH_RE.test(month || '')) return fail('Tháng phải có dạng YYYY-MM.')
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return db()
    .from('project_advances')
    .select('*')
    .gte('received_date', `${month}-01`)
    .lt('received_date', next)
    .order('received_date')
    .order('id')
}

// Nguồn công thức duy nhất nằm ở ./advances (re-export; chữ ký tương thích, trả thêm các tổng).
export { summarizeAdvances } from './advances'

// ---------------------------------------------------------------------
// 5. month_locks
// ---------------------------------------------------------------------

// Danh sách các tháng đã khóa sổ.
export async function listMonthLocks() {
  if (!db()) return fail(NO_CLIENT)
  return db().from('month_locks').select('*').order('month', { ascending: false })
}

// Chuyển lỗi khóa/mở khóa sang tiếng Việt thân thiện.
function friendlyLockError(error) {
  if (!error) return error
  const msg = String(error.message || '')
  if (/chỉ khóa được tháng đã qua/i.test(msg)) return error
  if (error.code === '23505' || /duplicate key/i.test(msg)) {
    return { ...error, message: 'Tháng này đã được khóa sổ rồi.' }
  }
  if (error.code === '42501' || /row-level security|permission denied|not authorized|chỉ admin/i.test(msg)) {
    return { ...error, message: 'Bạn không có quyền khóa sổ.' }
  }
  return error
}

// Khóa sổ một tháng, kèm share_snapshot lấy từ view warehouse_share lúc khóa (lỗi snapshot thì không khóa).
export async function lockMonth(month, note) {
  if (!db()) return fail(NO_CLIENT)
  if (!MONTH_RE.test(month || '')) return fail('Tháng phải có dạng YYYY-MM.')
  const share = await listWarehouseShare()
  if (share.error) return share
  const res = await db().from('month_locks').insert({ month, note: note || null, share_snapshot: share.data }).select().single()
  return res.error ? { ...res, error: friendlyLockError(res.error) } : res
}

// Mở khóa sổ (chỉ admin, DB kiểm tra) qua RPC unlock_month; bắt buộc có lý do.
export async function unlockMonth(month, reason) {
  if (!db()) return fail(NO_CLIENT)
  if (!MONTH_RE.test(month || '')) return fail('Tháng phải có dạng YYYY-MM.')
  const why = String(reason || '').trim()
  if (!why) return fail('Phải nhập lý do mở khóa.')
  const res = await db().rpc('unlock_month', { p_month: month, p_reason: why })
  if (res.error && (res.error.code === '42501' || /row-level security|permission denied|chỉ admin/i.test(res.error.message || ''))) {
    return { ...res, error: { ...res.error, message: 'Chỉ admin mới mở khóa được sổ.' } }
  }
  return res
}

// Nhật ký khóa/mở khóa (month_lock_log). Bảng chưa có hoặc lỗi: trả { data: [], error }.
export async function listMonthLockLog(month) {
  if (!db()) return { data: [], error: { message: NO_CLIENT } }
  let q = db().from('month_lock_log').select('*').order('acted_at', { ascending: false })
  if (month) q = q.eq('month', month)
  const res = await q
  return res.error ? { data: [], error: res.error } : res
}

// Hàm thuần: tháng có nằm trong danh sách locks (đã tải) hay không.
export function isMonthLockedLocal(locks, month) {
  return (locks || []).some((l) => l.month === month)
}

// ---------------------------------------------------------------------
// 6. stock_transfers
// ---------------------------------------------------------------------

// Danh sách phiếu chuyển kho (mới nhất trước).
export async function listStockTransfers() {
  if (!db()) return fail(NO_CLIENT)
  return db().from('stock_transfers').select('*').order('transferred_at', { ascending: false }).order('id', { ascending: false })
}

// Lấy mã phiếu kế tiếp (PN/KK/DH/CK) từ RPC next_receipt_code.
// Mọi lỗi (hàm chưa tồn tại, thiếu quyền, chưa cấu hình...) trả { code: null }: KHÔNG ném lỗi, không chặn lưu phiếu.
export async function getReceiptCode(prefix) {
  try {
    if (!db()) return { code: null }
    const { data, error } = await db().rpc('next_receipt_code', { p_prefix: prefix })
    if (error || typeof data !== 'string' || !data) return { code: null }
    return { code: data }
  } catch {
    return { code: null }
  }
}

// Tạo phiếu chuyển kho; chặn qty <= 0 và from_wh == to_wh.
// receipt_code tùy chọn: chỉ đưa vào row khi có giá trị; nếu cột chưa tồn tại thì thử lại 1 lần không có mã.
export async function createStockTransfer({ item_id, from_wh, to_wh, qty, transferred_at, note, receipt_code }) {
  if (!db()) return fail(NO_CLIENT)
  if (!isNum(qty) || Number(qty) <= 0) return fail('Số lượng chuyển kho phải lớn hơn 0.')
  if (!from_wh || !to_wh) return fail('Phải chọn kho đi và kho đến.')
  if (from_wh === to_wh) return fail('Kho đi và kho đến phải khác nhau.')
  const row = { item_id, from_wh, to_wh, qty: Number(qty), note: note || null }
  if (transferred_at) row.transferred_at = transferred_at
  if (receipt_code) {
    const res = await db().from('stock_transfers').insert({ ...row, receipt_code }).select().single()
    if (res.error && isMissingReceiptColumnError(res.error)) {
      return db().from('stock_transfers').insert(row).select().single()
    }
    return res
  }
  return db().from('stock_transfers').insert(row).select().single()
}

// Xóa một phiếu chuyển kho theo id (RLS: chỉ admin/manager).
export async function deleteStockTransfer(id) {
  if (!db()) return fail(NO_CLIENT)
  return db().from('stock_transfers').delete().eq('id', id)
}

// Vật tư tái sử dụng đang hoạt động (view item_stock), chỉ các cột cần để tính chuyển kho.
export async function listReusableItemStock() {
  if (!db()) return fail(NO_CLIENT)
  return db()
    .from('item_stock')
    .select('id, name, code, kind, cost, in_stock, at_project, in_repair, active')
    .eq('kind', 'reusable')
    .eq('active', true)
    .order('name')
}

// ---------------------------------------------------------------------
// 7. Đọc view / bảng kho
// ---------------------------------------------------------------------

// Tỷ trọng chia chi phí chung theo kho (view warehouse_share).
export async function listWarehouseShare() {
  if (!db()) return fail(NO_CLIENT)
  return db().from('warehouse_share').select('code, name, asset_value, share').order('code')
}

// Danh sách kho đang hoạt động.
export async function listWarehouses() {
  if (!db()) return fail(NO_CLIENT)
  return db().from('warehouses').select('*').eq('active', true).order('code')
}
