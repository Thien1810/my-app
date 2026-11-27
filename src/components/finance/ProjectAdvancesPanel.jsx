import { useCallback, useEffect, useState } from 'react'
import CurrencyInput from '../CurrencyInput'
import { useConfirm } from '../ConfirmDialog'
import { formatCurrency } from '../../lib/formatters'
import {
  createProjectAdvance,
  deleteProjectAdvance,
  isMonthLockedLocal,
  listMonthLocks,
  listProjectAdvances,
} from '../../lib/financeApi'
import {
  ADVANCE_KINDS,
  ADVANCE_KIND_LABELS,
  canDeleteAdvance,
  summarizeAdvances,
  toAdvanceRow,
  validateAdvanceInput,
} from '../../lib/advances'

const todayStr = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function ProjectAdvancesPanel({ projectId, contractValue = 0, canWrite = false, projectStatus }) {
  const [rows, setRows] = useState([])
  const [locks, setLocks] = useState([])
  const [locksError, setLocksError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loadedKey, setLoadedKey] = useState(null) // lượt tải gần nhất đã xong
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState({ receivedDate: todayStr(), kind: 'advance', amount: 0, note: '' })
  const [error, setError] = useState('')
  const [rowError, setRowError] = useState('') // lỗi khi xóa, hiện ngay trên danh sách
  const [submitting, setSubmitting] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  // Tải lại sau khi ghi: giữ danh sách đang hiện (không giật trang), khóa nút tới khi có số mới.
  useEffect(() => {
    let cancelled = false
    listProjectAdvances(projectId).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setLoadError(err.message || 'Lỗi không xác định')
      } else {
        setLoadError('')
        setRows(data || [])
      }
      setLoadedKey(`${projectId}:${reloadKey}`)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  // Đổi dự án thì reset form và thông báo lỗi.
  useEffect(() => {
    setForm({ receivedDate: todayStr(), kind: 'advance', amount: 0, note: '' })
    setError('')
  }, [projectId])

  // Nạp danh sách khóa sổ (lỗi nạp: không chặn nhầm, chỉ ghi chú).
  useEffect(() => {
    let cancelled = false
    setLocksError('')
    listMonthLocks().then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setLocks([])
        setLocksError(err.message || 'Lỗi không xác định')
      } else {
        setLocks(data || [])
      }
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const lockedMsg = (date) => `Tháng ${String(date || '').slice(0, 7)} đã khóa sổ, không ghi/xóa Mất cọc được.`
  const isCancelled = projectStatus === 'cancelled'

  const cv = Number(contractValue) || 0
  const sum = summarizeAdvances(rows, cv)
  const loaded = !!loadedKey?.startsWith(`${projectId}:`)
  const fresh = loadedKey === `${projectId}:${reloadKey}`
  const ok = loaded && !loadError

  const submit = async (e) => {
    e.preventDefault()
    if (!canWrite || submitting || !ok || !fresh) return
    setRowError('')
    const msg = validateAdvanceInput({
      kind: form.kind,
      amount: form.amount,
      receivedDate: form.receivedDate,
      rows,
      projectStatus,
    })
    if (msg) {
      setError(msg)
      return
    }
    if (form.kind === 'forfeit' && isMonthLockedLocal(locks, form.receivedDate.slice(0, 7))) {
      setError(lockedMsg(form.receivedDate))
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const { error: err } = await createProjectAdvance(toAdvanceRow({ projectId, ...form }))
      if (err) {
        setError(err.message || 'Không lưu được khoản này.')
        return
      }
      setForm((p) => ({ ...p, amount: 0, note: '' }))
      reload()
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (id) => {
    if (!canWrite || submitting || !fresh) return
    setRowError('')
    setError('')
    const target = rows.find((r) => String(r.id) === String(id))
    if (target?.kind === 'forfeit' && isMonthLockedLocal(locks, String(target.received_date || '').slice(0, 7))) {
      setRowError(lockedMsg(target.received_date))
      return
    }
    const delMsg = canDeleteAdvance({ rows, id })
    if (delMsg) {
      setRowError(delMsg)
      return
    }
    const okDel = await confirm({
      title: 'Xóa khoản này',
      message: 'Xóa khoản này?',
      confirmLabel: 'Xóa',
      danger: true,
    })
    if (!okDel) return
    setSubmitting(true)
    try {
      const { error: err } = await deleteProjectAdvance(id)
      if (err) {
        setRowError(err.message || 'Không xóa được khoản này.')
        return
      }
      reload()
    } finally {
      setSubmitting(false)
    }
  }

  const overpaid = sum.outstanding < 0
  const paidFull = sum.outstanding === 0 && cv > 0
  const outColor = overpaid || sum.outstanding > 0 ? '#d97706' : '#16a34a'
  const outLabel = overpaid ? 'Thu dư' : paidFull ? 'Đã thu đủ' : 'Còn phải thu'

  return (
    <div className="card ui-card">
      <h3 style={{ marginBottom: 4 }}>💵 Tạm ứng / cọc của khách</h3>
      <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        Tiền cọc/tạm ứng không phải doanh thu. Đã thu = Khách đưa − Hoàn lại; Mất cọc không tính vào đã thu.
      </p>

      {loadError && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          Không tải được tạm ứng: {loadError}
        </div>
      )}

      {ok && (
        <>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi-card">
              <div className="kpi-label">Giá trị hợp đồng</div>
              <div className="kpi-value">{formatCurrency(cv)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Đã thu</div>
              <div className="kpi-value">{formatCurrency(sum.received)}</div>
              {sum.forfeitTotal > 0 && (
                <div className="kpi-sub">Mất cọc: {formatCurrency(sum.forfeitTotal)}</div>
              )}
            </div>
            {cv > 0 && !isCancelled && (
              <div className="kpi-card">
                <div className="kpi-label">{outLabel}</div>
                <div className="kpi-value" style={{ color: outColor }}>
                  {formatCurrency(Math.abs(sum.outstanding))}
                </div>
              </div>
            )}
          </div>
          {isCancelled && (
            <div className="text-xs text-muted" style={{ marginBottom: 12 }}>
              Dự án đã hủy: không còn phải thu.
            </div>
          )}
          {locksError && (
            <div className="text-xs text-muted" style={{ marginBottom: 12 }}>
              Không tải được danh sách khóa sổ ({locksError}); chưa kiểm tra được tháng đã khóa ở trình duyệt.
            </div>
          )}
          {cv === 0 && !isCancelled && (
            <div className="text-xs text-muted" style={{ marginBottom: 12 }}>
              Chưa nhập giá trị hợp đồng nên chưa tính được còn phải thu
            </div>
          )}
        </>
      )}

      {canWrite && (
        <form onSubmit={submit} className="sub-card ui-card" style={{ marginBottom: 16, padding: 14 }}>
          <div className="form-grid-4">
            <div className="form-group">
              <label>Ngày *</label>
              <input className="ui-input"
                type="date"
                disabled={submitting}
                value={form.receivedDate}
                onChange={(e) => setForm({ ...form, receivedDate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Loại *</label>
              <select className="ui-select" disabled={submitting} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {ADVANCE_KINDS.map((k) => (
                  <option key={k} value={k} disabled={k === 'forfeit' && !isCancelled}>
                    {ADVANCE_KIND_LABELS[k]}
                    {k === 'forfeit' && !isCancelled ? ' (chỉ khi dự án đã hủy)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Số tiền (₫) *</label>
              <CurrencyInput
                className="ui-input"
                disabled={submitting}
                placeholder="VD: 3.000.000"
                value={form.amount || ''}
                onChange={(num) => setForm({ ...form, amount: num })}
              />
            </div>
            <div className="form-group">
              <label>Ghi chú</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input className="ui-input"
                  type="text"
                  aria-label="Ghi chú"
                  disabled={submitting}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
                <button type="submit" disabled={submitting || !ok || !fresh} className="ui-btn ui-btn--primary ui-btn--block">
                  {submitting ? 'Đang lưu...' : '+ Thêm'}
                </button>
              </div>
            </div>
          </div>
          {error && <div className="alert alert-error project-feedback" role="alert">{error}</div>}
        </form>
      )}
      {rowError && <div className="alert alert-error project-feedback" role="alert">{rowError}</div>}

      {ok &&
        (rows.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}>Chưa có khoản tạm ứng nào.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table ui-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Loại</th>
                  <th className="text-right">Số tiền (₫)</th>
                  <th>Ghi chú</th>
                  {canWrite && <th className="text-right">Xóa</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Ngày">{r.received_date}</td>
                    <td className="ui-table__primary" data-label="Loại">{ADVANCE_KIND_LABELS[r.kind] || r.kind}</td>
                    <td className="text-right font-bold" data-label="Số tiền">{formatCurrency(Math.abs(Number(r.amount) || 0))}</td>
                    <td className="project-cell-stack" data-label="Ghi chú">{r.note || '—'}</td>
                    {canWrite && (
                      <td className="ui-table__actions text-right">
                        <button type="button" disabled={submitting || !fresh} className="ui-btn ui-btn--secondary" onClick={() => remove(r.id)}>
                          Xóa
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {confirmDialog}
    </div>
  )
}
