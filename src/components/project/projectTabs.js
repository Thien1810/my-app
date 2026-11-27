const LEGACY_TABS = {
  plan: { tab: 'materials', sub: 'plan' },
  issue: { tab: 'materials', sub: 'issue' },
  return: { tab: 'materials', sub: 'return' },
  costs: { tab: 'money', sub: 'costs' },
  summary: { tab: 'money', sub: 'profit' },
  facebook: { tab: 'media' },
}

export const MATERIAL_TABS = [
  { id: 'plan', label: 'Kế hoạch' },
  { id: 'issue', label: 'Xuất' },
  { id: 'return', label: 'Thu hồi' },
  { id: 'history', label: 'Lịch sử phiếu' },
]

export const MONEY_TABS = [
  { id: 'costs', label: 'Chi phí' },
  { id: 'advances', label: 'Tạm ứng' },
  { id: 'profit', label: 'Lãi/Lỗ' },
]

export function resolveProjectTab(params, { isStaff, canEditCatalog, isManagerOrAdmin }) {
  const fallback = isStaff ? { tab: 'materials', sub: 'return' } : { tab: 'overview' }
  const requested = params.get('tab')
  const legacy = Object.hasOwn(LEGACY_TABS, requested) ? LEGACY_TABS[requested] : null
  const tab = legacy?.tab ?? requested
  const sub = legacy?.sub ?? params.get('sub')

  if (tab === 'overview' || tab === 'media') return { tab }
  if (tab === 'quote' && canEditCatalog) return { tab }
  if (tab === 'materials') {
    const allowed = MATERIAL_TABS.some((entry) => entry.id === sub && (!isStaff || sub !== 'issue'))
    return { tab, sub: allowed ? sub : isStaff ? 'return' : 'plan' }
  }
  if (tab === 'money' && isManagerOrAdmin) {
    return { tab, sub: MONEY_TABS.some((entry) => entry.id === sub) ? sub : 'costs' }
  }
  return fallback
}

export function projectTabSearch(params, tab, sub) {
  const next = new URLSearchParams(params)
  next.set('tab', tab)
  if (sub) next.set('sub', sub)
  else next.delete('sub')
  return `?${next.toString()}`
}
