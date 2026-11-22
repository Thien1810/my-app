// Bộ xử lý đóng dấu Watermark Logo Đặng Wedding vào ảnh dự án,
// tính nhắc nhở dự án quá 5 ngày chưa đăng Facebook,
// và tự động soạn Caption Facebook chuẩn ngành cưới.

import { todayISO } from './formatters'

const FB_STORAGE_PREFIX = 'dw_fb_post_project_'

export const WATERMARK_POSITIONS = [
  { value: 'bottom-right', label: '↘ Góc dưới bên phải (Khuyên dùng)' },
  { value: 'bottom-left', label: '↙ Góc dưới bên trái' },
  { value: 'top-right', label: '↗ Góc trên bên phải' },
  { value: 'bottom-center', label: '⬇ Chính giữa chân ảnh' },
]

export const FB_POST_STATUS = {
  unposted: 'Chưa đăng bài',
  draft: 'Đã soạn & gắn logo (Chờ đăng)',
  posted: 'Đã đăng Fanpage',
}

// Đọc dữ liệu bài đăng Facebook của 1 dự án (từ project.note hoặc localStorage)
const FB_META_TAG = '__FBMETA__'

export function getProjectFbData(project) {
  const pid = project?.id
  let localData = null
  if (pid) {
    try {
      const raw = localStorage.getItem(`${FB_STORAGE_PREFIX}${pid}`)
      if (raw) localData = JSON.parse(raw)
    } catch {
      // ignore
    }
  }

  let noteMeta = null
  const noteStr = String(project?.note || '')
  if (noteStr.includes(FB_META_TAG)) {
    const sIdx = noteStr.indexOf(FB_META_TAG)
    const eIdx = noteStr.indexOf('__ENDFBMETA__')
    if (sIdx !== -1 && eIdx !== -1) {
      try {
        noteMeta = JSON.parse(noteStr.slice(sIdx + FB_META_TAG.length, eIdx))
      } catch {
        // ignore
      }
    }
  }

  const merged = {
    status: localData?.status || noteMeta?.status || 'unposted', // 'unposted' | 'draft' | 'posted'
    fbUrl: localData?.fbUrl || noteMeta?.fbUrl || '',
    caption: localData?.caption || noteMeta?.caption || '',
    postedAt: localData?.postedAt || noteMeta?.postedAt || '',
    watermarkPos: localData?.watermarkPos || 'bottom-right',
    watermarkOpacity: localData?.watermarkOpacity ?? 0.9,
    images: Array.isArray(localData?.images) ? localData.images : [],
  }
  return merged
}

export function saveProjectFbData(projectId, data) {
  if (!projectId) return
  try {
    localStorage.setItem(`${FB_STORAGE_PREFIX}${projectId}`, JSON.stringify(data))
  } catch {
    // ignore storage quota errors
  }
}

export function stripFbMetaFromNote(note = '') {
  const str = String(note || '')
  const sIdx = str.indexOf(FB_META_TAG)
  const eIdx = str.indexOf('__ENDFBMETA__')
  if (sIdx !== -1 && eIdx !== -1) {
    return (str.slice(0, sIdx) + str.slice(eIdx + '__ENDFBMETA__'.length)).trim()
  }
  return str
}

export function attachFbMetaToNote(cleanNote = '', fbSummary = {}) {
  const clean = stripFbMetaFromNote(cleanNote)
  const metaJson = JSON.stringify({
    status: fbSummary.status || 'unposted',
    fbUrl: fbSummary.fbUrl || '',
    postedAt: fbSummary.postedAt || '',
  })
  return `${clean}${clean ? ' ' : ''}${FB_META_TAG}${metaJson}__ENDFBMETA__`
}

// Kiểm tra dự án đã quá 5 ngày mà chưa đăng bài Facebook hay chưa
export function calcProjectFbReminder(project) {
  if (!project || project.status === 'cancelled') {
    return { isOverdue5Days: false, daysPassed: 0, fbData: getProjectFbData(project) }
  }
  const fbData = getProjectFbData(project)
  if (fbData.status === 'posted') {
    return { isOverdue5Days: false, daysPassed: 0, fbData }
  }

  // Mốc tính 5 ngày: ưu tiên ngày thi công (start_date), nếu chưa có thì tính từ ngày tạo dự án (created_at)
  const refDateStr =
    project.start_date ||
    project.end_date ||
    (project.created_at ? String(project.created_at).slice(0, 10) : todayISO())

  const refDate = new Date(refDateStr)
  const now = new Date(todayISO())
  const diffMs = now.getTime() - refDate.getTime()
  const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  return {
    isOverdue5Days: daysPassed > 5,
    daysPassed,
    refDateStr,
    fbData,
  }
}

