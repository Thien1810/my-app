// Viết mô tả mẫu set bằng AI qua /api/ai-seo (mode 'set_description'), cùng cách xác thực Bearer như aiSeoWriter.
import { authErrorMessage, getAuthHeaders } from './aiSeoWriter'
import { sanitizeDescription } from './setTemplates'

// Giới hạn máy chủ: 30 lần/phút/người dùng. Giữ khoảng cách tối thiểu giữa 2 lần gọi liên tiếp (chạy hàng loạt).
export const AI_MIN_GAP_MS = 2500

export async function generateSetDescription({ name, category, itemNames }) {
  // Chỉ gửi dữ liệu thô (tên, loại, tên vật tư); máy chủ tự dựng prompt có quy tắc cấm số lượng/giá.
  const payload = {
    mode: 'set_description',
    name: String(name || '').trim().slice(0, 120),
    category: String(category || '').trim().slice(0, 100),
    itemNames: [...new Set((itemNames || []).map((n) => String(n).trim().slice(0, 80)).filter(Boolean))].slice(0, 12),
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch('/api/ai-seo', {
      method: 'POST',
      headers: await getAuthHeaders(),
      signal: controller.signal,
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      let message = authErrorMessage(res.status, data?.error)
      if (!message) {
        message =
          data?.error === 'MISSING_SERVER_KEY'
            ? 'Máy chủ chưa cấu hình GEMINI_API_KEY trên Vercel.'
            : `Lỗi AI Server: ${data?.error || `HTTP ${res.status}`}`
      }
      const error = new Error(message)
      error.status = res.status
      error.retryAfter = Number(res.headers.get('Retry-After')) || 0
      throw error
    }
    const description = sanitizeDescription(data?.description)
    if (!description) {
      throw new Error(
        'AI chưa trả về mô tả. Nếu api/ai-seo.js mới được sửa, cần deploy bản mới lên Vercel trước.'
      )
    }
    return description
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('AI phản hồi quá lâu (>25s). Anh bấm thử lại giúp em 1 lần nữa nhé.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
