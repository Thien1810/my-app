// P&L quản trị theo FINANCE_SPEC.md — hàm thuần, không DB/React/localStorage.
//
// QUYẾT ĐỊNH TỰ CHỌN (SPEC không nói rõ):
// 1. Ads có warehouse_code null: coi như chi phí chung, chia theo share kho
//    (giống chi phí cứng chung). Ads có warehouse_code thì tính thẳng kho đó.
// 2. Thu nhập khác (forfeit): bên gọi gắn warehouse_code (kho của dự án) vào từng dòng
//    advances. Có kho thì tính THẲNG kho đó; không có kho (dự án chưa gán kho/không rõ)
//    mới chia theo share. Tổng các kho = toàn công ty. Số tiền luôn lấy giá trị tuyệt đối.
// 3. share được chuẩn hóa (share / tổng share). Tổng = 0 => chia đều cho các kho có trong shares.
// 4. Dự án không có warehouse_code: chỉ vào scope 'all' (và `unassigned` của kết quả),
//    không thuộc kho nào.
// 5. Theo scope kho, CAC/ROAS/CIR/CPL dùng Ads đã phân bổ cho kho đó.
// 6. Điểm hòa vốn dùng history do bên gọi truyền (đúng scope bên gọi muốn).

const REVENUE_STATUSES = ['preparing', 'in_progress', 'awaiting_return', 'done']
const PAID_SOURCES = ['meta_ads', 'tiktok_ads']

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const monthOf = (v) => (typeof v === 'string' ? v.slice(0, 7) : '')
const div = (a, b) => (b > 0 ? a / b : null)
const pct = (a, b) => (b ? (a / b) * 100 : 0)

function normalizeShares(shares) {
  const list = (shares || []).filter((s) => s && s.code)
  const total = list.reduce((s, x) => s + Math.max(0, num(x.share)), 0)
  const map = {}
  list.forEach((s) => {
    map[s.code] = total > 0 ? Math.max(0, num(s.share)) / total : 1 / list.length
  })
  return map
}

