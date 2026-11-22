import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatCurrency, formatNumber, formatDate, todayISO } from '../lib/formatters'
import { calcProjectItemStats, calcProjectFinancialSummary } from '../lib/calc'
import { KindBadge, ProjectStatusBadge } from '../components/Badges'
import { calcProjectFbReminder } from '../lib/watermarkHelper'

export default function DashboardPage() {
  const { isManagerOrAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [projects, setProjects] = useState([])
  const [movements, setMovements] = useState([])
  const [finances, setFinances] = useState([])
  const [costs, setCosts] = useState([])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [itemsRes, projectsRes, movesRes] = await Promise.all([
        supabase.from('item_stock').select('*').order('name'),
        supabase.from('projects').select('*, customer:partners(name)').order('start_date', { ascending: false }),
        supabase.from('stock_movements').select('*').order('moved_at', { ascending: false }),
      ])

      if (itemsRes.error) throw itemsRes.error
      if (projectsRes.error) throw projectsRes.error
      if (movesRes.error) throw movesRes.error

      setItems(itemsRes.data || [])
      setProjects(projectsRes.data || [])
      setMovements(movesRes.data || [])

      if (isManagerOrAdmin) {
        const [finRes, costRes] = await Promise.all([
          supabase.from('project_finance').select('*'),
          supabase.from('project_costs').select('*'),
        ])
        setFinances(finRes.data || [])
        setCosts(costRes.data || [])
      }
    } catch (err) {
      setError(err.message || 'Không thể tải dữ liệu tổng quan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [isManagerOrAdmin])

  const itemMap = useMemo(() => {
    const map = new Map()
    for (const i of items) map.set(Number(i.id), i)
    return map
  }, [items])

  const stats = useMemo(() => {
    const activeItems = items.filter((i) => i.active)
    const totalInventoryValue = activeItems.reduce(
      (sum, i) => sum + Math.max(0, Number(i.in_stock || 0)) * Number(i.cost || 0),
      0
    )
    const totalAtProjectQty = activeItems.reduce(
      (sum, i) => sum + Math.max(0, Number(i.at_project || 0)),
      0
    )
    const totalAtProjectValue = activeItems.reduce(
      (sum, i) => sum + Math.max(0, Number(i.at_project || 0)) * Number(i.cost || 0),
      0
    )

    const runningProjects = projects.filter((p) =>
      ['preparing', 'in_progress', 'awaiting_return'].includes(p.status)
    )

    const lowStockItems = activeItems.filter(
      (i) => Number(i.min_stock || 0) > 0 && Number(i.in_stock || 0) < Number(i.min_stock || 0)
    )

    const today = todayISO()
    const overdueProjects = []
    for (const p of projects) {
      if (
        ['in_progress', 'awaiting_return'].includes(p.status) &&
        p.end_date &&
        p.end_date < today
      ) {
        const projMoves = movements.filter((m) => m.project_id === p.id)
        const itemStats = calcProjectItemStats(projMoves, itemMap)
        const outstandingCount = itemStats.reduce((s, r) => s + r.outstanding, 0)
        if (outstandingCount > 0) {
          overdueProjects.push({
            ...p,
            outstandingCount,
          })
        }
      }
    }

    const fbOverdueProjects = []
    for (const p of projects) {
      const rem = calcProjectFbReminder(p)
      if (rem.isOverdue5Days) {
        fbOverdueProjects.push({
          ...p,
          daysPassed: rem.daysPassed,
          refDateStr: rem.refDateStr,
        })
      }
    }

    return {
      activeItemCount: activeItems.length,
      consumableCount: activeItems.filter((i) => i.kind === 'consumable').length,
      reusableCount: activeItems.filter((i) => i.kind === 'reusable').length,
      totalInventoryValue,
      totalAtProjectQty,
      totalAtProjectValue,
      runningProjects,
      runningProjectsCount: runningProjects.length,
      lowStockItems,
      overdueProjects,
      fbOverdueProjects,
    }
  }, [items, projects, movements, itemMap])

  // Biểu đồ Nhập / Xuất theo tháng
  const monthlyMovementChart = useMemo(() => {
    const byMonth = new Map()
    for (const m of movements) {
      const month = String(m.moved_at || '').slice(0, 7)
      if (!month) continue
      if (!byMonth.has(month)) {
        byMonth.set(month, {
          month,
          nhapMua: 0,
          xuatDuAn: 0,
          thuHoi: 0,
        })
      }
      const row = byMonth.get(month)
      const qty = Number(m.qty || 0)
      if (m.type === 'purchase') row.nhapMua += qty
      else if (m.type === 'issue') row.xuatDuAn += qty
      else if (m.type === 'return_good') row.thuHoi += qty
    }
    return Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
  }, [movements])

  // Biểu đồ Doanh thu & Lãi theo tháng (chỉ Admin/Manager)
  const monthlyFinanceChart = useMemo(() => {
    if (!isManagerOrAdmin) return []
    const financeMap = new Map()
    for (const f of finances) financeMap.set(Number(f.project_id), Number(f.contract_value || 0))

    const byMonth = new Map()
    for (const p of projects) {
      if (p.status === 'cancelled') continue
      const dateStr = p.start_date || String(p.created_at || '').slice(0, 10)
      const month = dateStr.slice(0, 7)
      if (!month) continue
      if (!byMonth.has(month)) {
        byMonth.set(month, {
          month,
          doanhThu: 0,
          chiPhi: 0,
          loiNhuan: 0,
        })
      }
      const projMoves = movements.filter((m) => m.project_id === p.id)
      const projCosts = costs.filter((c) => c.project_id === p.id)
      const contractValue = financeMap.get(p.id) || 0

      const summary = calcProjectFinancialSummary({
        movements: projMoves,
        itemStockMap: itemMap,
        otherCosts: projCosts,
        contractValue,
      })

      const row = byMonth.get(month)
      row.doanhThu += Math.round(summary.contractValue)
      row.chiPhi += Math.round(summary.totalCost)
      row.loiNhuan += Math.round(summary.profit)
    }

    return Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
  }, [isManagerOrAdmin, projects, finances, costs, movements, itemMap])

  if (loading) {
    return <div className="loading-state">Đang tải dữ liệu tổng quan...</div>
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Tổng quan hệ thống</h1>
          <p className="text-muted">Theo dõi nhanh tồn kho, vật tư tại dự án và các dự án đang chạy</p>
        </div>
        <button className="btn btn-outline" onClick={loadData}>
          ↻ Làm mới
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Các Thẻ KPI về Vật tư & Dự án (Ẩn thẻ Giá trị tiền tồn kho với Thủ kho & Nhân viên) */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Số vật tư đang hoạt động</div>
          <div className="kpi-value">{formatNumber(stats.activeItemCount)}</div>
          <div className="kpi-sub">
            {stats.consumableCount} tiêu hao • {stats.reusableCount} tái sử dụng
          </div>
        </div>

        {isManagerOrAdmin && (
          <div className="kpi-card">
            <div className="kpi-label">Giá trị tồn trong kho</div>
            <div className="kpi-value text-green">{formatCurrency(stats.totalInventoryValue)}</div>
            <div className="kpi-sub">Tính theo Tồn trong kho × Giá nhập gần nhất</div>
          </div>
        )}

        <div className="kpi-card">
          <div className="kpi-label">Đồ đang ở dự án</div>
          <div className="kpi-value text-blue">{formatNumber(stats.totalAtProjectQty)}</div>
          <div className="kpi-sub">
            {isManagerOrAdmin
              ? `Giá trị: ${formatCurrency(stats.totalAtProjectValue)}`
              : 'Tổng số lượng đồ tái sử dụng đang ở dự án'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Dự án đang chạy</div>
          <div className="kpi-value">{formatNumber(stats.runningProjectsCount)}</div>
          <div className="kpi-sub">Chuẩn bị, đang thi công & chờ thu hồi</div>
        </div>

        <div className={`kpi-card ${stats.lowStockItems.length > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Vật tư dưới tồn tối thiểu</div>
          <div className="kpi-value text-amber">{formatNumber(stats.lowStockItems.length)}</div>
          <div className="kpi-sub">Cần nhập bổ sung kịp thời</div>
        </div>

        <div className={`kpi-card ${stats.overdueProjects.length > 0 ? 'kpi-danger' : ''}`}>
          <div className="kpi-label">Dự án quá hạn thu hồi</div>
          <div className="kpi-value text-red">{formatNumber(stats.overdueProjects.length)}</div>
          <div className="kpi-sub">Đã qua ngày tháo dỡ nhưng còn đồ tại dự án</div>
        </div>

        <div className={`kpi-card ${stats.fbOverdueProjects.length > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Nhắc đăng bài Facebook (&gt; 5 ngày)</div>
          <div className="kpi-value text-amber">{formatNumber(stats.fbOverdueProjects.length)}</div>
          <div className="kpi-sub">Dự án quá 5 ngày chưa đăng Fanpage</div>
        </div>
      </div>

      {/* Bảng Nhắc đăng bài Facebook (> 5 ngày) */}
      {stats.fbOverdueProjects.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            borderLeft: '4px solid #f59e0b',
            background: '#fffbeb',
          }}
        >
          <div className="card-header">
            <h3>
              🔔 Nhắc đăng bài Facebook: {stats.fbOverdueProjects.length} dự án đã quá 5 ngày chưa
              đăng Fanpage
            </h3>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên dự án / Sự kiện</th>
                  <th>Khách hàng</th>
                  <th>Ngày thi công</th>
                  <th>Thời gian trôi qua</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {stats.fbOverdueProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <code>{p.code || `#${p.id}`}</code>
                    </td>
                    <td className="font-bold">{p.name}</td>
                    <td>{p.customer?.name || '—'}</td>
                    <td>{formatDate(p.refDateStr)}</td>
                    <td>
                      <span className="badge badge-danger">
                        ⏰ Đã qua {p.daysPassed} ngày
                      </span>
                    </td>
                    <td className="text-right">
                      <Link
                        to={`/du-an/${p.id}?tab=facebook`}
                        className="btn btn-sm btn-primary"
                      >
                        📱 Ghép Watermark & Đăng bài
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bảng Danh sách các Dự án đang chạy */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>🎪 Các dự án đang chạy ({stats.runningProjects.length})</h3>
          <Link to="/du-an" className="btn-link">
            Xem tất cả dự án →
          </Link>
        </div>

        {stats.runningProjects.length === 0 ? (
          <div className="empty-state">Hiện không có dự án nào đang chạy.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên dự án / Sự kiện</th>
                  <th>Khách hàng</th>
                  <th>Địa điểm</th>
                  <th>Ngày thi công → Tháo dỡ</th>
                  <th>Trạng thái</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {stats.runningProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <code>{p.code || `#${p.id}`}</code>
                    </td>
                    <td>
                      <Link to={`/du-an/${p.id}`} className="table-link font-bold">
                        {p.name}
                      </Link>
                    </td>
                    <td>{p.customer?.name || '—'}</td>
                    <td>{p.location || '—'}</td>
                    <td>
                      {formatDate(p.start_date)} → {formatDate(p.end_date)}
                    </td>
                    <td>
                      <ProjectStatusBadge status={p.status} />
                    </td>
                    <td className="text-right">
                      <Link to={`/du-an/${p.id}`} className="btn btn-sm btn-primary">
                        Mở dự án
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Biểu đồ */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header">
            <h3>Lượng Nhập / Xuất / Thu hồi theo tháng</h3>
          </div>
          {monthlyMovementChart.length === 0 ? (
            <div className="empty-state">Chưa có dữ liệu phiếu kho theo tháng</div>
          ) : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={monthlyMovementChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(val) => formatNumber(val)} />
                  <Legend />
                  <Bar dataKey="nhapMua" name="Nhập mua" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="xuatDuAn" name="Xuất dự án" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="thuHoi" name="Thu hồi tốt" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {isManagerOrAdmin && (
          <div className="card">
            <div className="card-header">
              <h3>Doanh thu & Lợi nhuận theo tháng (Quản trị / Quản lý)</h3>
            </div>
            {monthlyFinanceChart.length === 0 ? (
              <div className="empty-state">Chưa có dữ liệu tài chính dự án</div>
            ) : (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={monthlyFinanceChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => `${Math.round(v / 1000000)}tr`} />
                    <Tooltip formatter={(val) => formatCurrency(val)} />
                    <Legend />
                    <Bar dataKey="doanhThu" name="Doanh thu HĐ" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="chiPhi" name="Tổng chi phí" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="loiNhuan" name="Lợi nhuận" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bảng cảnh báo */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header">
            <h3>⚠️ Cảnh báo vật tư dưới tồn tối thiểu ({stats.lowStockItems.length})</h3>
            <Link to="/vat-tu" className="btn-link">
              Xem tất cả →
            </Link>
          </div>
          {stats.lowStockItems.length === 0 ? (
            <div className="empty-state">Tất cả vật tư đều đảm bảo định mức tồn tối thiểu.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Tên vật tư</th>
                    <th>Loại</th>
                    <th className="text-right">Trong kho</th>
                    <th className="text-right">Tối thiểu</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.lowStockItems.slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <td>{item.code || `#${item.id}`}</td>
                      <td>
                        <Link to={`/vat-tu/${item.id}`} className="table-link">
                          {item.name}
                        </Link>
                      </td>
                      <td>
                        <KindBadge kind={item.kind} />
                      </td>
                      <td className="text-right text-red font-bold">
                        {formatNumber(item.in_stock)} {item.unit}
                      </td>
                      <td className="text-right">
                        {formatNumber(item.min_stock)} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>🚨 Dự án quá hạn thu hồi ({stats.overdueProjects.length})</h3>
            <Link to="/du-an" className="btn-link">
              Xem tất cả →
            </Link>
          </div>
          {stats.overdueProjects.length === 0 ? (
            <div className="empty-state">Không có dự án nào quá hạn thu hồi đồ tái sử dụng.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dự án</th>
                    <th>Trạng thái</th>
                    <th>Hạn tháo dỡ</th>
                    <th className="text-right">SL chưa thu</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.overdueProjects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/du-an/${p.id}`} className="table-link">
                          {p.name}
                        </Link>
                        {p.location && <div className="text-xs text-muted">{p.location}</div>}
                      </td>
                      <td>
                        <ProjectStatusBadge status={p.status} />
                      </td>
                      <td className="text-red font-bold">{formatDate(p.end_date)}</td>
                      <td className="text-right font-bold">{formatNumber(p.outstandingCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
