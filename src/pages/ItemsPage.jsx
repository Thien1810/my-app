import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatNumber,
  KIND_LABELS,
  ITEM_CATEGORY_PRESETS,
  ITEM_COLOR_PRESETS,
  getColorSwatch,
  formatColorWithIcon,
  extractItemColor,
  extractItemCleanNote,
  packNoteWithColorFallback,
  generateItemCode,
  findDuplicateCode,
} from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { KindBadge } from '../components/Badges'
import CurrencyInput from '../components/CurrencyInput'
import { compressImageUnder1MB, formatBytes } from '../lib/imageCompressor'

const INITIAL_FORM = {
  code: '',
  name: '',
  category: '',
  color: '',
  kind: 'consumable',
  unit: 'cái',
  cost: 0,
  min_stock: 0,
  expected_uses: '',
  image_url: '',
  note: '',
  active: true,
}

export default function ItemsPage() {
  const { canEditCatalog, canDeleteCatalog } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterColor, setFilterColor] = useState('all')
  const [showInactive, setShowInactive] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [showCodeRules, setShowCodeRules] = useState(false)
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const [isCustomColor, setIsCustomColor] = useState(false)
  const [imageCompressing, setImageCompressing] = useState(false)
  const [imageStats, setImageStats] = useState(null)
  const [previewLightbox, setPreviewLightbox] = useState(null)

  const loadItems = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('item_stock')
        .select('*')
        .order('name', { ascending: true })
      if (err) throw err
      setItems(data || [])
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách vật tư')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  const categories = useMemo(() => {
    const set = new Set()
    for (const i of items) {
      if (i.category && i.category.trim()) set.add(i.category.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'))
  }, [items])

  // Danh sách nhóm để chọn trong form: gộp các nhóm đã tồn tại + các nhóm chuẩn ngành cưới
  const selectableCategories = useMemo(() => {
    const map = new Map()
    for (const c of categories) {
      map.set(c.toLowerCase(), { name: c, isExisting: true })
    }
    for (const p of ITEM_CATEGORY_PRESETS) {
      if (!map.has(p.name.toLowerCase())) {
        map.set(p.name.toLowerCase(), { name: p.name, isExisting: false })
      }
    }
    return Array.from(map.values())
  }, [categories])

  const colors = useMemo(() => {
    const set = new Set()
    for (const i of items) {
      const c = extractItemColor(i)
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'))
  }, [items])

  const selectableColors = useMemo(() => {
    const map = new Map()
    for (const c of colors) {
      map.set(c.toLowerCase(), { name: c, isExisting: true })
    }
    for (const p of ITEM_COLOR_PRESETS) {
      if (!map.has(p.name.toLowerCase())) {
        map.set(p.name.toLowerCase(), { name: p.name, isExisting: false })
      }
    }
    return Array.from(map.values())
  }, [colors])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!showInactive && !item.active) return false
      if (filterKind !== 'all' && item.kind !== filterKind) return false
      if (filterCategory !== 'all' && (item.category || '') !== filterCategory) return false
      const itemColor = extractItemColor(item)
      if (filterColor !== 'all' && itemColor !== filterColor) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = item.name?.toLowerCase().includes(q)
        const matchCode = item.code?.toLowerCase().includes(q)
        const matchCat = item.category?.toLowerCase().includes(q)
        const matchColor = itemColor.toLowerCase().includes(q)
        if (!matchName && !matchCode && !matchCat && !matchColor) return false
      }
      return true
    })
  }, [items, showInactive, filterKind, filterCategory, filterColor, search])

  const openCreateModal = () => {
    setEditingItem(null)
    setIsCustomCategory(false)
    setIsCustomColor(false)
    setImageStats(null)
    const defaultCategory = categories[0] || 'Hoa & Lá'
    const defaultKind = 'consumable'
    const preset = ITEM_CATEGORY_PRESETS.find(
      (p) => p.name.toLowerCase() === defaultCategory.toLowerCase()
    )
    setForm({
      ...INITIAL_FORM,
      kind: defaultKind,
      category: defaultCategory,
      unit: preset?.unit || 'cái',
      code: generateItemCode(defaultKind, defaultCategory, items),
    })
    setModalOpen(true)
  }

  const handleKindOrCategoryChange = (newKind, newCategory) => {
    const preset = ITEM_CATEGORY_PRESETS.find(
      (p) => p.name.toLowerCase() === (newCategory || '').trim().toLowerCase()
    )
    const nextUnit = !editingItem && preset ? preset.unit : form.unit
    const nextCode = !editingItem
      ? generateItemCode(newKind, newCategory, items)
      : form.code
    setForm({
      ...form,
      kind: newKind,
      category: newCategory,
      unit: nextUnit,
      code: nextCode,
    })
  }

  const openEditModal = (item) => {
    setEditingItem(item)
    setIsCustomCategory(false)
    setIsCustomColor(false)
    setImageStats(null)
    setForm({
      code: item.code || '',
      name: item.name || '',
      category: item.category || '',
      color: extractItemColor(item),
      kind: item.kind || 'consumable',
      unit: item.unit || 'cái',
      cost: item.cost ?? 0,
      min_stock: item.min_stock ?? 0,
      expected_uses: item.expected_uses ?? '',
      image_url: item.image_url || '',
      note: extractItemCleanNote(item),
      active: item.active ?? true,
    })
    setModalOpen(true)
  }

  const duplicateItem = useMemo(
    () => findDuplicateCode(form.code, items, editingItem?.id),
    [form.code, items, editingItem]
  )

  const handleImageFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageCompressing(true)
    setError('')
    try {
      const res = await compressImageUnder1MB(file)
      setForm((prev) => ({ ...prev, image_url: res.dataUrl }))
      setImageStats(res)
    } catch (err) {
      setError(err.message || 'Lỗi khi xử lý hình ảnh')
    } finally {
      setImageCompressing(false)
      e.target.value = ''
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (duplicateItem) {
      setError(`Mã "${form.code}" đã trùng với vật tư "${duplicateItem.name}". Vui lòng bấm "⚡ Sinh mã" để lấy mã kế tiếp.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      let finalCode = form.code.trim().toUpperCase() || null

      // Kiểm tra lại trên database phòng trường hợp nhiều người cùng nhập một lúc
      if (finalCode) {
        let checkQuery = supabase
          .from('items')
          .select('id, code, name')
          .ilike('code', finalCode)
        if (editingItem?.id) {
          checkQuery = checkQuery.neq('id', editingItem.id)
        }
        const { data: dupRows } = await checkQuery
        if (dupRows && dupRows.length > 0) {
          const freshRes = await supabase.from('items').select('id, code')
          const nextAvailable = generateItemCode(
            form.kind,
            form.category,
            freshRes.data || items,
            editingItem?.id
          )
          setForm((prev) => ({ ...prev, code: nextAvailable }))
          throw new Error(
            `Mã "${finalCode}" vừa được dùng cho "${dupRows[0].name}". Hệ thống đã tự động đổi sang mã mới chưa trùng: ${nextAvailable}. Hãy bấm Lưu vật tư một lần nữa!`
          )
        }
      }

      const basePayload = {
        code: finalCode,
        name: form.name.trim(),
        category: form.category.trim() || null,
        kind: form.kind,
        unit: form.unit.trim() || 'cái',
        cost: Number(form.cost || 0),
        min_stock: Number(form.min_stock || 0),
        expected_uses:
          form.kind === 'reusable' && form.expected_uses && Number(form.expected_uses) > 0
            ? Math.round(Number(form.expected_uses))
            : null,
        image_url: form.image_url.trim() || null,
        note: packNoteWithColorFallback(form.color, form.note),
        active: Boolean(form.active),
      }

      const payloadWithColor = {
        ...basePayload,
        color: form.color.trim() || null,
      }

      const saveRow = async (pl) => {
        if (editingItem) {
          return supabase.from('items').update(pl).eq('id', editingItem.id)
        }
        return supabase.from('items').insert([pl])
      }

      let { error: err } = await saveRow(payloadWithColor)
      if (err && String(err.message || '').toLowerCase().includes('color')) {
        // Fallback nếu database trên Supabase chưa chạy lệnh thêm cột color
        const retry = await saveRow(basePayload)
        err = retry.error
      }
      if (err) throw err

      setModalOpen(false)
      await loadItems()
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu vật tư')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (item) => {
    const actionLabel = item.active ? 'ngưng sử dụng' : 'kích hoạt lại'
    if (!window.confirm(`Bạn có chắc muốn ${actionLabel} vật tư "${item.name}"?`)) return
    try {
      const { error: err } = await supabase
        .from('items')
        .update({ active: !item.active })
        .eq('id', item.id)
      if (err) throw err
      await loadItems()
    } catch (err) {
      setError(err.message || 'Không thể cập nhật trạng thái vật tư')
    }
  }

  const handleDeleteItem = async (item) => {
    if (
      !window.confirm(
        `Bạn có chắc chắn muốn XÓA VĨNH VIỄN vật tư "${item.name}" (${item.code || `#${item.id}`})?\n\nLưu ý: Mọi lịch sử phiếu kho, kế hoạch dự án và mẫu set gắn với vật tư này cũng sẽ bị xóa.`
      )
    ) {
      return
    }
    setError('')
    try {
      // Xóa các bản ghi phụ thuộc trước để không vướng khóa ngoại (Foreign Key).
      // Xóa phiếu kho TRƯỚC: nếu trigger chặn thì kế hoạch dự án / mẫu set vẫn còn nguyên.
      const { error: errMov } = await supabase.from('stock_movements').delete().eq('item_id', item.id)
      if (errMov) throw errMov
      const { error: errPlan } = await supabase.from('project_plan').delete().eq('item_id', item.id)
      if (errPlan) throw errPlan
      const { error: errTpl } = await supabase.from('set_template_items').delete().eq('item_id', item.id)
      if (errTpl) throw errTpl

      const { error: err } = await supabase.from('items').delete().eq('id', item.id)
      if (err) throw err
      await loadItems()
    } catch (err) {
      setError(
        err.message ||
          'Không thể xóa vật tư (chỉ Quản trị / Quản lý mới có quyền xóa hoặc vật tư đang có phiếu kho mà bạn không có quyền xóa).'
      )
    }
  }

  const handleExport = () => {
    const rows = filteredItems.map((i) => ({
      'Mã vật tư': i.code || '',
      'Tên vật tư': i.name,
      'Danh mục': i.category || '',
      'Màu sắc': extractItemColor(i),
      'Phân loại': KIND_LABELS[i.kind] || i.kind,
      'Đơn vị': i.unit,
      'Giá nhập (₫)': Number(i.cost || 0),
      'Trong kho': Number(i.in_stock || 0),
      'Đang ở dự án': Number(i.at_project || 0),
      'Chờ sửa': Number(i.in_repair || 0),
      'Tổng mất': Number(i.lost_total || 0),
      'Tồn tối thiểu': Number(i.min_stock || 0),
      'Số lần dùng dự kiến': i.expected_uses || '',
      'Trạng thái': i.active ? 'Đang dùng' : 'Ngưng dùng',
      'Ghi chú': extractItemCleanNote(i),
    }))
    exportToExcel(rows, 'DanhSachVatTu', 'danh-sach-vat-tu.xlsx')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Danh mục Vật tư</h1>
          <p className="text-muted">
            Quản lý vật tư tiêu hao & đồ trang trí tái sử dụng, theo dõi tồn kho tức thời
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setShowCodeRules((v) => !v)}
          >
            🏷️ Quy tắc đặt mã
          </button>
          <button className="btn btn-outline" onClick={handleExport}>
            📥 Xuất Excel
          </button>
          {canEditCatalog && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Thêm vật tư
            </button>
          )}
        </div>
      </div>

      {showCodeRules && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #16a34a' }}>
          <h3 style={{ marginBottom: 8 }}>🏷️ Quy tắc đặt mã Vật tư chuẩn ngành Trang trí</h3>
          <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Cấu trúc tự động: <code>[LOẠI]-[NHÓM]-[SỐ THỨ TỰ 3 CHỮ SỐ]</code> (Hệ thống tự sinh mã
            tiếp theo khi bạn bấm Thêm vật tư)
          </p>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tiền tố loại</th>
                  <th>Mã nhóm gợi ý</th>
                  <th>Ví dụ mã chuẩn</th>
                  <th>Giải thích</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="badge badge-green">TH</span> (Tiêu hao)
                  </td>
                  <td>
                    <code>HOA</code>, <code>BONG</code>, <code>PHU</code>, <code>IN</code>,{' '}
                    <code>NEN</code>
                  </td>
                  <td>
                    <code>TH-HOA-001</code>, <code>TH-BONG-002</code>
                  </td>
                  <td>Hàng dùng 1 lần (hoa tươi, bóng bay, băng keo, formex in...)</td>
                </tr>
                <tr>
                  <td>
                    <span className="badge badge-blue">TSD</span> (Tái sử dụng)
                  </td>
                  <td>
                    <code>KHUNG</code>, <code>DEN</code>, <code>VAI</code>, <code>HOALUA</code>,{' '}
                    <code>BAN</code>, <code>DAOCU</code>, <code>DC</code>
                  </td>
                  <td>
                    <code>TSD-KHUNG-001</code>, <code>TSD-DEN-002</code>
                  </td>
                  <td>Đồ trang trí & dụng cụ xuất đi phải thu hồi sau dự án</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* Bộ lọc */}
      <div className="card filter-bar">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Tìm theo mã, tên vật tư, danh mục..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input"
          />
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
            <option value="all">Tất cả phân loại</option>
            <option value="consumable">Tiêu hao</option>
            <option value="reusable">Tái sử dụng</option>
          </select>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="all">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={filterColor} onChange={(e) => setFilterColor(e.target.value)}>
            <option value="all">Tất cả màu sắc</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {formatColorWithIcon(c)}
              </option>
            ))}
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Hiện cả vật tư ngưng dùng
          </label>
        </div>
      </div>

      {/* Bảng danh sách */}
      <div className="card">
        {loading ? (
          <div className="loading-state">Đang tải danh sách vật tư...</div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state">Không tìm thấy vật tư phù hợp.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 54 }}>Ảnh</th>
                  <th>Mã</th>
                  <th>Tên vật tư</th>
                  <th>Danh mục</th>
                  <th>Màu sắc</th>
                  <th>Loại</th>
                  <th>ĐVT</th>
                  <th className="text-right">Giá nhập</th>
                  <th className="text-right">Trong kho</th>
                  <th className="text-right">Ở dự án</th>
                  <th className="text-right">Chờ sửa</th>
                  <th>Cảnh báo tồn</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isLowStock =
                    Number(item.min_stock || 0) > 0 &&
                    Number(item.in_stock || 0) < Number(item.min_stock || 0)
                  const itemColor = extractItemColor(item)
                  const swatch = getColorSwatch(itemColor)
                  return (
                    <tr key={item.id} className={!item.active ? 'row-inactive' : ''}>
                      <td>
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name}
                            title="Bấm để phóng to ảnh"
                            onClick={() =>
                              setPreviewLightbox({ url: item.image_url, name: item.name })
                            }
                            style={{
                              width: 42,
                              height: 42,
                              objectFit: 'cover',
                              borderRadius: 8,
                              border: '1px solid #cbd5e1',
                              cursor: 'zoom-in',
                              display: 'block',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: 8,
                              border: '1px dashed #cbd5e1',
                              background: '#f8fafc',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 16,
                              color: '#94a3b8',
                            }}
                          >
                            🖼️
                          </div>
                        )}
                      </td>
                      <td>
                        <code>{item.code || `#${item.id}`}</code>
                      </td>
                      <td>
                        <Link to={`/vat-tu/${item.id}`} className="table-link font-bold">
                          {item.name}
                        </Link>
                        {!item.active && (
                          <span className="badge badge-muted" style={{ marginLeft: 6 }}>
                            Ngưng dùng
                          </span>
                        )}
                      </td>
                      <td>{item.category || '—'}</td>
                      <td>
                        {itemColor ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: '0.85rem',
                              fontWeight: 500,
                            }}
                          >
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                backgroundColor: swatch?.hex || '#e2e8f0',
                                border: `1.5px solid ${swatch?.border || '#94a3b8'}`,
                                display: 'inline-block',
                                flexShrink: 0,
                              }}
                            />
                            {itemColor}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <KindBadge kind={item.kind} />
                      </td>
                      <td>{item.unit}</td>
                      <td className="text-right">{formatCurrency(item.cost)}</td>
                      <td className={`text-right font-bold ${isLowStock ? 'text-red' : 'text-green'}`}>
                        {formatNumber(item.in_stock)}
                      </td>
                      <td className="text-right text-blue">
                        {item.kind === 'reusable' ? formatNumber(item.at_project) : '—'}
                      </td>
                      <td className="text-right text-amber">
                        {Number(item.in_repair || 0) > 0 ? formatNumber(item.in_repair) : '0'}
                      </td>
                      <td>
                        {isLowStock ? (
                          <span className="badge badge-danger">
                            ⚠️ Dưới tối thiểu ({formatNumber(item.min_stock)})
                          </span>
                        ) : Number(item.min_stock || 0) > 0 ? (
                          <span className="text-xs text-muted">
                            Tối thiểu: {formatNumber(item.min_stock)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right">
                        <div className="row-actions">
                          <Link to={`/vat-tu/${item.id}`} className="btn btn-sm btn-outline">
                            Chi tiết
                          </Link>
                          {canEditCatalog && (
                            <>
                              <button
                                className="btn btn-sm btn-outline"
                                onClick={() => openEditModal(item)}
                              >
                                Sửa
                              </button>
                              <button
                                className="btn btn-sm btn-outline"
                                onClick={() => handleToggleActive(item)}
                              >
                                {item.active ? 'Ẩn' : 'Mở'}
                              </button>
                            </>
                          )}
                          {canDeleteCatalog && (
                            <button
                              className="btn btn-sm btn-outline"
                              style={{ color: '#dc2626', borderColor: '#fecaca' }}
                              onClick={() => handleDeleteItem(item)}
                            >
                              Xóa
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Thêm / Sửa vật tư */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingItem ? 'Cập nhật vật tư' : 'Thêm vật tư mới'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSave} className="modal-body">
              {/* Hàng 1: Phân loại + Danh mục (2 cột trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Phân loại *</label>
                  <select
                    value={form.kind}
                    onChange={(e) => handleKindOrCategoryChange(e.target.value, form.category)}
                  >
                    <option value="consumable">🟢 Tiêu hao (1 lần)</option>
                    <option value="reusable">🔵 Tái sử dụng</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Danh mục / Nhóm</label>
                  {!isCustomCategory ? (
                    <select
                      value={form.category}
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsCustomCategory(true)
                          handleKindOrCategoryChange(form.kind, '')
                        } else {
                          handleKindOrCategoryChange(form.kind, e.target.value)
                        }
                      }}
                    >
                      <option value="">-- Chọn nhóm --</option>
                      {categories.length > 0 && (
                        <optgroup label="Nhóm đã có trong kho">
                          {categories.map((c) => (
                            <option key={`exist-${c}`} value={c}>
                              {c}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Nhóm gợi ý ngành trang trí">
                        {selectableCategories
                          .filter((c) => !c.isExisting)
                          .map((c) => (
                            <option key={`preset-${c.name}`} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                      <option value="__NEW__">+ Tạo nhóm mới...</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Tên nhóm mới..."
                        value={form.category}
                        onChange={(e) => handleKindOrCategoryChange(form.kind, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setIsCustomCategory(false)
                          const fallbackCat = categories[0] || 'Hoa & Lá'
                          handleKindOrCategoryChange(form.kind, fallbackCat)
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Hàng 2: Mã vật tư + Đơn vị tính (2 cột trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>
                    Mã vật tư{' '}
                    {duplicateItem ? (
                      <span className="text-red">(⚠️ Trùng)</span>
                    ) : form.code.trim() ? (
                      <span className="text-green">(✓ Hợp lệ)</span>
                    ) : null}
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="text"
                      placeholder="TH-HOA-001"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      style={
                        duplicateItem
                          ? { borderColor: '#dc2626', backgroundColor: '#fef2f2' }
                          : undefined
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      title="Sinh mã tự động không trùng"
                      onClick={() =>
                        setForm({
                          ...form,
                          code: generateItemCode(form.kind, form.category, items, editingItem?.id),
                        })
                      }
                      style={{ padding: '0 8px', flexShrink: 0 }}
                    >
                      ⚡
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Đơn vị tính *</label>
                  <input
                    type="text"
                    required
                    placeholder="cái, bộ, bó, mét..."
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
              </div>

              {/* Hàng 3: Tên vật tư */}
              <div className="form-group">
                <label>Tên vật tư *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Khung backdrop tròn 2.2m / Hoa lụa..."
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              {/* Hàng 4: Màu sắc + Hình ảnh (2 cột gọn trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Màu sắc</label>
                  {!isCustomColor ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {form.color && (
                        <span
                          title={form.color}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            backgroundColor: getColorSwatch(form.color)?.hex || '#e2e8f0',
                            border: `1.5px solid ${getColorSwatch(form.color)?.border || '#94a3b8'}`,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <select
                        style={{ flex: 1 }}
                        value={form.color}
                        onChange={(e) => {
                          if (e.target.value === '__NEW_COLOR__') {
                            setIsCustomColor(true)
                            setForm({ ...form, color: '' })
                          } else {
                            setForm({ ...form, color: e.target.value })
                          }
                        }}
                      >
                        <option value="">-- Chọn màu --</option>
                        {colors.length > 0 && (
                          <optgroup label="Màu đã có trong kho">
                            {colors.map((c) => (
                              <option key={`exist-color-${c}`} value={c}>
                                {formatColorWithIcon(c)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Màu gợi ý ngành cưới">
                          {selectableColors
                            .filter((c) => !c.isExisting)
                            .map((c) => (
                              <option key={`preset-color-${c.name}`} value={c.name}>
                                {formatColorWithIcon(c.name)}
                              </option>
                            ))}
                        </optgroup>
                        <option value="__NEW_COLOR__">+ Màu mới...</option>
                      </select>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Tên màu mới..."
                        value={form.color}
                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setIsCustomColor(false)
                          setForm({ ...form, color: colors[0] || 'Trắng' })
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>
                    Hình ảnh{' '}
                    {imageStats ? (
                      <span className="text-green">({formatBytes(imageStats.compressedSize)})</span>
                    ) : (
                      <span className="text-muted">(&lt;1MB)</span>
                    )}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {form.image_url && (
                      <img
                        src={form.image_url}
                        alt="Ảnh"
                        style={{
                          width: 34,
                          height: 34,
                          objectFit: 'cover',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <label
                      className="btn btn-outline btn-sm"
                      style={{
                        cursor: 'pointer',
                        margin: 0,
                        flex: 1,
                        height: 35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {imageCompressing
                        ? '⏳ Đang nén...'
                        : form.image_url
                          ? '📷 Đổi ảnh'
                          : '📷 Chọn ảnh'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageFileSelect}
                        disabled={imageCompressing}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {form.image_url && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ color: '#dc2626', borderColor: '#fecaca', padding: '0 7px', height: 35 }}
                        onClick={() => {
                          setForm({ ...form, image_url: '' })
                          setImageStats(null)
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Hàng 5: Giá nhập + Tồn tối thiểu (2 cột trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Giá nhập (₫)</label>
                  <CurrencyInput
                    value={form.cost}
                    onChange={(num) => setForm({ ...form, cost: num })}
                    placeholder="VD: 250.000"
                  />
                </div>
                <div className="form-group">
                  <label>Tồn tối thiểu</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.min_stock}
                    onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                  />
                </div>
              </div>

              {/* Hàng 6: Số lần dùng (nếu Tái sử dụng) + Ghi chú gọn */}
              {form.kind === 'reusable' ? (
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Số lần dùng dự kiến</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="VD: 10 lần"
                      value={form.expected_uses}
                      onChange={(e) => setForm({ ...form, expected_uses: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Ghi chú</label>
                    <input
                      type="text"
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      placeholder="Kích thước, quy cách..."
                    />
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label>Ghi chú</label>
                  <input
                    type="text"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="Kích thước, quy cách bảo quản..."
                  />
                </div>
              )}

              <label className="checkbox-label" style={{ marginTop: 2 }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Đang hoạt động
              </label>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || imageCompressing || Boolean(duplicateItem)}
                >
                  {saving ? 'Đang lưu...' : 'Lưu vật tư'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox phóng to ảnh vật tư */}
      {previewLightbox && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewLightbox(null)}
          style={{ zIndex: 100 }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 620, textAlign: 'center' }}
          >
            <div className="modal-header">
              <h3>{previewLightbox.name}</h3>
              <button className="btn-icon" onClick={() => setPreviewLightbox(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <img
                src={previewLightbox.url}
                alt={previewLightbox.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '70vh',
                  borderRadius: 12,
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
