import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConfirm } from '../ConfirmDialog'
import { formatCurrency } from '../../lib/formatters'
import {
  createStockTransfer,
  deleteStockTransfer,
  listReusableItemStock,
  listStockTransfers,
} from '../../lib/financeApi'
import { calcWarehouseHoldings, canDeleteTransfer, todayVN, validateTransferInput } from '../../lib/stockTransfers'

const emptyForm = () => ({ item_id: '', from_wh: '', to_wh: '', qty: '', transferred_at: todayVN(), note: '' })

export default function StockTransfersPanel({ role, canWrite = false, warehouses = [], shares = [], locks = [], onChanged }) {
  const [items, setItems] = useState([])
  const [transfers, setTransfers] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  useEffect(() => {
    let cancelled = false
    Promise.all([listReusableItemStock(), listStockTransfers()]).then(([it, tr]) => {
      if (cancelled) return
      const err = it.error || tr.error
      if (err) {
        setLoadError(err.message || 'Lỗi không xác định')
        setLoaded(false)
        return
      }
      setLoadError('')
      setItems(it.data || [])
      setTransfers(tr.data || [])
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1)
    if (onChanged) onChanged()
  }, [onChanged])

  const mainCode = (warehouses.find((w) => w.is_main) || {}).code
  const whName = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.code, w.name])), [warehouses])
  const itemById = useMemo(() => Object.fromEntries(items.map((i) => [String(i.id), i])), [items])
  const holdings = useMemo(
    () => calcWarehouseHoldings({ items, transfers, mainWarehouseCode: mainCode }),
    [items, transfers, mainCode],
  )
  const lockedMonths = useMemo(() => locks.map((l) => l.month), [locks])

  const available = useMemo(() => {
    if (!form.item_id || !form.from_wh) return null
    const h = holdings.find((x) => String(x.item_id) === String(form.item_id))
    return h ? h.byWarehouse[form.from_wh] || 0 : 0
  }, [holdings, form.item_id, form.from_wh])

  const submit = async (e) => {
    e.preventDefault()
    if (!canWrite || submitting || !loaded) return
    setSuccess('')
    const v = validateTransferInput({ ...form, available: available ?? 0 })
    if (!v.ok) {
      setError(v.error)
      return
    }
    if (lockedMonths.includes(String(form.transferred_at).slice(0, 7))) {
      setError(`Tháng ${String(form.transferred_at).slice(0, 7)} đã khóa sổ, không ghi phiếu vào tháng này được.`)
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const { error: err } = await createStockTransfer({
        item_id: Number(form.item_id),
        from_wh: form.from_wh,
        to_wh: form.to_wh,
        qty: Number(form.qty),
        transferred_at: form.transferred_at || undefined,
        note: form.note.trim() || null,
      })
      if (err) {
        setError(err.message || 'Không lưu được phiếu chuyển kho.')
        return
      }
      setForm((p) => ({ ...emptyForm(), item_id: p.item_id, from_wh: p.from_wh, to_wh: p.to_wh }))
      setSuccess('Đã lưu phiếu chuyển kho.')
      reload()
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (t) => {
    if (submitting) return
    const chk = canDeleteTransfer({ role, transferDate: t.transferred_at, lockedMonths })
    if (!chk.ok) {
      setError(chk.reason)
      return
    }
    const okDel = await confirm({
      title: 'Xóa phiếu chuyển kho',
      message: 'Xóa phiếu này sẽ làm thay đổi tỷ trọng chia chi phí chung. Xóa?',
      confirmLabel: 'Xóa',
      danger: true,
    })
    if (!okDel) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const { error: err } = await deleteStockTransfer(t.id)
      if (err) {
        setError(err.message || 'Không xóa được phiếu chuyển kho.')
        return
      }
      setSuccess('Đã xóa phiếu chuyển kho.')
      reload()
    } finally {
      setSubmitting(false)
    }
  }

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const sortedShares = [...shares].sort((a, b) => String(a.code).localeCompare(String(b.code)))

  return (
    <div className="card" style={{ padding: 20, marginTop: 20 }}>
      <h3 style={{ marginBottom: 4 }}>🔁 Chuyển kho tài sản</h3>
      <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        Phiếu chuyển tài sản tái sử dụng giữa các kho. Giá trị tài sản đặt ở mỗi kho quyết định tỷ trọng chia chi phí chung.
      </p>

      {loadError && (
        <div className="alert alert-danger" style={{ marginBottom: 12 }}>
          Không tải được dữ liệu chuyển kho: {loadError}
        </div>
      )}
      {success && <div className="alert alert-success" style={{ marginBottom: 12 }}>{success}</div>}

      {canWrite && (
        <form onSubmit={submit} className="sub-card" style={{ marginBottom: 16, padding: 14 }}>
          <div className="form-grid-4">
            <div className="form-group">
              <label>Vật tư *</label>
              <select disabled={submitting} value={form.item_id} onChange={set('item_id')}>
                <option value="">-- Chọn vật tư --</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code ? `${i.code} - ` : ''}
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Kho đi *</label>
              <select disabled={submitting} value={form.from_wh} onChange={set('from_wh')}>
                <option value="">-- Chọn kho --</option>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Kho đến *</label>
              <select disabled={submitting} value={form.to_wh} onChange={set('to_wh')}>
                <option value="">-- Chọn kho --</option>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Số lượng *</label>
              <input type="number" min="0" step="any" disabled={submitting} value={form.qty} onChange={set('qty')} />
              {available !== null && (
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>Đang có ở kho đi: {available}</div>
              )}
            </div>
            <div className="form-group">
              <label>Ngày chuyển</label>
              <input type="date" disabled={submitting} value={form.transferred_at} onChange={set('transferred_at')} />
            </div>
            <div className="form-group">
              <label>Ghi chú</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" disabled={submitting} value={form.note} onChange={set('note')} />
                <button type="submit" disabled={submitting || !loaded} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                  {submitting ? 'Đang lưu...' : '+ Lưu phiếu'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
      {error && <div className="text-xs" style={{ color: '#dc2626', marginBottom: 10 }}>{error}</div>}

      <h4 style={{ margin: '8px 0' }}>Giá trị tài sản và tỷ trọng từng kho</h4>
      {sortedShares.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>Chưa có dữ liệu tỷ trọng kho.</div>
      ) : (
        <div className="table-responsive" style={{ marginBottom: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Kho</th>
                <th className="text-right">Giá trị tài sản (₫)</th>
                <th className="text-right">Tỷ trọng</th>
              </tr>
            </thead>
            <tbody>
              {sortedShares.map((s) => (
                <tr key={s.code}>
                  <td>{s.name || whName[s.code] || s.code}</td>
                  <td className="text-right">{formatCurrency(Number(s.asset_value) || 0)}</td>
                  <td className="text-right font-bold">{((Number(s.share) || 0) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 style={{ margin: '8px 0' }}>Lịch sử phiếu chuyển</h4>
      {loaded &&
        (transfers.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>Chưa có phiếu chuyển kho nào.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Vật tư</th>
                  <th>Kho đi → Kho đến</th>
                  <th className="text-right">SL</th>
                  <th>Ghi chú</th>
                  {role === 'admin' && <th className="text-right">Xóa</th>}
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const it = itemById[String(t.item_id)]
                  const chk = canDeleteTransfer({ role, transferDate: t.transferred_at, lockedMonths })
                  return (
                    <tr key={t.id}>
                      <td>{t.transferred_at}</td>
                      <td>{it ? it.name : `#${t.item_id}`}</td>
                      <td>
                        {whName[t.from_wh] || t.from_wh} → {whName[t.to_wh] || t.to_wh}
                      </td>
                      <td className="text-right font-bold">{Number(t.qty)}</td>
                      <td>{t.note || ''}</td>
                      {role === 'admin' && (
                        <td className="text-right">
                          <button
                            type="button"
                            disabled={submitting || !chk.ok}
                            title={chk.ok ? '' : chk.reason}
                            className="btn btn-outline btn-sm"
                            onClick={() => remove(t)}
                          >
                            Xóa
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      {confirmDialog}
    </div>
  )
}
