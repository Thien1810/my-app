import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatDate, formatNumber, todayISO } from '../lib/formatters'
import { calcProjectItemStats } from '../lib/calc'
import { calcProjectFbReminder } from '../lib/watermarkHelper'

export default function NotificationBell({ placement = 'sidebar' }) {
  const { isStaff } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [alerts, setAlerts] = useState({
    lateDelivery: [],
    lateReturn: [],
    lateFacebook: [],
    lowStock: [],
  })
  const panelRef = useRef(null)

  const loadAlerts = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const [itemsRes, projectsRes, movesRes] = await Promise.all([
        supabase.from('item_stock').select('id, code, name, kind, unit, in_stock, min_stock, active'),
        supabase
          .from('projects')
          .select('id, code, name, start_date, end_date, status, note, created_at, customer:partners(name)'),
        supabase.from('stock_movements').select('project_id, item_id, type, qty'),
      ])

      const items = (itemsRes.data || []).filter((i) => i.active)
      const projects = projectsRes.data || []
      const movements = movesRes.data || []
      const today = todayISO()

      const itemMap = new Map()
      for (const i of items) itemMap.set(Number(i.id), i)

      // 1. Trễ ngày giao hàng / thi công: tới hoặc qua ngày start_date nhưng vẫn ở trạng thái quote/preparing
      const lateDelivery = projects.filter(
        (p) =>
          ['quote', 'preparing'].includes(p.status) &&
          p.start_date &&
          p.start_date <= today
      )

      // 2. Trễ thu hồi vật tư: qua ngày tháo dỡ end_date mà vẫn còn đồ tái sử dụng chưa thu về
      const lateReturn = []
      for (const p of projects) {
        if (
          ['in_progress', 'awaiting_return'].includes(p.status) &&
          p.end_date &&
          p.end_date < today
        ) {
          const projMoves = movements.filter((m) => m.project_id === p.id)
          const stats = calcProjectItemStats(projMoves, itemMap)
          const outstanding = stats.reduce((s, r) => s + r.outstanding, 0)
          if (outstanding > 0) {
            lateReturn.push({ ...p, outstanding })
          }
        }
      }

      // 3. Trễ đăng bài Facebook (> 5 ngày chưa đăng)
      const lateFacebook = []
      if (!isStaff) {
        for (const p of projects) {
          const rem = calcProjectFbReminder(p)
          if (rem.isOverdue5Days) {
            lateFacebook.push({ ...p, daysPassed: rem.daysPassed })
          }
        }
      }

      // 4. Vật tư dưới tồn tối thiểu
      const lowStock = items.filter(
        (i) => Number(i.min_stock || 0) > 0 && Number(i.in_stock || 0) < Number(i.min_stock || 0)
      )

      setAlerts({ lateDelivery, lateReturn, lateFacebook, lowStock })
    } catch {
      // ignore silent fetch errors
    } finally {
      setLoading(false)
    }
  }, [isStaff])

  useEffect(() => {
    loadAlerts()
    const timer = setInterval(loadAlerts, 5 * 60 * 1000) // Tự làm mới mỗi 5 phút
    return () => clearInterval(timer)
  }, [loadAlerts])

  useEffect(() => {
    if (!open) return
    const handleOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const totalCount =
    alerts.lateDelivery.length +
    alerts.lateReturn.length +
    alerts.lateFacebook.length +
    alerts.lowStock.length

  // Tạo bản tin tóm tắt đẹp mắt để Copy gửi thẳng vào nhóm Messenger / Zalo Đặng Wedding
  const handleCopyForMessenger = async () => {
    const lines = [
      `🌿 NHẮC VIỆC ĐẶNG WEDDING (${formatDate(todayISO())})`,
      `--------------------------------`,
    ]

    if (alerts.lateDelivery.length > 0) {
      lines.push(`🚚 ĐẾN HẠN / TRỄ GIAO HÀNG (${alerts.lateDelivery.length}):`)
      alerts.lateDelivery.forEach((p) => {
        lines.push(` • ${p.name} (Ngày thi công: ${formatDate(p.start_date)})`)
      })
    }

    if (alerts.lateReturn.length > 0) {
      lines.push(`📦 TRỄ THU HỒI VẬT TƯ (${alerts.lateReturn.length}):`)
      alerts.lateReturn.forEach((p) => {
        lines.push(
          ` • ${p.name} (Hạn: ${formatDate(p.end_date)} — còn ${formatNumber(p.outstanding)} món chưa thu)`
        )
      })
    }

    if (alerts.lateFacebook.length > 0) {
      lines.push(`📱 TRỄ ĐĂNG BÀI FACEBOOK > 5 NGÀY (${alerts.lateFacebook.length}):`)
      alerts.lateFacebook.forEach((p) => {
        lines.push(` • ${p.name} (Đã qua ${p.daysPassed} ngày chưa đăng Fanpage)`)
      })
    }

    if (alerts.lowStock.length > 0) {
      lines.push(`⚠️ VẬT TƯ SẮP HẾT (${alerts.lowStock.length}):`)
      alerts.lowStock.slice(0, 8).forEach((i) => {
        lines.push(
          ` • ${i.name}: còn ${formatNumber(i.in_stock)} ${i.unit} (tối thiểu ${formatNumber(i.min_stock)})`
        )
      })
    }

    if (totalCount === 0) {
      lines.push(`✅ Hiện tại không có công việc nào trễ hạn!`)
    }

    lines.push(`👉 Xem chi tiết: ${window.location.origin}`)

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      alert('Không thể copy tự động trên trình duyệt này.')
    }
  }

  return (
    <div className={`notif-bell-wrap notif-${placement}`} ref={panelRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) loadAlerts()
        }}
        title="Trung tâm thông báo nhắc việc"
        aria-label="Thông báo"
      >
        <span>🔔</span>
        {totalCount > 0 && (
          <span className="notif-badge">{totalCount > 99 ? '99+' : totalCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <div>
              <strong>🔔 Nhắc việc Đặng Wedding ({totalCount})</strong>
              <div className="text-xs text-muted">
                Trễ giao hàng • Thu hồi • Đăng Facebook • Tồn kho
              </div>
            </div>
            <button
              type="button"
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="notif-body">
            {loading && totalCount === 0 ? (
              <div className="empty-state" style={{ padding: 20 }}>
                Đang kiểm tra công việc...
              </div>
            ) : totalCount === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                ✅ Tuyệt vời! Không có công việc nào đang bị trễ hạn.
              </div>
            ) : (
              <>
                {alerts.lateDelivery.length > 0 && (
                  <div className="notif-group">
                    <div className="notif-group-title text-red">
                      🚚 Trễ / Đến hạn giao hàng ({alerts.lateDelivery.length})
                    </div>
                    {alerts.lateDelivery.map((p) => (
                      <Link
                        key={`del-${p.id}`}
                        to={`/du-an/${p.id}`}
                        className="notif-item"
                        onClick={() => setOpen(false)}
                      >
                        <div className="font-bold">{p.name}</div>
                        <div className="text-xs text-muted">
                          Ngày thi công: {formatDate(p.start_date)} • Chưa chuyển sang Đang thi công
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {alerts.lateReturn.length > 0 && (
                  <div className="notif-group">
                    <div className="notif-group-title text-red">
                      📦 Trễ thu hồi vật tư ({alerts.lateReturn.length})
                    </div>
                    {alerts.lateReturn.map((p) => (
                      <Link
                        key={`ret-${p.id}`}
                        to={`/du-an/${p.id}`}
                        className="notif-item"
                        onClick={() => setOpen(false)}
                      >
                        <div className="font-bold">{p.name}</div>
                        <div className="text-xs text-red">
                          Hạn tháo dỡ: {formatDate(p.end_date)} • Còn {formatNumber(p.outstanding)}{' '}
                          món chưa thu hồi
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {alerts.lateFacebook.length > 0 && (
                  <div className="notif-group">
                    <div className="notif-group-title text-amber">
                      📱 Trễ đăng bài Facebook &gt; 5 ngày ({alerts.lateFacebook.length})
                    </div>
                    {alerts.lateFacebook.map((p) => (
                      <Link
                        key={`fb-${p.id}`}
                        to={`/du-an/${p.id}?tab=facebook`}
                        className="notif-item"
                        onClick={() => setOpen(false)}
                      >
                        <div className="font-bold">{p.name}</div>
                        <div className="text-xs text-amber">
                          Đã qua {p.daysPassed} ngày chưa đăng Fanpage • Bấm để ghép Watermark
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {alerts.lowStock.length > 0 && (
                  <div className="notif-group">
                    <div className="notif-group-title text-amber">
                      ⚠️ Vật tư dưới tồn tối thiểu ({alerts.lowStock.length})
                    </div>
                    {alerts.lowStock.slice(0, 6).map((i) => (
                      <Link
                        key={`stk-${i.id}`}
                        to={`/vat-tu/${i.id}`}
                        className="notif-item"
                        onClick={() => setOpen(false)}
                      >
                        <div className="font-bold">{i.name}</div>
                        <div className="text-xs text-muted">
                          Còn {formatNumber(i.in_stock)} {i.unit} (tối thiểu:{' '}
                          {formatNumber(i.min_stock)})
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="notif-footer">
            <button
              type="button"
              className="btn btn-primary btn-sm btn-block"
              onClick={handleCopyForMessenger}
            >
              {copied
                ? '✓ Đã copy! Dán ngay vào nhóm Messenger / Zalo'
                : '📋 Copy nhắc việc gửi nhóm Messenger / Zalo'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
