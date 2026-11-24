// Helper dùng chung cho các API serverless (tên bắt đầu bằng "_" nên Vercel không coi là endpoint).
// Xác thực bằng access_token của Supabase (KHÔNG dùng service_role), kiểm tra vai trò và giới hạn tần suất.

// Giá trị công khai mặc định (URL + publishable key), trùng với src/lib/supabase.js. Không phải secret.
const DEFAULT_SUPABASE_URL = 'https://kdcendxxipxstlxuhnwh.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_0GJolCoGzUmNbO8MAwC3YQ_IclKm0bt'

const ALLOWED_ROLES = ['admin', 'manager', 'storekeeper']

function getSupabaseConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL
  )
    .trim()
    .replace(/\/+$/, '')
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_SUPABASE_ANON_KEY
  ).trim()
  return { url, anonKey }
}

async function fetchJson(url, headers, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers, signal: controller.signal })
    const body = await r.json().catch(() => null)
    return { ok: r.ok, status: r.status, body }
  } finally {
    clearTimeout(timer)
  }
}

// Trả về { ok: true, userId, role } hoặc { ok: false, status, error }
export async function authenticate(req) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match ? match[1].trim() : ''
  if (!token) {
    return { ok: false, status: 401, error: 'Bạn chưa đăng nhập. Vui lòng đăng nhập lại.' }
  }

  const { url, anonKey } = getSupabaseConfig()
  const headers = { Authorization: `Bearer ${token}`, apikey: anonKey }

  try {
    const userRes = await fetchJson(`${url}/auth/v1/user`, headers)
    const userId = userRes.body?.id
    if (!userRes.ok || !userId) {
      return { ok: false, status: 401, error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.' }
    }

    // Đọc vai trò bằng chính token của người dùng (RLS cho phép đọc hồ sơ của mình)
    const profRes = await fetchJson(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role`,
      headers
    )
    const role = Array.isArray(profRes.body) ? profRes.body[0]?.role : null
    if (!profRes.ok || !role || !ALLOWED_ROLES.includes(role)) {
      return { ok: false, status: 403, error: 'Tài khoản của bạn không có quyền dùng chức năng AI.' }
    }

    return { ok: true, userId, role }
  } catch {
    return { ok: false, status: 401, error: 'Không xác minh được đăng nhập. Vui lòng thử lại.' }
  }
}

// Giới hạn tần suất theo user id, lưu trong bộ nhớ.
// Chỉ là best-effort: serverless có thể chạy nhiều instance và khởi động lạnh sẽ xóa bộ đếm.
const rateBuckets = new Map()

export function checkRateLimit(userId, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now()
  const hits = (rateBuckets.get(userId) || []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    rateBuckets.set(userId, hits)
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000))
    return { ok: false, retryAfter }
  }
  hits.push(now)
  rateBuckets.set(userId, hits)
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets) {
      if (!v.some((t) => now - t < windowMs)) rateBuckets.delete(k)
    }
  }
  return { ok: true }
}

// Xác thực + phân quyền + giới hạn tần suất. Trả về userId nếu qua, hoặc null (đã tự trả lỗi qua res).
export async function requireStaffAuth(req, res) {
  const auth = await authenticate(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return null
  }
  const rate = checkRateLimit(auth.userId)
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfter))
    res.status(429).json({ error: `Anh thao tác hơi nhanh, vui lòng thử lại sau ${rate.retryAfter} giây.` })
    return null
  }
  return auth.userId
}

// Kiểm tra độ dài chuỗi; trả về thông báo lỗi hoặc ''.
export function tooLong(value, max, label) {
  if (value == null) return ''
  const len = typeof value === 'string' ? value.length : JSON.stringify(value).length
  return len > max ? `${label} quá dài (tối đa ${max} ký tự).` : ''
}
