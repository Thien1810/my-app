const PARTNER_KINDS = ['customer', 'supplier']

function trim(value) {
  return String(value ?? '').trim()
}

export function normalizePhone(phone) {
  return trim(phone)
    .replace(/[\s.-]/g, '')
    .replace(/^\+840?/, '0')
    .replace(/^84(\d{9})$/, '0$1')
}

function validPhoneKey(key) {
  return /^\d{9,11}$/.test(key)
}

export function phoneKey(phone) {
  const key = normalizePhone(phone)
  return validPhoneKey(key) ? key : ''
}

export function validatePartnerInput(input = {}) {
  const { kind } = input
  const name = trim(input.name)
  const phone = trim(input.phone)
  const normalizedPhone = normalizePhone(phone)
  const phoneKey = validPhoneKey(normalizedPhone) ? normalizedPhone : ''
  const errors = {}
  if (!name) errors.name = 'Nhập tên đối tác.'
  if (phone && !phoneKey) errors.phone = 'Số điện thoại cần có 9–11 chữ số.'
  if (!PARTNER_KINDS.includes(kind)) errors.kind = 'Chọn loại đối tác.'
  const ok = Object.keys(errors).length === 0
  const data = ok ? {
    kind,
    name,
    phone: phone || null,
    address: trim(input.address) || null,
    note: trim(input.note) || null,
  } : null
  return { ok, errors, data, phoneKey }
}

export function normalizePartnerName(name) {
  return trim(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function oneEditApart(a, b) {
  if (a.length > b.length) [a, b] = [b, a]
  if (b.length - a.length > 1) return false
  let index = 0
  while (index < a.length && a[index] === b[index]) index++
  return a.slice(index + Number(a.length === b.length)) === b.slice(index + 1)
}

export function findDuplicatePartners(input = {}, partners = [], { excludeId = input.id } = {}) {
  const key = normalizePhone(input.phone)
  const name = normalizePartnerName(input.name)
  const phones = []
  const names = []
  for (const partner of partners) {
    if (excludeId != null && String(partner.id) === String(excludeId)) continue
    const sameKind = partner.kind === input.kind
    if (validPhoneKey(key) && normalizePhone(partner.phone) === key) {
      phones.push({ partner, sameKind, match: 'phone' })
      continue
    }
    const candidateName = normalizePartnerName(partner.name)
    if (name && (name === candidateName || (
      sameKind && Math.min(name.length, candidateName.length) >= 5 && oneEditApart(name, candidateName)
    ))) {
      names.push({ partner, sameKind, match: 'name' })
    }
  }
  return [...phones, ...names]
}

export function formatPhoneDisplay(phone) {
  const key = phoneKey(phone)
  if (!key) return trim(phone) || '—'
  // 9/10/11 số: 3-3-3 / 4-3-3 / 4-3-4; không tự thêm chữ số bị thiếu.
  const first = key.length === 9 ? 3 : 4
  return [key.slice(0, first), key.slice(first, first + 3), key.slice(first + 3)].join(' ')
}

export function buildCallLink(phone) {
  const key = normalizePhone(phone)
  return validPhoneKey(key) ? `tel:${key}` : null
}

export function buildZaloLink(phone) {
  const key = normalizePhone(phone)
  return validPhoneKey(key) ? `https://zalo.me/${key}` : null
}

export function canExportPartners(role) {
  return role === 'admin' || role === 'manager'
}

export function canSeePartnerKind(role, kind) {
  if (!PARTNER_KINDS.includes(kind)) return false
  return canExportPartners(role) || role === 'storekeeper' || (role === 'staff' && kind === 'supplier')
}
