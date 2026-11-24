import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  KIND_LABELS,
  ITEM_CATEGORY_PRESETS,
  ITEM_COLOR_PRESETS,
  getColorSwatch,
  formatColorWithIcon,
  extractItemColor,
  extractItemCleanNote,
  packNoteWithColorFallback,
  generateItemCode,
  findDuplicateCode,
} from '../lib/formatters'
import {
  buildCategoryOptions,
  deriveCategoriesFromItems,
  findDuplicateCategory,
  findSimilarCategories,
  generateCategoryCode,
  isItemCodeLocked,
} from '../lib/itemCategories'
import { generateItemCodeFromCategory } from '../lib/itemCode'
import ItemsList from '../components/items/ItemsList'
import { exportToExcel } from '../lib/exportExcel'
import CurrencyInput from '../components/CurrencyInput'
import { compressImageUnder1MB, formatBytes } from '../lib/imageCompressor'

// Lỗi do bảng/cột chưa tồn tại (supabase/item_categories.sql chưa chạy).
function isMissingTableError(err) {
  const msg = String(err?.message || '').toLowerCase()
  return (
    err?.code === '42P01' ||
    err?.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table')
  )
}

function describeCategoryError(err) {
  const msg = String(err?.message || '')
  const low = msg.toLowerCase()
  if (isMissingTableError(err)) {
    return 'Chưa có bảng nhóm vật tư. Hãy nhờ quản trị chạy supabase/item_categories.sql.'
  }
  if (err?.code === '42501' || low.includes('row-level security') || low.includes('permission denied')) {
    return 'Tài khoản của bạn không có quyền tạo nhóm vật tư. Hãy báo quản trị viên.'
  }
  if (err?.code === '23505' || low.includes('duplicate key') || low.includes('unique')) {
    return 'Nhóm này đã tồn tại (trùng tên trong cùng nhóm cha hoặc trùng mã nhóm). Hãy chọn nhóm có sẵn.'
  }
  if (err?.code === '23514' || low.includes('check constraint')) {
    return 'Tên hoặc mã nhóm không hợp lệ. Hãy đặt tên khác.'
  }
  return `Không tạo được nhóm: ${msg || 'lỗi không xác định'}`
}

const INITIAL_FORM = {
  code: '',
  name: '',
  category: '',
  category_id: '', // nhóm cha (chỉ dùng khi đã có bảng item_categories)
  subcategory_id: '', // nhóm con, tùy chọn
  color: '',
  kind: 'consumable',
  unit: 'cái',
  cost: 0,
  min_stock: 0,
  expected_uses: '',
  image_url: '',
  note: '',
  active: true,
}

