import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ROLE_LABELS, formatDate } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { RoleBadge } from '../components/Badges'

export default function UsersPage() {
  const { isAdmin, user } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savingId, setSavingId] = useState(null)

  const loadProfiles = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
      if (err) throw err
      setProfiles(data || [])
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách người dùng')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  const handleUpdateProfile = async (id, updates) => {
    setSavingId(id)
    setError('')
    setSuccess('')
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
      if (err) throw err
      setSuccess('Đã cập nhật thông tin người dùng thành công!')
      await loadProfiles()
    } catch (err) {
      setError(err.message || 'Không thể cập nhật người dùng')
    } finally {
      setSavingId(null)
    }
  }

  const handleExport = () => {
    const rows = profiles.map((p) => ({
      'Họ và tên': p.full_name || '',
      'Email': p.email,
      'Vai trò': ROLE_LABELS[p.role] || p.role,
      'Ngày đăng ký': formatDate(p.created_at),
    }))
    exportToExcel(rows, 'DanhSachNguoiDung', 'danh-sach-nguoi-dung.xlsx')
  }

  if (!isAdmin) {
    return (
      <div className="page-container">
        <div className="alert alert-error">
          Chỉ Quản trị viên (Admin) mới có quyền quản lý người dùng và phân quyền.
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý Người dùng & Phân quyền</h1>
          <p className="text-muted">
            Duyệt tài khoản mới (Chờ duyệt → Nhân viên / Thủ kho / Quản lý / Quản trị) và cập nhật
            họ tên
          </p>
        </div>
        <button className="btn btn-outline" onClick={handleExport}>
          📥 Xuất Excel
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-state">Đang tải danh sách tài khoản...</div>
        ) : profiles.length === 0 ? (
          <div className="empty-state">Chưa có người dùng nào.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Họ và tên (chỉnh sửa trực tiếp)</th>
                  <th>Email</th>
                  <th>Vai trò hiện tại</th>
                  <th>Đổi vai trò</th>
                  <th>Ngày tạo</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const isMe = p.id === user?.id
                  return (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="text"
                          defaultValue={p.full_name || ''}
                          placeholder="Nhập họ tên..."
                          onBlur={(e) => {
                            const val = e.target.value.trim()
                            if (val !== (p.full_name || '')) {
                              handleUpdateProfile(p.id, { full_name: val })
                            }
                          }}
                        />
                        {isMe && (
                          <span className="badge badge-consumable" style={{ marginLeft: 8 }}>
                            Bạn
                          </span>
                        )}
                      </td>
                      <td>{p.email}</td>
                      <td>
                        <RoleBadge role={p.role} />
                      </td>
                      <td>
                        <select
                          value={p.role}
                          disabled={savingId === p.id}
                          onChange={(e) =>
                            handleUpdateProfile(p.id, { role: e.target.value })
                          }
                        >
                          {Object.entries(ROLE_LABELS).map(([roleKey, label]) => (
                            <option key={roleKey} value={roleKey}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{formatDate(p.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
