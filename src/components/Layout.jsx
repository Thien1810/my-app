import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { RoleBadge } from './Badges'
import NotificationBell from './NotificationBell'

export default function Layout() {
  const { profile, user, role, isAdmin, isStaff, signOut, setIsPasswordRecovery } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator.standalone === true
    setIsStandalone(Boolean(standalone))

    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  const handleInstallAppClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      return
    }
    setInstallModalOpen(true)
  }

  const navItems = [
    { to: '/', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: '📊', show: true, end: true },
    { to: '/vat-tu', label: 'Vật tư', shortLabel: 'Vật tư', icon: '📦', show: true },
    { to: '/phieu-kho', label: 'Nhập kho / Phiếu kho', shortLabel: 'Phiếu kho', icon: '📝', show: !isStaff },
    { to: '/du-an', label: 'Dự án', shortLabel: 'Dự án', icon: '🎪', show: true },
    { to: '/mau-set', label: 'Mẫu set trang trí', shortLabel: 'Mẫu set', icon: '✨', show: !isStaff },
    { to: '/doi-tac', label: 'Đối tác', shortLabel: 'Đối tác', icon: '🤝', show: !isStaff },
    { to: '/bao-cao', label: 'Báo cáo & Dự báo', shortLabel: 'Báo cáo', icon: '📈', show: !isStaff },
    { to: '/quan-tri-web', label: 'Quản trị Website', shortLabel: 'Website', icon: '🌐', show: !isStaff },
    { to: '/nguoi-dung', label: 'Người dùng', shortLabel: 'Tài khoản', icon: '👥', show: isAdmin },
  ].filter((item) => item.show)

  const closeMenu = () => setMobileMenuOpen(false)

  return (
    <div className="app-shell">
      {/* Mobile Header */}
      <header className="mobile-header">
        <div className="mobile-brand">
          <img src="/logo.jpg" alt="Đặng Wedding" className="mobile-brand-logo" />
          <strong>Đặng Wedding</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotificationBell placement="mobile" />
          <button
            className="btn-icon"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Mở menu"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.jpg" alt="Đặng Wedding" className="brand-logo-img" />
            <div>
              <div className="brand-title">Đặng Wedding</div>
              <div className="brand-subtitle">Quản lý Vật tư & Dự án</div>
            </div>
          </div>
          <div className="desktop-bell-slot">
            <NotificationBell placement="sidebar" />
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={closeMenu}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!isStandalone && (
            <button
              type="button"
              className="btn btn-primary btn-sm btn-block"
              style={{ marginBottom: 10 }}
              onClick={() => {
                closeMenu()
                handleInstallAppClick()
              }}
            >
              📲 Cài App vào điện thoại
            </button>
          )}
          <div className="user-info">
            <div className="user-name">{profile?.full_name || user?.email}</div>
            <div className="user-email">{user?.email}</div>
            <div style={{ marginTop: 6 }}>
              <RoleBadge role={role} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-outline btn-sm"
              style={{ flex: 1 }}
              onClick={() => setIsPasswordRecovery(true)}
            >
              🔑 Đổi MK
            </button>
            <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={signOut}>
              Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      {mobileMenuOpen && <div className="sidebar-backdrop" onClick={closeMenu} />}

      {/* Main Content */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        {navItems.slice(0, 4).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={closeMenu}
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.shortLabel || item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className={`bottom-nav-item ${mobileMenuOpen ? 'active' : ''}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span className="bottom-nav-icon">☰</span>
          <span className="bottom-nav-label">Menu</span>
        </button>
      </nav>

      {/* Hướng dẫn cài App PWA ra màn hình chính iPhone & Android */}
      {installModalOpen && (
        <div className="modal-backdrop" onClick={() => setInstallModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📲 Cài App Đặng Wedding ra màn hình chính</h3>
              <button className="btn-icon" onClick={() => setInstallModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="text-muted" style={{ marginBottom: 12 }}>
                Cài đặt miễn phí như ứng dụng App Store / CH Play, chạy toàn màn hình và tự cập nhật
                mỗi khi có tính năng mới:
              </p>

              <div className="sub-card" style={{ marginBottom: 12 }}>
                <h4 style={{ marginBottom: 6, color: '#14532d' }}>🍎 Trên iPhone (Safari):</h4>
                <ol style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65 }}>
                  <li>
                    Mở link web này bằng trình duyệt <strong>Safari</strong>.
                  </li>
                  <li>
                    Bấm nút <strong>Chia sẻ</strong> (biểu tượng ô vuông có mũi tên hướng lên ↑ ở
                    cạnh dưới màn hình).
                  </li>
                  <li>
                    Cuộn xuống chọn <strong>&ldquo;Thêm vào MH chính&rdquo; (Add to Home Screen)</strong> →
                    bấm <strong>Thêm</strong>.
                  </li>
                </ol>
              </div>

              <div className="sub-card">
                <h4 style={{ marginBottom: 6, color: '#14532d' }}>🤖 Trên Android (Chrome):</h4>
                <ol style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65 }}>
                  <li>
                    Mở link web này bằng trình duyệt <strong>Google Chrome</strong>.
                  </li>
                  <li>
                    Bấm dấu <strong>⋮</strong> (3 chấm) ở góc trên bên phải.
                  </li>
                  <li>
                    Chọn <strong>&ldquo;Cài đặt ứng dụng&rdquo;</strong> hoặc{' '}
                    <strong>&ldquo;Thêm vào màn hình chính&rdquo;</strong> → bấm{' '}
                    <strong>Cài đặt</strong>.
                  </li>
                </ol>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => setInstallModalOpen(false)}
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
