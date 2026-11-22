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

  const models = [
    'gemini-3.8-flash',
    'gemini-3.8-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash-lite',
  ]
  let lastErr = ''

  for (const model of models) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 11000)
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: directPrompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 1600,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
        return JSON.parse(cleaned)
      }

      const errBody = await res.json().catch(() => ({}))
      lastErr = errBody?.error?.message || `HTTP ${res.status}`
      const lower = lastErr.toLowerCase()
      const shouldFallback =
        res.status === 404 ||
        res.status === 429 ||
        res.status === 503 ||
        res.status === 500 ||
        lower.includes('no longer available') ||
        lower.includes('high demand') ||
        lower.includes('overloaded') ||
        lower.includes('thinking')
      if (!shouldFallback) {
        throw new Error(`Lỗi Gemini API: ${lastErr}`)
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        lastErr = `${model} timeout (11s)`
        continue
      }
      if (String(err?.message || '').startsWith('Lỗi Gemini API:')) throw err
      lastErr = err.message
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(`Lỗi Gemini API: ${lastErr || 'Tất cả model đang bận, anh thử lại sau vài giây.'}`)
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

export async function generateFacebookCaptionWithAi({ apiKey, fbContext }) {
  const directPrompt = `Viết 1 bài đăng Fanpage Facebook sang trọng, tinh tế cho Đặng Wedding (SĐT/Zalo 0918.80.90.96, dangwed.com) về dự án "${fbContext?.projectName || ''}", khách "${fbContext?.customerName || ''}", mẫu "${fbContext?.setNames || ''}". Trả về JSON {caption}.`
  const data = await callAiPayload(
    apiKey,
    { mode: 'facebook_caption', fbContext },
    directPrompt
  )
  return data?.caption || ''
}

function compressDataUrl(dataUrl, maxWidth = 1000, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * ratio))
      const h = Math.max(1, Math.round(img.height * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      let out = canvas.toDataURL('image/webp', quality)
      if (!out.startsWith('data:image/webp')) {
        out = canvas.toDataURL('image/jpeg', quality)
      }
      resolve(out)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export async function generateAiWeddingImage({ prompt, style = 'luxury' }) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Vui lòng nhập mô tả ảnh muốn tạo.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 32000)
  try {
    const res = await fetch('/api/ai-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ prompt, style }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.dataUrl) {
      throw new Error(data?.error || `Lỗi tạo ảnh HTTP ${res.status}`)
    }
    const compressed = await compressDataUrl(data.dataUrl)
    return compressed
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('AI tạo ảnh mất quá nhiều thời gian (>32s). Anh thử lại nhé.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
