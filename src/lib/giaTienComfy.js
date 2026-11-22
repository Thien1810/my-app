// Tích hợp chuẩn theo API_HANDOFF.md & prompt_builder.py (d:\0. AI\3. Flow Comfy\)
// Hỗ trợ cả Text-to-Image (Flux.1 Dev FP8) và Image-to-Image (ảnh mặt bằng nhà khách)

export const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 (Banner / Bài viết)', renderW: 1344, renderH: 768, webW: 1280, webH: 720 },
  { value: '3:2', label: '3:2 (Ảnh ngang chuẩn)', renderW: 1248, renderH: 832, webW: 1200, webH: 800 },
  { value: '1:1', label: '1:1 (Vuông Facebook)', renderW: 1024, renderH: 1024, webW: 1000, webH: 1000 },
  { value: '4:5', label: '4:5 (Dọc Facebook/IG)', renderW: 896, renderH: 1088, webW: 800, webH: 1000 },
  { value: '9:16', label: '9:16 (Story / TikTok)', renderW: 768, renderH: 1344, webW: 720, webH: 1280 },
]

export const TONE_OPTIONS = [
  { value: 'do_truyen_thong', label: 'Đỏ truyền thống & Vàng đồng' },
  { value: 'pastel_hong', label: 'Pastel Hồng & Kem' },
  { value: 'trang_xanh', label: 'Trắng tinh khôi & Xanh lá' },
  { value: 'vang_kem', label: 'Vàng Champagne & Kem ấm' },
  { value: 'tim_pastel', label: 'Tím Pastel & Trắng' },
]

export const STYLE_OPTIONS = [
  { value: 'truyen_thong', label: 'Truyền thống (Song Hỷ, Lư đồng)' },
  { value: 'hien_dai', label: 'Hiện đại Tối giản' },
  { value: 'vuon_hoa', label: 'Vườn hoa rực rỡ' },
]

export const FLOWER_OPTIONS = [
  { value: 'hong_lan', label: 'Hoa Hồng & Lan Hồ Điệp' },
  { value: 'sen', label: 'Hoa Sen truyền thống' },
  { value: 'cam_tu_cau', label: 'Cẩm tú cầu & Baby' },
  { value: 'lan_ho_diep', label: 'Lan Hồ Điệp rủ' },
]

const TONE_MAP = {
  do_truyen_thong: 'traditional crimson red and antique gold color palette, rich red silk draping',
  pastel_hong: 'soft blush pink and cream ivory color palette, airy pleated chiffon draping',
  trang_xanh: 'pure white and sage green botanical color palette, crisp ivory linen draping',
  vang_kem: 'champagne gold and warm cream color palette, satin silk draping',
  tim_pastel: 'romantic lavender pastel and cream white color palette, soft sheer voile draping',
}

const STYLE_MAP = {
  truyen_thong:
    'luxury traditional Vietnamese Gia Tien ancestral altar decor in a modern townhouse living room, gold Song Hy emblem, wooden ancestral table with brass candlesticks and fresh fruit trays',
  hien_dai:
    'modern minimalist Vietnamese Gia Tien ceremony setup, clean symmetrical floral arch, subtle gold geometric accents, refined contemporary wooden chairs',
  vuon_hoa:
    'lush organic floral Vietnamese Gia Tien decor, abundant cascading fresh flowers, soft romantic garden-inspired indoor atmosphere',
}

const FLOWER_MAP = {
  hong_lan: 'fresh roses and white phalaenopsis orchids',
  sen: 'fresh pink and white Vietnamese lotus flowers with green leaves',
  cam_tu_cau: 'hydrangea, baby breath, and garden roses',
  lan_ho_diep: 'cascading white and blush phalaenopsis orchids',
}

const COUPLE_POSE_MAP = {
  dung: 'a Vietnamese bride and groom in traditional white and gold ao dai standing gracefully in front of the Gia Tien backdrop, natural relaxed posture, hands gently clasped together, warm genuine smiles, realistic skin texture, natural anatomy, five fingers per hand',
  ngoi: 'a Vietnamese bride and groom in elegant ao dai seated naturally on ceremonial chairs beside the Gia Tien table, relaxed upright posture, hands resting neatly on lap, genuine warm expressions, realistic skin texture, natural anatomy, five fingers per hand',
}

function resolveChoice(val, options, map, fallbackKey) {
  const clean = String(val || '').trim()
  if (!clean) return map[fallbackKey]
  if (map[clean]) return map[clean]
  const byLabel = options.find((o) => o.label.toLowerCase() === clean.toLowerCase())
  if (byLabel && map[byLabel.value]) return map[byLabel.value]
  return clean
}

