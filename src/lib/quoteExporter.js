// Xuất Phiếu Báo Giá Đặng Wedding ra file Ảnh PNG sắc nét (có Logo + Hình ảnh các Set trang trí)
// để gửi trực tiếp qua Zalo / Messenger cho khách hàng

import { formatCurrency, formatDate, formatNumber } from './formatters'

function loadImg(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke, strokeWidth = 1) {
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
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.lineWidth = strokeWidth
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}

export async function exportQuoteToPng({
  project,
  quoteLines = [],
  discount = 0,
  quoteNote = '',
}) {
  const W = 1200
  const rowH = 136
  const baseH = 520
  const H = Math.max(820, baseH + quoteLines.length * rowH)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#f4f7f5'
  ctx.fillRect(0, 0, W, H)

  // Card
  drawRoundedRect(ctx, 28, 28, W - 56, H - 56, 20, '#ffffff', '#cfe3d6', 2)

  // Header gradient
  const grad = ctx.createLinearGradient(28, 28, W - 28, 175)
  grad.addColorStop(0, '#113322')
  grad.addColorStop(1, '#166534')
  drawRoundedRect(ctx, 28, 28, W - 56, 150, 20, grad, null)
  ctx.fillStyle = grad
  ctx.fillRect(28, 140, W - 56, 38)

  // Logo
  drawRoundedRect(ctx, 56, 48, 108, 108, 16, '#ffffff', null)
  const logoImg = await loadImg('/logo.jpg')
  if (logoImg) {
    ctx.drawImage(logoImg, 62, 54, 96, 96)
  }

  // Title
  ctx.fillStyle = '#bbf7d0'
  ctx.font = 'bold 13px "Segoe UI", sans-serif'
  ctx.fillText('ĐẶNG WEDDING • DỊCH VỤ TRANG TRÍ CƯỚI & SỰ KIỆN', 184, 72)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px "Segoe UI", sans-serif'
  ctx.fillText('BẢNG BÁO GIÁ DỊCH VỤ TRANG TRÍ', 184, 110)

  ctx.fillStyle = '#dcfce7'
  ctx.font = '15px "Segoe UI", sans-serif'
  ctx.fillText(
    `Mã dự án: ${project?.code || `#${project?.id || ''}`}   •   Ngày lập: ${formatDate(
      new Date().toISOString().slice(0, 10)
    )}`,
    184,
    142
  )

  // Customer & Project Info Box
  drawRoundedRect(ctx, 56, 200, W - 112, 104, 14, '#f8fbf9', '#d5e6dc', 1.5)
  ctx.fillStyle = '#14532d'
  ctx.font = 'bold 15px "Segoe UI", sans-serif'
  ctx.fillText(`Sự kiện: ${project?.name || '—'}`, 76, 230)

  ctx.fillStyle = '#334155'
  ctx.font = '14px "Segoe UI", sans-serif'
  ctx.fillText(`Khách hàng: ${project?.customer?.name || 'Quý khách hàng'}${project?.customer?.phone ? ` (${project.customer.phone})` : ''}`, 76, 258)
  ctx.fillText(`Địa điểm: ${project?.location || '—'}`, 76, 284)

  ctx.fillText(
    `Ngày thi công: ${formatDate(project?.start_date)}   →   Ngày tháo dỡ: ${formatDate(
      project?.end_date
    )}`,
    620,
    258
  )

  // Table Header
  const tableY = 326
  drawRoundedRect(ctx, 56, tableY, W - 112, 42, 8, '#e6f4ec', '#cfe3d6', 1)
  ctx.fillStyle = '#14532d'
  ctx.font = 'bold 14px "Segoe UI", sans-serif'
  ctx.fillText('STT', 72, tableY + 26)
  ctx.fillText('Hình mẫu', 120, tableY + 26)
  ctx.fillText('Hạng mục / Mẫu Set Trang Trí', 250, tableY + 26)
  ctx.fillText('Phân loại', 670, tableY + 26)
  ctx.fillText('SL', 810, tableY + 26)
  ctx.fillText('Đơn giá', 885, tableY + 26)
  ctx.fillText('Thành tiền', 1030, tableY + 26)

  // Preload line images
  const lineImgs = await Promise.all(quoteLines.map((l) => loadImg(l.image_url)))

  let curY = tableY + 48
  let subTotal = 0

  for (let i = 0; i < quoteLines.length; i++) {
    const line = quoteLines[i]
    const qty = Number(line.qty || 1)
    const price = Number(line.price || 0)
    const lineTotal = qty * price
    subTotal += lineTotal

    const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fcfb'
    drawRoundedRect(ctx, 56, curY, W - 112, rowH - 8, 10, rowBg, '#e2efe7', 1)

    // STT
    ctx.fillStyle = '#475569'
    ctx.font = 'bold 15px "Segoe UI", sans-serif'
    ctx.fillText(String(i + 1), 76, curY + 68)

    // Image thumbnail (104x104)
    drawRoundedRect(ctx, 118, curY + 12, 104, 104, 10, '#f1f5f9', '#cbd5e1', 1)
    if (lineImgs[i]) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(119, curY + 13, 102, 102)
      ctx.clip()
      ctx.drawImage(lineImgs[i], 119, curY + 13, 102, 102)
      ctx.restore()
    } else {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '13px "Segoe UI", sans-serif'
      ctx.fillText('Chưa có ảnh', 132, curY + 68)
    }

    // Name & Note
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 16px "Segoe UI", sans-serif'
    ctx.fillText(String(line.name || '').slice(0, 46), 250, curY + 46)

    if (line.note) {
      ctx.fillStyle = '#64748b'
      ctx.font = '13px "Segoe UI", sans-serif'
      ctx.fillText(String(line.note).slice(0, 62), 250, curY + 74)
    }

    // Category badge
    const catText = line.category || 'Gia tiên'
    const isMamQua = catText === 'Mâm quả'
    drawRoundedRect(
      ctx,
      668,
      curY + 46,
      115,
      28,
      14,
      isMamQua ? '#dbeafe' : '#dcfce7',
      null
    )
    ctx.fillStyle = isMamQua ? '#1e40af' : '#166534'
    ctx.font = 'bold 13px "Segoe UI", sans-serif'
    ctx.fillText(catText, 684, curY + 65)

    // Qty, Price, Total
    ctx.fillStyle = '#1e293b'
    ctx.font = 'bold 15px "Segoe UI", sans-serif'
    ctx.fillText(formatNumber(qty), 812, curY + 65)

    ctx.font = '14px "Segoe UI", sans-serif'
    ctx.fillText(formatCurrency(price), 875, curY + 65)

    ctx.fillStyle = '#15803d'
    ctx.font = 'bold 15px "Segoe UI", sans-serif'
    ctx.fillText(formatCurrency(lineTotal), 1020, curY + 65)

    curY += rowH
  }

  // Totals Footer
  const finalTotal = Math.max(0, subTotal - Number(discount || 0))
  drawRoundedRect(ctx, 56, curY + 6, W - 112, 108, 14, '#f0fdf4', '#86efac', 1.5)

  if (quoteNote) {
    ctx.fillStyle = '#334155'
    ctx.font = '13.5px "Segoe UI", sans-serif'
    ctx.fillText(`Ghi chú báo giá: ${String(quoteNote).slice(0, 75)}`, 76, curY + 42)
  } else {
    ctx.fillStyle = '#166534'
    ctx.font = '13.5px "Segoe UI", sans-serif'
    ctx.fillText('Cảm ơn Quý khách đã tin tưởng lựa chọn dịch vụ trang trí của Đặng Wedding!', 76, curY + 42)
  }

  ctx.fillStyle = '#475569'
  ctx.font = '14px "Segoe UI", sans-serif'
  ctx.fillText(`Tạm tính: ${formatCurrency(subTotal)}`, 780, curY + 36)
  if (Number(discount || 0) > 0) {
    ctx.fillStyle = '#dc2626'
    ctx.fillText(`Ưu đãi / Giảm giá: -${formatCurrency(discount)}`, 780, curY + 60)
  }

  ctx.fillStyle = '#14532d'
  ctx.font = 'bold 20px "Segoe UI", sans-serif'
  ctx.fillText(`TỔNG CỘNG: ${formatCurrency(finalTotal)}`, 780, curY + 92)

  // Download PNG
  const dataUrl = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `bao-gia-dang-wedding-${project?.code || project?.id || 'du-an'}.png`
  a.click()
}
