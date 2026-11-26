export function datesOverlap(startA, endA, startB, endB) {
  const sA = startA || endA
  const eA = endA || startA
  const sB = startB || endB
  const eB = endB || startB
  if (!sA || !eA || !sB || !eB) return false
  return sA <= eB && sB <= eA
}

const round2 = (n) => Math.round(n * 100) / 100

// Khoảng ngày [start, end] dạng 'YYYY-MM-DD' của dự án (thiếu một đầu thì lấy đầu kia), null nếu không có ngày.
function projectRange(p) {
  const s = p?.start_date || p?.end_date
  const e = p?.end_date || p?.start_date
  if (!s || !e) return null
  const a = String(s).slice(0, 10)
  const b = String(e).slice(0, 10)
  return a <= b ? [a, b] : [b, a]
}

// Danh sách ngày trong khoảng (tối đa maxDays ngày để tránh dữ liệu sai làm treo trang).
function listDays(start, end, maxDays = 400) {
  const days = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime())) return [start]
  while (d <= last && days.length < maxDays) {
    days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days.length > 0 ? days : [start]
}

/**
 * Số đồ TÁI SỬ DỤNG còn ở từng dự án = đã xuất − (thu tốt + hỏng + mất), không âm.
 * movements: [{ project_id, item_id, type, qty }]. Trả Map<project_id, Map<item_id, qty>>.
 */
export function calcProjectOutstandingByItem(movements, itemStockMap) {
  const raw = new Map()
  for (const m of movements || []) {
    if (m?.project_id == null) continue
    const itemId = Number(m.item_id)
    const item = itemStockMap?.get(itemId)
    if (!item || item.kind !== 'reusable') continue
    const qty = Number(m.qty || 0)
    let sign = 0
    if (m.type === 'issue') sign = 1
    else if (m.type === 'return_good' || m.type === 'return_damaged' || m.type === 'return_lost') sign = -1
    if (!sign) continue
    const pid = Number(m.project_id)
    if (!raw.has(pid)) raw.set(pid, new Map())
    const byItem = raw.get(pid)
    byItem.set(itemId, (byItem.get(itemId) || 0) + sign * qty)
  }
  for (const byItem of raw.values()) {
    for (const [itemId, q] of byItem) byItem.set(itemId, Math.max(0, round2(q)))
  }
  return raw
}

/**
 * Cảnh báo thiếu đồ tái sử dụng khi trùng lịch giữa các dự án.
 *
 * - Phần đang giữ của một dự án = max(SL kế hoạch, đã xuất − đã thu/hỏng/mất).
 * - Dự án khác đang hoạt động (không phải done/cancelled) mà trùng lịch: giữ phần đó trong
 *   những ngày nằm trong lịch của nó; ngoài lịch chỉ còn tính phần đã xuất chưa thu về.
 * - Dự án khác không trùng lịch, hoặc đã xong/đã hủy: phần đã xuất chưa thu về bị trừ khỏi
 *   sẵn có (lockedElsewhere).
 * - Nhu cầu lấy ĐỈNH theo từng ngày trong khoảng của dự án hiện tại (totalPlanned), không cộng
 *   chung các dự án không trùng nhau.
 *
 * options.movements: phiếu kho của mọi dự án [{ project_id, item_id, type, qty }]. Không truyền
 * thì chỉ dựa vào kế hoạch (như trước). Sở hữu = in_stock + at_project của item_stock.
 */
export function calcScheduleConflicts(currentProject, allProjects, allPlans, itemStockMap, options = {}) {
  const conflicts = {}
  if (!currentProject) return conflicts
  const map = itemStockMap || new Map()
  const outstanding = Array.isArray(options?.movements)
    ? calcProjectOutstandingByItem(options.movements, map)
    : new Map()

  const curId = Number(currentProject.id)
  const projects = new Map()
  for (const p of allProjects || []) projects.set(Number(p.id), p)
  projects.set(curId, { ...projects.get(curId), ...currentProject })

  // Kế hoạch đồ tái sử dụng theo dự án
  const planByProject = new Map()
  for (const plan of allPlans || []) {
    const itemId = Number(plan.item_id)
    const item = map.get(itemId)
    if (!item || item.kind !== 'reusable') continue
    const pid = Number(plan.project_id)
    if (!planByProject.has(pid)) planByProject.set(pid, new Map())
    const byItem = planByProject.get(pid)
    byItem.set(itemId, (byItem.get(itemId) || 0) + Number(plan.qty || 0))
  }

  const curRange = projectRange(currentProject)
  const days = curRange ? listDays(curRange[0], curRange[1]) : [null]
  const isActive = (p) => p.status !== 'cancelled' && p.status !== 'done'

  // Mỗi vật tư: phần của dự án hiện tại, các dự án trùng lịch, phần bị giữ ở nơi khác
  const perItem = new Map()
  const ensure = (itemId) => {
    if (!perItem.has(itemId)) {
      perItem.set(itemId, { current: 0, overlapping: [], locked: 0, lockedProjects: [] })
    }
    return perItem.get(itemId)
  }

  for (const [pid, p] of projects) {
    const plan = planByProject.get(pid) || new Map()
    const out = outstanding.get(pid) || new Map()
    const itemIds = new Set([...plan.keys(), ...out.keys()])
    if (pid === curId) {
      for (const itemId of itemIds) {
        const held = Math.max(plan.get(itemId) || 0, out.get(itemId) || 0)
        if (held > 0) ensure(itemId).current = held
      }
      continue
    }
    const range = projectRange(p)
    const overlaps =
      isActive(p) && !!curRange && !!range && datesOverlap(curRange[0], curRange[1], range[0], range[1])
    for (const itemId of itemIds) {
      const planned = plan.get(itemId) || 0
      const o = out.get(itemId) || 0
      if (overlaps) {
        const held = Math.max(planned, o)
        if (held > 0) ensure(itemId).overlapping.push({ project: p, range, held, out: o })
      } else if (o > 0) {
        const row = ensure(itemId)
        row.locked += o
        row.lockedProjects.push({ id: p.id, name: p.name, qty: o })
      }
    }
  }

  for (const [itemId, row] of perItem) {
    if (row.current <= 0 && row.overlapping.length === 0) continue
    const item = map.get(itemId)
    if (!item) continue
    let peak = -Infinity
    let peakDate = null
    for (const day of days) {
      let demand = row.current
      for (const o of row.overlapping) {
        const inRange = day && day >= o.range[0] && day <= o.range[1]
        demand += inRange ? o.held : o.out
      }
      if (demand > peak) {
        peak = demand
        peakDate = day
      }
    }
    const totalPlanned = round2(peak)
    const totalOwned = Number(item.in_stock || 0) + Number(item.at_project || 0)
    const lockedElsewhere = round2(row.locked)
    const available = round2(totalOwned - lockedElsewhere)
    const shortage = Math.max(0, round2(totalPlanned - available))
    conflicts[itemId] = {
      itemId,
      totalPlanned,
      totalOwned,
      lockedElsewhere,
      available,
      peakDate,
      shortage,
      hasShortage: shortage > 0,
      otherProjects: row.overlapping.map((o) => ({ id: o.project.id, name: o.project.name, qty: o.held })),
      lockedProjects: row.lockedProjects,
    }
  }

  return conflicts
}

