// Vercel Serverless Function: gọi Google Gemini API từ server để giấu kín GEMINI_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) {
    return res.status(400).json({ error: 'MISSING_SERVER_KEY' })
  }

  const { topic = '', keyword = '', category = 'Kinh nghiệm cưới' } = req.body || {}
  if (!topic.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập chủ đề bài viết.' })
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
    { "heading": "1. Tiêu đề mục H2 rõ ràng", "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '" },
    { "heading": "2. Tiêu đề mục H2 thứ hai", "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '" },
    { "heading": "3. Tiêu đề mục H2 thứ ba", "body": "Nội dung chi tiết 2-4 câu hoặc các gạch đầu dòng bắt đầu bằng '- '" },
    { "heading": "4. Lưu ý quan trọng khi đặt dịch vụ", "body": "- Lưu ý 1\\n- Lưu ý 2\\n- Lưu ý 3" }
  ],
  "conclusionQuote": "Lời khuyên ngắn gọn hoặc cam kết từ Đặng Wedding cuối bài (1-2 câu)"
}`

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
    const gRes = await fetch(url, {
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

    if (!gRes.ok) {
      const errBody = await gRes.json().catch(() => ({}))
      return res.status(gRes.status).json({
        error: errBody?.error?.message || `Gemini HTTP ${gRes.status}`,
      })
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
