import { formatNumber } from '../../lib/formatters'
import { KindBadge } from '../Badges'
import ProjectFeedback from './ProjectFeedback'

export default function ProjectReturnPanel({
  feedback, itemStats, movesLoadFailed, returnInputs, returnDate, setReturnDate, returnNote, setReturnNote, busyReturn,
  handleFillAllGood, handleSubmitReturns, handleReturnInputChange,
}) {
  return (
    <div className="card ui-card">
      <div className="card-header">
        <div>
          <h3>📥 Thu hồi vật tư sau sự kiện</h3>
          <p className="text-xs text-muted">
            Với <strong>Đồ tái sử dụng</strong>: nhập SL thu về Tốt, Hỏng (chuyển sang chờ sửa)
            hoặc Mất. Với <strong>Vật tư tiêu hao</strong>: nhập SL dư không dùng hết trả lại kho.
          </p>
        </div>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={handleFillAllGood}>
          ✓ Điền nhanh: Thu hồi tốt 100% đồ tái sử dụng
        </button>
      </div>

      {itemStats.length === 0 ? (
        <>
          <ProjectFeedback feedback={feedback.returns} />
          {movesLoadFailed ? (
            <div className="alert alert-error" role="alert">
              Không tải được phiếu kho của dự án nên không biết còn bao nhiêu đồ ở dự án. Hãy tải lại trang trước khi
              thu hồi.
            </div>
          ) : (
            <div className="empty-state">
              Dự án này chưa có vật tư nào được xuất kho nên chưa thể thu hồi.
            </div>
          )}
        </>
      ) : (
        <form onSubmit={handleSubmitReturns} className="ui-has-sticky-bar">
          <div className="form-grid-2" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label>Ngày thu hồi *</label>
              <input className="ui-input"
                type="date"
                required
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Ghi chú đợt thu hồi</label>
              <input className="ui-input"
                type="text"
                placeholder="VD: Thu hồi sau tháo dỡ ca đêm..."
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
              />
            </div>
          </div>

          <div className="table-responsive">
            <table className="data-table ui-table project-return-table">
              <thead>
                <tr>
                  <th>Vật tư</th>
                  <th>Loại</th>
                  <th className="text-right">Đã xuất</th>
                  <th className="text-right">Đã thu (Tốt/Hỏng/Mất)</th>
                  <th className="text-right">Đang còn ở dự án</th>
                  <th style={{ width: 130 }}>SL Tốt / Dư trả kho</th>
                  <th style={{ width: 120 }}>SL Hỏng (chờ sửa)</th>
                  <th style={{ width: 120 }}>SL Mất</th>
                </tr>
              </thead>
              <tbody>
                {itemStats.map((row) => {
                  const isReusable = row.item.kind === 'reusable'
                  const inp = returnInputs[row.item_id] || {
                    good: '',
                    damaged: '',
                    lost: '',
                  }
                  return (
                    <tr key={row.item_id}>
                      <td className="ui-table__primary" data-label="Vật tư">
                        <div className="font-bold">{row.item.name}</div>
                        <div className="text-xs text-muted">
                          {row.item.code || `#${row.item_id}`} • ĐVT: {row.item.unit}
                        </div>
                      </td>
                      <td data-label="Loại">
                        <KindBadge kind={row.item.kind} />
                      </td>
                      <td className="text-right font-bold" data-label="Đã xuất">{formatNumber(row.issued)}</td>
                      <td className="text-right" data-label="Đã thu (Tốt/Hỏng/Mất)">
                        <span>
                          <span className="text-green">{formatNumber(row.return_good)}</span> /{' '}
                          <span className="text-amber">{formatNumber(row.return_damaged)}</span> /{' '}
                          <span className="text-red">{formatNumber(row.return_lost)}</span>
                        </span>
                      </td>
                      <td
                        className="text-right font-bold text-blue project-return-outstanding"
                        data-label="Đang còn ở dự án"
                      >
                        {isReusable
                          ? `${formatNumber(row.outstanding)} ${row.item.unit}`
                          : `Đã dùng: ${formatNumber(row.netConsumed)}`}
                      </td>
                      <td
                        className={`project-return-input${isReusable ? '' : ' project-return-input--only'}`}
                        data-label={isReusable ? 'Tốt' : 'Dư trả kho'}
                      >
                        <input className="ui-input"
                          type="number"
                          min="0"
                          step="any"
                          placeholder={isReusable ? 'SL tốt' : 'SL dư'}
                          aria-label={`${isReusable ? 'Số lượng tốt' : 'Số lượng dư'} của ${row.item.name}`}
                          value={inp.good}
                          onChange={(e) =>
                            handleReturnInputChange(row.item_id, 'good', e.target.value)
                          }
                        />
                      </td>
                      <td className={isReusable ? 'project-return-input' : 'project-return-na'} data-label="Hỏng">
                        {isReusable ? (
                          <input className="ui-input"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            placeholder="SL hỏng"
                            aria-label={`Số lượng hỏng của ${row.item.name}`}
                            value={inp.damaged}
                            onChange={(e) =>
                              handleReturnInputChange(row.item_id, 'damaged', e.target.value)
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className={isReusable ? 'project-return-input' : 'project-return-na'} data-label="Mất">
                        {isReusable ? (
                          <input className="ui-input"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            placeholder="SL mất"
                            aria-label={`Số lượng mất của ${row.item.name}`}
                            value={inp.lost}
                            onChange={(e) =>
                              handleReturnInputChange(row.item_id, 'lost', e.target.value)
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="ui-sticky-bar project-actions-bar">
            <ProjectFeedback feedback={feedback.returns} />
            <button type="submit" className="ui-btn ui-btn--primary" disabled={busyReturn}>
              {busyReturn ? 'Đang lưu phiếu thu hồi...' : 'Xác nhận thu hồi vật tư'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
