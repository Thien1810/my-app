// Gọi Google Gemini API (gói miễn phí) qua /api/ai-seo (bảo mật) hoặc key lưu ở trình duyệt

const GEMINI_STORAGE_KEY = 'dangwed_gemini_api_key'

export function getSavedGeminiKey() {
  try {
    return localStorage.getItem(GEMINI_STORAGE_KEY) || import.meta.env.VITE_GEMINI_API_KEY || ''
  } catch {
    return import.meta.env.VITE_GEMINI_API_KEY || ''
  }
}

export function saveGeminiKey(key = '') {
  try {
    if (key.trim()) {
      localStorage.setItem(GEMINI_STORAGE_KEY, key.trim())
    } else {
      localStorage.removeItem(GEMINI_STORAGE_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

async function callAiPayload(apiKey, payload, directPrompt) {
  const key = (apiKey || '').trim()

  if (!key) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 22000)
    try {
      const srvRes = await fetch('/api/ai-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ topic: payload.topic, ...payload }),
      })
      const srvData = await srvRes.json().catch(() => ({}))
      if (srvRes.ok) return srvData
      if (srvData?.error === 'MISSING_SERVER_KEY') {
        throw new Error('Vui lòng nhập Google Gemini API Key hoặc cấu hình GEMINI_API_KEY trên Vercel.')
      }
      throw new Error(`Lỗi AI Server: ${srvData?.error || `HTTP ${srvRes.status}`}`)
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('AI phản hồi quá lâu (>22s). Anh bấm thử lại giúp em 1 lần nữa nhé.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: directPrompt }] }],
      generationConfig: {
        temperature: 0.65,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(`Lỗi Gemini API: ${errBody?.error?.message || `HTTP ${res.status}`}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  return JSON.parse(cleaned)
}

function normalizeArticleResult(parsed, fallbackTitle = '') {
  return {
    title: parsed.title || fallbackTitle,
    seo_keywords: parsed.seo_keywords || '',
    excerpt: parsed.excerpt || '',
    intro: parsed.intro || '',
    sections: Array.isArray(parsed.sections)
      ? parsed.sections.map((s) => ({
          heading: s.heading || '',
          body: s.body || '',
          imageUrl: '',
          imageAlt: '',
        }))
      : [],
    conclusionQuote: parsed.conclusionQuote || '',
  }
}

export async function generateSeoArticleWithGemini({
  apiKey,
  topic,
  keyword = '',
  category = 'Kinh nghiệm cưới',
}) {
  if (!topic || !topic.trim()) {
    throw new Error('Vui lòng nhập chủ đề hoặc ý tưởng bài viết.')
  }
  const directPrompt = `Bạn là chuyên gia viết bài SEO ngành trang trí cưới hỏi cao cấp tại Việt Nam cho "Đặng Wedding". Hãy viết bài SEO về chủ đề "${topic.trim()}" (Chuyên mục: ${category}${keyword ? `, từ khóa: ${keyword}` : ''}). Không bịa giá tiền. Trả về JSON {title, seo_keywords, excerpt, intro, sections:[{heading, body}], conclusionQuote}.`
  const data = await callAiPayload(
    apiKey,
    { mode: 'article', topic, keyword, category },
    directPrompt
  )
  return normalizeArticleResult(data, topic.trim())
}

export async function optimizeExistingArticleWithGemini({ apiKey, post }) {
  const directPrompt = `Tối ưu SEO Google cho bài viết "${post?.title || ''}" của Đặng Wedding. Giữ nguyên ý chính, không bịa giá tiền. Trả về JSON {title, seo_keywords, excerpt, intro, sections:[{heading, body}], conclusionQuote}. Nội dung gốc: ${post?.content || ''}`
  const data = await callAiPayload(
    apiKey,
    { mode: 'optimize_article', existingPost: post },
    directPrompt
  )
  return normalizeArticleResult(data, post?.title || '')
}

export async function optimizeHomepageSeoWithGemini({ apiKey, settings }) {
  const directPrompt = `Tối ưu 3 đoạn văn trang chủ chuẩn SEO cho Đặng Wedding (Trang trí Gia tiên, Mâm quả, Cổng hoa, Backdrop, Rạp bàn ghế). Trả về JSON {hero_subtitle, about_title, about_body}.`
  return callAiPayload(
    apiKey,
    { mode: 'optimize_home', currentSettings: settings },
    directPrompt
  )
}
