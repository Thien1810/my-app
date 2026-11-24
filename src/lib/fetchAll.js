// Lấy toàn bộ dòng của một truy vấn supabase-js, vượt giới hạn 1000 dòng/lần của Supabase.
// buildQuery(from, to) phải trả query đã gắn .range(from, to) và PHẢI có order ổn định
// (ví dụ .order('id')) để các trang không bị lặp/mất dòng.
// Trả { data, error }; dừng và trả lỗi ngay khi một trang lỗi.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const all = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const rows = data || []
    for (const r of rows) all.push(r)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return { data: all, error: null }
}
