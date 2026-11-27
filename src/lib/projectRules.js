// Quy tắc nghiệp vụ dự án đợt 2 (hàm thuần, không import supabase).
// Khớp với trigger/RPC trong supabase/projects_phase2.sql; DB là lớp chặn cuối, các hàm này
// chặn trước ở giao diện (vẫn có hiệu lực khi SQL chưa chạy).
import { calcProjectItemStats } from './calc'
import { PROJECT_STATUS_LABELS } from './formatters'

// Trạng thái được phép XUẤT kho (giá trị thật trong DB: 'preparing' và 'in_progress').
export const ISSUE_ALLOWED_STATUSES = ['preparing', 'in_progress']
export const CLOSING_STATUSES = ['done', 'cancelled']

const round2 = (n) => Math.round(n * 100) / 100
const fmt = (n) => round2(Number(n) || 0).toLocaleString('vi-VN')
const label = (s) => PROJECT_STATUS_LABELS[s] || s || '?'

// Lỗi "chưa chạy SQL": bảng chưa có (42P01, PGRST205) hoặc hàm RPC chưa có (PGRST202, 42883).
export const MISSING_SCHEMA_CODES = ['42P01', 'PGRST205', 'PGRST202', '42883']
export function isMissingSchemaError(error) {
  if (!error) return false
  return MISSING_SCHEMA_CODES.includes(String(error.code || ''))
}

// '' nếu được xuất kho; ngược lại là câu hướng dẫn tiếng Việt.
export function issueBlockReason(project, { canChangeStatus = false } = {}) {
  if (!project) return 'Chưa tải được dự án.'
  const how = canChangeStatus
    ? 'Hãy đổi trạng thái ở ô "Trạng thái" phía trên.'
    : 'Hãy nhờ Quản lý/Quản trị đổi trạng thái dự án.'
  if (!ISSUE_ALLOWED_STATUSES.includes(project.status)) {
    return `Dự án đang ở trạng thái "${label(project.status)}". Chỉ xuất kho khi dự án ở "${label('preparing')}" hoặc "${label('in_progress')}". ${how} (Thu hồi vật tư vẫn làm được ở mọi trạng thái.)`
  }
  if (project.archived_at) {
    return 'Dự án đã lưu trữ nên không xuất kho được. Hãy bỏ lưu trữ ở trang Danh sách dự án trước.'
  }
  return ''
}

