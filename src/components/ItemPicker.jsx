import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterItems } from '../lib/itemSearch'
import './ItemPicker.css'

export default function ItemPicker({
  items,
  value,
  onChange,
  placeholder = 'Gõ tên hoặc mã vật tư...',
  disabled = false,
  invalid = false,
  stockField = 'in_stock',
  onlyWithStock = false,
  required = false,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const uid = useId()
  const listId = `${uid}-list`

  const selected = useMemo(
    () => (value ? (items || []).find((i) => String(i.id) === String(value)) : null),
    [items, value],
  )
  const results = useMemo(
    () => (open ? filterItems(items, query, { stockField, onlyWithStock, limit: 50 }) : []),
    [open, items, query, stockField, onlyWithStock],
  )
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
    const el = listRef.current?.children[active]
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (it) => {
    onChange(String(it.id))
    setQuery('')
    setOpen(false)
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
          className="ip-input"
          role="combobox"
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
        <ul className="ip-list" id={listId} role="listbox" ref={listRef}>
          {results.length === 0 && (
            <li className="ip-empty" role="presentation">
              Không tìm thấy vật tư
            </li>
          )}
          {results.map((it, idx) => {
            const isTh = it.kind === 'consumable'
            return (
              <li
                key={it.id}
                id={`${uid}-opt-${it.id}`}
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
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
