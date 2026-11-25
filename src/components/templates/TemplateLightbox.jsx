import { useEffect, useRef } from 'react'
import './Templates.css'

/** Xem ảnh phóng to, có nút trước/sau, vuốt ngang và phím mũi tên. */
export default function TemplateLightbox({ urls, index, title, onIndex, onClose }) {
  const touchX = useRef(null)
  const count = urls.length
  const go = (delta) => onIndex((index + delta + count) % count)

  useEffect(() => {
    const handleKey = (event) => {
      // Bắt ở giai đoạn capture để Escape chỉ đóng ảnh, không đóng hộp thoại phía sau.
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if (count > 1 && event.key === 'ArrowLeft') {
        onIndex((index - 1 + count) % count)
      } else if (count > 1 && event.key === 'ArrowRight') {
        onIndex((index + 1) % count)
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [index, count, onIndex, onClose])

  if (count === 0) return null

  return (
    <div
      className="ui-modal-backdrop tpl-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="tpl-lightbox__bar">
        <span className="ui-truncate">
          {title}
          {count > 1 ? ` (${index + 1}/${count})` : ''}
        </span>
        <button type="button" className="ui-btn ui-btn--icon tpl-lightbox__btn" aria-label="Đóng ảnh" onClick={onClose}>
          ✕
        </button>
      </div>
      <div
        className="tpl-lightbox__stage"
        onTouchStart={(event) => {
          touchX.current = event.touches[0].clientX
        }}
        onTouchEnd={(event) => {
          if (touchX.current === null || count < 2) return
          const dx = event.changedTouches[0].clientX - touchX.current
          touchX.current = null
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
        }}
      >
        <img src={urls[index]} alt={`${title} - ảnh ${index + 1}`} className="tpl-lightbox__img" />
        {count > 1 && (
          <>
            <button
              type="button"
              className="ui-btn ui-btn--icon tpl-lightbox__btn tpl-lightbox__nav tpl-lightbox__nav--prev"
              aria-label="Ảnh trước"
              onClick={() => go(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--icon tpl-lightbox__btn tpl-lightbox__nav tpl-lightbox__nav--next"
              aria-label="Ảnh sau"
              onClick={() => go(1)}
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  )
}
