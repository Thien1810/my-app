import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ProjectStatusBadge } from '../components/Badges'
import ProjectQuoteTab from '../components/ProjectQuoteTab'
import ProjectFacebookTab from '../components/ProjectFacebookTab'
import ProjectAdvancesPanel from '../components/finance/ProjectAdvancesPanel'
import ProjectOverviewPanel from '../components/project/ProjectOverviewPanel'
import ProjectPlanPanel from '../components/project/ProjectPlanPanel'
import ProjectIssuePanel from '../components/project/ProjectIssuePanel'
import ProjectReturnPanel from '../components/project/ProjectReturnPanel'
import ProjectMovementHistory from '../components/project/ProjectMovementHistory'
import ProjectCostsPanel from '../components/project/ProjectCostsPanel'
import ProjectProfitPanel from '../components/project/ProjectProfitPanel'
import ProjectFeedback from '../components/project/ProjectFeedback'
import useProjectDetail from '../components/project/useProjectDetail'
import { MATERIAL_TABS, MONEY_TABS, projectTabSearch, resolveProjectTab } from '../components/project/projectTabs'
import { calcProjectFbReminder } from '../lib/watermarkHelper'
import '../components/project/ProjectDetail.css'

function ProjectTabNav({ label, tabs, active, tabTo }) {
  const navRef = useRef(null)
  // Điện thoại: thanh tab cuộn ngang, kéo tab đang chọn vào tầm nhìn (không đụng cuộn dọc).
  useEffect(() => {
    const nav = navRef.current
    const current = nav?.querySelector('.is-active')
    if (!current) return
    const box = nav.getBoundingClientRect()
    const tabBox = current.getBoundingClientRect()
    if (tabBox.left < box.left) nav.scrollLeft -= box.left - tabBox.left
    else if (tabBox.right > box.right) nav.scrollLeft += tabBox.right - box.right
  }, [active])
  return (
    <nav ref={navRef} className="ui-tabs project-tabs" aria-label={label}>
      {tabs.map(({ id, label: name, badge }) => (
        <Link
          key={id}
          to={tabTo(id)}
          aria-current={id === active ? 'page' : undefined}
          className={`ui-tab${id === active ? ' is-active' : ''}`}
        >
          {name}{badge}
        </Link>
      ))}
    </nav>
  )
}

