import { useEffect, useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatDate,
  PROJECT_STATUS_LABELS,
  generateProjectCode,
  findDuplicateCode,
  todayISO,
} from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { ProjectStatusBadge } from '../components/Badges'
import ContractValueFields from '../components/ContractValueFields'
import { useConfirm } from '../components/ConfirmDialog'
import { saveProjectFinance, getProjectFinance } from '../lib/financeApi'
import { fetchAllRows } from '../lib/fetchAll'
import { calcProjectClosure, deleteBlockMessage } from '../lib/projectArchive'
import { calcProjectFbReminder } from '../lib/watermarkHelper'
import { statusChangeBlockReason } from '../lib/projectRules'
import { loadStatusGuardData } from '../lib/projectRulesApi'
import {
  mergeNoteKeepingFbMeta,
  diffMembers,
  statusChangeWarning,
  cleanProjectNote,
  financeEditAccess,
} from '../lib/projectForm'
import {
  WAREHOUSE_HUBS,
  PROJECT_LEAD_SOURCES,
  extractProjectAttribution,
  stripProjectAttributionFromNote,
} from '../lib/metaAdsClient'

const INITIAL_PROJECT_FORM = {
  code: '',
  name: '',
  customer_id: '',
  location: '',
  start_date: '',
  end_date: '',
  lead_id: '',
  status: 'quote',
  contract_value: 0, // doanh thu = doanh số - ưu đãi
  gross_sales: 0,
  discount: 0,
  member_ids: [],
  lead_source: 'unknown',
  warehouse_hub: 'xuan_loc',
  note: '',
}

const LEAD_SOURCE_OPTIONS = [{ id: 'unknown', label: 'Chưa xác định' }, ...PROJECT_LEAD_SOURCES]

