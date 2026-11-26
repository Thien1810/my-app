import { supabase } from './supabase.js'
import { fetchAllRows } from './fetchAll.js'
import {
  canExportPartners,
  canSeePartnerKind,
  normalizePartnerName,
  normalizePhone,
} from './partnerInput.js'

const SCHEMA_CODES = ['42703', '42P01', 'PGRST204', 'PGRST205']
const PARTNER_COLUMNS = 'id,kind,name,phone,address,note,created_at,archived_at,phone_key'
const NO_ACCESS = 'Bạn không có quyền thực hiện thao tác này.'
const HAS_REFERENCES = 'Đối tác đã gắn với dự án hoặc phiếu kho. Hãy lưu trữ thay vì xóa.'

export const PARTNERS_PAGE_SIZE = 50

export function isMissingPartnersSchemaError(error) {
  return SCHEMA_CODES.includes(error?.code)
}

function success(data, extra = {}) {
  return { ok: true, data, error: null, schemaMissing: false, code: null, ...extra }
}

function failure(error, message) {
  const schemaMissing = isMissingPartnersSchemaError(error)
  return {
    ok: false,
    data: null,
    schemaMissing,
    code: error?.code ?? null,
    error: schemaMissing
      ? 'Thiếu cấu trúc dữ liệu. Anh Thiện cần chạy supabase/partners_v2.sql và các SQL phụ thuộc ghi đầu file.'
      : message,
  }
}

async function getRole() {
  const { data, error } = await supabase.rpc('my_role')
  if (error) throw error
  return data
}

function partnerId(partner) {
  return partner?.id ?? partner
}

function matchesSearch(partner, search) {
  const words = normalizePartnerName(search)
  const phone = normalizePhone(search)
  return (
    (words && [partner.name, partner.address].some((value) => normalizePartnerName(value).includes(words))) ||
    (/^\d+$/.test(phone) && normalizePhone(partner.phone).includes(phone))
  )
}

// Bỏ page để lấy toàn bộ kết quả; page là số trang bắt đầu từ 1 sau khi tìm kiếm.
export async function listPartners({ kind = 'all', search = '', includeArchived = false, page } = {}) {
  try {
    const role = await getRole()
    if (!canSeePartnerKind(role, 'supplier')) return failure(null, NO_ACCESS)
    if (kind !== 'all' && !canSeePartnerKind(role, kind)) return failure(null, NO_ACCESS)

    const visibleKind = role === 'staff' ? 'supplier' : kind
    const { data, error } = await fetchAllRows((from, to) => {
      let query = supabase.from('partners').select(PARTNER_COLUMNS)
      if (visibleKind !== 'all') query = query.eq('kind', visibleKind)
      if (!includeArchived) query = query.is('archived_at', null)
      return query.order('name').order('id').range(from, to)
    })
    if (error) throw error

    const term = String(search ?? '').trim()
    const rows = data.filter((partner) => canSeePartnerKind(role, partner.kind) && (
      !term || matchesSearch(partner, term)
    ))
    const total = rows.length
    if (page == null) return success(rows, { total, page: null, pageSize: null, hasMore: false })
    const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1
    const offset = (currentPage - 1) * PARTNERS_PAGE_SIZE
    return success(rows.slice(offset, offset + PARTNERS_PAGE_SIZE), {
      total,
      page: currentPage,
      pageSize: PARTNERS_PAGE_SIZE,
      hasMore: offset + PARTNERS_PAGE_SIZE < total,
    })
  } catch (error) {
    return failure(error, 'Không thể tải danh sách đối tác.')
  }
}

async function loadCustomerHistory(id, role) {
  const showRevenue = canExportPartners(role)
  const columns = 'id,code,name,start_date,status'
  const { data, error } = await fetchAllRows((from, to) => supabase
    .from('projects')
    .select(showRevenue ? `${columns},project_finance(contract_value)` : columns)
    .eq('customer_id', id)
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('id')
    .range(from, to))
  if (error) throw error

  let totalRevenue = 0
  const projects = data.map(({ id, code, name, start_date, status, project_finance }) => {
    const project = { id, code, name, start_date, status }
    if (!showRevenue) return project
    const contract = Array.isArray(project_finance) ? project_finance[0] : project_finance
    const revenue = status === 'cancelled' || status === 'quote' ? 0 : Number(contract?.contract_value ?? 0)
    totalRevenue += revenue
    return { ...project, revenue }
  })
  return showRevenue ? { kind: 'customer', projects, totalRevenue } : { kind: 'customer', projects }
}

