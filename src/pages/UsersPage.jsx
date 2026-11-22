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

  const handleDeleteUser = async (p) => {
    if (p.id === user?.id) {
      setError('Bạn không thể tự xóa chính tài khoản Quản trị đang đăng nhập của mình.')
      return
    }
    if (
      !window.confirm(
        `Bạn có chắc chắn muốn XÓA tài khoản "${p.full_name || p.email}" (${p.email}) khỏi hệ thống?`
      )
    ) {
      return
    }
    setSavingId(p.id)
    setError('')
    setSuccess('')
    try {
      // Thử gọi RPC xóa cả trong auth.users nếu database đã cài hàm admin_delete_user
      const rpcRes = await supabase.rpc('admin_delete_user', { target_user_id: p.id })
      if (rpcRes.error) {
        // Fallback: gỡ khóa ngoại ở projects, project_members, stock_movements rồi xóa trong profiles
        await supabase.from('project_members').delete().eq('user_id', p.id)
        await supabase.from('projects').update({ lead_id: null }).eq('lead_id', p.id)
        await supabase
          .from('stock_movements')
          .update({ created_by: null })
          .eq('created_by', p.id)

        const { error: delErr } = await supabase.from('profiles').delete().eq('id', p.id)
        if (delErr) throw delErr
      }

      setSuccess(`Đã xóa người dùng "${p.full_name || p.email}" thành công!`)
      await loadProfiles()
    } catch (err) {
      setError(err.message || 'Không thể xóa người dùng')
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
                  <th className="text-right">Thao tác</th>
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
                      <td className="text-right">
                        {!isMe ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            style={{ color: '#dc2626', borderColor: '#fecaca' }}
                            disabled={savingId === p.id}
                            onClick={() => handleDeleteUser(p)}
                          >
                            Xóa
                          </button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
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
