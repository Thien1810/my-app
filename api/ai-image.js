// Vercel Serverless Function: tự động dò model tạo ảnh khả dụng trên Google AI Studio,
// nếu key Google chưa bật tạo ảnh thì gọi ngay Pollinations Flux miễn phí (~6 giây).

export const config = {
  maxDuration: 60,
}

function toAsciiPrompt(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function discoverGoogleImageModels(apiKey) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: controller.signal }
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
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { generateContent: [], predict: [] }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const { prompt = '' } = req.body || {}
  if (!prompt.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập mô tả bức ảnh cần tạo.' })
  }

  const cleanTopic = toAsciiPrompt(prompt).slice(0, 120)
  const fullPrompt = `Editorial luxury Vietnamese wedding decor photography, minimalist warm ivory, cream and deep forest green, soft gold accents, natural light, photorealistic, no text, no watermark. Scene: ${cleanTopic}`

  let lastErr = ''

  if (apiKey) {
    const discovered = await discoverGoogleImageModels(apiKey)

    for (const model of discovered.generateContent.slice(0, 2)) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
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

    for (const model of discovered.predict.slice(0, 2)) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
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

  // Gọi ngay Pollinations Flux miễn phí (~6 giây)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 22000)
    try {
      const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=576&nologo=true&seed=${Date.now() % 100000}`
      const pRes = await fetch(pUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'DangWeddingApp/1.0' },
      })
      if (pRes.ok) {
        const contentType = pRes.headers.get('content-type') || 'image/jpeg'
        if (contentType.startsWith('image/')) {
          const buf = Buffer.from(await pRes.arrayBuffer())
          return res.status(200).json({
            dataUrl: `data:${contentType};base64,${buf.toString('base64')}`,
            model: 'pollinations-flux',
          })
        }
      } else {
        lastErr = `Pollinations HTTP ${pRes.status}`
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (pErr) {
    lastErr = pErr?.name === 'AbortError' ? 'Pollinations timeout' : pErr.message
  }

  return res.status(502).json({
    error: `Không tạo được ảnh (${lastErr || 'vui lòng thử lại sau vài giây'}).`,
  })
}
