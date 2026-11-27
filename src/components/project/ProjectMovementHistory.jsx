import { formatDate, formatNumber } from '../../lib/formatters'
import { MovementTypeBadge } from '../Badges'

export default function ProjectMovementHistory({
  movements, movesLoadFailed,
}) {
  return (
    <div className="card ui-card">
      <h3 style={{ marginBottom: 10 }}>
        Lịch sử phiếu kho của dự án ({movements.length})
      </h3>
      {movesLoadFailed ? (
        <div className="alert alert-error">Không tải được lịch sử phiếu kho.</div>
      ) : movements.length === 0 ? (
        <div className="empty-state">Chưa có phiếu xuất/thu hồi nào cho dự án này.</div>
      ) : (
        <div className="table-responsive">
          <table className="data-table ui-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Loại phiếu</th>
                <th>Vật tư</th>
                <th className="text-right">Số lượng</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td data-label="Ngày">{formatDate(m.moved_at)}</td>
                  <td data-label="Loại phiếu">
                    <MovementTypeBadge type={m.type} />
                  </td>
                  <td className="ui-table__primary font-bold" data-label="Vật tư">{m.item?.name || `#${m.item_id}`}</td>
                  <td className="text-right font-bold" data-label="Số lượng">
                    {formatNumber(m.qty)} {m.item?.unit || ''}
                  </td>
                  <td data-label="Ghi chú">{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
