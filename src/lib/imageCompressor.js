// Tự động thu nhỏ và nén mọi ảnh tải lên về dưới 1MB (thường chỉ ~60KB - 180KB)
// Nhận mọi kích thước ảnh gốc (kể cả ảnh chụp điện thoại 10MB - 25MB)

const MAX_BYTES = 900 * 1024 // < 1MB (900 KB trần an toàn)

export function formatBytes(bytes = 0) {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function estimateDataUrlBytes(dataUrl = '') {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 0
  const base64 = dataUrl.split(',')[1] || ''
  return Math.round((base64.length * 3) / 4)
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không thể đọc file ảnh này. Vui lòng chọn file ảnh hợp lệ (JPG, PNG, WEBP...).'))
    }
    img.src = url
  })
}

export async function compressImageUnder1MB(file) {
  if (!file) throw new Error('Chưa chọn file ảnh')
  if (!file.type.startsWith('image/')) {
    throw new Error('Vui lòng chọn đúng định dạng file hình ảnh (JPG, PNG, WEBP, HEIC...).')
  }

  const originalSize = file.size || 0
  const img = await loadImageFromFile(file)

  const srcW = img.naturalWidth || img.width || 800
  const srcH = img.naturalHeight || img.height || 800

  // Thử lần lượt các mức kích thước và chất lượng để ảnh vừa sắc nét vừa gọn nhẹ (< 1MB, mục tiêu ~120KB)
  const steps = [
    { maxDim: 900, quality: 0.82 },
    { maxDim: 800, quality: 0.76 },
    { maxDim: 700, quality: 0.70 },
    { maxDim: 600, quality: 0.62 },
    { maxDim: 480, quality: 0.55 },
  ]

  let bestDataUrl = ''
  let finalBytes = 0
  let finalW = srcW
  let finalH = srcH

  for (const step of steps) {
    const ratio = Math.min(1, step.maxDim / Math.max(srcW, srcH))
    const targetW = Math.max(1, Math.round(srcW * ratio))
    const targetH = Math.max(1, Math.round(srcH * ratio))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')

    // Nền trắng cho ảnh PNG trong suốt khi xuất JPEG
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(img, 0, 0, targetW, targetH)

    // Ưu tiên WebP vì nhẹ hơn 30%, fallback sang JPEG
    let dataUrl = canvas.toDataURL('image/webp', step.quality)
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', step.quality)
    }

    const bytes = estimateDataUrlBytes(dataUrl)
    bestDataUrl = dataUrl
    finalBytes = bytes
    finalW = targetW
    finalH = targetH

    // Dừng ngay khi ảnh đã gọn dưới ~220KB (vẫn rất nét và cực nhẹ cho database)
    if (bytes <= 220 * 1024 && bytes <= MAX_BYTES) {
      break
    }
  }

  return {
    dataUrl: bestDataUrl,
    originalSize,
    compressedSize: finalBytes,
    width: finalW,
    height: finalH,
  }
}
