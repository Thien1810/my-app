import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  todayISO,
  PROJECT_STATUS_LABELS,
  KIND_LABELS,
} from '../lib/formatters'
import {
  calcScheduleConflicts,
  calcProjectItemStats,
  calcProjectFinancialSummary,
} from '../lib/calc'
import { fetchAllRows } from '../lib/fetchAll'
import { checkIssueStock, validateReturnInputs } from '../lib/movementRules'
import { exportToExcel } from '../lib/exportExcel'
import {
  KindBadge,
  ProjectStatusBadge,
  MovementTypeBadge,
} from '../components/Badges'
import CurrencyInput from '../components/CurrencyInput'
import ProjectQuoteTab from '../components/ProjectQuoteTab'
import ProjectFacebookTab from '../components/ProjectFacebookTab'
import ProjectAdvancesPanel from '../components/finance/ProjectAdvancesPanel'
import { calcProjectFbReminder } from '../lib/watermarkHelper'
import { extractProjectAttribution } from '../lib/metaAdsClient'
import { useConfirm } from '../components/ConfirmDialog'

// Cột item_stock dùng trong trang này (không kéo image_url/note để nhẹ dữ liệu)
const ITEM_STOCK_COLUMNS = 'id, code, name, kind, unit, cost, expected_uses, active, in_stock, at_project'
const PROJECT_MOVE_TYPES = ['issue', 'return_good', 'return_damaged', 'return_lost']

// Nguồn khách hiệu lực của dự án, cùng cách ProjectsPage mở form sửa:
// ưu tiên cột lead_source/warehouse_code; chưa có mới dùng suy luận cũ từ note.
function effectiveLeadSource(p) {
  if (!p) return 'unknown'
  const hasColumnAttr = (p.lead_source && p.lead_source !== 'unknown') || !!p.warehouse_code
  if (hasColumnAttr) return p.lead_source || 'unknown'
  const attr = extractProjectAttribution(p)
  return attr.isExplicit ? attr.source || 'unknown' : 'unknown'
}

