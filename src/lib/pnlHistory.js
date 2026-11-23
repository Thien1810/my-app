// Hàm thuần dựng dữ liệu đầu vào cho calcPnl từ báo cáo lãi/lỗ dự án (không DB/React).

const REVENUE_STATUSES = ['preparing', 'in_progress', 'awaiting_return', 'done']

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const monthOf = (v) => (typeof v === 'string' ? v.slice(0, 7) : '')

// Ánh xạ projectProfitReport (ReportsPage) sang mảng cho calcPnl.
export function toPnlProjects(projectProfitReport) {
  return (projectProfitReport || [])
    .filter((r) => r && r.project)
    .map((r) => ({
      id: r.project.id,
      status: r.project.status,
      start_date: r.project.start_date,
      lead_source: r.project.lead_source,
      warehouse_code: r.project.warehouse_code,
      contractValue: num(r.contractValue),
      totalCost: num(r.totalCost),
    }))
}

// 'YYYY-MM' lùi n tháng (n >= 0), xử lý vắt qua năm.
function shiftMonth(month, back) {
  const [y, m] = String(month).split('-').map(Number)
  const idx = y * 12 + (m - 1) - back
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

const inScopeOf = (scope) => (p) => !scope || scope === 'all' || p.warehouse_code === scope

// 3 tháng liền trước `month` (gần nhất trước): { month, grossProfit, weddingCount }.
export function buildPnlHistory({ projects, month, scope = 'all' } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return []
  const inScope = inScopeOf(scope)
  const counted = (projects || []).filter(
    (p) => p && REVENUE_STATUSES.includes(p.status) && inScope(p),
  )
  return [1, 2, 3].map((back) => {
    const m = shiftMonth(month, back)
    const ps = counted.filter((p) => monthOf(p.start_date) === m)
    return {
      month: m,
      grossProfit: ps.reduce((s, p) => s + (num(p.contractValue) - num(p.totalCost)), 0),
      weddingCount: ps.length,
    }
  })
}

// Gom dự án tính doanh thu của tháng theo nguồn khách.
export function calcBySource({ projects, month, scope = 'all' } = {}) {
  const inScope = inScopeOf(scope)
  const map = new Map()
  ;(projects || [])
    .filter(
      (p) =>
        p &&
        REVENUE_STATUSES.includes(p.status) &&
        monthOf(p.start_date) === month &&
        inScope(p),
    )
    .forEach((p) => {
      const source = p.lead_source || 'unknown'
      const row = map.get(source) || { source, count: 0, revenue: 0, grossProfit: 0 }
      row.count += 1
      row.revenue += num(p.contractValue)
      row.grossProfit += num(p.contractValue) - num(p.totalCost)
      map.set(source, row)
    })
  return [...map.values()].sort((a, b) => b.revenue - a.revenue)
}