function ProjectDetail({ projectId }) {
  const [searchParams] = useSearchParams()
  const detail = useProjectDetail(projectId)
  const {
    project, loading, loadError, dataWarnings, feedback, canEditCatalog, isStaff, isManagerOrAdmin,
    contractValue, quoteDiscount, templates, shortageConflictsCount,
  } = detail
  const { tab, sub } = resolveProjectTab(searchParams, detail)
  const tabTo = (name, section) => ({ search: projectTabSearch(searchParams, name, section) })

  // Giữ component báo giá qua các lần đổi tab để bảo toàn nháp và lần lưu đang chạy.
  const [quoteOpened, setQuoteOpened] = useState(tab === 'quote')
  if (tab === 'quote' && !quoteOpened) setQuoteOpened(true)

  const view = `${tab}/${sub || ''}`
  const [shownView, setShownView] = useState(view)
  if (shownView !== view) {
    setShownView(view)
    detail.clearFeedback()
  }

  if (loading) return <div className="loading-state">Đang tải thông tin dự án...</div>
  if (!project) {
    return (
      <div className="page-container project-detail">
        <div className="alert alert-error">{loadError || 'Không tìm thấy dự án hoặc bạn không có quyền xem.'}</div>
        <Link to="/du-an" className="ui-btn ui-btn--secondary">← Quay lại danh sách dự án</Link>
      </div>
    )
  }

  const reminder = calcProjectFbReminder(project)
  const mediaBadge = reminder.isOverdue5Days
    ? <span className="ui-badge ui-badge--danger">Quá {reminder.daysPassed} ngày</span>
    : reminder.fbData?.status === 'posted' ? <span className="ui-badge ui-badge--success">Đã đăng</span> : null
  const mainTabs = [
    { id: 'overview', label: 'Tổng quan' },
    ...(canEditCatalog ? [{ id: 'quote', label: 'Báo giá' }] : []),
    { id: 'materials', label: 'Vật tư' },
    ...(isManagerOrAdmin ? [{ id: 'money', label: 'Tiền' }] : []),
    { id: 'media', label: 'Truyền thông', badge: mediaBadge },
  ]
  const materialTabs = MATERIAL_TABS
    .filter(({ id }) => !isStaff || id !== 'issue')
    .map((entry) => entry.id === 'plan' ? {
      ...entry,
      label: `Kế hoạch (${detail.plan.projectPlan.length})`,
      badge: shortageConflictsCount > 0
        ? <span className="ui-badge ui-badge--danger">Thiếu {shortageConflictsCount}</span>
        : null,
    } : entry)
  const moneyTabs = MONEY_TABS.map((entry) => entry.id === 'costs'
    ? { ...entry, label: `Chi phí (${detail.costs.otherCosts.length})` }
    : entry)

  return (
    <div className="page-container project-detail">
      {detail.confirmDialog}
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/du-an">Dự án</Link> / <span>{project.code || project.name}</span></div>
          <h1>{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
        </div>
        <Link to="/du-an" className="ui-btn ui-btn--secondary">← Danh sách dự án</Link>
      </div>

      {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}
      {dataWarnings.length > 0 && (
        <div className="alert alert-error" role="alert">
          Dữ liệu chưa đầy đủ: không tải được {dataWarnings.join(', ')}. Số liệu trên trang có thể thiếu; hãy tải lại trang.
        </div>
      )}

      <ProjectTabNav
        label="Chi tiết dự án"
        tabs={mainTabs}
        active={tab}
        tabTo={(name) => tabTo(name, name === 'materials' ? (isStaff ? 'return' : 'plan') : name === 'money' ? 'costs' : undefined)}
      />

      {tab === 'overview' && (
        <ProjectOverviewPanel
          {...detail.overview}
          project={project}
          contractValue={contractValue}
          quoteDiscount={quoteDiscount}
          canEditCatalog={canEditCatalog}
          isManagerOrAdmin={isManagerOrAdmin}
          issueBlock={detail.issue.issueBlock}
          feedback={feedback}
          tabTo={tabTo}
        />
      )}

      {canEditCatalog && quoteOpened && (
        <section hidden={tab !== 'quote'} aria-label="Báo giá">
          <ProjectQuoteTab
            project={project}
            templates={templates}
            contractValue={contractValue}
            discount={isManagerOrAdmin ? quoteDiscount : 0}
            isManagerOrAdmin={isManagerOrAdmin}
            onSyncContractValue={detail.setContractValue}
            onSyncFinance={({ contractValue: cv, discount: discountValue }) => {
              detail.setContractValue(Number(cv) || 0)
              detail.setQuoteDiscount(Number(discountValue) || 0)
            }}
            onApplySetsToPlan={detail.handleApplyQuoteSetsToPlan}
            planFeedback={feedback.quote}
          />
        </section>
      )}

      {tab === 'materials' && (
        <section aria-label="Vật tư">
          <ProjectTabNav label="Thao tác vật tư" tabs={materialTabs} active={sub} tabTo={(name) => tabTo('materials', name)} />
          {sub === 'plan' && (
            <ProjectPlanPanel {...detail.plan} project={project} templates={templates} canEditCatalog={canEditCatalog} isStaff={isStaff} feedback={feedback} />
          )}
          {sub === 'issue' && <ProjectIssuePanel {...detail.issue} canEditCatalog={canEditCatalog} feedback={feedback} />}
          {sub === 'return' && <ProjectReturnPanel {...detail.returns} feedback={feedback} />}
          {sub === 'history' && <ProjectMovementHistory movements={detail.movements} movesLoadFailed={detail.movesLoadFailed} />}
        </section>
      )}

      {tab === 'money' && isManagerOrAdmin && (
        <section aria-label="Tiền">
          <ProjectTabNav label="Tài chính dự án" tabs={moneyTabs} active={sub} tabTo={(name) => tabTo('money', name)} />
          {sub === 'costs' && <ProjectCostsPanel {...detail.costs} feedback={feedback} />}
          {sub === 'advances' && (
            <ProjectAdvancesPanel projectId={projectId} contractValue={contractValue} canWrite={isManagerOrAdmin} projectStatus={project.status} />
          )}
          {sub === 'profit' && <ProjectProfitPanel {...detail.summary} project={project} />}
        </section>
      )}

      {tab === 'media' && (
        <section aria-label="Truyền thông">
          <ProjectFeedback feedback={feedback.media} />
          <ProjectFacebookTab project={project} templates={templates} onProjectUpdated={() => detail.loadAll('media')} />
        </section>
      )}
    </div>
  )
}

export default function ProjectDetailPage() {
  const { id } = useParams()
  return <ProjectDetail key={id} projectId={Number(id)} />
}
