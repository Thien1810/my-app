// Gọi Supabase cho quy tắc dự án đợt 2 (RPC trong supabase/projects_phase2.sql + dữ liệu kiểm
// tra đổi trạng thái). Không throw: trả { data, error, missingSchema }.
import { supabase } from './supabase'
import { fetchAllRows } from './fetchAll'
import { cancelMonthOf, CLOSING_STATUSES, isMissingSchemaError, outstandingReusable } from './projectRules'

const result = (data, error) => ({ data: error ? null : data, error: error || null, missingSchema: isMissingSchemaError(error) })

export async function rpcApplyTemplatesToPlan(projectId, entries, mode) {
  const { data, error } = await supabase.rpc('apply_templates_to_plan', {
    p_project_id: Number(projectId),
    p_entries: entries.map((e) => ({ template_id: Number(e.template_id), mult: Number(e.mult) > 0 ? Number(e.mult) : 1 })),
    p_mode: mode,
  })
  return result(data, error)
}

export async function rpcIssueProjectByPlan(projectId, movedAt, note) {
  const { data, error } = await supabase.rpc('issue_project_by_plan', {
    p_project_id: Number(projectId),
    p_moved_at: movedAt || null,
    p_note: note || null,
  })
  return result(data, error)
}

// Dữ liệu MỚI NHẤT để kiểm đổi trạng thái (statusChangeBlockReason). Trường không tải được = null
// (hàm thuần sẽ chặn kèm câu "không tải được"). Trường không cần kiểm = undefined.
export async function loadStatusGuardData(project, nextStatus) {
  const out = { outstanding: undefined, hasForfeit: undefined, cancelMonth: undefined, cancelMonthLocked: undefined }
  if (!project || !nextStatus || project.status === nextStatus) return out
  const jobs = []

  if (CLOSING_STATUSES.includes(nextStatus)) {
    jobs.push(
      fetchAllRows((from, to) =>
        supabase
          .from('stock_movements')
          .select('item_id, type, qty, item:items(id, name, unit, kind)')
          .eq('project_id', project.id)
          .in('type', ['issue', 'return_good', 'return_damaged', 'return_lost'])
          .order('id')
          .range(from, to)
      ).then(({ data, error }) => {
          if (error) {
            out.outstanding = null
            return
          }
          const itemMap = new Map()
          for (const m of data || []) if (m.item) itemMap.set(Number(m.item_id), m.item)
          out.outstanding = outstandingReusable(data || [], itemMap)
        })
    )
  }

  if (project.status === 'cancelled' && nextStatus !== 'cancelled') {
    out.cancelMonth = cancelMonthOf(project)
    jobs.push(
      supabase
        .from('project_advances')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('kind', 'forfeit')
        .then(({ count, error }) => {
          out.hasForfeit = error ? null : (count || 0) > 0
        })
    )
    if (out.cancelMonth) {
      jobs.push(
        supabase
          .from('month_locks')
          .select('month')
          .eq('month', out.cancelMonth)
          .maybeSingle()
          .then(({ data, error }) => {
            out.cancelMonthLocked = error ? null : !!data
          })
      )
    } else {
      out.cancelMonthLocked = false
    }
  }

  await Promise.all(jobs)
  return out
}
