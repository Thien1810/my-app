import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { generateProjectCode } from '../../lib/formatters'
import { canConvertLead } from '../../lib/leadConvert'
import {
  LEAD_STATUS_META,
  LEAD_STATUS_ORDER,
  countLeadsByStatus,
  filterLeads,
} from '../../lib/leadStatus'
import { CHANNEL_FILTER_OPTIONS } from '../../lib/leadSource'
import { validateNewLead, buildManualLeadRow, isMissingLeadColumnErr } from '../../lib/leadInput'
import LeadCard from './LeadCard'
import AddLeadModal from './AddLeadModal'
import LostReasonDialog from './LostReasonDialog'
import ConvertLeadDialog from './ConvertLeadDialog'

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
  const [channelFilter, setChannelFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [convertingId, setConvertingId] = useState(null)
  const [lostLead, setLostLead] = useState(null) // lead đang chờ chọn lý do mất
  const [savingLost, setSavingLost] = useState(false)
  const [convertLead, setConvertLead] = useState(null) // lead đang mở hộp thoại tạo dự án
  const [convertWarning, setConvertWarning] = useState(null) // dự án đã tạo nhưng chưa đổi được trạng thái lead
  const [linkedProjects, setLinkedProjects] = useState({}) // site_lead_id -> { id, code }

  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const reportError = (msg) => {
    if (onError) onError(msg)
  }

  const handleAddLead = async (input) => {
    if (addSaving) return
    const v = validateNewLead(input)
    if (!v.ok) return
    setAddSaving(true)
    setAddError('')
    try {
      const { data, error } = await supabase
        .from('site_leads')
        .insert([buildManualLeadRow(input)])
        .select()
        .single()
      if (error) {
        setAddError(
          isMissingLeadColumnErr(error)
            ? 'Chưa thêm được: cần chạy file supabase/site_leads_workflow.sql trên Supabase trước.'
            : error.message || 'Không thể thêm khách.'
        )
        return
      }
      setLeads((prev) => [data, ...prev])
      setAddOpen(false)
      if (onToast) onToast(`Đã thêm khách ${data.customer_name || input.customer_name}.`)
    } catch (e) {
      setAddError(e.message || 'Không thể thêm khách.')
    } finally {
      setAddSaving(false)
    }
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

  // Dự án đã liên kết với lead (cột projects.site_lead_id). Cột chưa có thì bỏ qua, không báo lỗi.
  const loadLinkedProjects = useCallback(async () => {
    if (!supabase) return
    try {
      const res = await supabase
        .from('projects')
        .select('id, code, site_lead_id')
        .not('site_lead_id', 'is', null)
      if (res.error) return
      const map = {}
      for (const p of res.data || []) map[p.site_lead_id] = p
      setLinkedProjects(map)
    } catch {
      // bỏ qua: chưa có cột
    }
  }, [])

  useEffect(() => {
    loadLeads()
    loadLinkedProjects()
  }, [loadLeads, loadLinkedProjects, reloadKey])

  const counts = countLeadsByStatus(leads)

  useEffect(() => {
    if (onCountsChange) onCountsChange(counts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.total, counts.new, counts.consulting, counts.quoted, counts.deposited, counts.completed, counts.lost])

  // Ghi trạng thái (kèm status_changed_at, lost_reason nếu có). Cột status_changed_at/lost_reason
  // chưa có (chưa chạy SQL) thì thử lại chỉ với status. Trả true nếu thành công.
  const saveLeadStatus = async (leadId, fields) => {
    const changedAt = new Date().toISOString()
    let patch = { ...fields, status_changed_at: changedAt }
    let { error } = await supabase.from('site_leads').update(patch).eq('id', leadId)
    if (error && /status_changed_at|lost_reason/i.test(error.message || '') && !/check constraint/i.test(error.message || '')) {
      if (fields.lost_reason) {
        reportError('Chưa lưu được lý do mất: cần chạy file supabase/site_leads_workflow.sql trên Supabase trước.')
        return false
      }
      patch = { ...fields }
      ;({ error } = await supabase.from('site_leads').update(patch).eq('id', leadId))
    }
    if (error) {
      const msg = error.message || ''
      if (error.code === '23514' || /check constraint/i.test(msg)) {
        reportError('Chưa cập nhật được: cần chạy file supabase/site_leads_workflow.sql trên Supabase trước.')
      } else {
        reportError('Không thể cập nhật trạng thái: ' + msg)
      }
      return false
    }
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              ...patch,
              ...(fields.status !== 'lost' ? { lost_reason: null } : {}),
            }
          : l
      )
    )
    return true
  }

  const handleUpdateLeadStatus = async (leadId, newStatus) => {
    if (newStatus === 'lost') {
      const lead = leads.find((l) => l.id === leadId)
      if (lead) setLostLead(lead)
      return
    }
    reportError('')
    const ok = await saveLeadStatus(leadId, { status: newStatus })
    if (ok && onToast) onToast('Đã cập nhật trạng thái khách hàng.')
  }

  const handleLostReasonResult = async (reason) => {
    if (!reason || !lostLead) {
      setLostLead(null)
      return
    }
    setSavingLost(true)
    reportError('')
    const ok = await saveLeadStatus(lostLead.id, { status: 'lost', lost_reason: reason })
    setSavingLost(false)
    if (ok) {
      setLostLead(null)
      if (onToast) onToast('Đã chuyển khách sang trạng thái Mất.')
    }
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

  // Mở hộp thoại chọn nguồn/kho; việc tạo thật nằm ở handleConfirmConvert.
  const handleConvertToProject = (lead) => {
    if (convertingId) return
    setConvertLead(lead)
  }

  const handleConfirmConvert = async ({ leadSource, warehouseCode }) => {
    const lead = convertLead
    if (!lead || convertingId) return
    setConvertingId(lead.id)
    reportError('')
    setConvertWarning(null)
    try {
      // 1. Tải lại lead từ DB: trạng thái có thể đã đổi từ máy/tab khác
      const { data: fresh, error: freshErr } = await supabase
        .from('site_leads')
        .select('id, status')
        .eq('id', lead.id)
        .maybeSingle()
      if (freshErr) throw freshErr
      if (!fresh) {
        reportError('Không tìm thấy yêu cầu này nữa (có thể đã bị xóa).')
        setConvertLead(null)
        loadLeads()
        return
      }
      const can = canConvertLead({ status: fresh.status })
      if (!can.ok) {
        reportError(`Không tạo dự án: ${can.reason}. Danh sách đã được làm mới.`)
        setConvertLead(null)
        loadLeads()
        return
      }
      // 2. Đã có dự án liên kết chưa (bỏ qua nếu cột site_lead_id chưa tồn tại)
      const { data: linked, error: linkedErr } = await supabase
        .from('projects')
        .select('id, code')
        .eq('site_lead_id', lead.id)
        .limit(1)
      if (!linkedErr && linked && linked.length > 0) {
        reportError(`Lead này đã có dự án ${linked[0].code || ''}. Không tạo thêm.`)
        setLinkedProjects((prev) => ({ ...prev, [lead.id]: linked[0] }))
        setConvertLead(null)
        return
      }

      // 3. Tìm khách hàng trùng SĐT hoặc tạo mới
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

      // 4. Tạo mã dự án DA-YYMM-XXX rồi thêm dự án
      const { data: existingProjects } = await supabase.from('projects').select('id, code')
      const code = generateProjectCode(lead.event_date || '', existingProjects || [])

      const noteParts = []
      if (lead.selected_template) noteParts.push(`Mẫu quan tâm: ${lead.selected_template}`)
      if (lead.service_interest) noteParts.push(`Dịch vụ: ${lead.service_interest}`)
      if (lead.note) noteParts.push(`Ghi chú khách: ${lead.note}`)
      noteParts.push('Nguồn: Website dangwed.com')

      const projectRow = {
        code,
        name: `${lead.service_interest || 'Tiệc cưới'} - ${lead.customer_name}`,
        customer_id: customerId,
        location: lead.location || null,
        start_date: lead.event_date || null,
        end_date: lead.event_date || null,
        status: 'quote',
        lead_source: leadSource,
        warehouse_code: warehouseCode || null,
        note: noteParts.join('\n'),
      }

      let ins = await supabase
        .from('projects')
        .insert({ ...projectRow, site_lead_id: lead.id })
        .select('id')
        .single()
      if (ins.error) {
        const m = ins.error.message || ''
        if (ins.error.code === '23505' && /uq_projects_site_lead|site_lead_id/i.test(m)) {
          reportError('Lead này đã có dự án. Không tạo thêm.')
          setConvertLead(null)
          loadLeads()
          loadLinkedProjects()
          return
        }
        if (/site_lead_id/i.test(m) || ins.error.code === 'PGRST204' || ins.error.code === '42703') {
          // Cột site_lead_id chưa có (chưa chạy SQL): chưa tạo gì nên thử lại một lần không có cột đó
          ins = await supabase.from('projects').insert(projectRow).select('id').single()
        }
      }
      if (ins.error) throw ins.error
      const newProject = ins.data

      // 5. Đổi lead sang Báo giá và KIỂM TRA kết quả
      const ok = await saveLeadStatus(lead.id, { status: 'quoted' })
      setLinkedProjects((prev) => ({ ...prev, [lead.id]: { id: newProject.id, code, site_lead_id: lead.id } }))
      setConvertLead(null)
      if (!ok) {
        setConvertWarning({ projectId: newProject.id, code, leadName: lead.customer_name })
        return
      }

      // 6. Thành công
      if (onToast) onToast(`Đã tạo dự án ${code}.`)
      navigate(`/du-an/${newProject.id}`)
    } catch (e) {
      reportError('Lỗi khi tạo dự án từ yêu cầu: ' + (e.message || e))
      setConvertLead(null)
    } finally {
      setConvertingId(null)
    }
  }

  if (!visible) return null
  if (!loaded) return <div className="loading-state">Đang tải dữ liệu Website...</div>

  const filteredLeads = filterLeads(leads, { status: statusFilter, channel: channelFilter, search })

  return (
    <>
      {convertWarning && (
        <div className="lead-dup-warning" role="alert" style={{ marginBottom: 12 }}>
          Đã tạo dự án {convertWarning.code} nhưng chưa cập nhật được trạng thái lead — hãy tự đổi sang Báo giá.{' '}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => navigate(`/du-an/${convertWarning.projectId}`)}
          >
            Mở dự án
          </button>{' '}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setConvertWarning(null)}>
            Đóng
          </button>
        </div>
      )}

      {/* KPI: gọn, cuộn ngang được trên điện thoại */}
      <div className="lead-kpi-row">
        {LEAD_STATUS_ORDER.map((st) => (
          <div className="kpi-card" key={st}>
            <div className="kpi-label">{LEAD_STATUS_META[st].label}</div>
            <div className={`kpi-value${st === 'new' ? ' text-amber' : ''}`}>{counts[st]}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card filter-bar" style={{ marginBottom: 16 }}><div className="filter-group" style={{ alignItems: 'center' }}>
        <input
          type="text"
          className="filter-input"
          placeholder="Tìm tên khách, SĐT, khu vực, mẫu, chiến dịch, trang vào..."
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
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        >
          {CHANNEL_FILTER_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setAddError('')
            setAddOpen(true)
          }}
        >
          + Thêm khách
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => (onRefresh ? onRefresh() : loadLeads())}
        >
          🔄 Làm mới
        </button>
      </div>
      </div>

      <div className="text-xs text-muted" style={{ marginBottom: 8 }}>
        {channelFilter === 'all'
          ? `Hiển thị ${filteredLeads.length} / ${leads.length} yêu cầu`
          : `Kênh "${CHANNEL_FILTER_OPTIONS.find((o) => o.key === channelFilter)?.label}": ${filteredLeads.length} yêu cầu`}
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
              linkedProject={linkedProjects[lead.id]}
              onOpenProject={(id) => navigate(`/du-an/${id}`)}
              onStatusChange={handleUpdateLeadStatus}
              onConvert={handleConvertToProject}
              onDelete={handleDeleteLead}
            />
          ))}
        </div>
      )}
      {addOpen && (
        <AddLeadModal
          leads={leads}
          saving={addSaving}
          error={addError}
          onSubmit={handleAddLead}
          onClose={() => setAddOpen(false)}
        />
      )}
      {convertLead && (
        <ConvertLeadDialog
          lead={convertLead}
          saving={convertingId === convertLead.id}
          onConfirm={handleConfirmConvert}
          onCancel={() => setConvertLead(null)}
        />
      )}
      {lostLead && (
        <LostReasonDialog
          leadName={lostLead.customer_name}
          saving={savingLost}
          onResult={handleLostReasonResult}
        />
      )}
    </>
  )
}
