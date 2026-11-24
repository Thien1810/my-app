// Chuỗi doanh thu/chi phí/lãi theo tháng cho Dashboard — tái dùng calcPnl để khớp P&L.
// Quy tắc (theo pnl.js): chỉ dự án đang tính doanh thu, tháng = start_date; dự án hủy: doanh thu 0,
// chi phí vào tháng hủy (cancelled_at, trống thì start_date); báo giá không tính; thiếu ngày thì bỏ
// (đếm vào skippedCount để giao diện ghi chú). Chỉ làm tròn ở bước cuối, không làm tròn từng dự án.
import { calcPnl } from './pnl'

const monthOf = (v) => (typeof v === 'string' ? v.slice(0, 7) : '')

// projects: [{...project, contractValue, totalCost}]
export function buildMonthlyFinanceSeries(projects, limit = 6) {
  const list = (projects || []).filter(Boolean)
  const months = new Set()
  let skippedCount = 0
  for (const p of list) {
    if (p.status === 'quote') continue
    const m =
      p.status === 'cancelled'
        ? monthOf(p.cancelled_at) || monthOf(p.start_date)
        : monthOf(p.start_date)
    if (m) months.add(m)
    else skippedCount += 1
  }
  const rows = []
  for (const month of months) {
    const r = calcPnl({ month, scope: 'all', projects: list })
    if (r.revenue === 0 && r.rotatingCost === 0 && r.cancelledCost === 0 && r.cancelledCount === 0) {
      // Không có dự án tính trong tháng (hoặc toàn số 0 thật): vẫn giữ nếu có dự án đếm được.
      const has = list.some(
        (p) => p.status !== 'quote' && p.status !== 'cancelled' && monthOf(p.start_date) === month
      )
      if (!has) continue
    }
    rows.push({
      month,
      doanhThu: Math.round(r.revenue),
      chiPhi: Math.round(r.rotatingCost + r.cancelledCost),
      loiNhuan: Math.round(r.grossProfit),
    })
  }
  rows.sort((a, b) => a.month.localeCompare(b.month))
  return { rows: rows.slice(-limit), skippedCount }
}
