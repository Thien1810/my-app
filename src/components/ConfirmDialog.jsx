import { useCallback, useEffect, useRef, useState } from 'react'

// Hộp thoại xác nhận vẽ trong trang, thay cho window.confirm (có môi trường chặn hộp thoại gốc của trình duyệt).
// choices (tùy chọn): [{ value, label, danger }] -> hiện nhiều nút lựa chọn thay cho một nút xác nhận.
function ConfirmModal({ title, message, confirmLabel, cancelLabel, danger, choices, onResult }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onResult(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onResult])

  const buttons = choices?.length
    ? choices
    : [{ value: true, label: confirmLabel, danger }]

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
          <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              ref={cancelRef}
              className="btn btn-outline"
              style={{ minHeight: 44 }}
              onClick={() => onResult(false)}
            >
              {cancelLabel}
            </button>
            {buttons.map((b, i) => (
              <button
                key={String(b.value)}
                type="button"
                className={i === buttons.length - 1 ? 'btn btn-primary' : 'btn btn-outline'}
                style={{ minHeight: 44, ...(b.danger ? { background: '#dc2626', borderColor: '#dc2626', color: '#fff' } : {}) }}
                onClick={() => onResult(b.value)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function useConfirm() {
  const [state, setState] = useState(null)
  const resolverRef = useRef(null)

  const open = useCallback(
    (opts, mapResult) =>
      new Promise((resolve) => {
        // Nếu đang mở hộp thoại khác thì coi như hủy hộp cũ.
        if (resolverRef.current) resolverRef.current(false)
        resolverRef.current = (v) => resolve(mapResult(v))
        setState(opts)
      }),
    []
  )

  // Trả true / false.
  const confirm = useCallback(
    ({ title, message, confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', danger = false }) =>
      open({ title, message, confirmLabel, cancelLabel, danger }, (v) => v === true),
    [open]
  )

  // Trả value của nút được chọn, hoặc null khi Hủy / Esc / bấm ra ngoài.
  const choose = useCallback(
    ({ title, message, choices, cancelLabel = 'Hủy' }) =>
      open({ title, message, choices, cancelLabel }, (v) => (v === false || v == null ? null : v)),
    [open]
  )

  const onResult = useCallback((value) => {
    const r = resolverRef.current
    resolverRef.current = null
    setState(null)
    if (r) r(value)
  }, [])

  const confirmDialog = state ? <ConfirmModal {...state} onResult={onResult} /> : null
  return { confirm, choose, confirmDialog }
}