async function loadSupplierHistory(id, role) {
  const showPrices = role !== 'staff'
  const columns = showPrices ? 'id,moved_at,qty,unit_cost' : 'id,moved_at,qty'
  const fetchPurchases = (selection) => fetchAllRows((from, to) => supabase
    .from('stock_movements')
    .select(selection)
    .eq('partner_id', id)
    .eq('type', 'purchase')
    .order('moved_at', { ascending: false })
    .order('id')
    .range(from, to))
  let result = await fetchPurchases(`${columns},receipt_code`)
  const missingReceiptCode = ['42703', 'PGRST204'].includes(result.error?.code) && /receipt_code/i.test(result.error?.message || '')
  if (missingReceiptCode) {
    // Mã phiếu là cột tùy chọn. Phiếu cũ không có mã được đếm theo dòng.
    result = await fetchPurchases(columns)
  }
  if (result.error) throw result.error

  if (!showPrices) {
    const purchases = result.data.map(({ id, moved_at, qty, receipt_code }) => ({
      id, moved_at, qty, receipt_code: receipt_code?.trim() || null,
    }))
    return { kind: 'supplier', purchases, missingReceiptCode }
  }

  let totalSpent = 0
  const missingReceipts = new Set()
  const purchases = result.data.map((row) => {
    const { id, moved_at, qty, unit_cost } = row
    const receipt_code = row.receipt_code?.trim() || null
    const hasPrice = unit_cost != null && Number(unit_cost) > 0
    const amount = hasPrice ? Number(qty) * Number(unit_cost) : null
    totalSpent += amount ?? 0
    if (!hasPrice) missingReceipts.add(receipt_code ? `receipt:${receipt_code}` : `row:${id}`)
    return { id, moved_at, qty, unit_cost, receipt_code, amount }
  })
  return { kind: 'supplier', purchases, totalSpent, missingPriceReceiptCount: missingReceipts.size, missingReceiptCode }
}

export async function getPartnerHistory(partner) {
  try {
    const role = await getRole()
    if (!canSeePartnerKind(role, partner?.kind)) return failure(null, NO_ACCESS)
    const data = partner.kind === 'customer'
      ? await loadCustomerHistory(partner.id, role)
      : await loadSupplierHistory(partner.id, role)
    return success(data, data.missingReceiptCode ? {
      schemaMissing: true,
      warning: 'Chưa có mã phiếu: anh Thiện cần chạy supabase/stock_receipts.sql. Tạm đếm mỗi dòng không có mã là một phiếu.',
    } : {})
  } catch (error) {
    return failure(error, 'Không thể tải lịch sử đối tác.')
  }
}

async function setArchive(partner, archivedAt) {
  try {
    const { data, error } = await supabase
      .from('partners')
      .update({ archived_at: archivedAt })
      .eq('id', partnerId(partner))
      .select(PARTNER_COLUMNS)
      .maybeSingle()
    if (error) throw error
    return data ? success(data) : failure(null, 'Không tìm thấy đối tác hoặc bạn không có quyền chỉnh sửa.')
  } catch (error) {
    return failure(error, 'Không thể cập nhật trạng thái lưu trữ đối tác.')
  }
}

export async function archivePartner(partner) {
  return setArchive(partner, new Date().toISOString())
}

export async function unarchivePartner(partner) {
  return setArchive(partner, null)
}

async function findReferences(id) {
  const [projects, stockMovements] = await Promise.all([
    supabase.from('projects').select('id').eq('customer_id', id).limit(1),
    supabase.from('stock_movements').select('id').eq('partner_id', id).limit(1),
  ])
  if (projects.error) throw projects.error
  if (stockMovements.error) throw stockMovements.error
  return { projects: projects.data.length > 0, stockMovements: stockMovements.data.length > 0 }
}

export async function changeKindAllowed(partner) {
  try {
    const role = await getRole()
    if (!canSeePartnerKind(role, 'customer')) return failure(null, NO_ACCESS)
    const references = await findReferences(partnerId(partner))
    const allowed = !references.projects && !references.stockMovements
    return success({ allowed, references, reason: allowed ? '' : 'Không thể đổi loại đối tác đã có dự án hoặc phiếu kho liên quan.' })
  } catch (error) {
    return failure(error, 'Không thể kiểm tra liên kết của đối tác.')
  }
}

export async function deletePartnerSafe(partner) {
  try {
    const role = await getRole()
    if (!canExportPartners(role)) return failure(null, NO_ACCESS)
    const id = partnerId(partner)
    const references = await findReferences(id)
    if (references.projects || references.stockMovements) {
      return { ...failure(null, HAS_REFERENCES), references }
    }
    const { data, error } = await supabase
      .from('partners')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    return data ? success(data) : failure(null, 'Không tìm thấy đối tác hoặc bạn không có quyền xóa.')
  } catch (error) {
    const hasReferences = error?.code === '23503'
    return failure(error, hasReferences ? HAS_REFERENCES : 'Không thể xóa đối tác.')
  }
}
