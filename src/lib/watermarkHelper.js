// Bộ xử lý đóng dấu Watermark chính thức của Đặng Wedding (Trắng / Đen),
// tính nhắc nhở dự án quá 5 ngày chưa đăng Facebook,
// và tự động soạn Caption Facebook chuẩn ngành cưới.

import { todayISO } from './formatters'

const FB_STORAGE_PREFIX = 'dw_fb_post_project_'

export const WATERMARK_COLORS = [
  { value: 'white', label: '⚪ Watermark Trắng (hợp nền tối / rực rỡ)', src: '/watermark-white.png' },
  { value: 'black', label: '⚫ Watermark Đen (hợp nền sáng / trắng kem)', src: '/watermark-black.png' },
]

export const WATERMARK_POSITIONS = [
  { value: 'bottom-right', label: '↘ Góc dưới bên phải (Khuyên dùng)' },
  { value: 'bottom-left', label: '↙ Góc dưới bên trái' },
  { value: 'bottom-center', label: '⬇ Chính giữa chân ảnh' },
  { value: 'top-right', label: '↗ Góc trên bên phải' },
  { value: 'top-left', label: '↖ Góc trên bên trái' },
]

export const WATERMARK_SIZES = [
  { value: 0.22, label: 'Nhỏ gọn (22%)' },
  { value: 0.28, label: 'Vừa chuẩn (28%)' },
  { value: 0.36, label: 'Lớn nổi bật (36%)' },
]

export const FB_POST_STATUS = {
  unposted: 'Chưa đăng bài',
  draft: 'Đã soạn & gắn logo (Chờ đăng)',
  posted: 'Đã đăng Fanpage',
}

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

  return {
    status: localData?.status || noteMeta?.status || 'unposted',
    fbUrl: localData?.fbUrl || noteMeta?.fbUrl || '',
    caption: localData?.caption || noteMeta?.caption || '',
    postedAt: localData?.postedAt || noteMeta?.postedAt || '',
    watermarkColor: localData?.watermarkColor || 'white',
    watermarkPos: localData?.watermarkPos || 'bottom-right',
    watermarkScale: localData?.watermarkScale ?? 0.28,
    watermarkOpacity: localData?.watermarkOpacity ?? 0.92,
    images: Array.isArray(localData?.images) ? localData.images : [],
  }
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
  const location = project?.location || 'Đồng Nai - TP.HCM'
  const setsText =
    setNames.length > 0
      ? setNames.join(' & ')
      : 'Gói Trang Trí Gia Tiên & Mâm Quả Đặng Wedding'

  const contactFooter = `---
🌿 ĐẶNG WEDDING — Dịch Vụ Trang Trí Gia Tiên & Mâm Quả
📍 Khu vực: Đồng Nai - TP.HCM
📞 SĐT / Zalo: 0918.80.90.96
#DangWedding #TrangTriGiaTien #TrangTriDamCuoi #MamQuaCuoi #DecorGiaTien #CuoiHoiDongNai #CuoiHoiTPHCM`

  if (style === 'warm') {
    return `💞 KHOẢNH KHẮC HẠNH PHÚC TRỌN VẸN — ${name.toUpperCase()} 💞

Mỗi đám cưới là một câu chuyện tình yêu riêng biệt, và Đặng Wedding thật vinh hạnh khi được đồng hành cùng ${customer} kiến tạo nên không gian lễ gia tiên ấm cúng, chỉn chu trong từng chi tiết nhỏ nhất.

✨ Phương án thực hiện: ${setsText}
📍 Địa điểm: ${location}

Cảm ơn gia đình hai họ đã tin tưởng trao gửi ngày trọng đại cho đội ngũ Đặng Wedding! Chúc hai bạn trăm năm hạnh phúc, viên mãn vẹn tròn. 🥂

📩 Inbox hoặc liên hệ Zalo 0918.80.90.96 để nhận tư vấn & báo giá các mẫu Gia tiên - Mâm quả mới nhất nhé!
${contactFooter}`
  }

  if (style === 'short') {
    return `✨ HOÀN THIỆN KHÔNG GIAN CƯỚI: ${name.toUpperCase()} ✨

🏮 Hạng mục: ${setsText}
💑 Khách hàng: ${customer}
📍 Địa điểm: ${location}

Không gian trang trí chỉn chu, sắc nét đến từng cành hoa và ánh đèn được đội ngũ Đặng Wedding chăm chút tỉ mỉ trước giờ lành.

👉 Dâu - Rể đang tìm mẫu Gia tiên & Mâm quả đẹp, đúng gu và tối ưu ngân sách? Liên hệ ngay Đặng Wedding (0918.80.90.96) để giữ lịch thi công nhé!
${contactFooter}`
  }

  return `🌿 ĐẶNG WEDDING x ${name.toUpperCase()} 🌿
Sự giao thoa giữa nét truyền thống trang trọng và phong cách thẩm mỹ tinh tế!

Trong ngày vui của ${customer}, đội ngũ Đặng Wedding đã mang đến gói trang trí "${setsText}" với bố cục hài hòa, tôn lên vẻ đẹp sang trọng cho không gian đón khách tại ${location}.

✔️ Thiết kế & thi công đồng bộ theo tông màu yêu cầu
✔️ Vật tư hoa, phông rèm, ánh sáng & mâm quả được tuyển chọn kỹ lưỡng
✔️ Đội ngũ lắp đặt đúng giờ, tận tâm tại Đồng Nai & TP.HCM

💌 Mùa cưới đang vào cao điểm, Dâu - Rể hãy liên hệ sớm với Đặng Wedding qua SĐT/Zalo 0918.80.90.96 để được tư vấn mẫu phù hợp và giữ lịch ngày đẹp nhé!
${contactFooter}`
}

