// Yêu cầu với chỗ gọi:
// 1. `items` phải lấy từ view item_stock (có cột in_stock), không phải bảng items thô.
// 2. generateCategoryCode cần TOÀN BỘ bảng nhóm, kể cả nhóm đang ngưng, để mã không bị trùng.
// 3. groupItemsByKindAndCategory cần cả nhóm đang ngưng, để vật tư thuộc nhóm ngưng vẫn hiện đúng chỗ.
// Mọi hàm nhận `categories` đều coi null/undefined là [].
import { extractItemColor, ITEM_CATEGORY_PRESETS, KIND_LABELS, toCategoryCode } from './formatters'
import { stripAccents } from './itemSearch'

const collator = new Intl.Collator('vi')
// Mã vật tư sắp theo số: TSD-2 đứng trước TSD-10.
const itemCollator = new Intl.Collator('vi', { numeric: true })
const UNKNOWN_KIND = 'unknown'
const UNKNOWN_KIND_LABEL = 'Chưa rõ loại'
const VIRTUAL_SORT_BASE = 100

function list(value) {
  return value ?? []
}

// Dấu câu chỉ ngăn cách từ; ký hiệu & không được chuyển thành từ "và".
export function normalizeCategoryName(name) {
  return stripAccents(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function findDuplicateCategory(name, parentId, categories, excludeId = null) {
  const normalized = normalizeCategoryName(name)
  if (!normalized) return null
  return list(categories).find((category) => (
    (excludeId == null || categoryIdKey(category.id) !== categoryIdKey(excludeId)) &&
    categoryIdKey(category.parent_id) === categoryIdKey(parentId) &&
    normalizeCategoryName(category.name) === normalized
  )) ?? null
}

// Chấp nhận một lần thêm, bớt, thay hoặc đảo hai ký tự liền nhau cho tên đủ dài (>= 4 ký tự).
function hasSmallEdit(a, b) {
  if (a === b) return false
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length < 4 || longer.length - shorter.length > 1) return false

  let mismatch = 0
  while (mismatch < shorter.length && shorter[mismatch] === longer[mismatch]) mismatch += 1
  if (shorter.length !== longer.length) return shorter.slice(mismatch) === longer.slice(mismatch + 1)
  if (shorter.slice(mismatch + 1) === longer.slice(mismatch + 1)) return true
  return shorter[mismatch] === longer[mismatch + 1] && shorter[mismatch + 1] === longer[mismatch] &&
    shorter.slice(mismatch + 2) === longer.slice(mismatch + 2)
}

// Chỉ từ >= 3 ký tự và không toàn số mới đáng để so từ chung.
function meaningfulWords(normalized) {
  return new Set(normalized.split(' ').filter((word) => word.length >= 3 && !/^\p{N}+$/u.test(word)))
}

// Chứa nhau theo ranh giới từ: "hoa" không nằm trong "khoa".
function containsWords(haystack, needle) {
  return ` ${haystack} `.includes(` ${needle} `)
}

export function findSimilarCategories(name, categories, limit = 3, excludeId = null) {
  const normalized = normalizeCategoryName(name)
  if (!normalized || limit <= 0) return []

  const words = meaningfulWords(normalized)
  const suggestions = []
  for (const category of list(categories)) {
    if (excludeId != null && categoryIdKey(category.id) === categoryIdKey(excludeId)) continue
    const candidate = normalizeCategoryName(category.name)
    if (!candidate) continue

    // Trùng hẳn vẫn trả ra (kể cả ở nhóm cha khác) để người dùng biết đã có.
    const exact = candidate === normalized
    const candidateWords = meaningfulWords(candidate)
    const shared = [...words].filter((word) => candidateWords.has(word)).length
    const contains = Math.min(candidate.length, normalized.length) >= 3 &&
      (containsWords(candidate, normalized) || containsWords(normalized, candidate))
    const smallEdit = hasSmallEdit(normalized, candidate)
    if (!exact && !shared && !contains && !smallEdit) continue

    const union = words.size + candidateWords.size - shared
    const overlap = union > 0 ? shared / union : 0
    suggestions.push({
      category,
      score: (exact ? 3 : 0) + Number(contains) + Number(smallEdit) + overlap,
    })
  }

  return suggestions
    .sort((a, b) => b.score - a.score || compareCategories(a.category, b.category))
    .slice(0, limit)
    .map(({ category }) => category)
}

export function generateCategoryCode(name, categories) {
  const normalized = normalizeCategoryName(name)
  const preset = ITEM_CATEGORY_PRESETS.find((category) => normalizeCategoryName(category.name) === normalized)
  const base = preset?.code ?? toCategoryCode(normalized)
  const used = new Set(list(categories).map((category) => String(category.code ?? '').trim().toUpperCase()))

  let code = base
  for (let n = 2; used.has(code); n += 1) {
    const suffix = String(n)
    code = base.slice(0, 8 - suffix.length) + suffix
  }
  return code
}

// Nhóm ảo lấy từ chữ category cũ của vật tư. Mã không trùng mã nhóm thật (existingCategories);
// sort_order từ 100 để xếp sau nhóm chuẩn.
export function deriveCategoriesFromItems(items, existingCategories = []) {
  const existing = list(existingCategories)
  const categories = new Map()
  for (const item of list(items)) {
    const name = String(item?.category ?? '').trim().replace(/\s+/g, ' ')
    const normalized = normalizeCategoryName(name)
    if (!normalized || categories.has(normalized)) continue

    categories.set(normalized, {
      id: null,
      virtual: true,
      name,
      code: generateCategoryCode(name, [...existing, ...categories.values()]),
      parent_id: null,
      sort_order: VIRTUAL_SORT_BASE + categories.size,
      active: true,
    })
  }
  return [...categories.values()]
}

function compareCategories(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || collator.compare(a.name, b.name)
}

function isLowStock(item) {
  const minimum = Number(item.min_stock || 0)
  return minimum > 0 && Number(item.in_stock || 0) < minimum
}

function compareItemsByName(a, b) {
  return itemCollator.compare(a.name ?? '', b.name ?? '') || itemCollator.compare(a.code ?? '', b.code ?? '')
}

// Cảnh báo đứng trước, rồi tồn tăng dần. Ngày thiếu hoặc sai đứng cuối khi sắp ngày tạo.
export function sortItems(items, sortBy = 'name') {
  return [...list(items)].sort((a, b) => {
    if (sortBy === 'code') {
      return itemCollator.compare(a.code ?? '', b.code ?? '') || compareItemsByName(a, b)
    }
    if (sortBy === 'lowStock') {
      return Number(isLowStock(b)) - Number(isLowStock(a)) ||
        Number(a.in_stock || 0) - Number(b.in_stock || 0) || compareItemsByName(a, b)
    }
    if (sortBy === 'newest') {
      const aTime = Date.parse(a.created_at)
      const bTime = Date.parse(b.created_at)
      const aDate = Number.isNaN(aTime) ? -Infinity : aTime
      const bDate = Number.isNaN(bTime) ? -Infinity : bTime
      return bDate - aDate || compareItemsByName(a, b)
    }
    return compareItemsByName(a, b)
  })
}

function categoryIdKey(id) {
  return id == null || id === '' ? null : String(id)
}

function indexCategoriesById(categories) {
  return new Map(categories.filter(({ id }) => categoryIdKey(id) !== null)
    .map((category) => [categoryIdKey(category.id), category]))
}

// Giữ nhóm mồ côi ở cấp gốc để dữ liệu cũ vẫn hiện trong cây hai cấp.
function findRootParent(category, byId) {
  const parent = byId.get(categoryIdKey(category.parent_id))
  return categoryIdKey(parent?.parent_id) === null ? parent : undefined
}

export function groupItemsByKindAndCategory(items, categories, {
  kind = 'all',
  search = '',
  sortBy = 'name',
  hideInactive = true,
  hideEmpty = true,
} = {}) {
  items = list(items).filter(Boolean)
  categories = list(categories)
  const byId = indexCategoriesById(categories)

  // Trùng tên chuẩn hóa: ưu tiên nhóm gốc; mơ hồ (null) khi >= 2 nhóm gốc trùng,
  // hoặc khi không có nhóm gốc nào mà có >= 2 nhóm con trùng.
  const namedGroups = new Map()
  for (const category of categories) {
    const normalized = normalizeCategoryName(category.name)
    if (!normalized) continue
    if (!namedGroups.has(normalized)) namedGroups.set(normalized, [])
    namedGroups.get(normalized).push(category)
  }
  const byName = new Map()
  for (const [normalized, candidates] of namedGroups) {
    const roots = candidates.filter((category) => !findRootParent(category, byId))
    const pool = roots.length > 0 ? roots : candidates
    byName.set(normalized, pool.length === 1 ? pool[0] : null)
  }

  // Giữ tên nhóm cũ kể cả khi đã có bảng danh mục nhưng chưa có nhóm tương ứng.
  const virtualCategories = deriveCategoriesFromItems(items.filter((item) => (
    !byId.has(categoryIdKey(item.category_id)) && !byName.has(normalizeCategoryName(item.category))
  )), categories)
  for (const category of virtualCategories) {
    byName.set(normalizeCategoryName(category.name), category)
  }

  const unassigned = {
    id: null,
    virtual: true,
    name: 'Chưa phân nhóm',
    code: '',
    parent_id: null,
    sort_order: Infinity,
    active: true,
  }
  const allCategories = [...categories, ...virtualCategories].sort(compareCategories)
  allCategories.push(unassigned)
  const fold = (value) => stripAccents(value).replace(/\s+/g, ' ')
  const query = fold(search).trim()
  const categoryQuery = normalizeCategoryName(search)
  const byKind = new Map()
  // Tái sử dụng (TSD) đứng trước tiêu hao (TH) theo thứ tự hiển thị của kho.
  for (const itemKind of ['reusable', 'consumable']) {
    if (kind === 'all' || kind === itemKind) byKind.set(itemKind, new Map())
  }
  // Vật tư kind null/lạ vào mục riêng ở cuối để không mất khỏi số đếm.
  if (kind === 'all' || kind === UNKNOWN_KIND) byKind.set(UNKNOWN_KIND, new Map())

  for (const item of items) {
    const itemKind = item.kind === 'reusable' || item.kind === 'consumable' ? item.kind : UNKNOWN_KIND
    const assignments = byKind.get(itemKind)
    // Chỉ lọc trạng thái vật tư. Vật tư đang dùng vẫn hiện nếu nhóm đã ngưng.
    if (!assignments || (hideInactive && item.active === false)) continue

    const category = byId.get(categoryIdKey(item.category_id)) ??
      byName.get(normalizeCategoryName(item.category)) ?? unassigned
    if (query) {
      const parent = findRootParent(category, byId)
      const searchFields = [item.name, item.code, item.category, extractItemColor(item), category.name, parent?.name]
      const matchesCategory = categoryQuery && [item.category, category.name, parent?.name]
        .some((name) => normalizeCategoryName(name).includes(categoryQuery))
      if (!matchesCategory && !searchFields.some((field) => fold(field).includes(query))) continue
    }

    if (!assignments.has(category)) assignments.set(category, [])
    assignments.get(category).push(item)
  }

  return [...byKind].map(([itemKind, assignments]) => {
    const groups = []
    const summaries = new Map()
    for (const category of allCategories) {
      const directItems = sortItems(assignments.get(category) ?? [], sortBy)
      summaries.set(category, {
        category,
        items: directItems,
        itemCount: directItems.length,
        lowStockCount: directItems.filter(isLowStock).length,
        subgroups: [],
      })
    }

    // Mảng vật tư của cha chỉ chứa mục trực tiếp. Hai số đếm của cha cộng cả mục cấp con.
    for (const [category, summary] of summaries) {
      const parent = findRootParent(category, byId)
      if (!parent) {
        groups.push(summary)
      } else if (!hideEmpty || summary.itemCount > 0) {
        const { subgroups: _subgroups, ...subgroup } = summary
        const parentSummary = summaries.get(parent)
        parentSummary.subgroups.push(subgroup)
        parentSummary.itemCount += summary.itemCount
        parentSummary.lowStockCount += summary.lowStockCount
      }
    }

    return {
      kind: itemKind,
      label: itemKind === UNKNOWN_KIND ? UNKNOWN_KIND_LABEL : KIND_LABELS[itemKind],
      itemCount: groups.reduce((total, group) => total + group.itemCount, 0),
      lowStockCount: groups.reduce((total, group) => total + group.lowStockCount, 0),
      groups: hideEmpty ? groups.filter((group) => group.itemCount > 0) : groups,
    }
  }).filter((section) => (
    section.kind === UNKNOWN_KIND ? section.itemCount > 0 : !hideEmpty || section.itemCount > 0
  ))
}

export function isItemCodeLocked(_item, movementCount) {
  return movementCount > 0
}

// Giá trị để lưu là ID danh mục; dấu gạch hiển thị mục con trong danh sách phẳng.
// Nhóm cha đang ngưng mà còn con hiện ra thì hiện làm dòng tiêu đề disabled:true (không chọn được).
// Nhóm không tìm thấy cha được xem như nhóm gốc, không có tiền tố.
export function buildCategoryOptions(categories, selectedId = null) {
  const all = list(categories)
  const selectedKey = categoryIdKey(selectedId)
  const byId = indexCategoriesById(all)
  const sorted = [...all].sort(compareCategories)
  const chosen = new Set(sorted.filter((category) => (
    category.active !== false || (selectedKey !== null && categoryIdKey(category.id) === selectedKey)
  )))
  const headers = new Set()
  for (const category of chosen) {
    const parent = findRootParent(category, byId)
    if (parent && !chosen.has(parent)) headers.add(parent)
  }

  const roots = []
  const children = new Map()
  for (const category of sorted) {
    if (!chosen.has(category) && !headers.has(category)) continue
    const parent = findRootParent(category, byId)
    const option = {
      ...category,
      value: category.id,
      label: parent ? `— ${category.name}` : category.name,
      ...(headers.has(category) ? { disabled: true } : {}),
    }
    if (!parent) {
      roots.push({ category, option })
    } else {
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(option)
    }
  }

  return roots.flatMap(({ category, option }) => [option, ...(children.get(category) ?? [])])
}
