import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import {
  formatNumber,
  todayISO,
  PROJECT_STATUS_LABELS,
  KIND_LABELS,
} from '../../lib/formatters'
import {
  calcScheduleConflicts,
  calcProjectItemStats,
  calcProjectFinancialSummary,
} from '../../lib/calc'
import { fetchAllRows } from '../../lib/fetchAll'
import { checkIssueStock, validateReturnInputs } from '../../lib/movementRules'
import { exportToExcel } from '../../lib/exportExcel'
import { useConfirm } from '../ConfirmDialog'
import { extractProjectAttribution } from '../../lib/metaAdsClient'
import {
  issueBlockReason,
  outstandingReusable,
  statusChangeBlockReason,
  calcIssueByPlanLines,
  buildTemplateAddMap,
  planDuplicates,
  mergePlanRows,
} from '../../lib/projectRules'
import {
  loadStatusGuardData,
  rpcApplyTemplatesToPlan,
  rpcIssueProjectByPlan,
} from '../../lib/projectRulesApi'

// Báo nhẹ cho admin khi chưa chạy supabase/projects_phase2.sql (app dùng luồng cũ).
const PHASE2_MISSING_NOTE =
  'Chưa chạy supabase/projects_phase2.sql trên Supabase: thao tác vừa rồi dùng cách cũ (ghi từ trình duyệt, chưa khóa chống ghi trùng giữa hai máy).'
const PHASE2_ISSUE_MISSING_NOTE =
  'Chưa chạy supabase/projects_phase2.sql trên Supabase: "Xuất theo kế hoạch" đang dùng cách dự phòng (đọc lại số mới nhất rồi ghi từ trình duyệt). Hai máy bấm cùng lúc VẪN CÓ THỂ xuất trùng; hãy chạy file SQL để khóa ở DB.'

// Cột item_stock dùng trong trang này (không kéo image_url/note để nhẹ dữ liệu)
const ITEM_STOCK_COLUMNS = 'id, code, name, kind, unit, cost, expected_uses, active, in_stock, at_project'
const PROJECT_MOVE_TYPES = ['issue', 'return_good', 'return_damaged', 'return_lost']
const INITIAL_ISSUE_LINE = { key: 0, item_id: '', qty: 1 }

// Nguồn khách hiệu lực của dự án, cùng cách ProjectsPage mở form sửa:
// ưu tiên cột lead_source/warehouse_code; chưa có mới dùng suy luận cũ từ note.
function effectiveLeadSource(p) {
  if (!p) return 'unknown'
  const hasColumnAttr = (p.lead_source && p.lead_source !== 'unknown') || !!p.warehouse_code
  if (hasColumnAttr) return p.lead_source || 'unknown'
  const attr = extractProjectAttribution(p)
  return attr.isExplicit ? attr.source || 'unknown' : 'unknown'
}

