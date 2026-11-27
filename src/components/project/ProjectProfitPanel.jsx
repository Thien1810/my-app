import { formatCurrency, formatNumber } from '../../lib/formatters'
import { KindBadge } from '../Badges'

export default function ProjectProfitPanel({
  project, financialSummary, otherCosts, handleExportProjectSummary,
}) {
  return (
    <div className="card ui-card">
      <div className="card-header">
        <div>
          <h3>📊 Quyết toán Tổng kết Dự án</h3>
          <p className="text-xs text-muted">
            Lợi nhuận = Doanh thu − (Tiêu hao thực tế + Khấu hao đồ tái sử dụng + Giá
            trị hỏng/mất + Chi phí khác)
          </p>
        </div>
        <button className="ui-btn ui-btn--secondary" onClick={handleExportProjectSummary}>
          📥 Xuất quyết toán Excel
        </button>
      </div>

      {financialSummary.missingExpectedUsesItems.length > 0 && (
        <div className="alert alert-warning">
          💡 <strong>Gợi ý:</strong> Các đồ tái sử dụng sau chưa được thiết lập{' '}
          <em>"Số lần sử dụng dự kiến (expected_uses)"</em> nên khấu hao đang tạm tính bằng 0 ₫:{' '}
          <strong>{financialSummary.missingExpectedUsesItems.join(', ')}</strong>. Bạn có thể
          cập nhật trong mục Danh mục Vật tư.
        </div>
      )}

      {project.status === 'cancelled' && (
        <div className="alert alert-warning">
          ⚠️ <strong>Dự án đã hủy:</strong> trong Báo cáo P&L doanh thu tính 0; các chi phí đã
          phát sinh được tính vào tháng hủy
          {project.cancelled_at ? ` (${String(project.cancelled_at).slice(0, 7)})` : ''}. Số
          liệu bên dưới là theo giá trị hợp đồng; P&L tính doanh thu 0 cho dự án hủy.
        </div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="kpi-card">
          <div className="kpi-label">Doanh số (giá gói)</div>
          <div className="kpi-value">{formatCurrency(financialSummary.grossSales)}</div>
          <div className="kpi-sub">Giá gói gốc trước ưu đãi</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Ưu đãi</div>
          {financialSummary.discount > 0 ? (
            <>
              <div className="kpi-value text-red">
                − {formatCurrency(financialSummary.discount)}
              </div>
              <div className="kpi-sub">
                {((financialSummary.discount / financialSummary.grossSales) * 100).toFixed(1)}%
                trên doanh số
              </div>
            </>
          ) : (
            <div className="kpi-sub">Không có ưu đãi</div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Doanh thu (khách thực trả)</div>
          <div className="kpi-value text-green">
            {formatCurrency(financialSummary.contractValue)}
          </div>
          <div className="kpi-sub">= Doanh số − Ưu đãi</div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-label">Doanh thu (khách thực trả)</div>
          <div className="kpi-value text-green">
            {formatCurrency(financialSummary.contractValue)}
          </div>
          <div className="kpi-sub">
            {financialSummary.discount > 0 ? '= Doanh số − Ưu đãi' : 'Doanh thu dự án'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Chi phí vật tư tiêu hao</div>
          <div className="kpi-value">{formatCurrency(financialSummary.consumableCost)}</div>
          <div className="kpi-sub">(SL xuất − SL dư trả kho) × Giá vốn</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Khấu hao đồ tái sử dụng</div>
          <div className="kpi-value">{formatCurrency(financialSummary.depreciationCost)}</div>
          <div className="kpi-sub">SL xuất × Giá vốn / Số lần dùng dự kiến</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Thiệt hại hỏng & mất</div>
          <div className="kpi-value text-red">
            {formatCurrency(financialSummary.damagedLostCost)}
          </div>
          <div className="kpi-sub">(SL hỏng + SL mất) × Giá vốn</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Chi phí xoay vòng khác</div>
          <div className="kpi-value">{formatCurrency(financialSummary.otherCostTotal)}</div>
          <div className="kpi-sub">{otherCosts.length} khoản nhân công/vận chuyển/hoa</div>
        </div>

        <div
          className={`kpi-card ${
            financialSummary.profit >= 0 ? 'kpi-success' : 'kpi-danger'
          }`}
        >
          <div className="kpi-label">Lãi gộp thi công dự án</div>
          <div
            className={`kpi-value ${
              financialSummary.profit >= 0 ? 'text-green' : 'text-red'
            }`}
          >
            {formatCurrency(financialSummary.profit)}
          </div>
          <div className="kpi-sub">
            Tổng chi phí: {formatCurrency(financialSummary.totalCost)}
          </div>
          <div
            className={`kpi-sub ${
              financialSummary.contractValue > 0
                ? financialSummary.profit >= 0
                  ? 'text-green'
                  : 'text-red'
                : ''
            }`}
          >
            Biên lợi nhuận:{' '}
            {financialSummary.contractValue > 0
              ? `${financialSummary.marginPct.toFixed(1)}%`
              : '—'}
          </div>
        </div>
      </div>

      <h4>Chi tiết chi phí từng vật tư trong dự án</h4>
      {financialSummary.itemBreakdown.length === 0 ? (
        <div className="empty-state">Chưa có vật tư xuất kho cho dự án này.</div>
      ) : (
        <div className="table-responsive" style={{ marginTop: 10 }}>
          <table className="data-table ui-table">
            <thead>
              <tr>
                <th>Vật tư</th>
                <th>Loại</th>
                <th className="text-right">Đã xuất</th>
                <th className="text-right">Thu tốt / Dư</th>
                <th className="text-right">Hỏng + Mất</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Tiêu hao</th>
                <th className="text-right">Khấu hao</th>
                <th className="text-right">Hỏng & Mất</th>
              </tr>
            </thead>
            <tbody>
              {financialSummary.itemBreakdown.map((r) => (
                <tr key={r.item_id}>
                  <td className="ui-table__primary" data-label="Vật tư">
                    <div className="font-bold">{r.item.name}</div>
                    {r.missingExpectedUses && (
                      <div className="text-xs text-amber">
                        ⚠️ Chưa đặt số lần dùng dự kiến (khấu hao = 0)
                      </div>
                    )}
                  </td>
                  <td data-label="Loại">
                    <KindBadge kind={r.item.kind} />
                  </td>
                  <td className="text-right" data-label="Đã xuất">{formatNumber(r.issued)}</td>
                  <td className="text-right text-green" data-label="Thu tốt / Dư">{formatNumber(r.return_good)}</td>
                  <td className="text-right text-red" data-label="Hỏng + Mất">
                    {formatNumber(r.return_damaged + r.return_lost)}
                  </td>
                  <td className="text-right" data-label="Giá vốn">{formatCurrency(r.cost)}</td>
                  <td className="text-right" data-label="Tiêu hao">{formatCurrency(r.rowConsumable)}</td>
                  <td className="text-right" data-label="Khấu hao">{formatCurrency(r.rowDepreciation)}</td>
                  <td className="text-right text-red" data-label="Hỏng & Mất">{formatCurrency(r.rowDamagedLost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