/**
 * Tổng hợp số lượng xuất/thu hồi của từng vật tư trong 1 dự án
 */
export function calcProjectItemStats(movements, itemStockMap) {
  const byItem = new Map()

  for (const m of movements || []) {
    const itemId = Number(m.item_id)
    const item = itemStockMap.get(itemId)
    if (!byItem.has(itemId)) {
      byItem.set(itemId, {
        item_id: itemId,
        item: item || {
          id: itemId,
          name: `Vật tư #${itemId}`,
          code: '',
          kind: 'consumable',
          unit: '',
          cost: 0,
          expected_uses: null,
        },
        issued: 0,
        return_good: 0,
        return_damaged: 0,
        return_lost: 0,
      })
    }
    const row = byItem.get(itemId)
    const qty = Number(m.qty || 0)
    if (m.type === 'issue') row.issued += qty
    else if (m.type === 'return_good') row.return_good += qty
    else if (m.type === 'return_damaged') row.return_damaged += qty
    else if (m.type === 'return_lost') row.return_lost += qty
  }

  const list = []
  for (const row of byItem.values()) {
    const isReusable = row.item.kind === 'reusable'
    const outstanding = isReusable
      ? Math.max(0, row.issued - row.return_good - row.return_damaged - row.return_lost)
      : 0
    const netConsumed = !isReusable
      ? Math.max(0, row.issued - row.return_good)
      : 0
    list.push({
      ...row,
      outstanding,
      netConsumed,
    })
  }
  return list
}

/**
 * Tính quyết toán tài chính dự án (Tổng kết)
 */
export function calcProjectFinancialSummary({
  movements,
  itemStockMap,
  otherCosts = [],
  contractValue = 0,
  discount = 0,
}) {
  const itemStats = calcProjectItemStats(movements, itemStockMap)

  let consumableCost = 0
  let depreciationCost = 0
  let damagedLostCost = 0
  const missingExpectedUsesItems = []

  const itemBreakdown = itemStats.map((row) => {
    const cost = Number(row.item.cost || 0)
    const isReusable = row.item.kind === 'reusable'
    let rowConsumable = 0
    let rowDepreciation = 0
    let rowDamagedLost = 0
    let missingExpectedUses = false

    if (!isReusable) {
      // SL hỏng/mất của đồ tiêu hao đã nằm trong (xuất - dư), không cộng thêm.
      rowConsumable = Math.max(0, row.issued - row.return_good) * cost
    } else {
      const expectedUses = Number(row.item.expected_uses || 0)
      if (expectedUses > 0) {
        rowDepreciation = (row.issued * cost) / expectedUses
      } else if (row.issued > 0) {
        missingExpectedUses = true
        missingExpectedUsesItems.push(row.item.name)
      }
      rowDamagedLost = (row.return_damaged + row.return_lost) * cost
    }

    consumableCost += rowConsumable
    depreciationCost += rowDepreciation
    damagedLostCost += rowDamagedLost

    return {
      ...row,
      cost,
      rowConsumable,
      rowDepreciation,
      rowDamagedLost,
      missingExpectedUses,
    }
  })

  const otherCostTotal = (otherCosts || []).reduce(
    (sum, c) => sum + Number(c.amount || 0),
    0
  )

  const totalCost = consumableCost + depreciationCost + damagedLostCost + otherCostTotal
  const contract = Number(contractValue || 0)
  const profit = contract - totalCost
  // contractValue = doanh thu (khách thực trả); ưu đãi âm/không hợp lệ coi là 0
  const disc = Math.max(0, Number(discount) || 0)
  const grossSales = contract + disc
  const marginPct = contract > 0 ? (profit / contract) * 100 : 0

  return {
    contractValue: contract,
    discount: disc,
    grossSales,
    marginPct,
    consumableCost,
    depreciationCost,
    damagedLostCost,
    otherCostTotal,
    totalCost,
    profit,
    itemBreakdown,
    missingExpectedUsesItems,
  }
}
