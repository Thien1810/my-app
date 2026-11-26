// Dựng "ảnh thẻ mẫu set" để gửi khách: gộp ảnh đã chọn + tên + loại + mô tả thành MỘT file JPEG (rộng 1080px, < 1MB).
// Tuyệt đối không có số lượng vật tư, giá vốn hay giá: chỉ nhận tên, loại, mô tả và ảnh.
import { dataUrlToBlob } from './setTemplateImages'
import { SHARE_SIGNOFF, normalizeCategoryName } from './setTemplates'

export const CARD_WIDTH = 1080
export const CARD_PAD = 48
export const CARD_GAP = 12
export const MAX_CARD_IMAGES = 9
const MAX_BYTES = 900 * 1024

// ===== Phần thuần (có test) =====

// Ngắt dòng theo độ rộng đo bằng measure(chuỗi) -> px. Cắt "…" ở dòng cuối nếu quá maxLines.
export function wrapText(measure, text, maxWidth, maxLines = Infinity) {
  const lines = []
  let truncated = false
  const push = (line) => {
    if (lines.length >= maxLines) {
      truncated = true
      return false
    }
    lines.push(line)
    return true
  }
  const fitPrefix = (word) => {
    let n = word.length
    while (n > 1 && measure(word.slice(0, n)) > maxWidth) n -= 1
    return n
  }

  const paragraphs = String(text ?? '').replace(/\r/g, '').split('\n')
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      if (lines.length > 0 && lines.at(-1) !== '' && !push('')) break
      continue
    }
    let current = ''
    let stop = false
    for (let word of words) {
      while (measure(word) > maxWidth) {
        const n = fitPrefix(word)
        if (current) {
          if (!push(current)) {
            stop = true
            break
          }
          current = ''
        }
        if (!push(word.slice(0, n))) {
          stop = true
          break
        }
        word = word.slice(n)
      }
      if (stop) break
      if (!word) continue
      const next = current ? `${current} ${word}` : word
      if (measure(next) <= maxWidth) {
        current = next
      } else {
        if (!push(current)) {
          stop = true
          break
        }
        current = word
      }
    }
    if (stop) break
    if (current && !push(current)) break
  }

  while (lines.at(-1) === '') lines.pop()
  if (truncated && lines.length > 0) {
    let last = lines.at(-1)
    while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last.trimEnd()}…`
  }
  return lines
}

// Vùng cắt của ảnh nguồn để phủ kín khung đích (kiểu object-fit: cover), căn giữa.
export function coverCrop(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH
  const dstRatio = dstW / dstH
  if (srcRatio > dstRatio) {
    const sw = srcH * dstRatio
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH }
  }
  const sh = srcW / dstRatio
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh }
}

export function gridColumns(restCount) {
  return restCount <= 4 ? 2 : 3
}

// Bố cục ảnh: ảnh bìa 4:3 tràn ngang ở trên, các ảnh còn lại là lưới ô vuông 2-3 cột bên dưới.
export function layoutImages({ count, width = CARD_WIDTH, pad = CARD_PAD, gap = CARD_GAP }) {
  const total = Math.min(Math.max(0, count), MAX_CARD_IMAGES)
  if (total === 0) return { cover: null, cells: [], bottom: 0 }
  const cover = { x: 0, y: 0, w: width, h: Math.round((width * 3) / 4) }
  const rest = total - 1
  if (rest === 0) return { cover, cells: [], bottom: cover.h }

  const cols = gridColumns(rest)
  const size = Math.floor((width - 2 * pad - gap * (cols - 1)) / cols)
  const top = cover.h + gap * 2
  const cells = Array.from({ length: rest }, (_, i) => ({
    x: pad + (i % cols) * (size + gap),
    y: top + Math.floor(i / cols) * (size + gap),
    size,
  }))
  const rows = Math.ceil(rest / cols)
  return { cover, cells, bottom: top + rows * size + (rows - 1) * gap }
}

export const TEXT_STYLE = Object.freeze({
  pillHeight: 44,
  titleSize: 56,
  titleLine: 70,
  descSize: 34,
  descLine: 50,
  footerHeight: 130,
  contactSize: 32,
  contactLine: 48,
  maxTitleLines: 3,
  maxDescLines: 7,
})

// Bố cục khối chữ bên dưới ảnh. top = đáy khối ảnh (0 nếu không có ảnh).
export function layoutText({ top, titleLineCount, descLineCount, hasCategory = true, contactLineCount = 0 }) {
  const s = TEXT_STYLE
  let y = top + (top > 0 ? 56 : CARD_PAD)
  const pillY = hasCategory ? y : null
  if (hasCategory) y += s.pillHeight + 28
  const titleY = y
  y += titleLineCount * s.titleLine
  const descY = descLineCount > 0 ? y + 12 : y
  y = descY + descLineCount * s.descLine
  const footerY = y + 40
  // Chân thẻ cao thêm khi có nhiều dòng liên hệ (chừa 28px trên, 32px dưới)
  const footerHeight = Math.max(s.footerHeight, 60 + contactLineCount * s.contactLine)
  return { pillY, titleY, descY, footerY, height: footerY + footerHeight }
}

// Các dòng liên hệ in ở chân thẻ. Dòng nào trống thì bỏ.
export function buildContactLines(contact) {
  const phone = String(contact?.phone ?? '').trim()
  const address = String(contact?.address ?? '').replace(/\s+/g, ' ').trim()
  const website = String(contact?.website ?? '').trim()
  return [
    phone && { text: `SĐT / Zalo: ${phone}`, strong: true },
    address && { text: `Địa chỉ: ${address}` },
    website && { text: website },
  ].filter(Boolean)
}

// Lấy phần mô tả từ nội dung gửi khách: bỏ đoạn tên, đoạn "Hạng mục: ...", và câu kết.
export function extractCardDescription(text, { name, category } = {}) {
  const nameKey = normalizeCategoryName(name)
  const categoryLine = `Hạng mục: ${normalizeCategoryName(category)}`
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      const flat = normalizeCategoryName(part)
      return flat !== nameKey && flat !== categoryLine && flat !== SHARE_SIGNOFF && !flat.startsWith('Hạng mục:')
    })
    .join('\n\n')
}

// ===== Phần vẽ (cần trình duyệt) =====

async function loadDrawable(url) {
  let blob
  if (String(url).startsWith('data:')) {
    blob = dataUrlToBlob(url)
  } else {
    let response
    try {
      response = await fetch(url, { mode: 'cors' })
    } catch {
      const error = new Error('Không tải được ảnh (máy chủ ảnh chưa bật CORS hoặc mất mạng).')
      error.code = 'cors'
      throw error
    }
    if (!response.ok) throw new Error(`Ảnh trả về lỗi HTTP ${response.status}.`)
    blob = await response.blob()
  }
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // thử cách dùng thẻ img bên dưới
    }
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Không đọc được ảnh.'))
    }
    img.src = objectUrl
  })
}

const sizeOf = (drawable) => ({
  w: drawable.naturalWidth || drawable.width,
  h: drawable.naturalHeight || drawable.height,
})

function drawCover(ctx, drawable, x, y, w, h) {
  const { w: sw0, h: sh0 } = sizeOf(drawable)
  const { sx, sy, sw, sh } = coverCrop(sw0, sh0, w, h)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(drawable, sx, sy, sw, sh, x, y, w, h)
  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Trình duyệt không xuất được ảnh JPEG.'))),
      'image/jpeg',
      quality
    )
  })
}

const FONT = '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif'

/**
 * Dựng ảnh thẻ. Trả về { blob, width, height, used, skipped: [{ index, message }] }.
 * Ảnh nào lỗi thì bỏ qua và ghi vào skipped, không làm hỏng cả thẻ.
 */
export async function renderTemplateCard({ name, category, description, imageUrls, contact }) {
  const urls = (imageUrls || []).slice(0, MAX_CARD_IMAGES)
  const skipped = []
  const drawables = []
  const results = await Promise.allSettled(urls.map(loadDrawable))
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') drawables.push(result.value)
    else skipped.push({ index, message: result.reason?.message || 'Không tải được ảnh.', code: result.reason?.code })
  })

  let watermark = null
  try {
    watermark = await loadDrawable('/watermark-black.png')
  } catch {
    watermark = null
  }

  const measureCanvas = document.createElement('canvas')
  const mctx = measureCanvas.getContext('2d')
  const textWidth = CARD_WIDTH - 2 * CARD_PAD
  const s = TEXT_STYLE
  mctx.font = `700 ${s.titleSize}px ${FONT}`
  const titleLines = wrapText((t) => mctx.measureText(t).width, normalizeCategoryName(name) || 'Mẫu set', textWidth, s.maxTitleLines)
  mctx.font = `400 ${s.descSize}px ${FONT}`
  const descLines = wrapText((t) => mctx.measureText(t).width, description || '', textWidth, s.maxDescLines)
  const categoryText = normalizeCategoryName(category)

  // Chữ liên hệ nằm bên trái, chừa chỗ cho logo bên phải
  const logoHeight = 64
  const logoWidth = watermark ? Math.round((sizeOf(watermark).w / sizeOf(watermark).h) * logoHeight) : 320
  const contactWidth = textWidth - logoWidth - 32
  const contactLines = buildContactLines(contact).flatMap(({ text: line, strong }) => {
    mctx.font = `${strong ? 700 : 400} ${s.contactSize}px ${FONT}`
    return wrapText((t) => mctx.measureText(t).width, line, contactWidth, 3).map((part) => ({ text: part, strong }))
  })

  const images = layoutImages({ count: drawables.length })
  const text = layoutText({
    top: images.bottom,
    titleLineCount: titleLines.length,
    descLineCount: descLines.length,
    hasCategory: Boolean(categoryText),
    contactLineCount: contactLines.length,
  })

  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = text.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (images.cover) drawCover(ctx, drawables[0], images.cover.x, images.cover.y, images.cover.w, images.cover.h)
  images.cells.forEach((cell, i) => drawCover(ctx, drawables[i + 1], cell.x, cell.y, cell.size, cell.size))

  // Dải xanh lá mảnh trên cùng khi không có ảnh để thẻ vẫn có điểm nhấn thương hiệu
  if (!images.cover) {
    ctx.fillStyle = '#16a34a'
    ctx.fillRect(0, 0, CARD_WIDTH, 14)
  }

  ctx.textBaseline = 'top'
  if (categoryText && text.pillY !== null) {
    ctx.font = `600 28px ${FONT}`
    const pillW = Math.min(textWidth, Math.ceil(ctx.measureText(categoryText).width) + 48)
    ctx.fillStyle = '#dcfce7'
    roundRect(ctx, CARD_PAD, text.pillY, pillW, s.pillHeight, s.pillHeight / 2)
    ctx.fill()
    ctx.fillStyle = '#14532d'
    ctx.fillText(categoryText, CARD_PAD + 24, text.pillY + 7, pillW - 48)
  }

  ctx.fillStyle = '#14532d'
  ctx.font = `700 ${s.titleSize}px ${FONT}`
  titleLines.forEach((line, i) => ctx.fillText(line, CARD_PAD, text.titleY + i * s.titleLine))

  ctx.fillStyle = '#334155'
  ctx.font = `400 ${s.descSize}px ${FONT}`
  descLines.forEach((line, i) => ctx.fillText(line, CARD_PAD, text.descY + i * s.descLine))

  // Chân thẻ: đường kẻ mảnh, liên hệ bên trái, logo/watermark nhỏ bên phải
  ctx.fillStyle = '#d1fae5'
  ctx.fillRect(CARD_PAD, text.footerY, textWidth, 3)
  contactLines.forEach((line, i) => {
    ctx.fillStyle = line.strong ? '#14532d' : '#334155'
    ctx.font = `${line.strong ? 700 : 400} ${s.contactSize}px ${FONT}`
    ctx.fillText(line.text, CARD_PAD, text.footerY + 28 + i * s.contactLine)
  })
  if (watermark) {
    ctx.drawImage(watermark, CARD_WIDTH - CARD_PAD - logoWidth, text.footerY + 28, logoWidth, logoHeight)
  } else {
    ctx.fillStyle = '#16a34a'
    ctx.font = `700 30px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText('ĐẶNG WEDDING', CARD_WIDTH - CARD_PAD, text.footerY + 44)
    ctx.textAlign = 'left'
  }

  // Nén dần cho tới khi < 1MB (mục tiêu dưới 900KB)
  const steps = [
    { scale: 1, quality: 0.88 },
    { scale: 1, quality: 0.78 },
    { scale: 1, quality: 0.68 },
    { scale: 0.85, quality: 0.7 },
    { scale: 0.7, quality: 0.65 },
    { scale: 0.55, quality: 0.6 },
  ]
  let blob = null
  let width = canvas.width
  let height = canvas.height
  for (const step of steps) {
    let source = canvas
    if (step.scale < 1) {
      source = document.createElement('canvas')
      source.width = Math.round(canvas.width * step.scale)
      source.height = Math.round(canvas.height * step.scale)
      source.getContext('2d').drawImage(canvas, 0, 0, source.width, source.height)
    }
    blob = await canvasToJpeg(source, step.quality)
    width = source.width
    height = source.height
    if (blob.size <= MAX_BYTES) break
  }

  return { blob, width, height, used: drawables.length, skipped }
}
