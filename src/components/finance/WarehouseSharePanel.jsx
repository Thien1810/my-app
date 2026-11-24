import { Link } from 'react-router-dom'
import { formatCurrency } from '../../lib/formatters'

// Bảng chỉ đọc: giá trị tài sản và tỷ trọng từng kho.
export default function WarehouseSharePanel({ shares = [], title = 'Giá trị tài sản và tỷ trọng từng kho', hideNote = false }) {
  const sorted = [...(shares || [])].sort((a, b) => String(a.code).localeCompare(String(b.code)))

  return (
    <div>
      {title && <h4 style={{ margin: '8px 0' }}>{title}</h4>}
      {sorted.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>Chưa có dữ liệu tỷ trọng kho.</div>
      ) : (
        <div className="table-responsive" style={{ marginBottom: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Kho</th>
                <th className="text-right">Giá trị tài sản (₫)</th>
                <th className="text-right">Tỷ trọng</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.code}>
                  <td>{s.name || s.code}</td>
                  <td className="text-right">{formatCurrency(Number(s.asset_value) || 0)}</td>
                  <td className="text-right font-bold">{((Number(s.share) || 0) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!hideNote && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          Tỷ trọng quyết định cách chia chi phí chung. Muốn chuyển tài sản giữa các kho, vào{' '}
          <Link to="/phieu-kho" style={{ display: "inline-block", padding: "10px 0" }}>Nhập kho / Phiếu kho</Link> → tab Chuyển kho.
        </p>
      )}
    </div>
  )
}
