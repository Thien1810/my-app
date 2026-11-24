import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  extractItemColor,
  formatColorWithIcon,
  formatCurrency,
  formatNumber,
  getColorSwatch,
  KIND_LABELS,
} from '../../lib/formatters'
import { groupItemsByKindAndCategory, sortItems } from '../../lib/itemCategories'
import CategoryManager from './CategoryManager'
import './ItemsList.css'

const STORAGE_GROUPED = 'itemsList.grouped'
const STORAGE_COLLAPSED = 'itemsList.collapsed'
const collator = new Intl.Collator('vi')

const KIND_TABS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'reusable', label: 'Tái sử dụng' },
  { value: 'consumable', label: 'Tiêu hao' },
]

const SORT_OPTIONS = [
  { value: 'name', label: 'Tên A-Z' },
  { value: 'code', label: 'Mã' },
  { value: 'lowStock', label: 'Tồn thấp trước' },
  { value: 'newest', label: 'Mới thêm' },
]

function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Trình duyệt chặn lưu trữ: bỏ qua, giao diện vẫn chạy.
  }
}

function isLowStock(item) {
  const minimum = Number(item.min_stock || 0)
  return minimum > 0 && Number(item.in_stock || 0) < minimum
}

function categoryKey(category) {
  return category.id != null ? String(category.id) : `v-${category.name}`
}

