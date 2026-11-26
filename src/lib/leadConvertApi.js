import { supabase } from './supabase.js'
import { fetchAllRows } from './fetchAll.js'
import { generateProjectCode } from './formatters.js'
import { findLeadCustomerMatches, isMissingLeadLinkColumn, resolveLeadCustomerChoice } from './leadConvert.js'

// Không yêu cầu cột mới; lấy cả khách lưu trữ và phân trang để không bỏ sót.
export async function loadCustomerMatches(lead) {
  const { data, error } = await fetchAllRows((from, to) => supabase
    .from('partners').select('*').eq('kind', 'customer').order('id').range(from, to))
  if (error) throw new Error('Không thể tìm khách trùng số điện thoại. Hãy thử lại.')
  return findLeadCustomerMatches(lead, data)
}

export function isLeadProjectConflict(error) {
  return error?.code === '23505' && /uq_projects_site_lead|site_lead_id/i.test(`${error.message} ${error.details}`)
}

function isProjectCodeConflict(error) {
  return error?.code === '23505' && !isLeadProjectConflict(error)
    && /projects_code_key|\(code\)/i.test(`${error.message} ${error.details}`)
}

async function loadProjectCodes() {
  const { data, error } = await fetchAllRows((from, to) => supabase
    .from('projects').select('id, code').order('id').range(from, to))
  if (error) throw error
  return data
}

function insertProject(row) {
  return supabase.from('projects').insert(row).select('id').single()
}

export async function createLeadProject({ lead, leadSource, warehouseCode, customerChoice }, createdCustomerIds) {
  // Hộp thoại có thể được mở lại sau khi lần trước đã tạo khách nhưng dự án thất bại.
  let customerId = createdCustomerIds.get(lead.id)
  if (customerId == null) {
    const matches = await loadCustomerMatches(lead)
    const choice = resolveLeadCustomerChoice(matches, customerChoice)
    if (!choice.ok) return { customerChoiceChanged: true }
    customerId = choice.customerId
  }

  const existingProjects = await loadProjectCodes()
  if (customerId == null) {
    const { data, error } = await supabase.from('partners').insert({
      kind: 'customer',
      name: lead.customer_name,
      phone: (lead.phone || '').trim() || null,
      address: lead.location || null,
      note: 'Khách đăng ký từ Website dangwed.com',
    }).select('id').single()
    if (error) throw error
    customerId = data.id
    createdCustomerIds.set(lead.id, customerId)
  }

  const noteParts = []
  if (lead.selected_template) noteParts.push(`Mẫu quan tâm: ${lead.selected_template}`)
  if (lead.service_interest) noteParts.push(`Dịch vụ: ${lead.service_interest}`)
  if (lead.note) noteParts.push(`Ghi chú khách: ${lead.note}`)
  noteParts.push('Nguồn: Website dangwed.com')

  let code = generateProjectCode(lead.event_date || '', existingProjects)
  const row = {
    code,
    name: `${lead.service_interest || 'Tiệc cưới'} - ${lead.customer_name}`,
    customer_id: customerId,
    location: lead.location || null,
    start_date: lead.event_date || null,
    end_date: lead.event_date || null,
    status: 'quote',
    lead_source: leadSource,
    warehouse_code: warehouseCode || null,
    note: noteParts.join('\n'),
    site_lead_id: lead.id,
  }

  let result = await insertProject(row)
  if (isMissingLeadLinkColumn(result.error)) {
    // Hỗ trợ cơ sở dữ liệu chưa chạy projects_site_lead_link.sql.
    delete row.site_lead_id
    result = await insertProject(row)
  }
  if (isProjectCodeConflict(result.error)) {
    const refreshedProjects = await loadProjectCodes()
    code = generateProjectCode(lead.event_date || '', [...refreshedProjects, { code }])
    result = await insertProject({ ...row, code })
  }
  if (result.error) throw result.error

  createdCustomerIds.delete(lead.id)
  return { project: result.data, code }
}
