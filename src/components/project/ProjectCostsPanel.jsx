import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '../../lib/formatters'
import CurrencyInput from '../CurrencyInput'
import ProjectFeedback from './ProjectFeedback'

export default function ProjectCostsPanel({
  feedback, costKind, setCostKind, costAmount, setCostAmount, costDate, setCostDate, costNote, setCostNote,
  busyCost, otherCosts, handleAddCost, handleDeleteCost,
}) {
  return (
    <div className="card ui-card">
      <div className="card-header">
        <div>
          <h3>💸 Chi phí xoay vòng trực tiếp tại dự án (Nhân công, vận chuyển, hoa tươi...)</h3>
          <p className="text-xs text-muted">
            🔒 Chỉ hiển thị cho Quản lý & Quản trị. Lưu ý: Chi phí cứng cố định hàng tháng & Chi
            phí Ads được hạch toán riêng tại Trung tâm P&L để không trùng luồng.
          </p>
        </div>
        <Link to="/bao-cao?tab=pnl" className="ui-btn ui-btn--secondary">
          🏛️ Mở P&L Chi phí cứng & Ads
        </Link>
      </div>

      <form onSubmit={handleAddCost} className="sub-card ui-card" style={{ marginBottom: 20 }}>
        <div className="project-presets">
          <span className="text-xs text-muted">Chọn nhanh khoản mục xoay vòng tại đám:</span>
          {['Nhân công', 'Vận chuyển', 'Hoa tươi', 'Thuê ngoài / Phụ kiện'].map((preset) => (
            <button
              key={preset}
              type="button"
              className={`ui-btn ui-btn--${costKind === preset ? 'primary' : 'secondary'}`}
              aria-pressed={costKind === preset}
              onClick={() => setCostKind(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="form-grid-4">
          <div className="form-group">
            <label>Khoản mục chi phí *</label>
            <input className="ui-input"
              type="text"
              required
              placeholder="VD: Nhân công, Vận chuyển, Hoa tươi..."
              value={costKind}
              onChange={(e) => setCostKind(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Số tiền (₫) *</label>
            <CurrencyInput
              className="ui-input"
              required
              placeholder="VD: 1.500.000"
              value={costAmount}
              onChange={(num) => setCostAmount(num)}
            />
          </div>
          <div className="form-group">
            <label>Ngày chi *</label>
            <input className="ui-input"
              type="date"
              required
              value={costDate}
              onChange={(e) => setCostDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Ghi chú</label>
            <input className="ui-input"
              type="text"
              placeholder="Chi tiết người nhận, chuyến xe..."
              value={costNote}
              onChange={(e) => setCostNote(e.target.value)}
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busyCost}>
            {busyCost ? 'Đang lưu...' : '+ Thêm chi phí'}
          </button>
        </div>
        <ProjectFeedback feedback={feedback.costForm} />
      </form>

      <ProjectFeedback feedback={feedback.costRows} />
      {otherCosts.length === 0 ? (
        <div className="empty-state">Chưa ghi nhận khoản chi phí khác nào cho dự án này.</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table ui-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Khoản mục</th>
                <th>Ghi chú</th>
                <th className="text-right">Số tiền</th>
                <th className="text-right">Xóa</th>
              </tr>
            </thead>
            <tbody>
              {otherCosts.map((c) => (
                <tr key={c.id}>
                  <td data-label="Ngày">{formatDate(c.cost_date)}</td>
                  <td className="ui-table__primary font-bold" data-label="Khoản mục">{c.kind}</td>
                  <td className="project-cell-stack" data-label="Ghi chú">{c.note || '—'}</td>
                  <td className="text-right font-bold" data-label="Số tiền">{formatCurrency(c.amount)}</td>
                  <td className="ui-table__actions text-right" data-label="Xóa">
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary"
                      onClick={() => handleDeleteCost(c.id)}
                    >
                      Xóa
                    </button>
                    <ProjectFeedback feedback={feedback[`costRow:${c.id}`]} />
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
