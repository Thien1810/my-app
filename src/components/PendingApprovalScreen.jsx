import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'

export default function PendingApprovalScreen() {
  const { profile, user, authError, refreshProfile, signOut } = useAuth()
  const [checking, setChecking] = useState(false)

  const handleCheck = async () => {
    setChecking(true)
    await refreshProfile()
    setChecking(false)
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="auth-logo-wrap" style={{ justifyContent: 'center' }}>
          <img src="/logo.jpg" alt="Đặng Wedding" className="auth-logo-img" />
          <div className="brand-badge">ĐẶNG WEDDING</div>
        </div>
        <div className="pending-icon">⏳</div>
        <h2>Tài khoản đang chờ Quản trị duyệt</h2>
        <p className="text-muted" style={{ marginTop: 8 }}>
          Xin chào <strong>{profile?.full_name || user?.email}</strong> ({user?.email}).
          <br />
          Tài khoản của bạn đã được tạo thành công nhưng đang ở trạng thái{' '}
          <strong>Chờ duyệt (pending)</strong>. Vui lòng liên hệ Quản trị viên để được cấp quyền
          truy cập hệ thống.
        </p>

        {authError && (
          <div className="alert alert-error" style={{ marginTop: 12, textAlign: 'left' }}>
            <strong>Chi tiết lỗi từ Supabase:</strong> {authError}
          </div>
        )}

        <div className="form-actions" style={{ justifyContent: 'center', marginTop: 24 }}>
          <button className="btn btn-primary" onClick={handleCheck} disabled={checking}>
            {checking ? 'Đang kiểm tra...' : 'Kiểm tra lại quyền'}
          </button>
          <button className="btn btn-outline" onClick={signOut}>
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  )
}
