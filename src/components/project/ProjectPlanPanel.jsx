import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatNumber } from '../../lib/formatters'
import { KindBadge } from '../Badges'
import ProjectFeedback from './ProjectFeedback'
import ItemPicker from '../ItemPicker'

// Ô số lượng lưu khi rời ô. Làm mới nền cập nhật số mới vào ô, trừ khi người dùng đang gõ dở ở đó.
function PlanQtyInput({ qty, label, onCommit }) {
  const ref = useRef(null)
  const synced = useRef(String(qty))
  useEffect(() => {
    const el = ref.current
    if (!el || synced.current === String(qty)) return
    if (document.activeElement !== el || el.value === synced.current) el.value = qty
    synced.current = String(qty)
  }, [qty])
  return (
    <input
      ref={ref}
      className="ui-input"
      type="number"
      inputMode="decimal"
      min="0.01"
      step="any"
      aria-label={label}
      defaultValue={qty}
      onBlur={(e) => {
        if (Number(e.target.value) !== Number(qty)) onCommit(e.target.value)
      }}
    />
  )
}

export default function ProjectPlanPanel({
  project, templates, canEditCatalog, isStaff, feedback,
  items, projectPlan, conflicts, conflictLimited, issuedByItemMap,
  selectedTemplateId, setSelectedTemplateId, planItemId, setPlanItemId, planQty, setPlanQty,
  busyPlan, handleApplyTemplate, handleAddPlanItem, handleUpdatePlanQty, handleRemovePlanItem,
}) {
  return (
    <div className="card ui-card">
      <div className="card-header">
        <div>
          <h3>📋 Kế hoạch vật tư & Cảnh báo trùng lịch</h3>
          <p className="text-xs text-muted">
            Hệ thống tự động kiểm tra các dự án có ngày thi công/tháo dỡ giao với dự án này (
            {formatDate(project.start_date)} → {formatDate(project.end_date)}) để cảnh báo nếu
            đồ tái sử dụng cần trong NGÀY cao điểm vượt số sẵn có (Tổng sở hữu − đồ còn nằm ở
            các đám khác chưa thu về). Mỗi đám tính phần lớn hơn giữa kế hoạch và số đã xuất
            chưa thu.
          </p>
          {conflictLimited && (
            <p className="text-xs text-amber" style={{ marginTop: 4 }}>
              ⚠️ Không đủ dữ liệu để khẳng định đủ đồ:{' '}
              {isStaff
                ? 'tài khoản nhân viên chỉ xem được các dự án mình tham gia nên không thấy lịch và tồn của các đám khác.'
                : 'chưa tải được đủ dự án/kế hoạch/phiếu kho của các đám khác.'}{' '}
              Hãy hỏi Thủ kho/Quản lý trước khi chốt đồ.
            </p>
          )}
        </div>
      </div>

      {canEditCatalog && (
        <div className="plan-controls-grid">
          {/* Áp dụng mẫu set */}
          <div className="sub-card ui-card">
            <h4>✨ Áp dụng nhanh Mẫu set trang trí</h4>
            <div className="form-inline-row" style={{ marginTop: 8 }}>
              <select className="ui-select"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                <option value="">-- Chọn mẫu set trang trí --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.items?.length || 0} vật tư)
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                onClick={handleApplyTemplate}
                disabled={busyPlan}
              >
                Áp dụng mẫu set
              </button>
            </div>
            <ProjectFeedback feedback={feedback.planTemplate} />
          </div>

          {/* Thêm từng vật tư vào kế hoạch */}
          <form onSubmit={handleAddPlanItem} className="sub-card ui-card">
            <h4>+ Thêm vật tư vào kế hoạch</h4>
            <div className="project-add-row">
              <ItemPicker
                items={items}
                value={planItemId}
                onChange={setPlanItemId}
                ariaLabel="Vật tư thêm vào kế hoạch"
                required
              />
              <input className="ui-input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                required
                aria-label="Số lượng thêm vào kế hoạch"
                placeholder="SL"
                value={planQty}
                onChange={(e) => setPlanQty(e.target.value)}
              />
              <button type="submit" className="ui-btn ui-btn--primary" disabled={busyPlan}>
                Thêm
              </button>
            </div>
            <ProjectFeedback feedback={feedback.planItem} />
          </form>
        </div>
      )}

      {projectPlan.length === 0 ? (
        <div className="empty-state">
          Dự án này chưa có kế hoạch vật tư.
          {canEditCatalog && ' Hãy áp dụng mẫu set hoặc thêm vật tư ở trên.'}
        </div>
      ) : (
        <div className="table-responsive" style={{ marginTop: 16 }}>
          <table className="data-table ui-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên vật tư</th>
                <th>Loại</th>
                <th className="text-right">SL Kế hoạch</th>
                <th className="text-right">Đã xuất</th>
                <th className="text-right">Trong kho</th>
                <th className="text-right">Tổng sở hữu</th>
                <th>Kiểm tra trùng lịch (Đồ tái sử dụng)</th>
                {canEditCatalog && <th className="text-right">Xóa</th>}
              </tr>
            </thead>
            <tbody>
              {projectPlan.map((p) => {
                const item = p.item || {}
                const conf = conflicts[p.item_id]
                const totalOwned =
                  Number(item.in_stock || 0) + Number(item.at_project || 0)
                const alreadyIssued = issuedByItemMap.get(Number(p.item_id)) || 0
                const isShort = conf?.hasShortage

                return (
                  <tr key={p.item_id} className={isShort ? 'row-conflict-shortage' : ''}>
                    <td data-label="Mã">
                      <code>{item.code || `#${p.item_id}`}</code>
                    </td>
                    <td className="ui-table__primary" data-label="Tên vật tư">
                      <Link to={`/vat-tu/${p.item_id}`} className="table-link font-bold">
                        {item.name || `Vật tư #${p.item_id}`}
                      </Link>
                    </td>
                    <td data-label="Loại">{item.kind && <KindBadge kind={item.kind} />}</td>
                    <td className="text-right" data-label="SL kế hoạch">
                      <div className="project-qty-cell">
                        <span className="project-qty-row">
                          {canEditCatalog ? (
                            <PlanQtyInput
                              qty={p.qty}
                              label={`Số lượng kế hoạch của ${item.name || p.item_id}`}
                              onCommit={(value) => handleUpdatePlanQty(p.item_id, value)}
                            />
                          ) : (
                            <span className="font-bold">{formatNumber(p.qty)}</span>
                          )}
                          <span>{item.unit}</span>
                        </span>
                        <ProjectFeedback feedback={feedback[`planRow:${p.item_id}`]} />
                      </div>
                    </td>
                    <td className="text-right text-blue font-bold" data-label="Đã xuất">
                      {formatNumber(alreadyIssued)} {item.unit}
                    </td>
                    <td className="text-right" data-label="Trong kho">
                      {formatNumber(item.in_stock)} {item.unit}
                    </td>
                    <td className="text-right" data-label="Tổng sở hữu">
                      {item.kind === 'reusable'
                        ? `${formatNumber(totalOwned)} ${item.unit}`
                        : '—'}
                    </td>
                    <td className="project-cell-stack" data-label="Kiểm tra trùng lịch">
                      {item.kind !== 'reusable' ? (
                        <span className="text-xs text-muted">
                          Tiêu hao (Tồn kho: {formatNumber(item.in_stock)})
                        </span>
                      ) : isShort ? (
                        <div className="conflict-alert-text">
                          <strong>
                            🚨 Thiếu {formatNumber(conf.shortage)} {item.unit}!
                          </strong>{' '}
                          (Cần ngày cao điểm
                          {conf.peakDate ? ` ${formatDate(conf.peakDate)}` : ''}:{' '}
                          {formatNumber(conf.totalPlanned)} / Sẵn có: {formatNumber(conf.available)}
                          {conf.lockedElsewhere > 0
                            ? ` = sở hữu ${formatNumber(conf.totalOwned)} − ${formatNumber(conf.lockedElsewhere)} còn ở đám khác`
                            : ''}
                          )
                          {conf.otherProjects.length > 0 && (
                            <div className="text-xs">
                              Trùng với:{' '}
                              {conf.otherProjects
                                .map((op) => `${op.name} (${formatNumber(op.qty)})`)
                                .join(', ')}
                            </div>
                          )}
                          {conf.lockedProjects?.length > 0 && (
                            <div className="text-xs">
                              Chưa thu về từ:{' '}
                              {conf.lockedProjects
                                .map((op) => `${op.name} (${formatNumber(op.qty)})`)
                                .join(', ')}
                            </div>
                          )}
                        </div>
                      ) : conflictLimited ? (
                        <span className="text-xs text-amber">
                          Không đủ dữ liệu để kiểm tra (giữ chỗ:{' '}
                          {formatNumber(conf?.totalPlanned || p.qty)} / sẵn có thấy được:{' '}
                          {formatNumber(conf?.available ?? totalOwned)})
                        </span>
                      ) : (
                        <span className="text-green text-xs font-bold">
                          ✓ Đủ đồ (Cần ngày cao điểm: {formatNumber(conf?.totalPlanned || p.qty)} /
                          Sẵn có: {formatNumber(conf?.available ?? totalOwned)})
                          {conf?.lockedElsewhere > 0 && (
                            <span className="text-muted" style={{ fontWeight: 400 }}>
                              {' '}
                              ({formatNumber(conf.lockedElsewhere)} còn ở đám khác)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    {canEditCatalog && (
                      <td className="ui-table__actions text-right" data-label="Xóa">
                        <button
                          type="button"
                          className="ui-btn ui-btn--secondary"
                          onClick={() => handleRemovePlanItem(p.item_id)}
                        >
                          Xóa
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
