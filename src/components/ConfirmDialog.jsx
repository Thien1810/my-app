import { useCallback, useEffect, useRef, useState } from 'react'

// Hộp thoại xác nhận vẽ trong trang, thay cho window.confirm (có môi trường chặn hộp thoại gốc của trình duyệt).
function ConfirmModal({ title, message, confirmLabel, cancelLabel, danger, onResult }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onResult(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onResult])

  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} onClick={() => onResult(false)}>
      <div
        className="modal-card"
        style={{ maxWidth: 440 }}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <div style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere', lineHeight: 1.5 }}>{message}</div>
          <div className="modal-footer">
            <button
              type="button"
              ref={cancelRef}
              className="btn btn-outline"
              style={{ minHeight: 40 }}
              onClick={() => onResult(false)}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 40, ...(danger ? { background: '#dc2626', borderColor: '#dc2626' } : {}) }}
              onClick={() => onResult(true)}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function useConfirm() {
  const [state, setState] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback(
    ({ title, message, confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', danger = false }) =>
      new Promise((resolve) => {
        // Nếu đang mở hộp thoại khác thì coi như hủy hộp cũ.
        if (resolverRef.current) resolverRef.current(false)
        resolverRef.current = resolve
        setState({ title, message, confirmLabel, cancelLabel, danger })
      }),
    []
  )

  const onResult = useCallback((value) => {
    const r = resolverRef.current
    resolverRef.current = null
    setState(null)
    if (r) r(value)
  }, [])

  const confirmDialog = state ? <ConfirmModal {...state} onResult={onResult} /> : null
  return { confirm, confirmDialog }
}
