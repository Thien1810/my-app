import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  todayISO,
  MOVEMENT_TYPE_LABELS,
} from '../lib/formatters'
import CurrencyInput from '../components/CurrencyInput'
import ItemPicker from '../components/ItemPicker'
import MovementsLedger from '../components/MovementsLedger'
import { useConfirm } from '../components/ConfirmDialog'
import StockTransfersPanel from '../components/finance/StockTransfersPanel'
import { fetchAllRows } from '../lib/fetchAll'
import { listWarehouses, createStockTransfer, listStockTransfers } from '../lib/financeApi'
import {
  validateSingleMovement,
  validatePurchaseLines,
  canDeleteMovement,
  priceDeviation,
} from '../lib/movementRules'
import './MovementsPage.css'

const TABS = [
  { key: 'purchase', icon: '🛒', title: 'Nhập hàng', desc: 'Mua vật tư về kho' },
  { key: 'adjust', icon: '⚖️', title: 'Kiểm kê', desc: 'Chỉnh tồn cho khớp thực tế' },
  { key: 'damaged', icon: '🔧', title: 'Đồ hỏng', desc: 'Sửa xong hoặc thanh lý' },
  { key: 'transfer', icon: '🔁', title: 'Chuyển kho', desc: 'Đổi nơi để đồ tái sử dụng' },
]

let lineSeq = 0
const newLine = () => ({ uid: ++lineSeq, item_id: '', qty: 1, unit_cost: '' })

const Req = () => <span className="mv-req">*</span>