export function buildGiaTienPrompt({
  tone = 'Đỏ truyền thống & Vàng đồng',
  style = 'Truyền thống (Song Hỷ, Lư đồng)',
  flower = 'Hoa Hồng & Lan Hồ Điệp',
  hasCouple = false,
  couplePose = 'dung',
  isImg2Img = false,
  extra = '',
}) {
  const toneDesc = resolveChoice(tone, TONE_OPTIONS, TONE_MAP, 'do_truyen_thong')
  const styleDesc = resolveChoice(style, STYLE_OPTIONS, STYLE_MAP, 'truyen_thong')
  const flowerDesc = resolveChoice(flower, FLOWER_OPTIONS, FLOWER_MAP, 'hong_lan')

  const prefix = isImg2Img
    ? 'Realistic editorial wedding photography transforming the existing room into a '
    : 'Realistic editorial wedding photography of a '

  const parts = [
    `${prefix}${styleDesc}`,
    `featuring ${toneDesc}`,
    `adorned with ${flowerDesc}`,
  ]
  if (hasCouple) {
    parts.push(COUPLE_POSE_MAP[couplePose] || COUPLE_POSE_MAP.dung)
  }
  if (extra && extra.trim()) {
    parts.push(extra.trim())
  }
  parts.push(
    'warm natural daylight mixed with soft indoor lighting, shot on 35mm lens, f/2.8, natural fabric and flower textures, photorealistic, high detail'
  )
  return parts.join(', ')
}

const TXT2IMG_TEMPLATE = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'flux1-dev-fp8.safetensors', weight_dtype: 'fp8_e4m3fn' } },
  '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 'clip_l.safetensors', clip_name2: 't5xxl_fp8_e4m3fn.safetensors', type: 'flux', device: 'default' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '6': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: 2.8 } },
  '7': { class_type: 'EmptySD3LatentImage', inputs: { width: 1248, height: 832, batch_size: 1 } },
  '8': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['5', 0], latent_image: ['7', 0], seed: 42001, steps: 24, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  '10': { class_type: 'ImageScale', inputs: { image: ['9', 0], upscale_method: 'lanczos', width: 1200, height: 800, crop: 'disabled' } },
  '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'GiaTien_Web' } },
}

const IMG2IMG_TEMPLATE = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'flux1-dev-fp8.safetensors', weight_dtype: 'fp8_e4m3fn' } },
  '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 'clip_l.safetensors', clip_name2: 't5xxl_fp8_e4m3fn.safetensors', type: 'flux', device: 'default' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '5': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '6': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: 2.8 } },
  '12': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
  '14': { class_type: 'ImageScale', inputs: { image: ['12', 0], upscale_method: 'lanczos', width: 1248, height: 832, crop: 'center' } },
  '13': { class_type: 'VAEEncode', inputs: { pixels: ['14', 0], vae: ['3', 0] } },
  '8': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['5', 0], latent_image: ['13', 0], seed: 42001, steps: 24, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 0.65 } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  '10': { class_type: 'ImageScale', inputs: { image: ['9', 0], upscale_method: 'lanczos', width: 1200, height: 800, crop: 'disabled' } },
  '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'GiaTien_Img2Img_Web' } },
}

function normalizeUrl(url = 'http://127.0.0.1:8188') {
  return String(url || 'http://127.0.0.1:8188').trim().replace(/\/+$/, '')
}

