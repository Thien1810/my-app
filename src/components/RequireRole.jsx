import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

// Bảo vệ route theo vai trò. `allow` là danh sách vai trò được vào.
// Chờ profile tải xong (loading) trước khi quyết định; vai trò không hợp lệ bị chuyển về "/".
export default function RequireRole({ allow, children }) {
  const { role, loading, profile } = useAuth()
  if (loading || !profile) return null
  if (!allow.includes(role)) return <Navigate to="/" replace />
  return children
}
