import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { buildPickerList, getItemGroups } from '../lib/itemSearch'
import './ItemPicker.css'

const ItemPicker = forwardRef(function ItemPicker({
  items,
  value,
  onChange,
  placeholder = 'Gõ tên hoặc mã vật tư...',
  ariaLabel,
  disabled = false,
  invalid = false,
  stockField = 'in_stock',
  onlyWithStock = false,
  required = false,
  suggestedIds,
  showGroupChips = false,
  onSelected,
}, ref) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const [group, setGroup] = useState('')
  const uid = useId()
  const listId = `${uid}-list`

  const selected = useMemo(
    () => (value ? (items || []).find((i) => String(i.id) === String(value)) : null),
    [items, value],
  )
  const picked = useMemo(
    () =>
      open
        ? buildPickerList(items, query, { stockField, onlyWithStock, limit: 50, group, suggestedIds })
        : { list: [], suggestedCount: 0 },
    [open, items, query, stockField, onlyWithStock, group, suggestedIds],
  )
  const results = picked.list
  const suggestedCount = picked.suggestedCount
  const groups = useMemo(() => (showGroupChips ? getItemGroups(items) : []), [showGroupChips, items])

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), [])
  const stockLabel = stockField === 'in_repair' ? 'Chờ sửa' : 'Tồn'

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [open])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (it) => {
    onChange(String(it.id))
    setQuery('')
    setOpen(false)
    if (onSelected) onSelected(it)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && results[active]) choose(results[active])
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const inputValue = selected && !open ? `[${selected.code}] ${selected.name}` : query
  const cls = ['ip-root', invalid && 'ip-invalid', required && !selected && 'ip-required']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} ref={rootRef}>
      <div className="ip-field">
        <input
          type="text"
          ref={inputRef}
          className="ip-input"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-activedescendant={open && results[active] ? `${uid}-opt-${results[active].id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected ? '' : placeholder}
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => {
            if (!disabled) {
              setActive(0)
              setOpen(true)
            }
          }}
          onClick={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {selected && !disabled && (
          <button
            type="button"
            className="ip-clear"
            aria-label="Xóa lựa chọn"
            onClick={() => {
              onChange('')
              setQuery('')
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="ip-pop">
          {groups.length > 0 && (
            <div className="ip-chips" role="group" aria-label="Lọc theo nhóm">
              {['', ...groups].map((g) => (
                <button
                  key={g || 'all'}
                  type="button"
                  className={`ip-chip${group === g ? ' ip-chip-on' : ''}`}
                  aria-pressed={group === g}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setGroup(g)
                    setActive(0)
                  }}
                >
                  {g || 'Tất cả'}
                </button>
              ))}
            </div>
          )}
          <ul className="ip-list" id={listId} role="listbox" ref={listRef}>
            {results.length === 0 && (
              <li className="ip-empty" role="presentation">
                Không tìm thấy vật tư
              </li>
            )}
            {results.map((it, idx) => {
              const isTh = it.kind === 'consumable'
              return (
                <li key={it.id} role="presentation" className="ip-item">
                  {suggestedCount > 0 && idx === 0 && (
                    <div className="ip-section" role="presentation">Nhập gần đây</div>
                  )}
                  {suggestedCount > 0 && idx === suggestedCount && (
                    <div className="ip-section" role="presentation">Tất cả vật tư</div>
                  )}
                  <div
                    id={`${uid}-opt-${it.id}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={String(it.id) === String(value)}
                    className={`ip-option${idx === active ? ' ip-active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(it)}
                  >
                    <span className={`ip-tag ${isTh ? 'ip-tag-th' : 'ip-tag-tsd'}`}>{isTh ? 'TH' : 'TSD'}</span>
                    <span className="ip-code">{it.code}</span>
                    <span className="ip-name">{it.name}</span>
                    <span className="ip-stock">
                      {stockLabel}: {Number(it[stockField]) || 0} {it.unit || ''}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
})

export default ItemPicker