export default function ItemsPage() {
  const { canEditCatalog, canDeleteCatalog, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [showCodeRules, setShowCodeRules] = useState(false)
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const [isCustomColor, setIsCustomColor] = useState(false)
  const [imageCompressing, setImageCompressing] = useState(false)
  const [imageStats, setImageStats] = useState(null)

  // Nhóm vật tư (bảng item_categories). status: 'loading' | 'ready' | 'missing' | 'error'
  const [categoryRows, setCategoryRows] = useState([])
  const [categoriesStatus, setCategoriesStatus] = useState('loading')
  // Khóa mã khi sửa: đã có phiếu kho thì không đổi mã
  const [codeLock, setCodeLock] = useState({ checking: false, locked: false })
  const codeLockReq = useRef(0)
  // Khung "+ Thêm nhóm" trong form: { parentId: null | id, name }
  const [newCat, setNewCat] = useState(null)
  const [newCatError, setNewCatError] = useState('')
  const [newCatSaving, setNewCatSaving] = useState(false)
  // 'save' | 'receive' (nút nào vừa được bấm)
  const saveMode = useRef('save')

  const loadItems = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('item_stock')
        .select('*')
        .order('name', { ascending: true })
      if (err) throw err
      setItems(data || [])

      const { data: catData, error: catErr } = await supabase
        .from('item_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (catErr) {
        if (isMissingTableError(catErr)) {
          setCategoryRows([])
          setCategoriesStatus('missing')
        } else {
          setCategoriesStatus('error')
          throw catErr
        }
      } else {
        setCategoryRows(catData || [])
        setCategoriesStatus('ready')
      }
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách vật tư')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  const categoriesReady = categoriesStatus === 'ready'
  // Nhóm chuẩn để ghép vào ItemsList: bảng item_categories, hoặc nhóm suy ra từ chữ gõ tay khi chưa có bảng.
  const itemCategories = useMemo(
    () => (categoriesStatus === 'ready' ? categoryRows : deriveCategoriesFromItems(items)),
    [categoriesStatus, categoryRows, items]
  )

  // Danh sách tên nhóm dạng chữ (giữ cho khối bộ lọc cũ và chế độ chưa có bảng nhóm)
  const categories = useMemo(() => {
    const set = new Set()
    for (const i of items) {
      if (i.category && i.category.trim()) set.add(i.category.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'))
  }, [items])

  // Danh sách nhóm để chọn trong form: gộp các nhóm đã tồn tại + các nhóm chuẩn ngành cưới
  const selectableCategories = useMemo(() => {
    const map = new Map()
    for (const c of categories) {
      map.set(c.toLowerCase(), { name: c, isExisting: true })
    }
    for (const p of ITEM_CATEGORY_PRESETS) {
      if (!map.has(p.name.toLowerCase())) {
        map.set(p.name.toLowerCase(), { name: p.name, isExisting: false })
      }
    }
    return Array.from(map.values())
  }, [categories])

  const colors = useMemo(() => {
    const set = new Set()
    for (const i of items) {
      const c = extractItemColor(i)
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'))
  }, [items])

  const selectableColors = useMemo(() => {
    const map = new Map()
    for (const c of colors) {
      map.set(c.toLowerCase(), { name: c, isExisting: true })
    }
    for (const p of ITEM_COLOR_PRESETS) {
      if (!map.has(p.name.toLowerCase())) {
        map.set(p.name.toLowerCase(), { name: p.name, isExisting: false })
      }
    }
    return Array.from(map.values())
  }, [colors])

  const findCategory = (id) =>
    id === '' || id == null ? null : categoryRows.find((c) => String(c.id) === String(id)) || null

  // Nhóm dùng để sinh mã và ghi category_id: nhóm con nếu có, không thì nhóm cha.
  const effectiveCategory = (f) =>
    categoriesReady ? findCategory(f.subcategory_id) || findCategory(f.category_id) : null

  const makeCode = (kind, catRow, categoryName, list, excludeId = null) =>
    categoriesReady && catRow?.code
      ? generateItemCodeFromCategory(kind, catRow.code, list, excludeId)
      : generateItemCode(kind, categoryName, list, excludeId)

  const resetNewCat = () => {
    setNewCat(null)
    setNewCatError('')
  }

  const openCreateModal = () => {
    setEditingItem(null)
    setIsCustomCategory(false)
    setIsCustomColor(false)
    setImageStats(null)
    setCodeLock({ checking: false, locked: false })
    resetNewCat()
    const defaultKind = 'consumable'
    if (categoriesReady) {
      const firstRoot = buildCategoryOptions(categoryRows).find((c) => c.parent_id == null)
      const kind = firstRoot?.default_kind || defaultKind
      setForm({
        ...INITIAL_FORM,
        kind,
        category: firstRoot?.name || '',
        category_id: firstRoot?.id ?? '',
        unit: firstRoot?.default_unit || 'cái',
        code: makeCode(kind, firstRoot, firstRoot?.name || '', items),
      })
      setModalOpen(true)
      return
    }
    const defaultCategory = categories[0] || 'Hoa & Lá'
    const preset = ITEM_CATEGORY_PRESETS.find(
      (p) => p.name.toLowerCase() === defaultCategory.toLowerCase()
    )
    setForm({
      ...INITIAL_FORM,
      kind: defaultKind,
      category: defaultCategory,
      unit: preset?.unit || 'cái',
      code: generateItemCode(defaultKind, defaultCategory, items),
    })
    setModalOpen(true)
  }

  // Đổi loại (hoặc nhóm chữ khi chưa có bảng nhóm). Khi sửa vật tư thì không tự đổi mã.
  const handleKindOrCategoryChange = (newKind, newCategory) => {
    const preset = ITEM_CATEGORY_PRESETS.find(
      (p) => p.name.toLowerCase() === (newCategory || '').trim().toLowerCase()
    )
    const nextUnit = !editingItem && preset && !categoriesReady ? preset.unit : form.unit
    const nextCode = !editingItem
      ? makeCode(newKind, effectiveCategory(form), newCategory, items)
      : form.code
    setForm({
      ...form,
      kind: newKind,
      category: newCategory,
      unit: nextUnit,
      code: nextCode,
    })
  }

  // Chọn nhóm cha + nhóm con (hàng của bảng item_categories). Thêm mới thì đặt sẵn loại/đơn vị mặc định.
  const applyCategory = (parentRow, childRow = null) => {
    const eff = childRow || parentRow
    setForm((prev) => {
      const next = {
        ...prev,
        category_id: parentRow?.id ?? '',
        subcategory_id: childRow?.id ?? '',
        category: parentRow?.name ?? '',
      }
      if (editingItem) return next
      const defKind = eff?.default_kind || parentRow?.default_kind
      const defUnit = eff?.default_unit || parentRow?.default_unit
      if (defKind) next.kind = defKind
      if (defUnit) next.unit = defUnit
      next.code = makeCode(next.kind, eff, next.category, items)
      return next
    })
  }

  const openEditModal = (item) => {
    setEditingItem(item)
    setIsCustomCategory(false)
    setIsCustomColor(false)
    setImageStats(null)
    resetNewCat()

    let categoryId = ''
    let subcategoryId = ''
    if (categoriesReady) {
      const own = findCategory(item.category_id)
      if (own && own.parent_id != null && findCategory(own.parent_id)) {
        categoryId = own.parent_id
        subcategoryId = own.id
      } else if (own) {
        categoryId = own.id
      } else if (item.category) {
        // Vật tư cũ chưa có category_id: ghép theo tên nhóm cha
        const name = String(item.category).trim().toLowerCase()
        const byName = categoryRows.find(
          (c) => c.parent_id == null && String(c.name).trim().toLowerCase() === name
        )
        if (byName) categoryId = byName.id
      }
    }
    setForm({
      code: item.code || '',
      name: item.name || '',
      category: item.category || '',
      category_id: categoryId,
      subcategory_id: subcategoryId,
      color: extractItemColor(item),
      kind: item.kind || 'consumable',
      unit: item.unit || 'cái',
      cost: item.cost ?? 0,
      min_stock: item.min_stock ?? 0,
      expected_uses: item.expected_uses ?? '',
      image_url: item.image_url || '',
      note: extractItemCleanNote(item),
      active: item.active ?? true,
    })
    setModalOpen(true)
    checkCodeLock(item)
  }

  // Đếm phiếu kho của vật tư để biết có khóa mã hay không (chưa biết kết quả thì khóa tạm).
  const checkCodeLock = async (item) => {
    const req = ++codeLockReq.current
    setCodeLock({ checking: true, locked: true })
    let count = 0
    let failed = false
    try {
      const { count: movCount, error: movErr } = await supabase
        .from('stock_movements')
        .select('id', { count: 'exact', head: true })
        .eq('item_id', item.id)
      if (movErr) throw movErr
      count += movCount || 0
      if (count === 0) {
        // Bảng chuyển kho có thể chưa có hoặc không đọc được: bỏ qua lỗi, chỉ cộng khi đọc được.
        const { count: trCount, error: trErr } = await supabase
          .from('stock_transfers')
          .select('id', { count: 'exact', head: true })
          .eq('item_id', item.id)
        if (!trErr) count += trCount || 0
      }
    } catch (err) {
      failed = true
      if (req === codeLockReq.current) {
        setError(`Không kiểm tra được phiếu kho của vật tư nên tạm khóa mã: ${err.message || 'lỗi không xác định'}`)
      }
    }
    if (req !== codeLockReq.current) return
    setCodeLock({ checking: false, locked: failed || isItemCodeLocked(item, count) })
  }

  const closeModal = () => {
    codeLockReq.current += 1
    setModalOpen(false)
  }

  const subcategories = useMemo(() => {
    if (!categoriesReady || form.category_id === '') return []
    return buildCategoryOptions(categoryRows, form.subcategory_id || null).filter(
      (c) => String(c.parent_id) === String(form.category_id)
    )
  }, [categoriesReady, categoryRows, form.category_id, form.subcategory_id])

  const parentOptions = useMemo(
    () =>
      categoriesReady
        ? buildCategoryOptions(categoryRows, form.category_id || null).filter((c) => c.parent_id == null)
        : [],
    [categoriesReady, categoryRows, form.category_id]
  )

  // Nhóm cùng cấp với nhóm đang định tạo (để kiểm trùng và gợi ý)
  const newCatSiblings = useMemo(
    () =>
      newCat
        ? categoryRows.filter((c) => String(c.parent_id ?? '') === String(newCat.parentId ?? ''))
        : [],
    [newCat, categoryRows]
  )
  const newCatDuplicate = useMemo(
    () => (newCat ? findDuplicateCategory(newCat.name, newCat.parentId, categoryRows) : null),
    [newCat, categoryRows]
  )
  const newCatSimilar = useMemo(
    () => (newCat && newCat.name.trim() ? findSimilarCategories(newCat.name, newCatSiblings) : []),
    [newCat, newCatSiblings]
  )

  const pickExistingCategory = (cat) => {
    if (cat.parent_id == null) applyCategory(cat, null)
    else applyCategory(findCategory(cat.parent_id), cat)
    resetNewCat()
  }

  const handleCreateCategory = async () => {
    if (!newCat) return
    const name = newCat.name.trim().replace(/\s+/g, ' ')
    if (!name) {
      setNewCatError('Hãy nhập tên nhóm.')
      return
    }
    if (newCatDuplicate) {
      setNewCatError(`Nhóm "${newCatDuplicate.name}" đã có. Hãy chọn nhóm này thay vì tạo mới.`)
      return
    }
    setNewCatSaving(true)
    setNewCatError('')
    try {
      const row = {
        name,
        code: generateCategoryCode(name, categoryRows),
        parent_id: newCat.parentId ?? null,
        default_kind: form.kind || null,
        default_unit: form.unit.trim() || null,
      }
      const { data, error: err } = await supabase
        .from('item_categories')
        .insert([row])
        .select()
        .single()
      if (err) throw err
      setCategoryRows((prev) => [...prev, data])
      if (data.parent_id == null) applyCategory(data, null)
      else applyCategory(findCategory(data.parent_id), data)
      resetNewCat()
    } catch (err) {
      setNewCatError(describeCategoryError(err))
    } finally {
      setNewCatSaving(false)
    }
  }

  const duplicateItem = useMemo(
    () => findDuplicateCode(form.code, items, editingItem?.id),
    [form.code, items, editingItem]
  )

  const handleImageFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageCompressing(true)
    setError('')
    try {
      const res = await compressImageUnder1MB(file)
      setForm((prev) => ({ ...prev, image_url: res.dataUrl }))
      setImageStats(res)
    } catch (err) {
      setError(err.message || 'Lỗi khi xử lý hình ảnh')
    } finally {
      setImageCompressing(false)
      e.target.value = ''
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const receiveAfter = saveMode.current === 'receive' && !editingItem && canEditCatalog
    saveMode.current = 'save'
    const codeLocked = Boolean(editingItem) && codeLock.locked
    if (codeLock.checking) return
    if (duplicateItem && !codeLocked) {
      setError(`Mã "${form.code}" đã trùng với vật tư "${duplicateItem.name}". Vui lòng bấm "⚡ Sinh mã" để lấy mã kế tiếp.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      let finalCode = form.code.trim().toUpperCase() || null
      const catRow = effectiveCategory(form)

      // Kiểm tra lại trên database phòng trường hợp nhiều người cùng nhập một lúc (mã đã khóa thì không đổi nên bỏ qua)
      if (finalCode && !codeLocked) {
        let checkQuery = supabase
          .from('items')
          .select('id, code, name')
          .ilike('code', finalCode)
        if (editingItem?.id) {
          checkQuery = checkQuery.neq('id', editingItem.id)
        }
        const { data: dupRows } = await checkQuery
        if (dupRows && dupRows.length > 0) {
          const freshRes = await supabase.from('items').select('id, code')
          const nextAvailable = makeCode(
            form.kind,
            catRow,
            form.category,
            freshRes.data || items,
            editingItem?.id
          )
          setForm((prev) => ({ ...prev, code: nextAvailable }))
          throw new Error(
            `Mã "${finalCode}" vừa được dùng cho "${dupRows[0].name}". Hệ thống đã tự động đổi sang mã mới chưa trùng: ${nextAvailable}. Hãy bấm Lưu vật tư một lần nữa!`
          )
        }
      }

      const payload = {
        code: finalCode,
        name: form.name.trim(),
        // Giữ cột chữ cũ = tên nhóm cha để báo cáo, mẫu set, xuất Excel không vỡ
        category: form.category.trim() || null,
        kind: form.kind,
        unit: form.unit.trim() || 'cái',
        cost: Number(form.cost || 0),
        min_stock: Number(form.min_stock || 0),
        expected_uses:
          form.kind === 'reusable' && form.expected_uses && Number(form.expected_uses) > 0
            ? Math.round(Number(form.expected_uses))
            : null,
        image_url: form.image_url.trim() || null,
        note: packNoteWithColorFallback(form.color, form.note),
        active: Boolean(form.active),
        color: form.color.trim() || null,
      }
      // Chỉ gửi category_id khi đã có bảng nhóm (chưa có thì bỏ để khỏi lỗi cột)
      if (categoriesReady) {
        payload.category_id = catRow?.id ?? null
        // Cột chữ lấy tên nhóm cha từ bảng nhóm (không dùng chữ cũ trong form), để người khác đổi tên nhóm
        // lúc đang sửa không làm vật tư rời nhóm
        const parentRow = catRow?.parent_id ? findCategory(catRow.parent_id) : catRow
        if (parentRow) payload.category = parentRow.name
      }

      const saveRow = async (pl) => {
        if (editingItem) {
          return supabase.from('items').update(pl).eq('id', editingItem.id)
        }
        if (receiveAfter) {
          return supabase.from('items').insert([pl]).select('id').single()
        }
        return supabase.from('items').insert([pl])
      }

      let res = await saveRow(payload)
      // Fallback nếu database trên Supabase chưa chạy lệnh thêm cột color / category_id
      if (res.error && String(res.error.message || '').toLowerCase().includes('color')) {
        delete payload.color
        res = await saveRow(payload)
      }
      // Chỉ bỏ category_id khi lỗi là thiếu cột (42703 / PGRST204), không nuốt lỗi khóa ngoại
      if (
        res.error &&
        (res.error.code === '42703' || res.error.code === 'PGRST204') &&
        String(res.error.message || '').toLowerCase().includes('category_id')
      ) {
        delete payload.category_id
        res = await saveRow(payload)
      }
      if (res.error) throw res.error

      closeModal()
      if (receiveAfter && res.data?.id != null) {
        navigate(`/phieu-kho?item=${encodeURIComponent(res.data.id)}`)
        return
      }
      await loadItems()
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu vật tư')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (item) => {
    const actionLabel = item.active ? 'ngưng sử dụng' : 'kích hoạt lại'
    if (!window.confirm(`Bạn có chắc muốn ${actionLabel} vật tư "${item.name}"?`)) return
    try {
      const { error: err } = await supabase
        .from('items')
        .update({ active: !item.active })
        .eq('id', item.id)
      if (err) throw err
      await loadItems()
    } catch (err) {
      setError(err.message || 'Không thể cập nhật trạng thái vật tư')
    }
  }

  const handleDeleteItem = async (item) => {
    if (
      !window.confirm(
        `Bạn có chắc chắn muốn XÓA VĨNH VIỄN vật tư "${item.name}" (${item.code || `#${item.id}`})?\n\nLưu ý: Mọi lịch sử phiếu kho, kế hoạch dự án và mẫu set gắn với vật tư này cũng sẽ bị xóa.`
      )
    ) {
      return
    }
    setError('')
    try {
      // Xóa các bản ghi phụ thuộc trước để không vướng khóa ngoại (Foreign Key).
      // Xóa phiếu kho TRƯỚC: nếu trigger chặn thì kế hoạch dự án / mẫu set vẫn còn nguyên.
      const { error: errMov } = await supabase.from('stock_movements').delete().eq('item_id', item.id)
      if (errMov) throw errMov
      const { error: errPlan } = await supabase.from('project_plan').delete().eq('item_id', item.id)
      if (errPlan) throw errPlan
      const { error: errTpl } = await supabase.from('set_template_items').delete().eq('item_id', item.id)
      if (errTpl) throw errTpl

      const { error: err } = await supabase.from('items').delete().eq('id', item.id)
      if (err) throw err
      await loadItems()
    } catch (err) {
      setError(
        err.message ||
          'Không thể xóa vật tư (chỉ Quản trị / Quản lý mới có quyền xóa hoặc vật tư đang có phiếu kho mà bạn không có quyền xóa).'
      )
    }
  }

  const handleExport = () => {
    const rows = items.filter((i) => i.active).map((i) => ({
      'Mã vật tư': i.code || '',
      'Tên vật tư': i.name,
      'Danh mục': i.category || '',
      'Màu sắc': extractItemColor(i),
      'Phân loại': KIND_LABELS[i.kind] || i.kind,
      'Đơn vị': i.unit,
      'Giá nhập (₫)': Number(i.cost || 0),
      'Trong kho': Number(i.in_stock || 0),
      'Đang ở dự án': Number(i.at_project || 0),
      'Chờ sửa': Number(i.in_repair || 0),
      'Tổng mất': Number(i.lost_total || 0),
      'Tồn tối thiểu': Number(i.min_stock || 0),
      'Số lần dùng dự kiến': i.expected_uses || '',
      'Trạng thái': i.active ? 'Đang dùng' : 'Ngưng dùng',
      'Ghi chú': extractItemCleanNote(i),
    }))
    exportToExcel(rows, 'DanhSachVatTu', 'danh-sach-vat-tu.xlsx')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Danh mục Vật tư</h1>
          <p className="text-muted">
            Quản lý vật tư tiêu hao & đồ trang trí tái sử dụng, theo dõi tồn kho tức thời
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setShowCodeRules((v) => !v)}
          >
            🏷️ Quy tắc đặt mã
          </button>
          <button className="btn btn-outline" onClick={handleExport}>
            📥 Xuất Excel
          </button>
          {canEditCatalog && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Thêm vật tư
            </button>
          )}
        </div>
      </div>

      {showCodeRules && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #16a34a' }}>
          <h3 style={{ marginBottom: 8 }}>🏷️ Quy tắc đặt mã Vật tư chuẩn ngành Trang trí</h3>
          <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Cấu trúc tự động: <code>[LOẠI]-[NHÓM]-[SỐ THỨ TỰ 3 CHỮ SỐ]</code> (Hệ thống tự sinh mã
            tiếp theo khi bạn bấm Thêm vật tư)
          </p>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tiền tố loại</th>
                  <th>Mã nhóm gợi ý</th>
                  <th>Ví dụ mã chuẩn</th>
                  <th>Giải thích</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="badge badge-green">TH</span> (Tiêu hao)
                  </td>
                  <td>
                    <code>HOA</code>, <code>BONG</code>, <code>PHU</code>, <code>IN</code>,{' '}
                    <code>NEN</code>
                  </td>
                  <td>
                    <code>TH-HOA-001</code>, <code>TH-BONG-002</code>
                  </td>
                  <td>Hàng dùng 1 lần (hoa tươi, bóng bay, băng keo, formex in...)</td>
                </tr>
                <tr>
                  <td>
                    <span className="badge badge-blue">TSD</span> (Tái sử dụng)
                  </td>
                  <td>
                    <code>KHUNG</code>, <code>DEN</code>, <code>VAI</code>, <code>HOALUA</code>,{' '}
                    <code>BAN</code>, <code>DAOCU</code>, <code>DC</code>
                  </td>
                  <td>
                    <code>TSD-KHUNG-001</code>, <code>TSD-DEN-002</code>
                  </td>
                  <td>Đồ trang trí & dụng cụ xuất đi phải thu hồi sau dự án</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {isAdmin && categoriesStatus === 'missing' && (
        <div className="ui-hint" style={{ marginBottom: 12 }}>
          Chưa có bảng nhóm vật tư, đang dùng nhóm gõ tay. Chạy supabase/item_categories.sql để bật nhóm chuẩn.
        </div>
      )}

      {/* Danh sách phân cấp: Loại → Nhóm → Vật tư */}
      {loading && items.length === 0 ? (
        <div className="card">
          <div className="loading-state">Đang tải danh sách vật tư...</div>
        </div>
      ) : (
        <ItemsList
          items={items}
          categories={itemCategories}
          canEditCatalog={canEditCatalog}
          canDeleteCatalog={canDeleteCatalog}
          showCost
          onEdit={openEditModal}
          onToggleActive={handleToggleActive}
          onDelete={handleDeleteItem}
          onCategoriesChanged={loadItems}
        />
      )}

      {/* Modal Thêm / Sửa vật tư */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingItem ? 'Cập nhật vật tư' : 'Thêm vật tư mới'}</h3>
              <button className="btn-icon" onClick={closeModal}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSave} className="modal-body">
              {/* Hàng 1: Phân loại + Danh mục (2 cột trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Phân loại *</label>
                  <select
                    value={form.kind}
                    onChange={(e) => handleKindOrCategoryChange(e.target.value, form.category)}
                  >
                    <option value="consumable">🟢 Tiêu hao (1 lần)</option>
                    <option value="reusable">🔵 Tái sử dụng</option>
                  </select>
                </div>
                {categoriesReady ? (
                  <div className="form-group">
                    <label>Nhóm *</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="ui-select"
                        required
                        value={form.category_id === '' ? '' : String(form.category_id)}
                        onChange={(e) => {
                          const row = findCategory(e.target.value)
                          applyCategory(row, null)
                        }}
                      >
                        <option value="">-- Chọn nhóm --</option>
                        {parentOptions.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        style={{ flexShrink: 0 }}
                        onClick={() => {
                          setNewCat({ parentId: null, name: '' })
                          setNewCatError('')
                        }}
                      >
                        + Thêm nhóm
                      </button>
                    </div>
                  </div>
                ) : (
                <div className="form-group">
                  <label>Danh mục / Nhóm</label>
                  {!isCustomCategory ? (
                    <select
                      value={form.category}
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsCustomCategory(true)
                          handleKindOrCategoryChange(form.kind, '')
                        } else {
                          handleKindOrCategoryChange(form.kind, e.target.value)
                        }
                      }}
                    >
                      <option value="">-- Chọn nhóm --</option>
                      {categories.length > 0 && (
                        <optgroup label="Nhóm đã có trong kho">
                          {categories.map((c) => (
                            <option key={`exist-${c}`} value={c}>
                              {c}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Nhóm gợi ý ngành trang trí">
                        {selectableCategories
                          .filter((c) => !c.isExisting)
                          .map((c) => (
                            <option key={`preset-${c.name}`} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                      <option value="__NEW__">+ Tạo nhóm mới...</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Tên nhóm mới..."
                        value={form.category}
                        onChange={(e) => handleKindOrCategoryChange(form.kind, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setIsCustomCategory(false)
                          const fallbackCat = categories[0] || 'Hoa & Lá'
                          handleKindOrCategoryChange(form.kind, fallbackCat)
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                )}
              </div>

              {categoriesReady && (
                <div className="form-group">
                  <label>Nhóm con (tùy chọn)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      className="ui-select"
                      value={form.subcategory_id === '' ? '' : String(form.subcategory_id)}
                      disabled={form.category_id === ''}
                      onChange={(e) =>
                        applyCategory(findCategory(form.category_id), findCategory(e.target.value))
                      }
                    >
                      <option value="">-- Không chọn nhóm con --</option>
                      {subcategories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      style={{ flexShrink: 0 }}
                      disabled={form.category_id === ''}
                      onClick={() => {
                        setNewCat({ parentId: form.category_id, name: '' })
                        setNewCatError('')
                      }}
                    >
                      + Thêm nhóm con
                    </button>
                  </div>
                </div>
              )}

              {categoriesReady && newCat && (
                <div className="ui-card ui-card__body ui-stack ui-stack--sm" style={{ marginBottom: 12 }}>
                  <strong>
                    {newCat.parentId == null
                      ? 'Thêm nhóm mới'
                      : `Thêm nhóm con của "${findCategory(newCat.parentId)?.name || ''}"`}
                  </strong>
                  <input
                    type="text"
                    className={`ui-input${newCatDuplicate ? ' is-invalid' : ''}`}
                    autoFocus
                    placeholder="Tên nhóm..."
                    value={newCat.name}
                    onChange={(e) => {
                      setNewCat({ ...newCat, name: e.target.value })
                      setNewCatError('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleCreateCategory()
                      }
                    }}
                  />
                  {newCatDuplicate && (
                    <div className="ui-error">
                      Nhóm &quot;{newCatDuplicate.name}&quot; đã có, không thể tạo trùng. Hãy chọn nhóm có sẵn.
                    </div>
                  )}
                  {!newCatDuplicate && newCatSimilar.length > 0 && (
                    <div className="ui-hint">
                      Có phải ý anh là:{' '}
                      {newCatSimilar.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="ui-btn ui-btn--ghost ui-btn--sm"
                            style={{ textDecoration: 'underline' }}
                            onClick={() => pickExistingCategory(c)}
                          >
                            {c.name}
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {newCat.name.trim() && !newCatDuplicate && (
                    <div className="ui-hint">
                      Mã nhóm tự sinh: <code>{generateCategoryCode(newCat.name, categoryRows)}</code>
                    </div>
                  )}
                  {newCatError && <div className="ui-error">{newCatError}</div>}
                  <div className="ui-btn-group ui-btn-group--end">
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={resetNewCat}>
                      Hủy
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn--primary ui-btn--sm"
                      disabled={newCatSaving || !newCat.name.trim() || Boolean(newCatDuplicate)}
                      onClick={handleCreateCategory}
                    >
                      {newCatSaving ? 'Đang tạo...' : 'Tạo nhóm'}
                    </button>
                  </div>
                </div>
              )}

              {/* Hàng 2: Mã vật tư + Đơn vị tính (2 cột trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>
                    Mã vật tư{' '}
                    {duplicateItem && !(editingItem && codeLock.locked) ? (
                      <span className="text-red">(⚠️ Trùng)</span>
                    ) : form.code.trim() ? (
                      <span className="text-green">(✓ Hợp lệ)</span>
                    ) : null}
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="text"
                      placeholder="TH-HOA-001"
                      value={form.code}
                      disabled={Boolean(editingItem) && codeLock.locked}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      style={
                        duplicateItem && !(editingItem && codeLock.locked)
                          ? { borderColor: '#dc2626', backgroundColor: '#fef2f2' }
                          : undefined
                      }
                    />
                    {!(editingItem && codeLock.locked) && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        title="Sinh mã tự động không trùng"
                        onClick={() =>
                          setForm({
                            ...form,
                            code: makeCode(
                              form.kind,
                              effectiveCategory(form),
                              form.category,
                              items,
                              editingItem?.id
                            ),
                          })
                        }
                        style={{ padding: '0 8px', flexShrink: 0 }}
                      >
                        ⚡
                      </button>
                    )}
                  </div>
                  {editingItem && codeLock.locked && (
                    <div className="ui-hint">
                      {codeLock.checking
                        ? 'Đang kiểm tra phiếu kho của vật tư...'
                        : 'Mã đã khóa vì vật tư đã có phiếu kho'}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Đơn vị tính *</label>
                  <input
                    type="text"
                    required
                    placeholder="cái, bộ, bó, mét..."
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
              </div>

              {/* Hàng 3: Tên vật tư */}
              <div className="form-group">
                <label>Tên vật tư *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Khung backdrop tròn 2.2m / Hoa lụa..."
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              {/* Hàng 4: Màu sắc + Hình ảnh (2 cột gọn trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Màu sắc</label>
                  {!isCustomColor ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {form.color && (
                        <span
                          title={form.color}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            backgroundColor: getColorSwatch(form.color)?.hex || '#e2e8f0',
                            border: `1.5px solid ${getColorSwatch(form.color)?.border || '#94a3b8'}`,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <select
                        style={{ flex: 1 }}
                        value={form.color}
                        onChange={(e) => {
                          if (e.target.value === '__NEW_COLOR__') {
                            setIsCustomColor(true)
                            setForm({ ...form, color: '' })
                          } else {
                            setForm({ ...form, color: e.target.value })
                          }
                        }}
                      >
                        <option value="">-- Chọn màu --</option>
                        {colors.length > 0 && (
                          <optgroup label="Màu đã có trong kho">
                            {colors.map((c) => (
                              <option key={`exist-color-${c}`} value={c}>
                                {formatColorWithIcon(c)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Màu gợi ý ngành cưới">
                          {selectableColors
                            .filter((c) => !c.isExisting)
                            .map((c) => (
                              <option key={`preset-color-${c.name}`} value={c.name}>
                                {formatColorWithIcon(c.name)}
                              </option>
                            ))}
                        </optgroup>
                        <option value="__NEW_COLOR__">+ Màu mới...</option>
                      </select>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Tên màu mới..."
                        value={form.color}
                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setIsCustomColor(false)
                          setForm({ ...form, color: colors[0] || 'Trắng' })
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>
                    Hình ảnh{' '}
                    {imageStats ? (
                      <span className="text-green">({formatBytes(imageStats.compressedSize)})</span>
                    ) : (
                      <span className="text-muted">(&lt;1MB)</span>
                    )}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {form.image_url && (
                      <img
                        src={form.image_url}
                        alt="Ảnh"
                        style={{
                          width: 34,
                          height: 34,
                          objectFit: 'cover',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <label
                      className="btn btn-outline btn-sm"
                      style={{
                        cursor: 'pointer',
                        margin: 0,
                        flex: 1,
                        height: 35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {imageCompressing
                        ? '⏳ Đang nén...'
                        : form.image_url
                          ? '📷 Đổi ảnh'
                          : '📷 Chọn ảnh'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageFileSelect}
                        disabled={imageCompressing}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {form.image_url && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ color: '#dc2626', borderColor: '#fecaca', padding: '0 7px', height: 35 }}
                        onClick={() => {
                          setForm({ ...form, image_url: '' })
                          setImageStats(null)
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Hàng 5: Giá nhập + Tồn tối thiểu (2 cột trên 1 hàng) */}
              <div className="form-grid-2">
                <div className="form-group">
                  <label>{editingItem ? 'Giá nhập (₫)' : 'Giá nhập ban đầu (tùy chọn)'}</label>
                  <CurrencyInput
                    value={form.cost}
                    onChange={(num) => setForm({ ...form, cost: num })}
                    placeholder="VD: 250.000"
                  />
                  {!editingItem && (
                    <div className="ui-hint">Giá thực tế lấy từ phiếu nhập kho</div>
                  )}
                </div>
                <div className="form-group">
                  <label>Tồn tối thiểu</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.min_stock}
                    onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                  />
                </div>
              </div>

              {/* Hàng 6: Số lần dùng (nếu Tái sử dụng) + Ghi chú gọn */}
              {form.kind === 'reusable' ? (
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Số lần dùng dự kiến</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="VD: 10 lần"
                      value={form.expected_uses}
                      onChange={(e) => setForm({ ...form, expected_uses: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Ghi chú</label>
                    <input
                      type="text"
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      placeholder="Kích thước, quy cách..."
                    />
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label>Ghi chú</label>
                  <input
                    type="text"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="Kích thước, quy cách bảo quản..."
                  />
                </div>
              )}

              <label className="checkbox-label" style={{ marginTop: 2 }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Đang hoạt động
              </label>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={closeModal}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    saving ||
                    imageCompressing ||
                    codeLock.checking ||
                    Boolean(duplicateItem && !(editingItem && codeLock.locked))
                  }
                  onClick={() => {
                    saveMode.current = 'save'
                  }}
                >
                  {saving ? 'Đang lưu...' : 'Lưu vật tư'}
                </button>
                {!editingItem && canEditCatalog && (
                  <button
                    type="submit"
                    className="btn btn-outline"
                    disabled={saving || imageCompressing || Boolean(duplicateItem)}
                    onClick={() => {
                      saveMode.current = 'receive'
                    }}
                  >
                    Lưu và nhập kho
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
