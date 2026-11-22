// Vercel Serverless Function: tạo ảnh minh họa tiệc cưới bằng Google Gemini / Imagen API (dùng GEMINI_API_KEY)

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

  const { prompt = '', style = 'luxury' } = req.body || {}
  if (!prompt.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập mô tả bức ảnh cần tạo.' })
  }

  const fullPrompt = `Editorial luxury Vietnamese wedding decoration photography, minimalist warm ivory, cream and deep forest green aesthetic with soft champagne gold accents, natural daylight, photorealistic, high-end magazine style, no text, no watermarks, no people. Scene: ${prompt.trim()} (${style}).`

  // 1. Thử các model Gemini Image (generateContent với responseModalities IMAGE)
  const geminiImageModels = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation',
  ]
  let lastErr = ''

  for (const model of geminiImageModels) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 16000)
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const gRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        }),
      })
      if (gRes.ok) {
        const data = await gRes.json()
        const parts = data?.candidates?.[0]?.content?.parts || []
        const imgPart = parts.find((p) => p?.inlineData?.data)
        if (imgPart) {
          const mime = imgPart.inlineData.mimeType || 'image/png'
          return res.status(200).json({
            dataUrl: `data:${mime};base64,${imgPart.inlineData.data}`,
            model,
          })
        }
      }
      const errBody = await gRes.json().catch(() => ({}))
      lastErr = errBody?.error?.message || `HTTP ${gRes.status}`
    } catch (err) {
      lastErr = err?.name === 'AbortError' ? `${model} timeout` : err.message
    } finally {
      clearTimeout(timer)
    }
  }

  // 2. Dự phòng sang Imagen 4 / Imagen 3 (:predict)
  const imagenModels = ['imagen-4.0-generate-001', 'imagen-3.0-generate-002']
  for (const model of imagenModels) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 16000)
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(apiKey)}`
      const iRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          instances: [{ prompt: fullPrompt }],
          parameters: { sampleCount: 1, aspectRatio: '16:9' },
        }),
      })
      if (iRes.ok) {
        const data = await iRes.json()
        const b64 = data?.predictions?.[0]?.bytesBase64Encoded
        if (b64) {
          return res.status(200).json({
            dataUrl: `data:image/png;base64,${b64}`,
            model,
          })
        }
      }
      const errBody = await iRes.json().catch(() => ({}))
      lastErr = errBody?.error?.message || `HTTP ${iRes.status}`
    } catch (err) {
      lastErr = err?.name === 'AbortError' ? `${model} timeout` : err.message
    } finally {
      clearTimeout(timer)
    }
  }

  return res.status(502).json({
    error: `Không tạo được ảnh từ Google AI Studio (${lastErr}). Có thể gói key hiện tại chưa bật quyền tạo ảnh.`,
  })
}
