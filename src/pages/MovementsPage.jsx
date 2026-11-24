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
import PurchaseExcelImport from '../components/PurchaseExcelImport'
import MovementsLedger from '../components/MovementsLedger'
import { useConfirm } from '../components/ConfirmDialog'
import StockTransfersPanel from '../components/finance/StockTransfersPanel'
import { fetchAllRows } from '../lib/fetchAll'
import { listWarehouses, createStockTransfer, listStockTransfers, getReceiptCode } from '../lib/financeApi'
import {
  RECEIPT_PREFIX,
  prefixForMovementType,
  isMissingReceiptColumnError,
  withReceiptCode,
  savedReceiptMessage,
} from '../lib/receiptCode'
import {
  validateSingleMovement,
  validatePurchaseLines,
  canDeleteMovement,
  priceDeviation,
  isBlankPurchaseLine,
} from '../lib/movementRules'
import './MovementsPage.css'

const TABS = [
  { key: 'purchase', icon: '🛒', title: 'Nhập hàng', desc: 'Mua vật tư về kho' },
  { key: 'transfer', icon: '🔁', title: 'Chuyển kho', desc: 'Đổi nơi để đồ tái sử dụng' },
  { key: 'damaged', icon: '🔧', title: 'Đồ hỏng', desc: 'Sửa xong hoặc thanh lý' },
  { key: 'adjust', icon: '⚖️', title: 'Kiểm kho', desc: 'Chỉnh tồn cho khớp thực tế' },
]

