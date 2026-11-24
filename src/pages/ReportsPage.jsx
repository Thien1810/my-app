import { useEffect, useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { fetchAllRows } from '../lib/fetchAll'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  todayISO,
  KIND_LABELS,
  PROJECT_STATUS_LABELS,
} from '../lib/formatters'
import { calcProjectFinancialSummary } from '../lib/calc'
import { exportToExcel, exportAllRawData } from '../lib/exportExcel'
import { KindBadge, ProjectStatusBadge } from '../components/Badges'
import MetaAdsManagerTab from '../components/MetaAdsManagerTab'
import LeadSourceReport from '../components/LeadSourceReport'

// Cấu hình nhóm báo cáo: mỗi nhóm gồm nhiều phần (view); id view = giá trị activeTab / ?tab=
const REPORT_GROUPS = [
  {
    id: 'kho',
    label: '📦 Kho & Cảnh báo',
    views: [
      { id: 'stock', label: 'Tồn kho & Giá trị' },
      { id: 'where', label: 'Đồ đang ở đâu' },
      { id: 'forecast', label: 'Dự báo & Cảnh báo thiếu' },
    ],
  },
  {
    id: 'vattu',
    label: '🧰 Hiệu quả vật tư',
    views: [
      { id: 'most_used', label: 'Dùng nhiều nhất' },
      { id: 'damage', label: 'Hư hỏng / mất' },
      { id: 'payback', label: 'Hoàn vốn đồ tái sử dụng', managerOnly: true },
    ],
  },
  {
    id: 'taichinh',
    label: '💰 Tài chính',
    managerOnly: true,
    views: [
      { id: 'profit', label: 'Lãi gộp từng đám', managerOnly: true },
      { id: 'pnl', label: 'P&L ròng, chi phí cứng & Ads', managerOnly: true },
      { id: 'leadsource', label: 'Nguồn khách (Lead)', managerOnly: true },
    ],
  },
]

