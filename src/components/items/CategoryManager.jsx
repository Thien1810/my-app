import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { findDuplicateCategory, generateCategoryCode } from '../../lib/itemCategories'

const collator = new Intl.Collator('vi')
const VIETNAMESE_CHAR = /[à-ỹÀ-Ỹ]/

function compareCategories(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || collator.compare(a.name ?? '', b.name ?? '')
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

// Thông báo từ trigger của DB đã là tiếng Việt thì giữ nguyên, còn lại dùng câu chung.
function describeError(err) {
  const message = String(err?.message ?? '')
  if (message === 'NO_ROWS') return 'Không lưu được: tài khoản này không có quyền sửa nhóm hoặc nhóm đã bị xóa'
  if (err?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Tài khoản này không có quyền sửa nhóm vật tư'
  }
  if (err?.code === '23505') return 'Tên hoặc mã nhóm đã tồn tại'
  if (VIETNAMESE_CHAR.test(message)) return message
  return 'Không lưu được thay đổi, kiểm tra kết nối rồi thử lại'
}

async function updateCategory(id, patch) {
  const { data, error } = await supabase.from('item_categories').update(patch).eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('NO_ROWS')
}

/**
 * Hộp thoại quản lý nhóm vật tư (admin/manager).
 * Props: categories (danh sách nhóm hiện có), onClose(), onChanged() gọi sau mỗi lần ghi.
 */
export default function CategoryManager({ categories, onClose, onChanged }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [addingTo, setAddingTo] = useState(null) // null | 'root' | id nhóm cha
  const [addName, setAddName] = useState('')
  const dialogRef = useRef(null)

  const realCategories = useMemo(
    () => categories.filter((category) => category.id != null && !category.virtual),
    [categories],
  )
  const { roots, childrenOf } = useMemo(() => {
    const ids = new Set(realCategories.map((category) => String(category.id)))
    const rootList = []
    const children = new Map()
    for (const category of [...realCategories].sort(compareCategories)) {
      // Nhóm mồ côi (cha không còn) được xếp ở cấp gốc.
      if (category.parent_id == null || !ids.has(String(category.parent_id))) {
        rootList.push(category)
      } else {
        const key = String(category.parent_id)
        if (!children.has(key)) children.set(key, [])
        children.get(key).push(category)
      }
    }
    return { roots: rootList, childrenOf: children }
  }, [realCategories])

  useEffect(() => {
    dialogRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const run = async (task) => {
    setBusy(true)
    setError('')
    let ok = false
    try {
      await task()
      ok = true
    } catch (err) {
      setError(describeError(err))
    }
    try {
      await onChanged?.()
    } catch {
      // Danh sách ngoài sẽ tự tải lại ở lần sau.
    }
    setBusy(false)
    return ok
  }

  const startEdit = (category) => {
    setError('')
    setAddingTo(null)
    setEditingId(category.id)
    setEditName(category.name)
  }

  const saveEdit = async (category) => {
    const name = cleanName(editName)
    if (!name) {
      setError('Nhập tên nhóm')
      return
    }
    if (findDuplicateCategory(name, category.parent_id, realCategories, category.id)) {
      setError(`Đã có nhóm tên "${name}" ở cùng cấp`)
      return
    }
    if (name === category.name) {
      setEditingId(null)
      return
    }
    const ok = await run(() => updateCategory(category.id, { name }))
    if (ok) setEditingId(null)
  }

  const toggleActive = (category) => run(() => updateCategory(category.id, { active: category.active === false }))

  const move = (siblings, index, direction) => {
    const target = index + direction
    if (target < 0 || target >= siblings.length) return
    const ordered = [...siblings]
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    // Đánh số lại cả cụm để không bị lệch khi nhiều nhóm cùng sort_order.
    const changes = ordered
      .map((category, order) => ({ category, order }))
      .filter(({ category, order }) => category.sort_order !== order)
    return run(async () => {
      for (const { category, order } of changes) {
        await updateCategory(category.id, { sort_order: order })
      }
    })
  }

  const startAdd = (parentKey) => {
    setError('')
    setEditingId(null)
    setAddingTo(parentKey)
    setAddName('')
  }

  const saveAdd = async (parent) => {
    const name = cleanName(addName)
    const parentId = parent ? parent.id : null
    if (!name) {
      setError('Nhập tên nhóm')
      return
    }
    if (findDuplicateCategory(name, parentId, realCategories)) {
      setError(`Đã có nhóm tên "${name}" ở cùng cấp`)
      return
    }
    const siblings = parent ? childrenOf.get(String(parent.id)) ?? [] : roots
    const sortOrder = siblings.reduce((max, category) => Math.max(max, Number(category.sort_order) || 0), -1) + 1
    const ok = await run(async () => {
      const { error: insertError } = await supabase.from('item_categories').insert({
        name,
        code: generateCategoryCode(name, realCategories),
        parent_id: parentId,
        sort_order: sortOrder,
        active: true,
      })
      if (insertError) throw insertError
    })
    if (ok) {
      setAddingTo(null)
      setAddName('')
    }
  }

  // Escape đóng ô nhập trước, hộp thoại sau.
  const handleKeyDown = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (editingId != null) setEditingId(null)
    else if (addingTo != null) setAddingTo(null)
    else onClose()
  }

  const renderAddForm = (parent) => (
    <form
      className="items-list-cm__form"
      onSubmit={(event) => {
        event.preventDefault()
        saveAdd(parent)
      }}
    >
      <input
        className="ui-input"
        value={addName}
        onChange={(event) => setAddName(event.target.value)}
        placeholder={parent ? `Tên nhóm con của ${parent.name}` : 'Tên nhóm mới'}
        aria-label={parent ? `Tên nhóm con của ${parent.name}` : 'Tên nhóm mới'}
        maxLength={80}
        autoFocus
        disabled={busy}
      />
      <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm items-list-cm__btn" disabled={busy}>
        Thêm
      </button>
      <button
        type="button"
        className="ui-btn ui-btn--ghost ui-btn--sm items-list-cm__btn"
        onClick={() => setAddingTo(null)}
        disabled={busy}
      >
        Hủy
      </button>
    </form>
  )

  const renderRow = (category, siblings, index, isChild) => {
    const inactive = category.active === false
    const editing = editingId === category.id
    return (
      <li key={category.id} className={`items-list-cm__item${isChild ? ' is-child' : ''}${inactive ? ' is-inactive' : ''}`}>
        {editing ? (
          <form
            className="items-list-cm__form"
            onSubmit={(event) => {
              event.preventDefault()
              saveEdit(category)
            }}
          >
            <input
              className="ui-input"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              aria-label={`Tên mới của nhóm ${category.name}`}
              maxLength={80}
              autoFocus
              disabled={busy}
            />
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm items-list-cm__btn" disabled={busy}>
              Lưu
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--ghost ui-btn--sm items-list-cm__btn"
              onClick={() => setEditingId(null)}
              disabled={busy}
            >
              Hủy
            </button>
          </form>
        ) : (
          <>
            <div className="items-list-cm__name">
              <strong>{category.name}</strong>
              {category.code && <code>{category.code}</code>}
              {inactive && <span className="ui-badge ui-badge--neutral">Đang ẩn</span>}
            </div>
            <div className="items-list-cm__actions">
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon items-list-cm__btn items-list-cm__btn--icon"
                aria-label={`Chuyển nhóm ${category.name} lên trên`}
                disabled={busy || index === 0}
                onClick={() => move(siblings, index, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon items-list-cm__btn items-list-cm__btn--icon"
                aria-label={`Chuyển nhóm ${category.name} xuống dưới`}
                disabled={busy || index === siblings.length - 1}
                onClick={() => move(siblings, index, 1)}
              >
                ▼
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm items-list-cm__btn"
                disabled={busy}
                onClick={() => startEdit(category)}
              >
                Đổi tên
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm items-list-cm__btn"
                disabled={busy}
                onClick={() => toggleActive(category)}
              >
                {inactive ? 'Hiện' : 'Ẩn'}
              </button>
              {!isChild && (
                <button
                  type="button"
                  className="ui-btn ui-btn--ghost ui-btn--sm items-list-cm__btn"
                  disabled={busy}
                  onClick={() => startAdd(String(category.id))}
                >
                  Thêm nhóm con
                </button>
              )}
            </div>
          </>
        )}
        {!isChild && addingTo === String(category.id) && renderAddForm(category)}
        {!isChild && childrenOf.get(String(category.id))?.length > 0 && (
          <ul className="items-list-cm__tree">
            {childrenOf.get(String(category.id)).map((child, childIndex, all) => renderRow(child, all, childIndex, true))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="ui-modal items-list-cm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="items-list-cm-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
      >
        <div className="ui-modal__header" id="items-list-cm-title">Quản lý nhóm vật tư</div>
        <div className="ui-modal__body">
          {error && <div className="ui-alert ui-alert--danger items-list-cm__error" role="alert">{error}</div>}

          {realCategories.length === 0 ? (
            <div className="ui-alert ui-alert--info">
              Bảng nhóm vật tư chưa có trong Supabase. Chạy file <code>supabase/item_categories.sql</code> trong
              Supabase, mục SQL Editor, rồi tải lại trang để quản lý nhóm tại đây.
            </div>
          ) : (
            <>
              <ul className="items-list-cm__tree items-list-cm__tree--root">
                {roots.map((category, index) => renderRow(category, roots, index, false))}
              </ul>
              {addingTo === 'root' ? (
                renderAddForm(null)
              ) : (
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm items-list-cm__add"
                  disabled={busy}
                  onClick={() => startAdd('root')}
                >
                  + Thêm nhóm mới
                </button>
              )}
              <p className="ui-hint items-list-cm__hint">
                Nhóm đang ẩn không còn hiện trong ô chọn khi thêm vật tư, vật tư cũ vẫn giữ nguyên nhóm
              </p>
            </>
          )}
        </div>
        <div className="ui-modal__footer">
          <button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
