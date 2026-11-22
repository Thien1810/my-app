import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { translateAuthError } from './lib/formatters'
import SetupScreen from './components/SetupScreen'
import PendingApprovalScreen from './components/PendingApprovalScreen'
import Layout from './components/Layout'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import ItemsPage from './pages/ItemsPage'
import ItemDetailPage from './pages/ItemDetailPage'
import MovementsPage from './pages/MovementsPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import TemplatesPage from './pages/TemplatesPage'
import PartnersPage from './pages/PartnersPage'
import ReportsPage from './pages/ReportsPage'
import UsersPage from './pages/UsersPage'
import './App.css'

function UpdatePasswordScreen() {
  const { updatePassword, setIsPasswordRecovery } = useAuth()
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (newPass.length < 6) {
      setErr('Mật khẩu mới phải có ít nhất 6 ký tự.')
      return
    }
    if (newPass !== confirmPass) {
      setErr('Mật khẩu xác nhận không khớp.')
      return
    }
    setBusy(true)
    try {
      await updatePassword(newPass)
      setDone(true)
    } catch (error) {
      setErr(translateAuthError(error.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <img src="/logo.jpg" alt="Đặng Wedding" className="auth-logo-img" />
          <div className="brand-badge">ĐẶNG WEDDING</div>
        </div>
        <h1>Đặt mật khẩu mới</h1>
        <p className="text-muted">Nhập mật khẩu mới cho tài khoản của bạn</p>

        {err && <div className="alert alert-error">{err}</div>}
        {done ? (
          <div>
            <div className="alert alert-success">Đã cập nhật mật khẩu mới thành công!</div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setIsPasswordRecovery(false)}
            >
              Vào hệ thống
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label>Mật khẩu mới *</label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="Tối thiểu 6 ký tự"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Nhập lại mật khẩu mới *</label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="Nhập lại mật khẩu mới"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-block"
              style={{ marginTop: 8 }}
              onClick={() => setIsPasswordRecovery(false)}
            >
              Bỏ qua, vào trang chính
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function AppRouter() {
  const { session, loading, isPending, isPasswordRecovery } = useAuth()

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div className="loading-state">Đang tải thông tin phiên đăng nhập...</div>
      </div>
    )
  }

  if (isPasswordRecovery && session) {
    return <UpdatePasswordScreen />
  }

  if (!session) {
    return <AuthPage />
  }

  if (isPending) {
    return <PendingApprovalScreen />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vat-tu" element={<ItemsPage />} />
          <Route path="/vat-tu/:id" element={<ItemDetailPage />} />
          <Route path="/phieu-kho" element={<MovementsPage />} />
          <Route path="/du-an" element={<ProjectsPage />} />
          <Route path="/du-an/:id" element={<ProjectDetailPage />} />
          <Route path="/mau-set" element={<TemplatesPage />} />
          <Route path="/doi-tac" element={<PartnersPage />} />
          <Route path="/bao-cao" element={<ReportsPage />} />
          <Route path="/nguoi-dung" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  )
}