export default function ProjectDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const projectId = Number(id)
  const { isManagerOrAdmin, canEditCatalog, isStaff } = useAuth()
  const { confirm, confirmDialog } = useConfirm()
  // Chặn bấm đúp: state busy chỉ có hiệu lực sau lần render kế tiếp, ref thì ngay lập tức.
  const statusBusyRef = useRef(false)
  const planBusyRef = useRef(false)
  const returnBusyRef = useRef(false)

  const [project, setProject] = useState(null)
  const [items, setItems] = useState([])
  const [allProjects, setAllProjects] = useState([])
  const [allPlans, setAllPlans] = useState([])
  // Phiếu kho của mọi dự án (chỉ cột cần) để biết đồ còn ở đám nào; null = không tải được
  const [allProjectMoves, setAllProjectMoves] = useState(null)
  const [conflictDataIncomplete, setConflictDataIncomplete] = useState(false)
  const [busyStatus, setBusyStatus] = useState(false)
  const [projectPlanRows, setProjectPlanRows] = useState([])
  const [planLoadFailed, setPlanLoadFailed] = useState(false)
  const [movesLoadFailed, setMovesLoadFailed] = useState(false)
  const [dataWarnings, setDataWarnings] = useState([])
  const [templates, setTemplates] = useState([])
  const [movements, setMovements] = useState([])
  const [otherCosts, setOtherCosts] = useState([])
  const [contractValue, setContractValue] = useState(0)
  const [quoteDiscount, setQuoteDiscount] = useState(0)
  const [members, setMembers] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Default tab: check ?tab=facebook, or staff goes straight to 'return' or 'plan'
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(
    requestedTab || (isStaff ? 'return' : 'plan')
  )

  // Tab 1: Kế hoạch vật tư
  const [planItemId, setPlanItemId] = useState('')
  const [planQty, setPlanQty] = useState(1)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [busyPlan, setBusyPlan] = useState(false)

  // Tab 2: Xuất cho dự án
  const [issueDate, setIssueDate] = useState(todayISO())
  const [issueNote, setIssueNote] = useState('')
  const [issueLines, setIssueLines] = useState([{ item_id: '', qty: 1 }])
  const [busyIssue, setBusyIssue] = useState(false)

  // Tab 3: Thu hồi
  const [returnDate, setReturnDate] = useState(todayISO())
  const [returnNote, setReturnNote] = useState('')
  const [returnInputs, setReturnInputs] = useState({})
  const [busyReturn, setBusyReturn] = useState(false)

  // Tab 4: Chi phí khác
  const [costKind, setCostKind] = useState('Nhân công')
  const [costAmount, setCostAmount] = useState('')
  const [costDate, setCostDate] = useState(todayISO())
  const [costNote, setCostNote] = useState('')
  const [busyCost, setBusyCost] = useState(false)

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [
        projRes,
        itemsRes,
        allProjRes,
        allPlansRes,
        myPlanRes,
        tplRes,
        movesRes,
        memRes,
        allMovesRes,
      ] = await Promise.all([
        supabase
          .from('projects')
          .select(
            '*, customer:partners(id, name, phone), lead:profiles!projects_lead_id_fkey(id, full_name, email)'
          )
          .eq('id', projectId)
          .maybeSingle(),
        fetchAllRows((from, to) =>
          supabase
            .from('item_stock')
            .select(ITEM_STOCK_COLUMNS)
            .order('name')
            .order('id')
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase
            .from('projects')
            .select('id, code, name, start_date, end_date, status')
            .order('id')
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase
            .from('project_plan')
            .select('*')
            .order('project_id')
            .order('item_id')
            .range(from, to)
        ),
        supabase.from('project_plan').select('*').eq('project_id', projectId),
        supabase
          .from('set_templates')
          .select('*, items:set_template_items(item_id, qty, item:items(id, code, name, unit, kind, cost))')
          .order('name'),
        supabase
          .from('stock_movements')
          .select('*, item:items(id, code, name, unit, kind)')
          .eq('project_id', projectId)
          .order('moved_at', { ascending: false })
          .order('id', { ascending: false }),
        supabase
          .from('project_members')
          .select('user_id, profile:profiles(id, full_name, email)')
          .eq('project_id', projectId),
        fetchAllRows((from, to) =>
          supabase
            .from('stock_movements')
            .select('id, project_id, item_id, type, qty')
            .not('project_id', 'is', null)
            .in('type', PROJECT_MOVE_TYPES)
            .order('id')
            .range(from, to)
        ),
      ])

      if (projRes.error) throw projRes.error
      if (itemsRes.error) throw itemsRes.error

      setProject(projRes.data)
      setItems(itemsRes.data || [])
      const warnings = []
      if (allProjRes.error) warnings.push('danh sách dự án (cảnh báo trùng lịch)')
      if (allPlansRes.error) warnings.push('kế hoạch các dự án khác (cảnh báo trùng lịch)')
      if (myPlanRes.error) warnings.push('kế hoạch vật tư của dự án này')
      if (tplRes.error) warnings.push('mẫu set')
      if (movesRes.error) warnings.push('phiếu kho của dự án')
      if (memRes.error) warnings.push('thành viên dự án')
      if (allMovesRes.error) warnings.push('phiếu kho các dự án (cảnh báo trùng lịch)')
      setPlanLoadFailed(!!myPlanRes.error)
      setMovesLoadFailed(!!movesRes.error)
      setProjectPlanRows(myPlanRes.data || [])
      setAllProjects(allProjRes.data || [])
      setAllPlans(allPlansRes.data || [])
      setTemplates(tplRes.data || [])
      setMovements(movesRes.data || [])
      setMembers((memRes.data || []).map((m) => m.profile).filter(Boolean))
      setAllProjectMoves(allMovesRes.error ? null : allMovesRes.data || [])
      setConflictDataIncomplete(!!(allProjRes.error || allPlansRes.error || allMovesRes.error))

      if (canEditCatalog) {
        const finRes = await supabase
          .from('project_finance')
          .select(isManagerOrAdmin ? 'contract_value, discount' : 'contract_value')
          .eq('project_id', projectId)
          .maybeSingle()
        if (finRes.error) throw finRes.error
        setContractValue(Number(finRes.data?.contract_value || 0))
        setQuoteDiscount(isManagerOrAdmin ? Number(finRes.data?.discount || 0) : 0)
      }

      if (isManagerOrAdmin) {
        const costRes = await supabase
          .from('project_costs')
          .select('*')
          .eq('project_id', projectId)
          .order('cost_date', { ascending: false })
        if (costRes.error) warnings.push('chi phí khác')
        setOtherCosts(costRes.data || [])
      }
      setDataWarnings(warnings)
    } catch (err) {
      setError(err.message || 'Không thể tải dữ liệu dự án')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [projectId, isManagerOrAdmin])

  const itemMap = useMemo(() => {
    const map = new Map()
    for (const i of items) map.set(Number(i.id), i)
    return map
  }, [items])

  const projectPlan = useMemo(() => {
    return projectPlanRows.map((p) => ({
      ...p,
      item: itemMap.get(Number(p.item_id)),
    }))
  }, [projectPlanRows, itemMap])

  const conflicts = useMemo(() => {
    return calcScheduleConflicts(project, allProjects, allPlans, itemMap, {
      movements: allProjectMoves || undefined,
    })
  }, [project, allProjects, allPlans, itemMap, allProjectMoves])

  // Nhân viên bị RLS che dữ liệu dự án khác (và số tồn của item_stock), hoặc tải thiếu dữ liệu:
  // không được khẳng định "Đủ đồ".
  const conflictLimited = isStaff || conflictDataIncomplete

  const itemStats = useMemo(() => {
    return calcProjectItemStats(movements, itemMap)
  }, [movements, itemMap])

  const issuedByItemMap = useMemo(() => {
    const map = new Map()
    for (const s of itemStats) {
      map.set(Number(s.item_id), s.issued)
    }
    return map
  }, [itemStats])

  const financialSummary = useMemo(() => {
    return calcProjectFinancialSummary({
      movements,
      itemStockMap: itemMap,
      otherCosts,
      contractValue,
      discount: quoteDiscount,
    })
  }, [movements, itemMap, otherCosts, contractValue, quoteDiscount])

  // Cập nhật nhanh trạng thái dự án (Admin/Manager)
  const handleStatusChange = async (newStatus) => {
    if (!project || statusBusyRef.current || newStatus === project.status) return
    setError('')
    setSuccess('')
    // Cùng yêu cầu như form sửa ở ProjectsPage
    if (
      newStatus !== 'quote' &&
      newStatus !== 'cancelled' &&
      effectiveLeadSource(project) === 'unknown'
    ) {
      setError(
        'Hãy chọn nguồn khách trước khi chuyển dự án khỏi trạng thái báo giá (mở "Sửa" dự án ở trang Danh sách dự án).'
      )
      return
    }

    const fromLabel = PROJECT_STATUS_LABELS[project.status] || project.status
    const toLabel = PROJECT_STATUS_LABELS[newStatus] || newStatus
    const lines = [`Chuyển dự án "${project.name}" từ "${fromLabel}" sang "${toLabel}"?`]
    const closing = newStatus === 'cancelled' || newStatus === 'done'
    if (newStatus === 'cancelled') {
      lines.push('Dự án hủy: doanh thu tính 0 trong P&L, chi phí đã phát sinh vẫn tính vào tháng hủy.')
    }
    if (closing) {
      if (movesLoadFailed) {
        lines.push('⚠️ Không tải được phiếu kho của dự án nên không kiểm tra được đồ chưa thu hồi.')
      } else {
        const pending = itemStats.filter((r) => r.item.kind === 'reusable' && r.outstanding > 0)
        if (pending.length > 0) {
          const list = pending
            .slice(0, 8)
            .map((r) => `- ${r.item.name}: ${formatNumber(r.outstanding)} ${r.item.unit || ''}`.trim())
          if (pending.length > 8) list.push(`- ... và ${pending.length - 8} vật tư khác`)
          lines.push(
            `⚠️ Còn ${pending.length} đồ tái sử dụng CHƯA thu hồi (vẫn được phép chuyển, nhưng nên thu hồi hoặc ghi hỏng/mất):\n${list.join('\n')}`
          )
        }
      }
    }
    statusBusyRef.current = true
    setBusyStatus(true)
    try {
      const ok = await confirm({
        title: `Chuyển sang ${toLabel}`,
        message: lines.join('\n\n'),
        confirmLabel: 'Chuyển trạng thái',
        danger: closing,
      })
      if (!ok) return
      const { data: updated, error: err } = await supabase
        .from('projects')
        .update({ status: newStatus })
        .eq('id', projectId)
        .select('id')
      if (err) throw err
      if (!updated || updated.length === 0) {
        throw new Error('Hệ thống không cho cập nhật dự án này (không có quyền).')
      }
      setSuccess(`Đã chuyển trạng thái dự án sang "${toLabel}"`)
      await loadAll()
    } catch (err) {
      setError(err.message || 'Không thể đổi trạng thái dự án')
    } finally {
      statusBusyRef.current = false
      setBusyStatus(false)
    }
  }

  // --- TAB 1: KẾ HOẠCH VẬT TƯ ---
  const handleAddPlanItem = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (Number(planQty) < 0) {
      setError('Số lượng không được là số âm.')
      return
    }
    if (!planItemId || Number(planQty) <= 0) return
    setBusyPlan(true)
    try {
      const existing = projectPlan.find((p) => Number(p.item_id) === Number(planItemId))
      const newQty = existing
        ? Number(existing.qty) + Number(planQty)
        : Number(planQty)

      const { error: err } = await supabase.from('project_plan').upsert(
        {
          project_id: projectId,
          item_id: Number(planItemId),
          qty: newQty,
        },
        { onConflict: 'project_id,item_id' }
      )
      if (err) throw err
      setPlanItemId('')
      setPlanQty(1)
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi thêm vật tư vào kế hoạch')
    } finally {
      setBusyPlan(false)
    }
  }

  const handleUpdatePlanQty = async (itemId, qty) => {
    const num = Number(qty)
    if (Number.isNaN(num) || num <= 0) {
      setSuccess('')
      setError(
        num < 0
          ? 'Số lượng kế hoạch không được là số âm.'
          : 'Số lượng kế hoạch phải lớn hơn 0.'
      )
      return
    }
    setError('')
    try {
      const { error: err } = await supabase
        .from('project_plan')
        .update({ qty: num })
        .eq('project_id', projectId)
        .eq('item_id', itemId)
      if (err) throw err
      await loadAll()
    } catch (err) {
      setError(err.message || 'Không thể cập nhật số lượng kế hoạch')
    }
  }

  const handleRemovePlanItem = async (itemId) => {
    try {
      const { error: err } = await supabase
        .from('project_plan')
        .delete()
        .eq('project_id', projectId)
        .eq('item_id', itemId)
      if (err) throw err
      await loadAll()
    } catch (err) {
      setError(err.message || 'Không thể xóa dòng kế hoạch')
    }
  }

  // Cộng thêm SL vật tư của các mẫu set vào kế hoạch (KHÔNG thay thế).
  // entries: [{ template_id, mult }]. Nếu kế hoạch đã có vật tư trùng thì hỏi xác nhận trước.
  // Trả { ok, count } | { ok:false, cancelled:true } | { ok:false, error }.
  const addTemplatesToPlan = async (entries) => {
    if (planBusyRef.current) return { ok: false, cancelled: true }
    if (planLoadFailed) {
      return {
        ok: false,
        error: 'Không tải được kế hoạch vật tư hiện tại nên không thể cộng thêm (tránh ghi sai số). Hãy tải lại trang.',
      }
    }
    const addMap = new Map()
    for (const entry of entries) {
      const tpl = templates.find((t) => Number(t.id) === Number(entry.template_id))
      if (!tpl?.items) continue
      const mult = Number(entry.mult)
      const m = Number.isFinite(mult) && mult > 0 ? mult : 1
      for (const ti of tpl.items) {
        const itemId = Number(ti.item_id)
        const addQty = Number(ti.qty || 0) * m
        if (addQty > 0) addMap.set(itemId, (addMap.get(itemId) || 0) + addQty)
      }
    }
    if (addMap.size === 0) {
      return { ok: false, error: 'Các mẫu set đã chọn chưa có vật tư nào để nạp sang kế hoạch.' }
    }
    const existingMap = new Map()
    for (const p of projectPlan) existingMap.set(Number(p.item_id), Number(p.qty))

    planBusyRef.current = true
    setBusyPlan(true)
    try {
      const dup = [...addMap.keys()].filter((id) => existingMap.has(id))
      if (dup.length > 0) {
        const list = dup.slice(0, 8).map((id) => {
          const it = itemMap.get(id)
          const unit = it?.unit || ''
          return `- ${it?.name || `Vật tư #${id}`}: ${formatNumber(existingMap.get(id))} + ${formatNumber(addMap.get(id))} = ${formatNumber(existingMap.get(id) + addMap.get(id))} ${unit}`.trim()
        })
        if (dup.length > 8) list.push(`- ... và ${dup.length - 8} vật tư khác`)
        const ok = await confirm({
          title: 'Cộng thêm vào kế hoạch',
          message: `Kế hoạch đã có ${dup.length} vật tư trùng với mẫu set. Số lượng sẽ được CỘNG THÊM vào số đang có (không thay thế):\n${list.join('\n')}\n\nTiếp tục?`,
          confirmLabel: 'Cộng thêm',
        })
        if (!ok) return { ok: false, cancelled: true }
      }
      const rows = [...addMap.entries()]
        .map(([item_id, add]) => ({
          project_id: Number(projectId),
          item_id,
          qty: (existingMap.get(item_id) || 0) + add,
        }))
        .sort((a, b) => a.item_id - b.item_id)
      const { error: err } = await supabase
        .from('project_plan')
        .upsert(rows, { onConflict: 'project_id,item_id' })
      if (err) return { ok: false, error: err.message || 'Lỗi khi ghi kế hoạch vật tư.' }
      await loadAll()
      return { ok: true, count: rows.length }
    } catch (err) {
      return { ok: false, error: err?.message || 'Lỗi khi ghi kế hoạch vật tư.' }
    } finally {
      planBusyRef.current = false
      setBusyPlan(false)
    }
  }

  // Gọi từ tab Báo giá: tab tự hiện kết quả (thành công/lỗi) theo giá trị trả về.
  const handleApplyQuoteSetsToPlan = async (templateEntries = []) => {
    return addTemplatesToPlan(templateEntries)
  }

  const handleApplyTemplate = async () => {
    if (planBusyRef.current) return
    setError('')
    setSuccess('')
    if (!selectedTemplateId) {
      setError('Vui lòng chọn một mẫu set trang trí để áp dụng.')
      return
    }
    const tpl = templates.find((t) => String(t.id) === String(selectedTemplateId))
    if (!tpl || !tpl.items || tpl.items.length === 0) {
      setError('Mẫu set này chưa có vật tư nào.')
      return
    }
    const res = await addTemplatesToPlan([{ template_id: tpl.id, mult: 1 }])
    if (res.ok) {
      setSuccess(`Đã áp dụng mẫu set "${tpl.name}" (${res.count} vật tư) vào kế hoạch!`)
      setSelectedTemplateId('')
    } else if (!res.cancelled) {
      setError(res.error || 'Lỗi khi áp dụng mẫu set')
    }
  }

  // --- TAB 2: XUẤT CHO DỰ ÁN ---
  // Tải tồn kho mới nhất ngay trước khi ghi phiếu xuất (không dùng số đã cache).
  // Trả { map, error }.
  const fetchFreshStock = async (itemIds) => {
    const ids = [...new Set(itemIds.map(Number))]
    const { data, error: err } = await supabase
      .from('item_stock')
      .select('id, name, in_stock')
      .in('id', ids)
    if (err) return { map: null, error: err }
    const map = new Map()
    for (const r of data || []) map.set(Number(r.id), r)
    return { map, error: null }
  }

  const handleIssueByPlan = async () => {
    if (planLoadFailed) {
      setError('Không tải được kế hoạch vật tư của dự án nên không thể xuất theo kế hoạch. Hãy tải lại trang.')
      return
    }
    if (movesLoadFailed) {
      setError('Không tải được phiếu kho của dự án nên không biết đã xuất những gì, không thể xuất theo kế hoạch (tránh xuất trùng). Hãy tải lại trang.')
      return
    }
    if (projectPlan.length === 0) {
      setError('Kế hoạch vật tư đang trống. Hãy lập kế hoạch trước hoặc xuất thủ công.')
      return
    }

    const toIssue = []
    for (const p of projectPlan) {
      const alreadyIssued = issuedByItemMap.get(Number(p.item_id)) || 0
      const remaining = Number(p.qty) - alreadyIssued
      if (remaining > 0) {
        toIssue.push({
          moved_at: issueDate || todayISO(),
          type: 'issue',
          item_id: Number(p.item_id),
          project_id: projectId,
          qty: remaining,
          note: issueNote.trim() || 'Xuất theo kế hoạch dự án',
        })
      }
    }

    if (toIssue.length === 0) {
      setError('Tất cả vật tư trong kế hoạch đã được xuất đủ số lượng.')
      return
    }

    setBusyIssue(true)
    setError('')
    setSuccess('')
    try {
      const { map, error: stockErr } = await fetchFreshStock(toIssue.map((r) => r.item_id))
      if (stockErr) throw stockErr
      const check = checkIssueStock(toIssue, map)
      if (!check.ok) {
        setError(check.error)
        return
      }
      // Sắp theo item_id: khóa dòng vật tư ở DB luôn theo cùng thứ tự, tránh deadlock khi 2 người xuất cùng lúc
      toIssue.sort((a, b) => a.item_id - b.item_id)
      const { error: err } = await supabase.from('stock_movements').insert(toIssue)
      if (err) throw err
      setSuccess(`Đã xuất kho tự động ${toIssue.length} dòng vật tư theo kế hoạch!`)
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi xuất theo kế hoạch')
    } finally {
      setBusyIssue(false)
    }
  }

  const handleManualIssue = async (e) => {
    e.preventDefault()
    if (issueLines.some((l) => Number(l.qty) < 0)) {
      setSuccess('')
      setError('Số lượng xuất không được là số âm. Vui lòng kiểm tra lại các dòng vật tư.')
      return
    }
    const valid = issueLines.filter((l) => l.item_id && Number(l.qty) > 0)
    if (valid.length === 0) {
      setError('Vui lòng chọn ít nhất 1 vật tư và nhập số lượng > 0.')
      return
    }

    setBusyIssue(true)
    setError('')
    setSuccess('')
    try {
      const rows = valid.map((l) => ({
        moved_at: issueDate || todayISO(),
        type: 'issue',
        item_id: Number(l.item_id),
        project_id: projectId,
        qty: Number(l.qty),
        note: issueNote.trim() || 'Xuất bổ sung cho dự án',
      }))

      const { map, error: stockErr } = await fetchFreshStock(rows.map((r) => r.item_id))
      if (stockErr) throw stockErr
      const check = checkIssueStock(rows, map)
      if (!check.ok) {
        setError(check.error)
        return
      }
      // Sắp theo item_id như xuất theo kế hoạch: khóa dòng vật tư ở DB cùng thứ tự, tránh deadlock
      rows.sort((a, b) => a.item_id - b.item_id)
      const { error: err } = await supabase.from('stock_movements').insert(rows)
      if (err) throw err
      setSuccess(`Đã lập phiếu xuất ${rows.length} dòng vật tư cho dự án!`)
      setIssueLines([{ item_id: '', qty: 1 }])
      setIssueNote('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi xuất vật tư cho dự án')
    } finally {
      setBusyIssue(false)
    }
  }

  // --- TAB 3: THU HỒI ---
  const handleReturnInputChange = (itemId, field, value) => {
    setReturnInputs((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { good: '', damaged: '', lost: '' }),
        [field]: value,
      },
    }))
  }

  const handleFillAllGood = async () => {
    const targets = itemStats.filter((row) => row.item.kind === 'reusable' && row.outstanding > 0)
    if (targets.length === 0) return
    const isTyped = (inp) =>
      !!inp && ['good', 'damaged', 'lost'].some((f) => inp[f] !== '' && inp[f] != null)
    const typed = targets.filter((row) => isTyped(returnInputs[row.item_id]))
    let overwrite = false
    if (typed.length > 0) {
      overwrite = await confirm({
        title: 'Ghi đè số đã nhập?',
        message: `Đã có số nhập tay cho ${typed.length} vật tư (${typed
          .slice(0, 5)
          .map((r) => r.item.name)
          .join(', ')}${typed.length > 5 ? ', ...' : ''}).

Ghi đè = điền lại toàn bộ là "Tốt 100%".
Giữ số đã nhập = chỉ điền các dòng còn trống.`,
        confirmLabel: 'Ghi đè',
        cancelLabel: 'Giữ số đã nhập',
      })
    }
    setReturnInputs((prev) => {
      const next = { ...prev }
      for (const row of targets) {
        if (!overwrite && isTyped(prev[row.item_id])) continue
        next[row.item_id] = { good: row.outstanding, damaged: 0, lost: 0 }
      }
      return next
    })
  }

  const handleSubmitReturns = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    // ref chặn được bấm đúp ngay cả khi state chưa kịp cập nhật
    if (returnBusyRef.current) return
    if (movesLoadFailed) {
      setError('Không tải được phiếu kho của dự án nên không biết còn bao nhiêu đồ ở dự án. Hãy tải lại trang trước khi thu hồi.')
      return
    }
    const check = validateReturnInputs(itemStats, returnInputs)
    if (!check.ok) {
      setError(check.error)
      return
    }
    const statById = new Map(itemStats.map((r) => [Number(r.item_id), r]))
    const rowsToInsert = []
    for (const line of check.lines) {
      const row = statById.get(Number(line.item_id))
      const base = {
        moved_at: returnDate || todayISO(),
        item_id: row.item_id,
        project_id: projectId,
      }
      if (line.good > 0) {
        rowsToInsert.push({
          ...base,
          type: 'return_good',
          qty: line.good,
          note:
            returnNote.trim() ||
            (row.item.kind === 'consumable' ? 'Thu hồi vật tư tiêu hao dư' : 'Thu hồi đồ tốt'),
        })
      }
      if (line.damaged > 0) {
        rowsToInsert.push({
          ...base,
          type: 'return_damaged',
          qty: line.damaged,
          note: returnNote.trim() || 'Thu hồi đồ bị hỏng (chờ sửa)',
        })
      }
      if (line.lost > 0) {
        rowsToInsert.push({
          ...base,
          type: 'return_lost',
          qty: line.lost,
          note: returnNote.trim() || 'Báo mất vật tư tại dự án',
        })
      }
    }

    returnBusyRef.current = true
    setBusyReturn(true)
    try {
      rowsToInsert.sort((a, b) => a.item_id - b.item_id)
      const { error: err } = await supabase.from('stock_movements').insert(rowsToInsert)
      if (err) throw err
      setSuccess(`Đã ghi nhận ${rowsToInsert.length} dòng phiếu thu hồi vật tư!`)
      setReturnInputs({})
      setReturnNote('')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi ghi nhận thu hồi vật tư')
    } finally {
      returnBusyRef.current = false
      setBusyReturn(false)
    }
  }

  // --- TAB 4: CHI PHÍ KHÁC ---
  const handleAddCost = async (e) => {
    e.preventDefault()
    if (busyCost) return
    if (!costKind.trim()) {
      setSuccess('')
      setError('Vui lòng nhập khoản mục chi phí.')
      return
    }
    const amount = Number(costAmount)
    if (!costAmount || !Number.isFinite(amount) || amount <= 0) {
      setSuccess('')
      setError(
        amount < 0
          ? 'Số tiền chi phí không được là số âm.'
          : 'Vui lòng nhập số tiền chi phí lớn hơn 0.'
      )
      return
    }
    setBusyCost(true)
    setError('')
    setSuccess('')
    try {
      const { error: err } = await supabase.from('project_costs').insert([
        {
          project_id: projectId,
          kind: costKind.trim(),
          amount: Number(costAmount),
          cost_date: costDate || todayISO(),
          note: costNote.trim() || null,
        },
      ])
      if (err) throw err
      setCostAmount('')
      setCostNote('')
      setSuccess('Đã thêm khoản chi phí khác!')
      await loadAll()
    } catch (err) {
      setError(err.message || 'Lỗi khi thêm chi phí khác')
    } finally {
      setBusyCost(false)
    }
  }

  const handleDeleteCost = async (costId) => {
    if (!window.confirm('Xóa khoản chi phí này?')) return
    try {
      const { error: err } = await supabase.from('project_costs').delete().eq('id', costId)
      if (err) throw err
      await loadAll()
    } catch (err) {
      setError(err.message || 'Không thể xóa chi phí')
    }
  }

  const handleExportProjectSummary = () => {
    const rows = financialSummary.itemBreakdown.map((r) => ({
      'Mã vật tư': r.item.code || '',
      'Tên vật tư': r.item.name,
      'Phân loại': KIND_LABELS[r.item.kind] || r.item.kind,
      'ĐVT': r.item.unit,
      'Đã xuất': r.issued,
      'Thu hồi tốt / Dư': r.return_good,
      'Thu hồi hỏng': r.return_damaged,
      'Báo mất': r.return_lost,
      'Còn ở dự án': r.outstanding,
      'Đơn giá vốn (₫)': r.cost,
      'Chi phí tiêu hao (₫)': Math.round(r.rowConsumable),
      'Khấu hao tái sử dụng (₫)': Math.round(r.rowDepreciation),
      'Giá trị hỏng + mất (₫)': Math.round(r.rowDamagedLost),
    }))
    const fs = financialSummary
    const headerRows = [
      ['Doanh số (₫)', fs.grossSales],
      ['Ưu đãi (₫)', fs.discount],
      ['Doanh thu (₫)', fs.contractValue],
      [
        'Biên lợi nhuận (%)',
        fs.contractValue > 0 ? Number(fs.marginPct.toFixed(1)) : '—',
      ],
    ].map(([label, value]) => ({ 'Mã vật tư': label, 'Tên vật tư': value }))
    exportToExcel(
      [...headerRows, {}, ...rows],
      'QuyetToanVatTu',
      `quyet-toan-du-an-${project?.code || projectId}.xlsx`
    )
  }

  if (loading) return <div className="loading-state">Đang tải thông tin dự án...</div>
  if (!project) {
    return (
      <div className="page-container">
        <div className="alert alert-error">{error || 'Không tìm thấy dự án hoặc bạn không có quyền xem.'}</div>
        <Link to="/du-an" className="btn btn-outline">
          ← Quay lại danh sách dự án
        </Link>
      </div>
    )
  }

  const shortageConflictsCount = projectPlan.filter(
    (p) => conflicts[p.item_id]?.hasShortage
  ).length

  const fbReminder = calcProjectFbReminder(project)

  return (
    <div className="page-container">
      {confirmDialog}
      {/* Header dự án */}
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link to="/du-an">Dự án</Link> / <span>{project.name}</span>
          </div>
          <h1>
            {project.name}{' '}
            <span style={{ fontSize: '0.9rem', verticalAlign: 'middle' }}>
              <ProjectStatusBadge status={project.status} />
            </span>
          </h1>
          <div className="project-meta-row">
            <span>
              Mã: <strong>{project.code || `#${project.id}`}</strong>
            </span>
            <span>
              • Khách hàng: <strong>{project.customer?.name || 'Chưa gắn'}</strong>
            </span>
            <span>
              • Địa điểm: <strong>{project.location || 'Chưa cập nhật'}</strong>
            </span>
            <span>
              • Lịch:{' '}
              <strong>
                {formatDate(project.start_date)} → {formatDate(project.end_date)}
              </strong>
            </span>
            <span>
              • Phụ trách:{' '}
              <strong>{project.lead?.full_name || project.lead?.email || '—'}</strong>
            </span>
            {canEditCatalog && (
              <span>
                • Giá trị HĐ:{' '}
                <strong className="text-green">{formatCurrency(contractValue)}</strong>
                {isManagerOrAdmin && quoteDiscount > 0 && (
                  <span className="text-xs text-muted">
                    {' '}
                    (đã trừ ưu đãi {formatCurrency(quoteDiscount)})
                  </span>
                )}
              </span>
            )}
          </div>
          {members.length > 0 && (
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
              Đội thi công: {members.map((m) => m.full_name || m.email).join(', ')}
            </div>
          )}
        </div>

        <div className="header-actions">
          {isManagerOrAdmin && (
            <select
              value={project.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={busyStatus}
              className="status-select"
            >
              {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  Trạng thái: {label}
                </option>
              ))}
            </select>
          )}
          <Link to="/du-an" className="btn btn-outline">
            ← Danh sách dự án
          </Link>
        </div>
      </div>

      {dataWarnings.length > 0 && (
        <div className="alert alert-error">
          Dữ liệu chưa đầy đủ: không tải được {dataWarnings.join(', ')}. Số liệu trên trang có thể thiếu; hãy tải lại trang.
        </div>
      )}
      {error && <div className="alert alert-error" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Thanh Tabs */}
      <div className="tabs-bar" style={{ marginBottom: 20 }}>
        {canEditCatalog && (
          <button
            type="button"
            className={`tab-btn ${activeTab === 'quote' ? 'active' : ''}`}
            onClick={() => setActiveTab('quote')}
          >
            🧾 Báo giá (Set trang trí)
          </button>
        )}

        <button
          type="button"
          className={`tab-btn ${activeTab === 'plan' ? 'active' : ''}`}
          onClick={() => setActiveTab('plan')}
        >
          📋 Kế hoạch vật tư ({projectPlan.length})
          {shortageConflictsCount > 0 && (
            <span className="badge badge-danger" style={{ marginLeft: 6 }}>
              ⚠️ Thiếu {shortageConflictsCount}
            </span>
          )}
        </button>

        {!isStaff && (
          <button
            type="button"
            className={`tab-btn ${activeTab === 'issue' ? 'active' : ''}`}
            onClick={() => setActiveTab('issue')}
          >
            📤 Xuất cho dự án
          </button>
        )}

        <button
          type="button"
          className={`tab-btn ${activeTab === 'return' ? 'active' : ''}`}
          onClick={() => setActiveTab('return')}
        >
          📥 Thu hồi vật tư
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'facebook' ? 'active' : ''}`}
          onClick={() => setActiveTab('facebook')}
        >
          📱 Đăng Facebook & Watermark
          {fbReminder.isOverdue5Days && (
            <span className="badge badge-danger" style={{ marginLeft: 6 }}>
              🔔 Quá {fbReminder.daysPassed} ngày
            </span>
          )}
          {!fbReminder.isOverdue5Days && fbReminder.fbData?.status === 'posted' && (
            <span className="badge badge-green" style={{ marginLeft: 6 }}>
              ✓ Đã đăng
            </span>
          )}
        </button>

        {isManagerOrAdmin && (
          <>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'costs' ? 'active' : ''}`}
              onClick={() => setActiveTab('costs')}
            >
              💸 Chi phí khác ({otherCosts.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              📊 Tổng kết & Lãi/Lỗ
            </button>
          </>
        )}
      </div>

      {/* TAB BÁO GIÁ TỪ HÌNH ẢNH SET TRANG TRÍ (Quản trị / Quản lý / Thủ kho) */}
      {activeTab === 'quote' && canEditCatalog && (
        <ProjectQuoteTab
          project={project}
          templates={templates}
          contractValue={contractValue}
          discount={isManagerOrAdmin ? quoteDiscount : 0}
          isManagerOrAdmin={isManagerOrAdmin}
          onSyncContractValue={(val) => setContractValue(val)}
          onSyncFinance={({ contractValue: cv, discount: d }) => {
            setContractValue(Number(cv) || 0)
            setQuoteDiscount(Number(d) || 0)
          }}
          onApplySetsToPlan={handleApplyQuoteSetsToPlan}
        />
      )}

      {/* TAB ĐĂNG FACEBOOK & GHÉP WATERMARK ĐẶNG WEDDING */}
      {activeTab === 'facebook' && (
        <ProjectFacebookTab
          project={project}
          templates={templates}
          onProjectUpdated={loadAll}
        />
      )}

      {/* TAB 1: KẾ HOẠCH VẬT TƯ */}
      {activeTab === 'plan' && (
        <div className="card">
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
              <div className="sub-card">
                <h4>✨ Áp dụng nhanh Mẫu set trang trí</h4>
                <div className="form-inline-row" style={{ marginTop: 8 }}>
                  <select
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
                    className="btn btn-primary"
                    onClick={handleApplyTemplate}
                    disabled={busyPlan}
                  >
                    Áp dụng mẫu set
                  </button>
                </div>
              </div>

              {/* Thêm từng vật tư vào kế hoạch */}
              <form onSubmit={handleAddPlanItem} className="sub-card">
                <h4>+ Thêm vật tư vào kế hoạch</h4>
                <div className="form-inline-row" style={{ marginTop: 8 }}>
                  <select
                    required
                    value={planItemId}
                    onChange={(e) => setPlanItemId(e.target.value)}
                  >
                    <option value="">-- Chọn vật tư --</option>
                    {items
                      .filter((i) => i.active)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.code ? `[${i.code}] ` : ''}
                          {i.name} ({KIND_LABELS[i.kind]} - Tồn: {formatNumber(i.in_stock)})
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    style={{ width: 100 }}
                    placeholder="SL"
                    value={planQty}
                    onChange={(e) => setPlanQty(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busyPlan}>
                    Thêm
                  </button>
                </div>
              </form>
            </div>
          )}

          {projectPlan.length === 0 ? (
            <div className="empty-state">
              Dự án này chưa có kế hoạch vật tư. Hãy chọn "Áp dụng mẫu set" hoặc thêm vật tư ở trên.
            </div>
          ) : (
            <div className="table-responsive" style={{ marginTop: 16 }}>
              <table className="data-table">
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
                        <td>
                          <code>{item.code || `#${p.item_id}`}</code>
                        </td>
                        <td>
                          <Link to={`/vat-tu/${p.item_id}`} className="table-link font-bold">
                            {item.name || `Vật tư #${p.item_id}`}
                          </Link>
                        </td>
                        <td>{item.kind && <KindBadge kind={item.kind} />}</td>
                        <td className="text-right">
                          {canEditCatalog ? (
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              style={{ width: 90, textAlign: 'right' }}
                              defaultValue={p.qty}
                              onBlur={(e) => {
                                if (Number(e.target.value) !== Number(p.qty)) {
                                  handleUpdatePlanQty(p.item_id, e.target.value)
                                }
                              }}
                            />
                          ) : (
                            <span className="font-bold">{formatNumber(p.qty)}</span>
                          )}{' '}
                          {item.unit}
                        </td>
                        <td className="text-right text-blue font-bold">
                          {formatNumber(alreadyIssued)} {item.unit}
                        </td>
                        <td className="text-right">
                          {formatNumber(item.in_stock)} {item.unit}
                        </td>
                        <td className="text-right">
                          {item.kind === 'reusable'
                            ? `${formatNumber(totalOwned)} ${item.unit}`
                            : '—'}
                        </td>
                        <td>
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
                          <td className="text-right">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
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
      )}

      {/* TAB 2: XUẤT CHO DỰ ÁN */}
      {activeTab === 'issue' && !isStaff && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>📤 Xuất vật tư cho dự án</h3>
              <p className="text-xs text-muted">
                Xuất nhanh toàn bộ vật tư còn thiếu theo kế hoạch chỉ với 1 cú nhấp chuột, hoặc thêm
                dòng xuất lẻ bổ sung.
              </p>
            </div>
            {canEditCatalog && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleIssueByPlan}
                disabled={busyIssue}
              >
                ⚡ Xuất theo kế hoạch (1-Click)
              </button>
            )}
          </div>

          {canEditCatalog && (
            <form onSubmit={handleManualIssue} className="sub-card" style={{ marginTop: 12 }}>
              <h4>Xuất kho thủ công / Xuất bổ sung</h4>
              <div className="form-grid-2" style={{ marginTop: 10 }}>
                <div className="form-group">
                  <label>Ngày xuất kho *</label>
                  <input
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Ghi chú phiếu xuất</label>
                  <input
                    type="text"
                    placeholder="VD: Xuất đợt 1 lên xe tải..."
                    value={issueNote}
                    onChange={(e) => setIssueNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="table-responsive" style={{ marginTop: 10 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vật tư *</th>
                      <th style={{ width: 150 }}>Số lượng xuất *</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {issueLines.map((line, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            required
                            value={line.item_id}
                            onChange={(e) => {
                              const val = e.target.value
                              setIssueLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, item_id: val } : l))
                              )
                            }}
                          >
                            <option value="">-- Chọn vật tư --</option>
                            {items
                              .filter((i) => i.active)
                              .map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.code ? `[${i.code}] ` : ''}
                                  {i.name} (Trong kho: {formatNumber(i.in_stock)} {i.unit})
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            required
                            value={line.qty}
                            onChange={(e) => {
                              const val = e.target.value
                              setIssueLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, qty: val } : l))
                              )
                            }}
                          />
                        </td>
                        <td className="text-right">
                          {issueLines.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() =>
                                setIssueLines((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 12,
                }}
              >
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIssueLines((prev) => [...prev, { item_id: '', qty: 1 }])}
                >
                  + Thêm dòng
                </button>
                <button type="submit" className="btn btn-primary" disabled={busyIssue}>
                  {busyIssue ? 'Đang xử lý...' : 'Lưu phiếu xuất dự án'}
                </button>
              </div>
            </form>
          )}

          {/* Danh sách phiếu đã xuất của dự án */}
          <h4 style={{ marginTop: 24, marginBottom: 10 }}>
            Lịch sử phiếu kho của dự án ({movements.length})
          </h4>
          {movements.length === 0 ? (
            <div className="empty-state">Chưa có phiếu xuất/thu hồi nào cho dự án này.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Loại phiếu</th>
                    <th>Vật tư</th>
                    <th className="text-right">Số lượng</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDate(m.moved_at)}</td>
                      <td>
                        <MovementTypeBadge type={m.type} />
                      </td>
                      <td className="font-bold">{m.item?.name || `#${m.item_id}`}</td>
                      <td className="text-right font-bold">
                        {formatNumber(m.qty)} {m.item?.unit || ''}
                      </td>
                      <td>{m.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: THU HỒI VẬT TƯ */}
      {activeTab === 'return' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>📥 Thu hồi vật tư sau sự kiện</h3>
              <p className="text-xs text-muted">
                Với <strong>Đồ tái sử dụng</strong>: nhập SL thu về Tốt, Hỏng (chuyển sang chờ sửa)
                hoặc Mất. Với <strong>Vật tư tiêu hao</strong>: nhập SL dư không dùng hết trả lại kho.
              </p>
            </div>
            <button type="button" className="btn btn-outline" onClick={handleFillAllGood}>
              ✓ Điền nhanh: Thu hồi tốt 100% đồ tái sử dụng
            </button>
          </div>

          {itemStats.length === 0 ? (
            <div className="empty-state">
              Dự án này chưa có vật tư nào được xuất kho nên chưa thể thu hồi.
            </div>
          ) : (
            <form onSubmit={handleSubmitReturns}>
              <div className="form-grid-2" style={{ marginBottom: 14 }}>
                <div className="form-group">
                  <label>Ngày thu hồi *</label>
                  <input
                    type="date"
                    required
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Ghi chú đợt thu hồi</label>
                  <input
                    type="text"
                    placeholder="VD: Thu hồi sau tháo dỡ ca đêm..."
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      <th>Loại</th>
                      <th className="text-right">Đã xuất</th>
                      <th className="text-right">Đã thu (Tốt/Hỏng/Mất)</th>
                      <th className="text-right">Đang còn ở dự án</th>
                      <th style={{ width: 130 }}>SL Tốt / Dư trả kho</th>
                      <th style={{ width: 120 }}>SL Hỏng (chờ sửa)</th>
                      <th style={{ width: 120 }}>SL Mất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemStats.map((row) => {
                      const isReusable = row.item.kind === 'reusable'
                      const inp = returnInputs[row.item_id] || {
                        good: '',
                        damaged: '',
                        lost: '',
                      }
                      return (
                        <tr key={row.item_id}>
                          <td>
                            <div className="font-bold">{row.item.name}</div>
                            <div className="text-xs text-muted">
                              {row.item.code || `#${row.item_id}`} • ĐVT: {row.item.unit}
                            </div>
                          </td>
                          <td>
                            <KindBadge kind={row.item.kind} />
                          </td>
                          <td className="text-right font-bold">{formatNumber(row.issued)}</td>
                          <td className="text-right">
                            <span className="text-green">{formatNumber(row.return_good)}</span> /{' '}
                            <span className="text-amber">{formatNumber(row.return_damaged)}</span> /{' '}
                            <span className="text-red">{formatNumber(row.return_lost)}</span>
                          </td>
                          <td className="text-right font-bold text-blue">
                            {isReusable
                              ? `${formatNumber(row.outstanding)} ${row.item.unit}`
                              : `Đã dùng: ${formatNumber(row.netConsumed)}`}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              placeholder={isReusable ? 'SL tốt' : 'SL dư'}
                              value={inp.good}
                              onChange={(e) =>
                                handleReturnInputChange(row.item_id, 'good', e.target.value)
                              }
                            />
                          </td>
                          <td>
                            {isReusable ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="SL hỏng"
                                value={inp.damaged}
                                onChange={(e) =>
                                  handleReturnInputChange(row.item_id, 'damaged', e.target.value)
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                          <td>
                            {isReusable ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="SL mất"
                                value={inp.lost}
                                onChange={(e) =>
                                  handleReturnInputChange(row.item_id, 'lost', e.target.value)
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={busyReturn}>
                  {busyReturn ? 'Đang lưu phiếu thu hồi...' : 'Xác nhận thu hồi vật tư'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 4: CHI PHÍ KHÁC XOAY VÒNG TẠI ĐÁM (Admin/Manager) */}
      {activeTab === 'costs' && isManagerOrAdmin && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>💸 Chi phí xoay vòng trực tiếp tại dự án (Nhân công, vận chuyển, hoa tươi...)</h3>
              <p className="text-xs text-muted">
                🔒 Chỉ hiển thị cho Quản lý & Quản trị. Lưu ý: Chi phí cứng cố định hàng tháng & Chi
                phí Ads được hạch toán riêng tại Trung tâm P&L để không trùng luồng.
              </p>
            </div>
            <Link to="/bao-cao?tab=pnl" className="btn btn-outline btn-sm">
              🏛️ Mở P&L Chi phí cứng & Ads
            </Link>
          </div>

          <form onSubmit={handleAddCost} className="sub-card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className="text-xs text-muted">Chọn nhanh khoản mục xoay vòng tại đám:</span>
              {['Nhân công', 'Vận chuyển', 'Hoa tươi', 'Thuê ngoài / Phụ kiện'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{
                    padding: '3px 9px',
                    fontSize: 12,
                    borderColor: costKind === preset ? '#163828' : undefined,
                    fontWeight: costKind === preset ? 700 : 500,
                  }}
                  onClick={() => setCostKind(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="form-grid-4">
              <div className="form-group">
                <label>Khoản mục chi phí *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Nhân công, Vận chuyển, Hoa tươi..."
                  value={costKind}
                  onChange={(e) => setCostKind(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Số tiền (₫) *</label>
                <CurrencyInput
                  required
                  placeholder="VD: 1.500.000"
                  value={costAmount}
                  onChange={(num) => setCostAmount(num)}
                />
              </div>
              <div className="form-group">
                <label>Ngày chi *</label>
                <input
                  type="date"
                  required
                  value={costDate}
                  onChange={(e) => setCostDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <input
                  type="text"
                  placeholder="Chi tiết người nhận, chuyến xe..."
                  value={costNote}
                  onChange={(e) => setCostNote(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={busyCost}>
                {busyCost ? 'Đang lưu...' : '+ Thêm chi phí'}
              </button>
            </div>
          </form>

          {otherCosts.length === 0 ? (
            <div className="empty-state">Chưa ghi nhận khoản chi phí khác nào cho dự án này.</div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Khoản mục</th>
                    <th>Ghi chú</th>
                    <th className="text-right">Số tiền</th>
                    <th className="text-right">Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {otherCosts.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDate(c.cost_date)}</td>
                      <td className="font-bold">{c.kind}</td>
                      <td>{c.note || '—'}</td>
                      <td className="text-right font-bold">{formatCurrency(c.amount)}</td>
                      <td className="text-right">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleDeleteCost(c.id)}
                        >
                          Xóa
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: TỔNG KẾT & LÃI/LỖ (Admin/Manager) */}
      {activeTab === 'summary' && isManagerOrAdmin && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>📊 Quyết toán Tổng kết Dự án</h3>
              <p className="text-xs text-muted">
                Lợi nhuận = Doanh thu − (Tiêu hao thực tế + Khấu hao đồ tái sử dụng + Giá
                trị hỏng/mất + Chi phí khác)
              </p>
            </div>
            <button className="btn btn-outline" onClick={handleExportProjectSummary}>
              📥 Xuất quyết toán Excel
            </button>
          </div>

          {financialSummary.missingExpectedUsesItems.length > 0 && (
            <div className="alert alert-warning">
              💡 <strong>Gợi ý:</strong> Các đồ tái sử dụng sau chưa được thiết lập{' '}
              <em>"Số lần sử dụng dự kiến (expected_uses)"</em> nên khấu hao đang tạm tính bằng 0 ₫:{' '}
              <strong>{financialSummary.missingExpectedUsesItems.join(', ')}</strong>. Bạn có thể
              cập nhật trong mục Danh mục Vật tư.
            </div>
          )}

          {project.status === 'cancelled' && (
            <div className="alert alert-warning">
              ⚠️ <strong>Dự án đã hủy:</strong> trong Báo cáo P&L doanh thu tính 0; các chi phí đã
              phát sinh được tính vào tháng hủy
              {project.cancelled_at ? ` (${String(project.cancelled_at).slice(0, 7)})` : ''}. Số
              liệu bên dưới là theo giá trị hợp đồng; P&L tính doanh thu 0 cho dự án hủy.
            </div>
          )}

          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi-card">
              <div className="kpi-label">Doanh số (giá gói)</div>
              <div className="kpi-value">{formatCurrency(financialSummary.grossSales)}</div>
              <div className="kpi-sub">Giá gói gốc trước ưu đãi</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Ưu đãi</div>
              {financialSummary.discount > 0 ? (
                <>
                  <div className="kpi-value text-red">
                    − {formatCurrency(financialSummary.discount)}
                  </div>
                  <div className="kpi-sub">
                    {((financialSummary.discount / financialSummary.grossSales) * 100).toFixed(1)}%
                    trên doanh số
                  </div>
                </>
              ) : (
                <div className="kpi-sub">Không có ưu đãi</div>
              )}
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Doanh thu (khách thực trả)</div>
              <div className="kpi-value text-green">
                {formatCurrency(financialSummary.contractValue)}
              </div>
              <div className="kpi-sub">= Doanh số − Ưu đãi</div>
            </div>
          </div>

          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-label">Doanh thu (khách thực trả)</div>
              <div className="kpi-value text-green">
                {formatCurrency(financialSummary.contractValue)}
              </div>
              <div className="kpi-sub">
                {financialSummary.discount > 0 ? '= Doanh số − Ưu đãi' : 'Doanh thu dự án'}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Chi phí vật tư tiêu hao</div>
              <div className="kpi-value">{formatCurrency(financialSummary.consumableCost)}</div>
              <div className="kpi-sub">(SL xuất − SL dư trả kho) × Giá vốn</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Khấu hao đồ tái sử dụng</div>
              <div className="kpi-value">{formatCurrency(financialSummary.depreciationCost)}</div>
              <div className="kpi-sub">SL xuất × Giá vốn / Số lần dùng dự kiến</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Thiệt hại hỏng & mất</div>
              <div className="kpi-value text-red">
                {formatCurrency(financialSummary.damagedLostCost)}
              </div>
              <div className="kpi-sub">(SL hỏng + SL mất) × Giá vốn</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Chi phí xoay vòng khác</div>
              <div className="kpi-value">{formatCurrency(financialSummary.otherCostTotal)}</div>
              <div className="kpi-sub">{otherCosts.length} khoản nhân công/vận chuyển/hoa</div>
            </div>

            <div
              className={`kpi-card ${
                financialSummary.profit >= 0 ? 'kpi-success' : 'kpi-danger'
              }`}
            >
              <div className="kpi-label">Lãi gộp thi công dự án</div>
              <div
                className={`kpi-value ${
                  financialSummary.profit >= 0 ? 'text-green' : 'text-red'
                }`}
              >
                {formatCurrency(financialSummary.profit)}
              </div>
              <div className="kpi-sub">
                Tổng chi phí: {formatCurrency(financialSummary.totalCost)}
              </div>
              <div
                className={`kpi-sub ${
                  financialSummary.contractValue > 0
                    ? financialSummary.profit >= 0
                      ? 'text-green'
                      : 'text-red'
                    : ''
                }`}
              >
                Biên lợi nhuận:{' '}
                {financialSummary.contractValue > 0
                  ? `${financialSummary.marginPct.toFixed(1)}%`
                  : '—'}
              </div>
            </div>
          </div>

          <h4>Chi tiết chi phí từng vật tư trong dự án</h4>
          {financialSummary.itemBreakdown.length === 0 ? (
            <div className="empty-state">Chưa có vật tư xuất kho cho dự án này.</div>
          ) : (
            <div className="table-responsive" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vật tư</th>
                    <th>Loại</th>
                    <th className="text-right">Đã xuất</th>
                    <th className="text-right">Thu tốt / Dư</th>
                    <th className="text-right">Hỏng + Mất</th>
                    <th className="text-right">Giá vốn</th>
                    <th className="text-right">Tiêu hao</th>
                    <th className="text-right">Khấu hao</th>
                    <th className="text-right">Hỏng & Mất</th>
                  </tr>
                </thead>
                <tbody>
                  {financialSummary.itemBreakdown.map((r) => (
                    <tr key={r.item_id}>
                      <td>
                        <div className="font-bold">{r.item.name}</div>
                        {r.missingExpectedUses && (
                          <div className="text-xs text-amber">
                            ⚠️ Chưa đặt số lần dùng dự kiến (khấu hao = 0)
                          </div>
                        )}
                      </td>
                      <td>
                        <KindBadge kind={r.item.kind} />
                      </td>
                      <td className="text-right">{formatNumber(r.issued)}</td>
                      <td className="text-right text-green">{formatNumber(r.return_good)}</td>
                      <td className="text-right text-red">
                        {formatNumber(r.return_damaged + r.return_lost)}
                      </td>
                      <td className="text-right">{formatCurrency(r.cost)}</td>
                      <td className="text-right">{formatCurrency(r.rowConsumable)}</td>
                      <td className="text-right">{formatCurrency(r.rowDepreciation)}</td>
                      <td className="text-right text-red">{formatCurrency(r.rowDamagedLost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ProjectAdvancesPanel projectId={projectId} contractValue={contractValue} canWrite={isManagerOrAdmin} projectStatus={project?.status} />
        </div>
      )}
    </div>
  )
}
