// Nhập hàng bằng Excel: hàm thuần, không gọi Supabase.

const KIND_LABEL = { consumable: 'Tiêu hao', reusable: 'Tái sử dụng' }

export const TEMPLATE_HEADERS = [
  'Mã vật tư *',
  'Tên vật tư (chỉ để tham khảo)',
  'Số lượng *',
  'Đơn giá nhập (₫) *',
  'Ghi chú',
]

export function normalizeCode(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

function normalizeHeader(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseNumberVN(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (v == null) return NaN
  let s = String(v).replace(/[\s ₫đ]/gi, '')
  if (s === '') return NaN
  let sign = 1
  if (s.startsWith('-')) {
    sign = -1
    s = s.slice(1)
  }
  if (/^\d+$/.test(s)) return sign * Number(s)
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    const cleaned = s.split(thou).join('')
    if (cleaned.split(dec).length !== 2 || !/^\d+[.,]\d+$/.test(cleaned)) return NaN
    return sign * Number(cleaned.replace(dec, '.'))
  }
  if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return sign * Number(s.replace(/\./g, ''))
    if (/^\d+\.\d+$/.test(s)) return sign * Number(s)
    return NaN
  }
  if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) return sign * Number(s.replace(/,/g, ''))
    if (/^\d+,\d+$/.test(s)) return sign * Number(s.replace(',', '.'))
    return NaN
  }
  return NaN
}

function isBlank(v) {
  return v == null || String(v).trim() === ''
}

export function parsePurchaseRows(rows, items, { maxRows = 200 } = {}) {
  const empty = { ok: 0, warn: 0, error: 0, total: 0 }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { lines: [], summary: empty, fatal: 'File không có dòng dữ liệu nào.' }
  }

  const keys = []
  for (const r of rows) {
    for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k)
  }
  const find = (kw) => keys.find((k) => normalizeHeader(k).includes(kw))
  const colCode = find('ma vat tu')
  const colQty = find('so luong')
  const colCost = find('don gia')
  const colNote = find('ghi chu')

  const missing = []
  if (!colCode) missing.push('Mã vật tư')
  if (!colQty) missing.push('Số lượng')
  if (!colCost) missing.push('Đơn giá nhập')
  if (missing.length) {
    return {
      lines: [],
      summary: empty,
      fatal: `Thiếu cột bắt buộc: ${missing.join(', ')}. Hãy dùng đúng file mẫu.`,
    }
  }

  const dataRows = []
  rows.forEach((r, i) => {
    const blank = Object.values(r || {}).every(isBlank)
    if (!blank) dataRows.push({ r, rowNo: i + 2 })
  })
  if (dataRows.length === 0) {
    return { lines: [], summary: empty, fatal: 'File không có dòng dữ liệu nào.' }
  }
  if (dataRows.length > maxRows) {
    return {
      lines: [],
      summary: empty,
      fatal: `File có ${dataRows.length} dòng, vượt quá giới hạn ${maxRows} dòng.`,
    }
  }

  const byCode = new Map()
  for (const it of items || []) {
    if (it.active === false) continue
    const c = normalizeCode(it.code)
    if (c && !byCode.has(c)) byCode.set(c, it)
  }

  const seen = new Map()
  const lines = dataRows.map(({ r, rowNo }) => {
    const rawCode = r[colCode]
    const code = normalizeCode(rawCode)
    const messages = []
    let status = 'ok'
    const fail = (m) => {
      status = 'error'
      messages.push(m)
    }

    const item = code ? byCode.get(code) : null
    if (!code) fail('Thiếu mã vật tư')
    else if (!item) fail(`Không tìm thấy mã vật tư ${code} (hãy tạo ở trang Vật tư trước)`)

    if (code) {
      if (seen.has(code)) fail(`Mã ${code} trùng với dòng ${seen.get(code)}`)
      else seen.set(code, rowNo)
    }

    const qty = parseNumberVN(r[colQty])
    if (!(qty > 0)) fail('Số lượng phải là số lớn hơn 0')

    const unitCost = parseNumberVN(r[colCost])
    if (!(unitCost > 0)) fail('Đơn giá phải là số lớn hơn 0 (đơn giá này sẽ ghi đè giá vốn)')

    const lastCost = item ? Number(item.cost) || 0 : 0
    if (status !== 'error' && lastCost > 0) {
      const pct = ((unitCost - lastCost) / lastCost) * 100
      if (Math.abs(pct) > 30) {
        status = 'warn'
        messages.push(`Giá lệch ${pct > 0 ? '+' : ''}${Math.round(pct)}% so với giá nhập lần trước`)
      }
    }

    return {
      rowNo,
      item_id: item ? item.id : null,
      code: item ? item.code : code,
      name: item ? item.name : '',
      unit: item ? item.unit : '',
      kind: item ? item.kind : '',
      qty: Number.isNaN(qty) ? NaN : qty,
      unit_cost: Number.isNaN(unitCost) ? NaN : unitCost,
      lastCost,
      note: colNote && !isBlank(r[colNote]) ? String(r[colNote]).trim() : '',
      status,
      messages,
    }
  })

  const summary = { ok: 0, warn: 0, error: 0, total: lines.length }
  for (const l of lines) summary[l.status] += 1
  return { lines, summary }
}

export function buildTemplateWorkbookData(items) {
  const active = (items || [])
    .filter((it) => it.active !== false)
    .slice()
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))

  const nhapHang = [TEMPLATE_HEADERS]
  for (const it of active.slice(0, 3)) {
    nhapHang.push([it.code, it.name, 1, Number(it.cost) || 0, 'Ví dụ - xóa dòng này'])
  }

  const huongDan = [
    ['HƯỚNG DẪN'],
    ['1. Chỉ điền ở sheet "Nhập hàng". Mỗi dòng là một vật tư. Xóa các dòng ví dụ trước khi điền.'],
    ['2. Cột có dấu * là bắt buộc: Mã vật tư, Số lượng, Đơn giá nhập.'],
    ['3. Mã vật tư phải có trong sheet "Danh mục vật tư" (không phân biệt hoa thường). Mã mới chưa có thì tạo ở trang Vật tư trước.'],
    ['4. Số lượng phải lớn hơn 0. Đơn giá nhập phải lớn hơn 0, có thể gõ 500000 hoặc 500.000.'],
    ['5. Mỗi mã vật tư chỉ xuất hiện một lần trong file. Cột "Tên vật tư" chỉ để dễ nhìn, hệ thống không đọc.'],
    ['6. Tối đa 200 dòng. Ngày nhập, kho nhận chọn trên màn hình sau khi tải file lên.'],
    ['7. Tải file lên chỉ để xem trước và đổ vào form. Chỉ khi bấm "Lưu phiếu nhập mua" mới ghi vào kho.'],
  ]

  const danhMuc = [['Mã vật tư', 'Tên vật tư', 'Đơn vị', 'Loại (Tiêu hao/Tái sử dụng)', 'Giá nhập lần trước (₫)']]
  for (const it of active) {
    danhMuc.push([it.code, it.name, it.unit, KIND_LABEL[it.kind] || it.kind || '', Number(it.cost) || 0])
  }

  return { nhapHang, huongDan, danhMuc }
}