// Tự động tạo 3 mẫu Caption Facebook hấp dẫn từ thông tin dự án
export function generateFacebookCaption(project, style = 'luxury', setNames = []) {
  const name = project?.name || 'Lễ Gia Tiên & Tiệc Cưới'
  const customer = project?.customer?.name || 'Cô dâu & Chú rể'
  const location = project?.location || 'Tư gia'
  const setsText =
    setNames.length > 0
      ? setNames.join(' & ')
      : 'Gói Trang Trí Gia Tiên & Mâm Quả Đặng Wedding'

  const hashtags =
    '#DangWedding #TrangTriGiaTien #TrangTriDamCuoi #MamQuaCuoi #DecorGiaTien #WeddingDecor'

  if (style === 'warm') {
    return `💞 KHOẢNH KHẮC HẠNH PHÚC TRỌN VẸN — ${name.toUpperCase()} 💞

Mỗi đám cưới là một câu chuyện tình yêu riêng biệt, và Đặng Wedding thật vinh hạnh khi được đồng hành cùng ${customer} kiến tạo nên không gian lễ gia tiên ấm cúng, chỉn chu trong từng chi tiết nhỏ nhất.

✨ Phương án thực hiện: ${setsText}
📍 Địa điểm: ${location}

Cảm ơn gia đình hai họ đã tin tưởng trao gửi ngày trọng đại cho đội ngũ Đặng Wedding! Chúc hai bạn trăm năm hạnh phúc, viên mãn vẹn tròn. 🥂

📩 Inbox ngay cho Đặng Wedding để nhận tư vấn & báo giá các mẫu Gia tiên - Mâm quả mới nhất mùa cưới năm nay nhé!
---
🌿 ĐẶNG WEDDING — Dịch Vụ Trang Trí Cưới & Sự Kiện
${hashtags}`
  }

  if (style === 'short') {
    return `✨ HOÀN THIỆN KHÔNG GIAN CƯỚI: ${name.toUpperCase()} ✨

🏮 Hạng mục: ${setsText}
💑 Khách hàng: ${customer}
📍 Địa điểm: ${location}

Không gian trang trí chỉn chu, sắc nét đến từng cành hoa và ánh đèn được đội ngũ Đặng Wedding chăm chút tỉ mỉ trước giờ lành.

👉 Dâu - Rể đang tìm mẫu Gia tiên & Mâm quả đẹp, đúng gu và tối ưu ngân sách? Nhắn tin ngay cho Đặng Wedding để giữ lịch thi công nhé!
---
🌿 ĐẶNG WEDDING — Trang Trí Gia Tiên & Mâm Quả Trọn Gói
${hashtags}`
  }

  // Mặc định: Sang trọng (luxury)
  return `🌿 ĐẶNG WEDDING x ${name.toUpperCase()} 🌿
Sự giao thoa giữa nét truyền thống trang trọng và phong cách thẩm mỹ tinh tế!

Trong ngày vui của ${customer}, đội ngũ Đặng Wedding đã mang đến gói trang trí "${setsText}" với bố cục hài hòa, tôn lên vẻ đẹp sang trọng cho không gian đón khách tại ${location}.

✔️ Thiết kế & thi công đồng bộ theo tông màu yêu cầu
✔️ Vật tư hoa, phông rèm, ánh sáng & mâm quả được tuyển chọn kỹ lưỡng
✔️ Đội ngũ lắp đặt đúng giờ, tận tâm và chuyên nghiệp

💌 Mùa cưới đang vào cao điểm, Dâu - Rể hãy liên hệ sớm với Đặng Wedding để được tư vấn mẫu phù hợp và giữ lịch ngày đẹp nhé!
---
🌿 ĐẶNG WEDDING — Chuyên Gia Trang Trí Gia Tiên & Mâm Quả
${hashtags}`
}

