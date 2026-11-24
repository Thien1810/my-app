// Hàm thuần cho đóng/lưu trữ dự án (không import supabase).
import { calcProjectItemStats } from './calc'
import { summarizeAdvances } from './advances'

export const ARCHIVE_SUGGEST_DAYS = 30

function toDay(v) {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function dayNumber(s) {
  const [y, m, d] = s.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

function kindOf(map, id) {
  if (!map) return undefined
  if (typeof map.get === 'function') return map.get(id) ?? map.get(Number(id)) ?? map.get(String(id))
  return map[id]
}

export function calcProjectClosure({ project, movements, costs, advances, itemKindMap, today }) {
  const mv = movements || []
  const cs = costs || []
  const ad = advances || []
  const counts = { movements: mv.length, costs: cs.length, advances: ad.length }
  const isEmpty = counts.movements === 0 && counts.costs === 0 && counts.advances === 0

  // Chỉ đồ tái sử dụng mới có "còn ở dự án"; vật tư không rõ loại coi như tiêu hao.
  const stockMap = new Map()
  for (const m of mv) {
    const id = Number(m.item_id)
    if (!stockMap.has(id)) stockMap.set(id, { id, kind: kindOf(itemKindMap, m.item_id) || 'consumable' })
  }
  const outstandingItems = calcProjectItemStats(mv, stockMap)
    .filter((r) => r.item.kind === 'reusable' && r.outstanding > 0)
    .map((r) => ({ itemId: r.item_id, qty: r.outstanding }))

  const { received, forfeitTotal } = summarizeAdvances(ad, 0)
  const heldAmount = received - forfeitTotal
  const settled = outstandingItems.length === 0 && heldAmount === 0

  const dates = [
    ...mv.map((m) => toDay(m.moved_at)),
    ...cs.map((c) => toDay(c.cost_date)),
    ...ad.map((a) => toDay(a.received_date)),
    toDay(project?.cancelled_at),
  ].filter(Boolean)
  const lastActivityDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  const todayDay = toDay(today)
  const daysSinceLastActivity =
    lastActivityDate && todayDay ? dayNumber(todayDay) - dayNumber(lastActivityDate) : null

  const archived = !!project?.archived_at
  const cancelled = project?.status === 'cancelled'
  const canArchive = cancelled && settled && !archived
  const suggestArchive =
    canArchive && daysSinceLastActivity !== null && daysSinceLastActivity >= ARCHIVE_SUGGEST_DAYS

  const reasons = []
  if (archived) reasons.push('Dự án đã được lưu trữ')
  if (!cancelled) reasons.push('Dự án chưa ở trạng thái Đã hủy')
  if (outstandingItems.length > 0) {
    reasons.push(
      `Còn ${outstandingItems.length} món đồ tái sử dụng chưa thu hồi hoặc chưa ghi hỏng/mất`
    )
  }
  if (heldAmount !== 0) {
    reasons.push(
      `Còn giữ tiền cọc ${heldAmount.toLocaleString('vi-VN')} (chưa hoàn hoặc ghi mất cọc)`
    )
  }

  return {
    counts,
    isEmpty,
    outstandingItems,
    heldAmount,
    settled,
    lastActivityDate,
    daysSinceLastActivity,
    canArchive,
    suggestArchive,
    reasons,
  }
}

export function deleteBlockMessage(counts) {
  const parts = []
  if (counts?.movements > 0) parts.push(`${counts.movements} phiếu kho`)
  if (counts?.costs > 0) parts.push(`${counts.costs} khoản chi phí`)
  if (counts?.advances > 0) parts.push(`${counts.advances} khoản tạm ứng`)
  if (parts.length === 0) return ''
  return `Dự án đã có ${parts.join(', ')} nên không xóa được. Hãy chuyển sang trạng thái Đã hủy rồi Lưu trữ.`
}