export default function useProjectDetail(projectId) {
  const { isManagerOrAdmin, canEditCatalog, isStaff, isAdmin } = useAuth()
  const { confirm, choose, confirmDialog } = useConfirm()
  // Chặn bấm đúp: state busy chỉ có hiệu lực sau lần render kế tiếp, ref thì ngay lập tức.
  const statusBusyRef = useRef(false)
  const planBusyRef = useRef(false)
  const returnBusyRef = useRef(false)
  const issueBusyRef = useRef(false)

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
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState({})
  const loadRequest = useRef(0)
  const latestLoad = useRef({ id: 0, promise: null })

  const notify = useCallback((area, type, message) => {
    setFeedback((prev) => ({
      ...prev,
      [area]: { ...prev[area], [type]: message },
    }))
  }, [])

  // Đổi tab thì bỏ thông báo cũ: lỗi/thành công chỉ gắn với thao tác ở tab đang đứng.
  const clearFeedback = useCallback(() => setFeedback({}), [])

  // Tab 1: Kế hoạch vật tư
  const [planItemId, setPlanItemId] = useState('')
  const [planQty, setPlanQty] = useState(1)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [busyPlan, setBusyPlan] = useState(false)

  // Tab 2: Xuất cho dự án
  const [issueDate, setIssueDate] = useState(todayISO())
  const [issueNote, setIssueNote] = useState('')
  const [issueLines, setIssueLines] = useState([INITIAL_ISSUE_LINE])
  const nextIssueLineKey = useRef(1)
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

  // area = nơi vừa thao tác: có area nghĩa là làm mới nền, lỗi hiện tại chỗ đó.
  // Chỉ lượt tải đầu bật màn hình "Đang tải" (loading chỉ chuyển true -> false một lần).
  const loadAll = useCallback((area) => {
    const request = ++loadRequest.current
    // Lượt bị lượt mới hơn thay thế: chờ lượt mới nhất xong mới trả về, để thao tác đang giữ khóa
    // (ref/busy) không mở khóa khi màn hình còn số cũ.
    const waitLatest = () =>
      latestLoad.current.id !== request ? latestLoad.current.promise : undefined
    const run = async () => {
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
          finRes,
          costRes,
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
          canEditCatalog
            ? supabase
                .from('project_finance')
                .select(isManagerOrAdmin ? 'contract_value, discount' : 'contract_value')
                .eq('project_id', projectId)
                .maybeSingle()
            : null,
          isManagerOrAdmin
            ? supabase
                .from('project_costs')
                .select('*')
                .eq('project_id', projectId)
                .order('cost_date', { ascending: false })
            : null,
        ])

        // Chỉ kết quả của lần tải mới nhất được cập nhật vào màn hình.
        if (request !== loadRequest.current) return waitLatest()
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

        if (finRes && !finRes.error) {
          setContractValue(Number(finRes.data?.contract_value || 0))
          setQuoteDiscount(isManagerOrAdmin ? Number(finRes.data?.discount || 0) : 0)
        }
        if (costRes) {
          if (costRes.error) warnings.push('chi phí khác')
          setOtherCosts(costRes.data || [])
        }
        setDataWarnings(warnings)
        if (finRes?.error) throw finRes.error
        setLoadError('')
        if (area) notify(area, 'refreshError', '')
      } catch (err) {
        if (request !== loadRequest.current) return waitLatest()
        const message = err.message || 'Không thể tải dữ liệu dự án'
        if (area) notify(area, 'refreshError', `Không thể làm mới dữ liệu: ${message}`)
        else setLoadError(message)
      } finally {
        if (request === loadRequest.current) setLoading(false)
      }
    }
    const promise = run()
    latestLoad.current = { id: request, promise }
    return promise
  }, [projectId, canEditCatalog, isManagerOrAdmin, notify])

  useEffect(() => {
    loadAll()
    return () => { loadRequest.current += 1 }
  }, [loadAll])

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
    notify('status', 'error', '')
    notify('status', 'success', '')
    // Cùng yêu cầu như form sửa ở ProjectsPage
    if (
      newStatus !== 'quote' &&
      newStatus !== 'cancelled' &&
      effectiveLeadSource(project) === 'unknown'
    ) {
      notify('status', 'error',
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
    statusBusyRef.current = true
    setBusyStatus(true)
    try {
      // Chặn trước ở giao diện (DB cũng chặn bằng trigger khi đã chạy projects_phase2.sql):
      // sang Hoàn thành/Đã hủy khi còn đồ tái sử dụng; rời Đã hủy khi có Mất cọc / tháng hủy đã khóa.
      const guard = await loadStatusGuardData(project, newStatus)
      const block = statusChangeBlockReason({
        prevStatus: project.status,
        nextStatus: newStatus,
        projectName: project.name,
        ...guard,
      })
      if (block) {
        notify('status', 'error', block)
        return
      }
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
      notify('status', 'success', `Đã chuyển trạng thái dự án sang "${toLabel}"`)
      await loadAll('status')
    } catch (err) {
      notify('status', 'error', err.message || 'Không thể đổi trạng thái dự án')
    } finally {
      statusBusyRef.current = false
      setBusyStatus(false)
    }
  }

  // --- TAB 1: KẾ HOẠCH VẬT TƯ ---
  const handleAddPlanItem = async (e) => {
    e.preventDefault()
    notify('planItem', 'error', '')
    notify('planItem', 'success', '')
    if (Number(planQty) < 0) {
      notify('planItem', 'error', 'Số lượng không được là số âm.')
      return
    }
    if (!planItemId || Number(planQty) <= 0) {
      notify('planItem', 'error', 'Vui lòng chọn vật tư và nhập số lượng lớn hơn 0.')
      return
    }
    // Số mới = số đang hiện + số nhập, nên phải chờ dữ liệu mới nhất mới được ghi đè
    if (planBusyRef.current) return
    if (planLoadFailed) {
      notify('planItem', 'error', 'Chưa tải được kế hoạch hiện tại nên chưa thể thêm. Hãy tải lại trang.')
      return
    }
    planBusyRef.current = true
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
      notify('planItem', 'success', 'Đã thêm vật tư vào kế hoạch.')
      await loadAll('planItem')
    } catch (err) {
      notify('planItem', 'error', err.message || 'Lỗi khi thêm vật tư vào kế hoạch')
    } finally {
      planBusyRef.current = false
      setBusyPlan(false)
    }
  }

  const handleUpdatePlanQty = async (itemId, qty) => {
    const area = `planRow:${itemId}`
    const num = Number(qty)
    if (Number.isNaN(num) || num <= 0) {
      notify(area, 'success', '')
      notify(area, 'error',
        num < 0
          ? 'Số lượng kế hoạch không được là số âm.'
          : 'Số lượng kế hoạch phải lớn hơn 0.'
      )
      return
    }
    notify(area, 'error', '')
    notify(area, 'success', '')
    if (planBusyRef.current) {
      notify(area, 'error', 'Đang lưu thay đổi khác. Hãy nhập lại số lượng sau giây lát.')
      return
    }
    planBusyRef.current = true
    setBusyPlan(true)
    try {
      const { error: err } = await supabase
        .from('project_plan')
        .update({ qty: num })
        .eq('project_id', projectId)
        .eq('item_id', itemId)
      if (err) throw err
      notify(area, 'success', 'Đã cập nhật số lượng kế hoạch.')
      await loadAll(area)
    } catch (err) {
      notify(area, 'error', err.message || 'Không thể cập nhật số lượng kế hoạch')
    } finally {
      planBusyRef.current = false
      setBusyPlan(false)
    }
  }

  const handleRemovePlanItem = async (itemId) => {
    const area = `planRow:${itemId}`
    notify(area, 'error', '')
    notify(area, 'success', '')
    if (planBusyRef.current) {
      notify(area, 'error', 'Đang lưu thay đổi khác. Hãy bấm Xóa lại sau giây lát.')
      return
    }
    planBusyRef.current = true
    setBusyPlan(true)
    try {
      const { error: err } = await supabase
        .from('project_plan')
        .delete()
        .eq('project_id', projectId)
        .eq('item_id', itemId)
      if (err) throw err
      await loadAll(area)
    } catch (err) {
      notify(area, 'error', err.message || 'Không thể xóa dòng kế hoạch')
    } finally {
      planBusyRef.current = false
      setBusyPlan(false)
    }
  }

  // Nạp SL vật tư của các mẫu set vào kế hoạch. entries: [{ template_id, mult }].
  // Kế hoạch đã có vật tư trùng thì hỏi MỖI LẦN: Cộng thêm / Thay thế (chỉ thay số các vật tư có
  // trong mẫu, không xóa vật tư khác) / Hủy. Ghi nguyên tử bằng RPC apply_templates_to_plan;
  // chưa chạy SQL thì ghi upsert từ trình duyệt như cũ.
  // Trả { ok, count, mode } | { ok:false, cancelled:true } | { ok:false, error }.
  const addTemplatesToPlan = async (entries, area) => {
    if (planBusyRef.current) return { ok: false, cancelled: true }
    if (planLoadFailed) {
      return {
        ok: false,
        error: 'Không tải được kế hoạch vật tư hiện tại nên không thể nạp mẫu (tránh ghi sai số). Hãy tải lại trang.',
      }
    }
    const addMap = buildTemplateAddMap(templates, entries)
    if (addMap.size === 0) {
      return { ok: false, error: 'Các mẫu set đã chọn chưa có vật tư nào để nạp sang kế hoạch.' }
    }
    const existingMap = new Map()
    for (const p of projectPlan) existingMap.set(Number(p.item_id), Number(p.qty))

    planBusyRef.current = true
    setBusyPlan(true)
    try {
      let mode = 'add'
      const dup = planDuplicates(addMap, existingMap)
      if (dup.length > 0) {
        const list = dup.slice(0, 8).map((d) => {
          const it = itemMap.get(d.item_id)
          const unit = it?.unit || ''
          return `- ${it?.name || `Vật tư #${d.item_id}`}: đang có ${formatNumber(d.current)}, mẫu ${formatNumber(d.add)} → Cộng thêm = ${formatNumber(d.current + d.add)}, Thay thế = ${formatNumber(d.add)} ${unit}`.trim()
        })
        if (dup.length > 8) list.push(`- ... và ${dup.length - 8} vật tư khác`)
        const picked = await choose({
          title: 'Kế hoạch đã có vật tư trùng',
          message: `Kế hoạch đã có ${dup.length} vật tư trùng với mẫu set:\n${list.join('\n')}\n\n• Cộng thêm: cộng số của mẫu vào số đang có.\n• Thay thế: các vật tư có trong mẫu lấy đúng số của mẫu; vật tư khác trong kế hoạch giữ nguyên.`,
          choices: [
            { value: 'replace', label: 'Thay thế' },
            { value: 'add', label: 'Cộng thêm' },
          ],
          cancelLabel: 'Hủy',
        })
        if (!picked) return { ok: false, cancelled: true }
        mode = picked
      }

      let count = addMap.size
      const rpc = await rpcApplyTemplatesToPlan(projectId, entries, mode)
      if (rpc.missingSchema) {
        if (isAdmin) notify(area, 'note', PHASE2_MISSING_NOTE)
        const rows = mergePlanRows({ projectId, addMap, existingMap, mode })
        const { error: err } = await supabase
          .from('project_plan')
          .upsert(rows, { onConflict: 'project_id,item_id' })
        if (err) return { ok: false, error: err.message || 'Lỗi khi ghi kế hoạch vật tư.' }
        count = rows.length
      } else if (rpc.error) {
        return { ok: false, error: rpc.error.message || 'Lỗi khi ghi kế hoạch vật tư.' }
      } else {
        count = Number(rpc.data?.count ?? count)
      }
      await loadAll(area)
      return { ok: true, count, mode }
    } catch (err) {
      return { ok: false, error: err?.message || 'Lỗi khi ghi kế hoạch vật tư.' }
    } finally {
      planBusyRef.current = false
      setBusyPlan(false)
    }
  }

  // Gọi từ tab Báo giá: tab tự hiện kết quả (thành công/lỗi) theo giá trị trả về.
  const handleApplyQuoteSetsToPlan = async (templateEntries = []) => {
    return addTemplatesToPlan(templateEntries, 'quote')
  }

  const handleApplyTemplate = async () => {
    if (planBusyRef.current) return
    notify('planTemplate', 'error', '')
    notify('planTemplate', 'success', '')
    if (!selectedTemplateId) {
      notify('planTemplate', 'error', 'Vui lòng chọn một mẫu set trang trí để áp dụng.')
      return
    }
    const tpl = templates.find((t) => String(t.id) === String(selectedTemplateId))
    if (!tpl || !tpl.items || tpl.items.length === 0) {
      notify('planTemplate', 'error', 'Mẫu set này chưa có vật tư nào.')
      return
    }
    const res = await addTemplatesToPlan([{ template_id: tpl.id, mult: 1 }], 'planTemplate')
    if (res.ok) {
      notify('planTemplate', 'success',
        `Đã ${res.mode === 'replace' ? 'thay số lượng theo' : 'áp dụng'} mẫu set "${tpl.name}" (${res.count} vật tư) vào kế hoạch!`
      )
      setSelectedTemplateId('')
    } else if (!res.cancelled) {
      notify('planTemplate', 'error', res.error || 'Lỗi khi áp dụng mẫu set')
    }
  }

  // --- TAB 2: XUẤT CHO DỰ ÁN ---
  const handleAddIssueLine = () => {
    const key = nextIssueLineKey.current++
    notify('issueManual', 'success', '')
    setIssueLines((prev) => [...prev, { ...INITIAL_ISSUE_LINE, key }])
  }

  const handleIssueLineChange = (key, patch) => {
    notify('issueManual', 'success', '')
    setIssueLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const handleRemoveIssueLine = (key) => {
    setIssueLines((prev) => prev.filter((line) => line.key !== key))
  }

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
    // ref giữ suốt cả lượt (RPC + luồng dự phòng): chặn bấm đúp ngay cả khi state chưa kịp cập nhật
    if (issueBusyRef.current) return
    notify('issueByPlan', 'error', '')
    notify('issueByPlan', 'success', '')
    const blockMsg = issueBlockReason(project, { canChangeStatus: isManagerOrAdmin })
    if (blockMsg) {
      notify('issueByPlan', 'error', blockMsg)
      return
    }
    issueBusyRef.current = true
    setBusyIssue(true)
    try {
      // RPC issue_project_by_plan: tính phần còn thiếu và ghi trong một giao dịch có khóa ở DB.
      const rpc = await rpcIssueProjectByPlan(projectId, issueDate || todayISO(), issueNote.trim())
      if (!rpc.missingSchema) {
        if (rpc.error) {
          notify('issueByPlan', 'error', rpc.error.message || 'Lỗi khi xuất theo kế hoạch')
          return
        }
        const n = Number(rpc.data?.count || 0)
        if (n === 0) {
          notify('issueByPlan', 'error', 'Tất cả vật tư trong kế hoạch đã được xuất đủ số lượng.')
        } else {
          notify('issueByPlan', 'success', `Đã xuất kho tự động ${n} dòng vật tư theo kế hoạch!`)
        }
        await loadAll('issueByPlan')
        return
      }
      if (isAdmin) notify('issueByPlan', 'note', PHASE2_ISSUE_MISSING_NOTE)
      await issueByPlanLegacy()
    } catch (err) {
      notify('issueByPlan', 'error', err.message || 'Lỗi khi xuất theo kế hoạch')
    } finally {
      issueBusyRef.current = false
      setBusyIssue(false)
    }
  }

  // Luồng dự phòng (chưa chạy SQL): đọc LẠI kế hoạch + phiếu kho mới nhất từ DB ngay trước khi tính
  // "còn thiếu" và ghi (không dùng số đã tải lúc mở trang). Vẫn không khóa giữa hai máy.
  const issueByPlanLegacy = async () => {
    const [planRes, movesRes] = await Promise.all([
      supabase.from('project_plan').select('item_id, qty').eq('project_id', projectId).order('item_id'),
      fetchAllRows((from, to) =>
        supabase
          .from('stock_movements')
          .select('id, item_id, type, qty')
          .eq('project_id', projectId)
          .in('type', PROJECT_MOVE_TYPES)
          .order('id')
          .range(from, to)
      ),
    ])
    if (planRes.error) {
      notify('issueByPlan', 'error', `Không tải được kế hoạch vật tư mới nhất nên chưa xuất (tránh xuất sai): ${planRes.error.message}`)
      return
    }
    if (movesRes.error) {
      notify('issueByPlan', 'error', `Không tải được phiếu kho mới nhất của dự án nên chưa xuất (tránh xuất trùng): ${movesRes.error.message}`)
      return
    }
    const freshPlan = planRes.data || []
    if (freshPlan.length === 0) {
      notify('issueByPlan', 'error', 'Kế hoạch vật tư đang trống. Hãy lập kế hoạch trước hoặc xuất thủ công.')
      return
    }

    // Còn thiếu = kế hoạch − đang ở dự án (đồ tái sử dụng) / − đã xuất (tiêu hao), cùng quy tắc RPC.
    const toIssue = calcIssueByPlanLines(freshPlan, movesRes.data || [], itemMap).map((l) => ({
      moved_at: issueDate || todayISO(),
      type: 'issue',
      item_id: l.item_id,
      project_id: projectId,
      qty: l.qty,
      note: issueNote.trim() || 'Xuất theo kế hoạch dự án',
    }))
    if (toIssue.length === 0) {
      notify('issueByPlan', 'error', 'Tất cả vật tư trong kế hoạch đã được xuất đủ số lượng.')
      await loadAll('issueByPlan')
      return
    }

    const { map, error: stockErr } = await fetchFreshStock(toIssue.map((r) => r.item_id))
    if (stockErr) throw stockErr
    const check = checkIssueStock(toIssue, map)
    if (!check.ok) {
      notify('issueByPlan', 'error', check.error)
      return
    }
    // Sắp theo item_id: khóa dòng vật tư ở DB luôn theo cùng thứ tự, tránh deadlock khi 2 người xuất cùng lúc
    toIssue.sort((a, b) => a.item_id - b.item_id)
    const { error: err } = await supabase.from('stock_movements').insert(toIssue)
    if (err) throw err
    notify('issueByPlan', 'success', `Đã xuất kho tự động ${toIssue.length} dòng vật tư theo kế hoạch!`)
    await loadAll('issueByPlan')
  }

  const handleManualIssue = async (e) => {
    e.preventDefault()
    if (issueBusyRef.current) return
    notify('issueManual', 'error', '')
    notify('issueManual', 'success', '')
    const blockMsg = issueBlockReason(project, { canChangeStatus: isManagerOrAdmin })
    if (blockMsg) {
      notify('issueManual', 'error', blockMsg)
      return
    }
    if (issueLines.some((l) => Number(l.qty) < 0)) {
      notify('issueManual', 'error', 'Số lượng xuất không được là số âm. Vui lòng kiểm tra lại các dòng vật tư.')
      return
    }
    const valid = issueLines.filter((l) => l.item_id && Number(l.qty) > 0)
    if (valid.length === 0) {
      notify('issueManual', 'error', 'Vui lòng chọn ít nhất 1 vật tư và nhập số lượng > 0.')
      return
    }
    // ItemPicker không có kiểm tra "required" của trình duyệt như ô chọn cũ: không lặng lẽ bỏ dòng.
    if (valid.length !== issueLines.length) {
      notify('issueManual', 'error', 'Còn dòng chưa chọn vật tư hoặc chưa nhập số lượng. Hãy điền đủ hoặc bỏ dòng đó.')
      return
    }

    issueBusyRef.current = true
    setBusyIssue(true)
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
        notify('issueManual', 'error', check.error)
        return
      }
      // Sắp theo item_id như xuất theo kế hoạch: khóa dòng vật tư ở DB cùng thứ tự, tránh deadlock
      rows.sort((a, b) => a.item_id - b.item_id)
      const { error: err } = await supabase.from('stock_movements').insert(rows)
      if (err) throw err
      notify('issueManual', 'success', `Đã lập phiếu xuất ${rows.length} dòng vật tư cho dự án!`)
      setIssueLines([INITIAL_ISSUE_LINE])
      setIssueNote('')
      await loadAll('issueManual')
    } catch (err) {
      notify('issueManual', 'error', err.message || 'Lỗi khi xuất vật tư cho dự án')
    } finally {
      issueBusyRef.current = false
      setBusyIssue(false)
    }
  }

  // --- TAB 3: THU HỒI ---
  const handleReturnInputChange = (itemId, field, value) => {
    notify('returns', 'success', '')
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
    notify('returns', 'error', '')
    notify('returns', 'success', '')

    // ref chặn được bấm đúp ngay cả khi state chưa kịp cập nhật
    if (returnBusyRef.current) return
    if (movesLoadFailed) {
      notify('returns', 'error', 'Không tải được phiếu kho của dự án nên không biết còn bao nhiêu đồ ở dự án. Hãy tải lại trang trước khi thu hồi.')
      return
    }
    const check = validateReturnInputs(itemStats, returnInputs)
    if (!check.ok) {
      notify('returns', 'error', check.error)
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
      notify('returns', 'success', `Đã ghi nhận ${rowsToInsert.length} dòng phiếu thu hồi vật tư!`)
      setReturnInputs({})
      setReturnNote('')
      await loadAll('returns')
    } catch (err) {
      notify('returns', 'error', err.message || 'Lỗi khi ghi nhận thu hồi vật tư')
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
      notify('costForm', 'success', '')
      notify('costForm', 'error', 'Vui lòng nhập khoản mục chi phí.')
      return
    }
    const amount = Number(costAmount)
    if (!costAmount || !Number.isFinite(amount) || amount <= 0) {
      notify('costForm', 'success', '')
      notify('costForm', 'error',
        amount < 0
          ? 'Số tiền chi phí không được là số âm.'
          : 'Vui lòng nhập số tiền chi phí lớn hơn 0.'
      )
      return
    }
    setBusyCost(true)
    notify('costForm', 'error', '')
    notify('costForm', 'success', '')
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
      notify('costForm', 'success', 'Đã thêm khoản chi phí khác!')
      await loadAll('costForm')
    } catch (err) {
      notify('costForm', 'error', err.message || 'Lỗi khi thêm chi phí khác')
    } finally {
      setBusyCost(false)
    }
  }

  const handleDeleteCost = async (costId) => {
    if (!window.confirm('Xóa khoản chi phí này?')) return
    const area = `costRow:${costId}`
    notify(area, 'error', '')
    notify('costRows', 'success', '')
    try {
      const { error: err } = await supabase.from('project_costs').delete().eq('id', costId)
      if (err) throw err
      notify('costRows', 'success', 'Đã xóa khoản chi phí.')
      await loadAll('costRows')
    } catch (err) {
      notify(area, 'error', err.message || 'Không thể xóa chi phí')
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

  const pendingReusableCount = movesLoadFailed ? 0 : outstandingReusable(movements, itemMap).length
  const shortageConflictsCount = projectPlan.filter((p) => conflicts[p.item_id]?.hasShortage).length
  const issueBlock = issueBlockReason(project, { canChangeStatus: isManagerOrAdmin })

  return {
    loading, loadError, dataWarnings, project, templates, movements, movesLoadFailed,
    canEditCatalog, isManagerOrAdmin, isStaff, confirmDialog, loadAll, feedback, clearFeedback,
    contractValue, quoteDiscount, setContractValue, setQuoteDiscount, shortageConflictsCount,
    overview: { members, busyStatus, pendingReusableCount, handleStatusChange },
    plan: {
      items, projectPlan, conflicts, conflictLimited, issuedByItemMap,
      selectedTemplateId, setSelectedTemplateId, planItemId, setPlanItemId, planQty, setPlanQty,
      busyPlan, handleApplyTemplate, handleAddPlanItem, handleUpdatePlanQty, handleRemovePlanItem,
    },
    issue: {
      items, issueBlock, issueDate, setIssueDate, issueNote, setIssueNote, issueLines,
      busyIssue, handleIssueByPlan, handleManualIssue, handleAddIssueLine, handleIssueLineChange,
      handleRemoveIssueLine,
    },
    returns: {
      itemStats, movesLoadFailed, returnInputs, returnDate, setReturnDate, returnNote, setReturnNote, busyReturn,
      handleFillAllGood, handleSubmitReturns, handleReturnInputChange,
    },
    costs: {
      costKind, setCostKind, costAmount, setCostAmount, costDate, setCostDate, costNote, setCostNote,
      busyCost, otherCosts, handleAddCost, handleDeleteCost,
    },
    summary: { financialSummary, otherCosts, handleExportProjectSummary },
    handleApplyQuoteSetsToPlan,
  }
}