// Hàm tải ảnh từ File hoặc URL
function loadImageSource(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Không thể tải hình ảnh để đóng dấu Watermark'))
    img.src = src
  })
}

function drawRoundedBox(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// Ghép Watermark Logo Đặng Wedding vào ảnh & tự động thu nhỏ dưới 1MB
export async function applyDangWeddingWatermark(
  fileOrDataUrl,
  { position = 'bottom-right', opacity = 0.9, projectText = '' } = {}
) {
  let srcUrl = fileOrDataUrl
  let revokeNeeded = false
  if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
    srcUrl = URL.createObjectURL(fileOrDataUrl)
    revokeNeeded = true
  }

  try {
    const [photo, logo] = await Promise.all([
      loadImageSource(srcUrl),
      loadImageSource('/logo.jpg').catch(() => null),
    ])

    const origW = photo.naturalWidth || photo.width || 1200
    const origH = photo.naturalHeight || photo.height || 900

    // Chuẩn kích thước đăng Facebook sắc nét (tối đa cạnh dài 1280px) mà dung lượng vẫn < 350KB
    const maxDim = 1280
    const scale = Math.min(1, maxDim / Math.max(origW, origH))
    const W = Math.max(1, Math.round(origW * scale))
    const H = Math.max(1, Math.round(origH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    // 1. Vẽ ảnh gốc
    ctx.drawImage(photo, 0, 0, W, H)

    // 2. Tính kích thước khung Watermark theo tỉ lệ ảnh
    const baseUnit = Math.max(480, Math.min(W, H))
    const logoSize = Math.round(baseUnit * 0.115) // ~75px - 110px
    const pad = Math.round(baseUnit * 0.028)
    const badgeW = Math.round(logoSize + baseUnit * 0.25)
    const badgeH = Math.round(logoSize + 16)

    let bx = W - badgeW - pad
    let by = H - badgeH - pad

    if (position === 'bottom-left') {
      bx = pad
      by = H - badgeH - pad
    } else if (position === 'top-right') {
      bx = W - badgeW - pad
      by = pad
    } else if (position === 'bottom-center') {
      bx = Math.round((W - badgeW) / 2)
      by = H - badgeH - pad
    }

    ctx.save()
    ctx.globalAlpha = Math.max(0.3, Math.min(1, Number(opacity || 0.9)))

    // Nền mờ sang trọng cho khung Watermark
    drawRoundedBox(ctx, bx, by, badgeW, badgeH, 14)
    ctx.fillStyle = 'rgba(17, 51, 34, 0.78)'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
    ctx.stroke()

    // Khung trắng bo góc chứa Logo Đặng Wedding
    const lx = bx + 8
    const ly = by + 8
    drawRoundedBox(ctx, lx, ly, logoSize, logoSize, 10)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    if (logo) {
      ctx.save()
      drawRoundedBox(ctx, lx + 2, ly + 2, logoSize - 4, logoSize - 4, 8)
      ctx.clip()
      ctx.drawImage(logo, lx + 2, ly + 2, logoSize - 4, logoSize - 4)
      ctx.restore()
    }

    // Chữ thương hiệu bên cạnh Logo
    const tx = lx + logoSize + 12
    const titleFontPx = Math.max(13, Math.round(logoSize * 0.27))
    const subFontPx = Math.max(10, Math.round(logoSize * 0.18))

    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${titleFontPx}px "Segoe UI", sans-serif`
    ctx.fillText('ĐẶNG WEDDING', tx, ly + Math.round(logoSize * 0.44))

    ctx.fillStyle = '#bbf7d0'
    ctx.font = `600 ${subFontPx}px "Segoe UI", sans-serif`
    ctx.fillText(
      projectText ? String(projectText).slice(0, 22) : 'Trang Trí Gia Tiên & Mâm Quả',
      tx,
      ly + Math.round(logoSize * 0.74)
    )

    ctx.restore()

    // Xuất ảnh JPEG chất lượng 0.85 (luôn gọn nhẹ ~150KB - 350KB, < 1MB)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return {
      dataUrl,
      width: W,
      height: H,
    }
  } finally {
    if (revokeNeeded) {
      URL.revokeObjectURL(srcUrl)
    }
  }
}

export function downloadDataUrlImage(dataUrl, filename = 'dang-wedding-fb.jpg') {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