export default function MovementsPage() {
  const { canEditCatalog, isAdmin, role } = useAuth()
  const { confirm, confirmDialog } = useConfirm()
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [projects, setProjects] = useState([])
  const [movements, setMovements] = useState([])
  const [transfers, setTransfers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [purchaseWh, setPurchaseWh] = useState('')
  const loadedOnce = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Việc đang làm: 'purchase' | 'adjust' | 'damaged' | 'transfer'
  const [activeTab, setActiveTab] = useState('purchase')
  const [submitting, setSubmitting] = useState(false)
  const [highlightIds, setHighlightIds] = useState([])
  const highlightTimer = useRef(null)

  // Form Nhập mua (nhiều dòng)
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [supplierId, setSupplierId] = useState('')
  const [purchaseNote, setPurchaseNote] = useState('')
  const [purchaseLines, setPurchaseLines] = useState(() => [newLine()])
  // { [uid]: { item_id?: true, qty?: true, unit_cost?: true } }
  const [lineInvalid, setLineInvalid] = useState({})

  // Form đơn dòng cho Kiểm kê / Đồ hỏng
  const [singleDate, setSingleDate] = useState(todayISO())
  const [singleItemId, setSingleItemId] = useState('')
  const [singleQty, setSingleQty] = useState('')
  const [singleNote, setSingleNote] = useState('')
  const [damageMode, setDamageMode] = useState('repair_done') // 'repair_done' | 'dispose'
  const [singleInvalid, setSingleInvalid] = useState({})

  const loadTransfers = useCallback(async () => {
    try {
      const res = await listStockTransfers()
      if (res?.error) throw res.error
      setTransfers(res?.data || [])
    } catch {
      // Lỗi tải phiếu chuyển kho không chặn trang.
    }
  }, [])

  const loadAll = useCallback(async () => {
    // Chỉ hiện "Đang tải" ở lần tải đầu; các lần sau tải ngầm để bảng không nhấp nháy.
    if (!loadedOnce.current) setLoading(true)
    try {
      const [itemsRes, supRes, projRes, movesRes, whRes] = await Promise.all([
        supabase.from('item_stock').select('*').order('name'),
        supabase.from('partners').select('*').eq('kind', 'supplier').order('name'),
        supabase.from('projects').select('id, code, name').order('created_at', { ascending: false }),
        fetchAllRows((from, to) =>
          supabase
            .from('stock_movements')
            .select(
              '*, item:items(id, code, name, unit, kind), project:projects(id, code, name), partner:partners(id, name)'
            )
            .order('moved_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
        ),
        listWarehouses(),
      ])

      if (itemsRes.error) throw itemsRes.error
      if (supRes.error) throw supRes.error
      if (projRes.error) throw projRes.error
      if (movesRes.error) throw movesRes.error

      setItems(itemsRes.data || [])
      setSuppliers(supRes.data || [])
      setProjects(projRes.data || [])
      setMovements(movesRes.data || [])
      // Lỗi tải kho không chặn trang: chỉ ẩn ô chọn kho.
      const whs = whRes?.error ? [] : whRes?.data || []
      setWarehouses(whs)
      setPurchaseWh((cur) => {
        if (cur && whs.some((w) => w.code === cur)) return cur
        return (whs.find((w) => w.is_main) || whs[0])?.code || ''
      })
      setError((cur) => (cur.startsWith('Không thể tải') ? '' : cur))
    } catch (err) {
      setError(`Không thể tải dữ liệu sổ kho: ${err.message || 'lỗi không xác định'}`)
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [])

  const reloadAfterTransfer = useCallback(() => {
    loadAll()
    loadTransfers()
  }, [loadAll, loadTransfers])

  // Cuộn lên đầu trang khi có thông báo để người dùng thấy ngay.
  useEffect(() => {
    if (error || success) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [error, success])

  // Thông báo thành công tự ẩn sau ~6 giây; lỗi thì giữ cho đến khi đóng.
  useEffect(() => {
    if (!success) return undefined
    const t = setTimeout(() => setSuccess(''), 6000)
    return () => clearTimeout(t)
  }, [success])

  useEffect(() => {
    loadAll()
    loadTransfers()
    return () => clearTimeout(highlightTimer.current)
  }, [loadAll, loadTransfers])

  const itemMap = useMemo(() => {
    const map = new Map()
    for (const i of items) map.set(Number(i.id), i)
    return map
  }, [items])

  const itemsById = useMemo(() => {
    const obj = {}
    for (const i of items) obj[i.id] = i
    return obj
  }, [items])

  const activeItems = useMemo(() => items.filter((i) => i.active), [items])

  // Chèn phiếu và lấy id các dòng vừa tạo để làm nổi bật trong sổ kho.
  // Nếu RLS chặn trả dòng về thì thử lại không kèm select (chèn lỗi nghĩa là chưa có dòng nào được tạo).
  const insertMovements = async (rows) => {
    let res = await supabase.from('stock_movements').insert(rows).select('id')
    if (res.error) {
      const retry = await supabase.from('stock_movements').insert(rows)
      if (retry.error) throw retry.error
      res = { data: null }
    }
    return Array.isArray(res.data) ? res.data.map((r) => r.id).filter((id) => id != null) : []
  }

  const showHighlight = (ids) => {
    clearTimeout(highlightTimer.current)
    setHighlightIds(ids)
    if (ids.length > 0) {
      highlightTimer.current = setTimeout(() => setHighlightIds([]), 15000)
    }
  }

  const switchTab = (key) => {
    setActiveTab(key)
    setSingleItemId('')
    setSingleQty('')
    setSingleNote('')
    setSingleInvalid({})
  }

  const handlePurchaseLineChange = (uid, field, value) => {
    setPurchaseLines((prev) =>
      prev.map((l) => {
        if (l.uid !== uid) return l
        const updated = { ...l, [field]: value }
        if (field === 'item_id' && value) {
          const found = itemMap.get(Number(value))
          // Tự điền giá lần trước; không có giá thì để trống.
          if (found) updated.unit_cost = Number(found.cost) > 0 ? Number(found.cost) : ''
        }
        return updated
      })
    )
    setLineInvalid((prev) => {
      if (!prev[uid]) return prev
      const next = { ...prev, [uid]: { ...prev[uid] } }
      delete next[uid][field]
      if (field === 'item_id') delete next[uid].unit_cost
      return next
    })
  }

  const addPurchaseLine = () => setPurchaseLines((prev) => [...prev, newLine()])

  const removePurchaseLine = (uid) => {
    setPurchaseLines((prev) => prev.filter((l) => l.uid !== uid))
  }

  const handleCreatePurchase = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    const check = validatePurchaseLines(purchaseLines)
    if (!check.ok) {
      const inv = {}
      for (const er of check.errors || []) {
        const line = purchaseLines[er.row - 1]
        if (!line || !er.field) continue
        inv[line.uid] = { ...(inv[line.uid] || {}), [er.field]: true }
      }
      if ((check.errors || []).length === 0) {
        // Chưa có dòng nào hợp lệ: đánh dấu dòng đầu.
        const first = purchaseLines[0]
        if (first) inv[first.uid] = { item_id: true, qty: true, unit_cost: true }
      }
      setLineInvalid(inv)
      setError(check.error)
      return
    }
    setLineInvalid({})
    const validLines = check.validLines

    setSubmitting(true)
    try {
      const rows = validLines.map((l) => ({
        moved_at: purchaseDate || todayISO(),
        type: 'purchase',
        item_id: Number(l.item_id),
        partner_id: supplierId ? Number(supplierId) : null,
        qty: Number(l.qty),
        unit_cost: Number(l.unit_cost),
        note: purchaseNote.trim() || null,
      }))

      const newIds = await insertMovements(rows)

      // Nhập về kho khác kho chính: chuyển kho các vật tư tái sử dụng.
      const mainWh = warehouses.find((w) => w.is_main)
      const targetWh = warehouses.find((w) => w.code === purchaseWh)
      let transferMsg = ''
      let transferFailed = ''
      if (mainWh && targetWh && targetWh.code !== mainWh.code) {
        const reusableRows = rows.filter((r) => itemMap.get(r.item_id)?.kind === 'reusable')
        let done = 0
        for (const r of reusableRows) {
          const { error: terr } = await createStockTransfer({
            item_id: r.item_id,
            from_wh: mainWh.code,
            to_wh: targetWh.code,
            qty: r.qty,
            transferred_at: r.moved_at,
            note: `Nhập mua về ${targetWh.name}`,
          })
          if (terr) {
            transferFailed = `${itemMap.get(r.item_id)?.name || `#${r.item_id}`}: ${terr.message || 'lỗi không xác định'}`
            break
          }
          done += 1
        }
        if (!transferFailed && done > 0) transferMsg = ` Đã chuyển ${done} vật tư tái sử dụng về ${targetWh.name}.`
      }

      setPurchaseLines([newLine()])
      setPurchaseNote('')
      showHighlight(newIds)
      if (transferFailed) {
        setError(
          `Phiếu nhập mua ĐÃ được lưu (${rows.length} dòng) nhưng chuyển kho CHƯA hoàn tất (${transferFailed}). Vui lòng vào việc "Chuyển kho" để tạo phiếu chuyển kho còn thiếu, đừng nhập mua lại.`
        )
      } else {
        setSuccess(`Đã tạo phiếu nhập mua gồm ${rows.length} dòng vật tư!${transferMsg}`)
      }
      await Promise.all([loadAll(), loadTransfers()])
    } catch (err) {
      setError(err.message || 'Lỗi khi tạo phiếu nhập mua')
    } finally {
      setSubmitting(false)
    }
  }

  const singleType = activeTab === 'damaged' ? damageMode : 'adjust'

  const handleCreateSingleMovement = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    const qtyNum = Number(singleQty)
    const qtyEmpty = String(singleQty).trim() === '' || !Number.isFinite(qtyNum) || qtyNum === 0
    const noteMissing = singleType === 'adjust' && !singleNote.trim()
    if (!singleItemId) {
      setSingleInvalid({ item: true, qty: qtyEmpty, note: noteMissing })
      setError('Vui lòng chọn vật tư.')
      return
    }
    const check = validateSingleMovement({
      type: singleType,
      qty: singleQty,
      stock: itemMap.get(Number(singleItemId)),
      note: singleNote,
    })
    if (!check.ok) {
      setSingleInvalid({ qty: qtyEmpty || !noteMissing, note: noteMissing })
      setError(check.error)
      return
    }
    setSingleInvalid({})

    setSubmitting(true)
    try {
      const payload = {
        moved_at: singleDate || todayISO(),
        type: singleType,
        item_id: Number(singleItemId),
        qty: qtyNum,
        note: singleNote.trim() || null,
      }
      const newIds = await insertMovements([payload])
      showHighlight(newIds)

      setSuccess(`Đã tạo phiếu ${MOVEMENT_TYPE_LABELS[singleType]} thành công!`)
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
    setError('')
    setSuccess('')
    const rule = canDeleteMovement({ movement: m, stock: itemMap.get(Number(m.item_id)) })
    if (!rule.ok) {
      setError(rule.reason)
      return
    }
    const label = MOVEMENT_TYPE_LABELS[m.type] || m.type
    const itemName = m.item?.name || `#${m.item_id}`
    const ok = await confirm({
      title: 'Xóa phiếu kho',
      message: `Xóa phiếu "${label}" của "${itemName}" (SL ${formatNumber(m.qty)}) ngày ${formatDate(m.moved_at)}?\nTồn kho sẽ được tính lại.`,
      confirmLabel: 'Xóa phiếu',
      danger: true,
    })
    if (!ok) return
    try {
      const { error: err } = await supabase.from('stock_movements').delete().eq('id', m.id)
      if (err) throw err
      setSuccess(`Đã xóa phiếu ${label} của "${itemName}".`)
      await loadAll()
    } catch (err) {
      setError(err.message || 'Không thể xóa phiếu kho')
    }
  }

  const singleStock = singleItemId ? itemMap.get(Number(singleItemId)) : null
  const qtyNumPreview = Number(singleQty)
  const qtyValid = String(singleQty).trim() !== '' && Number.isFinite(qtyNumPreview)

  const purchaseTotal = purchaseLines.reduce(
    (s, l) => s + Number(l.qty || 0) * Number(l.unit_cost || 0),
    0
  )
  const purchaseLineCount = purchaseLines.filter((l) => l.item_id).length

  const renderPurchase = () => (
    <form onSubmit={handleCreatePurchase} noValidate className="mv-form">
      <section className="mv-block">
        <h3 className="mv-block-title">
          <span className="mv-step">1</span> Thông tin phiếu
        </h3>
        <div className="mv-grid">
          <div className="form-group">
            <label>
              Ngày nhập <Req />
            </label>
            <input
              type="date"
              required
              className={!purchaseDate ? 'mv-invalid' : ''}
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Nhà cung cấp</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">-- Chọn nhà cung cấp (tùy chọn) --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone ? `(${s.phone})` : ''}
                </option>
              ))}
            </select>
          </div>
          {warehouses.length > 1 && (
            <div className="form-group">
              <label>Nhập về kho</label>
              <select value={purchaseWh} onChange={(e) => setPurchaseWh(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.name}
                    {w.is_main ? ' (kho chính)' : ''}
                  </option>
                ))}
              </select>
              <div className="mv-hint">
                Chỉ ảnh hưởng tỷ trọng chia chi phí chung của đồ tái sử dụng.
              </div>
            </div>
          )}
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
      </section>

      <section className="mv-block">
        <h3 className="mv-block-title">
          <span className="mv-step">2</span> Danh sách vật tư
        </h3>
        <div className="mv-lines">
          {purchaseLines.map((line, idx) => {
            const itemObj = line.item_id ? itemMap.get(Number(line.item_id)) : null
            const inv = lineInvalid[line.uid] || {}
            const qtyNum = Number(line.qty || 0)
            const lineTotal = qtyNum * Number(line.unit_cost || 0)
            const last = itemObj ? Number(itemObj.cost || 0) : 0
            const dev = itemObj ? priceDeviation(line.unit_cost, last) : { warn: false, pct: 0 }
            const stockNow = itemObj ? Number(itemObj.in_stock || 0) : 0
            return (
              <div className="mv-line" key={line.uid}>
                <div className="mv-line-head">
                  <span className="mv-line-no">Dòng {idx + 1}</span>
                  {purchaseLines.length > 1 && (
                    <button
                      type="button"
                      className="mv-icon-btn"
                      aria-label={`Xóa dòng ${idx + 1}`}
                      onClick={() => removePurchaseLine(line.uid)}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="form-group">
                  <label>
                    Vật tư <Req />
                  </label>
                  <ItemPicker
                    items={activeItems}
                    value={line.item_id}
                    onChange={(v) => handlePurchaseLineChange(line.uid, 'item_id', v)}
                    placeholder="Gõ để tìm vật tư..."
                    invalid={!!inv.item_id}
                    stockField="in_stock"
                    required
                  />
                </div>
                {itemObj && (
                  <div className="mv-info">
                    <span className={`mv-kind ${itemObj.kind === 'reusable' ? 'is-tsd' : 'is-th'}`}>
                      {itemObj.kind === 'reusable' ? 'TSD' : 'TH'}
                    </span>
                    <span>Đơn vị: {itemObj.unit || '—'}</span>
                    <span>
                      Tồn: {formatNumber(stockNow)} →{' '}
                      <strong>{formatNumber(stockNow + (Number.isFinite(qtyNum) ? qtyNum : 0))}</strong>
                    </span>
                    {last > 0 && (
                      <button
                        type="button"
                        className="mv-last"
                        title="Bấm để điền lại giá này"
                        onClick={() => handlePurchaseLineChange(line.uid, 'unit_cost', last)}
                      >
                        Giá nhập lần trước: {formatCurrency(last)}
                      </button>
                    )}
                  </div>
                )}
                <div className="mv-line-nums">
                  <div className="form-group">
                    <label>
                      Số lượng <Req />
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      inputMode="decimal"
                      className={inv.qty ? 'mv-invalid' : ''}
                      value={line.qty}
                      onChange={(e) => handlePurchaseLineChange(line.uid, 'qty', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      Đơn giá nhập (₫) <Req />
                    </label>
                    <CurrencyInput
                      value={line.unit_cost}
                      className={inv.unit_cost ? 'mv-invalid' : ''}
                      onChange={(num) =>
                        handlePurchaseLineChange(line.uid, 'unit_cost', num === 0 ? '' : num)
                      }
                      placeholder="VD: 250.000"
                    />
                  </div>
                  <div className="mv-line-total">
                    <span className="mv-muted">Thành tiền</span>
                    <strong>{formatCurrency(lineTotal)}</strong>
                  </div>
                </div>
                {dev.warn && (
                  <div className="mv-warn">
                    ⚠️ Giá nhập {dev.pct > 0 ? 'cao hơn' : 'thấp hơn'} {Math.abs(dev.pct)}% so với
                    lần trước ({formatCurrency(last)}). Kiểm tra lại nếu nhập nhầm.
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button type="button" className="mv-add" onClick={addPurchaseLine}>
          + Thêm dòng vật tư
        </button>
      </section>

      <section className="mv-block mv-block-last">
        <h3 className="mv-block-title">
          <span className="mv-step">3</span> Tổng kết
        </h3>
        <div className="mv-totalbar">
          <div className="mv-totalbar-info">
            <span>
              <span className="mv-muted">Số dòng:</span> <strong>{purchaseLineCount}</strong>
            </span>
            <span>
              <span className="mv-muted">Tổng tiền:</span>{' '}
              <strong className="mv-total">{formatCurrency(purchaseTotal)}</strong>
            </span>
          </div>
          <button type="submit" className="btn btn-primary mv-save" disabled={submitting}>
            {submitting ? 'Đang lưu phiếu...' : 'Lưu phiếu nhập mua'}
          </button>
        </div>
      </section>
    </form>
  )

  const renderSingle = () => {
    const isAdjust = activeTab === 'adjust'
    const unit = singleStock?.unit || ''
    const inStock = Number(singleStock?.in_stock || 0)
    const inRepair = Number(singleStock?.in_repair || 0)
    const qtyForPreview = qtyValid ? qtyNumPreview : 0
    const afterAdjust = inStock + qtyForPreview
    const repairLeft = inRepair - qtyForPreview
    const stockAfterDamage = damageMode === 'repair_done' ? inStock + qtyForPreview : inStock
    return (
      <form onSubmit={handleCreateSingleMovement} noValidate className="mv-form">
        <p className="mv-muted mv-intro">
          {isAdjust
            ? 'Chỉnh tồn kho cho khớp thực tế khi kiểm kê: nhập số dương (+) để cộng thêm, số âm (-) để trừ bớt.'
            : 'Xử lý các vật tư đang ở trạng thái "Chờ sửa": đã sửa xong thì nhập lại kho, không cứu được thì thanh lý.'}
        </p>

        {!isAdjust && (
          <div className="mv-radio" role="radiogroup" aria-label="Cách xử lý đồ hỏng">
            <button
              type="button"
              role="radio"
              aria-checked={damageMode === 'repair_done'}
              className={`mv-radio-btn ${damageMode === 'repair_done' ? 'is-on' : ''}`}
              onClick={() => setDamageMode('repair_done')}
            >
              ✅ Đã sửa xong, nhập lại kho
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={damageMode === 'dispose'}
              className={`mv-radio-btn ${damageMode === 'dispose' ? 'is-on' : ''}`}
              onClick={() => setDamageMode('dispose')}
            >
              🗑️ Thanh lý
            </button>
          </div>
        )}

        <div className="mv-grid">
          <div className="form-group">
            <label>
              Ngày lập phiếu <Req />
            </label>
            <input
              type="date"
              required
              className={!singleDate ? 'mv-invalid' : ''}
              value={singleDate}
              onChange={(e) => setSingleDate(e.target.value)}
            />
          </div>
          <div className="form-group mv-span">
            <label>
              Vật tư <Req />
            </label>
            <ItemPicker
              key={activeTab}
              items={activeItems}
              value={singleItemId}
              onChange={(v) => {
                setSingleItemId(v)
                setSingleInvalid((p) => ({ ...p, item: false }))
              }}
              placeholder={isAdjust ? 'Gõ để tìm vật tư...' : 'Chọn vật tư đang chờ sửa...'}
              invalid={!!singleInvalid.item}
              stockField={isAdjust ? 'in_stock' : 'in_repair'}
              onlyWithStock={!isAdjust}
              required
            />
            {!isAdjust && items.length > 0 && !items.some((i) => Number(i.in_repair || 0) > 0) && (
              <div className="mv-hint">Hiện không có vật tư nào đang chờ sửa.</div>
            )}
          </div>
        </div>

        {singleStock && (
          <div className="mv-info">
            {isAdjust ? (
              <span>
                Tồn hiện tại:{' '}
                <strong>
                  {formatNumber(inStock)} {unit}
                </strong>
              </span>
            ) : (
              <span>
                Đang chờ sửa:{' '}
                <strong>
                  {formatNumber(inRepair)} {unit}
                </strong>
              </span>
            )}
          </div>
        )}

        <div className="mv-grid">
          <div className="form-group">
            <label>
              {isAdjust ? 'Số lượng điều chỉnh (+/-)' : 'Số lượng'} <Req />
            </label>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              min={isAdjust ? undefined : '0.01'}
              className={singleInvalid.qty ? 'mv-invalid' : ''}
              placeholder={isAdjust ? 'VD: 5 hoặc -3' : 'VD: 2'}
              value={singleQty}
              onChange={(e) => {
                setSingleQty(e.target.value)
                setSingleInvalid((p) => ({ ...p, qty: false }))
              }}
            />
          </div>
          <div className="form-group mv-span">
            <label>
              {isAdjust ? 'Lý do điều chỉnh' : 'Ghi chú / Lý do'} {isAdjust && <Req />}
            </label>
            <input
              type="text"
              className={singleInvalid.note ? 'mv-invalid' : ''}
              placeholder={
                isAdjust ? 'VD: Kiểm kê cuối tháng, đếm thực tế...' : 'Ghi chú sửa chữa / thanh lý...'
              }
              value={singleNote}
              onChange={(e) => {
                setSingleNote(e.target.value)
                setSingleInvalid((p) => ({ ...p, note: false }))
              }}
            />
          </div>
        </div>

        {singleStock && qtyValid && qtyNumPreview !== 0 && (
          <div className="mv-preview">
            {isAdjust ? (
              <span className={afterAdjust < 0 ? 'mv-neg' : ''}>
                Tồn sau điều chỉnh:{' '}
                <strong>
                  {formatNumber(afterAdjust)} {unit}
                </strong>
                {afterAdjust < 0 && ' (không hợp lệ: tồn không được âm)'}
              </span>
            ) : (
              <span className={repairLeft < 0 ? 'mv-neg' : ''}>
                Chờ sửa còn lại: <strong>{formatNumber(repairLeft)}</strong> · Trong kho sau:{' '}
                <strong>{formatNumber(stockAfterDamage)}</strong> {unit}
                {repairLeft < 0 && ' (vượt số đang chờ sửa)'}
              </span>
            )}
          </div>
        )}

        <div className="mv-actions">
          <button type="submit" className="btn btn-primary mv-save" disabled={submitting}>
            {submitting ? 'Đang lưu...' : `Lưu phiếu ${MOVEMENT_TYPE_LABELS[singleType]}`}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="page-container mv-page">
      <div className="page-header">
        <div>
          <h1>Nhập kho & Sổ phiếu kho</h1>
          <p className="text-muted">
            Nhập hàng, kiểm kê, xử lý đồ hỏng, chuyển kho và tra cứu toàn bộ sổ phiếu kho
          </p>
        </div>
      </div>

      {confirmDialog}
      {error && (
        <div className="alert alert-error mv-alert" role="alert">
          <span style={{ whiteSpace: 'pre-line' }}>{error}</span>
          <button
            type="button"
            className="mv-alert-x"
            aria-label="Đóng thông báo"
            onClick={() => setError('')}
          >
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="alert alert-success mv-alert" role="status">
          <span>{success}</span>
          <button
            type="button"
            className="mv-alert-x"
            aria-label="Đóng thông báo"
            onClick={() => setSuccess('')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Khu vực tạo phiếu kho */}
      {canEditCatalog && (
        <div className="card mv-card">
          <div className="mv-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                className={`mv-tab ${activeTab === t.key ? 'is-active' : ''}`}
                onClick={() => switchTab(t.key)}
              >
                <span className="mv-tab-icon">{t.icon}</span>
                <span className="mv-tab-title">{t.title}</span>
                <span className="mv-tab-desc">{t.desc}</span>
              </button>
            ))}
          </div>

          {activeTab === 'transfer' ? (
            <div className="mv-form">
              <p className="mv-muted mv-intro">
                Chuyển tài sản tái sử dụng giữa các kho (không đổi tồn kho tổng, chỉ đổi nơi để đồ).
              </p>
              <StockTransfersPanel
                role={role}
                canWrite={canEditCatalog}
                embedded
                onChanged={reloadAfterTransfer}
              />
            </div>
          ) : activeTab === 'purchase' ? (
            renderPurchase()
          ) : (
            renderSingle()
          )}
        </div>
      )}

      <MovementsLedger
        movements={movements}
        transfers={transfers}
        warehouses={warehouses}
        projects={projects}
        loading={loading}
        isAdmin={isAdmin}
        onDelete={handleDeleteMovement}
        highlightIds={highlightIds}
        itemsById={itemsById}
      />
    </div>
  )
}
