import { useEffect } from 'react'
import './Partners.css'

/**
 * Khung hộp thoại theo UI kit (ui-modal), hỗ trợ Escape (chỉ đóng lớp trên cùng).
 */
export default function PartnerModal({
  title,
  onClose,
  children,
  footer,
  onSubmit,
  wide = false,
  closeOnBackdrop = true,
  escapeDisabled = false,
}) {
  useEffect(() => {
    if (escapeDisabled) return undefined
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        onClose?.()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, escapeDisabled])

  const Tag = onSubmit ? 'form' : 'div'

  return (
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose?.()
        }
      }}
    >
      <Tag
        className={`ui-modal ptn-modal${wide ? ' ptn-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={onSubmit}
      >
        <div className="ui-modal__header ptn-modal__header">
          <span>{title}</span>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
            aria-label="Đóng"
            disabled={escapeDisabled}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer ptn-modal__footer">{footer}</div>}
      </Tag>
    </div>
  )
}
