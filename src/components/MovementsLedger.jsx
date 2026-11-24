import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency, formatNumber, formatDate, MOVEMENT_TYPE_LABELS } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { MovementTypeBadge } from './Badges'
import {
  LEDGER_TYPE_CHIPS,
  toLedgerRows,
  groupLedgerRows,
  filterLedgerRows,
  defaultFromDate,
  vnTodayISO,
} from '../lib/ledgerRows'
import './MovementsLedger.css'

const PAGE_SIZE = 200
const DEFAULT_DAYS = 30

function TypeBadge({ row }) {
  if (row.kind === 'transfer') {
    return <span className="badge ml-badge-transfer">Chuyển kho</span>
  }
  return <MovementTypeBadge type={row.type} />
}

function ItemCell({ row }) {
  const label = row.itemName
    ? `${row.itemCode ? `[${row.itemCode}] ` : ''}${row.itemName}`
    : `#${row.itemId}`
  if (row.itemId != null && row.itemName) {
    return (
      <Link to={`/vat-tu/${row.itemId}`} className="table-link font-bold">
        {label}
      </Link>
    )
  }
  return <span>{label}</span>
}

function WhoCell({ row }) {
  if (row.kind === 'transfer') return <span>🏬 {row.warehouseText}</span>
  if (row.projectName) {
    return row.projectId != null ? (
      <Link to={`/du-an/${row.projectId}`} className="table-link">
        🎪 {row.projectName}
      </Link>
    ) : (
      <span>🎪 {row.projectName}</span>
    )
  }
  if (row.partnerName) return <span>🤝 {row.partnerName}</span>
  return <span>—</span>
}

function GroupHeader({ g, open, onToggle }) {
  const typeBadge =
    g.rowKind === 'transfer' ? (
      <span className="badge ml-badge-transfer">Chuyển kho</span>
    ) : (
      <MovementTypeBadge type={g.type} />
    )
  return (
    <button type="button" className="ml-group-head" onClick={onToggle} aria-expanded={open}>
      <span className="ml-group-caret" aria-hidden="true">
        {open ? '▾' : '▸'}
      </span>
      <span className="ml-code">{g.code}</span>
      <span className="text-muted">{formatDate(g.date)}</span>
      {typeBadge}
      <span>{formatNumber(g.count)} dòng</span>
      {g.total != null && <strong>{formatCurrency(g.total)}</strong>}
    </button>
  )
}

