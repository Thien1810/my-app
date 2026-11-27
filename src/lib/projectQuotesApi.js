// Tầng dữ liệu báo giá dự án (bảng project_quotes, xem supabase/projects_phase2.sql).
// Mọi hàm trả { row, error, conflict, missingSchema } và không throw.
import { supabase } from './supabase'
import { isMissingSchemaError } from './projectRules'

const COLS = 'project_id, data, updated_at, updated_by'
const wrap = (error) => ({ row: null, error, conflict: false, missingSchema: isMissingSchemaError(error) })

export async function loadProjectQuote(projectId) {
  if (!supabase) return wrap({ message: 'Chưa cấu hình Supabase.' })
  const { data, error } = await supabase.from('project_quotes').select(COLS).eq('project_id', projectId).maybeSingle()
  if (error) return wrap(error)
  return { row: data || null, error: null, conflict: false, missingSchema: false }
}

// Tạo mới (DB chưa có báo giá). Trùng khóa = máy khác vừa tạo -> conflict.
export async function insertProjectQuote(projectId, data) {
  if (!supabase) return wrap({ message: 'Chưa cấu hình Supabase.' })
  const res = await supabase.from('project_quotes').insert({ project_id: projectId, data }).select(COLS).single()
  if (res.error) {
    if (res.error.code === '23505') return { row: null, error: null, conflict: true, missingSchema: false }
    return wrap(res.error)
  }
  return { row: res.data, error: null, conflict: false, missingSchema: false }
}

// Cập nhật có điều kiện: chỉ ghi khi updated_at trên DB vẫn bằng expectedUpdatedAt (khóa lạc quan).
// 0 dòng được ghi = máy khác đã sửa (hoặc báo giá đã bị xóa) -> conflict.
// expectedUpdatedAt = null: ghi đè không điều kiện (người dùng đã chọn "Ghi đè").
export async function updateProjectQuote(projectId, data, expectedUpdatedAt) {
  if (!supabase) return wrap({ message: 'Chưa cấu hình Supabase.' })
  let q = supabase.from('project_quotes').update({ data }).eq('project_id', projectId)
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
  const res = await q.select(COLS)
  if (res.error) return wrap(res.error)
  if (!res.data || res.data.length === 0) return { row: null, error: null, conflict: true, missingSchema: false }
  return { row: res.data[0], error: null, conflict: false, missingSchema: false }
}
