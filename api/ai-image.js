// Vercel Serverless Function: tự động dò model tạo ảnh khả dụng trên Google AI Studio (GEMINI_API_KEY),
// nếu tài khoản Google Free chưa mở quyền tạo ảnh thì dùng dịch vụ tạo ảnh miễn phí dự phòng.

export const config = {
  maxDuration: 60,
}

async function discoverGoogleImageModels(apiKey) {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    )
    if (!r.ok) return { generateContent: [], predict: [] }
    const data = await r.json()
    const list = Array.isArray(data?.models) ? data.models : []
    const generateContent = []
    const predict = []

    for (const m of list) {
      const id = String(m.name || '').replace(/^models\//, '')
      const lower = id.toLowerCase()
      const methods = m.supportedGenerationMethods || []
      if (lower.includes('image') && !lower.includes('imagen')) {
        if (methods.includes('generateContent')) generateContent.push(id)
      } else if (lower.includes('imagen')) {
        if (methods.includes('predict')) predict.push(id)
        else if (methods.includes('generateContent')) generateContent.push(id)
      }
    }
    return { generateContent, predict }
  } catch {
    return { generateContent: [], predict: [] }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const { prompt = '', style = 'luxury' } = req.body || {}
  if (!prompt.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập mô tả bức ảnh cần tạo.' })
  }

  const fullPrompt = `Editorial luxury Vietnamese wedding decoration photography, minimalist warm ivory, cream and deep forest green aesthetic with soft champagne gold accents, natural daylight, photorealistic, high-end magazine style, no text, no watermarks, no people. Scene: ${prompt.trim()} (${style}).`

  let lastErr = ''

  if (apiKey) {
    const discovered = await discoverGoogleImageModels(apiKey)
    const gcModels = Array.from(
      new Set([
        ...discovered.generateContent,
        'gemini-2.5-flash-image',
        'gemini-3.1-flash-image-preview',
      ])
    )

    for (const model of gcModels) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 14000)
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
        const gRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { responseModalities: ['IMAGE'] },
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

    const predModels = Array.from(
      new Set([...discovered.predict, 'imagen-4.0-generate-001', 'imagen-3.0-generate-002'])
    )
    for (const model of predModels) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 14000)
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
  }

  // Dự phòng miễn phí (Pollinations Flux) nếu Google AI Studio Free key không bật tạo ảnh
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 22000)
    try {
      const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1280&height=720&nologo=true&seed=${Date.now()}`
      const pRes = await fetch(pUrl, { signal: controller.signal })
      if (pRes.ok) {
        const contentType = pRes.headers.get('content-type') || 'image/jpeg'
        if (contentType.startsWith('image/')) {
          const buf = Buffer.from(await pRes.arrayBuffer())
          return res.status(200).json({
            dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
            model: 'pollinations-flux',
          })
        }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (pErr) {
    lastErr = lastErr || pErr.message
  }

  return res.status(502).json({
    error: `Không tạo được ảnh (${lastErr || 'Google Free Key chưa bật quyền tạo ảnh'}).`,
  })
}
