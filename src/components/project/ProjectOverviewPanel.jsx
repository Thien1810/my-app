import { Link } from 'react-router-dom'
import { formatCurrency, formatDate, PROJECT_STATUS_LABELS } from '../../lib/formatters'
import { cleanProjectNote } from '../../lib/projectForm'
import ProjectFeedback from './ProjectFeedback'

function nextStep(project, { canEditCatalog, isManagerOrAdmin, pendingReusableCount, issueBlock }) {
  if (pendingReusableCount > 0 && ['awaiting_return', 'done', 'cancelled'].includes(project.status)) {
    return { label: 'Ghi thu hồi vật tư còn ở dự án', tab: 'materials', sub: 'return' }
  }
  switch (project.status) {
    case 'quote':
      return canEditCatalog
        ? { label: 'Chuẩn bị báo giá', tab: 'quote' }
        : { label: 'Xem kế hoạch vật tư', tab: 'materials', sub: 'plan' }
    case 'preparing':
      return { label: 'Kiểm tra kế hoạch vật tư', tab: 'materials', sub: 'plan' }
    case 'in_progress':
      return issueBlock || !canEditCatalog
        ? { label: 'Xem kế hoạch vật tư', tab: 'materials', sub: 'plan' }
        : { label: 'Mở phiếu xuất vật tư', tab: 'materials', sub: 'issue' }
    case 'awaiting_return':
      return { label: 'Ghi thu hồi sau thi công', tab: 'materials', sub: 'return' }
    case 'done':
      return { label: 'Chuẩn bị bài đăng Facebook', tab: 'media' }
    case 'cancelled':
      return isManagerOrAdmin
        ? { label: 'Kiểm tra tạm ứng và cọc', tab: 'money', sub: 'advances' }
        : { label: 'Xem lịch sử phiếu kho', tab: 'materials', sub: 'history' }
    default:
      return null
  }
}

export default function ProjectOverviewPanel({
  project, contractValue, quoteDiscount, canEditCatalog, isManagerOrAdmin, members,
  busyStatus, pendingReusableCount, handleStatusChange, issueBlock, feedback, tabTo,
}) {
  const note = cleanProjectNote(project.note)
  const suggested = nextStep(project, { canEditCatalog, isManagerOrAdmin, pendingReusableCount, issueBlock })
  return (
    <div className="project-overview-grid">
      <section className="card ui-card">
        <h3>Thông tin dự án</h3>
        <dl className="project-details">
          <div><dt>Mã dự án</dt><dd>{project.code || `#${project.id}`}</dd></div>
          <div><dt>Khách hàng</dt><dd>{project.customer?.name || 'Chưa gắn'}</dd></div>
          <div><dt>Địa điểm</dt><dd>{project.location || 'Chưa cập nhật'}</dd></div>
          <div>
            <dt>Lịch thi công</dt>
            <dd>{formatDate(project.start_date)} → {formatDate(project.end_date)}</dd>
          </div>
          {canEditCatalog && (
            <div>
              <dt>Giá trị hợp đồng</dt>
              <dd className="font-bold text-green">
                {formatCurrency(contractValue)}
                {isManagerOrAdmin && quoteDiscount > 0 && (
                  <div className="text-xs text-muted">Đã trừ ưu đãi {formatCurrency(quoteDiscount)}</div>
                )}
              </dd>
            </div>
          )}
          {canEditCatalog && note && <div><dt>Ghi chú</dt><dd className="project-note">{note}</dd></div>}
        </dl>
      </section>

      <section className="card ui-card">
        <h3>Đội thi công</h3>
        <dl className="project-details">
          <div><dt>Phụ trách</dt><dd>{project.lead?.full_name || project.lead?.email || 'Chưa phân công'}</dd></div>
          <div>
            <dt>Thành viên</dt>
            <dd>{members.length > 0 ? members.map((m) => m.full_name || m.email).join(', ') : 'Chưa có thành viên'}</dd>
          </div>
        </dl>
      </section>

      <section className="card ui-card">
        <h3>Tiến độ</h3>
        {isManagerOrAdmin ? (
          <label className="ui-field project-status-field">
            <span className="ui-label">Trạng thái</span>
            <select
              className="ui-select"
              value={project.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={busyStatus}
            >
              {Object.entries(PROJECT_STATUS_LABELS).map(([status, label]) => {
                const lockedClose = (status === 'done' || status === 'cancelled')
                  && status !== project.status && pendingReusableCount > 0
                return (
                  <option key={status} value={status} disabled={lockedClose}>
                    {label}{lockedClose ? ` (còn ${pendingReusableCount} đồ chưa thu hồi)` : ''}
                  </option>
                )
              })}
            </select>
          </label>
        ) : (
          <p className="project-status-field">{PROJECT_STATUS_LABELS[project.status] || project.status}</p>
        )}
        {isManagerOrAdmin && pendingReusableCount > 0 && (
          <p className="text-sm text-muted">
            Còn {pendingReusableCount} đồ tái sử dụng chưa thu hồi: chỉ chuyển sang Hoàn thành / Đã hủy được sau khi
            ghi thu hồi (tốt/hỏng/mất) trong Vật tư &gt; Thu hồi.
          </p>
        )}
        <ProjectFeedback feedback={feedback.status} />
        {suggested && (
          <Link to={tabTo(suggested.tab, suggested.sub)} className="ui-btn ui-btn--primary">
            {suggested.label}
          </Link>
        )}
      </section>
    </div>
  )
}
