import { useState } from 'react'
import CurrencyInput from '../CurrencyInput'
import { formatCurrency, formatNumber, formatDate } from '../../lib/formatters'

const CHANNELS = [
  { value: 'meta', label: 'Meta' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'google', label: 'Google' },
  { value: 'other', label: 'Khác' },
]
const DASH = '—'
const money = (v) => (v == null ? DASH : formatCurrency(Math.round(v)))
const channelLabel =(v) => CHANNELS.find((c) => c.value === v)?.label || v

// Ngày mặc định nằm trong tháng đang xem: hôm nay nếu cùng tháng, ngược lại mùng 1.
function defaultDate(month) {
  const t = new Date()
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  return today.slice(0, 7) === month ? today : `${month}-01`
}

function monthEnd(month) {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

export default function AdsLedgerPanel({
  month,
  scope = 'all',
  rows = [],
  warehouses = [],
  isLocked,
  canWrite,
  onAdd,
  onRemove,
  metrics,
}) {
  const [form, setForm] = useState({
    date: defaultDate(month),
    channel: 'meta',
    warehouse: '',
    campaign_name: '',
    messages: '',
    leads: '',
    spend: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Đổi tháng: container đặt key={month} nên form khởi tạo lại, ngày mặc định luôn thuộc tháng đang xem.
  const readOnly = isLocked || !canWrite

  const whName = (code) => warehouses.find((w) => w.code === code)?.name || code
  const visible = rows.filter((r) => scope === 'all' || !r.warehouse_code || r.warehouse_code === scope)
  const total = visible.reduce((s, r) => s + (Number(r.spend) || 0), 0)
  const roasText = metrics?.roas == null ? DASH : `${metrics.roas.toFixed(1)}x`
  const cirText = metrics?.cir == null ? DASH : `${(metrics.cir * 100).toFixed(1)}%`

  const submit = async (e) => {
    e.preventDefault()
    if (readOnly || submitting) return
    const date = form.date || defaultDate(month)
    if (date.slice(0, 7) !== month) {
      setError(`Ngày phải thuộc tháng ${month}.`)
      return
    }
    const spend = Number(form.spend || 0)
    if (!(spend > 0)) {
      setError('Số tiền đã chi phải lớn hơn 0.')
      return
    }
    setError('')
    setSubmitting(true)
    let ok
    try {
      ok = await onAdd({
        spend_date: date,
        channel: form.channel,
        warehouse_code: form.warehouse || null,
        campaign_name: form.campaign_name.trim() || null,
        messages: Number(form.messages || 0),
        leads: Number(form.leads || 0),
        spend,
        source: 'manual',
      })
    } finally {
      setSubmitting(false)
    }
    if (ok !== false) setForm((p) => ({ ...p, campaign_name: '', messages: '', leads: '', spend: '' }))
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h3 style={{ marginBottom: 4 }}>📒 Sổ chi phí Ads tháng {month}</h3>
          <p className="text-muted" style={{ fontSize: 13.5 }}>
            Ghi tay chi phí quảng cáo (Meta, TikTok, Google...). Dữ liệu lưu trên hệ thống.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="text-xs text-muted">Tổng chi tiêu</div>
          <div className="font-bold" style={{ fontSize: 18 }}>{formatCurrency(total)}</div>
        </div>
      </div>

      {metrics && (
        <div style={{ marginBottom: 16 }}>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">CAC (chi phí Ads / đám từ Ads)</div>
              <div className="kpi-value">{money(metrics.cac)}</div>
              <div className="kpi-sub">{metrics.paidAdsProjectCount} đám từ Ads</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">ROAS</div>
              <div className="kpi-value">{roasText}</div>
              <div className="kpi-sub">Doanh thu từ Ads: {formatCurrency(metrics.paidAdsRevenue)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">CIR (Ads / doanh thu từ Ads)</div>
              <div className="kpi-value">{cirText}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">CPL (chi phí / tin nhắn + lead)</div>
              <div className="kpi-value">{money(metrics.cpl)}</div>
            </div>
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 8 }}>
            CAC và ROAS chỉ tính các đám có nguồn Meta/TikTok (đám chưa chọn nguồn không tính).
          </div>
        </div>
      )}

      {isLocked && <div className="empty-state" style={{ padding: 10, marginBottom: 12 }}>Tháng này đã khóa sổ</div>}
      {!isLocked && !canWrite && (
        <div className="empty-state" style={{ padding: 10, marginBottom: 12 }}>Bạn không có quyền ghi sổ Ads.</div>
      )}

      <form onSubmit={submit} className="sub-card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="form-grid-4">
          <div className="form-group">
            <label>Ngày</label>
            <input
              type="date"
              disabled={readOnly}
              min={`${month}-01`}
              max={monthEnd(month)}
              value={form.date || defaultDate(month)}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Kênh & Kho</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select disabled={readOnly} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <select disabled={readOnly} value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}>
                <option value="">Chung</option>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Tên chiến dịch</label>
            <input
              type="text"
              disabled={readOnly}
              placeholder="VD: Boost Video Before/After"
              value={form.campaign_name}
              onChange={(e) => setForm({ ...form, campaign_name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Tin nhắn / Lead</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number"
                min="0"
                disabled={readOnly}
                placeholder="Tin nhắn"
                value={form.messages}
                onChange={(e) => setForm({ ...form, messages: e.target.value })}
              />
              <input
                type="number"
                min="0"
                disabled={readOnly}
                placeholder="Lead"
                value={form.leads}
                onChange={(e) => setForm({ ...form, leads: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Số tiền đã chi (₫) *</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <CurrencyInput
                required
                disabled={readOnly}
                placeholder="VD: 450.000"
                value={form.spend}
                onChange={(num) => setForm({ ...form, spend: num })}
              />
              <button type="submit" disabled={readOnly || submitting} className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }}>
                {submitting ? 'Đang lưu...' : '+ Ghi sổ Ads'}
              </button>
            </div>
          </div>
        </div>
        {error && <div className="text-xs" style={{ color: '#dc2626', marginTop: 6 }}>{error}</div>}
      </form>

      {visible.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>Tháng {month} chưa có dòng chi phí Ads nào.</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Kênh / Kho</th>
                <th>Chiến dịch</th>
                <th className="text-right">Tin nhắn / Lead</th>
                <th className="text-right">Đã chi (₫)</th>
                <th className="text-right">Xóa</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.spend_date)}</td>
                  <td>
                    <div className="font-bold">{channelLabel(r.channel)}</div>
                    <div className="text-xs text-muted">
                      {r.warehouse_code ? whName(r.warehouse_code) : 'Chung'} • {r.source}
                    </div>
                  </td>
                  <td>
                    <div className="font-bold">{r.ad_name || r.campaign_name || '—'}</div>
                    {r.adset_name && (
                      <div className="text-xs text-muted">{r.campaign_name} • {r.adset_name}</div>
                    )}
                  </td>
                  <td className="text-right">{formatNumber(r.messages || 0)} / {formatNumber(r.leads || 0)}</td>
                  <td className="text-right font-bold">{formatCurrency(r.spend)}</td>
                  <td className="text-right">
                    {r.source === 'meta_api' ? (
                      <span className="text-xs text-muted">API</span>
                    ) : (
                      <button
                        type="button"
                        disabled={readOnly}
                        className="btn btn-outline btn-sm"
                        style={{ color: '#dc2626' }}
                        onClick={() => onRemove(r.id)}
                      >
                        ✕
                      </button>
                    )}
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
