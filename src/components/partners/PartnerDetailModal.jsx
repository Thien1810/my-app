import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPartnerHistory } from '../../lib/partnersApi'
import {
  buildCallLink,
  buildZaloLink,
  canExportPartners,
  formatPhoneDisplay,
} from '../../lib/partnerInput'
import {
  formatCurrency,
  formatDate,
  formatNumber,
  PARTNER_KIND_LABELS,
} from '../../lib/formatters'
import { ProjectStatusBadge } from '../Badges'
import PartnerModal from './PartnerModal'
import './Partners.css'

const SUPPLIER_PRICE_ROLES = ['admin', 'manager', 'storekeeper']

function groupSupplierReceipts(purchases = []) {
  const groups = new Map()
  for (const item of purchases) {
    const key = item.receipt_code ? `receipt:${item.receipt_code}` : `row:${item.id}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        receipt_code: item.receipt_code || null,
        moved_at: item.moved_at,
        items: [],
        totalAmount: 0,
        hasMissingPrice: false,
      }
      groups.set(key, group)
    }
    group.items.push(item)
    if (item.amount == null) {
      group.hasMissingPrice = true
    } else {
      group.totalAmount += Number(item.amount)
    }
    if (item.moved_at && (!group.moved_at || item.moved_at > group.moved_at)) {
      group.moved_at = item.moved_at
    }
  }
  return Array.from(groups.values())
}

export default function PartnerDetailModal({
  partner,
  role,
  canEdit,
  canDelete,
  schemaMissing,
  busy = false,
  escapeDisabled,
  onClose,
  onEdit,
  onArchiveToggle,
  onDelete,
}) {
  const [retryCount, setRetryCount] = useState(0)
  const historyKey = `${partner.id}:${partner.kind}:${retryCount}`
  const [historyState, setHistoryState] = useState({ key: null, res: null })

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => getPartnerHistory(partner))
      .catch(() => ({
        ok: false,
        data: null,
        error: 'Không thể tải lịch sử đối tác.',
      }))
      .then((res) => {
        if (!cancelled) {
          setHistoryState({ key: historyKey, res })
        }
      })

    return () => {
      cancelled = true
    }
  }, [partner, historyKey])

  const loading = historyState.key !== historyKey
  const historyRes = loading ? null : historyState.res

  const callLink = buildCallLink(partner.phone)
  const zaloLink = buildZaloLink(partner.phone)
  const showRevenue = canExportPartners(role)
  const showSupplierPrices = SUPPLIER_PRICE_ROLES.includes(role)
  const isArchived = Boolean(partner.archived_at)
  const history = historyRes?.ok ? historyRes.data : null
  const supplierReceipts = history?.kind === 'supplier' ? groupSupplierReceipts(history.purchases) : []

  return (
    <PartnerModal
      title="Hồ sơ đối tác"
      onClose={onClose}
      wide
      escapeDisabled={escapeDisabled}
      footer={
        <>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose}>
            Đóng
          </button>
          {canEdit && (
            <button
              type="button"
              className="ui-btn ui-btn--secondary ui-btn--sm"
              disabled={busy}
              onClick={() => onEdit(partner)}
            >
              Sửa
            </button>
          )}
          {canEdit && !schemaMissing && (
            <button
              type="button"
              className="ui-btn ui-btn--secondary ui-btn--sm"
              disabled={busy}
              onClick={() => onArchiveToggle(partner)}
            >
              {isArchived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="ui-btn ui-btn--danger ui-btn--sm"
              disabled={busy}
              onClick={() => onDelete(partner)}
            >
              Xóa
            </button>
          )}
        </>
      }
    >
      <div className="ui-stack">
        <div className="ui-row">
          <span className={`ui-badge ${partner.kind === 'supplier' ? 'ui-badge--info' : 'ui-badge--success'}`}>
            {PARTNER_KIND_LABELS[partner.kind] || partner.kind}
          </span>
          {isArchived && <span className="ui-badge ui-badge--neutral">Đã lưu trữ</span>}
        </div>

        <div className="ptn-info-grid">
          <div className="ptn-info-item">
            <span className="ptn-info-item__label">Tên đối tác</span>
            <span className="ptn-info-item__value">
              <strong>{partner.name}</strong>
            </span>
          </div>

          <div className="ptn-info-item">
            <span className="ptn-info-item__label">Số điện thoại</span>
            <span className="ptn-info-item__value">{formatPhoneDisplay(partner.phone)}</span>
          </div>

          <div className="ptn-info-item">
            <span className="ptn-info-item__label">Địa chỉ</span>
            <span className="ptn-info-item__value">{partner.address || '—'}</span>
          </div>

          <div className="ptn-info-item">
            <span className="ptn-info-item__label">Ghi chú</span>
            <span className="ptn-info-item__value">{partner.note || '—'}</span>
          </div>
        </div>

        {(callLink || zaloLink) && (
          <div className="ptn-contact-actions">
            {callLink && (
              <a href={callLink} className="ui-btn ui-btn--secondary ptn-contact-btn">
                📞 Gọi điện
              </a>
            )}
            {zaloLink && (
              <a
                href={zaloLink}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--secondary ptn-contact-btn"
              >
                💬 Nhắn Zalo
              </a>
            )}
          </div>
        )}

        <div>
          <h4 className="ptn-section-title">
            {partner.kind === 'customer' ? 'Lịch sử dự án' : 'Lịch sử phiếu nhập'}
          </h4>

          {loading ? (
            <div className="ui-empty">Đang tải lịch sử...</div>
          ) : !historyRes?.ok ? (
            <div className="ui-stack ui-stack--sm">
              <div className="ui-alert ui-alert--danger">
                {historyRes?.error || 'Không thể tải lịch sử đối tác.'}
              </div>
              <div>
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  onClick={() => setRetryCount((c) => c + 1)}
                >
                  Thử lại
                </button>
              </div>
            </div>
          ) : (
            <div className="ui-stack ui-stack--sm">
              {historyRes.warning && (
                <div className="ui-alert ui-alert--warn">{historyRes.warning}</div>
              )}

              {history.kind === 'customer' ? (
                <>
                  {showRevenue && (
                    <div className="ptn-summary-row">
                      <div className="ui-kpi">
                        <span className="ui-kpi__label">Tổng doanh thu</span>
                        <span className="ui-kpi__value">{formatCurrency(history.totalRevenue)}</span>
                      </div>
                    </div>
                  )}

                  {history.projects.length === 0 ? (
                    <div className="ui-empty">Khách hàng chưa có dự án nào.</div>
                  ) : (
                    <div className="ptn-history-list">
                      {history.projects.map((proj) => (
                        <div key={proj.id} className="ptn-history-item">
                          <div className="ptn-history-item__top">
                            <Link
                              to={`/du-an/${proj.id}`}
                              className="ptn-project-link"
                              onClick={onClose}
                            >
                              {proj.code ? `${proj.code} — ` : ''}
                              {proj.name}
                            </Link>
                            <ProjectStatusBadge status={proj.status} />
                          </div>
                          <div className="ptn-history-item__meta">
                            <span>Ngày: {formatDate(proj.start_date)}</span>
                            {showRevenue && (
                              <span>
                                Doanh thu: <strong>{formatCurrency(proj.revenue)}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {showSupplierPrices && (
                    <div className="ptn-summary-row">
                      <div className="ui-kpi">
                        <span className="ui-kpi__label">Tổng đã mua</span>
                        <span className="ui-kpi__value">{formatCurrency(history.totalSpent)}</span>
                      </div>
                      <div className="ui-kpi">
                        <span className="ui-kpi__label">Số phiếu thiếu giá</span>
                        <span className="ui-kpi__value">{history.missingPriceReceiptCount}</span>
                      </div>
                    </div>
                  )}

                  {supplierReceipts.length === 0 ? (
                    <div className="ui-empty">Nhà cung cấp chưa có phiếu nhập nào.</div>
                  ) : (
                    <div className="ptn-history-list">
                      {supplierReceipts.map((group) => (
                        <div key={group.key} className="ptn-history-item">
                          <div className="ptn-history-item__top">
                            <div className="ui-row">
                              <strong>{group.receipt_code || 'Phiếu không mã'}</strong>
                              {showSupplierPrices && group.hasMissingPrice && (
                                <span className="ui-badge ptn-missing-badge">Thiếu giá</span>
                              )}
                            </div>
                            <div className="ptn-history-item__meta">
                              <span>{group.items.length} dòng</span>
                              <span>{formatDate(group.moved_at)}</span>
                            </div>
                          </div>

                          <div className="ptn-receipt-lines">
                            {group.items.map((item) => (
                              <div key={item.id} className="ptn-receipt-line">
                                <span>Số lượng: {formatNumber(item.qty)}</span>
                                {showSupplierPrices && (
                                  <>
                                    <span>
                                      Đơn giá:{' '}
                                      {item.unit_cost != null && Number(item.unit_cost) > 0
                                        ? formatCurrency(item.unit_cost)
                                        : 'Thiếu giá'}
                                    </span>
                                    <span>
                                      Thành tiền:{' '}
                                      <strong>
                                        {item.amount != null ? formatCurrency(item.amount) : '—'}
                                      </strong>
                                    </span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>

                          {showSupplierPrices && (
                            <div className="ptn-receipt-total">
                              Tổng tiền phiếu: <strong>{formatCurrency(group.totalAmount)}</strong>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </PartnerModal>
  )
}
