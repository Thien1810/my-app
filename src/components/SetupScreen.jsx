export default function SetupScreen() {
  return (
    <div className="auth-wrapper">
      <div className="auth-card setup-card">
        <div className="auth-logo-wrap">
          <img src="/logo.jpg" alt="Đặng Wedding" className="auth-logo-img" />
          <div className="brand-badge">ĐẶNG WEDDING</div>
        </div>
        <h1>Chưa cấu hình kết nối Supabase</h1>
        <p className="text-muted">
          Ứng dụng cần 2 biến môi trường <code>VITE_SUPABASE_URL</code> và{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> để kết nối cơ sở dữ liệu.
        </p>

        <div className="setup-steps">
          <h3>Cách cài đặt trên máy cá nhân (Local):</h3>
          <ol>
            <li>
              Tạo file <code>.env.local</code> tại thư mục gốc của dự án (ngang hàng với{' '}
              <code>package.json</code>).
            </li>
            <li>
              Điền thông tin từ trang quản trị Supabase (<strong>Project Settings → API</strong>):
              <pre className="code-block">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...`}
              </pre>
            </li>
            <li>
              Khởi động lại lệnh <code>npm run dev</code>.
            </li>
          </ol>

          <h3>Cách cài đặt trên Vercel:</h3>
          <ol>
            <li>
              Vào <strong>Project Settings → Environment Variables</strong>.
            </li>
            <li>
              Thêm <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_ANON_KEY</code>.
            </li>
            <li>
              Bấm <strong>Redeploy</strong> để áp dụng cấu hình mới.
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
