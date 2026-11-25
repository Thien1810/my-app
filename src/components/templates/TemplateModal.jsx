import { useEffect } from 'react'
import './Templates.css'

/**
 * Khung hộp thoại theo UI kit (ui-modal), có phím Escape.
 * onSubmit: nếu có thì thân hộp thoại là <form>. closeOnBackdrop: bấm nền mờ để đóng (tắt với form dài).
 */
export default function TemplateModal({
  title,
  onClose,
  children,
  footer,
  onSubmit,
  wide = false,
  closeOnBackdrop = true,
}) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const Tag = onSubmit ? 'form' : 'div'
  return (
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.()
      }}
    >
      <Tag
        className={`ui-modal tpl-modal${wide ? ' tpl-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={onSubmit}
      >
        <div className="ui-modal__header tpl-modal__header">
          <span>{title}</span>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
            aria-label="Đóng"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </Tag>
    </div>
  )
}