export default function MovementsLedger({
  movements,
  transfers = [],
  warehouses = [],
  projects = [],
  loading,
  isAdmin,
  onDelete,
  highlightIds = [],
  notice = null,
  itemsById = {},
  searchRequest = null, // { id, search }: đổi id thì đặt ô tìm = search, về bộ lọc mặc định và cuộn tới sổ
}) {
  const today = vnTodayISO()
  const defaultFrom = defaultFromDate(today, DEFAULT_DAYS)

  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState('')
  const [itemKind, setItemKind] = useState('all')
  const [projectId, setProjectId] = useState('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  // Trạng thái mở/thu nhóm do người dùng bấm: { [mã phiếu]: true|false }
  const [groupOpen, setGroupOpen] = useState({})
  const rootRef = useRef(null)

  const requestId = searchRequest?.id
  const requestSearch = searchRequest?.search
  useEffect(() => {
    if (requestId == null) return undefined
    setSearch(requestSearch || '')
    setType('all')
    setFrom(defaultFrom)
    setTo('')
    setItemKind('all')
    setProjectId('all')
    setLimit(PAGE_SIZE)
    const t = setTimeout(() => {
      rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  // Mọi thay đổi bộ lọc đều đưa danh sách về 200 dòng đầu.
  const change = (setter) => (value) => {
    setter(value)
    setLimit(PAGE_SIZE)
  }
  const changeSearch = change(setSearch)
  const changeType = change(setType)
  const changeFrom = change(setFrom)
  const changeTo = change(setTo)
  const changeKind = change(setItemKind)
  const changeProject = change(setProjectId)

  const allRows = useMemo(
    () => toLedgerRows({ movements: movements || [], transfers, itemsById, warehouses }),
    [movements, transfers, itemsById, warehouses]
  )

  const movementById = useMemo(() => {
    const map = new Map()
    for (const m of movements || []) map.set(m.id, m)
    return map
  }, [movements])

  const filtered = useMemo(
    () => filterLedgerRows(allRows, { from, to, type, itemKind, projectId, search }),
    [allRows, from, to, type, itemKind, projectId, search]
  )

  const visible = filtered.slice(0, limit)
  const entries = groupLedgerRows(visible)
  const highlightSet = useMemo(() => new Set((highlightIds || []).map(String)), [highlightIds])
  const isNew = (row) => row.kind === 'movement' && highlightSet.has(String(row.id))
  // Mặc định thu gọn; tự mở khi nhóm có dòng vừa tạo hoặc đang tìm kiếm.
  const isOpen = (g) => {
    if (groupOpen[g.code] != null) return groupOpen[g.code]
    return g.rows.some(isNew) || !!search.trim()
  }
  const toggleGroup = (g) => setGroupOpen((p) => ({ ...p, [g.code]: !isOpen(g) }))

  const isDefaultView =
    !search &&
    type === 'all' &&
    from === defaultFrom &&
    !to &&
    itemKind === 'all' &&
    projectId === 'all'

  const resetFilters = () => {
    setSearch('')
    setType('all')
    setFrom(defaultFrom)
    setTo('')
    setItemKind('all')
    setProjectId('all')
    setLimit(PAGE_SIZE)
  }

  const showingDefaultRange = from === defaultFrom && !to

  const handleExport = () => {
    const data = filtered.map((r) => ({
      'Mã phiếu': r.receiptCode || '',
      'ID dòng': r.kind === 'transfer' ? `CK-${r.id}` : r.id,
      'Ngày': formatDate(r.date),
      'Loại phiếu': r.kind === 'transfer' ? 'Chuyển kho' : MOVEMENT_TYPE_LABELS[r.type] || r.type,
      'Mã vật tư': r.itemCode,
      'Tên vật tư': r.itemName,
      'ĐVT': r.unit,
      'Số lượng': r.qty,
      'Đơn giá nhập (₫)': r.unitCost != null ? r.unitCost : '',
      'Dự án': r.projectName,
      'Nhà cung cấp': r.partnerName,
      'Kho': r.warehouseText,
      'Ghi chú': r.note,
    }))
    exportToExcel(data, 'SoKho', 'so-kho-phieu-xuat-nhap.xlsx')
  }

  const deleteButton = (row, className = 'btn btn-sm btn-outline') => {
    if (!isAdmin || row.kind !== 'movement') return null
    const original = movementById.get(row.id)
    if (!original) return null
    return (
      <button type="button" className={className} onClick={() => onDelete?.(original)}>
        Xóa
      </button>
    )
  }

  const colCount = isAdmin ? 9 : 8

  const renderTableRow = (r, inGroup) => (
    <tr
      key={r.key}
      className={[isNew(r) ? 'ml-row-new' : '', inGroup ? 'ml-row-in-group' : ''].filter(Boolean).join(' ') || undefined}
    >
      <td>{r.receiptCode ? <span className="ml-code">{r.receiptCode}</span> : '—'}</td>
      <td>{formatDate(r.date)}</td>
      <td>
        <TypeBadge row={r} />
        {isNew(r) && <span className="ml-new-tag">Mới</span>}
      </td>
      <td>
        <ItemCell row={r} />
      </td>
      <td className="text-right font-bold">
        {formatNumber(r.qty)} {r.unit}
      </td>
      <td className="text-right">{r.unitCost != null ? formatCurrency(r.unitCost) : '—'}</td>
      <td>
        <WhoCell row={r} />
      </td>
      <td>{r.note || '—'}</td>
      {isAdmin && <td className="text-right">{deleteButton(r)}</td>}
    </tr>
  )

  const renderCard = (r) => (
    <div key={r.key} className={`ml-card ${isNew(r) ? 'ml-row-new' : ''}`}>
      <div className="ml-card-line ml-card-top">
        <span>
          <TypeBadge row={r} />
          {isNew(r) && <span className="ml-new-tag">Mới</span>}
        </span>
        <span className="text-muted">{formatDate(r.date)}</span>
      </div>
      {r.receiptCode && (
        <div className="ml-card-line">
          <span className="ml-code">{r.receiptCode}</span>
        </div>
      )}
      <div className="ml-card-line ml-card-name">
        <ItemCell row={r} />
      </div>
      <div className="ml-card-line ml-card-qty">
        <strong>
          {formatNumber(r.qty)} {r.unit}
        </strong>
        {r.unitCost != null && <span className="text-muted"> · {formatCurrency(r.unitCost)}</span>}
      </div>
      <div className="ml-card-line ml-card-meta">
        <WhoCell row={r} />
        {r.note && <div className="text-muted ml-card-note">{r.note}</div>}
      </div>
      {deleteButton(r, 'btn btn-sm btn-outline ml-card-delete')}
    </div>
  )

  return (
    <div className="card ml-ledger" ref={rootRef}>
      <div className="card-header ml-header">
        <h3>📜 Sổ kho chi tiết ({formatNumber(filtered.length)} dòng)</h3>
        <button type="button" className="btn btn-outline" onClick={handleExport}>
          📥 Xuất Sổ kho Excel
        </button>
      </div>

      {notice}

      <div className="ml-filters">
        <input
          type="search"
          className="ml-search"
          placeholder="Tìm mã phiếu, vật tư, ghi chú, dự án..."
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
        />
        <div className="ml-chips" role="group" aria-label="Loại phiếu">
          {LEDGER_TYPE_CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`ml-chip ${type === c.value ? 'active' : ''}`}
              onClick={() => changeType(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="ml-filter-row">
          <label className="ml-field">
            <span>Từ ngày</span>
            <input type="date" value={from} onChange={(e) => changeFrom(e.target.value)} />
          </label>
          <label className="ml-field">
            <span>Đến ngày</span>
            <input type="date" value={to} onChange={(e) => changeTo(e.target.value)} />
          </label>
          <select value={itemKind} onChange={(e) => changeKind(e.target.value)}>
            <option value="all">Tất cả loại vật tư</option>
            <option value="consumable">🟢 Tiêu hao (dùng 1 lần)</option>
            <option value="reusable">🔵 Tái sử dụng (thu hồi)</option>
          </select>
          <select value={projectId} onChange={(e) => changeProject(e.target.value)}>
            <option value="all">Tất cả dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `[${p.code}] ` : ''}
                {p.name}
              </option>
            ))}
          </select>
          {!isDefaultView && (
            <button type="button" className="btn btn-sm btn-outline" onClick={resetFilters}>
              Xóa lọc
            </button>
          )}
        </div>
        {showingDefaultRange && (
          <div className="ml-range-note">
            Đang hiện {DEFAULT_DAYS} ngày gần nhất —{' '}
            <button type="button" className="ml-link-btn" onClick={() => changeFrom('')}>
              Xem tất cả
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-state">Đang tải sổ kho...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Không có phiếu kho nào khớp với bộ lọc.</div>
      ) : (
        <>
          <div className="table-responsive ml-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Ngày</th>
                  <th>Loại phiếu</th>
                  <th>Vật tư</th>
                  <th className="text-right">Số lượng</th>
                  <th className="text-right">Đơn giá nhập</th>
                  <th>Dự án / Đối tác / Kho</th>
                  <th>Ghi chú</th>
                  {isAdmin && <th className="text-right">Xóa</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((en) =>
                  en.kind === 'group' ? (
                    <Fragment key={en.key}>
                      <tr className="ml-group-row">
                        <td colSpan={colCount}>
                          <GroupHeader g={en} open={isOpen(en)} onToggle={() => toggleGroup(en)} />
                        </td>
                      </tr>
                      {isOpen(en) && en.rows.map((r) => renderTableRow(r, true))}
                    </Fragment>
                  ) : (
                    renderTableRow(en.row, false)
                  )
                )}
              </tbody>
            </table>
          </div>

          <div className="ml-cards">
            {entries.map((en) =>
              en.kind === 'group' ? (
                <Fragment key={en.key}>
                  <div className="ml-card ml-group-card">
                    <GroupHeader g={en} open={isOpen(en)} onToggle={() => toggleGroup(en)} />
                  </div>
                  {isOpen(en) && en.rows.map((r) => renderCard(r))}
                </Fragment>
              ) : (
                renderCard(en.row)
              )
            )}
          </div>

          {filtered.length > visible.length && (
            <div className="ml-more">
              <span className="text-muted">
                Đang hiện {formatNumber(visible.length)} / {formatNumber(filtered.length)} dòng
              </span>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
              >
                Hiện thêm {PAGE_SIZE} dòng
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