function blobToCompressedDataUrl(blob, maxWidth = 1280, quality = 0.85) {
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

export async function runGiaTienComfyWorkflow({
  baseUrl = 'http://127.0.0.1:8188',
  ratio = '16:9',
  tone = 'do_truyen_thong',
  style = 'truyen_thong',
  flower = 'hong_lan',
  hasCouple = false,
  couplePose = 'dung',
  extra = '',
  referenceFile = null,
  denoise = 0.65,
}) {
  const cleanUrl = normalizeUrl(baseUrl)
  const isImg2Img = Boolean(referenceFile)
  const ratioSpec = RATIO_OPTIONS.find((r) => r.value === ratio) || RATIO_OPTIONS[0]

  // 1. Nếu có ảnh mặt bằng khách -> upload lên ComfyUI trước
  let uploadedName = ''
  if (referenceFile) {
    const fd = new FormData()
    fd.append('image', referenceFile)
    try {
      const upRes = await fetch(`${cleanUrl}/upload/image`, { method: 'POST', body: fd })
      if (!upRes.ok) throw new Error(`Upload ảnh mặt bằng lỗi HTTP ${upRes.status}`)
      const upData = await upRes.json()
      uploadedName = upData.name
    } catch (err) {
      const msg = String(err?.message || '')
      if (msg.includes('Failed to fetch')) {
        throw new Error(
          `Không kết nối được tới ComfyUI (${cleanUrl}). Anh kiểm tra ComfyUI đang mở với "--enable-cors-header *" nhé.`
        )
      }
      throw err
    }
  }

  // 2. Build Prompt theo prompt_builder.py
  const prompt = buildGiaTienPrompt({
    tone,
    style,
    flower,
    hasCouple,
    couplePose,
    isImg2Img,
    extra,
  })

  // 3. Nạp đúng template Text2Img hoặc Img2Img & điền node ID theo API_HANDOFF.md
  const workflow = JSON.parse(JSON.stringify(isImg2Img ? IMG2IMG_TEMPLATE : TXT2IMG_TEMPLATE))
  workflow['4'].inputs.text = prompt
  workflow['8'].inputs.seed = Math.floor(Math.random() * 1e12)
  workflow['10'].inputs.width = ratioSpec.webW
  workflow['10'].inputs.height = ratioSpec.webH

  if (isImg2Img) {
    workflow['12'].inputs.image = uploadedName
    workflow['14'].inputs.width = ratioSpec.renderW
    workflow['14'].inputs.height = ratioSpec.renderH
    workflow['8'].inputs.denoise = Number(denoise) || 0.65
  } else {
    workflow['7'].inputs.width = ratioSpec.renderW
    workflow['7'].inputs.height = ratioSpec.renderH
  }

  // 4. Gửi /prompt
  let promptId = ''
  try {
    const qRes = await fetch(`${cleanUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    })
    if (!qRes.ok) {
      const t = await qRes.text().catch(() => '')
      throw new Error(`ComfyUI báo lỗi HTTP ${qRes.status}: ${t.slice(0, 140)}`)
    }
    const qData = await qRes.json()
    promptId = qData.prompt_id
  } catch (err) {
    if (String(err?.message || '').includes('Failed to fetch')) {
      throw new Error(
        `Không kết nối được tới ComfyUI (${cleanUrl}). Anh nhớ chạy ComfyUI với cờ "--enable-cors-header *" nhé.`
      )
    }
    throw err
  }

  // 5. Poll /history/{prompt_id} mỗi 2 giây (tối đa 300s cho Flux.1 Dev, bắt lỗi execution_error ngay)
  let outputImg = null
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const hRes = await fetch(`${cleanUrl}/history/${promptId}`)
    if (!hRes.ok) continue
    const hData = await hRes.json()
    const item = hData?.[promptId]
    if (item?.status?.status_str === 'error') {
      const errMsgEntry = (item.status.messages || []).find((m) => m?.[0] === 'execution_error')
      const errInfo = errMsgEntry?.[1] || {}
      const nodeLabel = errInfo.node_type ? ` tại node ${errInfo.node_type}` : ''
      const rawMsg = String(errInfo.exception_message || 'ComfyUI gặp lỗi khi chạy workflow').trim()
      const hint = rawMsg.includes('HostBuffer.read_file_slice')
        ? ' (Gợi ý: thêm cờ --disable-dynamic-vram trong cấu hình khởi động ComfyUI hoặc giải phóng bớt RAM/VRAM).'
        : ''
      throw new Error(`ComfyUI báo lỗi${nodeLabel}: ${rawMsg}${hint}`)
    }
    if (item?.outputs?.['11']?.images?.length > 0) {
      outputImg = item.outputs['11'].images[0]
      break
    }
  }

  if (!outputImg) {
    throw new Error('ComfyUI render quá 300 giây chưa xong. Anh kiểm tra cửa sổ ComfyUI giúp em nhé.')
  }

  const qs = new URLSearchParams({
    filename: outputImg.filename,
    subfolder: outputImg.subfolder || '',
    type: outputImg.type || 'output',
  })
  const imgRes = await fetch(`${cleanUrl}/view?${qs.toString()}`)
  if (!imgRes.ok) throw new Error('Không tải được ảnh kết quả từ ComfyUI.')
  const blob = await imgRes.blob()
  const dataUrl = await blobToCompressedDataUrl(blob)
  return { dataUrl, prompt }
}
