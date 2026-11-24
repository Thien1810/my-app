import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { LEAD_LOST_REASONS } from '../lib/leadStatus'
import {
  RANGE_PRESETS,
  buildFunnel,
  filterByRange,
  funnelByCampaign,
  funnelByChannel,
  funnelByLanding,
  presetRange,
  unknownSourceStats,
} from '../lib/leadFunnel'
import './LeadSourceReport.css'

const LEAD_COLUMNS =
  'id, status, created_at, note, utm_source, utm_medium, utm_campaign, utm_content, fbclid, landing_path, referrer, heard_from, entry_source, created_via, lost_reason'
const TOP_N = 15

async function loadLeads() {
  const run = (cols) =>
    fetchAllRows((from, to) => supabase.from('site_leads').select(cols).order('id').range(from, to))
  const res = await run(LEAD_COLUMNS)
  if (!res.error) return res
  // Cột có thể chưa tồn tại (chưa chạy SQL) -> thử lại với select('*').
  return run('*')
}

function loadProjects() {
  return fetchAllRows((from, to) =>
    supabase.from('projects').select('id, lead_source, status').order('id').range(from, to),
  )
}

const fmtPct = (n) => `${String(n).replace('.', ',')}%`

function FunnelTable({ title, firstCol, rows, limit }) {
  const [expanded, setExpanded] = useState(false)
  const shown = limit && !expanded ? rows.slice(0, limit) : rows
  return (
    <div className="card lsr-card">
      <div className="card-header">
        <h3>{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">Chưa có lead trong khoảng thời gian này.</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="data-table lsr-table">
              <thead>
                <tr>
                  <th>{firstCol}</th>
                  <th className="lsr-num">Lead</th>
                  <th className="lsr-num">Tư vấn</th>
                  <th className="lsr-num">Báo giá</th>
                  <th className="lsr-num">Cọc</th>
                  <th className="lsr-num">Hoàn thành</th>
                  <th className="lsr-num">Mất</th>
                  <th className="lsr-num">Tỷ lệ chốt</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key + '|' + r.label}>
                    <td className="lsr-label">{r.label}</td>
                    <td className="lsr-num font-bold">{r.total}</td>
                    <td className="lsr-num">{r.consulting}</td>
                    <td className="lsr-num">{r.quoted}</td>
                    <td className="lsr-num">{r.deposited}</td>
                    <td className="lsr-num">{r.completed}</td>
                    <td className="lsr-num">{r.lost}</td>
                    <td className="lsr-num font-bold">{fmtPct(r.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {limit && rows.length > limit && (
            <div className="lsr-more">
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Thu gọn' : `Xem thêm (${rows.length - limit})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function LeadSourceReport() {
  const [leads, setLeads] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [leadError, setLeadError] = useState('')
  const [projectError, setProjectError] = useState('')
  const [preset, setPreset] = useState('90d')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [lr, pr] = await Promise.all([loadLeads(), loadProjects()])
      if (cancelled) return
      setLeadError(lr.error ? 'Không tải được danh sách lead: ' + (lr.error.message || 'lỗi không rõ') : '')
      setProjectError(pr.error ? 'Không tải được danh sách dự án: ' + (pr.error.message || 'lỗi không rõ') : '')
      setLeads(lr.data || [])
      setProjects(pr.data || [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const inRange = useMemo(() => filterByRange(leads, presetRange(preset)), [leads, preset])
  const funnel = useMemo(() => buildFunnel(inRange), [inRange])
  const byChannel = useMemo(() => funnelByChannel(inRange), [inRange])
  const byCampaign = useMemo(() => funnelByCampaign(inRange), [inRange])
  const byLanding = useMemo(() => funnelByLanding(inRange), [inRange])
  const unknown = useMemo(() => unknownSourceStats(inRange, projects), [inRange, projects])

  const lostRows = useMemo(() => {
    const rows = LEAD_LOST_REASONS.map((r) => ({ key: r.key, label: r.label, count: funnel.lostByReason[r.key] || 0 }))
    const knownKeys = new Set(LEAD_LOST_REASONS.map((r) => r.key))
    const other = Object.entries(funnel.lostByReason)
      .filter(([k]) => !knownKeys.has(k))
      .reduce((s, [, c]) => s + c, 0)
    if (other > 0) rows.push({ key: 'unspecified', label: 'Chưa ghi lý do', count: other })
    return rows
  }, [funnel])

  if (loading) {
    return (
      <div className="card lsr-card">
        <div className="empty-state">Đang tải báo cáo nguồn khách...</div>
      </div>
    )
  }

  return (
    <div className="lsr">
      <div className="lsr-toolbar">
        <span className="lsr-toolbar-label">Khoảng thời gian:</span>
        <div className="lsr-presets">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`btn btn-sm ${preset === p.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {leadError && <div className="alert alert-error">{leadError}</div>}
      {projectError && <div className="alert alert-warning">{projectError} (cảnh báo dự án có thể chưa đầy đủ)</div>}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Tổng lead</div>
          <div className="kpi-value">{funnel.total}</div>
        </div>
        <div className="kpi-card kpi-success">
          <div className="kpi-label">Tỷ lệ chốt</div>
          <div className="kpi-value">{fmtPct(funnel.winRate)}</div>
          <div className="kpi-sub">Cọc + hoàn thành / tổng lead</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Lead mất</div>
          <div className="kpi-value">{funnel.lost}</div>
        </div>
        <div className={`kpi-card ${unknown.pct >= 30 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Lead nguồn không rõ</div>
          <div className="kpi-value">{fmtPct(unknown.pct)}</div>
          <div className="kpi-sub">
            {unknown.leadsUnknown} / {unknown.leadsTotal} lead
          </div>
        </div>
      </div>

      {(unknown.leadsUnknown > 0 || unknown.projectsUnknown > 0) && (
        <div className="alert alert-warning lsr-warn">
          <strong>Cảnh báo nguồn không rõ</strong>
          {unknown.leadsUnknown > 0 && (
            <div>
              {unknown.leadsUnknown} lead ({fmtPct(unknown.pct)}) không rõ nguồn.
            </div>
          )}
          {unknown.projectsUnknown > 0 && (
            <div>{unknown.projectsUnknown} dự án có nguồn &quot;không rõ&quot; sẽ không tính vào CAC/ROAS.</div>
          )}
          <div className="lsr-hint">
            Gợi ý: hỏi khách &quot;biết Đặng Wedding qua đâu&quot; khi tư vấn, nhập tay nguồn cho lead, và chọn đúng nguồn khi tạo
            hoặc sửa dự án.
          </div>
        </div>
      )}

      <div className="card lsr-card">
        <div className="card-header">
          <h3>Phễu tổng</h3>
        </div>
        {funnel.total === 0 ? (
          <div className="empty-state">Chưa có lead trong khoảng thời gian này.</div>
        ) : (
          <div className="lsr-funnel">
            {funnel.stages.map((s) => (
              <div className="lsr-bar-row" key={s.key}>
                <div className="lsr-bar-label">{s.label}</div>
                <div className="lsr-bar-track">
                  <div className="lsr-bar-fill" style={{ width: `${Math.max(s.pctOfTotal, s.count > 0 ? 2 : 0)}%` }} />
                </div>
                <div className="lsr-bar-value">
                  <strong>{s.count}</strong>
                  <span className="lsr-bar-pct">
                    {fmtPct(s.pctOfTotal)}
                    {s.key !== 'new' && ` (${fmtPct(s.pctOfPrev)} so với bước trước)`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <FunnelTable title="Phễu theo kênh" firstCol="Kênh" rows={byChannel} />
      <FunnelTable title="Theo chiến dịch" firstCol="Chiến dịch" rows={byCampaign} limit={TOP_N} />
      <FunnelTable title="Theo trang vào" firstCol="Trang vào" rows={byLanding} limit={TOP_N} />

      <div className="card lsr-card">
        <div className="card-header">
          <h3>Lý do mất lead</h3>
        </div>
        {funnel.lost === 0 ? (
          <div className="empty-state">Không có lead mất trong khoảng thời gian này.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table lsr-table">
              <thead>
                <tr>
                  <th>Lý do</th>
                  <th className="lsr-num">Số lead</th>
                  <th className="lsr-num">Tỷ lệ</th>
                </tr>
              </thead>
              <tbody>
                {lostRows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="lsr-num">{r.count}</td>
                    <td className="lsr-num">{fmtPct(Math.round((r.count / funnel.lost) * 1000) / 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="lsr-note">
        Phễu tính theo trạng thái hiện tại của lead; lead đã mất chỉ tính ở bước đầu vì hệ thống chưa lưu lịch sử trạng thái.
      </p>
    </div>
  )
}
