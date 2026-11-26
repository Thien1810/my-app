import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAll'
import {
  canSeePartnerKind,
  normalizePartnerName,
  normalizePhone,
} from '../../lib/partnerInput'
import { PARTNERS_PAGE_SIZE } from '../../lib/partnersApi'

export const LEGACY_PARTNER_COLUMNS = 'id,kind,name,phone,address,note,created_at'
const NO_ACCESS = 'Bạn không có quyền thực hiện thao tác này.'

function matchesPartnerSearch(partner, search) {
  const words = normalizePartnerName(search)
  const phone = normalizePhone(search)
  return (
    (words && [partner.name, partner.address].some((val) => normalizePartnerName(val).includes(words))) ||
    (/^\d+$/.test(phone) && normalizePhone(partner.phone).includes(phone))
  )
}

/**
 * Hàm dự phòng khi SQL partners_v2.sql chưa chạy (thiếu cột archived_at/phone_key).
 * Dùng chung cho danh sách, xuất Excel (page = null) và kiểm tra trùng (kind = 'all', page = null).
 */
export async function listPartnersFallback({ role, kind = 'all', search = '', page } = {}) {
  try {
    if (!canSeePartnerKind(role, 'supplier')) {
      return { ok: false, data: null, error: NO_ACCESS, schemaMissing: true }
    }
    if (kind !== 'all' && !canSeePartnerKind(role, kind)) {
      return { ok: false, data: null, error: NO_ACCESS, schemaMissing: true }
    }

    const visibleKind = role === 'staff' ? 'supplier' : kind
    const { data, error } = await fetchAllRows((from, to) => {
      let query = supabase.from('partners').select(LEGACY_PARTNER_COLUMNS)
      if (visibleKind !== 'all') {
        query = query.eq('kind', visibleKind)
      }
      return query.order('name').order('id').range(from, to)
    })

    if (error) {
      return {
        ok: false,
        data: null,
        error: error.code === '42501' ? NO_ACCESS : 'Không thể tải danh sách đối tác.',
        schemaMissing: true,
      }
    }

    const term = String(search ?? '').trim()
    const rows = (data || []).filter(
      (partner) => canSeePartnerKind(role, partner.kind) && (!term || matchesPartnerSearch(partner, term))
    )
    const total = rows.length

    if (page == null) {
      return {
        ok: true,
        data: rows,
        error: null,
        schemaMissing: true,
        total,
        page: null,
        pageSize: null,
        hasMore: false,
      }
    }

    const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1
    const offset = (currentPage - 1) * PARTNERS_PAGE_SIZE
    return {
      ok: true,
      data: rows.slice(offset, offset + PARTNERS_PAGE_SIZE),
      error: null,
      schemaMissing: true,
      total,
      page: currentPage,
      pageSize: PARTNERS_PAGE_SIZE,
      hasMore: offset + PARTNERS_PAGE_SIZE < total,
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err?.code === '42501' ? NO_ACCESS : 'Không thể tải danh sách đối tác.',
      schemaMissing: true,
    }
  }
}