let lineSeq = 0
const newLine = () => ({ uid: ++lineSeq, item_id: '', qty: 1, unit_cost: '', note: '' })

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
  // Hiện dòng "Xem trong Sổ kho" sau khi lưu phiếu ở tab không có sổ kho.
  const [successHint, setSuccessHint] = useState(false)

  // Việc đang làm: 'purchase' | 'adjust' | 'damaged' | 'transfer'
  const [activeTab, setActiveTab] = useState('purchase')
  const [submitting, setSubmitting] = useState(false)
  const [highlightIds, setHighlightIds] = useState([])
  const highlightTimer = useRef(null)
  // Yêu cầu sổ kho đặt ô tìm kiếm = mã phiếu: { id, search }
  const [ledgerRequest, setLedgerRequest] = useState(null)
  // Phiếu vừa lưu ở tab Nhập hàng / Đồ hỏng: { ids, code } để nút "Xem trong Sổ kho" dùng lại.
  const lastSaved = useRef({ ids: [], code: null })

  // Form Nhập mua (nhiều dòng)
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [supplierId, setSupplierId] = useState('')
  const [purchaseNote, setPurchaseNote] = useState('')
  const [purchaseLines, setPurchaseLines] = useState(() => [newLine()])
  // { [uid]: { item_id?: true, qty?: true, unit_cost?: true } }
  const [lineInvalid, setLineInvalid] = useState({})
  // Tham chiếu tới các ô của từng dòng để nhảy ô bằng bàn phím.
  const pickerRefs = useRef(new Map())
  const qtyRefs = useRef(new Map())
  const costRefs = useRef(new Map())
  const pendingFocus = useRef(null) // { uid, field: 'picker' | 'qty' }

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
    // Thông báo có nút "Xem trong Sổ kho" ở lại lâu hơn để kịp bấm.
    const t = setTimeout(() => setSuccess(''), successHint ? 20000 : 6000)
    return () => clearTimeout(t)
  }, [success, successHint])

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

  // Vật tư hay nhập: từ phiếu mua mới nhất, unique, tối đa 10.
  const suggestedIds = useMemo(() => {
    const purchases = movements
      .filter((m) => m.type === 'purchase' && m.item_id != null)
      .sort((a, b) => {
        const d = String(b.moved_at || '').localeCompare(String(a.moved_at || ''))
        return d !== 0 ? d : Number(b.id) - Number(a.id)
      })
    const out = []
    const seen = new Set()
    for (const m of purchases) {
      const key = String(m.item_id)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
      if (out.length >= 10) break
    }
    return out
  }, [movements])

  const focusInput = (el) => {
    if (!el) return
    el.focus()
    if (el.select) el.select()
  }

  // Focus sau khi React vẽ xong (ô vật tư dòng mới, ô số lượng sau khi chọn vật tư).
  useEffect(() => {
    const p = pendingFocus.current
    if (!p) return
    pendingFocus.current = null
    if (p.field === 'picker') pickerRefs.current.get(p.uid)?.focus()
    else focusInput(qtyRefs.current.get(p.uid))
  }, [purchaseLines])

  const insertOnce = async (rows) => {
    let res = await supabase.from('stock_movements').insert(rows).select('id')
    if (res.error) {
      const retry = await supabase.from('stock_movements').insert(rows)
      if (retry.error) throw retry.error
      res = { data: null }
    }
    return Array.isArray(res.data) ? res.data.map((r) => r.id).filter((id) => id != null) : []
  }

  // Chèn phiếu (kèm receipt_code nếu có mã) và lấy id các dòng vừa tạo để làm nổi bật trong sổ kho.
  // Nếu RLS chặn trả dòng về thì thử lại không kèm select (chèn lỗi nghĩa là chưa có dòng nào được tạo).
  // Nếu lỗi do cột receipt_code chưa tồn tại (SQL chưa chạy) thì thử lại một lần không có mã
  // (an toàn vì lỗi nghĩa là chưa tạo dòng nào). Trả { ids, code } với code là mã thực sự đã ghi (hoặc null).
  const insertMovements = async (rows, code = null) => {
    try {
      const ids = await insertOnce(withReceiptCode(rows, code))
      return { ids, code: code || null }
    } catch (err) {
      if (code && isMissingReceiptColumnError(err)) {
        const ids = await insertOnce(rows)
        return { ids, code: null }
      }
      throw err
    }
  }

  const showHighlight = (ids) => {
    clearTimeout(highlightTimer.current)
    setHighlightIds(ids)
    if (ids.length > 0) {
      highlightTimer.current = setTimeout(() => setHighlightIds([]), 15000)
    }
  }

  // Từ thông báo thành công: sang tab Kiểm kho (nơi có sổ kho), giữ highlight các dòng vừa tạo,
  // đặt ô tìm của sổ = mã phiếu (nếu có) và cuộn tới sổ. Không đi qua switchTab nên không xóa highlight.
  const goToLedger = () => {
    const { ids, code } = lastSaved.current
    showHighlight(ids)
    setActiveTab('adjust')
    setSingleItemId('')
    setSingleQty('')
    setSingleNote('')
    setSingleInvalid({})
    setLedgerRequest({ id: Date.now(), search: code || '' })
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

  const handleQtyKeyDown = (e, uid) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    focusInput(costRefs.current.get(uid)?.querySelector('input'))
  }

  const handleCostKeyDown = (e, idx) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    const line = purchaseLines[idx]
    if (!line) return
    if (idx < purchaseLines.length - 1) {
      pickerRefs.current.get(purchaseLines[idx + 1].uid)?.focus()
      return
    }
    if (line.item_id && Number(line.qty) > 0 && Number(line.unit_cost) > 0) {
      const nl = newLine()
      pendingFocus.current = { uid: nl.uid, field: 'picker' }
      setPurchaseLines((prev) => [...prev, nl])
    }
  }

  // Ctrl+Enter ở bất kỳ ô nào (trừ ô chọn vật tư) = lưu phiếu.
  const handleFormKeyDown = (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
    if (e.target?.getAttribute?.('role') === 'combobox') return
    e.preventDefault()
    if (!submitting) e.currentTarget.requestSubmit()
  }

  const handleExcelApply = (lines) => {
    setError('')
    setSuccess('')
    setSuccessHint(false)
    const incoming = Array.isArray(lines) ? lines : []
    const replaceAll = purchaseLines.every(isBlankPurchaseLine)
    const kept = replaceAll ? [] : purchaseLines.filter((l) => !isBlankPurchaseLine(l))
    const seen = new Set(kept.map((l) => String(l.item_id)).filter(Boolean))
    const added = []
    let skipped = 0
    for (const l of incoming) {
      const key = String(l.item_id)
      if (seen.has(key)) {
        skipped += 1
        continue
      }
      seen.add(key)
      added.push({
        uid: ++lineSeq,
        item_id: key,
        qty: Number(l.qty),
        unit_cost: Number(l.unit_cost) > 0 ? Number(l.unit_cost) : '',
        note: String(l.note ?? '').trim(),
      })
    }
    if (added.length === 0) {
      setError(
        skipped > 0
          ? `Không có dòng mới nào được thêm: đã bỏ qua ${skipped} mã trùng.`
          : 'Không có dòng nào để đổ vào phiếu.'
      )
      return
    }
    setPurchaseLines([...kept, ...added])
    setLineInvalid({})
    setSuccess(
      `Đã đổ ${added.length} dòng từ Excel vào phiếu. Kiểm tra rồi bấm Lưu.` +
        (skipped > 0 ? ` Đã bỏ qua ${skipped} mã trùng.` : '')
    )
  }

  const addPurchaseLine = () => setPurchaseLines((prev) => [...prev, newLine()])

  const removePurchaseLine = (uid) => {
    setPurchaseLines((prev) => prev.filter((l) => l.uid !== uid))
  }

  const handleCreatePurchase = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSuccessHint(false)

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
        note: [purchaseNote.trim(), String(l.note || '').trim()].filter(Boolean).join(' — ') || null,
      }))

      // Một mã PN cho cả phiếu nhiều dòng. Không lấy được mã thì lưu như cũ (không có cột receipt_code).
      const { code: pnCode } = await getReceiptCode(RECEIPT_PREFIX.PURCHASE)
      const { ids: newIds, code: usedCode } = await insertMovements(rows, pnCode)
      lastSaved.current = { ids: newIds, code: usedCode }

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
            // Dùng chung mã PN của phiếu nhập (không cấp mã CK riêng) để dễ đối chiếu trong sổ kho.
            receipt_code: usedCode || undefined,
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
      if (transferFailed) {
        setError(
          `Phiếu nhập mua ĐÃ được lưu (${rows.length} dòng) nhưng chuyển kho CHƯA hoàn tất (${transferFailed}). Vui lòng vào việc "Chuyển kho" để tạo phiếu chuyển kho còn thiếu, đừng nhập mua lại.`
        )
      } else {
        setSuccess(
          savedReceiptMessage(
            usedCode,
            rows.length,
            `Đã tạo phiếu nhập mua gồm ${rows.length} dòng vật tư!`
          ) + transferMsg
        )
        setSuccessHint(true)
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
    setSuccessHint(false)

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
      const prefix = prefixForMovementType(singleType)
      const { code: wantedCode } = prefix ? await getReceiptCode(prefix) : { code: null }
      const { ids: newIds, code: usedCode } = await insertMovements([payload], wantedCode)
      lastSaved.current = { ids: newIds, code: usedCode }
      if (singleType === 'adjust') showHighlight(newIds)

      setSuccess(
        savedReceiptMessage(
          usedCode,
          1,
          `Đã tạo phiếu ${MOVEMENT_TYPE_LABELS[singleType]} thành công!`
        )
      )
      setSuccessHint(singleType !== 'adjust')
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
    setSuccessHint(false)
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
    <form onSubmit={handleCreatePurchase} onKeyDown={handleFormKeyDown} noValidate className="mv-form">
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
        <PurchaseExcelImport items={activeItems} disabled={submitting} onApply={handleExcelApply} />
        <div className="mv-hint mv-tip">
          Mẹo: gõ mã/tên → Enter → số lượng → Enter → đơn giá → Enter để thêm dòng mới.
        </div>
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
                    ref={(el) => {
                      if (el) pickerRefs.current.set(line.uid, el)
                      else pickerRefs.current.delete(line.uid)
                    }}
                    items={activeItems}
                    value={line.item_id}
                    suggestedIds={suggestedIds}
                    showGroupChips
                    onChange={(v) => handlePurchaseLineChange(line.uid, 'item_id', v)}
                    onSelected={() => {
                      pendingFocus.current = { uid: line.uid, field: 'qty' }
                    }}
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
                      ref={(el) => {
                        if (el) qtyRefs.current.set(line.uid, el)
                        else qtyRefs.current.delete(line.uid)
                      }}
                      className={inv.qty ? 'mv-invalid' : ''}
                      value={line.qty}
                      onChange={(e) => handlePurchaseLineChange(line.uid, 'qty', e.target.value)}
                      onKeyDown={(e) => handleQtyKeyDown(e, line.uid)}
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      Đơn giá nhập (₫) <Req />
                    </label>
                    <div
                      ref={(el) => {
                        if (el) costRefs.current.set(line.uid, el)
                        else costRefs.current.delete(line.uid)
                      }}
                      onKeyDown={(e) => handleCostKeyDown(e, idx)}
                    >
                      <CurrencyInput
                        value={line.unit_cost}
                        className={inv.unit_cost ? 'mv-invalid' : ''}
                        onChange={(num) =>
                          handlePurchaseLineChange(line.uid, 'unit_cost', num === 0 ? '' : num)
                        }
                        placeholder="VD: 250.000"
                      />
                    </div>
                  </div>
                  <div className="mv-line-total">
                    <span className="mv-muted">Thành tiền</span>
                    <strong>{formatCurrency(lineTotal)}</strong>
                  </div>
                </div>
                {line.note && <div className="mv-hint">Ghi chú dòng: {line.note}</div>}
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
            ? 'Chỉnh tồn kho cho khớp thực tế khi kiểm kho: nhập số dương (+) để cộng thêm, số âm (-) để trừ bớt.'
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
                isAdjust ? 'VD: Kiểm kho cuối tháng, đếm thực tế...' : 'Ghi chú sửa chữa / thanh lý...'
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
            Chọn việc cần làm: Nhập hàng, Chuyển kho, Đồ hỏng hoặc Kiểm kho. Sổ phiếu kho nằm ở tab Kiểm kho.
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
          <span>
            {success}
            {successHint && canEditCatalog && activeTab !== 'adjust' && (
              <span className="mv-success-hint">
                {' '}
                <button type="button" className="mv-link-btn" onClick={goToLedger}>
                  Xem trong Sổ kho ở tab Kiểm kho
                </button>
              </span>
            )}
          </span>
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
          <div className="mv-tabs" role="tablist" aria-label="Việc cần làm với kho">
            {TABS.map((t, idx) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`mv-tab-${t.key}`}
                aria-selected={activeTab === t.key}
                aria-controls="mv-tabpanel"
                className={`mv-tab ${activeTab === t.key ? 'is-active' : ''}`}
                onClick={() => switchTab(t.key)}
              >
                <span className="mv-tab-head">
                  <span className="mv-tab-num" aria-hidden="true">
                    {idx + 1}
                  </span>
                  <span className="mv-tab-icon" aria-hidden="true">
                    {t.icon}
                  </span>
                  <span className="mv-tab-title">{t.title}</span>
                </span>
                <span className="mv-tab-desc">{t.desc}</span>
              </button>
            ))}
          </div>

          <div
            className="mv-panel"
            role="tabpanel"
            id="mv-tabpanel"
            aria-labelledby={`mv-tab-${activeTab}`}
          >
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
        </div>
      )}

      {/* Sổ kho chỉ hiện ở tab Kiểm kho; người không có quyền tạo phiếu luôn thấy sổ */}
      {(!canEditCatalog || activeTab === 'adjust') && (
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
          searchRequest={ledgerRequest}
        />
      )}
    </div>
  )
}
