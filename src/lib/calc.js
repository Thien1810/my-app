export function datesOverlap(startA, endA, startB, endB) {
  const sA = startA || endA
  const eA = endA || startA
  const sB = startB || endB
  const eB = endB || startB
  if (!sA || !eA || !sB || !eB) return false
  return sA <= eB && sB <= eA
}

/**
 * Tính cảnh báo thiếu đồ tái sử dụng khi trùng lịch giữa các dự án
 * (loại trừ dự án cancelled/done).
 * So sánh tổng SL kế hoạch trong các dự án trùng lịch với tổng sở hữu (in_stock + at_project).
 */
export function calcScheduleConflicts(currentProject, allProjects, allPlans, itemStockMap) {
  const conflicts = {}
  if (!currentProject) return conflicts

  const activeProjects = (allProjects || []).filter(
    (p) => p.status !== 'cancelled' && p.status !== 'done'
  )

  const overlappingIds = new Set()
  overlappingIds.add(currentProject.id)

  for (const p of activeProjects) {
    if (p.id === currentProject.id) continue
    if (
      datesOverlap(
        currentProject.start_date,
        currentProject.end_date,
        p.start_date,
        p.end_date
      )
    ) {
      overlappingIds.add(p.id)
    }
  }

  // Cộng tổng qty theo item_id cho các dự án trùng lịch
  const plannedByItem = {}
  const projectsByItem = {}

  for (const plan of allPlans || []) {
    if (!overlappingIds.has(plan.project_id)) continue
    const item = itemStockMap.get(Number(plan.item_id))
    if (!item || item.kind !== 'reusable') continue

    const qty = Number(plan.qty || 0)
    plannedByItem[item.id] = (plannedByItem[item.id] || 0) + qty
    if (!projectsByItem[item.id]) projectsByItem[item.id] = []
    const proj = activeProjects.find((p) => p.id === plan.project_id)
    if (proj && proj.id !== currentProject.id) {
      projectsByItem[item.id].push({ id: proj.id, name: proj.name, qty })
    }
  }

  for (const [itemIdStr, totalPlanned] of Object.entries(plannedByItem)) {
    const itemId = Number(itemIdStr)
    const item = itemStockMap.get(itemId)
    if (!item) continue
    const totalOwned = Number(item.in_stock || 0) + Number(item.at_project || 0)
    const shortage = Math.max(0, totalPlanned - totalOwned)
    conflicts[itemId] = {
      itemId,
      totalPlanned,
      totalOwned,
      shortage,
      hasShortage: shortage > 0,
      otherProjects: projectsByItem[itemId] || [],
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

  return {
    contractValue: contract,
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