function Chevron({ open }) {
  return (
    <svg className={`items-list-chevron${open ? ' is-open' : ''}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KindTag({ kind }) {
  return (
    <span className={`ui-badge ${kind === 'reusable' ? 'ui-badge--info' : 'ui-badge--success'}`}>
      {KIND_LABELS[kind] || kind}
    </span>
  )
}

/**
 * Danh sách vật tư phân cấp (Loại > Nhóm > Nhóm con) hoặc danh sách phẳng.
 * Props: items, categories, canEditCatalog (sửa/ẩn), canDeleteCatalog (xóa và Quản lý nhóm, admin/manager),
 * showCost (hiện giá nhập), onEdit(item), onToggleActive(item), onDelete(item), onCategoriesChanged().
 */
export default function ItemsList({
  items,
  categories,
  canEditCatalog,
  canDeleteCatalog,
  showCost = true,
  onEdit,
  onToggleActive,
  onDelete,
  onCategoriesChanged,
}) {
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [colorFilter, setColorFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [grouped, setGrouped] = useState(() => readStorage(STORAGE_GROUPED, true) !== false)
  const [collapsed, setCollapsed] = useState(() => {
    const saved = readStorage(STORAGE_COLLAPSED, [])
    return new Set(Array.isArray(saved) ? saved : [])
  })
  const [menu, setMenu] = useState(null) // { id, up }
  const [managerOpen, setManagerOpen] = useState(false)
  const [preview, setPreview] = useState(null)

  useEffect(() => writeStorage(STORAGE_GROUPED, grouped), [grouped])
  useEffect(() => writeStorage(STORAGE_COLLAPSED, [...collapsed]), [collapsed])

  // Menu "⋯": đóng khi bấm ra ngoài hoặc nhấn Escape.
  const openMenuId = menu?.id ?? null
  useEffect(() => {
    if (openMenuId === null) return undefined
    const handlePointer = (event) => {
      const owner = event.target.closest?.('[data-items-menu]')
      if (owner?.dataset.itemsMenu !== String(openMenuId)) setMenu(null)
    }
    const handleKey = (event) => {
      if (event.key !== 'Escape') return
      setMenu(null)
      document.querySelector(`[data-items-menu="${openMenuId}"] button`)?.focus()
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openMenuId])

  useEffect(() => {
    if (!preview) return undefined
    const handleKey = (event) => {
      if (event.key === 'Escape') setPreview(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [preview])

  const colors = useMemo(() => (
    [...new Set(items.map((item) => extractItemColor(item)).filter(Boolean))].sort((a, b) => collator.compare(a, b))
  ), [items])

  const scoped = useMemo(
    () => items.filter((item) => showInactive || item.active !== false),
    [items, showInactive],
  )
  const summary = useMemo(() => ({
    total: scoped.length,
    reusable: scoped.filter((item) => item.kind === 'reusable').length,
    consumable: scoped.filter((item) => item.kind === 'consumable').length,
    low: scoped.filter(isLowStock).length,
  }), [scoped])

  const sections = useMemo(() => {
    const filtered = colorFilter === 'all' ? items : items.filter((item) => extractItemColor(item) === colorFilter)
    return groupItemsByKindAndCategory(filtered, categories, {
      kind,
      search,
      sortBy,
      hideInactive: !showInactive,
    })
  }, [items, categories, kind, search, sortBy, showInactive, colorFilter])

  const flatItems = useMemo(() => {
    if (grouped) return []
    const all = sections.flatMap((section) => section.groups.flatMap((group) => [
      ...group.items,
      ...group.subgroups.flatMap((subgroup) => subgroup.items),
    ]))
    return sortItems(all, sortBy)
  }, [grouped, sections, sortBy])

  const resultCount = grouped
    ? sections.reduce((total, section) => total + section.itemCount, 0)
    : flatItems.length
  const searching = search.trim() !== ''
  const filtering = searching || kind !== 'all' || colorFilter !== 'all'
  const isCollapsed = (key) => !searching && collapsed.has(key)
  const toggleCollapsed = (key) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const clearFilters = () => {
    setKind('all')
    setSearch('')
    setColorFilter('all')
  }

  const openMenu = (event, item) => {
    if (menu?.id === item.id) {
      setMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const up = window.innerHeight - rect.bottom < 240 && rect.top > 240
    setMenu({ id: item.id, up })
  }

  const renderRow = (item, showCategory) => {
    const low = isLowStock(item)
    const color = extractItemColor(item)
    const swatch = getColorSwatch(color)
    const minStock = Number(item.min_stock || 0)
    const inactive = item.active === false
    const details = []
    if (item.kind === 'reusable') details.push(`Ở dự án ${formatNumber(item.at_project)}`)
    if (Number(item.in_repair || 0) > 0) details.push(`Chờ sửa ${formatNumber(item.in_repair)}`)
    const isOpen = menu?.id === item.id

    return (
      <li key={item.id} className={`items-list-row${inactive ? ' is-inactive' : ''}`}>
        {item.image_url ? (
          <button
            type="button"
            className="items-list-thumb"
            aria-label={`Phóng to ảnh ${item.name}`}
            onClick={() => setPreview({ url: item.image_url, name: item.name })}
          >
            <img src={item.image_url} alt="" loading="lazy" />
          </button>
        ) : (
          <div className="items-list-thumb is-empty" aria-hidden="true">🖼️</div>
        )}

        <div className="items-list-main">
          <Link to={`/vat-tu/${item.id}`} className="items-list-name">
            {item.name}
          </Link>
          <div className="items-list-sub">
            {showCategory && <KindTag kind={item.kind} />}
            {inactive && <span className="ui-badge ui-badge--neutral">Ngưng dùng</span>}
            <code>{item.code || `#${item.id}`}</code>
            {color && (
              <span className="items-list-color">
                <span
                  className="items-list-dot"
                  style={{ backgroundColor: swatch?.hex || '#e2e8f0', borderColor: swatch?.border || '#94a3b8' }}
                />
                {color}
              </span>
            )}
            {showCategory && item.category && <span className="items-list-cat">{item.category}</span>}
          </div>
        </div>

        <div className="items-list-meta">
          <div className="items-list-stock" title="Số trong kho">
            <span className="items-list-stock__label">Trong kho</span>
            <span className={`items-list-stock__num${low ? ' is-low' : ''}`}>{formatNumber(item.in_stock)}</span>
            {item.unit && <span className="items-list-stock__unit"> {item.unit}</span>}
            {details.length > 0 && <span className="items-list-stock__detail">{details.join(' · ')}</span>}
          </div>
          {showCost && (
            <div className="items-list-cost">
              <span className="items-list-cost__label">Giá nhập</span>
              {formatCurrency(item.cost)}
            </div>
          )}
          <div className="items-list-alert">
            {low ? (
              <span className="ui-badge ui-badge--danger items-list-alert__badge">
                ⚠️ Dưới tối thiểu {formatNumber(minStock)}
              </span>
            ) : minStock > 0 ? (
              <span className="items-list-alert__min">Tối thiểu {formatNumber(minStock)}</span>
            ) : null}
          </div>
        </div>

        <div className={`items-list-menu${isOpen ? ' is-open' : ''}`} data-items-menu={item.id}>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--icon items-list-menu__btn"
            aria-label={`Thao tác với ${item.name}`}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            onClick={(event) => openMenu(event, item)}
          >
            ⋯
          </button>
          {isOpen && (
            <div className={`items-list-menu__pop${menu.up ? ' is-up' : ''}`} role="menu">
              <Link to={`/vat-tu/${item.id}`} role="menuitem" className="items-list-menu__item" onClick={() => setMenu(null)}>
                Chi tiết
              </Link>
              {canEditCatalog && (
                <>
                  <button type="button" role="menuitem" className="items-list-menu__item" onClick={() => { setMenu(null); onEdit?.(item) }}>
                    Sửa
                  </button>
                  <button type="button" role="menuitem" className="items-list-menu__item" onClick={() => { setMenu(null); onToggleActive?.(item) }}>
                    {inactive ? 'Hiện lại' : 'Ẩn'}
                  </button>
                </>
              )}
              {canDeleteCatalog && (
                <button type="button" role="menuitem" className="items-list-menu__item is-danger" onClick={() => { setMenu(null); onDelete?.(item) }}>
                  Xóa
                </button>
              )}
            </div>
          )}
        </div>
      </li>
    )
  }

  const renderGroup = (node, parentKey, isSub) => {
    const key = `${parentKey}:${categoryKey(node.category)}`
    const open = !isCollapsed(key)
    const direct = node.items
    return (
      <div key={key} className={`items-list-group${isSub ? ' is-sub' : ''}`}>
        <button type="button" className="items-list-group__head" aria-expanded={open} onClick={() => toggleCollapsed(key)}>
          <Chevron open={open} />
          <span className="items-list-group__name">{node.category.name}</span>
          <span className="items-list-count">{node.itemCount} mã</span>
          {node.lowStockCount > 0 && (
            <span className="ui-badge ui-badge--danger">{node.lowStockCount} cảnh báo</span>
          )}
        </button>
        {open && (
          <>
            {direct.length > 0 && <ul className="items-list-rows">{direct.map((item) => renderRow(item, false))}</ul>}
            {node.subgroups?.map((subgroup) => renderGroup(subgroup, key, true))}
          </>
        )}
      </div>
    )
  }

  const tabCount = (value) => (value === 'all' ? summary.total : summary[value])

  return (
    <>
      <div className="items-list">
        <div className="items-list-summary">
          <div className="ui-kpi"><span className="ui-kpi__label">Tổng số mã</span><span className="ui-kpi__value">{formatNumber(summary.total)}</span></div>
          <div className="ui-kpi"><span className="ui-kpi__label">Tái sử dụng</span><span className="ui-kpi__value">{formatNumber(summary.reusable)}</span></div>
          <div className="ui-kpi"><span className="ui-kpi__label">Tiêu hao</span><span className="ui-kpi__value">{formatNumber(summary.consumable)}</span></div>
          <div className="ui-kpi">
            <span className="ui-kpi__label">Sắp hết / cảnh báo</span>
            <span className={`ui-kpi__value${summary.low > 0 ? ' items-list-warn' : ''}`}>{formatNumber(summary.low)}</span>
          </div>
        </div>

        <div className="ui-card items-list-toolbar">
          <div className="ui-tabs" role="tablist" aria-label="Loại vật tư">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={kind === tab.value}
                className={`ui-tab${kind === tab.value ? ' is-active' : ''}`}
                onClick={() => setKind(tab.value)}
              >
                {tab.label} ({formatNumber(tabCount(tab.value))})
              </button>
            ))}
          </div>
          <div className="items-list-controls">
            <input
              type="search"
              className="ui-input items-list-search"
              placeholder="Tìm theo mã, tên, nhóm, màu"
              aria-label="Tìm vật tư"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select className="ui-select items-list-select" aria-label="Sắp xếp" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="ui-select items-list-select" aria-label="Lọc theo màu" value={colorFilter} onChange={(event) => setColorFilter(event.target.value)}>
              <option value="all">Tất cả màu</option>
              {colors.map((color) => <option key={color} value={color}>{formatColorWithIcon(color)}</option>)}
            </select>
          </div>
          <div className="items-list-options">
            <label className="items-list-switch">
              <input type="checkbox" role="switch" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
              <span className="items-list-switch__track" aria-hidden="true" />
              Xem theo nhóm
            </label>
            <label className="items-list-check">
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              Hiện cả vật tư ngưng dùng
            </label>
            {canDeleteCatalog && (
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm items-list-manage" onClick={() => setManagerOpen(true)}>
                Quản lý nhóm
              </button>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="ui-card ui-empty">
            <div className="ui-empty__title">Chưa có vật tư nào</div>
            {canEditCatalog ? 'Bấm Thêm vật tư để tạo mã đầu tiên' : 'Danh mục sẽ hiện ở đây khi có vật tư'}
          </div>
        ) : resultCount === 0 ? (
          <div className="ui-card ui-empty">
            <div className="ui-empty__title">Không tìm thấy vật tư phù hợp</div>
            {filtering ? (
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm items-list-empty-btn" onClick={clearFilters}>
                Xóa bộ lọc
              </button>
            ) : (
              'Bật Hiện cả vật tư ngưng dùng để xem thêm'
            )}
          </div>
        ) : grouped ? (
          sections.map((section) => {
            const open = !isCollapsed(section.kind)
            return (
              <section key={section.kind} className="items-list-kind">
                <button type="button" className="items-list-kind__head" aria-expanded={open} onClick={() => toggleCollapsed(section.kind)}>
                  <Chevron open={open} />
                  <KindTag kind={section.kind} />
                  <span className="items-list-count">{section.itemCount} mã</span>
                  {section.lowStockCount > 0 && (
                    <span className="ui-badge ui-badge--danger">{section.lowStockCount} cảnh báo</span>
                  )}
                </button>
                {open && section.groups.map((group) => renderGroup(group, section.kind, false))}
              </section>
            )
          })
        ) : (
          <div className="ui-card items-list-group items-list-flat">
            <ul className="items-list-rows">{flatItems.map((item) => renderRow(item, true))}</ul>
          </div>
        )}
      </div>

      {managerOpen && (
        <CategoryManager
          categories={categories}
          onClose={() => setManagerOpen(false)}
          onChanged={onCategoriesChanged}
        />
      )}

      {preview && (
        <div className="items-list-lightbox" role="dialog" aria-modal="true" aria-label={`Ảnh ${preview.name}`} onClick={() => setPreview(null)}>
          <img src={preview.url} alt={preview.name} />
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setPreview(null)}>
            Đóng
          </button>
        </div>
      )}
    </>
  )
}
