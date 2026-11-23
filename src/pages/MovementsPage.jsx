import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  todayISO,
  MOVEMENT_TYPE_LABELS,
} from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { MovementTypeBadge } from '../components/Badges'
import CurrencyInput from '../components/CurrencyInput'

export default function MovementsPage() {
  const { canEditCatalog, isAdmin } = useAuth()
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [projects, setProjects] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Tab tạo phiếu: 'purchase' | 'adjust' | 'repair_done' | 'dispose'
  const [activeTab, setActiveTab] = useState('purchase')
  const [submitting, setSubmitting] = useState(false)

  // Form Nhập mua (nhiều dòng)
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [supplierId, setSupplierId] = useState('')
  const [purchaseNote, setPurchaseNote] = useState('')
  const [purchaseLines, setPurchaseLines] = useState([
    { item_id: '', qty: 1, unit_cost: 0 },
  ])

  // Form đơn dòng cho Điều chỉnh / Sửa xong / Thanh lý
  const [singleDate, setSingleDate] = useState(todayISO())
  const [singleItemId, setSingleItemId] = useState('')
  const [singleQty, setSingleQty] = useState('')
  const [singleNote, setSingleNote] = useState('')

  // Bộ lọc sổ kho
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterKind, setFilterKind] = useState('all')
  const [filterProject, setFilterProject] = useState('all')

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [itemsRes, supRes, projRes, movesRes] = await Promise.all([
        supabase.from('item_stock').select('*').order('name'),
        supabase.from('partners').select('*').eq('kind', 'supplier').order('name'),
        supabase.from('projects').select('id, code, name').order('created_at', { ascending: false }),
        supabase
          .from('stock_movements')
          .select(
            '*, item:items(id, code, name, unit, kind), project:projects(id, code, name), partner:partners(id, name)'
          )
          .order('moved_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(500),
      ])

      if (itemsRes.error) throw itemsRes.error
      if (supRes.error) throw supRes.error
      if (projRes.error) throw projRes.error
      if (movesRes.error) throw movesRes.error

      setItems(itemsRes.data || [])
      setSuppliers(supRes.data || [])
      setProjects(projRes.data || [])
      setMovements(movesRes.data || [])
    } catch (err) {
      setError(err.message || 'Không thể tải dữ liệu sổ kho')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const itemMap = useMemo(() => {
    const map = new Map()
    for (const i of items) map.set(Number(i.id), i)
    return map
  }, [items])

  const handlePurchaseLineChange = (idx, field, value) => {
    setPurchaseLines((prev) => {
      const copy = [...prev]
      const updated = { ...copy[idx], [field]: value }
      if (field === 'item_id' && value) {
        const found = itemMap.get(Number(value))
        if (found) {
          updated.unit_cost = Number(found.cost || 0)
        }
      }
      copy[idx] = updated
      return copy
    })
  }

  const addPurchaseLine = () => {
    setPurchaseLines((prev) => [...prev, { item_id: '', qty: 1, unit_cost: 0 }])
  }

  const removePurchaseLine = (idx) => {
    setPurchaseLines((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleCreatePurchase = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (purchaseLines.some((l) => Number(l.qty) < 0)) {
      setError('Số lượng không được là số âm. Vui lòng kiểm tra lại các dòng vật tư.')
      return
    }

    const validLines = purchaseLines.filter(
      (l) => l.item_id && Number(l.qty) > 0
    )
    if (validLines.length === 0) {
      setError('Vui lòng chọn ít nhất 1 vật tư và nhập số lượng > 0.')
      return
    }

    setSubmitting(true)
    try {
      const rows = validLines.map((l) => ({
        moved_at: purchaseDate || todayISO(),
        type: 'purchase',
        item_id: Number(l.item_id),
        partner_id: supplierId ? Number(supplierId) : null,
        qty: Number(l.qty),
        unit_cost: Number(l.unit_cost || 0),
        note: purchaseNote.trim() || null,
      }))

      const { error: err } = await supabase.from('stock_movements').insert(rows)
      if (err) throw err

      setSuccess(`Đã tạo phiếu nhập mua gồm ${rows.length} dòng vật tư!`)
      setPurchaseLines([{ item_id: '', qty: 1, unit_cost: 0 }])
      setPurchaseNote('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi tạo phiếu nhập mua')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateSingleMovement = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!singleItemId) {
      setError('Vui lòng chọn vật tư.')
      return
    }
    const qtyNum = Number(singleQty)
    if (!qtyNum || Number.isNaN(qtyNum)) {
      setError('Số lượng không được bằng 0.')
      return
    }
    if (activeTab !== 'adjust' && qtyNum <= 0) {
      setError(
        qtyNum < 0
          ? 'Số lượng không được là số âm.'
          : 'Số lượng phải lớn hơn 0.'
      )
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        moved_at: singleDate || todayISO(),
        type: activeTab,
        item_id: Number(singleItemId),
        qty: qtyNum,
        note: singleNote.trim() || null,
      }
      const { error: err } = await supabase.from('stock_movements').insert([payload])
      if (err) throw err

      setSuccess(`Đã tạo phiếu ${MOVEMENT_TYPE_LABELS[activeTab]} thành công!`)
      setSingleQty('')
      setSingleNote('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi tạo phiếu kho')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteMovement = async (m) => {
    if (!window.confirm(`Xóa phiếu "${MOVEMENT_TYPE_LABELS[m.type]}" của "${m.item?.name}"?`)) {
      return
    }
    try {
      const { error: err } = await supabase.from('stock_movements').delete().eq('id', m.id)
      if (err) throw err
      await loadAll()
    } catch (err) {
      setError(err.message || 'Không thể xóa phiếu kho')
    }
  }

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (filterFrom && m.moved_at < filterFrom) return false
      if (filterTo && m.moved_at > filterTo) return false
      if (filterType !== 'all' && m.type !== filterType) return false
      if (filterKind !== 'all' && m.item?.kind !== filterKind) return false
      if (filterProject !== 'all' && String(m.project_id || '') !== String(filterProject))
        return false
      return true
    })
  }, [movements, filterFrom, filterTo, filterType, filterKind, filterProject])

  const handleExport = () => {
    const rows = filteredMovements.map((m) => ({
      'Mã phiếu': m.id,
      'Ngày': formatDate(m.moved_at),
      'Loại phiếu': MOVEMENT_TYPE_LABELS[m.type] || m.type,
      'Mã vật tư': m.item?.code || '',
      'Tên vật tư': m.item?.name || '',
      'ĐVT': m.item?.unit || '',
      'Số lượng': Number(m.qty || 0),
      'Đơn giá nhập (₫)': m.unit_cost != null ? Number(m.unit_cost) : '',
      'Dự án': m.project?.name || '',
      'Nhà cung cấp': m.partner?.name || '',
      'Ghi chú': m.note || '',
    }))
    exportToExcel(rows, 'SoKho', 'so-kho-phieu-xuat-nhap.xlsx')
  }

  // Gợi ý vật tư đang có đồ chờ sửa khi ở tab repair_done hoặc dispose
  const repairableItems = useMemo(() => {
    if (activeTab === 'repair_done' || activeTab === 'dispose') {
      return items.filter((i) => Number(i.in_repair || 0) > 0)
    }
    return items.filter((i) => i.active)
  }, [items, activeTab])

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Nhập kho & Sổ phiếu kho</h1>
          <p className="text-muted">
            Tạo phiếu nhập mua nhiều dòng, điều chỉnh kiểm kê, xác nhận sửa xong hoặc thanh lý đồ hỏng
          </p>
        </div>
        <button className="btn btn-outline" onClick={handleExport}>
          📥 Xuất Sổ kho Excel
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Khu vực tạo phiếu kho */}
      {canEditCatalog && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="tabs-bar">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'purchase' ? 'active' : ''}`}
              onClick={() => setActiveTab('purchase')}
            >
              🛒 Nhập mua vật tư
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'adjust' ? 'active' : ''}`}
              onClick={() => setActiveTab('adjust')}
            >
              ⚖️ Điều chỉnh kiểm kê
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'repair_done' ? 'active' : ''}`}
              onClick={() => setActiveTab('repair_done')}
            >
              🔧 Sửa xong (Nhập lại kho)
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'dispose' ? 'active' : ''}`}
              onClick={() => setActiveTab('dispose')}
            >
              🗑️ Thanh lý đồ hỏng
            </button>
          </div>

          {activeTab === 'purchase' ? (
            <form onSubmit={handleCreatePurchase} style={{ marginTop: 16 }}>
              <div className="form-grid-3">
                <div className="form-group">
                  <label>Ngày nhập *</label>
                  <input
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Nhà cung cấp</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">-- Chọn nhà cung cấp (tùy chọn) --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Ghi chú phiếu nhập</label>
                  <input
                    type="text"
                    placeholder="Số hóa đơn, đợt nhập hàng..."
                    value={purchaseNote}
                    onChange={(e) => setPurchaseNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="table-responsive" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 260 }}>Vật tư *</th>
                      <th style={{ width: 130 }}>Số lượng *</th>
                      <th style={{ width: 170 }}>Đơn giá nhập (₫) *</th>
                      <th className="text-right" style={{ width: 150 }}>
                        Thành tiền
                      </th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseLines.map((line, idx) => {
                      const itemObj = itemMap.get(Number(line.item_id))
                      const lineTotal = Number(line.qty || 0) * Number(line.unit_cost || 0)
                      return (
                        <tr key={idx}>
                          <td>
                            <select
                              required
                              value={line.item_id}
                              onChange={(e) =>
                                handlePurchaseLineChange(idx, 'item_id', e.target.value)
                              }
                            >
                              <option value="">-- Chọn vật tư --</option>
                              {items
                                .filter((i) => i.active)
                                .map((i) => (
                                  <option key={i.id} value={i.id}>
                                    {i.code ? `[${i.code}] ` : ''}
                                    {i.name} ({i.unit} - Tồn: {formatNumber(i.in_stock)})
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              required
                              value={line.qty}
                              onChange={(e) =>
                                handlePurchaseLineChange(idx, 'qty', e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <CurrencyInput
                              required
                              value={line.unit_cost}
                              onChange={(num) =>
                                handlePurchaseLineChange(idx, 'unit_cost', num)
                              }
                              placeholder="VD: 250.000"
                            />
                          </td>
                          <td className="text-right font-bold">
                            {formatCurrency(lineTotal)}
                            {itemObj && (
                              <div className="text-xs text-muted">/{itemObj.unit}</div>
                            )}
                          </td>
                          <td className="text-right">
                            {purchaseLines.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                onClick={() => removePurchaseLine(idx)}
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 14,
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <button type="button" className="btn btn-outline" onClick={addPurchaseLine}>
                  + Thêm dòng vật tư
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div>
                    Tổng cộng:{' '}
                    <strong className="text-green">
                      {formatCurrency(
                        purchaseLines.reduce(
                          (s, l) => s + Number(l.qty || 0) * Number(l.unit_cost || 0),
                          0
                        )
                      )}
                    </strong>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Đang lưu phiếu...' : 'Lưu phiếu nhập mua'}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCreateSingleMovement} style={{ marginTop: 16 }}>
              <p className="text-muted" style={{ marginBottom: 12 }}>
                {activeTab === 'adjust' &&
                  'Điều chỉnh tồn kho thực tế khi kiểm kê: nhập số dương (+) để cộng thêm vào kho, nhập số âm (-) để trừ bớt tồn kho.'}
                {activeTab === 'repair_done' &&
                  'Chuyển vật tư từ trạng thái "Chờ sửa" quay trở lại "Tồn trong kho" sau khi đã sửa chữa xong.'}
                {activeTab === 'dispose' &&
                  'Thanh lý hoặc hủy bỏ các vật tư đang nằm ở trạng thái "Chờ sửa" không thể khắc phục.'}
              </p>
              <div className="form-grid-4">
                <div className="form-group">
                  <label>Ngày lập phiếu *</label>
                  <input
                    type="date"
                    required
                    value={singleDate}
                    onChange={(e) => setSingleDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Vật tư *</label>
                  <select
                    required
                    value={singleItemId}
                    onChange={(e) => setSingleItemId(e.target.value)}
                  >
                    <option value="">-- Chọn vật tư --</option>
                    {repairableItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code ? `[${i.code}] ` : ''}
                        {i.name} (Trong kho: {formatNumber(i.in_stock)} | Chờ sửa:{' '}
                        {formatNumber(i.in_repair)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>
                    {activeTab === 'adjust' ? 'Số lượng điều chỉnh (+/-) *' : 'Số lượng *'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min={activeTab === 'adjust' ? undefined : '0.01'}
                    required
                    placeholder={activeTab === 'adjust' ? 'VD: 5 hoặc -3' : 'VD: 2'}
                    value={singleQty}
                    onChange={(e) => setSingleQty(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Ghi chú / Lý do</label>
                  <input
                    type="text"
                    placeholder="Lý do điều chỉnh / sửa chữa..."
                    value={singleNote}
                    onChange={(e) => setSingleNote(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting
                    ? 'Đang lưu...'
                    : `Lưu phiếu ${MOVEMENT_TYPE_LABELS[activeTab]}`}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Bộ lọc Sổ kho */}
      <div className="card filter-bar">
        <div className="filter-group">
          <div className="filter-inline">
            <label>Từ ngày:</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="filter-inline">
            <label>Đến ngày:</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">Tất cả loại phiếu</option>
            {Object.entries(MOVEMENT_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
            <option value="all">Tất cả loại vật tư</option>
            <option value="consumable">🟢 Tiêu hao (dùng 1 lần)</option>
            <option value="reusable">🔵 Tái sử dụng (thu hồi)</option>
          </select>
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
            <option value="all">Tất cả dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `[${p.code}] ` : ''}
                {p.name}
              </option>
            ))}
          </select>
          {(filterFrom ||
            filterTo ||
            filterType !== 'all' ||
            filterKind !== 'all' ||
            filterProject !== 'all') && (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setFilterFrom('')
                setFilterTo('')
                setFilterType('all')
                setFilterKind('all')
                setFilterProject('all')
              }}
            >
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* Bảng Sổ kho */}
      <div className="card">
        <div className="card-header">
          <h3>📜 Sổ kho chi tiết ({filteredMovements.length} dòng)</h3>
        </div>
        {loading ? (
          <div className="loading-state">Đang tải sổ kho...</div>
        ) : filteredMovements.length === 0 ? (
          <div className="empty-state">Không có phiếu kho nào khớp với bộ lọc.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Loại phiếu</th>
                  <th>Vật tư</th>
                  <th className="text-right">Số lượng</th>
                  <th className="text-right">Đơn giá nhập</th>
                  <th>Dự án / Đối tác</th>
                  <th>Ghi chú</th>
                  {isAdmin && <th className="text-right">Xóa</th>}
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.moved_at)}</td>
                    <td>
                      <MovementTypeBadge type={m.type} />
                    </td>
                    <td>
                      {m.item ? (
                        <Link to={`/vat-tu/${m.item.id}`} className="table-link font-bold">
                          {m.item.code ? `[${m.item.code}] ` : ''}
                          {m.item.name}
                        </Link>
                      ) : (
                        `#${m.item_id}`
                      )}
                    </td>
                    <td className="text-right font-bold">
                      {formatNumber(m.qty)} {m.item?.unit || ''}
                    </td>
                    <td className="text-right">
                      {m.unit_cost != null ? formatCurrency(m.unit_cost) : '—'}
                    </td>
                    <td>
                      {m.project ? (
                        <Link to={`/du-an/${m.project.id}`} className="table-link">
                          🎪 {m.project.name}
                        </Link>
                      ) : m.partner ? (
                        <span>🤝 {m.partner.name}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{m.note || '—'}</td>
                    {isAdmin && (
                      <td className="text-right">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleDeleteMovement(m)}
                        >
                          Xóa
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
