import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { generateProjectCode } from '../../lib/formatters'
import { parseLeadAdsSource, inferHubFromLocation } from '../../lib/metaAdsClient'
import {
  LEAD_STATUS_META,
  LEAD_STATUS_ORDER,
  countLeadsByStatus,
  filterLeads,
} from '../../lib/leadStatus'
import LeadCard from './LeadCard'

function isMissingTableErr(err) {
  if (!err) return false
  const msg = (err.message || '').toLowerCase()
  return (
    err.code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  )
}

/**
 * Tab "Khách đăng ký báo giá" (public.site_leads).
 * Props:
 *  - visible: false thì không vẽ gì nhưng vẫn giữ state + số đếm (để badge "N mới" trên tab luôn đúng)
 *  - reloadKey: đổi giá trị để tải lại danh sách (trang cha tăng khi "Làm mới")
 *  - onRefresh: nút "Làm mới" (trang cha tải lại cả trang); không truyền thì chỉ tải lại lead
 *  - onCountsChange(counts), onError(msg), onToast(msg), onSchemaMissing()
 * Quyền lấy từ useAuth (nút xóa và nhãn Ads chỉ manager/admin). Staff bị trang cha chặn.
 */
export default function LeadsTab({
  visible = true,
  reloadKey = 0,
  onRefresh,
  onCountsChange,
  onError,
  onToast,
  onSchemaMissing,
}) {
  const { isManagerOrAdmin } = useAuth()
  const navigate = useNavigate()

  const [leads, setLeads] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [convertingId, setConvertingId] = useState(null)

  const reportError = (msg) => {
    if (onError) onError(msg)
  }

  const loadLeads = useCallback(async () => {
    if (!supabase) return
    try {
      const res = await supabase
        .from('site_leads')
        .select('*')
        .order('created_at', { ascending: false })
      if (res.error) {
        if (isMissingTableErr(res.error)) {
          if (onSchemaMissing) onSchemaMissing()
        } else if (onError) {
          onError(res.error.message)
        }
      } else {
        setLeads(res.data || [])
      }
    } catch (e) {
      if (onError) onError(e.message)
    } finally {
      setLoaded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadLeads()
  }, [loadLeads, reloadKey])

  const counts = countLeadsByStatus(leads)

  useEffect(() => {
    if (onCountsChange) onCountsChange(counts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.total, counts.new, counts.contacted, counts.converted, counts.closed])

  const handleUpdateLeadStatus = async (leadId, newStatus) => {
    const { error } = await supabase
      .from('site_leads')
      .update({ status: newStatus })
      .eq('id', leadId)
    if (error) {
      reportError('Không thể cập nhật trạng thái: ' + error.message)
      return
    }
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
    )
    if (onToast) onToast('Đã cập nhật trạng thái khách hàng.')
  }

  const handleDeleteLead = async (lead) => {
    if (!window.confirm(`Xóa yêu cầu báo giá của "${lead.customer_name}"?`)) return
    const { error } = await supabase.from('site_leads').delete().eq('id', lead.id)
    if (error) {
      reportError('Không thể xóa yêu cầu: ' + error.message)
      return
    }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id))
    if (onToast) onToast('Đã xóa yêu cầu báo giá.')
  }

  const handleConvertToProject = async (lead) => {
    if (
      !window.confirm(
        `Tạo khách hàng "${lead.customer_name}" và một Dự án Báo giá mới từ yêu cầu này?`
      )
    ) {
      return
    }

    setConvertingId(lead.id)
    reportError('')
    try {
      // 1. Tìm khách hàng trùng SĐT hoặc tạo mới
      const cleanPhone = (lead.phone || '').trim()
      let customerId = null

      if (cleanPhone) {
        const { data: existingPartners } = await supabase
          .from('partners')
          .select('id, phone')
          .eq('kind', 'customer')
          .eq('phone', cleanPhone)
          .limit(1)
        if (existingPartners && existingPartners.length > 0) {
          customerId = existingPartners[0].id
        }
      }

      if (!customerId) {
        const { data: newPartner, error: partnerErr } = await supabase
          .from('partners')
          .insert({
            kind: 'customer',
            name: lead.customer_name,
            phone: cleanPhone || null,
            address: lead.location || null,
            note: 'Khách đăng ký từ Website dangwed.com',
          })
          .select('id')
          .single()
        if (partnerErr) throw partnerErr
        customerId = newPartner.id
      }

      // 2. Tạo mã dự án tự động DA-YYMM-XXX
      const { data: existingProjects } = await supabase
        .from('projects')
        .select('id, code')
      const code = generateProjectCode(lead.event_date || '', existingProjects || [])

      const noteParts = []
      if (lead.selected_template) noteParts.push(`Mẫu quan tâm: ${lead.selected_template}`)
      if (lead.service_interest) noteParts.push(`Dịch vụ: ${lead.service_interest}`)
      if (lead.note) noteParts.push(`Ghi chú khách: ${lead.note}`)
      noteParts.push('Nguồn: Website dangwed.com')

      const adsSrcStr = (parseLeadAdsSource(lead.note) || '').toLowerCase()
      let detectedSource = 'google_seo'
      if (adsSrcStr.includes('tiktok')) detectedSource = 'tiktok_ads'
      else if (adsSrcStr) detectedSource = 'meta_ads'

      const detectedHub = adsSrcStr.includes('vinhloc')
        ? 'vinh_loc'
        : adsSrcStr.includes('xuanloc')
        ? 'xuan_loc'
        : inferHubFromLocation(lead.location || '')

      // Nguồn khách và đầu kho ghi vào CỘT projects.lead_source / projects.warehouse_code (không còn thẻ [DW_ATTR] trong note)
      const finalNote = noteParts.join('\n')
      const VALID_LEAD_SOURCES = ['meta_ads', 'tiktok_ads', 'google_seo', 'referral', 'partner']
      const leadSourceCol = VALID_LEAD_SOURCES.includes(detectedSource) ? detectedSource : 'unknown'
      const warehouseCodeCol = detectedHub === 'xuan_loc' || detectedHub === 'vinh_loc' ? detectedHub : null

      const projectName = `${lead.service_interest || 'Tiệc cưới'} - ${lead.customer_name}`

      const { data: newProject, error: projErr } = await supabase
        .from('projects')
        .insert({
          code,
          name: projectName,
          customer_id: customerId,
          location: lead.location || null,
          start_date: lead.event_date || null,
          end_date: lead.event_date || null,
          status: 'quote',
          lead_source: leadSourceCol,
          warehouse_code: warehouseCodeCol,
          note: finalNote,
        })
        .select('id')
        .single()
      if (projErr) throw projErr

      // 3. Đánh dấu lead đã chuyển đổi
      await supabase.from('site_leads').update({ status: 'converted' }).eq('id', lead.id)
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, status: 'converted' } : l))
      )

      navigate(`/du-an/${newProject.id}`)
    } catch (e) {
      reportError('Lỗi khi tạo dự án từ yêu cầu: ' + e.message)
    } finally {
      setConvertingId(null)
    }
  }

  if (!visible) return null
  if (!loaded) return <div className="loading-state">Đang tải dữ liệu Website...</div>

  const filteredLeads = filterLeads(leads, { status: statusFilter, search })

  return (
    <>
      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div className="kpi-card">
          <div className="kpi-label">Tổng yêu cầu từ Web</div>
          <div className="kpi-value">{counts.total}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Chưa liên hệ</div>
          <div className="kpi-value text-amber">{counts.new}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Đã tư vấn</div>
          <div className="kpi-value">{counts.contacted}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Đã chuyển thành Dự án</div>
          <div className="kpi-value text-green">{counts.converted}</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card filter-bar" style={{ marginBottom: 16 }}><div className="filter-group" style={{ alignItems: 'center' }}>
        <input
          type="text"
          className="filter-input"
          placeholder="Tìm tên khách, SĐT, khu vực, mẫu..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Tất cả trạng thái</option>
          {LEAD_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_META[s].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => (onRefresh ? onRefresh() : loadLeads())}
        >
          🔄 Làm mới
        </button>
      </div>
      </div>

      {/* Leads list */}
      {filteredLeads.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: 36 }}>
            {leads.length === 0
              ? 'Chưa có yêu cầu báo giá nào từ dangwed.com. Khi khách điền form trên website, thông tin sẽ tự động đổ về đây.'
              : 'Không tìm thấy yêu cầu nào khớp bộ lọc.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filteredLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              isManagerOrAdmin={isManagerOrAdmin}
              converting={convertingId === lead.id}
              onStatusChange={handleUpdateLeadStatus}
              onConvert={handleConvertToProject}
              onDelete={handleDeleteLead}
            />
          ))}
        </div>
      )}
    </>
  )
}
