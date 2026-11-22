// Vercel Serverless Function: gọi Google Gemini API từ server để giấu kín GEMINI_API_KEY
// Hỗ trợ 3 chế độ: 'article' (viết bài mới), 'optimize_article' (tối ưu bài có sẵn), 'optimize_home' (tối ưu SEO trang chủ)

export const config = {
  maxDuration: 60,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) {
    return res.status(400).json({ error: 'MISSING_SERVER_KEY' })
  }

  const {
    mode = 'article',
    topic = '',
    keyword = '',
    category = 'Kinh nghiệm cưới',
    existingPost = null,
    currentSettings = null,
    fbContext = null,
  } = req.body || {}

  let prompt = ''

  if (mode === 'facebook_caption') {
    prompt = `Bạn là chuyên viên truyền thông của thương hiệu trang trí cưới hỏi cao cấp "Đặng Wedding" (Hotline/Zalo: 0918.80.90.96, Website: https://dangwed.com).
Hãy viết 1 bài đăng Facebook (Caption) thật tinh tế, sang trọng, giàu cảm xúc và thu hút khách đặt lịch cho đám cưới sau:
- Tên dự án / buổi lễ: "${fbContext?.projectName || 'Lễ Gia Tiên & Tiệc Cưới'}"
- Tên cô dâu chú rể / khách hàng: "${fbContext?.customerName || 'Cô dâu & Chú rể'}"
- Mẫu set trang trí đã dùng: "${fbContext?.setNames || 'Theo concept riêng'}"
- Phong cách mong muốn: "${fbContext?.tone || 'Sang trọng, tối giản, ấm áp'}"

Yêu cầu:
- Trình bày đẹp mắt để đăng Fanpage Facebook (có icon nhẹ nhàng tinh tế, chia đoạn rõ ràng, cuối bài có thông tin liên hệ Hotline/Zalo 0918.80.90.96, Website dangwed.com và 5-7 hashtag phù hợp).
- Không bịa giá tiền.
- Trả về DUY NHẤT JSON hợp lệ: { "caption": "nội dung bài viết Facebook hoàn chỉnh..." }`
  } else if (mode === 'optimize_home') {
    prompt = `Bạn là chuyên gia SEO & Copywriter cao cấp ngành cưới hỏi tại Việt Nam cho thương hiệu "Đặng Wedding" (phong cách sang trọng, tối giản; slogan: "${currentSettings?.slogan || 'Là ngày đẹp nhất'}"; dịch vụ: Trang trí Gia tiên, Mâm quả cưới hỏi, Cổng hoa cưới, Backdrop tiệc cưới, Cho thuê rạp & bàn ghế).

Hãy tối ưu lại 3 đoạn nội dung trang chủ sau để tự nhiên, sang trọng và giàu từ khóa SEO Google nhất (KHÔNG nhắc tên tỉnh/thành phố cụ thể, KHÔNG bịa giá tiền):
- hero_subtitle hiện tại: "${currentSettings?.hero_subtitle || ''}"
- about_title hiện tại: "${currentSettings?.about_title || ''}"
- about_body hiện tại: "${currentSettings?.about_body || ''}"

Trả về DUY NHẤT JSON hợp lệ:
{
  "hero_subtitle": "1-2 câu mô tả trang nhã ngay dưới slogan (khoảng 110-155 ký tự, chứa từ khóa trang trí gia tiên, mâm quả cưới hỏi, tiệc cưới)",
  "about_title": "1 câu tiêu đề giới thiệu thương hiệu tinh tế (khoảng 8-14 từ)",
  "about_body": "Đoạn giới thiệu 2-3 câu tự nhiên, nhấn mạnh 3+ năm kinh nghiệm, 100+ lễ cưới trọn vẹn và các hạng mục Gia tiên, Mâm quả, Cổng hoa, Backdrop, Rạp bàn ghế"
}`
  } else if (mode === 'optimize_article') {
    if (!existingPost?.title) {
      return res.status(400).json({ error: 'Thiếu thông tin bài viết cần tối ưu.' })
    }
    prompt = `Bạn là chuyên gia SEO Google tại Việt Nam cho thương hiệu "Đặng Wedding".
Hãy tối ưu lại bài viết sau để đạt 100/100 điểm SEO (giữ nguyên ý nghĩa cốt lõi và mọi đường dẫn ảnh ![...](...) nếu có, KHÔNG bịa giá tiền, KHÔNG nhắc tên địa phương cụ thể):

- Tiêu đề hiện tại: "${existingPost.title}"
- Chuyên mục: "${existingPost.category || category}"
- Từ khóa hiện tại: "${existingPost.seo_keywords || ''}"
- Tóm tắt hiện tại: "${existingPost.excerpt || ''}"
- Nội dung hiện tại:
${existingPost.content || ''}

Trả về DUY NHẤT JSON hợp lệ:
{
  "title": "Tiêu đề H1 chuẩn SEO dài 45-68 ký tự, chứa từ khóa chính ở đầu",
  "seo_keywords": "từ khóa chính, từ khóa phụ 1, từ khóa phụ 2",
  "excerpt": "Meta description hấp dẫn dài 125-155 ký tự, chứa từ khóa chính",
  "intro": "Đoạn mở bài 2-3 câu chứa từ khóa chính",
  "sections": [
    { "heading": "1. Tiêu đề mục H2...", "body": "Nội dung chi tiết hoặc danh sách '- '..." }
  ],
  "conclusionQuote": "Lời khuyên / cam kết từ Đặng Wedding cuối bài"
}`
  } else {
    if (!topic.trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập chủ đề bài viết.' })
    }
    prompt = `Bạn là chuyên gia viết bài SEO ngành trang trí cưới hỏi cao cấp tại Việt Nam cho thương hiệu "Đặng Wedding" (phong cách sang trọng, tối giản, tinh tế; dịch vụ gồm: Trang trí Gia tiên, Mâm quả cưới hỏi, Cổng hoa cưới, Backdrop tiệc cưới, Cho thuê rạp & bàn ghế; Hotline/Zalo: 0918.80.90.96).

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
    { "heading": "1. Tiêu đề mục H2 rõ ràng", "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '" },
    { "heading": "2. Tiêu đề mục H2 thứ hai", "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '" },
    { "heading": "3. Tiêu đề mục H2 thứ ba", "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '" },
    { "heading": "4. Lưu ý quan trọng khi đặt dịch vụ", "body": "- Lưu ý 1\\n- Lưu ý 2\\n- Lưu ý 3" }
  ],
  "conclusionQuote": "Lời khuyên ngắn gọn hoặc cam kết từ Đặng Wedding cuối bài (1-2 câu)"
}`
  }

  try {
    const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash']
    let gRes = null
    let lastErr = ''

    const callModel = async (model) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
        return await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.6,
              maxOutputTokens: 1600,
              responseMimeType: 'application/json',
            },
          }),
        })
      } finally {
        clearTimeout(timer)
      }
    }

    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          gRes = await callModel(model)
        } catch (fetchErr) {
          lastErr = fetchErr?.name === 'AbortError' ? `${model} timeout` : fetchErr.message
          break
        }

        if (gRes.ok) break
        const errBody = await gRes.json().catch(() => ({}))
        lastErr = errBody?.error?.message || `Gemini HTTP ${gRes.status}`
        const lowerErr = lastErr.toLowerCase()

        if ((gRes.status === 503 || gRes.status === 429) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200))
          continue
        }

        const shouldFallback =
          gRes.status === 404 ||
          gRes.status === 429 ||
          gRes.status === 503 ||
          gRes.status === 500 ||
          lowerErr.includes('no longer available') ||
          lowerErr.includes('high demand') ||
          lowerErr.includes('overloaded') ||
          lowerErr.includes('thinking')
        if (!shouldFallback) {
          return res.status(gRes.status).json({ error: lastErr })
        }
        break
      }
      if (gRes?.ok) break
    }

    if (!gRes || !gRes.ok) {
      return res.status(gRes?.status || 500).json({ error: lastErr || 'Gemini error' })
    }

    const data = await gRes.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return res.status(200).json(parsed)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server AI error' })
  }
}
