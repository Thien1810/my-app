// Gọi Google Gemini API (gói miễn phí) để viết bài chuẩn SEO cho Đặng Wedding

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

export async function generateSeoArticleWithGemini({ apiKey, topic, keyword = '', category = 'Kinh nghiệm cưới' }) {
  if (!topic || !topic.trim()) {
    throw new Error('Vui lòng nhập chủ đề hoặc ý tưởng bài viết.')
  }

  const key = (apiKey || '').trim()

  // Nếu không có key ở trình duyệt, tự động gọi qua Vercel Serverless Function (/api/ai-seo)
  if (!key) {
    const srvRes = await fetch('/api/ai-seo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, keyword, category }),
    })
    const srvData = await srvRes.json().catch(() => ({}))
    if (srvRes.ok && srvData?.title) {
      return {
        title: srvData.title || topic.trim(),
        seo_keywords: srvData.seo_keywords || keyword.trim() || topic.trim(),
        excerpt: srvData.excerpt || '',
        intro: srvData.intro || '',
        sections: Array.isArray(srvData.sections)
          ? srvData.sections.map((s) => ({
              heading: s.heading || '',
              body: s.body || '',
              imageUrl: '',
              imageAlt: '',
            }))
          : [],
        conclusionQuote: srvData.conclusionQuote || '',
      }
    }
    if (srvData?.error === 'MISSING_SERVER_KEY') {
      throw new Error('Vui lòng nhập Google Gemini API Key hoặc cấu hình GEMINI_API_KEY trên Vercel.')
    }
    throw new Error(`Lỗi AI Server: ${srvData?.error || `HTTP ${srvRes.status}`}`)
  }

  const prompt = `Bạn là chuyên gia viết bài SEO ngành trang trí cưới hỏi cao cấp tại Việt Nam cho thương hiệu "Đặng Wedding" (phong cách sang trọng, tối giản, tinh tế; dịch vụ gồm: Trang trí Gia tiên, Mâm quả cưới hỏi, Cổng hoa cưới, Backdrop tiệc cưới, Cho thuê rạp & bàn ghế; Hotline/Zalo: 0918.80.90.96).

Hãy viết 1 bài blog chuẩn SEO Google bằng tiếng Việt về chủ đề: "${topic.trim()}".
Chuyên mục: "${category}".
${keyword.trim() ? `Từ khóa chính cần tối ưu: "${keyword.trim()}".` : ''}

Yêu cầu bắt buộc:
1. Không bịa giá tiền cụ thể (chỉ nhắc nhận báo giá trọn gói minh bạch).
2. Không nhắc tên địa phương cụ thể trừ khi chủ đề yêu cầu.
3. Trả về DUY NHẤT JSON hợp lệ (không bọc markdown \`\`\`json), theo đúng cấu trúc sau:
{
  "title": "Tiêu đề SEO hấp dẫn, chứa từ khóa chính (dài khoảng 45-68 ký tự)",
  "seo_keywords": "từ khóa chính, từ khóa phụ 1, từ khóa phụ 2",
  "excerpt": "Meta description hấp dẫn, chứa từ khóa chính (dài khoảng 120-155 ký tự)",
  "intro": "Đoạn mở bài 2-3 câu tự nhiên, thu hút cô dâu chú rể và nhắc từ khóa chính",
  "sections": [
    {
      "heading": "1. Tiêu đề mục H2 rõ ràng",
      "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '"
    },
    {
      "heading": "2. Tiêu đề mục H2 thứ hai",
      "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '"
    },
    {
      "heading": "3. Tiêu đề mục H2 thứ ba",
      "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '"
    },
    {
      "heading": "4. Lưu ý quan trọng khi đặt dịch vụ",
      "body": "- Lưu ý 1\\n- Lưu ý 2\\n- Lưu ý 3"
    }
  ],
  "conclusionQuote": "Lời khuyên ngắn gọn hoặc cam kết từ Đặng Wedding cuối bài (1-2 câu)"
}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = errBody?.error?.message || `HTTP ${res.status}`
    throw new Error(`Lỗi Gemini API: ${msg}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!text) {
    throw new Error('AI không trả về nội dung. Anh vui lòng thử lại.')
  }

  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI trả về định dạng chưa chuẩn JSON. Anh bấm tạo lại giúp em nhé.')
  }

  return {
    title: parsed.title || topic.trim(),
    seo_keywords: parsed.seo_keywords || keyword.trim() || topic.trim(),
    excerpt: parsed.excerpt || '',
    intro: parsed.intro || '',
    sections: Array.isArray(parsed.sections) && parsed.sections.length > 0
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
