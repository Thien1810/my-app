// Mã vật tư theo mã nhóm có sẵn trong bảng item_categories: [TH|TSD]-[MÃ NHÓM]-[số 3 chữ số].
// Cùng thuật toán chống trùng với generateItemCode (formatters.js), chỉ khác là dùng thẳng mã nhóm.
export function generateItemCodeFromCategory(
  kind = 'consumable',
  categoryCode = '',
  existingItems = [],
  excludeId = null
) {
  const kindPrefix = kind === 'reusable' ? 'TSD' : 'TH'
  const catCode = String(categoryCode ?? '').trim().toUpperCase() || 'VT'
  const prefix = `${kindPrefix}-${catCode}-`

  const usedSet = new Set(
    existingItems
      .filter((i) => i.id !== excludeId && i.code)
      .map((i) => i.code.trim().toUpperCase())
  )

  let maxNum = 0
  for (const c of usedSet) {
    if (c.startsWith(prefix)) {
      const numPart = parseInt(c.slice(prefix.length), 10)
      if (!Number.isNaN(numPart) && numPart > maxNum) maxNum = numPart
    }
  }

  let candidateNum = maxNum + 1
  let candidate = `${prefix}${String(candidateNum).padStart(3, '0')}`
  while (usedSet.has(candidate)) {
    candidateNum += 1
    candidate = `${prefix}${String(candidateNum).padStart(3, '0')}`
  }
  return candidate
}