export default function ProjectsPage() {
  const { isManagerOrAdmin, canEditCatalog, isAdmin } = useAuth()
  const [projects, setProjects] = useState([])
  const [customers, setCustomers] = useState([])
  const [profiles, setProfiles] = useState([])
  const [financesMap, setFinancesMap] = useState(new Map())
  const [discountsMap, setDiscountsMap] = useState(new Map())
  const [financeValid, setFinanceValid] = useState(true)
  const [financeOk, setFinanceOk] = useState(false) // true khi tải được project_finance
  const [membersMap, setMembersMap] = useState(new Map())
  const [membersOk, setMembersOk] = useState(false) // true khi tải được project_members
  const [loadWarning, setLoadWarning] = useState('') // lỗi tải phụ, tách khỏi error để không bị thông báo khác xóa mất
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { confirm, confirmDialog } = useConfirm()

  // Bộ lọc
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // Gợi ý lưu trữ
  const [suggested, setSuggested] = useState([])
  const [suggestNote, setSuggestNote] = useState('')
  const [suggestDismissed, setSuggestDismissed] = useState(false)

  // Modal tạo / sửa dự án
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [form, setForm] = useState(INITIAL_PROJECT_FORM)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [financeDirty, setFinanceDirty] = useState(false)
  const [financeAccess, setFinanceAccess] = useState('ready') // 'ready' | 'verify' | 'locked'
  // Đội thi công lúc mở form (mốc so sánh khi lưu); null = chưa tải được nên khóa, không ghi
  const [memberBaseline, setMemberBaseline] = useState([])
  const savingRef = useRef(false) // chặn bấm đúp Lưu trước khi nút kịp bị khóa
  const modalErrorRef = useRef(null)
  const [saveAttempt, setSaveAttempt] = useState(0)

  // Cuộn tới lỗi mỗi lần bấm Lưu; canh giữa để không bị thanh nút dính đáy che trên điện thoại
  useEffect(() => {
    if (modalError) modalErrorRef.current?.scrollIntoView({ block: 'center' })
  }, [modalError, saveAttempt])

  const loadData = async () => {
    setLoading(true)
    setError('')
    setLoadWarning('')
    setFinanceOk(false)
    try {
      // fetchAllRows: phân trang vượt giới hạn 1000 dòng, luôn kèm thứ tự ổn định
      const [projRes, custRes, profRes, memRes] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from('projects')
            .select('*, customer:partners(id, name, phone), lead:profiles!projects_lead_id_fkey(id, full_name, email)')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase
            .from('partners')
            .select('*')
            .eq('kind', 'customer')
            .order('name')
            .order('id')
            .range(from, to)
        ),
        supabase.from('profiles').select('*').neq('role', 'pending').order('full_name'),
        fetchAllRows((from, to) =>
          supabase
            .from('project_members')
            .select('project_id, user_id')
            .order('project_id')
            .order('user_id')
            .range(from, to)
        ),
      ])

      // Tải phụ bị lỗi: giữ dữ liệu cũ (nếu có) và báo rõ
      const warnings = []
      if (custRes.error) warnings.push(`Không tải được danh sách khách hàng: ${custRes.error.message}`)
      else setCustomers(custRes.data || [])
      if (profRes.error) warnings.push(`Không tải được danh sách hồ sơ nhân sự: ${profRes.error.message}`)
      else setProfiles(profRes.data || [])
      if (memRes.error) {
        warnings.push(`Không tải được đội thi công (tạm khóa sửa thành viên): ${memRes.error.message}`)
        setMembersOk(false)
      } else {
        const mMap = new Map()
        for (const m of memRes.data || []) {
          if (!mMap.has(m.project_id)) mMap.set(m.project_id, [])
          mMap.get(m.project_id).push(m.user_id)
        }
        setMembersMap(mMap)
        setMembersOk(true)
      }
      setLoadWarning(warnings.join('. '))

      if (projRes.error) throw projRes.error
      setProjects(projRes.data || [])

      if (canEditCatalog) {
        // Chỉ Admin/Manager mới đọc cột ưu đãi; Thủ kho chỉ lấy doanh thu
        const finRes = await fetchAllRows((from, to) =>
          supabase
            .from('project_finance')
            .select(isManagerOrAdmin ? 'project_id, contract_value, discount' : 'project_id, contract_value')
            .order('project_id')
            .range(from, to)
        )
        if (finRes.error) {
          warnings.push(`Không tải được giá trị hợp đồng (tạm khóa sửa tiền): ${finRes.error.message}`)
          setLoadWarning(warnings.join('. '))
        } else {
          const fMap = new Map()
          const dMap = new Map()
          for (const f of finRes.data || []) {
            fMap.set(Number(f.project_id), Number(f.contract_value || 0))
            if (isManagerOrAdmin) dMap.set(Number(f.project_id), Number(f.discount || 0))
          }
          setFinancesMap(fMap)
          setDiscountsMap(dMap)
          setFinanceOk(true)
        }
      }
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách dự án')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [canEditCatalog, isManagerOrAdmin])

  // Gợi ý lưu trữ: chỉ tải dữ liệu khi có dự án hủy chưa lưu trữ; lỗi chỉ ghi chú nhỏ.
  useEffect(() => {
    if (!isManagerOrAdmin) return undefined
    const cand = projects.filter((p) => p.status === 'cancelled' && !p.archived_at)
    if (cand.length === 0) {
      setSuggested([])
      setSuggestNote('')
      return undefined
    }
    let cancelled = false
    computeClosures(cand)
      .then((list) => {
        if (cancelled) return
        setSuggested(list.filter((x) => x.closure.suggestArchive).map((x) => x.project))
        setSuggestNote('')
      })
      .catch((err) => {
        if (cancelled) return
        setSuggested([])
        setSuggestNote(`Không tải được gợi ý lưu trữ: ${err.message || 'lỗi không rõ'}`)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, isManagerOrAdmin])

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (!showArchived && p.archived_at) return false
      if (filterStatus !== 'all' && p.status !== filterStatus) return false
      if (filterFrom && (p.start_date || '') < filterFrom) return false
      if (filterTo && (p.start_date || '') > filterTo) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = p.name?.toLowerCase().includes(q)
        const matchCode = p.code?.toLowerCase().includes(q)
        const matchLoc = p.location?.toLowerCase().includes(q)
        const matchCust = p.customer?.name?.toLowerCase().includes(q)
        if (!matchName && !matchCode && !matchLoc && !matchCust) return false
      }
      return true
    })
  }, [projects, filterStatus, filterFrom, filterTo, search, showArchived])

  const hiddenArchivedCount = useMemo(
    () => projects.filter((p) => p.archived_at).length,
    [projects]
  )

  const openCreateModal = () => {
    setEditingProject(null)
    setFinanceValid(true)
    setFinanceDirty(false)
    setModalError('')
    setMemberBaseline(membersOk ? [] : null)
    setFinanceAccess('ready') // dự án mới: không có số liệu cũ để bị ghi đè
    const today = todayISO()
    setForm({
      ...INITIAL_PROJECT_FORM,
      start_date: today,
      code: generateProjectCode(today, projects),
    })
    setModalOpen(true)
  }

  const openEditModal = (p) => {
    setEditingProject(p)
    setFinanceValid(true)
    setFinanceDirty(false)
    setModalError('')
    // Ưu tiên cột lead_source/warehouse_code; chưa có mới dùng suy luận cũ từ note làm gợi ý
    const hasColumnAttr = (p.lead_source && p.lead_source !== 'unknown') || !!p.warehouse_code
    const attr = extractProjectAttribution(p)
    const initialSource = hasColumnAttr
      ? p.lead_source || 'unknown'
      : attr.isExplicit
      ? attr.source
      : 'unknown'
    setMemberBaseline(membersOk ? membersMap.get(p.id) || [] : null)
    setFinanceAccess(financeEditAccess(financeOk, financesMap.has(p.id)))
    setForm({
      code: p.code || '',
      name: p.name || '',
      customer_id: p.customer_id || '',
      location: p.location || '',
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      lead_id: p.lead_id || '',
      status: p.status || 'quote',
      contract_value: financesMap.get(p.id) ?? 0,
      discount: discountsMap.get(p.id) ?? 0,
      gross_sales: (financesMap.get(p.id) ?? 0) + (discountsMap.get(p.id) ?? 0),
      member_ids: membersMap.get(p.id) || [],
      lead_source: initialSource,
      warehouse_hub: p.warehouse_code || attr.hub || 'xuan_loc',
      note: cleanProjectNote(p.note),
    })
    setModalOpen(true)
  }

  const toggleMember = (userId) => {
    setForm((prev) => {
      const exists = prev.member_ids.includes(userId)
      return {
        ...prev,
        member_ids: exists
          ? prev.member_ids.filter((id) => id !== userId)
          : [...prev.member_ids, userId],
      }
    })
  }

  const duplicateProject = useMemo(
    () => findDuplicateCode(form.code, projects, editingProject?.id),
    [form.code, projects, editingProject]
  )

  const handleSaveProject = async (e) => {
    e.preventDefault()
    if (savingRef.current) return
    setSaveAttempt((n) => n + 1)
    setModalError('')
    if (duplicateProject) {
      setModalError(`Mã dự án "${form.code}" đã trùng với dự án "${duplicateProject.name}". Vui lòng bấm "⚡ Sinh mã" để lấy mã kế tiếp.`)
      return
    }
    if (!form.name.trim()) {
      setModalError('Hãy nhập tên dự án.')
      return
    }
    if (isManagerOrAdmin && !financeValid) {
      setModalError('Ưu đãi không hợp lệ (âm hoặc lớn hơn doanh số). Vui lòng sửa trước khi lưu.')
      return
    }
    if (
      isManagerOrAdmin &&
      form.status !== 'quote' &&
      form.status !== 'cancelled' &&
      (form.lead_source || 'unknown') === 'unknown'
    ) {
      setModalError('Hãy chọn nguồn khách trước khi chuyển dự án khỏi trạng thái báo giá.')
      return
    }
    savingRef.current = true
    try {
      // Chặn trước đổi trạng thái (DB cũng chặn khi đã chạy projects_phase2.sql)
      if (editingProject && editingProject.status !== form.status) {
        const guard = await loadStatusGuardData(editingProject, form.status)
        const block = statusChangeBlockReason({
          prevStatus: editingProject.status,
          nextStatus: form.status,
          projectName: form.name.trim(),
          ...guard,
        })
        if (block) {
          setModalError(block)
          return
        }
      }
      const warning = statusChangeWarning(
        editingProject?.status || INITIAL_PROJECT_FORM.status,
        form.status,
        form.name.trim()
      )
      if (warning && !(await confirm(warning))) return
      setSaving(true)

      const finalCode = form.code.trim().toUpperCase() || null

      if (finalCode) {
        let checkQuery = supabase
          .from('projects')
          .select('id, code, name')
          .ilike('code', finalCode)
        if (editingProject?.id) {
          checkQuery = checkQuery.neq('id', editingProject.id)
        }
        const { data: dupRows } = await checkQuery
        if (dupRows && dupRows.length > 0) {
          const freshRes = await fetchAllRows((from, to) =>
            supabase.from('projects').select('id, code').order('id').range(from, to)
          )
          const nextAvailable = generateProjectCode(
            form.start_date,
            freshRes.data || projects,
            editingProject?.id
          )
          setForm((prev) => ({ ...prev, code: nextAvailable }))
          throw new Error(
            `Mã dự án "${finalCode}" vừa được dùng cho "${dupRows[0].name}". Hệ thống đã tự động đổi sang mã mới chưa trùng: ${nextAvailable}. Hãy bấm Lưu dự án một lần nữa!`
          )
        }
      }

      const payload = {
        code: finalCode,
        name: form.name.trim(),
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        location: form.location.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        lead_id: form.lead_id || null,
        status: form.status,
        note: stripProjectAttributionFromNote(form.note.trim()) || null,
      }
      if (isManagerOrAdmin) {
        payload.lead_source = form.lead_source || 'unknown'
        payload.warehouse_code = form.warehouse_hub || null
      }

      let projectId = editingProject?.id
      if (editingProject) {
        // Ô ghi chú trong form đã lột thẻ Facebook: đọc note mới nhất ngay trước khi ghi để gắn lại
        const { data: latest, error: noteErr } = await supabase
          .from('projects')
          .select('note')
          .eq('id', editingProject.id)
          .single()
        if (noteErr) {
          throw new Error(`Chưa lưu: không đọc được ghi chú mới nhất của dự án (${noteErr.message}).`)
        }
        payload.note = mergeNoteKeepingFbMeta(payload.note, latest.note)
        const { error: err } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', editingProject.id)
        if (err) throw err
        // Cập nhật mốc trạng thái để lần Lưu lại không hỏi xác nhận lần nữa
        setEditingProject((prev) => ({ ...prev, ...payload }))
      } else {
        const { data, error: err } = await supabase
          .from('projects')
          .insert([payload])
          .select('id')
          .single()
        if (err) throw err
        projectId = data.id
        // Từ giờ các lần Lưu tiếp theo là CẬP NHẬT dự án vừa tạo (tránh tạo trùng)
        setEditingProject({ ...payload, id: data.id })
      }

      // Lưu tài chính dự án (chỉ Admin/Manager, chỉ khi người dùng thực sự sửa ô tiền)
      // Lỗi ở đây không được chặn bước thành viên / loadData bên dưới.
      let financeErrorMsg = ''
      if (isManagerOrAdmin && projectId && financeDirty && financeAccess !== 'locked') {
        const gross = Number(form.gross_sales || 0)
        const disc = Number(form.discount || 0)
        try {
          if (financeAccess === 'verify') {
            // Lúc tải trang chưa thấy dòng tiền: đọc lại để không ghi đè số đã có
            const { data: existing, error: readErr } = await getProjectFinance(projectId)
            if (readErr) throw readErr
            if (existing) {
              throw new Error(
                'trên hệ thống đã có số tiền mà form chưa tải, hãy đóng hộp thoại và tải lại trang rồi sửa'
              )
            }
          }
          const { error: finErr } = await saveProjectFinance(projectId, {
            contractValue: gross - disc,
            discount: disc,
          })
          if (finErr) throw finErr
          setFinanceDirty(false)
          setFinanceAccess('ready')
        } catch (finEx) {
          financeErrorMsg = `Dự án đã lưu nhưng chưa lưu được doanh số/ưu đãi${finEx?.message ? ` (${finEx.message})` : ''}. Bấm Lưu lần nữa để thử lại.`
        }
      }

      // Cập nhật thành viên: chỉ ghi phần thay đổi, thêm trước rồi mới xóa
      let memberErrorMsg = ''
      if (isManagerOrAdmin && projectId && memberBaseline !== null) {
        const { toAdd, toRemove } = diffMembers(memberBaseline, form.member_ids)
        try {
          if (toAdd.length > 0) {
            const { error: addErr } = await supabase.from('project_members').upsert(
              toAdd.map((uid) => ({ project_id: projectId, user_id: uid })),
              { onConflict: 'project_id,user_id', ignoreDuplicates: true }
            )
            if (addErr) throw addErr
            // Ghi nhận ngay phần đã thêm, để nếu bước xóa lỗi thì lần Lưu sau vẫn so đúng
            setMemberBaseline((prev) => [...prev, ...toAdd])
          }
          if (toRemove.length > 0) {
            const { error: delErr } = await supabase
              .from('project_members')
              .delete()
              .eq('project_id', projectId)
              .in('user_id', toRemove)
            if (delErr) throw delErr
            setMemberBaseline((prev) => prev.filter((id) => !toRemove.includes(id)))
          }
        } catch (memEx) {
          memberErrorMsg = `Dự án đã lưu nhưng chưa cập nhật xong đội thi công${memEx?.message ? ` (${memEx.message})` : ''}. Bấm Lưu lần nữa để thử lại.`
        }
      }

      await loadData()
      const partialError = [financeErrorMsg, memberErrorMsg].filter(Boolean).join(' ')
      if (partialError) {
        // Lưu được một phần: giữ modal mở và báo lỗi trong modal
        setModalError(partialError)
      } else {
        setModalOpen(false)
      }
    } catch (err) {
      setModalError(err.message || 'Lỗi khi lưu dự án')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const handleDeleteProject = async (p) => {
    const okDelete = await confirm({
      title: 'Xóa dự án',
      message: `Bạn có chắc chắn muốn xóa dự án "${p.name}"? Hành động không hoàn tác được.`,
      confirmLabel: 'Xóa',
      danger: true,
    })
    if (!okDelete) return
    try {
      const countOf = async (table) => {
        const { count, error: cErr } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('project_id', p.id)
        if (cErr) throw cErr
        return count || 0
      }
      const [movements, costs, advances] = await Promise.all([
        countOf('stock_movements'),
        countOf('project_costs'),
        countOf('project_advances'),
      ])
      const blockMsg = deleteBlockMessage({ movements, costs, advances })
      if (blockMsg) {
        showError(blockMsg)
        return
      }
      const { error: err } = await supabase.from('projects').delete().eq('id', p.id)
      if (err) throw err
      await loadData()
      showNotice(`Đã xóa dự án "${p.name}".`)
    } catch (err) {
      showError(err.message || 'Không thể xóa dự án')
    }
  }

  const showError = (msg) => {
    setNotice('')
    setError(msg)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const showNotice = (msg) => {
    setError('')
    setNotice(msg)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Nạp phiếu kho, chi phí, tạm ứng, loại vật tư của các dự án rồi tính đóng dự án cho từng dự án.
  const computeClosures = async (projectList) => {
    const ids = projectList.map((p) => p.id)
    // Phân trang vượt giới hạn 1000 dòng; order('id') để các trang không lặp/mất dòng.
    const [mvRes, costRes, advRes] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from('stock_movements')
          .select('project_id, item_id, type, qty, moved_at')
          .in('project_id', ids)
          .order('id')
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from('project_costs')
          .select('project_id, cost_date')
          .in('project_id', ids)
          .order('id')
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from('project_advances')
          .select('project_id, kind, amount, received_date')
          .in('project_id', ids)
          .order('id')
          .range(from, to)
      ),
    ])
    if (mvRes.error) throw mvRes.error
    if (costRes.error) throw costRes.error
    if (advRes.error) throw advRes.error
    const itemIds = [...new Set((mvRes.data || []).map((m) => m.item_id))]
    const kindMap = new Map()
    if (itemIds.length > 0) {
      const itemRes = await supabase.from('items').select('id, kind').in('id', itemIds)
      if (itemRes.error) throw itemRes.error
      for (const it of itemRes.data || []) kindMap.set(Number(it.id), it.kind)
    }
    const group = (rows) => {
      const g = new Map()
      for (const r of rows || []) {
        if (!g.has(r.project_id)) g.set(r.project_id, [])
        g.get(r.project_id).push(r)
      }
      return g
    }
    const gm = group(mvRes.data)
    const gc = group(costRes.data)
    const ga = group(advRes.data)
    const today = todayISO()
    return projectList.map((p) => ({
      project: p,
      closure: calcProjectClosure({
        project: p,
        movements: gm.get(p.id) || [],
        costs: gc.get(p.id) || [],
        advances: ga.get(p.id) || [],
        itemKindMap: kindMap,
        today,
      }),
    }))
  }

  const setArchivedAt = async (ids, value) => {
    let q = supabase.from('projects').update({ archived_at: value }).in('id', ids)
    // Lưu trữ: chỉ ghi khi dự án vẫn đang ở trạng thái Đã hủy và chưa lưu trữ.
    if (value) q = q.eq('status', 'cancelled').is('archived_at', null)
    const { data: updated, error: err } = await q.select('id')
    if (err) {
      throw new Error(
        `Không ghi được trạng thái lưu trữ (có thể cột archived_at chưa được tạo trên CSDL): ${err.message}`
      )
    }
    return (updated || []).length
  }

  const handleArchiveProject = async (p) => {
    try {
      const [{ closure }] = await computeClosures([p])
      if (!closure.canArchive) {
        showError(`Chưa thể lưu trữ dự án "${p.name}": ${closure.reasons.join('; ')}.`)
        return
      }
      const okArchive = await confirm({
        title: 'Lưu trữ dự án',
        message: `Lưu trữ dự án "${p.name}"? Dự án sẽ bị ẩn khỏi danh sách (dữ liệu và báo cáo vẫn giữ nguyên).`,
        confirmLabel: 'Lưu trữ',
      })
      if (!okArchive) return
      const n = await setArchivedAt([p.id], new Date().toISOString())
      await loadData()
      if (n === 0) showError(`Không lưu trữ được dự án "${p.name}" vì dữ liệu đã đổi (không còn ở trạng thái Đã hủy hoặc đã được lưu trữ).`)
      else showNotice(`Đã lưu trữ dự án "${p.name}".`)
    } catch (err) {
      showError(err.message || 'Không thể lưu trữ dự án')
    }
  }

  const handleUnarchiveProject = async (p) => {
    try {
      await setArchivedAt([p.id], null)
      await loadData()
      showNotice(`Đã bỏ lưu trữ dự án "${p.name}".`)
    } catch (err) {
      showError(err.message || 'Không thể bỏ lưu trữ dự án')
    }
  }

  const handleArchiveSuggested = async () => {
    const okBulk = await confirm({
      title: 'Lưu trữ hàng loạt',
      message: `Lưu trữ ${suggested.length} dự án hủy đã đóng hết thao tác?`,
      confirmLabel: 'Lưu trữ',
    })
    if (!okBulk) return
    try {
      // Tính lại bằng dữ liệu mới nhất trước khi ghi; chỉ lưu trữ dự án vẫn còn đủ điều kiện.
      const fresh = await computeClosures(suggested)
      const okIds = fresh.filter((x) => x.closure.suggestArchive).map((x) => x.project.id)
      const done = okIds.length > 0 ? await setArchivedAt(okIds, new Date().toISOString()) : 0
      await loadData()
      const skippedAll = suggested.length - done
      if (skippedAll > 0) {
        showError(
          `Đã lưu trữ ${done} dự án; ${skippedAll} dự án bị bỏ qua vì dữ liệu đã đổi.`
        )
      } else {
        showNotice(`Đã lưu trữ ${done} dự án.`)
      }
    } catch (err) {
      showError(err.message || 'Không thể lưu trữ hàng loạt')
    }
  }

  const handleExport = () => {
    const rows = filteredProjects.map((p) => {
      const base = {
        'Mã dự án': p.code || `#${p.id}`,
        'Tên dự án': p.name,
        'Khách hàng': p.customer?.name || '',
        'Địa điểm': p.location || '',
        'Ngày thi công': formatDate(p.start_date),
        'Ngày tháo dỡ': formatDate(p.end_date),
        'Phụ trách': p.lead?.full_name || p.lead?.email || '',
        'Trạng thái': PROJECT_STATUS_LABELS[p.status] || p.status,
      }
      if (canEditCatalog) {
        base['Giá trị hợp đồng (₫)'] = financesMap.get(p.id) || 0
      }
      base['Ghi chú'] = cleanProjectNote(p.note)
      return base
    })
    exportToExcel(rows, 'DanhSachDuAn', 'danh-sach-du-an.xlsx')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý Dự án Trang trí</h1>
          <p className="text-muted">
            Theo dõi tiến độ, kế hoạch giữ chỗ vật tư, xuất kho, thu hồi và quyết toán từng sự kiện
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={handleExport}>
            📥 Xuất Excel
          </button>
          {isManagerOrAdmin && (
            <button className="btn btn-primary" onClick={openCreateModal} disabled={loading}>
              + Tạo dự án mới
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loadWarning && (
        <div
          className="alert alert-error"
          role="alert"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <span>{loadWarning}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={loadData} disabled={loading}>
            Tải lại
          </button>
        </div>
      )}
      {notice && (
        <div
          className="alert alert-success"
          role="status"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
        >
          <span>{notice}</span>
          <button type="button" className="btn-icon" aria-label="Đóng thông báo" onClick={() => setNotice('')}>
            ✕
          </button>
        </div>
      )}
      {confirmDialog}

      {/* Bộ lọc */}
      <div className="card filter-bar">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Tìm theo mã, tên dự án, khách hàng, địa điểm..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input"
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <div className="filter-inline">
            <label>Thi công từ:</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="filter-inline">
            <label>Đến:</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          <label className="checkbox-label" style={{ flex: '1 1 100%' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Hiện cả dự án lưu trữ
          </label>
        </div>
      </div>

      {!showArchived && hiddenArchivedCount > 0 && (
        <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
          Đang ẩn {hiddenArchivedCount} dự án đã lưu trữ
        </div>
      )}

      {isManagerOrAdmin && !suggestDismissed && suggested.length > 0 && (
        <div className="alert alert-info" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            Có {suggested.length} dự án hủy đã đóng hết thao tác từ 30 ngày, có thể lưu trữ.
          </span>
          <button className="btn btn-sm btn-primary" onClick={handleArchiveSuggested}>
            Lưu trữ {suggested.length} dự án
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => setSuggestDismissed(true)}>
            Bỏ qua
          </button>
        </div>
      )}
      {isManagerOrAdmin && suggestNote && (
        <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>{suggestNote}</div>
      )}

      {/* Bảng dự án */}
      <div className="card">
        {loading ? (
          <div className="loading-state">Đang tải danh sách dự án...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="empty-state">Chưa có dự án nào phù hợp.</div>
        ) : (
          <div className="table-responsive ui-table-wrap">
            <table className="data-table ui-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên dự án</th>
                  <th>Khách hàng</th>
                  <th>Địa điểm</th>
                  <th>Ngày thi công → Tháo dỡ</th>
                  <th>Phụ trách</th>
                  <th>Trạng thái</th>
                  {canEditCatalog && <th className="text-right">Giá trị HĐ</th>}
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Mã">
                      <code>{p.code || `#${p.id}`}</code>
                    </td>
                    <td className="ui-table__primary" data-label="Tên dự án">
                      <Link to={`/du-an/${p.id}`} className="table-link font-bold">
                        {p.name}
                      </Link>
                      {isManagerOrAdmin && (() => {
                        const attr = extractProjectAttribution(p)
                        return (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                            <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>
                              📍 {attr.hubShortLabel}
                            </span>
                            <span
                              className={`badge ${attr.isPaidAds ? 'badge-blue' : 'badge-gray'}`}
                              style={{ fontSize: '0.7rem' }}
                            >
                              {attr.isPaidAds ? '📢 ' : ''}
                              {attr.sourceLabel}
                            </span>
                          </div>
                        )
                      })()}
                      {(() => {
                        const fbRem = calcProjectFbReminder(p)
                        if (fbRem.fbData?.status === 'posted') {
                          return (
                            <div style={{ marginTop: 3 }}>
                              <span className="badge badge-green" style={{ fontSize: '0.72rem' }}>
                                📱 Đã đăng FB
                              </span>
                            </div>
                          )
                        }
                        if (fbRem.isOverdue5Days) {
                          return (
                            <div style={{ marginTop: 3 }}>
                              <Link
                                to={`/du-an/${p.id}?tab=facebook`}
                                className="badge badge-danger"
                                style={{ fontSize: '0.72rem', textDecoration: 'none' }}
                              >
                                🔔 Quá {fbRem.daysPassed} ngày chưa đăng FB
                              </Link>
                            </div>
                          )
                        }
                        return null
                      })()}
                    </td>
                    <td data-label="Khách hàng">{p.customer?.name || '—'}</td>
                    <td className="ui-col-hide-mobile" data-label="Địa điểm">
                      {p.location || '—'}
                    </td>
                    <td data-label="Thi công → Tháo dỡ">
                      {formatDate(p.start_date)} → {formatDate(p.end_date)}
                    </td>
                    <td className="ui-col-hide-mobile" data-label="Phụ trách">
                      {p.lead?.full_name || p.lead?.email || '—'}
                    </td>
                    <td data-label="Trạng thái">
                      <ProjectStatusBadge status={p.status} />
                      {p.archived_at && (
                        <span className="badge badge-gray" style={{ marginLeft: 4, fontSize: '0.72rem' }}>
                          Lưu trữ
                        </span>
                      )}
                    </td>
                    {canEditCatalog && (
                      <td className="text-right font-bold text-green" data-label="Giá trị HĐ">
                        {formatCurrency(financesMap.get(p.id) || 0)}
                      </td>
                    )}
                    <td className="text-right ui-table__actions">
                      <div className="row-actions">
                        <Link to={`/du-an/${p.id}`} className="btn btn-sm btn-primary">
                          Mở dự án
                        </Link>
                        {isManagerOrAdmin && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => openEditModal(p)}
                          >
                            Sửa
                          </button>
                        )}
                        {isManagerOrAdmin && p.status === 'cancelled' && !p.archived_at && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => handleArchiveProject(p)}
                          >
                            Lưu trữ
                          </button>
                        )}
                        {isManagerOrAdmin && p.archived_at && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => handleUnarchiveProject(p)}
                          >
                            Bỏ lưu trữ
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => handleDeleteProject(p)}
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal tạo / sửa dự án */}
      {modalOpen && (
        // Không đóng bằng chạm nền để khỏi mất dữ liệu đang nhập; chỉ đóng bằng ✕ hoặc Hủy
        <div className="modal-backdrop">
          <div className="modal-card modal-lg">
            <div className="modal-header">
              <h3>{editingProject ? 'Cập nhật dự án' : 'Tạo dự án mới'}</h3>
              <button
                type="button"
                className="btn-icon"
                aria-label="Đóng"
                disabled={saving}
                onClick={() => setModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveProject} className="modal-body">
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Mã dự án (tự sinh DA-YYMM-001)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="VD: DA-2611-001"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      style={
                        duplicateProject
                          ? { borderColor: '#dc2626', backgroundColor: '#fef2f2' }
                          : undefined
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      title="Sinh mã dự án tự động không trùng"
                      onClick={() =>
                        setForm({
                          ...form,
                          code: generateProjectCode(
                            form.start_date,
                            projects,
                            editingProject?.id
                          ),
                        })
                      }
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      ⚡ Sinh mã
                    </button>
                  </div>
                  {duplicateProject ? (
                    <div className="text-xs text-red" style={{ marginTop: 4 }}>
                      ⚠️ Trùng mã với dự án: <strong>{duplicateProject.name}</strong>.{' '}
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: '0.78rem', padding: 0 }}
                        onClick={() =>
                          setForm({
                            ...form,
                            code: generateProjectCode(
                              form.start_date,
                              projects,
                              editingProject?.id
                            ),
                          })
                        }
                      >
                        Đổi sang mã kế tiếp
                      </button>
                    </div>
                  ) : form.code.trim() ? (
                    <div className="text-xs text-green" style={{ marginTop: 4 }}>
                      ✓ Mã dự án hợp lệ, chưa trùng
                    </div>
                  ) : null}
                </div>
                <div className="form-group">
                  <label>Trạng thái *</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {editingProject &&
                    editingProject.status !== form.status &&
                    (form.status === 'done' || form.status === 'cancelled') && (
                      <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                        Khi lưu, hệ thống kiểm tra: còn đồ tái sử dụng chưa thu hồi (hoặc chưa ghi hỏng/mất) thì
                        không chuyển được.
                      </div>
                    )}
                  {editingProject?.status === 'cancelled' && form.status !== 'cancelled' && (
                    <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                      Mở lại dự án hủy bị chặn nếu đã ghi Mất cọc hoặc tháng hủy đã khóa sổ.
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>Tên dự án / Sự kiện *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Tiệc cưới Anh Minh - Chị Lan tại Gem Center"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Khách hàng</label>
                  <select
                    value={form.customer_id}
                    onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  >
                    <option value="">-- Chọn khách hàng --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Địa điểm thi công</label>
                  <input
                    type="text"
                    placeholder="VD: Sảnh Castor - Gem Center, Q.1"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Ngày thi công (Start Date)</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => {
                      const nextStart = e.target.value
                      setForm({
                        ...form,
                        start_date: nextStart,
                        code: !editingProject
                          ? generateProjectCode(nextStart, projects)
                          : form.code,
                      })
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Ngày tháo dỡ / thu hồi dự kiến (End Date)</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Người phụ trách chính (Lead)</label>
                  <select
                    value={form.lead_id}
                    onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
                  >
                    <option value="">-- Chọn người phụ trách --</option>
                    {profiles.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.full_name || pr.email} ({pr.email})
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              {canEditCatalog && financeAccess === 'locked' && (
                <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
                  Không tải được giá trị hợp đồng và ưu đãi nên phần tiền bị khóa. Bấm Lưu sẽ không thay đổi
                  số tiền. Muốn sửa: đóng hộp thoại, bấm "Tải lại" rồi mở lại.
                </div>
              )}

              {canEditCatalog && financeAccess !== 'locked' && (
                <div className="form-grid-2">
                  <ContractValueFields
                    key={editingProject?.id ?? 'new'}
                    grossSales={form.gross_sales}
                    discount={form.discount}
                    canEdit={isManagerOrAdmin}
                    canSeeDiscount={isManagerOrAdmin}
                    onValidChange={setFinanceValid}
                    onChange={({ grossSales, discount, revenue }) => {
                      setFinanceDirty(true)
                      setForm((prev) => ({
                        ...prev,
                        gross_sales: grossSales,
                        discount,
                        contract_value: revenue,
                      }))
                    }}
                  />
                </div>
              )}

              {isManagerOrAdmin && (
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>📍 Đầu kho phụ trách (Hạch toán P&L theo kho)</label>
                    <select
                      value={form.warehouse_hub}
                      onChange={(e) => setForm({ ...form, warehouse_hub: e.target.value })}
                    >
                      {WAREHOUSE_HUBS.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>📢 Nguồn khách hàng (Tự động đo CAC & ROAS Ads)</label>
                    <select
                      value={form.lead_source}
                      onChange={(e) => setForm({ ...form, lead_source: e.target.value })}
                    >
                      {LEAD_SOURCE_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Thành viên tham gia thi công (Nhân viên được phân công sẽ thấy dự án này)</label>
                {memberBaseline === null && (
                  <div className="alert alert-error" role="alert" style={{ marginBottom: 8 }}>
                    Không tải được danh sách đội thi công nên phần này bị khóa. Bấm Lưu sẽ không thay đổi
                    thành viên. Muốn sửa: đóng hộp thoại, bấm "Tải lại" rồi mở lại.
                  </div>
                )}
                <div className="members-checkbox-grid">
                  {profiles.map((pr) => (
                    <label key={pr.id} className="checkbox-label member-chip">
                      <input
                        type="checkbox"
                        disabled={saving || memberBaseline === null}
                        checked={form.member_ids.includes(pr.id)}
                        onChange={() => toggleMember(pr.id)}
                      />
                      <span>{pr.full_name || pr.email}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Ghi chú dự án</label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Yêu cầu đặc biệt từ khách hàng, giờ bàn giao sảnh..."
                />
              </div>

              {modalError && (
                <div ref={modalErrorRef} className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
                  {modalError}
                </div>
              )}

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || Boolean(duplicateProject)}
                >
                  {saving ? 'Đang lưu...' : 'Lưu dự án'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
