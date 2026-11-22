import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { RoleBadge } from './Badges'

export default function Layout() {
  const { profile, user, role, isAdmin, isStaff, signOut, setIsPasswordRecovery } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navItems = [
    { to: '/', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: '📊', show: true, end: true },
    { to: '/vat-tu', label: 'Vật tư', shortLabel: 'Vật tư', icon: '📦', show: true },
    { to: '/phieu-kho', label: 'Nhập kho / Phiếu kho', shortLabel: 'Phiếu kho', icon: '📝', show: !isStaff },
    { to: '/du-an', label: 'Dự án', shortLabel: 'Dự án', icon: '🎪', show: true },
    { to: '/mau-set', label: 'Mẫu set trang trí', shortLabel: 'Mẫu set', icon: '✨', show: !isStaff },
    { to: '/doi-tac', label: 'Đối tác', shortLabel: 'Đối tác', icon: '🤝', show: !isStaff },
    { to: '/bao-cao', label: 'Báo cáo & Dự báo', shortLabel: 'Báo cáo', icon: '📈', show: !isStaff },
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
        <button
          className="btn-icon"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label="Mở menu"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </header>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/logo.jpg" alt="Đặng Wedding" className="brand-logo-img" />
          <div>
            <div className="brand-title">Đặng Wedding</div>
            <div className="brand-subtitle">Quản lý Vật tư & Dự án</div>
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
    </div>
  )
}