export function calcPnl({
  month,
  scope = 'all',
  projects,
  adsRows,
  fixedCosts,
  shares,
  advances,
  history,
} = {}) {
  const shareMap = normalizeShares(shares)
  const isAll = scope === 'all' || !scope
  const shareOf = (code) => shareMap[code] || 0

  // --- Dự án ---
  const inMonth = (projects || []).filter((p) => p && monthOf(p.start_date) === month)
  const counted = inMonth.filter((p) => REVENUE_STATUSES.includes(p.status))
  const quotes = inMonth.filter((p) => p.status === 'quote')
  const inScope = (p) => isAll || p.warehouse_code === scope
  const scopedProjects = counted.filter(inScope)
  const scopedQuotes = quotes.filter(inScope)

  const revenue = scopedProjects.reduce((s, p) => s + num(p.contractValue), 0)
  const rotatingCost = scopedProjects.reduce((s, p) => s + num(p.totalCost), 0)
  const grossProfit = revenue - rotatingCost
  const expectedRevenue = scopedQuotes.reduce((s, p) => s + num(p.contractValue), 0)

  const paidProjects = scopedProjects.filter((p) => PAID_SOURCES.includes(p.lead_source))
  const paidAdsRevenue = paidProjects.reduce((s, p) => s + num(p.contractValue), 0)
  const unknownSourceCount = scopedProjects.filter(
    (p) => !p.lead_source || p.lead_source === 'unknown'
  ).length

  // --- Ads ---
  const adsMonth = (adsRows || []).filter(
    (r) => r && (monthOf(r.spend_date) || monthOf(r.month)) === month
  )
  const adsDirect = (code) =>
    adsMonth.filter((r) => r.warehouse_code === code).reduce((s, r) => s + num(r.spend), 0)
  const adsSharedPool = adsMonth
    .filter((r) => !r.warehouse_code)
    .reduce((s, r) => s + num(r.spend), 0)
  const adsTotal = adsMonth.reduce((s, r) => s + num(r.spend), 0)
  const adsOf = (code) => adsDirect(code) + adsSharedPool * shareOf(code)
  const adsSpend = isAll ? adsTotal : adsOf(scope)

  const leadsTotal = adsMonth.reduce((s, r) => {
    const raw = num(r.messages) + num(r.leads)
    if (isAll) return s + raw
    if (r.warehouse_code === scope) return s + raw
    if (!r.warehouse_code) return s + raw * shareOf(scope)
    return s
  }, 0)

  // --- Chi phí cứng ---
  const fixedMonth = (fixedCosts || []).filter((r) => r && monthOf(r.month) === month)
  const fixedDirectOf = (code) =>
    fixedMonth.filter((r) => r.warehouse_code === code).reduce((s, r) => s + num(r.amount), 0)
  const fixedPool = fixedMonth
    .filter((r) => !r.warehouse_code)
    .reduce((s, r) => s + num(r.amount), 0)
  const fixedTotalAll = fixedMonth.reduce((s, r) => s + num(r.amount), 0)
  const fixedCostTotal = isAll ? fixedTotalAll : fixedDirectOf(scope) + fixedPool * shareOf(scope)

  // --- Thu nhập khác (forfeit) ---
  const forfeitMonth = (advances || []).filter(
    (a) => a && a.kind === 'forfeit' && monthOf(a.received_date) === month
  )
  const forfeitAmt = (a) => Math.abs(num(a.amount))
  const otherIncomeAll = forfeitMonth.reduce((s, a) => s + forfeitAmt(a), 0)
  const otherDirectOf = (code) =>
    forfeitMonth.filter((a) => a.warehouse_code === code).reduce((s, a) => s + forfeitAmt(a), 0)
  const otherPool = forfeitMonth
    .filter((a) => !a.warehouse_code)
    .reduce((s, a) => s + forfeitAmt(a), 0)
  const otherOf = (code) => otherDirectOf(code) + otherPool * shareOf(code)
  const otherIncome = isAll ? otherIncomeAll : otherOf(scope)

  const netProfit = grossProfit - adsSpend - fixedCostTotal + otherIncome

  // --- Hòa vốn ---
  const hist = Array.isArray(history) ? history : []
  const histGross = hist.reduce((s, h) => s + num(h && h.grossProfit), 0)
  const histCount = hist.reduce((s, h) => s + num(h && h.weddingCount), 0)
  const avgGross = histCount > 0 ? histGross / histCount : 0
  let breakEven = null
  let breakEvenNote = 'chưa đủ dữ liệu'
  if (avgGross > 0) {
    breakEven = Math.ceil((fixedCostTotal + adsSpend) / avgGross)
    breakEvenNote = ''
  }

  const result = {
    revenue,
    expectedRevenue,
    rotatingCost,
    grossProfit,
    grossMarginPct: pct(grossProfit, revenue),
    adsSpend,
    fixedCostTotal,
    otherIncome,
    netProfit,
    netMarginPct: pct(netProfit, revenue),
    cac: div(adsSpend, paidProjects.length),
    roas: div(paidAdsRevenue, adsSpend),
    cir: div(adsSpend, paidAdsRevenue),
    cpl: div(adsSpend, leadsTotal),
    paidAdsRevenue,
    paidAdsProjectCount: paidProjects.length,
    unknownSourceCount,
    breakEven,
    breakEvenNote,
  }

  if (isAll) {
    const codes = new Set(Object.keys(shareMap))
    ;[...counted, ...adsMonth, ...fixedMonth, ...forfeitMonth].forEach((x) => {
      if (x.warehouse_code) codes.add(x.warehouse_code)
    })
    result.byWarehouse = [...codes].map((code) => {
      const ps = counted.filter((p) => p.warehouse_code === code)
      const wRevenue = ps.reduce((s, p) => s + num(p.contractValue), 0)
      const wRotating = ps.reduce((s, p) => s + num(p.totalCost), 0)
      const wGross = wRevenue - wRotating
      const wAds = adsOf(code)
      const fixedDirect = fixedDirectOf(code)
      const fixedShared = fixedPool * shareOf(code)
      const wFixed = fixedDirect + fixedShared
      const wOther = otherOf(code)
      return {
        code,
        revenue: wRevenue,
        rotatingCost: wRotating,
        grossProfit: wGross,
        adsSpend: wAds,
        fixedDirect,
        fixedShared,
        fixedCostTotal: wFixed,
        otherIncome: wOther,
        netProfit: wGross - wAds - wFixed + wOther,
      }
    })
    const un = counted.filter((p) => !p.warehouse_code)
    result.unassigned = {
      revenue: un.reduce((s, p) => s + num(p.contractValue), 0),
      rotatingCost: un.reduce((s, p) => s + num(p.totalCost), 0),
      projectCount: un.length,
    }
  }

  return result
}
