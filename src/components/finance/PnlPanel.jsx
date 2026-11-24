import { formatCurrency } from '../../lib/formatters'
import { PROJECT_LEAD_SOURCES } from '../../lib/metaAdsClient'

// Component thuần hiển thị P&L (không gọi DB). Số liệu do calcPnl / calcBySource tính sẵn.

const DASH = '—'
const pctOf = (value, revenue) => (revenue > 0 ? `${((value / revenue) * 100).toFixed(1)}%` : DASH)
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`
const money = (v) => (v == null ? DASH : formatCurrency(Math.round(v)))

function sourceLabel(id) {
  if (!id || id === 'unknown') return 'Chưa chọn nguồn'
  return PROJECT_LEAD_SOURCES.find((s) => s.id === id)?.label || id
}

export default function PnlPanel({ pnl, bySource = [], month, scope = 'all', warehouses = [], cashIn }) {
  if (!pnl) return null
  const isAll = scope === 'all'
  const whName = (code) => warehouses.find((w) => w.code === code)?.name || code
  const scopeLabel = isAll ? 'Tất cả kho' : whName(scope)
  const showOtherCol = (pnl.byWarehouse || []).some((w) => Number(w.otherIncome) !== 0)
  const netOk = pnl.netProfit >= 0
  const overhead = pnl.adsSpend + pnl.fixedCostTotal
  const rev = pnl.revenue

  const roasText = pnl.roas == null ? DASH : `${pnl.roas.toFixed(1)}x`
  const cirText = pnl.cir == null ? DASH : `${(pnl.cir * 100).toFixed(1)}%`

  const rows = [
    {
      key: 'I',
      label: 'I. Doanh thu',
      note: `Giá trị hợp đồng các đám trong tháng ${month}`,
      value: pnl.revenue,
      strong: true,
      cls: 'text-green',
    },
    {
      key: 'II',
      label: 'II. Chi phí xoay vòng',
      note: 'Vật tư tiêu hao, khấu hao, hao hụt, chi phí trực tiếp tại đám',
      value: pnl.rotatingCost,
    },
    {
      key: 'III',
      label: 'III. Lãi gộp (I − II)',
      note: 'Hiệu quả đội thi công và kho',
      value: pnl.grossProfit,
      strong: true,
      cls: 'text-green',
      bg: '#f0fdf4',
      pct: fmtPct(pnl.grossMarginPct),
    },
    {
      key: 'IV',
      label: 'IV. Chi phí Ads',
      note: 'Từ sổ Ads',
      value: pnl.adsSpend,
      cls: 'text-blue',
    },
    {
      key: 'V',
      label: 'V. Chi phí cứng',
      note: 'Từ sổ chi phí cứng (đã phân bổ theo kho nếu xem theo kho)',
      value: pnl.fixedCostTotal,
      cls: 'text-amber',
    },
    ...(pnl.otherIncome > 0
      ? [
          {
            key: 'VII',
            label: 'VII. Thu nhập khác (mất cọc)',
            note: 'Tiền cọc khách hủy (forfeit)',
            value: pnl.otherIncome,
            cls: 'text-green',
          },
        ]
      : []),
    {
      key: 'VI',
      label: 'VI. Lợi nhuận ròng (III − IV − V' + (pnl.otherIncome > 0 ? ' + VII' : '') + ')',
      note: 'Sau mọi chi phí xoay vòng, Ads và chi phí cứng',
      value: pnl.netProfit,
      strong: true,
      cls: netOk ? 'text-green' : 'text-red',
      bg: netOk ? '#ecfdf5' : '#fef2f2',
      pct: fmtPct(pnl.netMarginPct),
      big: true,
    },
  ]

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {pnl.unknownSourceCount > 0 && (
        <div className="alert alert-warning">
          {pnl.unknownSourceCount} dự án chưa chọn nguồn khách, không tính vào CAC/ROAS.
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Doanh thu</div>
          <div className="kpi-value">{formatCurrency(pnl.revenue)}</div>
          <div className="kpi-sub">
            Chi phí xoay vòng: <strong>{formatCurrency(pnl.rotatingCost)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Lãi gộp</div>
          <div className="kpi-value text-green">{formatCurrency(pnl.grossProfit)}</div>
          <div className="kpi-sub">
            Biên lãi gộp: <strong>{fmtPct(pnl.grossMarginPct)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Chi phí Ads + Chi phí cứng</div>
          <div className="kpi-value text-amber">{formatCurrency(overhead)}</div>
          <div className="kpi-sub">
            Ads: <strong>{formatCurrency(pnl.adsSpend)}</strong> • Cứng:{' '}
            <strong>{formatCurrency(pnl.fixedCostTotal)}</strong>
          </div>
        </div>

        <div className={`kpi-card ${netOk ? 'kpi-success' : 'kpi-danger'}`}>
          <div className="kpi-label">Lợi nhuận ròng</div>
          <div className={`kpi-value ${netOk ? 'text-green' : 'text-red'}`}>
            {formatCurrency(pnl.netProfit)}
          </div>
          <div className="kpi-sub">
            Biên ròng: <strong>{fmtPct(pnl.netMarginPct)}</strong>
          </div>
        </div>
      </div>

      <div className="text-muted" style={{ fontSize: 13.5 }}>
        Doanh thu dự kiến (đang báo giá): <strong>{formatCurrency(pnl.expectedRevenue)}</strong>{' '}
        <span className="text-xs">(chưa cộng vào P&L)</span>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <h3 style={{ marginBottom: 0 }}>
            Báo cáo kết quả kinh doanh (P&L) — Tháng {month} • {scopeLabel}
          </h3>
          <div className="badge badge-blue" style={{ fontSize: 13, padding: '6px 12px' }}>
            Điểm hòa vốn:{' '}
            {pnl.breakEven == null ? (
              <strong>{pnl.breakEvenNote || 'chưa đủ dữ liệu'}</strong>
            ) : (
              <strong>{pnl.breakEven} đám/tháng</strong>
            )}
          </div>
        </div>

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Chỉ tiêu</th>
                <th>Diễn giải</th>
                <th className="text-right">Số tiền (₫)</th>
                <th className="text-right">Tỷ trọng / Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={r.bg ? { background: r.bg } : undefined}>
                  <td className={r.strong ? 'font-bold' : undefined} style={r.big ? { fontSize: 15 } : undefined}>
                    {r.label}
                  </td>
                  <td className="text-xs text-muted">{r.note}</td>
                  <td
                    className={`text-right ${r.strong ? 'font-bold' : ''} ${r.cls || ''}`}
                    style={r.big ? { fontSize: 16 } : undefined}
                  >
                    {formatCurrency(r.value)}
                  </td>
                  <td className={`text-right ${r.strong ? 'font-bold' : ''} ${r.strong ? r.cls || '' : ''}`}>
                    {r.key === 'I' ? (rev > 0 ? '100%' : DASH) : r.pct || pctOf(r.value, rev)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cashIn !== undefined && (
          <div className="text-xs text-muted" style={{ marginTop: 8 }}>
            Dòng tiền cọc/tạm ứng thu trong tháng: <strong>{formatCurrency(cashIn)}</strong> (chỉ theo dõi, không
            phải doanh thu)
            {!isAll && <> — Tiền cọc chưa gán kho nên số này là toàn công ty.</>}
          </div>
        )}

        <div className="kpi-grid" style={{ marginTop: 16 }}>
          <div className="kpi-card">
            <div className="kpi-label">CAC (chi phí Ads / đám từ Ads)</div>
            <div className="kpi-value">{money(pnl.cac)}</div>
            <div className="kpi-sub">{pnl.paidAdsProjectCount} đám từ Ads</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">ROAS</div>
            <div className="kpi-value">{roasText}</div>
            <div className="kpi-sub">Doanh thu từ Ads: {formatCurrency(pnl.paidAdsRevenue)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">CIR (Ads / doanh thu từ Ads)</div>
            <div className="kpi-value">{cirText}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">CPL (chi phí / tin nhắn + lead)</div>
            <div className="kpi-value">{money(pnl.cpl)}</div>
          </div>
        </div>
      </div>

      <div className="form-grid-2">
        {isAll && (
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ marginBottom: 6 }}>Hiệu quả theo kho</h3>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kho</th>
                    <th className="text-right">Doanh thu</th>
                    <th className="text-right">Lãi gộp</th>
                    <th className="text-right">Ads</th>
                    <th className="text-right">Chi phí cứng</th>
                    {showOtherCol && <th className="text-right">Thu nhập khác</th>}
                    <th className="text-right">Lợi nhuận ròng</th>
                  </tr>
                </thead>
                <tbody>
                  {(pnl.byWarehouse || []).map((w) => (
                    <tr key={w.code}>
                      <td className="font-bold" style={{ color: '#163828' }}>
                        {whName(w.code)}
                      </td>
                      <td className="text-right">{formatCurrency(w.revenue)}</td>
                      <td className="text-right text-green font-bold">{formatCurrency(w.grossProfit)}</td>
                      <td className="text-right text-blue">{formatCurrency(w.adsSpend)}</td>
                      <td className="text-right text-amber">{formatCurrency(w.fixedCostTotal)}</td>
                      {showOtherCol && <td className="text-right">{formatCurrency(w.otherIncome || 0)}</td>}
                      <td className={`text-right font-bold ${w.netProfit >= 0 ? 'text-green' : 'text-red'}`}>
                        {formatCurrency(w.netProfit)}
                      </td>
                    </tr>
                  ))}
                  {pnl.unassigned && pnl.unassigned.projectCount > 0 && (
                    <tr>
                      <td className="font-bold">
                        Chưa gán kho
                        <div className="text-xs text-muted">{pnl.unassigned.projectCount} đám</div>
                      </td>
                      <td className="text-right">{formatCurrency(pnl.unassigned.revenue)}</td>
                      <td className="text-right text-green font-bold">
                        {formatCurrency(pnl.unassigned.revenue - pnl.unassigned.rotatingCost)}
                      </td>
                      <td className="text-right">{DASH}</td>
                      <td className="text-right">{DASH}</td>
                      {showOtherCol && <td className="text-right">{DASH}</td>}
                      <td className="text-right">{DASH}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>Phân tích theo nguồn khách</h3>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nguồn khách hàng</th>
                  <th className="text-right">Số đám</th>
                  <th className="text-right">Doanh thu HĐ</th>
                  <th className="text-right">TB / Đám</th>
                  <th className="text-right">Lãi gộp</th>
                </tr>
              </thead>
              <tbody>
                {bySource.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted">
                      Chưa có dự án tính doanh thu trong tháng này.
                    </td>
                  </tr>
                )}
                {bySource.map((row) => {
                  const paid = PROJECT_LEAD_SOURCES.find((s) => s.id === row.source)?.isPaidAds
                  return (
                    <tr key={row.source}>
                      <td>
                        <span className={`badge ${paid ? 'badge-blue' : 'badge-gray'}`}>
                          {sourceLabel(row.source)}
                        </span>
                      </td>
                      <td className="text-right font-bold">{row.count}</td>
                      <td className="text-right">{formatCurrency(row.revenue)}</td>
                      <td className="text-right font-bold">
                        {row.count > 0 ? formatCurrency(Math.round(row.revenue / row.count)) : DASH}
                      </td>
                      <td className="text-right text-green font-bold">{formatCurrency(row.grossProfit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
