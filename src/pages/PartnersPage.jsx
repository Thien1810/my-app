import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useConfirm } from '../components/ConfirmDialog'
import {
  PARTNERS_PAGE_SIZE,
  archivePartner,
  deletePartnerSafe,
  listPartners,
  unarchivePartner,
} from '../lib/partnersApi'
import {
  buildCallLink,
  buildZaloLink,
  canExportPartners,
  formatPhoneDisplay,
} from '../lib/partnerInput'
import { PARTNER_KIND_LABELS } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { listPartnersFallback } from '../components/partners/partnersFallback'
import PartnerDetailModal from '../components/partners/PartnerDetailModal'
import PartnerFormModal from '../components/partners/PartnerFormModal'
import PartnerModal from '../components/partners/PartnerModal'
import '../components/partners/Partners.css'

export default function PartnersPage() {
  const { role, canEditCatalog, canDeleteCatalog } = useAuth()
  const { confirm, confirmDialog } = useConfirm()

  const isStaff = role === 'staff'
  const canEdit = canEditCatalog && !isStaff
  const canDelete = canDeleteCatalog && !isStaff
  const canExport = canExportPartners(role)

  const [activeTab, setActiveTab] = useState(() => (isStaff ? 'supplier' : 'customer'))
  const effectiveTab = isStaff ? 'supplier' : activeTab

  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)

  const [schemaMissing, setSchemaMissing] = useState(false)
  const schemaMissingRef = useRef(false)
  const [queryState, setQueryState] = useState({ key: null, res: null })
  const [actionError, setActionError] = useState('')
  const [noticeModal, setNoticeModal] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const [detailPartner, setDetailPartner] = useState(null)
  const [formModal, setFormModal] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  const currentKey = JSON.stringify({
    role,
    kind: effectiveTab,
    search: debouncedSearch,
    showArchived,
    page,
    reloadKey,
  })

  useEffect(() => {
    let cancelled = false

    const runFetch = async () => {
      const usedFallback = schemaMissingRef.current
      try {
        let res
        if (usedFallback) {
          res = await listPartnersFallback({
            role,
            kind: effectiveTab,
            search: debouncedSearch,
            page,
          })
        } else if (showArchived) {
          res = await listPartners({
            kind: effectiveTab,
            search: debouncedSearch,
            includeArchived: true,
          })
          if (res.ok) {
            const archivedRows = (res.data || []).filter((p) => Boolean(p.archived_at))
            const offset = (page - 1) * PARTNERS_PAGE_SIZE
            res = {
              ...res,
              data: archivedRows.slice(offset, offset + PARTNERS_PAGE_SIZE),
              total: archivedRows.length,
              hasMore: offset + PARTNERS_PAGE_SIZE < archivedRows.length,
            }
          }
        } else {
          res = await listPartners({
            kind: effectiveTab,
            search: debouncedSearch,
            includeArchived: false,
            page,
          })
        }

        if (!usedFallback && !res.ok && res.schemaMissing) {
          schemaMissingRef.current = true
          res = await listPartnersFallback({
            role,
            kind: effectiveTab,
            search: debouncedSearch,
            page,
          })
        }

        return res
      } catch {
        return { ok: false, data: null, error: 'Không thể tải danh sách đối tác.' }
      }
    }

    runFetch().then((res) => {
      if (cancelled) return
      if (schemaMissingRef.current) {
        setSchemaMissing(true)
        setShowArchived(false)
      }
      const nextTotal = res.total ?? 0
      const nextData = res.data || []
      if (res.ok && nextData.length === 0 && nextTotal > 0 && page > 1) {
        const lastValidPage = Math.min(page - 1, Math.max(1, Math.ceil(nextTotal / PARTNERS_PAGE_SIZE)))
        setPage(lastValidPage)
        return
      }
      setQueryState({ key: currentKey, res })
    })

    return () => {
      cancelled = true
    }
  }, [currentKey, role, effectiveTab, debouncedSearch, showArchived, page])

  const loading = queryState.key !== currentKey
  const activeRes = loading ? null : queryState.res
  const loadError = activeRes && !activeRes.ok
    ? (activeRes.error || 'Không thể tải danh sách đối tác.')
    : ''
  const partners = activeRes?.ok ? (activeRes.data || []) : []
  const total = activeRes?.ok ? (activeRes.total ?? 0) : 0
  const hasMore = activeRes?.ok ? Boolean(activeRes.hasMore) : false

  const handleTabChange = (nextTab) => {
    if (isStaff || nextTab === effectiveTab) return
    setActiveTab(nextTab)
    setPage(1)
  }

  const handleArchivedToggle = (checked) => {
    setShowArchived(checked)
    setPage(1)
  }

  const handleArchiveToggle = async (partner) => {
    if (schemaMissingRef.current || busyId != null) return
    const isArchived = Boolean(partner.archived_at)
    const noticeTitle = isArchived ? 'Không thể bỏ lưu trữ đối tác' : 'Không thể lưu trữ đối tác'
    setBusyId(partner.id)
    setActionError('')
    try {
      const res = isArchived ? await unarchivePartner(partner) : await archivePartner(partner)
      if (!res.ok) {
        setNoticeModal({
          title: noticeTitle,
          message: res.error || 'Không thể cập nhật trạng thái lưu trữ đối tác.',
        })
        return
      }
      if (detailPartner?.id === partner.id) {
        setDetailPartner(null)
      }
      setReloadKey((k) => k + 1)
    } catch {
      setNoticeModal({
        title: noticeTitle,
        message: 'Không thể cập nhật trạng thái lưu trữ đối tác.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (partner) => {
    if (busyId != null) return
    const ok = await confirm({
      title: 'Xóa đối tác',
      message: `Bạn có chắc muốn xóa đối tác "${partner.name}"? Thao tác này không thể hoàn tác.`,
      confirmLabel: 'Xóa',
      cancelLabel: 'Hủy',
      danger: true,
    })
    if (!ok) return

    setBusyId(partner.id)
    setActionError('')
    try {
      const res = await deletePartnerSafe(partner)
      if (!res.ok) {
        setNoticeModal({
          title: 'Không thể xóa đối tác',
          message: res.error || 'Không thể xóa đối tác.',
        })
        return
      }
      if (detailPartner?.id === partner.id) {
        setDetailPartner(null)
      }
      setReloadKey((k) => k + 1)
    } catch {
      setNoticeModal({
        title: 'Không thể xóa đối tác',
        message: 'Không thể xóa đối tác.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleExport = async () => {
    if (!canExport || exporting) return
    setExporting(true)
    setActionError('')
    try {
      let res
      if (schemaMissingRef.current) {
        res = await listPartnersFallback({
          role,
          kind: effectiveTab,
          search: debouncedSearch,
        })
      } else {
        res = await listPartners({
          kind: effectiveTab,
          search: debouncedSearch,
          includeArchived: showArchived,
        })
        if (!res.ok && res.schemaMissing) {
          schemaMissingRef.current = true
          setSchemaMissing(true)
          setShowArchived(false)
          res = await listPartnersFallback({
            role,
            kind: effectiveTab,
            search: debouncedSearch,
          })
        }
      }

      if (!res.ok) {
        setActionError(res.error || 'Không thể xuất danh sách đối tác.')
        return
      }

      const isFallback = schemaMissingRef.current
      const sourceRows = !isFallback && showArchived
        ? (res.data || []).filter((p) => Boolean(p.archived_at))
        : (res.data || [])

      const rows = sourceRows.map((p) => ({
        'Loại đối tác': PARTNER_KIND_LABELS[p.kind] || p.kind,
        'Tên đối tác': p.name,
        'Số điện thoại': String(p.phone ?? '').trim() ? formatPhoneDisplay(p.phone) : '',
        'Địa chỉ': p.address || '',
        'Ghi chú': p.note || '',
        ...(!isFallback ? { 'Trạng thái': p.archived_at ? 'Đã lưu trữ' : 'Đang hoạt động' } : {}),
      }))
      exportToExcel(rows, 'DanhSachDoiTac', 'danh-sach-doi-tac.xlsx')
    } catch {
      setActionError('Không thể xuất file Excel.')
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PARTNERS_PAGE_SIZE))

  return (
    <div className="page-container ptn-page">
      <div className="ptn-header">
        <div>
          <h1 className="ptn-header__title">Quản lý Đối tác</h1>
          <p className="ui-text-muted ptn-header__sub">
            {isStaff
              ? 'Danh sách Nhà cung cấp vật tư'
              : 'Danh sách Khách hàng đặt dịch vụ và Nhà cung cấp vật tư'}
          </p>
        </div>

        {(canExport || canEdit) && (
          <div className="ptn-header__actions">
            {canExport && (
              <button
                type="button"
                className={`ui-btn ui-btn--secondary ui-btn--sm${exporting ? ' is-loading' : ''}`}
                disabled={exporting}
                onClick={handleExport}
              >
                {exporting ? 'Đang xuất...' : 'Xuất Excel'}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="ui-btn ui-btn--primary ui-btn--sm"
                onClick={() => setFormModal({ editingPartner: null })}
              >
                + Thêm đối tác
              </button>
            )}
          </div>
        )}
      </div>

      {schemaMissing && role === 'admin' && (
        <div className="ui-alert ui-alert--warn">
          Chưa chạy <strong>supabase/partners_v2.sql</strong>. Hệ thống đang dùng chế độ dự phòng
          và tạm ẩn tính năng lưu trữ đối tác.
        </div>
      )}

      {actionError && <div className="ui-alert ui-alert--danger">{actionError}</div>}

      <div className="ui-card">
        <div className="ui-card__body ptn-toolbar">
          <div className="ui-tabs" role="tablist" aria-label="Loại đối tác">
            {!isStaff && (
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'customer'}
                className={`ui-tab${effectiveTab === 'customer' ? ' is-active' : ''}`}
                onClick={() => handleTabChange('customer')}
              >
                Khách hàng
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTab === 'supplier'}
              className={`ui-tab${effectiveTab === 'supplier' ? ' is-active' : ''}`}
              onClick={() => handleTabChange('supplier')}
            >
              Nhà cung cấp
            </button>
          </div>

          <div className="ptn-filters">
            <div className="ptn-filters__search">
              <label htmlFor="ptn-search" className="ui-sr-only">
                Tìm kiếm đối tác
              </label>
              <input
                id="ptn-search"
                type="search"
                className="ui-input"
                placeholder="Tìm theo tên, số điện thoại, địa chỉ..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            {!schemaMissing && (
              <label className={`ptn-archived-toggle${showArchived ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => handleArchivedToggle(e.target.checked)}
                />
                <span>Đã lưu trữ</span>
              </label>
            )}
          </div>
        </div>
      </div>

      <div className="ui-card">
        {loading ? (
          <div className="ui-empty">Đang tải danh sách đối tác...</div>
        ) : loadError ? (
          <div className="ui-empty">
            <div className="ui-alert ui-alert--danger">{loadError}</div>
            <div className="ptn-empty-retry">
              <button
                type="button"
                className="ui-btn ui-btn--secondary ui-btn--sm"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Thử lại
              </button>
            </div>
          </div>
        ) : partners.length === 0 ? (
          <div className="ui-empty">
            <div className="ui-empty__title">Không tìm thấy đối tác nào</div>
            <span>
              {showArchived
                ? 'Chưa có đối tác nào trong mục đã lưu trữ.'
                : 'Thử thay đổi từ khóa tìm kiếm hoặc thêm đối tác mới.'}
            </span>
          </div>
        ) : (
          <>
            <div className="ui-table-wrap">
              <table className="data-table ui-table">
                <thead>
                  <tr>
                    <th>Tên đối tác</th>
                    <th>Số điện thoại</th>
                    <th>Địa chỉ</th>
                    <th>Ghi chú</th>
                    <th className="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => {
                    const callLink = buildCallLink(p.phone)
                    const zaloLink = buildZaloLink(p.phone)
                    const isArchived = Boolean(p.archived_at)
                    const isBusy = busyId === p.id

                    return (
                      <tr key={p.id}>
                        <td className="ui-table__primary" data-label="Tên đối tác">
                          <div className="ptn-name-wrap">
                            <button
                              type="button"
                              className="ptn-name-btn"
                              onClick={() => setDetailPartner(p)}
                            >
                              {p.name}
                            </button>
                            {isArchived && (
                              <span className="ui-badge ui-badge--neutral">Đã lưu trữ</span>
                            )}
                          </div>
                        </td>

                        <td data-label="Số điện thoại">
                          <div className="ptn-phone-cell">
                            <span>{formatPhoneDisplay(p.phone)}</span>
                            {(callLink || zaloLink) && (
                              <div className="ptn-contact-actions">
                                {callLink && (
                                  <a
                                    href={callLink}
                                    className="ui-btn ui-btn--secondary ptn-contact-btn"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Gọi
                                  </a>
                                )}
                                {zaloLink && (
                                  <a
                                    href={zaloLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn ui-btn--secondary ptn-contact-btn"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Zalo
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="ui-col-hide-mobile" data-label="Địa chỉ">
                          {p.address || '—'}
                        </td>

                        <td className="ui-col-hide-mobile" data-label="Ghi chú">
                          {p.note || '—'}
                        </td>

                        <td className="ui-table__actions text-right">
                          <div className="ptn-row-actions">
                            <button
                              type="button"
                              className="ui-btn ui-btn--ghost ui-btn--sm"
                              onClick={() => setDetailPartner(p)}
                            >
                              Hồ sơ
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                className="ui-btn ui-btn--secondary ui-btn--sm"
                                disabled={isBusy}
                                onClick={() => setFormModal({ editingPartner: p })}
                              >
                                Sửa
                              </button>
                            )}
                            {canEdit && !schemaMissing && (
                              <button
                                type="button"
                                className="ui-btn ui-btn--secondary ui-btn--sm"
                                disabled={isBusy}
                                onClick={() => handleArchiveToggle(p)}
                              >
                                {isArchived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                className="ui-btn ui-btn--secondary ui-btn--sm ptn-danger-btn"
                                disabled={isBusy}
                                onClick={() => handleDelete(p)}
                              >
                                Xóa
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="ptn-pagination">
              <span className="ptn-pagination__info">
                Trang {page} / {totalPages} ({total} đối tác)
              </span>
              <div className="ptn-pagination__btns">
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Trước
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {detailPartner && (
        <PartnerDetailModal
          partner={detailPartner}
          role={role}
          canEdit={canEdit}
          canDelete={canDelete}
          schemaMissing={schemaMissing}
          busy={busyId === detailPartner.id}
          escapeDisabled={Boolean(confirmDialog) || Boolean(formModal) || Boolean(noticeModal)}
          onClose={() => setDetailPartner(null)}
          onEdit={(p) => {
            setDetailPartner(null)
            setFormModal({ editingPartner: p })
          }}
          onArchiveToggle={handleArchiveToggle}
          onDelete={handleDelete}
        />
      )}

      {formModal && (
        <PartnerFormModal
          editingPartner={formModal.editingPartner}
          defaultKind={effectiveTab}
          role={role}
          schemaMissing={schemaMissing}
          onClose={() => setFormModal(null)}
          onSaved={(savedKind) => {
            setFormModal(null)
            if (!isStaff && savedKind) {
              setActiveTab(savedKind)
              setPage(1)
            }
            setReloadKey((k) => k + 1)
          }}
        />
      )}

      {noticeModal && (
        <PartnerModal
          title={noticeModal.title}
          onClose={() => setNoticeModal(null)}
          footer={
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--sm"
              onClick={() => setNoticeModal(null)}
            >
              Đã hiểu
            </button>
          }
        >
          <div className="ui-alert ui-alert--danger">{noticeModal.message}</div>
        </PartnerModal>
      )}

      {confirmDialog}
    </div>
  )
}
