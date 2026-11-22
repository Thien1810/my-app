import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  MOVEMENT_TYPE_LABELS,
} from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { KindBadge, MovementTypeBadge, ProjectStatusBadge } from '../components/Badges'

export default function ItemDetailPage() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDetail = async () => {
    setLoading(true)
    setError('')
    try {
      const [itemRes, movesRes] = await Promise.all([
        supabase.from('item_stock').select('*').eq('id', id).maybeSingle(),
        supabase
          .from('stock_movements')
          .select(
            '*, project:projects(id, code, name, status, start_date, end_date, location), partner:partners(id, name)'
          )
          .eq('item_id', id)
          .order('moved_at', { ascending: false })
          .order('id', { ascending: false }),
      ])

      if (itemRes.error) throw itemRes.error
      if (movesRes.error) throw movesRes.error

      setItem(itemRes.data)
      setMovements(movesRes.data || [])
    } catch (err) {
      setError(err.message || 'Không thể tải chi tiết vật tư')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetail()
  }, [id])

  // Tính các dự án đang giữ vật tư này (net outstanding > 0)
  const holdingProjects = useMemo(() => {
    const byProject = new Map()
    for (const m of movements) {
      if (!m.project_id) continue
      if (!byProject.has(m.project_id)) {
        byProject.set(m.project_id, {
          project_id: m.project_id,
          project: m.project,
          issued: 0,
          returnedGood: 0,
          returnedDamaged: 0,
          returnedLost: 0,
        })
      }
      const p = byProject.get(m.project_id)
      const qty = Number(m.qty || 0)
      if (m.type === 'issue') p.issued += qty
      else if (m.type === 'return_good') p.returnedGood += qty
      else if (m.type === 'return_damaged') p.returnedDamaged += qty
      else if (m.type === 'return_lost') p.returnedLost += qty
    }

    const result = []
    for (const p of byProject.values()) {
      const outstanding = p.issued - p.returnedGood - p.returnedDamaged - p.returnedLost
      if (outstanding > 0) {
        result.push({
          ...p,
          outstanding,
        })
      }
    }
    return result
  }, [movements])

  const handleExportHistory = () => {
    if (!item) return
    const rows = movements.map((m) => ({
      'Ngày': formatDate(m.moved_at),
      'Loại phiếu': MOVEMENT_TYPE_LABELS[m.type] || m.type,
      'Số lượng': Number(m.qty || 0),
      'Đơn giá nhập (₫)': m.unit_cost ? Number(m.unit_cost) : '',
      'Dự án': m.project?.name || '',
      'Đối tác': m.partner?.name || '',
      'Ghi chú': m.note || '',
    }))
    exportToExcel(rows, 'LichSuVatTu', `lich-su-vat-tu-${item.code || item.id}.xlsx`)
  }

  if (loading) return <div className="loading-state">Đang tải chi tiết vật tư...</div>
  if (!item) {
    return (
      <div className="page-container">
        <div className="alert alert-error">{error || 'Không tìm thấy vật tư'}</div>
        <Link to="/vat-tu" className="btn btn-outline">
          ← Quay lại danh sách vật tư
        </Link>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link to="/vat-tu">Vật tư</Link> / <span>{item.name}</span>
          </div>
          <h1>
            {item.name}{' '}
            <span style={{ fontSize: '0.9rem', verticalAlign: 'middle' }}>
              <KindBadge kind={item.kind} />
            </span>
          </h1>
          <p className="text-muted">
            Mã: <strong>{item.code || `#${item.id}`}</strong> • Danh mục:{' '}
            <strong>{item.category || 'Chưa phân loại'}</strong> • Đơn vị: <strong>{item.unit}</strong>
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={handleExportHistory}>
            📥 Xuất lịch sử Excel
          </button>
          <Link to="/vat-tu" className="btn btn-outline">
            ← Quay lại
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Thông số tồn kho của vật tư */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Tồn trong kho</div>
          <div className="kpi-value text-green">
            {formatNumber(item.in_stock)} {item.unit}
          </div>
          <div className="kpi-sub">Tồn tối thiểu: {formatNumber(item.min_stock)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Đang ở dự án</div>
          <div className="kpi-value text-blue">
            {item.kind === 'reusable' ? `${formatNumber(item.at_project)} ${item.unit}` : '—'}
          </div>
          <div className="kpi-sub">
            {item.kind === 'reusable'
              ? `Đang nằm tại ${holdingProjects.length} dự án`
              : 'Vật tư tiêu hao không tính thu hồi bắt buộc'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Chờ sửa chữa</div>
          <div className="kpi-value text-amber">
            {formatNumber(item.in_repair)} {item.unit}
          </div>
          <div className="kpi-sub">Tổng mất tích lũy: {formatNumber(item.lost_total)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Giá nhập gần nhất</div>
          <div className="kpi-value">{formatCurrency(item.cost)}</div>
          <div className="kpi-sub">
            {item.kind === 'reusable'
              ? `Số lần dùng dự kiến: ${item.expected_uses || 'Chưa đặt'}`
              : 'Tính trực tiếp vào chi phí tiêu hao'}
          </div>
        </div>
      </div>

      {/* Các dự án đang giữ vật tư này */}
      {item.kind === 'reusable' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h3>🎪 Các dự án đang giữ vật tư này ({holdingProjects.length})</h3>
          </div>
          {holdingProjects.length === 0 ? (
            <div className="empty-state">Hiện không có dự án nào đang giữ vật tư này.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dự án</th>
                    <th>Trạng thái</th>
                    <th>Thời gian</th>
                    <th className="text-right">Đã xuất</th>
                    <th className="text-right">Đã thu tốt</th>
                    <th className="text-right">Hỏng / Mất</th>
                    <th className="text-right">Còn đang giữ</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingProjects.map((hp) => (
                    <tr key={hp.project_id}>
                      <td>
                        <Link to={`/du-an/${hp.project_id}`} className="table-link font-bold">
                          {hp.project?.name || `Dự án #${hp.project_id}`}
                        </Link>
                      </td>
                      <td>
                        {hp.project?.status && <ProjectStatusBadge status={hp.project.status} />}
                      </td>
                      <td>
                        {formatDate(hp.project?.start_date)} → {formatDate(hp.project?.end_date)}
                      </td>
                      <td className="text-right">{formatNumber(hp.issued)}</td>
                      <td className="text-right text-green">{formatNumber(hp.returnedGood)}</td>
                      <td className="text-right text-red">
                        {formatNumber(hp.returnedDamaged + hp.returnedLost)}
                      </td>
                      <td className="text-right font-bold text-blue">
                        {formatNumber(hp.outstanding)} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lịch sử xuất nhập của vật tư */}
      <div className="card">
        <div className="card-header">
          <h3>📜 Lịch sử biến động kho ({movements.length} phiếu)</h3>
        </div>
        {movements.length === 0 ? (
          <div className="empty-state">Chưa có phát sinh phiếu kho nào cho vật tư này.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Loại phiếu</th>
                  <th className="text-right">Số lượng</th>
                  <th className="text-right">Đơn giá nhập</th>
                  <th>Dự án / Đối tác</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.moved_at)}</td>
                    <td>
                      <MovementTypeBadge type={m.type} />
                    </td>
                    <td className="text-right font-bold">
                      {formatNumber(m.qty)} {item.unit}
                    </td>
                    <td className="text-right">
                      {m.unit_cost != null ? formatCurrency(m.unit_cost) : '—'}
                    </td>
                    <td>
                      {m.project ? (
                        <Link to={`/du-an/${m.project.id}`} className="table-link">
                          🎪 {m.project.name}
                        </Link>
                      ) : m.partner ? (
                        <span>🤝 {m.partner.name}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{m.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
