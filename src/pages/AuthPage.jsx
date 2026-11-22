import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { translateAuthError } from '../lib/formatters'

export default function AuthPage() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const switchMode = (newMode) => {
    setMode(newMode)
    setError('')
    setMessage('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)

    try {
      if (mode === 'login') {
        await signIn(email.trim(), password)
      } else if (mode === 'signup') {
        if (!fullName.trim()) {
          throw new Error('Vui lòng nhập họ và tên.')
        }
        const res = await signUp(email.trim(), password, fullName.trim())
        if (res?.user && !res?.session) {
          setMessage(
            'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận (nếu hệ thống bật xác thực email) hoặc đăng nhập.'
          )
        } else {
          setMessage('Đăng ký tài khoản thành công!')
        }
      } else if (mode === 'forgot') {
        await resetPassword(email.trim())
        setMessage('Đã gửi email đặt lại mật khẩu. Vui lòng kiểm tra hộp thư của bạn.')
      }
    } catch (err) {
      setError(translateAuthError(err.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="brand-badge">🌿 KHO TRANG TRÍ</div>
        <h1>
          {mode === 'login' && 'Đăng nhập hệ thống'}
          {mode === 'signup' && 'Đăng ký tài khoản mới'}
          {mode === 'forgot' && 'Khôi phục mật khẩu'}
        </h1>
        <p className="text-muted">
          {mode === 'login' && 'Quản lý vật tư tiêu hao, đồ tái sử dụng và dự án trang trí'}
          {mode === 'signup' &&
            'Người đăng ký đầu tiên sẽ tự động là Quản trị. Các tài khoản sau sẽ chờ Quản trị duyệt.'}
          {mode === 'forgot' && 'Nhập địa chỉ email để nhận liên kết đặt lại mật khẩu'}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <div className="form-group">
              <label>Họ và tên *</label>
              <input
                type="text"
                required
                placeholder="Nguyễn Văn A"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label>Email *</label>
            <input
              type="email"
              required
              placeholder="ten@congty.vn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {mode !== 'forgot' && (
            <div className="form-group">
              <label>Mật khẩu *</label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="Tối thiểu 6 ký tự"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy
              ? 'Đang xử lý...'
              : mode === 'login'
                ? 'Đăng nhập'
                : mode === 'signup'
                  ? 'Đăng ký tài khoản'
                  : 'Gửi email khôi phục'}
          </button>
        </form>

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" className="btn-link" onClick={() => switchMode('signup')}>
                Chưa có tài khoản? Đăng ký mới
              </button>
              <button type="button" className="btn-link" onClick={() => switchMode('forgot')}>
                Quên mật khẩu?
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" className="btn-link" onClick={() => switchMode('login')}>
              ← Quay lại đăng nhập
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