function loadImageSource(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Không thể tải hình ảnh để đóng dấu Watermark'))
    img.src = src
  })
}

// Tạo bản ảnh gốc đã thu nhỏ nhẹ (< 1MB, max 1280px) để có thể đổi màu Trắng/Đen hoặc vị trí tức thì
export async function prepareBasePhotoDataUrl(fileOrDataUrl) {
  let srcUrl = fileOrDataUrl
  let revokeNeeded = false
  if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
    srcUrl = URL.createObjectURL(fileOrDataUrl)
    revokeNeeded = true
  }
  try {
    const photo = await loadImageSource(srcUrl)
    const origW = photo.naturalWidth || photo.width || 1200
    const origH = photo.naturalHeight || photo.height || 900
    const maxDim = 1280
    const scale = Math.min(1, maxDim / Math.max(origW, origH))
    const W = Math.max(1, Math.round(origW * scale))
    const H = Math.max(1, Math.round(origH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.drawImage(photo, 0, 0, W, H)
    return {
      baseDataUrl: canvas.toDataURL('image/jpeg', 0.86),
      width: W,
      height: H,
    }
  } finally {
    if (revokeNeeded) URL.revokeObjectURL(srcUrl)
  }
}

// Đóng dấu trực tiếp ảnh Watermark PNG (Trắng hoặc Đen) của Đặng Wedding lên ảnh
export async function applyDangWeddingWatermark(
  baseFileOrDataUrl,
  {
    color = 'white',
    position = 'bottom-right',
    scaleRatio = 0.28,
    opacity = 0.92,
  } = {}
) {
  let srcUrl = baseFileOrDataUrl
  let revokeNeeded = false
  if (baseFileOrDataUrl instanceof File || baseFileOrDataUrl instanceof Blob) {
    srcUrl = URL.createObjectURL(baseFileOrDataUrl)
    revokeNeeded = true
  }

  const wmSrc = color === 'black' ? '/watermark-black.png' : '/watermark-white.png'

  try {
    const [photo, wmImg] = await Promise.all([
      loadImageSource(srcUrl),
      loadImageSource(wmSrc),
    ])

    const origW = photo.naturalWidth || photo.width || 1200
    const origH = photo.naturalHeight || photo.height || 900
    const maxDim = 1280
    const resizeRatio = Math.min(1, maxDim / Math.max(origW, origH))
    const W = Math.max(1, Math.round(origW * resizeRatio))
    const H = Math.max(1, Math.round(origH * resizeRatio))

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    // 1. Vẽ ảnh tiệc cưới
    ctx.drawImage(photo, 0, 0, W, H)

    // 2. Tính kích thước ảnh Watermark giữ nguyên tỉ lệ gốc (1024x809)
    const wmOrigW = wmImg.naturalWidth || wmImg.width || 1024
    const wmOrigH = wmImg.naturalHeight || wmImg.height || 809
    const wmAspect = wmOrigH / wmOrigW

    const refSide = Math.min(W, H)
    const ratio = Number(scaleRatio) > 0 ? Number(scaleRatio) : 0.28
    const targetWmW = Math.round(refSide * ratio)
    const targetWmH = Math.round(targetWmW * wmAspect)
    const pad = Math.round(refSide * 0.032)

    let x = W - targetWmW - pad
    let y = H - targetWmH - pad

    if (position === 'bottom-left') {
      x = pad
      y = H - targetWmH - pad
    } else if (position === 'bottom-center') {
      x = Math.round((W - targetWmW) / 2)
      y = H - targetWmH - pad
    } else if (position === 'top-right') {
      x = W - targetWmW - pad
      y = pad
    } else if (position === 'top-left') {
      x = pad
      y = pad
    }

    ctx.save()
    ctx.globalAlpha = Math.max(0.25, Math.min(1, Number(opacity || 0.92)))

    // Tạo bóng đổ nhẹ giúp watermark nổi bật rõ nét trên mọi chi tiết hoa/lá
    ctx.shadowColor =
      color === 'black' ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 2

    ctx.drawImage(wmImg, x, y, targetWmW, targetWmH)
    ctx.restore()

    const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
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
