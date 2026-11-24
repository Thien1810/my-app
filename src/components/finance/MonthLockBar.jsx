import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { buildLockChecklist, canLockMonth, canUnlockMonth, formatMonthVN } from '../../lib/monthLock'
import './MonthLockBar.css'

const fmtDateTime = (v) => {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
}

function Modal({ title, busy, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])
  return (
    <div className="modal-backdrop" style={{ zIndex: 200 }} onClick={() => !busy && onClose()}>
      <div
        className="modal-card"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export default function MonthLockBar({ month, locks = [], lockLog = [], isLocked, projects, adsRows, fixedCosts, actions }) {
  const { role } = useAuth()
  const [dialog, setDialog] = useState(null) // 'lock' | 'unlock' | null
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [modalError, setModalError] = useState('')

  const label = formatMonthVN(month)
  const lock = locks.find((l) => l.month === month)
  const lockRule = canLockMonth({ role, month, isLocked })
  const canTryLock = role === 'admin' || role === 'manager'
  const canUnlock = canUnlockMonth({ role, isLocked }).ok
  const checklist = useMemo(
    () => buildLockChecklist({ month, adsRows, fixedCosts, projects }),
    [month, adsRows, fixedCosts, projects],
  )

  // Đổi tháng: container gắn key={month} nên hộp thoại tự đóng, tránh khóa nhầm tháng khác.
  const close = () => {
    setDialog(null)
    setNote('')
    setReason('')
    setModalError('')
  }

  const submitLock = async () => {
    if (busy) return
    setBusy(true)
    setModalError('')
    try {
      const res = await actions.lockMonth(note.trim())
      if (res?.ok) close()
      else setModalError(res?.message || 'Không khóa được sổ.')
    } finally {
      setBusy(false)
    }
  }
  const submitUnlock = async () => {
    if (busy || !reason.trim()) return
    setBusy(true)
    setModalError('')
    try {
      const res = await actions.unlockMonth(reason.trim())
      if (res?.ok) close()
      else setModalError(res?.message || 'Không mở khóa được sổ.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card month-lock-bar">
      <div className="month-lock-row">
        {isLocked ? (
          <div className="month-lock-status">
            <span className="badge badge-amber">
              🔒 Đã khóa sổ{lock?.locked_at ? ` lúc ${fmtDateTime(lock.locked_at)}` : ''}
            </span>
            {lock?.note && <span className="text-xs text-muted">Ghi chú: {lock.note}</span>}
            {lock?.locked_by && (
              <span className="text-xs text-muted">Người khóa: {String(lock.locked_by).slice(0, 8)}</span>
            )}
          </div>
        ) : (
          <div className="month-lock-status text-muted" style={{ fontSize: 13.5 }}>
            Tháng {label} chưa khóa sổ.
          </div>
        )}
        <div className="month-lock-actions">
          {canUnlock && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog('unlock')}>
              Mở khóa
            </button>
          )}
          {!isLocked && canTryLock && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!lockRule.ok}
              title={lockRule.ok ? '' : lockRule.reason}
              onClick={() => setDialog('lock')}
            >
              🔒 Khóa sổ tháng {label}
            </button>
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Ẩn lịch sử' : 'Lịch sử khóa/mở khóa'}
          </button>
        </div>
      </div>
      {!isLocked && canTryLock && !lockRule.ok && <div className="text-xs text-muted">{lockRule.reason}</div>}

      {showLog && (
        <div className="month-lock-log">
          {lockLog.length === 0 ? (
            <div className="text-xs text-muted">
              Chưa có lịch sử cho tháng {label} (hoặc chưa đọc được nhật ký).
            </div>
          ) : (
            <ul>
              {lockLog.map((l, i) => (
                <li key={l.id ?? i}>
                  <strong>{l.action === 'unlock' ? 'Mở khóa' : 'Khóa sổ'}</strong> • {fmtDateTime(l.acted_at)}
                  {l.note ? ` • ${l.note}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog === 'lock' && (
        <Modal title={`Khóa sổ tháng ${label}`} busy={busy} onClose={close}>
          {checklist.length > 0 && (
            <ul className="month-lock-checklist">
              {checklist.map((it) => (
                <li key={it.key} className={it.level === 'warn' ? 'is-warn' : 'is-ok'}>
                  {it.level === 'warn' ? '⚠️ ' : '✅ '}
                  {it.text}
                </li>
              ))}
            </ul>
          )}
          <div className="alert alert-warning" style={{ marginTop: 10 }}>
            Sau khi khóa: không sửa được Sổ Ads, Chi phí cứng, Mất cọc, phiếu chuyển kho trong tháng này; tỷ trọng kho
            được giữ nguyên. Chỉ admin mở khóa được.
          </div>
          <label className="text-xs text-muted" htmlFor="month-lock-note" style={{ display: 'block', marginTop: 10 }}>
            Ghi chú (tùy chọn)
          </label>
          <input
            id="month-lock-note"
            type="text"
            value={note}
            maxLength={300}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: '100%' }}
          />
          {modalError && (
            <div className="alert alert-error" role="alert" style={{ marginTop: 10 }}>
              {modalError}
            </div>
          )}
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} disabled={busy} onClick={close}>
              Hủy
            </button>
            <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} disabled={busy} onClick={submitLock}>
              {busy ? 'Đang khóa...' : 'Khóa sổ'}
            </button>
          </div>
        </Modal>
      )}

      {dialog === 'unlock' && (
        <Modal title={`Mở khóa sổ tháng ${label}`} busy={busy} onClose={close}>
          <div className="alert alert-warning">
            Mở khóa cho phép sửa lại Sổ Ads, Chi phí cứng, Mất cọc, phiếu chuyển kho của tháng này, và số liệu P&L của
            tháng có thể thay đổi. Việc mở khóa được ghi lại trong lịch sử.
          </div>
          <label className="text-xs text-muted" htmlFor="month-unlock-reason" style={{ display: 'block', marginTop: 10 }}>
            Lý do mở khóa (bắt buộc)
          </label>
          <input
            id="month-unlock-reason"
            type="text"
            value={reason}
            maxLength={300}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%' }}
          />
          {modalError && (
            <div className="alert alert-error" role="alert" style={{ marginTop: 10 }}>
              {modalError}
            </div>
          )}
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} disabled={busy} onClick={close}>
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 40, background: '#dc2626', borderColor: '#dc2626' }}
              disabled={busy || !reason.trim()}
              onClick={submitUnlock}
            >
              {busy ? 'Đang mở...' : 'Mở khóa'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