// Đồ TÁI SỬ DỤNG còn ở dự án: [{ item_id, name, unit, qty }], sắp theo tên.
export function outstandingReusable(movements, itemMap) {
  return calcProjectItemStats(movements || [], itemMap || new Map())
    .filter((r) => r.item.kind === 'reusable' && r.outstanding > 0)
    .map((r) => ({ item_id: r.item_id, name: r.item.name, unit: r.item.unit || '', qty: round2(r.outstanding) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
}

// Tháng hủy 'YYYY-MM' (cancelled_at, trống thì start_date — cùng quy tắc P&L); null nếu không có ngày.
export function cancelMonthOf(project) {
  const d = project?.cancelled_at || project?.start_date
  const s = d ? String(d).slice(0, 7) : ''
  return /^\d{4}-\d{2}$/.test(s) ? s : null
}

// '' nếu được đổi trạng thái; ngược lại là lý do chặn.
// outstanding: kết quả outstandingReusable (bắt buộc khi sang done/cancelled; null = không tải được).
// hasForfeit / cancelMonthLocked: bắt buộc khi rời cancelled (null = không tải được).
export function statusChangeBlockReason({
  prevStatus,
  nextStatus,
  projectName = '',
  outstanding,
  hasForfeit,
  cancelMonth,
  cancelMonthLocked,
}) {
  if (!nextStatus || prevStatus === nextStatus) return ''
  const name = projectName ? ` "${projectName}"` : ''
  if (CLOSING_STATUSES.includes(nextStatus)) {
    if (!Array.isArray(outstanding)) {
      return 'Không tải được phiếu kho của dự án nên chưa kiểm tra được đồ chưa thu hồi. Hãy tải lại trang rồi thử lại.'
    }
    if (outstanding.length > 0) {
      const list = outstanding.slice(0, 8).map((r) => `- ${r.name}: ${fmt(r.qty)} ${r.unit}`.trim())
      if (outstanding.length > 8) list.push(`- ... và ${outstanding.length - 8} vật tư khác`)
      return `Chưa thể chuyển dự án${name} sang "${label(nextStatus)}": còn ${outstanding.length} đồ tái sử dụng chưa thu hồi hoặc chưa ghi hỏng/mất:\n${list.join('\n')}\nHãy ghi thu hồi (tốt/hỏng/mất) ở tab "Thu hồi vật tư" trước.`
    }
  }
  if (prevStatus === 'cancelled' && nextStatus !== 'cancelled') {
    if (hasForfeit == null || cancelMonthLocked == null) {
      return 'Không tải được tạm ứng hoặc khóa sổ của dự án nên chưa kiểm tra được việc mở lại dự án hủy. Hãy tải lại trang rồi thử lại.'
    }
    if (hasForfeit) {
      return `Không mở lại được dự án${name}: dự án đã ghi Mất cọc. Muốn mở lại, hãy xóa khoản Mất cọc trước (nếu tháng đó chưa khóa sổ).`
    }
    if (cancelMonthLocked) {
      return `Không mở lại được dự án${name}: tháng hủy ${cancelMonth || ''} đã khóa sổ. Nhờ Quản trị mở khóa tháng (ghi lý do) rồi mới đổi trạng thái.`
    }
  }
  return ''
}

// Phần còn thiếu khi "Xuất theo kế hoạch" (khớp RPC issue_project_by_plan):
//   tái sử dụng: kế hoạch − max(0, đã xuất − đã thu hồi tốt/hỏng/mất);
//   tiêu hao:    kế hoạch − đã xuất.
// planRows: [{ item_id, qty }]. Trả [{ item_id, qty }] sắp theo item_id, chỉ dòng > 0.
export function calcIssueByPlanLines(planRows, movements, itemMap) {
  const stats = new Map(calcProjectItemStats(movements || [], itemMap || new Map()).map((s) => [Number(s.item_id), s]))
  const out = []
  for (const p of planRows || []) {
    const itemId = Number(p.item_id)
    const plan = Number(p.qty) || 0
    const s = stats.get(itemId)
    const kind = itemMap?.get(itemId)?.kind || s?.item?.kind
    let have = 0
    if (s) {
      have = kind === 'reusable'
        ? Math.max(0, s.issued - s.return_good - s.return_damaged - s.return_lost)
        : s.issued
    }
    const need = round2(plan - have)
    if (need > 0) out.push({ item_id: itemId, qty: need })
  }
  return out.sort((a, b) => a.item_id - b.item_id)
}

// Tổng SL vật tư cần thêm từ các mẫu set: entries [{ template_id, mult }] -> Map<item_id, qty>.
export function buildTemplateAddMap(templates, entries) {
  const addMap = new Map()
  for (const entry of entries || []) {
    const tpl = (templates || []).find((t) => Number(t.id) === Number(entry.template_id))
    if (!tpl?.items) continue
    const mult = Number(entry.mult)
    const m = Number.isFinite(mult) && mult > 0 ? mult : 1
    for (const ti of tpl.items) {
      const itemId = Number(ti.item_id)
      const addQty = Number(ti.qty || 0) * m
      if (addQty > 0) addMap.set(itemId, round2((addMap.get(itemId) || 0) + addQty))
    }
  }
  return addMap
}

// Vật tư vừa có trong mẫu vừa đã có trong kế hoạch: [{ item_id, current, add }].
export function planDuplicates(addMap, existingMap) {
  return [...addMap.keys()]
    .filter((id) => existingMap.has(id))
    .map((id) => ({ item_id: id, current: Number(existingMap.get(id)) || 0, add: addMap.get(id) }))
}

// Dòng upsert kế hoạch theo chế độ (khớp RPC apply_templates_to_plan):
// 'add' = cộng thêm; 'replace' = vật tư trong mẫu lấy đúng số của mẫu. Vật tư khác không đụng tới.
export function mergePlanRows({ projectId, addMap, existingMap, mode = 'add' }) {
  return [...addMap.entries()]
    .map(([item_id, add]) => ({
      project_id: Number(projectId),
      item_id,
      qty: mode === 'replace' ? add : round2((Number(existingMap.get(item_id)) || 0) + add),
    }))
    .sort((a, b) => a.item_id - b.item_id)
}
