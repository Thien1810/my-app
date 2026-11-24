import { formatDate } from '../../lib/formatters'
import { useState } from 'react'
import { getLeadAttribution, getLeadChannel } from '../../lib/leadSource'
import './leads.css'
import {
  LEAD_STATUS_META,
  LEAD_STATUS_ORDER,
  normalizeLeadStatus,
  getLostReasonLabel,
  formatTimeAgo,
} from '../../lib/leadStatus'

export default function LeadCard({
  lead,
  isManagerOrAdmin,
  converting,
  onStatusChange,
  onConvert,
  onDelete,
}) {
  const status = normalizeLeadStatus(lead.status)
  const meta = LEAD_STATUS_META[status]
  const changedAgo = formatTimeAgo(lead.status_changed_at)
  const [showSource, setShowSource] = useState(false)
  const channel = getLeadChannel(lead)
  const attr = getLeadAttribution(lead)
  const sourceRows = [
    ['Chiến dịch', attr.utm_campaign],
    ['Nội dung', attr.utm_content],
    ['Trang vào đầu tiên', attr.landing_path],
    ['Biết qua', attr.heard_from],
    ['Nguồn giới thiệu', attr.referrer],
  ].filter(([, v]) => v)
  const cleanDigits = (lead.phone || '').replace(/\D/g, '')
  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 16 }}>{lead.customer_name}</strong>
            <span className={`badge ${meta.cls}`}>{meta.label}</span>
            <span className={`badge lead-channel lead-channel-${channel.group}`}>
              {channel.label}
            </span>
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            Gửi lúc: {formatDate(lead.created_at)}
            {changedAgo && ` · Đổi trạng thái: ${changedAgo}`}
          </div>
          {status === 'lost' && lead.lost_reason && (
            <div className="text-xs" style={{ marginTop: 4, color: '#b91c1c' }}>
              Lý do mất: {getLostReasonLabel(lead.lost_reason)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {cleanDigits && (
            <>
              <a href={`tel:${cleanDigits}`} className="btn btn-outline btn-sm">
                📞 {lead.phone}
              </a>
              <a
                href={`https://zalo.me/${cleanDigits}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline btn-sm"
              >
                💬 Zalo
              </a>
            </>
          )}
          <select
            value={status}
            onChange={(e) => onStatusChange(lead.id, e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13 }}
          >
            {LEAD_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          padding: '10px 12px',
          background: '#f8fafc',
          borderRadius: 8,
          fontSize: 13.5,
          marginBottom: 12,
        }}
      >
        <div>
          <span className="text-muted">Dịch vụ: </span>
          <strong>{lead.service_interest || '—'}</strong>
        </div>
        <div>
          <span className="text-muted">Ngày tổ chức: </span>
          <strong>{lead.event_date ? formatDate(lead.event_date) : 'Chưa rõ'}</strong>
        </div>
        <div>
          <span className="text-muted">Khu vực: </span>
          <strong>{lead.location || '—'}</strong>
        </div>
        {lead.selected_template && (
          <div>
            <span className="text-muted">Mẫu đã chọn: </span>
            <strong style={{ color: '#163828' }}>{lead.selected_template}</strong>
          </div>
        )}
      </div>

      {sourceRows.length > 0 && (
        <div className="lead-source-box">
          <button
            type="button"
            className="lead-source-toggle"
            aria-expanded={showSource}
            onClick={() => setShowSource((v) => !v)}
          >
            {showSource ? '▾' : '▸'} Chi tiết nguồn
          </button>
          {showSource && (
            <div className="lead-source-rows">
              {sourceRows.map(([label, value]) => (
                <div key={label}>
                  <span className="text-muted">{label}: </span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {lead.note && (
        <div style={{ fontSize: 13.5, marginBottom: 12, color: '#334155' }}>
          <strong>Ghi chú khách:</strong> {lead.note}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        {!['quoted', 'deposited', 'completed'].includes(status) ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={converting}
            onClick={() => onConvert(lead)}
          >
            {converting ? 'Đang tạo dự án...' : '✨ Tạo Khách & Dự án Báo giá'}
          </button>
        ) : (
          <span className="text-xs text-green" style={{ alignSelf: 'center' }}>
            ✓ Đã chuyển sang mục Dự án
          </span>
        )}

        {isManagerOrAdmin && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ color: '#dc2626', borderColor: '#fecaca' }}
            onClick={() => onDelete(lead)}
          >
            🗑 Xóa
          </button>
        )}
      </div>
    </div>
  )
}