export default function ReportsPage() {
  const { role, isManagerOrAdmin } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(() =>
    REPORT_GROUPS.some((g) =>
      g.views.some((v) => v.id === requestedTab && (!v.managerOnly || isManagerOrAdmin)),
    )
      ? requestedTab
      : 'stock',
  )
  const visibleGroups = REPORT_GROUPS.map((g) => ({
    ...g,
    views: g.views.filter((v) => !v.managerOnly || isManagerOrAdmin),
  })).filter((g) => g.views.length > 0 && (!g.managerOnly || isManagerOrAdmin))
  const currentGroup = visibleGroups.find((g) => g.views.some((v) => v.id === activeTab))
  const [loading, setLoading] = useState(true)
  const [exportingRaw, setExportingRaw] = useState(false)
  const [error, setError] = useState('')
  const [dataIncomplete, setDataIncomplete] = useState(false)

  const [items, setItems] = useState([])
  const [projects, setProjects] = useState([])
  const [plans, setPlans] = useState([])
  const [movements, setMovements] = useState([])
  const [finances, setFinances] = useState([])
  const [costs, setCosts] = useState([])

  const loadAll = async () => {
    setLoading(true)
    setError('')
    setDataIncomplete(false)
    try {
      const [itemsRes, projRes, planRes, movesRes] = await Promise.all([
        supabase.from('item_stock').select('*').order('name'),
        supabase
          .from('projects')
          .select('*, customer:partners(name)')
          .order('start_date', { ascending: false }),
        // Phân trang vượt giới hạn 1000 dòng; order ổn định (có id/khóa chính) để không lặp/mất dòng.
        fetchAllRows((from, to) =>
          supabase
            .from('project_plan')
            .select('*')
            .order('project_id')
            .order('item_id')
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase
            .from('stock_movements')
            .select('*')
            .order('moved_at', { ascending: false })
            .order('id')
            .range(from, to)
        ),
      ])

      if (itemsRes.error) throw itemsRes.error
      if (projRes.error) throw projRes.error

      setItems(itemsRes.data || [])
      setProjects(projRes.data || [])
      setPlans(planRes.data || [])
      setMovements(movesRes.data || [])

      const partialErrors = []
      if (planRes.error) partialErrors.push(`kế hoạch vật tư (${planRes.error.message})`)
      if (movesRes.error) partialErrors.push(`phiếu kho (${movesRes.error.message})`)

      if (isManagerOrAdmin) {
        const [finRes, costRes] = await Promise.all([
          fetchAllRows((from, to) =>
            supabase.from('project_finance').select('*').order('project_id').range(from, to)
          ),
          fetchAllRows((from, to) =>
            supabase.from('project_costs').select('*').order('id').range(from, to)
          ),
        ])
        setFinances(finRes.data || [])
        setCosts(costRes.data || [])
        if (finRes.error) partialErrors.push(`tài chính dự án (${finRes.error.message})`)
        if (costRes.error) partialErrors.push(`chi phí dự án (${costRes.error.message})`)
      }
      if (partialErrors.length) {
        setDataIncomplete(true)
        setError(`Không tải đủ dữ liệu báo cáo: ${partialErrors.join('; ')}. Số liệu có thể thiếu.`)
      }
    } catch (err) {
      setError(err.message || 'Không thể tải dữ liệu báo cáo')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [isManagerOrAdmin])

  const itemMap = useMemo(() => {
    const map = new Map()
    for (const i of items) map.set(Number(i.id), i)
    return map
  }, [items])

  const projectMap = useMemo(() => {
    const map = new Map()
    for (const p of projects) map.set(Number(p.id), p)
    return map
  }, [projects])

  // 1. Đồ đang ở đâu (item × project outstanding)
  const whereIsItemsReport = useMemo(() => {
    const keyMap = new Map()
    for (const m of movements) {
      if (!m.project_id) continue
      const item = itemMap.get(Number(m.item_id))
      if (!item || item.kind !== 'reusable') continue
      const key = `${m.item_id}_${m.project_id}`
      if (!keyMap.has(key)) {
        keyMap.set(key, {
          item,
          project: projectMap.get(Number(m.project_id)),
          project_id: m.project_id,
          issued: 0,
          returnedGood: 0,
          returnedDamaged: 0,
          returnedLost: 0,
        })
      }
      const row = keyMap.get(key)
      const qty = Number(m.qty || 0)
      if (m.type === 'issue') row.issued += qty
      else if (m.type === 'return_good') row.returnedGood += qty
      else if (m.type === 'return_damaged') row.returnedDamaged += qty
      else if (m.type === 'return_lost') row.returnedLost += qty
    }

    const list = []
    const today = todayISO()
    for (const row of keyMap.values()) {
      const outstanding =
        row.issued - row.returnedGood - row.returnedDamaged - row.returnedLost
      if (outstanding > 0) {
        const isOverdue =
          row.project?.end_date &&
          row.project.end_date < today &&
          ['in_progress', 'awaiting_return'].includes(row.project.status)
        list.push({
          ...row,
          outstanding,
          isOverdue,
        })
      }
    }
    return list
  }, [movements, itemMap, projectMap])

  // 2. Tỷ lệ hư hỏng / mất theo vật tư & 3. Vật tư dùng nhiều nhất
  const itemUsageAndDamageReport = useMemo(() => {
    const statsMap = new Map()
    for (const i of items) {
      statsMap.set(Number(i.id), {
        item: i,
        issued: 0,
        returnedGood: 0,
        damaged: 0,
        lost: 0,
        projectIds: new Set(),
      })
    }

    for (const m of movements) {
      const row = statsMap.get(Number(m.item_id))
      if (!row) continue
      const qty = Number(m.qty || 0)
      if (m.type === 'issue') {
        row.issued += qty
        if (m.project_id) row.projectIds.add(m.project_id)
      } else if (m.type === 'return_good') {
        row.returnedGood += qty
      } else if (m.type === 'return_damaged') {
        row.damaged += qty
      } else if (m.type === 'return_lost') {
        row.lost += qty
      }
    }

    return Array.from(statsMap.values()).map((r) => {
      const totalBad = r.damaged + r.lost
      const badRate = r.issued > 0 ? (totalBad / r.issued) * 100 : 0
      const badValue = totalBad * Number(r.item.cost || 0)
      return {
        ...r,
        projectCount: r.projectIds.size,
        totalBad,
        badRate,
        badValue,
      }
    })
  }, [items, movements])

  const damageSorted = useMemo(() => {
    return [...itemUsageAndDamageReport]
      .filter((r) => r.issued > 0 || r.totalBad > 0)
      .sort((a, b) => b.badRate - a.badRate || b.totalBad - a.totalBad)
  }, [itemUsageAndDamageReport])

  const mostUsedSorted = useMemo(() => {
    return [...itemUsageAndDamageReport]
      .filter((r) => r.issued > 0)
      .sort((a, b) => b.issued - a.issued)
  }, [itemUsageAndDamageReport])

  // 4. Lãi / lỗ theo dự án (Admin/Manager)
  const projectProfitReport = useMemo(() => {
    if (!isManagerOrAdmin) return []
    const finMap = new Map()
    for (const f of finances) finMap.set(Number(f.project_id), Number(f.contract_value || 0))

    return projects.map((p) => {
      const projMoves = movements.filter((m) => m.project_id === p.id)
      const projCosts = costs.filter((c) => c.project_id === p.id)
      // Dự án đã hủy không có doanh thu: lợi nhuận = -chi phí đã phát sinh.
      const contractValue = p.status === 'cancelled' ? 0 : finMap.get(p.id) || 0

      const summary = calcProjectFinancialSummary({
        movements: projMoves,
        itemStockMap: itemMap,
        otherCosts: projCosts,
        contractValue,
      })

      const margin =
        summary.contractValue > 0
          ? (summary.profit / summary.contractValue) * 100
          : 0

      return {
        project: p,
        ...summary,
        margin,
      }
    })
  }, [isManagerOrAdmin, projects, finances, costs, movements, itemMap])

  // 5. Hoàn vốn đồ tái sử dụng
  const reusablePaybackReport = useMemo(() => {
    return itemUsageAndDamageReport
      .filter((r) => r.item.kind === 'reusable')
      .map((r) => {
        const i = r.item
        const cost = Number(i.cost || 0)
        const expectedUses = Number(i.expected_uses || 0)
        const ownedQty =
          Math.max(0, Number(i.in_stock || 0)) +
          Math.max(0, Number(i.at_project || 0)) +
          Math.max(0, Number(i.in_repair || 0))
        const capitalInvested = cost * ownedQty
        const depreciationCharged =
          expectedUses > 0 ? (r.issued * cost) / expectedUses : 0
        const paybackPct =
          capitalInvested > 0
            ? (depreciationCharged / capitalInvested) * 100
            : 0

        return {
          item: i,
          ownedQty,
          cost,
          expectedUses,
          issuedTotal: r.issued,
          projectCount: r.projectCount,
          capitalInvested,
          depreciationCharged,
          paybackPct,
        }
      })
      .sort((a, b) => b.paybackPct - a.paybackPct)
  }, [itemUsageAndDamageReport])

  // 6. Dự báo (Forecast):
  // - Tiêu thụ trung bình/ngày của vật tư tiêu hao trong 90 ngày qua -> số ngày đến khi hết tồn + SL gợi ý đặt mua cho 30 ngày tới
  // - Vật tư thiếu cho các dự án sắp tới (30 ngày tới) dựa trên project_plan
  const forecastReport = useMemo(() => {
    const now = new Date()
    const d90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const today = todayISO()
    const d30Ahead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    // Tính tiêu thụ ròng 90 ngày qua cho từng vật tư tiêu hao
    const consumed90Map = new Map()
    for (const m of movements) {
      if (!m.moved_at || m.moved_at < d90Ago) continue
      const item = itemMap.get(Number(m.item_id))
      if (!item || item.kind !== 'consumable') continue
      const cur = consumed90Map.get(item.id) || 0
      const qty = Number(m.qty || 0)
      if (m.type === 'issue') consumed90Map.set(item.id, cur + qty)
      else if (m.type === 'return_good') consumed90Map.set(item.id, cur - qty)
    }

    const consumableForecast = items
      .filter((i) => i.active && i.kind === 'consumable')
      .map((i) => {
        const netConsumed90 = Math.max(0, consumed90Map.get(i.id) || 0)
        const avgDaily = netConsumed90 / 90
        const inStock = Math.max(0, Number(i.in_stock || 0))
        const daysUntilOut =
          avgDaily > 0 ? Math.floor(inStock / avgDaily) : null
        const need30Days = avgDaily * 30
        const minStock = Number(i.min_stock || 0)
        const suggestedReorder = Math.max(
          0,
          Math.ceil(need30Days + minStock - inStock)
        )

        return {
          item: i,
          inStock,
          netConsumed90,
          avgDaily,
          daysUntilOut,
          need30Days,
          suggestedReorder,
        }
      })
      .sort((a, b) => b.suggestedReorder - a.suggestedReorder)

    // Các dự án trong 30 ngày tới (chưa done/cancelled)
    const upcomingProjects = projects.filter((p) => {
      if (p.status === 'done' || p.status === 'cancelled') return false
      const s = p.start_date || p.end_date
      const e = p.end_date || p.start_date
      if (!s) return true
      return s <= d30Ahead && (e || s) >= today
    })
    const upcomingProjectIds = new Set(upcomingProjects.map((p) => p.id))

    const plannedUpcomingByItem = new Map()
    for (const pl of plans) {
      if (!upcomingProjectIds.has(pl.project_id)) continue
      const itemId = Number(pl.item_id)
      const cur = plannedUpcomingByItem.get(itemId) || { qty: 0, projectNames: [] }
      cur.qty += Number(pl.qty || 0)
      const proj = projectMap.get(Number(pl.project_id))
      if (proj) cur.projectNames.push(proj.name)
      plannedUpcomingByItem.set(itemId, cur)
    }

    const upcomingShortages = []
    for (const [itemId, info] of plannedUpcomingByItem.entries()) {
      const item = itemMap.get(itemId)
      if (!item) continue
      const available =
        item.kind === 'reusable'
          ? Math.max(0, Number(item.in_stock || 0)) + Math.max(0, Number(item.at_project || 0))
          : Math.max(0, Number(item.in_stock || 0))
      const shortage = Math.max(0, info.qty - available)
      upcomingShortages.push({
        item,
        plannedQty: info.qty,
        available,
        shortage,
        projectNames: Array.from(new Set(info.projectNames)),
      })
    }
    upcomingShortages.sort((a, b) => b.shortage - a.shortage)

    return {
      consumableForecast,
      upcomingShortages,
    }
  }, [items, movements, projects, plans, itemMap, projectMap])

  const handleExportCurrentTab = () => {
    if (activeTab === 'stock') {
      const rows = items.map((i) => ({
        'Mã': i.code || '',
        'Tên vật tư': i.name,
        'Danh mục': i.category || '',
        'Loại': KIND_LABELS[i.kind],
        'ĐVT': i.unit,
        'Giá nhập (₫)': Number(i.cost || 0),
        'Trong kho': Number(i.in_stock || 0),
        'Giá trị trong kho (₫)': Math.max(0, Number(i.in_stock || 0)) * Number(i.cost || 0),
        'Đang ở dự án': Number(i.at_project || 0),
        'Chờ sửa': Number(i.in_repair || 0),
        'Tổng mất': Number(i.lost_total || 0),
      }))
      exportToExcel(rows, 'BaoCaoTonKho', 'bao-cao-ton-kho.xlsx')
    } else if (activeTab === 'where') {
      const rows = whereIsItemsReport.map((r) => ({
        'Mã vật tư': r.item.code || '',
        'Tên vật tư': r.item.name,
        'Dự án đang giữ': r.project?.name || `#${r.project_id}`,
        'Trạng thái dự án': PROJECT_STATUS_LABELS[r.project?.status] || '',
        'Ngày tháo dỡ': formatDate(r.project?.end_date),
        'SL đang giữ': r.outstanding,
        'ĐVT': r.item.unit,
        'Quá hạn': r.isOverdue ? 'Quá hạn' : 'Bình thường',
      }))
      exportToExcel(rows, 'DoDangODau', 'bao-cao-do-dang-o-dau.xlsx')
    } else if (activeTab === 'damage') {
      const rows = damageSorted.map((r) => ({
        'Mã vật tư': r.item.code || '',
        'Tên vật tư': r.item.name,
        'Loại': KIND_LABELS[r.item.kind],
        'Tổng xuất': r.issued,
        'Thu hồi hỏng': r.damaged,
        'Báo mất': r.lost,
        'Tỷ lệ hỏng + mất (%)': Number(r.badRate.toFixed(2)),
        'Giá trị thiệt hại (₫)': Math.round(r.badValue),
      }))
      exportToExcel(rows, 'TyLeHuHongMat', 'bao-cao-hu-hong-mat.xlsx')
    } else if (activeTab === 'profit' && isManagerOrAdmin) {
      const rows = projectProfitReport.map((r) => ({
        'Mã dự án': r.project.code || `#${r.project.id}`,
        'Tên dự án': r.project.status === 'cancelled' ? `${r.project.name} (Đã hủy)` : r.project.name,
        'Khách hàng': r.project.customer?.name || '',
        'Trạng thái': PROJECT_STATUS_LABELS[r.project.status],
        'Giá trị HĐ (₫)': Math.round(r.contractValue),
        'Chi phí tiêu hao (₫)': Math.round(r.consumableCost),
        'Khấu hao tái sử dụng (₫)': Math.round(r.depreciationCost),
        'Hỏng & Mất (₫)': Math.round(r.damagedLostCost),
        'Chi phí khác (₫)': Math.round(r.otherCostTotal),
        'Tổng chi phí (₫)': Math.round(r.totalCost),
        'Lợi nhuận (₫)': Math.round(r.profit),
        'Tỷ suất LN (%)': Number(r.margin.toFixed(1)),
      }))
      exportToExcel(rows, 'LaiLoDuAn', 'bao-cao-lai-lo-du-an.xlsx')
    } else if (activeTab === 'most_used') {
      const rows = mostUsedSorted.map((r) => ({
        'Mã vật tư': r.item.code || '',
        'Tên vật tư': r.item.name,
        'Loại': KIND_LABELS[r.item.kind],
        'ĐVT': r.item.unit,
        'Số dự án sử dụng': r.projectCount,
        'Tổng SL đã xuất': r.issued,
      }))
      exportToExcel(rows, 'VatTuDungNhieu', 'bao-cao-vat-tu-dung-nhieu.xlsx')
    } else if (activeTab === 'payback') {
      const rows = reusablePaybackReport.map((r) => ({
        'Mã vật tư': r.item.code || '',
        'Tên vật tư': r.item.name,
        'SL sở hữu': r.ownedQty,
        'Đơn giá vốn (₫)': r.cost,
        'Tổng vốn đầu tư (₫)': Math.round(r.capitalInvested),
        'Số lần dùng dự kiến': r.expectedUses || 'Chưa đặt',
        'Tổng lượt đã xuất': r.issuedTotal,
        'Tổng khấu hao đã thu (₫)': Math.round(r.depreciationCharged),
        'Tỷ lệ hoàn vốn (%)': Number(r.paybackPct.toFixed(1)),
      }))
      exportToExcel(rows, 'HoanVonTaiSuDung', 'bao-cao-hoan-von-do-tai-su-dung.xlsx')
    } else if (activeTab === 'forecast') {
      const rows = forecastReport.consumableForecast.map((r) => ({
        'Mã vật tư': r.item.code || '',
        'Tên vật tư': r.item.name,
        'Tồn hiện tại': r.inStock,
        'Tiêu thụ 90 ngày qua': r.netConsumed90,
        'TB tiêu thụ / ngày': Number(r.avgDaily.toFixed(2)),
        'Số ngày dự kiến hết tồn': r.daysUntilOut != null ? r.daysUntilOut : 'Không tiêu thụ',
        'Nhu cầu 30 ngày tới': Number(r.need30Days.toFixed(1)),
        'Gợi ý nhập thêm (30 ngày)': r.suggestedReorder,
      }))
      exportToExcel(rows, 'DuBaoNhapHang', 'bao-cao-du-bao-nhap-hang.xlsx')
    }
  }

  const handleExportAllRaw = async () => {
    setExportingRaw(true)
    setError('')
    try {
      await exportAllRawData(supabase, role)
    } catch (err) {
      setError(err.message || 'Lỗi khi xuất toàn bộ dữ liệu thô')
    } finally {
      setExportingRaw(false)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Báo cáo Thống kê & Dự báo</h1>
          <p className="text-muted">
            Phân tích chuyên sâu tồn kho, định vị tài sản, hao hụt, hoàn vốn và dự báo nhập hàng
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={handleExportCurrentTab}>
            📥 Xuất báo cáo đang xem
          </button>
          <button
            className="btn btn-primary"
            onClick={handleExportAllRaw}
            disabled={exportingRaw}
          >
            {exportingRaw ? 'Đang đóng gói...' : '📦 Xuất toàn bộ dữ liệu thô (.xlsx)'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Thanh tab nhóm báo cáo */}
      <div className="tabs-bar" style={{ marginBottom: currentGroup?.views.length > 1 ? 10 : 20 }}>
        {visibleGroups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`tab-btn ${currentGroup?.id === g.id ? 'active' : ''}`}
            onClick={() => {
              if (currentGroup?.id !== g.id) setActiveTab(g.views[0].id)
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Thanh chuyển phần trong nhóm */}
      {currentGroup && currentGroup.views.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {currentGroup.views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`btn btn-sm ${activeTab === v.id ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveTab(v.id)}
            >
              {v.label}
              {v.id === 'where' ? ` (${whereIsItemsReport.length})` : ''}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="loading-state">Đang tổng hợp dữ liệu báo cáo...</div>
      ) : (
        <>
          {/* 1. BÁO CÁO TỒN KHO */}
          {activeTab === 'stock' && (
            <div className="card">
              <div className="card-header">
                <h3>📦 Báo cáo Tồn kho & Giá trị Tài sản</h3>
              </div>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên vật tư</th>
                      <th>Loại</th>
                      <th className="text-right">Đơn giá</th>
                      <th className="text-right">Trong kho</th>
                      <th className="text-right">Ở dự án</th>
                      <th className="text-right">Chờ sửa</th>
                      <th className="text-right">Tổng mất</th>
                      <th className="text-right">Giá trị trong kho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.code || `#${i.id}`}</td>
                        <td>
                          <Link to={`/vat-tu/${i.id}`} className="table-link font-bold">
                            {i.name}
                          </Link>
                        </td>
                        <td>
                          <KindBadge kind={i.kind} />
                        </td>
                        <td className="text-right">{formatCurrency(i.cost)}</td>
                        <td className="text-right font-bold text-green">
                          {formatNumber(i.in_stock)} {i.unit}
                        </td>
                        <td className="text-right text-blue">
                          {i.kind === 'reusable' ? formatNumber(i.at_project) : '—'}
                        </td>
                        <td className="text-right text-amber">{formatNumber(i.in_repair)}</td>
                        <td className="text-right text-red">{formatNumber(i.lost_total)}</td>
                        <td className="text-right font-bold">
                          {formatCurrency(
                            Math.max(0, Number(i.in_stock || 0)) * Number(i.cost || 0)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 2. ĐỒ ĐANG Ở ĐÂU */}
          {activeTab === 'where' && (
            <div className="card">
              <div className="card-header">
                <h3>📍 Định vị Đồ tái sử dụng đang nằm ở Dự án nào</h3>
              </div>
              {whereIsItemsReport.length === 0 ? (
                <div className="empty-state">
                  Tất cả đồ tái sử dụng đã được thu hồi về kho, không có đồ tồn đọng tại dự án.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Vật tư</th>
                        <th>Dự án đang giữ</th>
                        <th>Trạng thái dự án</th>
                        <th>Hạn tháo dỡ</th>
                        <th className="text-right">Đã xuất</th>
                        <th className="text-right">Đã thu hồi</th>
                        <th className="text-right">Còn đang giữ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whereIsItemsReport.map((r, idx) => (
                        <tr key={idx} className={r.isOverdue ? 'row-conflict-shortage' : ''}>
                          <td>
                            <Link to={`/vat-tu/${r.item.id}`} className="table-link font-bold">
                              {r.item.name}
                            </Link>
                            <div className="text-xs text-muted">{r.item.code}</div>
                          </td>
                          <td>
                            <Link to={`/du-an/${r.project_id}`} className="table-link font-bold">
                              {r.project?.name || `Dự án #${r.project_id}`}
                            </Link>
                          </td>
                          <td>
                            {r.project?.status && (
                              <ProjectStatusBadge status={r.project.status} />
                            )}
                          </td>
                          <td className={r.isOverdue ? 'text-red font-bold' : ''}>
                            {formatDate(r.project?.end_date)}
                            {r.isOverdue && (
                              <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                                Quá hạn
                              </span>
                            )}
                          </td>
                          <td className="text-right">{formatNumber(r.issued)}</td>
                          <td className="text-right">
                            {formatNumber(
                              r.returnedGood + r.returnedDamaged + r.returnedLost
                            )}
                          </td>
                          <td className="text-right font-bold text-blue">
                            {formatNumber(r.outstanding)} {r.item.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 3. TỶ LỆ HƯ HỎNG / MẤT */}
          {activeTab === 'damage' && (
            <div className="card">
              <div className="card-header">
                <h3>💔 Báo cáo Tỷ lệ Hư hỏng & Mất mát theo Vật tư</h3>
              </div>
              {damageSorted.length === 0 ? (
                <div className="empty-state">Chưa có dữ liệu xuất và hư hỏng vật tư.</div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Vật tư</th>
                        <th>Loại</th>
                        <th className="text-right">Tổng SL xuất</th>
                        <th className="text-right">SL Hỏng</th>
                        <th className="text-right">SL Mất</th>
                        <th className="text-right">Tỷ lệ Hỏng + Mất</th>
                        <th className="text-right">Giá trị thiệt hại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {damageSorted.map((r) => (
                        <tr key={r.item.id}>
                          <td>
                            <Link to={`/vat-tu/${r.item.id}`} className="table-link font-bold">
                              {r.item.name}
                            </Link>
                          </td>
                          <td>
                            <KindBadge kind={r.item.kind} />
                          </td>
                          <td className="text-right">{formatNumber(r.issued)}</td>
                          <td className="text-right text-amber">{formatNumber(r.damaged)}</td>
                          <td className="text-right text-red">{formatNumber(r.lost)}</td>
                          <td className="text-right font-bold">
                            <span className={r.badRate > 10 ? 'text-red' : ''}>
                              {r.badRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="text-right text-red font-bold">
                            {formatCurrency(r.badValue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 4. LÃI / LỖ THEO DỰ ÁN */}
          {activeTab === 'profit' && isManagerOrAdmin && (
            <div className="card">
              <div className="card-header">
                <h3>💰 Báo cáo Lãi / Lỗ theo Dự án (Quản trị / Quản lý)</h3>
              </div>
              {projectProfitReport.length === 0 ? (
                <div className="empty-state">Chưa có dự án nào.</div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Dự án</th>
                        <th>Trạng thái</th>
                        <th className="text-right">Giá trị HĐ</th>
                        <th className="text-right">Tiêu hao</th>
                        <th className="text-right">Khấu hao</th>
                        <th className="text-right">Hỏng & Mất</th>
                        <th className="text-right">Chi phí khác</th>
                        <th className="text-right">Lợi nhuận</th>
                        <th className="text-right">Tỷ suất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectProfitReport.map((r) => (
                        <tr key={r.project.id}>
                          <td>
                            <Link
                              to={`/du-an/${r.project.id}`}
                              className="table-link font-bold"
                            >
                              {r.project.name}
                            </Link>
                            {r.project.status === 'cancelled' && (
                              <span className="text-xs text-muted" style={{ marginLeft: 6 }}>
                                (Đã hủy)
                              </span>
                            )}
                            <div className="text-xs text-muted">
                              {r.project.customer?.name || ''}
                            </div>
                          </td>
                          <td>
                            <ProjectStatusBadge status={r.project.status} />
                          </td>
                          <td className="text-right font-bold">
                            {formatCurrency(r.contractValue)}
                          </td>
                          <td className="text-right">{formatCurrency(r.consumableCost)}</td>
                          <td className="text-right">{formatCurrency(r.depreciationCost)}</td>
                          <td className="text-right text-red">
                            {formatCurrency(r.damagedLostCost)}
                          </td>
                          <td className="text-right">
                            <div>{formatCurrency(r.otherCostTotal)}</div>
                          </td>
                          <td
                            className={`text-right font-bold ${
                              r.profit >= 0 ? 'text-green' : 'text-red'
                            }`}
                          >
                            {formatCurrency(r.profit)}
                          </td>
                          <td className="text-right">{r.margin.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 4B. BÁO CÁO P&L RÒNG, CHI PHÍ CỨNG & ADS (Admin/Manager) */}
          {activeTab === 'pnl' && isManagerOrAdmin && (
            <MetaAdsManagerTab projectProfitReport={projectProfitReport} dataIncomplete={dataIncomplete} />
          )}

          {/* 4C. BÁO CÁO NGUỒN KHÁCH (Admin/Manager) */}
          {activeTab === 'leadsource' && isManagerOrAdmin && <LeadSourceReport />}

          {/* 5. VẬT TƯ DÙNG NHIỀU NHẤT */}
          {activeTab === 'most_used' && (
            <div className="card">
              <div className="card-header">
                <h3>🏆 Bảng xếp hạng Vật tư được sử dụng nhiều nhất</h3>
              </div>
              {mostUsedSorted.length === 0 ? (
                <div className="empty-state">Chưa có lượt xuất kho dự án nào.</div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Hạng</th>
                        <th>Vật tư</th>
                        <th>Loại</th>
                        <th className="text-right">Số dự án tham gia</th>
                        <th className="text-right">Tổng SL đã xuất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mostUsedSorted.map((r, idx) => (
                        <tr key={r.item.id}>
                          <td className="font-bold">#{idx + 1}</td>
                          <td>
                            <Link to={`/vat-tu/${r.item.id}`} className="table-link font-bold">
                              {r.item.name}
                            </Link>
                          </td>
                          <td>
                            <KindBadge kind={r.item.kind} />
                          </td>
                          <td className="text-right">{formatNumber(r.projectCount)} dự án</td>
                          <td className="text-right font-bold text-green">
                            {formatNumber(r.issued)} {r.item.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 6. HOÀN VỐN ĐỒ TÁI SỬ DỤNG */}
          {activeTab === 'payback' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h3>🔄 Phân tích Hoàn vốn Đồ Tái Sử Dụng</h3>
                  <p className="text-xs text-muted">
                    Tỷ lệ hoàn vốn (%) = Tổng khấu hao đã tính qua các dự án ÷ (Đơn giá vốn × SL
                    sở hữu)
                  </p>
                </div>
              </div>
              {reusablePaybackReport.length === 0 ? (
                <div className="empty-state">Chưa có vật tư tái sử dụng nào.</div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Vật tư tái sử dụng</th>
                        <th className="text-right">SL sở hữu</th>
                        <th className="text-right">Tổng vốn đầu tư</th>
                        <th className="text-right">Lần dùng dự kiến</th>
                        <th className="text-right">Tổng lượt xuất</th>
                        <th className="text-right">Khấu hao đã thu</th>
                        <th>Tiến độ hoàn vốn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reusablePaybackReport.map((r) => (
                        <tr key={r.item.id}>
                          <td>
                            <Link to={`/vat-tu/${r.item.id}`} className="table-link font-bold">
                              {r.item.name}
                            </Link>
                          </td>
                          <td className="text-right">
                            {formatNumber(r.ownedQty)} {r.item.unit}
                          </td>
                          <td className="text-right">{formatCurrency(r.capitalInvested)}</td>
                          <td className="text-right">
                            {r.expectedUses || (
                              <span className="text-amber text-xs">Chưa đặt</span>
                            )}
                          </td>
                          <td className="text-right font-bold">{formatNumber(r.issuedTotal)}</td>
                          <td className="text-right text-green font-bold">
                            {formatCurrency(r.depreciationCharged)}
                          </td>
                          <td style={{ minWidth: 160 }}>
                            <div className="progress-cell">
                              <div className="progress-bar-bg">
                                <div
                                  className="progress-bar-fill"
                                  style={{
                                    width: `${Math.min(100, r.paybackPct)}%`,
                                  }}
                                />
                              </div>
                              <span className="font-bold text-xs">
                                {r.paybackPct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 7. DỰ BÁO & CẢNH BÁO THIẾU */}
          {activeTab === 'forecast' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Bảng A: Thiếu vật tư cho các dự án trong 30 ngày tới */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3>🚨 Vật tư dự kiến thiếu cho các dự án sắp tới (30 ngày tới)</h3>
                    <p className="text-xs text-muted">
                      Tổng hợp từ Kế hoạch vật tư (project_plan) của các dự án sắp diễn ra trong
                      30 ngày tới so với lượng tồn khả dụng
                    </p>
                  </div>
                </div>
                {forecastReport.upcomingShortages.length === 0 ? (
                  <div className="empty-state">
                    Chưa có kế hoạch vật tư nào cho các dự án trong 30 ngày tới.
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Vật tư</th>
                          <th>Loại</th>
                          <th className="text-right">Tổng cần theo kế hoạch</th>
                          <th className="text-right">Khả dụng hiện tại</th>
                          <th className="text-right">Số lượng thiếu</th>
                          <th>Các dự án cần dùng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecastReport.upcomingShortages.map((s) => (
                          <tr
                            key={s.item.id}
                            className={s.shortage > 0 ? 'row-conflict-shortage' : ''}
                          >
                            <td>
                              <Link
                                to={`/vat-tu/${s.item.id}`}
                                className="table-link font-bold"
                              >
                                {s.item.name}
                              </Link>
                            </td>
                            <td>
                              <KindBadge kind={s.item.kind} />
                            </td>
                            <td className="text-right font-bold">
                              {formatNumber(s.plannedQty)} {s.item.unit}
                            </td>
                            <td className="text-right">
                              {formatNumber(s.available)} {s.item.unit}
                            </td>
                            <td className="text-right font-bold">
                              {s.shortage > 0 ? (
                                <span className="text-red">
                                  Thiếu {formatNumber(s.shortage)} {s.item.unit}
                                </span>
                              ) : (
                                <span className="text-green">Đủ</span>
                              )}
                            </td>
                            <td className="text-xs">{s.projectNames.join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Bảng B: Dự báo tiêu hao 90 ngày qua -> số ngày hết hàng & gợi ý nhập cho 30 ngày tới */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3>🔮 Dự báo Tiêu hao & Gợi ý Nhập hàng (30 ngày tới)</h3>
                    <p className="text-xs text-muted">
                      Dựa trên tốc độ tiêu thụ trung bình mỗi ngày trong 90 ngày gần nhất để tính
                      số ngày còn lại đến khi hết kho và lượng đặt mua đề xuất cho 30 ngày tiếp
                      theo (cộng định mức tồn tối thiểu)
                    </p>
                  </div>
                </div>
                {forecastReport.consumableForecast.length === 0 ? (
                  <div className="empty-state">Chưa có vật tư tiêu hao nào.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Vật tư tiêu hao</th>
                          <th className="text-right">Tồn kho hiện tại</th>
                          <th className="text-right">Tiêu thụ 90 ngày qua</th>
                          <th className="text-right">TB / ngày</th>
                          <th className="text-right">Số ngày đến khi hết</th>
                          <th className="text-right">Gợi ý nhập thêm (30 ngày)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecastReport.consumableForecast.map((r) => (
                          <tr key={r.item.id}>
                            <td>
                              <Link
                                to={`/vat-tu/${r.item.id}`}
                                className="table-link font-bold"
                              >
                                {r.item.name}
                              </Link>
                            </td>
                            <td className="text-right font-bold">
                              {formatNumber(r.inStock)} {r.item.unit}
                            </td>
                            <td className="text-right">
                              {formatNumber(r.netConsumed90)} {r.item.unit}
                            </td>
                            <td className="text-right">
                              {formatNumber(r.avgDaily)} {r.item.unit}/ngày
                            </td>
                            <td className="text-right">
                              {r.daysUntilOut == null ? (
                                <span className="text-xs text-muted">Chưa phát sinh</span>
                              ) : r.daysUntilOut <= 14 ? (
                                <span className="text-red font-bold">
                                  ~{r.daysUntilOut} ngày
                                </span>
                              ) : (
                                <span>~{r.daysUntilOut} ngày</span>
                              )}
                            </td>
                            <td className="text-right font-bold">
                              {r.suggestedReorder > 0 ? (
                                <span className="text-amber">
                                  + {formatNumber(r.suggestedReorder)} {r.item.unit}
                                </span>
                              ) : (
                                <span className="text-green">Đủ dùng</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
