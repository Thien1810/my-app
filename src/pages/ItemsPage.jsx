import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatNumber,
  KIND_LABELS,
  ITEM_CATEGORY_PRESETS,
  generateItemCode,
} from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { KindBadge } from '../components/Badges'

const INITIAL_FORM = {
  code: '',
  name: '',
  category: '',
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
  const { canEditCatalog } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [showInactive, setShowInactive] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [showCodeRules, setShowCodeRules] = useState(false)

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
      if (i.category) set.add(i.category)
    }
    return Array.from(set).sort()
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!showInactive && !item.active) return false
      if (filterKind !== 'all' && item.kind !== filterKind) return false
      if (filterCategory !== 'all' && (item.category || '') !== filterCategory) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = item.name?.toLowerCase().includes(q)
        const matchCode = item.code?.toLowerCase().includes(q)
        const matchCat = item.category?.toLowerCase().includes(q)
        if (!matchName && !matchCode && !matchCat) return false
      }
      return true
    })
  }, [items, showInactive, filterKind, filterCategory, search])

  const openCreateModal = () => {
    setEditingItem(null)
    const defaultCategory = 'Hoa tươi'
    const defaultKind = 'consumable'
    setForm({
      ...INITIAL_FORM,
      kind: defaultKind,
      category: defaultCategory,
      unit: 'bó',
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
    setForm({
      code: item.code || '',
      name: item.name || '',
      category: item.category || '',
      kind: item.kind || 'consumable',
      unit: item.unit || 'cái',
      cost: item.cost ?? 0,
      min_stock: item.min_stock ?? 0,
      expected_uses: item.expected_uses ?? '',
      image_url: item.image_url || '',
      note: item.note || '',
      active: item.active ?? true,
    })
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        code: form.code.trim() || null,
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
        note: form.note.trim() || null,
        active: Boolean(form.active),
      }

      if (editingItem) {
        const { error: err } = await supabase
          .from('items')
          .update(payload)
          .eq('id', editingItem.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('items').insert([payload])
        if (err) throw err
      }

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

  const handleExport = () => {
    const rows = filteredItems.map((i) => ({
      'Mã vật tư': i.code || '',
      'Tên vật tư': i.name,
      'Danh mục': i.category || '',
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
      'Ghi chú': i.note || '',
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
                  <th>Mã</th>
                  <th>Tên vật tư</th>
                  <th>Danh mục</th>
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
                  return (
                    <tr key={item.id} className={!item.active ? 'row-inactive' : ''}>
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
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Phân loại *</label>
                  <select
                    value={form.kind}
                    onChange={(e) => handleKindOrCategoryChange(e.target.value, form.category)}
                  >
                    <option value="consumable">🟢 Tiêu hao (TH - dùng 1 lần)</option>
                    <option value="reusable">🔵 Tái sử dụng (TSD - thu hồi sau dự án)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Danh mục / Nhóm vật tư</label>
                  <input
                    type="text"
                    list="category-presets"
                    placeholder="Chọn hoặc gõ nhóm (VD: Khung & Backdrop)"
                    value={form.category}
                    onChange={(e) => handleKindOrCategoryChange(form.kind, e.target.value)}
                  />
                  <datalist id="category-presets">
                    {ITEM_CATEGORY_PRESETS.map((p) => (
                      <option key={p.code} value={p.name}>
                        {p.code} - {p.defaultKind === 'reusable' ? 'Tái sử dụng' : 'Tiêu hao'}
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Mã vật tư (tự sinh theo quy tắc)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="VD: TH-HOA-001"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      title="Sinh mã tự động theo Loại & Danh mục"
                      onClick={() =>
                        setForm({
                          ...form,
                          code: generateItemCode(form.kind, form.category, items),
                        })
                      }
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      ⚡ Sinh mã
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Đơn vị tính *</label>
                  <input
                    type="text"
                    required
                    placeholder="cái, bộ, bịch, bó, mét..."
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Tên vật tư *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Khung backdrop tròn 2.2m / Bóng cao su nhũ"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Giá nhập gần nhất (₫)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Tồn tối thiểu (cảnh báo)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.min_stock}
                    onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                  />
                </div>
              </div>

              {form.kind === 'reusable' && (
                <div className="form-group">
                  <label>Số lần sử dụng dự kiến (để tính khấu hao mỗi dự án)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="VD: 10 (mỗi lần xuất tính 1/10 giá vốn)"
                    value={form.expected_uses}
                    onChange={(e) => setForm({ ...form, expected_uses: e.target.value })}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Ghi chú</label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Kích thước, màu sắc, quy cách bảo quản..."
                />
              </div>

              <label className="checkbox-label">
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
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu vật tư'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
