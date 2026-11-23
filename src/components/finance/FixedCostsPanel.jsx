import { useState } from 'react'
import CurrencyInput from '../CurrencyInput'
import { FIXED_COST_CATEGORIES } from '../../lib/metaAdsClient'
import { formatCurrency } from '../../lib/formatters'

export default function FixedCostsPanel({
  month,
  scope = 'all',
  rows = [],
  templates = [],
  warehouses = [],
  isLocked,
  canWrite,
  onAdd,
  onRemove,
  onApplyTemplates,
  onSaveAsTemplate,
}) {
  const defaultWh = scope !== 'all' ? scope : ''
  // warehouse = null nghĩa là chưa chọn, dùng mặc định theo scope
  const [form, setForm] = useState({ category: FIXED_COST_CATEGORIES[0], title: '', warehouse: null, amount: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const readOnly = isLocked || !canWrite

  const whValue = form.warehouse === null ? defaultWh : form.warehouse
  const whName = (code) => warehouses.find((w) => w.code === code)?.name || code
  const visible = rows.filter((r) => scope === 'all' || !r.warehouse_code || r.warehouse_code === scope)
  const total = visible.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const guard = async (fn) => {
    if (submitting) return
    setSubmitting(true)
    try {
      return await fn()
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (readOnly || submitting) return
    const amount = Number(form.amount || 0)
    if (!(amount > 0)) {
      setError('Số tiền chi phí cứng phải lớn hơn 0.')
      return
    }
    setError('')
    const ok = await guard(() =>
      onAdd({
        month,
        category: form.category,
        title: form.title.trim() || form.category,
        warehouse_code: whValue || null,
        amount,
      }),
    )
    if (ok !== false) setForm((p) => ({ ...p, title: '', amount: '' }))
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}
      >
        <div>
          <h3 style={{ marginBottom: 4 }}>🏢 Chi phí cứng tháng {month}</h3>
          <p className="text-muted" style={{ fontSize: 13.5 }}>
            Phí cố định mỗi tháng (thuê kho, lương cứng, điện nước, phần mềm...). Tổng: <strong>{formatCurrency(total)}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {templates.length > 0 && (
            <button type="button" disabled={readOnly || submitting} className="btn btn-outline btn-sm" onClick={() => guard(onApplyTemplates)}>
              {submitting ? 'Đang lưu...' : '⚡ Áp mẫu hàng tháng'}
            </button>
          )}
          <button
            type="button"
            disabled={readOnly || submitting || rows.length === 0}
            className="btn btn-outline btn-sm"
            onClick={() => guard(onSaveAsTemplate)}
          >
            {submitting ? 'Đang lưu...' : '💾 Lưu tháng này thành mẫu'}
          </button>
        </div>
      </div>

      {isLocked && <div className="empty-state" style={{ padding: 10, marginBottom: 12 }}>Tháng này đã khóa sổ</div>}
      {!isLocked && !canWrite && (
        <div className="empty-state" style={{ padding: 10, marginBottom: 12 }}>Bạn không có quyền ghi chi phí cứng.</div>
      )}

      <form onSubmit={submit} className="sub-card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="form-grid-4">
          <div className="form-group">
            <label>Nhóm chi phí cứng *</label>
            <select disabled={readOnly} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {FIXED_COST_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Diễn giải chi tiết</label>
            <input
              type="text"
              disabled={readOnly}
              placeholder="VD: Tiền thuê kho Vĩnh Lộc"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Kho áp dụng</label>
            <select disabled={readOnly} value={whValue} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
              <option value="">Chung</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Số tiền / tháng (₫) *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <CurrencyInput
                required
                disabled={readOnly}
                placeholder="VD: 3.000.000"
                value={form.amount}
                onChange={(num) => setForm({ ...form, amount: num })}
              />
              <button type="submit" disabled={readOnly || submitting} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                {submitting ? 'Đang lưu...' : '+ Thêm phí cứng'}
              </button>
            </div>
          </div>
        </div>
        {error && <div className="text-xs" style={{ color: '#dc2626', marginTop: 6 }}>{error}</div>}
      </form>

      {visible.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>Tháng {month} chưa ghi nhận khoản chi phí cứng nào.</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhóm chi phí cứng</th>
                <th>Diễn giải</th>
                <th>Kho</th>
                <th className="text-right">Số tiền (₫)</th>
                <th className="text-right">Xóa</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td className="font-bold">{c.category}</td>
                  <td>{c.title}</td>
                  <td>
                    <span className="badge badge-gray">{c.warehouse_code ? whName(c.warehouse_code) : 'Chung'}</span>
                  </td>
                  <td className="text-right font-bold">{formatCurrency(c.amount)}</td>
                  <td className="text-right">
                    <button type="button" disabled={readOnly} className="btn btn-outline btn-sm" onClick={() => onRemove(c.id)}>
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
