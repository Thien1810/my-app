import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { formatCurrency } from '../lib/formatters'
import { useAuth } from '../lib/AuthContext'
import { useConfirm } from './ConfirmDialog'
import {
  QUOTE_MAX_BYTES,
  buildQuoteDraft,
  deserializeQuote,
  draftDecision,
  parseQuoteDraft,
  quoteDraftKey,
  formatSavedTime,
  initialQuoteSource,
  parseLocalQuote,
  quoteDataBytes,
  quoteStorageKey,
  resolveLineImage,
  serializeQuote,
  templateImageMap,
} from '../lib/projectQuote'
import { insertProjectQuote, loadProjectQuote, updateProjectQuote } from '../lib/projectQuotesApi'
import { exportToExcel } from '../lib/exportExcel'
import { compressImageUnder1MB } from '../lib/imageCompressor'
import { canonicalCategory, categoryIcon, parseTemplateMeta } from '../lib/setTemplateMeta'
import { buildCategoryOptions, categoryKey } from '../lib/setTemplates'
import { exportQuoteToPng } from '../lib/quoteExporter'
import ContractValueFields from './ContractValueFields'
import { saveProjectFinance } from '../lib/financeApi'

export default function ProjectQuoteTab({
  project,
  templates = [],
  contractValue = 0,
  discount = 0,
  isManagerOrAdmin = false,
  onSyncContractValue,
  onSyncFinance,
  onApplySetsToPlan,
}) {
  const storageKey = quoteStorageKey(project?.id)
  const { isAdmin } = useAuth()
  const { confirm, confirmDialog } = useConfirm()

  const [quoteLines, setQuoteLines] = useState([])
  // Bản nháp khi sửa: doanh số (giá gói) và ưu đãi; doanh thu = doanh số - ưu đãi
  const [draftFinance, setDraftFinance] = useState(null)
  const [financeValid, setFinanceValid] = useState(true)
  const [quoteNote, setQuoteNote] = useState('')
  const [filterSetCat, setFilterSetCat] = useState('all')
  const [exportingPng, setExportingPng] = useState(false)
  const [savingContract, setSavingContract] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [actionError, setActionError] = useState('')
  const [pushingPlan, setPushingPlan] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [previewImg, setPreviewImg] = useState(null)

  // Chuẩn hóa danh sách mẫu set có hình ảnh và phân loại
  const enrichedTemplates = useMemo(() => {
    return templates.map((t) => {
      const meta = parseTemplateMeta(t)
      return {
        ...t,
        parsedCategory: meta.category,
        parsedImageUrl: meta.image_url,
        parsedNote: meta.cleanNote,
      }
    })
  }, [templates])

  // Loại gồm 3 loại cố định, loại tự thêm từ các mẫu, và loại đã có trong dòng báo giá
  const categoryOptions = useMemo(
    () =>
      buildCategoryOptions([
        ...enrichedTemplates.map((t) => ({ category: t.parsedCategory })),
        ...quoteLines.map((l) => ({ category: l.category })),
      ]),
    [enrichedTemplates, quoteLines]
  )

  const visibleTemplates = useMemo(() => {
    if (filterSetCat === 'all') return enrichedTemplates
    return enrichedTemplates.filter((t) => categoryKey(t.parsedCategory) === categoryKey(filterSetCat))
  }, [enrichedTemplates, filterSetCat])

  // ----- LƯU BÁO GIÁ -----
  // Nguồn chính: bảng project_quotes trên Supabase (supabase/projects_phase2.sql).
  // Chưa chạy SQL (thiếu bảng): dùng localStorage như cũ ('local') và báo nhẹ cho admin.
  // Hai máy sửa cùng lúc: ghi có điều kiện updated_at, lệch thì báo xung đột, không ghi đè ngầm.
  const imageMap = useMemo(() => templateImageMap(templates), [templates])
  const imageMapRef = useRef(imageMap)
  useEffect(() => {
    imageMapRef.current = imageMap
  }, [imageMap])

  const [store, setStore] = useState('loading') // 'loading' | 'db' | 'local' | 'error'
  const [loadError, setLoadError] = useState('')
  const [localOffer, setLocalOffer] = useState(null) // { updatedAt } khi DB trống mà máy này có bản cũ
  const [saveState, setSaveState] = useState({ status: 'idle', at: null, message: '' })
  const [conflict, setConflict] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const storeRef = useRef('loading')
  const projectIdRef = useRef(project?.id)
  const baseRef = useRef(null) // updated_at của bản trên DB; null = DB chưa có báo giá
  const latestRef = useRef({ lines: [], quoteNote: '' })
  const timerRef = useRef(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const conflictRef = useRef(false)
  const clearLocalAfterSaveRef = useRef(false)
  const editSeqRef = useRef(0) // tăng mỗi lần sửa, để biết bản vừa lưu có phải bản mới nhất không
  // Bản nháp cũ dựa trên bản DB đã bị máy khác thay: chờ người dùng chọn, không tự áp dụng.
  const [draftOffer, setDraftOffer] = useState(null)
  const draftOfferRef = useRef(null)

  const writeDraft = (pid = projectIdRef.current) => {
    try {
      localStorage.setItem(quoteDraftKey(pid), JSON.stringify(buildQuoteDraft(latestRef.current, baseRef.current)))
    } catch {
      // localStorage đầy / bị chặn: vẫn lưu DB bình thường, chỉ mất lớp dự phòng
    }
  }
  const clearDraft = (pid = projectIdRef.current) => {
    try {
      localStorage.removeItem(quoteDraftKey(pid))
    } catch {
      // ignore
    }
  }
  const setDraftOfferBoth = (v) => {
    draftOfferRef.current = v
    setDraftOffer(v)
  }

  const applyQuote = (q) => {
    latestRef.current = { lines: q.lines, quoteNote: q.quoteNote }
    setQuoteLines(q.lines)
    setQuoteNote(q.quoteNote)
  }

  const readLocal = (key) => {
    try {
      return parseLocalQuote(localStorage.getItem(key))
    } catch {
      return null
    }
  }

  const flushSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (storeRef.current !== 'db' || conflictRef.current) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }
    const pid = projectIdRef.current
    const seqAtStart = editSeqRef.current
    const data = serializeQuote(latestRef.current, imageMapRef.current)
    const bytes = quoteDataBytes(data)
    if (bytes > QUOTE_MAX_BYTES) {
      setSaveState({
        status: 'error',
        at: null,
        message: `Báo giá quá lớn (${Math.round(bytes / 1024)} KB, tối đa ${QUOTE_MAX_BYTES / 1024} KB) nên CHƯA lưu. Hãy bỏ bớt ảnh tự tải lên.`,
      })
      return
    }
    savingRef.current = true
    setSaveState((s) => ({ ...s, status: 'saving', message: '' }))
    const res = baseRef.current
      ? await updateProjectQuote(pid, data, baseRef.current)
      : await insertProjectQuote(pid, data)
    savingRef.current = false
    if (projectIdRef.current !== pid) return
    if (res.conflict) {
      conflictRef.current = true
      setConflict(true)
      setSaveState({ status: 'conflict', at: null, message: '' })
      return
    }
    if (res.error) {
      setSaveState({
        status: 'error',
        at: null,
        message: `Chưa lưu được báo giá lên hệ thống: ${res.error.message || 'lỗi không rõ'}. Sửa tiếp hoặc bấm "Lưu lại" để thử lại.`,
      })
      return
    }
    baseRef.current = res.row?.updated_at || baseRef.current
    // Nháp chỉ xóa khi bản vừa lưu là bản mới nhất; còn sửa mới thì ghi lại nháp theo mốc DB mới.
    if (!draftOfferRef.current) {
      if (editSeqRef.current === seqAtStart) clearDraft(pid)
      else writeDraft(pid)
    }
    setSaveState({
      status: editSeqRef.current === seqAtStart ? 'saved' : 'dirty',
      at: res.row?.updated_at || new Date().toISOString(),
      message: '',
    })
    if (clearLocalAfterSaveRef.current) {
      clearLocalAfterSaveRef.current = false
      try {
        localStorage.removeItem(quoteStorageKey(pid))
      } catch {
        // ignore
      }
      setLocalOffer(null)
    }
    if (pendingRef.current) {
      pendingRef.current = false
      flushSave()
    }
  }, [])

  // Tải báo giá khi mở tab / đổi dự án / bấm tải lại.
  useEffect(() => {
    if (!project?.id) return undefined
    let cancelled = false
    const pid = project.id
    projectIdRef.current = pid
    storeRef.current = 'loading'
    setStore('loading')
    setLoadError('')
    setLocalOffer(null)
    setConflict(false)
    conflictRef.current = false
    pendingRef.current = false
    clearLocalAfterSaveRef.current = false
    baseRef.current = null
    setDraftOfferBoth(null)
    setSaveState({ status: 'idle', at: null, message: '' })
    const local = readLocal(quoteStorageKey(pid))
    let draft = null
    try {
      draft = parseQuoteDraft(localStorage.getItem(quoteDraftKey(pid)))
    } catch {
      draft = null
    }

    loadProjectQuote(pid).then((res) => {
      if (cancelled) return
      if (res.missingSchema) {
        applyQuote(deserializeQuote(local || {}, imageMapRef.current))
        storeRef.current = 'local'
        setStore('local')
        return
      }
      if (res.error) {
        setLoadError(res.error.message || 'lỗi không rõ')
        storeRef.current = 'error'
        setStore('error')
        return
      }
      const source = initialQuoteSource({ dbRow: res.row, local })
      baseRef.current = res.row?.updated_at || null
      storeRef.current = 'db'
      setStore('db')
      const decision = draftDecision({ draft, dbRow: res.row })
      if (decision === 'restore') {
        // Nháp chưa lưu dựa đúng bản DB hiện tại (rời tab khi lỗi/xung đột, F5 khi đang chờ lưu):
        // khôi phục và lưu tiếp; không đè được bản mới hơn vì vẫn ghi có điều kiện updated_at.
        applyQuote(deserializeQuote(draft, imageMapRef.current))
        clearLocalAfterSaveRef.current = !res.row && !!local
        setSaveState({ status: 'dirty', at: null, message: 'Đã khôi phục bản nháp chưa lưu trên máy này.' })
        timerRef.current = setTimeout(() => flushSave(), 800)
        return
      }
      if (decision === 'stale') setDraftOfferBoth(draft)
      if (source === 'db') {
        applyQuote(deserializeQuote(res.row.data, imageMapRef.current))
        setSaveState({ status: 'saved', at: res.row.updated_at, message: '' })
      } else if (source === 'offer_local') {
        applyQuote(deserializeQuote(local, imageMapRef.current))
        setLocalOffer({ updatedAt: local.updatedAt })
        clearLocalAfterSaveRef.current = true
      } else {
        applyQuote({ lines: [], quoteNote: '' })
      }
    })

    return () => {
      cancelled = true
      // Rời dự án / tab khi còn thay đổi chưa lưu: lưu ngay (không chờ hết thời gian chờ).
      if (timerRef.current) flushSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, reloadKey, flushSave])

  // Thay cho persistQuote cũ: mỗi lần sửa thì ghi (DB: gom thay đổi 0,8 giây rồi lưu).
  const persistQuote = (nextLines, nextNote) => {
    latestRef.current = { lines: nextLines, quoteNote: nextNote }
    if (storeRef.current === 'local') {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ lines: nextLines, quoteNote: nextNote, updatedAt: new Date().toISOString() })
        )
      } catch {
        // ignore
      }
      return
    }
    if (storeRef.current !== 'db') return
    editSeqRef.current += 1
    // Ghi nháp NGAY (không chờ 0,8 giây): F5 / rời tab / lỗi mạng / xung đột vẫn còn bản đang sửa.
    // Đang có nháp cũ chờ người dùng chọn thì không ghi đè nháp đó.
    if (!draftOfferRef.current) writeDraft()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flushSave(), 800)
    if (!conflictRef.current) setSaveState((s) => ({ ...s, status: 'dirty', message: '' }))
  }

  // Cảnh báo khi đóng/tải lại trang lúc còn thay đổi chưa lưu lên hệ thống.
  const hasUnsaved =
    store === 'db' && (conflict || ['dirty', 'saving', 'error'].includes(saveState.status))
  useEffect(() => {
    if (!hasUnsaved) return undefined
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  const handleUseDraft = async () => {
    const d = draftOfferRef.current
    if (!d) return
    const ok = await confirm({
      title: 'Dùng bản nháp',
      message: `Thay nội dung đang thấy bằng bản nháp trên máy này${d.savedAt ? ` (sửa lúc ${formatSavedTime(d.savedAt)})` : ''} và LƯU ĐÈ lên bản hiện có trên hệ thống (bản đó do máy khác lưu sau bản nháp)?`,
      confirmLabel: 'Dùng bản nháp và lưu',
      danger: true,
    })
    if (!ok) return
    setDraftOfferBoth(null)
    applyQuote(deserializeQuote(d, imageMapRef.current))
    editSeqRef.current += 1
    writeDraft()
    flushSave()
  }

  const handleDiscardDraft = async () => {
    const ok = await confirm({
      title: 'Bỏ bản nháp',
      message: 'Xóa bản nháp chưa lưu trên máy này? Giữ nguyên bản đang có trên hệ thống.',
      confirmLabel: 'Bỏ bản nháp',
      danger: true,
    })
    if (!ok) return
    clearDraft()
    setDraftOfferBoth(null)
  }

  const handleReloadLatest = async () => {
    const ok = await confirm({
      title: 'Tải bản mới nhất',
      message: 'Tải lại báo giá đang có trên hệ thống? Các thay đổi chưa lưu trên máy này sẽ bị bỏ.',
      confirmLabel: 'Tải bản mới nhất',
    })
    if (!ok) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    clearDraft() // người dùng đã chọn bỏ thay đổi trên máy này
    setReloadKey((k) => k + 1)
  }

  const handleOverwrite = async () => {
    const ok = await confirm({
      title: 'Ghi đè báo giá',
      message: 'Ghi bản đang thấy trên máy này đè lên bản người khác vừa lưu? Bản của họ sẽ mất.',
      confirmLabel: 'Ghi đè',
      danger: true,
    })
    if (!ok) return
    const res = await loadProjectQuote(projectIdRef.current)
    if (res.error) {
      setSaveState({ status: 'error', at: null, message: `Không đọc được bản mới nhất: ${res.error.message || 'lỗi không rõ'}` })
      return
    }
    baseRef.current = res.row?.updated_at || null
    conflictRef.current = false
    setConflict(false)
    writeDraft() // nháp dựa theo mốc DB mới, để lỡ F5 thì vẫn khôi phục được
    flushSave()
  }

  const handleDiscardLocal = async () => {
    const ok = await confirm({
      title: 'Bỏ bản trên máy này',
      message: 'Xóa báo giá đang lưu riêng trên máy này (chưa có trên hệ thống)? Không hoàn tác được.',
      confirmLabel: 'Bỏ bản này',
      danger: true,
    })
    if (!ok) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
    clearDraft()
    clearLocalAfterSaveRef.current = false
    setLocalOffer(null)
    applyQuote({ lines: [], quoteNote: '' })
    setSaveState({ status: 'idle', at: null, message: '' })
  }

  // Đưa Mẫu set vào báo giá: chỉ lấy Hình ảnh + Tên set + Phân loại + Tên các vật tư (KHÔNG lấy số lượng vật tư & KHÔNG lấy giá vốn)
  const handleAddTemplateToQuote = (tpl) => {
    setSyncMsg('')
    const itemNames = (tpl.items || [])
      .map((ti) => ti.item?.name)
      .filter(Boolean)
      .join(', ')

    // Ưu tiên mô tả cho khách, rồi ghi chú mẫu, rồi tên vật tư (không có số lượng)
    const defaultDesc = (tpl.description || '').trim()
      ? tpl.description.trim()
      : tpl.parsedNote
        ? tpl.parsedNote
        : itemNames
          ? `Gồm: ${itemNames}`
          : ''

    const newLine = {
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      template_id: tpl.id,
      name: tpl.name,
      category: tpl.parsedCategory || 'Gia tiên',
      // Ảnh mẫu chỉ lưu tham chiếu template_id, lấy ảnh từ mẫu khi hiển thị/xuất
      image_source: tpl.parsedImageUrl ? 'template' : 'none',
      image_url: '',
      qty: 1,
      note: defaultDesc,
    }
    const next = [...quoteLines, newLine]
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleAddCustomLine = () => {
    const newLine = {
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      template_id: null,
      name: '',
      category: 'Gia tiên',
      image_source: 'none',
      image_url: '',
      qty: 1,
      note: '',
    }
    const next = [...quoteLines, newLine]
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleUpdateLineFields = (uid, patch) => {
    const next = latestRef.current.lines.map((l) => (l.uid === uid ? { ...l, ...patch } : l))
    setQuoteLines(next)
    persistQuote(next, latestRef.current.quoteNote)
  }
  const handleUpdateLine = (uid, field, value) => handleUpdateLineFields(uid, { [field]: value })

  const handleRemoveLine = (uid) => {
    const next = quoteLines.filter((l) => l.uid !== uid)
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleLineImageUpload = async (uid, file) => {
    if (!file) return
    try {
      const compressed = await compressImageUnder1MB(file)
      // Ảnh tự tải lên (đã nén < 1 MB) mới được lưu thẳng vào báo giá
      handleUpdateLineFields(uid, { image_source: 'custom', image_url: compressed.dataUrl })
    } catch (err) {
      alert(err.message || 'Lỗi khi nén ảnh')
    }
  }

  // contractValue (props) = doanh thu, số khách thực trả. Không trừ ưu đãi thêm lần nào.
  const finalTotal = Number(contractValue || 0)
  const safeDiscount = Math.max(0, Number(discount || 0))
  const packagePrice = finalTotal + safeDiscount

  const handleSaveFinance = async () => {
    if (!isManagerOrAdmin || !draftFinance || !financeValid) return
    setSavingContract(true)
    setSyncMsg('')
    setSaveError('')
    try {
      const revenue = draftFinance.grossSales - draftFinance.discount
      const { data, error } = await saveProjectFinance(project.id, {
        contractValue: revenue,
        discount: draftFinance.discount,
      })
      if (error) throw error
      const cv = Number(data?.contract_value ?? revenue)
      const d = Number(data?.discount ?? draftFinance.discount)
      setDraftFinance(null)
      if (onSyncFinance) onSyncFinance({ contractValue: cv, discount: d })
      if (onSyncContractValue) onSyncContractValue(cv)
      setSyncMsg(`✓ Đã lưu giá trị hợp đồng (doanh thu): ${formatCurrency(cv)}`)
    } catch (err) {
      setSaveError(err?.message || 'Không thể lưu giá trị hợp đồng và ưu đãi.')
    } finally {
      setSavingContract(false)
    }
  }

  const handlePushSetsToPlan = async () => {
    if (pushingPlan) return
    const templateIds = quoteLines
      .filter((l) => l.template_id)
      .map((l) => ({ template_id: l.template_id, mult: Number(l.qty || 1) }))
    if (templateIds.length === 0) {
      alert('Chưa có Mẫu set trang trí nào trong báo giá để nạp sang Kế hoạch vật tư.')
      return
    }
    if (!onApplySetsToPlan) return
    setPushingPlan(true)
    setSyncMsg('')
    setActionError('')
    try {
      const res = await onApplySetsToPlan(templateIds)
      if (res?.ok) {
        setSyncMsg(
          `✓ Đã nạp vật tư định mức của các Set đã chọn sang tab Kế hoạch vật tư (${res.count ?? 0} vật tư).`
        )
      } else if (!res?.cancelled) {
        setActionError(res?.error || 'Không nạp được vật tư sang Kế hoạch.')
      }
    } catch (err) {
      setActionError(err?.message || 'Không nạp được vật tư sang Kế hoạch.')
    } finally {
      setPushingPlan(false)
    }
  }

  const handleExportPng = async () => {
    if (quoteLines.length === 0) {
      alert('Vui lòng chọn ít nhất 1 Set trang trí vào báo giá trước khi xuất ảnh.')
      return
    }
    setExportingPng(true)
    setActionError('')
    try {
      await exportQuoteToPng({
        project,
        quoteLines: quoteLines.map((l) => ({ ...l, image_url: resolveLineImage(l, imageMap) })),
        contractValue: finalTotal,
        discount: safeDiscount,
        quoteNote,
      })
    } catch (err) {
      setActionError(
        `Không xuất được ảnh báo giá: ${err?.message || 'lỗi không rõ'}. Thử lại, hoặc bỏ bớt ảnh lỗi/quá lớn trong các hạng mục.`
      )
    } finally {
      setExportingPng(false)
    }
  }

  const handleExportExcel = () => {
    const rows = quoteLines.map((l, i) => ({
      STT: i + 1,
      'Phân loại': l.category || 'Gia tiên',
      'Hạng mục / Mẫu Set Trang Trí': l.name,
      'Danh sách vật tư / Mô tả': l.note || '',
    }))
    if (safeDiscount > 0) {
      rows.push({
        STT: '',
        'Phân loại': '',
        'Hạng mục / Mẫu Set Trang Trí': 'GIÁ GÓI',
        'Danh sách vật tư / Mô tả': formatCurrency(packagePrice),
      })
      rows.push({
        STT: '',
        'Phân loại': '',
        'Hạng mục / Mẫu Set Trang Trí': 'ƯU ĐÃI',
        'Danh sách vật tư / Mô tả': `-${formatCurrency(safeDiscount)}`,
      })
    }
    rows.push({
      STT: '',
      'Phân loại': '',
      'Hạng mục / Mẫu Set Trang Trí': safeDiscount > 0 ? 'GIÁ TRỊ THANH TOÁN' : 'GIÁ TRỊ HỢP ĐỒNG TRỌN GÓI',
      'Danh sách vật tư / Mô tả': formatCurrency(finalTotal),
    })
    exportToExcel(
      rows,
      'BaoGiaDangWedding',
      `bao-gia-dang-wedding-${project?.code || project?.id}.xlsx`
    )
  }

  if (store === 'loading' || store === 'error') {
    return (
      <div className="card">
        {store === 'loading' ? (
          <div className="loading-state">Đang tải báo giá...</div>
        ) : (
          <div className="alert alert-error" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Không tải được báo giá từ hệ thống: {loadError}</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setReloadKey((k) => k + 1)}>
              Tải lại
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {confirmDialog}
      {store === 'local' && isAdmin && (
        <div className="text-xs text-amber">
          ⚠️ Chưa chạy supabase/projects_phase2.sql: báo giá đang chỉ lưu trên trình duyệt của máy này (như cũ).
        </div>
      )}
      {store === 'db' && localOffer && (
        <div className="alert alert-warning" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ flex: '1 1 260px' }}>
            Báo giá này đang lưu riêng trên máy này
            {localOffer.updatedAt ? ` (sửa lúc ${formatSavedTime(localOffer.updatedAt)})` : ''}, CHƯA có trên hệ thống.
            Đưa lên để máy khác cũng thấy. Sửa bất kỳ dòng nào cũng sẽ tự lưu lên hệ thống.
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => flushSave()}>
            Đưa lên hệ thống
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={handleDiscardLocal}>
            Bỏ bản trên máy này
          </button>
        </div>
      )}
      {store === 'db' && draftOffer && (
        <div className="alert alert-warning" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ flex: '1 1 260px' }}>
            Máy này còn một bản nháp CHƯA lưu
            {draftOffer.savedAt ? ` (sửa lúc ${formatSavedTime(draftOffer.savedAt)})` : ''}, nhưng trên hệ thống đã có
            bản mới hơn do máy khác lưu. Đang hiện bản trên hệ thống; bản nháp chưa được áp dụng.
          </span>
          <button type="button" className="btn btn-sm btn-outline" onClick={handleUseDraft}>
            Dùng bản nháp (lưu đè)
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={handleDiscardDraft}>
            Bỏ bản nháp
          </button>
        </div>
      )}
      {store === 'db' && conflict && (
        <div className="alert alert-error" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ flex: '1 1 260px' }}>
            Báo giá vừa được lưu từ máy khác. Thay đổi trên máy này CHƯA được lưu lên hệ thống (không ghi đè ngầm),
            nhưng vẫn giữ làm bản nháp trên máy này.
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={handleReloadLatest}>
            Tải bản mới nhất
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={handleOverwrite}>
            Ghi đè bằng bản của tôi
          </button>
        </div>
      )}
      {store === 'db' && !conflict && saveState.status !== 'idle' && (
        <div
          className={`text-xs ${saveState.status === 'error' ? '' : 'text-muted'}`}
          style={saveState.status === 'error' ? { color: '#dc2626' } : undefined}
        >
          {saveState.status === 'saving' && 'Đang lưu báo giá lên hệ thống...'}
          {saveState.status === 'dirty' && (saveState.message || 'Có thay đổi, sẽ tự lưu...')}
          {saveState.status === 'saved' && `✓ Đã lưu trên hệ thống${saveState.at ? ` lúc ${formatSavedTime(saveState.at)}` : ''}`}
          {saveState.status === 'error' && (
            <>
              {saveState.message}{' '}
              <button type="button" className="btn btn-sm btn-outline" onClick={() => flushSave()}>
                Lưu lại
              </button>
            </>
          )}
        </div>
      )}
      {syncMsg && <div className="alert alert-success">{syncMsg}</div>}
      {actionError && (
        <div className="alert alert-error" style={{ whiteSpace: 'pre-line' }}>
          {actionError}
        </div>
      )}

      {/* BƯỚC 1: CHỌN MẪU SET TRANG TRÍ TỪ HÌNH ẢNH */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <h3>1. Chọn Mẫu Set Trang Trí đưa vào Báo giá (Kèm hình ảnh mẫu)</h3>
            <p className="text-xs text-muted">
              Bấm chọn các mẫu <strong>Gia tiên</strong> hoặc <strong>Mâm quả</strong> bên dưới để
              đưa hình ảnh mẫu vào Phiếu Báo Giá (tuyệt đối không lộ giá vốn vật tư trong kho)
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${filterSetCat === 'all' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilterSetCat('all')}
            >
              Tất cả ({enrichedTemplates.length})
            </button>
            {categoryOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`btn btn-sm ${
                  filterSetCat === opt ? 'btn-primary' : 'btn-outline'
                }`}
                onClick={() => setFilterSetCat(opt)}
              >
                {categoryIcon(opt)} {opt}
              </button>
            ))}
          </div>
        </div>

        {visibleTemplates.length === 0 ? (
          <div className="empty-state">
            Chưa có mẫu set nào trong mục này. Hãy tạo mẫu Gia tiên / Mâm quả kèm hình ảnh tại menu
            &ldquo;✨ Mẫu set trang trí&rdquo;.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: 12,
              marginTop: 10,
            }}
          >
            {visibleTemplates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  border: '1px solid #d5e6dc',
                  borderRadius: 12,
                  padding: 12,
                  background: '#f8fbf9',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {tpl.parsedImageUrl ? (
                    <img
                      src={tpl.parsedImageUrl}
                      alt={tpl.name}
                      onClick={() =>
                        setPreviewImg({ url: tpl.parsedImageUrl, name: tpl.name })
                      }
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        cursor: 'zoom-in',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 10,
                        border: '1px dashed #cbd5e1',
                        background: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        flexShrink: 0,
                      }}
                    >
                      {categoryIcon(tpl.parsedCategory)}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span
                      className={`badge ${
                        tpl.parsedCategory === 'Mâm quả' ? 'badge-blue' : 'badge-green'
                      }`}
                      style={{ marginBottom: 4, display: 'inline-block' }}
                    >
                      {categoryIcon(tpl.parsedCategory)} {tpl.parsedCategory}
                    </span>
                    <div className="font-bold text-sm" style={{ wordBreak: 'break-word' }}>
                      {tpl.name}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary btn-block"
                  onClick={() => handleAddTemplateToQuote(tpl)}
                >
                  + Đưa mẫu này vào Báo giá
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BƯỚC 2: BẢNG PHƯƠNG ÁN TRANG TRÍ & GIÁ TRỊ HỢP ĐỒNG */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div>
            <h3>2. Phương án Trang trí & Báo giá Hợp đồng ({quoteLines.length} mẫu đã chọn)</h3>
            <p className="text-xs text-muted">
              Hiển thị hình ảnh các Set trang trí đã chọn cùng <strong>Giá trị hợp đồng</strong> trọn
              gói để xuất Ảnh Báo Giá (.png) gửi khách hàng
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleAddCustomLine}
            >
              + Thêm hạng mục khác
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handlePushSetsToPlan}
              disabled={pushingPlan || quoteLines.length === 0}
              title="Đưa toàn bộ vật tư của các Set trong báo giá sang tab Kế hoạch vật tư"
            >
              📋 Nạp vật tư sang Kế hoạch
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleExportExcel}
              disabled={quoteLines.length === 0}
            >
              📥 Xuất Excel
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleExportPng}
              disabled={exportingPng || quoteLines.length === 0}
            >
              {exportingPng ? '⏳ Đang tạo ảnh...' : '🖼️ Xuất Ảnh Báo Giá (.png)'}
            </button>
          </div>
        </div>

        {quoteLines.length === 0 ? (
          <div className="empty-state">
            Chưa có mẫu set nào trong báo giá. Hãy bấm{' '}
            <strong>&ldquo;+ Đưa mẫu này vào Báo giá&rdquo;</strong> ở danh sách Mẫu set phía trên!
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Hình ảnh mẫu</th>
                    <th style={{ width: 165 }}>Phân loại</th>
                    <th>Tên Mẫu Set & Các vật tư trong gói</th>
                    <th style={{ width: 55 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {quoteLines.map((line) => {
                    const lineImage = resolveLineImage(line, imageMap)
                    return (
                    <tr key={line.uid}>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            alignItems: 'center',
                          }}
                        >
                          {lineImage ? (
                            <img
                              src={lineImage}
                              alt={line.name}
                              onClick={() =>
                                setPreviewImg({ url: lineImage, name: line.name })
                              }
                              style={{
                                width: 72,
                                height: 72,
                                objectFit: 'cover',
                                borderRadius: 10,
                                border: '1px solid #cbd5e1',
                                cursor: 'zoom-in',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 72,
                                height: 72,
                                borderRadius: 10,
                                border: '1px dashed #cbd5e1',
                                background: '#f8fafc',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 22,
                              }}
                            >
                              🖼️
                            </div>
                          )}
                          <label
                            className="btn-link"
                            style={{ fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}
                          >
                            Đổi ảnh
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) =>
                                handleLineImageUpload(line.uid, e.target.files?.[0])
                              }
                            />
                          </label>
                        </div>
                      </td>
                      <td>
                        <select
                          value={canonicalCategory(line.category || 'Gia tiên', categoryOptions)}
                          onChange={(e) =>
                            handleUpdateLine(line.uid, 'category', e.target.value)
                          }
                        >
                          {categoryOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {categoryIcon(opt)} {opt}
                            </option>
                          ))}
                          {!categoryOptions.some((opt) => categoryKey(opt) === categoryKey('Hạng mục khác')) && (
                            <option value="Hạng mục khác">✨ Hạng mục khác</option>
                          )}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="Tên gói set trang trí..."
                          value={line.name}
                          onChange={(e) =>
                            handleUpdateLine(line.uid, 'name', e.target.value)
                          }
                          style={{ fontWeight: 600, marginBottom: 6 }}
                        />
                        <input
                          type="text"
                          placeholder="Các vật tư trong gói / Ghi chú (chỉ hiện tên vật tư, không hiện số lượng)..."
                          value={line.note || ''}
                          onChange={(e) =>
                            handleUpdateLine(line.uid, 'note', e.target.value)
                          }
                          style={{ fontSize: '0.82rem', color: '#475569' }}
                        />
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          style={{ color: '#dc2626', borderColor: '#fecaca' }}
                          onClick={() => handleRemoveLine(line.uid)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Khung Giá trị hợp đồng hiển thị trên Báo giá */}
            <div
              className="sub-card"
              style={{
                marginTop: 16,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 16,
                alignItems: 'end',
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label>Ghi chú cuối Phiếu Báo Giá</label>
                <input
                  type="text"
                  placeholder="VD: Giá trọn gói đã bao gồm lắp đặt & tháo dỡ..."
                  value={quoteNote}
                  onChange={(e) => {
                    setQuoteNote(e.target.value)
                    persistQuote(quoteLines, e.target.value)
                  }}
                />
              </div>

              {isManagerOrAdmin && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 12,
                      alignItems: 'start',
                    }}
                  >
                    <ContractValueFields
                      key={`${project?.id}-${finalTotal}-${safeDiscount}`}
                      grossSales={packagePrice}
                      discount={safeDiscount}
                      canEdit
                      canSeeDiscount
                      onChange={(v) => setDraftFinance(v)}
                      onValidChange={(ok) => setFinanceValid(ok)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ whiteSpace: 'nowrap', marginTop: 8 }}
                    disabled={savingContract || !financeValid || !draftFinance}
                    onClick={handleSaveFinance}
                  >
                    {savingContract ? 'Đang lưu...' : 'Lưu giá HĐ & ưu đãi'}
                  </button>
                  {saveError && (
                    <div style={{ color: '#dc2626', fontSize: '0.85em', marginTop: 4 }}>
                      {saveError}
                    </div>
                  )}
                </div>
              )}

              <div style={{ textAlign: 'right' }}>
                {safeDiscount > 0 && (
                  <div className="text-xs text-muted">
                    Giá gói: {formatCurrency(packagePrice)} • Ưu đãi: -{formatCurrency(safeDiscount)}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    color: '#15803d',
                    marginTop: 4,
                  }}
                >
                  {safeDiscount > 0 ? 'Giá trị thanh toán' : 'Giá trị hợp đồng'}: {formatCurrency(finalTotal)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Lightbox phóng to ảnh */}
      {previewImg && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewImg(null)}
          style={{ zIndex: 100 }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 680, textAlign: 'center' }}
          >
            <div className="modal-header">
              <h3>{previewImg.name}</h3>
              <button className="btn-icon" onClick={() => setPreviewImg(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <img
                src={previewImg.url}
                alt={previewImg.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '72vh',
                  borderRadius: 12,
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
