// Chuẩn hóa Sổ kho: gộp phiếu kho (stock_movements) và phiếu chuyển kho (stock_transfers)
// thành một mảng dòng chung, kèm bộ lọc thuần (dễ test).

export const LEDGER_TYPE_CHIPS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'purchase', label: 'Nhập mua' },
  { value: 'issue', label: 'Xuất' },
  { value: 'return', label: 'Thu hồi' },
  { value: 'adjust', label: 'Điều chỉnh' },
  { value: 'repair_dispose', label: 'Sửa/Thanh lý' },
  { value: 'transfer', label: 'Chuyển kho' },
]

const TYPE_GROUPS = {
  return: ['return_good', 'return_damaged', 'return_lost'],
  repair_dispose: ['repair_done', 'dispose'],
}

const dateOnly = (v) => (v ? String(v).slice(0, 10) : '')

export function removeDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

// Ngày hôm nay (YYYY-MM-DD) theo giờ Việt Nam.
export function vnTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts
}

// today: 'YYYY-MM-DD'. Trả về ngày cách today `days` ngày về trước.
export function defaultFromDate(today, days = 30) {
  const [y, m, d] = String(today).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

function whLabel(warehouses, code) {
  const w = (warehouses || []).find((x) => x.code === code)
  return w ? w.name || w.code : code || '?'
}

export function toLedgerRows({ movements = [], transfers = [], itemsById = {}, warehouses = [] } = {}) {
  // Tra tên vật tư cho phiếu chuyển: itemsById trước, rồi tới map từ movements.
  const fromMovements = new Map()
  for (const m of movements) {
    if (m.item && m.item_id != null) fromMovements.set(String(m.item_id), m.item)
  }

  const rows = []
  for (const m of movements) {
    rows.push({
      key: `m-${m.id}`,
      kind: 'movement',
      id: m.id,
      date: dateOnly(m.moved_at),
      type: m.type,
      itemId: m.item?.id ?? m.item_id ?? null,
      itemCode: m.item?.code || '',
      itemName: m.item?.name || '',
      itemKind: m.item?.kind || '',
      unit: m.item?.unit || '',
      qty: Number(m.qty || 0),
      unitCost: m.unit_cost != null ? Number(m.unit_cost) : null,
      projectId: m.project?.id ?? m.project_id ?? null,
      projectName: m.project?.name || '',
      partnerName: m.partner?.name || '',
      warehouseText: '',
      note: m.note || '',
    })
  }
  for (const t of transfers) {
    const it = itemsById[String(t.item_id)] || fromMovements.get(String(t.item_id)) || null
    rows.push({
      key: `t-${t.id}`,
      kind: 'transfer',
      id: t.id,
      date: dateOnly(t.transferred_at),
      type: 'transfer',
      itemId: t.item_id ?? null,
      itemCode: it?.code || '',
      itemName: it?.name || '',
      itemKind: it?.kind || '',
      unit: it?.unit || '',
      qty: Number(t.qty || 0),
      unitCost: null,
      projectId: null,
      projectName: '',
      partnerName: '',
      warehouseText: `${whLabel(warehouses, t.from_wh)} → ${whLabel(warehouses, t.to_wh)}`,
      note: t.note || '',
    })
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    const ai = Number(a.id)
    const bi = Number(b.id)
    if (ai !== bi) return bi - ai
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0
  })
  return rows
}

export function matchesType(rowType, filterType) {
  if (!filterType || filterType === 'all') return true
  const group = TYPE_GROUPS[filterType]
  if (group) return group.includes(rowType)
  return rowType === filterType
}

export function filterLedgerRows(rows, filters = {}) {
  const { from = '', to = '', type = 'all', itemKind = 'all', projectId = 'all', search = '' } = filters
  const q = removeDiacritics(search).trim()
  return rows.filter((r) => {
    if (from && r.date < from) return false
    if (to && r.date > to) return false
    if (!matchesType(r.type, type)) return false
    if (itemKind && itemKind !== 'all' && r.itemKind !== itemKind) return false
    if (projectId && projectId !== 'all' && String(r.projectId ?? '') !== String(projectId)) return false
    if (q) {
      const hay = removeDiacritics(
        [r.itemCode, r.itemName, r.note, r.partnerName, r.projectName].join(' ')
      )
      if (!hay.includes(q)) return false
    }
    return true
  })
}
