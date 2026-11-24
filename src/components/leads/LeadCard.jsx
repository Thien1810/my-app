import { formatDate } from '../../lib/formatters'
import { parseLeadAdsSource } from '../../lib/metaAdsClient'
import { LEAD_STATUS_META, LEAD_STATUS_ORDER } from '../../lib/leadStatus'

export default function LeadCard({
  lead,
  isManagerOrAdmin,
  converting,
  onStatusChange,
  onConvert,
  onDelete,
}) {
  const meta = LEAD_STATUS_META[lead.status] || LEAD_STATUS_META.new
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
            {isManagerOrAdmin && parseLeadAdsSource(lead.note) && (
              <span className="badge badge-blue">
                📢 Ads: {parseLeadAdsSource(lead.note)}
              </span>
            )}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            Gửi lúc: {formatDate(lead.created_at)}
          </div>
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
            value={lead.status}
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

      {lead.note && (
        <div style={{ fontSize: 13.5, marginBottom: 12, color: '#334155' }}>
          <strong>Ghi chú khách:</strong> {lead.note}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        {lead.status !== 'converted' ? (
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
