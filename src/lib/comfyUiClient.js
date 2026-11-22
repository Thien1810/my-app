// Kết nối trực tiếp tới ComfyUI chạy local trên máy tính (mặc định http://127.0.0.1:8188)
// Yêu cầu khởi động ComfyUI với cờ: --enable-cors-header *

const COMFY_CFG_KEY = 'dangwed_comfy_config'

export function getComfyConfig() {
  try {
    const raw = localStorage.getItem(COMFY_CFG_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return {
    provider: 'cloud', // 'cloud' | 'comfyui'
    url: 'http://127.0.0.1:8188',
    checkpoint: '',
    steps: 24,
    cfg: 7,
    workflowJson: '', // Dán JSON Export (API Format) từ ComfyUI để dùng workflow riêng
  }
}

export function saveComfyConfig(cfg) {
  try {
    localStorage.setItem(COMFY_CFG_KEY, JSON.stringify(cfg))
  } catch {
    // ignore
  }
}

function normalizeUrl(url = 'http://127.0.0.1:8188') {
  return String(url || 'http://127.0.0.1:8188').trim().replace(/\/+$/, '')
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

export async function testComfyConnection(baseUrl = 'http://127.0.0.1:8188') {
  const cleanUrl = normalizeUrl(baseUrl)
  try {
    const res = await fetch(`${cleanUrl}/object_info/CheckpointLoaderSimple`, {
      method: 'GET',
    })
    if (!res.ok) {
      throw new Error(`ComfyUI trả về HTTP ${res.status}`)
    }
    const data = await res.json()
    const ckpts =
      data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || []
    return { ok: true, checkpoints: Array.isArray(ckpts) ? ckpts : [] }
  } catch (err) {
    const msg = String(err?.message || '')
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      throw new Error(
        `Không kết nối được tới ${cleanUrl}. Anh kiểm tra: (1) ComfyUI đang mở, và (2) đã thêm cờ "--enable-cors-header *" khi chạy ComfyUI chưa.`
      )
    }
    throw err
  }
}

function blobToCompressedDataUrl(blob, maxWidth = 1000, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objUrl)
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
    img.onerror = () => {
      URL.revokeObjectURL(objUrl)
      reject(new Error('Không đọc được ảnh xuất ra từ ComfyUI.'))
    }
    img.src = objUrl
  })
}

function buildCustomWorkflow(workflowJson, positivePrompt, seed) {
  let raw = String(workflowJson || '').trim()
  if (!raw) return null

  const hasPlaceholder = raw.includes('{{PROMPT}}')
  if (hasPlaceholder) {
    raw = raw.replaceAll('{{PROMPT}}', positivePrompt.replace(/"/g, '\\"'))
  }

  let wf
  try {
    wf = JSON.parse(raw)
  } catch {
    throw new Error('File Workflow API JSON không hợp lệ. Trong ComfyUI anh nhớ chọn "Save (API Format)" nhé.')
  }

  // Tự động thay thế seed ngẫu nhiên và chèn prompt nếu chưa dùng {{PROMPT}}
  let injectedPrompt = hasPlaceholder
  for (const nodeId of Object.keys(wf)) {
    const node = wf[nodeId]
    if (!node || typeof node !== 'object' || !node.inputs) continue

    if ('seed' in node.inputs && typeof node.inputs.seed === 'number') {
      node.inputs.seed = seed
    }
    if ('noise_seed' in node.inputs && typeof node.inputs.noise_seed === 'number') {
      node.inputs.noise_seed = seed
    }

    if (!injectedPrompt) {
      const cls = String(node.class_type || '').toLowerCase()
      const txt = String(node.inputs.text || node.inputs.t5xxl || node.inputs.clip_l || '')
      const isNegative = /ugly|blurry|watermark|bad|deformed|nsfw|worst/i.test(txt)
      if ((cls.includes('cliptextencode') || cls.includes('prompt')) && !isNegative) {
        if ('text' in node.inputs) node.inputs.text = positivePrompt
        if ('t5xxl' in node.inputs) node.inputs.t5xxl = positivePrompt
        if ('clip_l' in node.inputs) node.inputs.clip_l = positivePrompt
        injectedPrompt = true
      }
    }
  }

  return wf
}

export async function generateImageWithComfyUI({
  baseUrl = 'http://127.0.0.1:8188',
  checkpoint = '',
  prompt = '',
  steps = 24,
  cfg = 7,
  workflowJson = '',
}) {
  const cleanUrl = normalizeUrl(baseUrl)
  const asciiScene = toAsciiPrompt(prompt).slice(0, 160)
  const positive = `editorial luxury Vietnamese wedding decoration photography, minimalist ivory white cream and deep forest green, champagne gold accents, natural sunlight, photorealistic, high-end magazine, ${asciiScene}`
  const negative = 'text, watermark, signature, blurry, low quality, deformed, people, crowd, messy'
  const seed = Math.floor(Math.random() * 1e12)

  let workflow = buildCustomWorkflow(workflowJson, positive, seed)

  if (!workflow) {
    let ckptName = (checkpoint || '').trim()
    if (!ckptName) {
      const info = await testComfyConnection(cleanUrl)
      if (info.checkpoints.length === 0) {
        throw new Error('Không tìm thấy file model Checkpoint nào trong ComfyUI/models/checkpoints.')
      }
      ckptName = info.checkpoints[0]
    }

    // Kích thước chuẩn 16:9 (1024x576 cho SDXL/Flux hoặc 768x432 cho SD1.5)
    const isSd15 = ckptName.toLowerCase().includes('v1-5') || ckptName.toLowerCase().includes('sd15')
    const width = isSd15 ? 768 : 1024
    const height = isSd15 ? 432 : 576

    workflow = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: Number(steps) || 24,
          cfg: Number(cfg) || 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: ckptName },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width, height, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: positive, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: negative, clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'dangwed_ai', images: ['8', 0] },
      },
    }
  }

  const clientId = `dangwed_${Date.now()}`
  const qRes = await fetch(`${cleanUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })

  if (!qRes.ok) {
    const errText = await qRes.text().catch(() => '')
    throw new Error(`ComfyUI từ chối lệnh tạo ảnh (HTTP ${qRes.status}): ${errText.slice(0, 120)}`)
  }

  const { prompt_id: promptId } = await qRes.json()
  if (!promptId) throw new Error('ComfyUI không trả về prompt_id.')

  // Chờ ComfyUI render tối đa ~90 giây
  let outputImg = null
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const hRes = await fetch(`${cleanUrl}/history/${promptId}`)
    if (!hRes.ok) continue
    const hData = await hRes.json()
    const item = hData?.[promptId]
    if (item?.outputs) {
      for (const nodeOut of Object.values(item.outputs)) {
        if (Array.isArray(nodeOut?.images) && nodeOut.images.length > 0) {
          outputImg = nodeOut.images[0]
          break
        }
      }
      if (outputImg) break
    }
  }

  if (!outputImg) {
    throw new Error('ComfyUI vẽ quá 90 giây chưa xong. Anh kiểm tra cửa sổ console của ComfyUI nhé.')
  }

  const viewParams = new URLSearchParams({
    filename: outputImg.filename,
    subfolder: outputImg.subfolder || '',
    type: outputImg.type || 'output',
  })
  const imgRes = await fetch(`${cleanUrl}/view?${viewParams.toString()}`)
  if (!imgRes.ok) throw new Error('Không tải được ảnh kết quả từ ComfyUI.')
  const blob = await imgRes.blob()
  return blobToCompressedDataUrl(blob)
}
