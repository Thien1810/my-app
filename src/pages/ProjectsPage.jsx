import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  formatCurrency,
  formatDate,
  PROJECT_STATUS_LABELS,
  generateProjectCode,
  findDuplicateCode,
  todayISO,
} from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { ProjectStatusBadge } from '../components/Badges'
import CurrencyInput from '../components/CurrencyInput'
import { calcProjectFbReminder, stripFbMetaFromNote } from '../lib/watermarkHelper'

const INITIAL_PROJECT_FORM = {
  code: '',
  name: '',
  customer_id: '',
  location: '',
  start_date: '',
  end_date: '',
  lead_id: '',
  status: 'quote',
  contract_value: 0,
  member_ids: [],
  note: '',
}

export default function ProjectsPage() {
  const { isManagerOrAdmin, canEditCatalog, isAdmin } = useAuth()
  const [projects, setProjects] = useState([])
  const [customers, setCustomers] = useState([])
  const [profiles, setProfiles] = useState([])
  const [financesMap, setFinancesMap] = useState(new Map())
  const [membersMap, setMembersMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Bộ lọc
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  // Modal tạo / sửa dự án
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [form, setForm] = useState(INITIAL_PROJECT_FORM)
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [projRes, custRes, profRes, memRes] = await Promise.all([
        supabase
          .from('projects')
          .select('*, customer:partners(id, name, phone), lead:profiles!projects_lead_id_fkey(id, full_name, email)')
          .order('created_at', { ascending: false }),
        supabase.from('partners').select('*').eq('kind', 'customer').order('name'),
        supabase.from('profiles').select('*').neq('role', 'pending').order('full_name'),
        supabase.from('project_members').select('project_id, user_id'),
      ])

      if (projRes.error) throw projRes.error
      setProjects(projRes.data || [])
      setCustomers(custRes.data || [])
      setProfiles(profRes.data || [])

      const mMap = new Map()
      for (const m of memRes.data || []) {
        if (!mMap.has(m.project_id)) mMap.set(m.project_id, [])
        mMap.get(m.project_id).push(m.user_id)
      }
      setMembersMap(mMap)

      if (canEditCatalog) {
        const finRes = await supabase.from('project_finance').select('*')
        const fMap = new Map()
        for (const f of finRes.data || []) {
          fMap.set(Number(f.project_id), Number(f.contract_value || 0))
        }
        setFinancesMap(fMap)
      }
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách dự án')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [canEditCatalog])

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterStatus !== 'all' && p.status !== filterStatus) return false
      if (filterFrom && (p.start_date || '') < filterFrom) return false
      if (filterTo && (p.start_date || '') > filterTo) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = p.name?.toLowerCase().includes(q)
        const matchCode = p.code?.toLowerCase().includes(q)
        const matchLoc = p.location?.toLowerCase().includes(q)
        const matchCust = p.customer?.name?.toLowerCase().includes(q)
        if (!matchName && !matchCode && !matchLoc && !matchCust) return false
      }
      return true
    })
  }, [projects, filterStatus, filterFrom, filterTo, search])

  const openCreateModal = () => {
    setEditingProject(null)
    const today = todayISO()
    setForm({
      ...INITIAL_PROJECT_FORM,
      start_date: today,
      code: generateProjectCode(today, projects),
    })
    setModalOpen(true)
  }

  const openEditModal = (p) => {
    setEditingProject(p)
    setForm({
      code: p.code || '',
      name: p.name || '',
      customer_id: p.customer_id || '',
      location: p.location || '',
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      lead_id: p.lead_id || '',
      status: p.status || 'quote',
      contract_value: financesMap.get(p.id) ?? 0,
      member_ids: membersMap.get(p.id) || [],
      note: stripFbMetaFromNote(p.note || ''),
    })
    setModalOpen(true)
  }

  const toggleMember = (userId) => {
    setForm((prev) => {
      const exists = prev.member_ids.includes(userId)
      return {
        ...prev,
        member_ids: exists
          ? prev.member_ids.filter((id) => id !== userId)
          : [...prev.member_ids, userId],
      }
    })
  }

  const duplicateProject = useMemo(
    () => findDuplicateCode(form.code, projects, editingProject?.id),
    [form.code, projects, editingProject]
  )

  const handleSaveProject = async (e) => {
    e.preventDefault()
    if (duplicateProject) {
      setError(`Mã dự án "${form.code}" đã trùng với dự án "${duplicateProject.name}". Vui lòng bấm "⚡ Sinh mã" để lấy mã kế tiếp.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const finalCode = form.code.trim().toUpperCase() || null

      if (finalCode) {
        let checkQuery = supabase
          .from('projects')
          .select('id, code, name')
          .ilike('code', finalCode)
        if (editingProject?.id) {
          checkQuery = checkQuery.neq('id', editingProject.id)
        }
        const { data: dupRows } = await checkQuery
        if (dupRows && dupRows.length > 0) {
          const freshRes = await supabase.from('projects').select('id, code')
          const nextAvailable = generateProjectCode(
            form.start_date,
            freshRes.data || projects,
            editingProject?.id
          )
          setForm((prev) => ({ ...prev, code: nextAvailable }))
          throw new Error(
            `Mã dự án "${finalCode}" vừa được dùng cho "${dupRows[0].name}". Hệ thống đã tự động đổi sang mã mới chưa trùng: ${nextAvailable}. Hãy bấm Lưu dự án một lần nữa!`
          )
        }
      }

      const payload = {
        code: finalCode,
        name: form.name.trim(),
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        location: form.location.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        lead_id: form.lead_id || null,
        status: form.status,
        note: form.note.trim() || null,
      }

      let projectId = editingProject?.id
      if (editingProject) {
        const { error: err } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', editingProject.id)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase
          .from('projects')
          .insert([payload])
          .select('id')
          .single()
        if (err) throw err
        projectId = data.id
      }

      // Lưu tài chính dự án (Admin/Manager/Storekeeper)
      if (canEditCatalog && projectId) {
        await supabase.from('project_finance').upsert(
          {
            project_id: projectId,
            contract_value: Number(form.contract_value || 0),
          },
          { onConflict: 'project_id' }
        )
      }

      // Cập nhật thành viên tham gia dự án
      if (isManagerOrAdmin && projectId) {
        await supabase.from('project_members').delete().eq('project_id', projectId)
        if (form.member_ids.length > 0) {
          const memberRows = form.member_ids.map((uid) => ({
            project_id: projectId,
            user_id: uid,
          }))
          const { error: memErr } = await supabase.from('project_members').insert(memberRows)
          if (memErr) throw memErr
        }
      }

      setModalOpen(false)
      await loadData()
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu dự án')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteProject = async (p) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa dự án "${p.name}"?`)) return
    try {
      const { error: err } = await supabase.from('projects').delete().eq('id', p.id)
      if (err) throw err
      await loadData()
    } catch (err) {
      setError(err.message || 'Không thể xóa dự án (có thể dự án đã có phiếu kho)')
    }
  }

  const handleExport = () => {
    const rows = filteredProjects.map((p) => {
      const base = {
        'Mã dự án': p.code || `#${p.id}`,
        'Tên dự án': p.name,
        'Khách hàng': p.customer?.name || '',
        'Địa điểm': p.location || '',
        'Ngày thi công': formatDate(p.start_date),
        'Ngày tháo dỡ': formatDate(p.end_date),
        'Phụ trách': p.lead?.full_name || p.lead?.email || '',
        'Trạng thái': PROJECT_STATUS_LABELS[p.status] || p.status,
      }
      if (canEditCatalog) {
        base['Giá trị hợp đồng (₫)'] = financesMap.get(p.id) || 0
      }
      base['Ghi chú'] = p.note || ''
      return base
    })
    exportToExcel(rows, 'DanhSachDuAn', 'danh-sach-du-an.xlsx')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý Dự án Trang trí</h1>
          <p className="text-muted">
            Theo dõi tiến độ, kế hoạch giữ chỗ vật tư, xuất kho, thu hồi và quyết toán từng sự kiện
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={handleExport}>
            📥 Xuất Excel
          </button>
          {isManagerOrAdmin && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Tạo dự án mới
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Bộ lọc */}
      <div className="card filter-bar">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Tìm theo mã, tên dự án, khách hàng, địa điểm..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input"
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <div className="filter-inline">
            <label>Thi công từ:</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="filter-inline">
            <label>Đến:</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Bảng dự án */}
      <div className="card">
        {loading ? (
          <div className="loading-state">Đang tải danh sách dự án...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="empty-state">Chưa có dự án nào phù hợp.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên dự án</th>
                  <th>Khách hàng</th>
                  <th>Địa điểm</th>
                  <th>Ngày thi công → Tháo dỡ</th>
                  <th>Phụ trách</th>
                  <th>Trạng thái</th>
                  {canEditCatalog && <th className="text-right">Giá trị HĐ</th>}
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <code>{p.code || `#${p.id}`}</code>
                    </td>
                    <td>
                      <Link to={`/du-an/${p.id}`} className="table-link font-bold">
                        {p.name}
                      </Link>
                      {(() => {
                        const fbRem = calcProjectFbReminder(p)
                        if (fbRem.fbData?.status === 'posted') {
                          return (
                            <div style={{ marginTop: 3 }}>
                              <span className="badge badge-green" style={{ fontSize: '0.72rem' }}>
                                📱 Đã đăng FB
                              </span>
                            </div>
                          )
                        }
                        if (fbRem.isOverdue5Days) {
                          return (
                            <div style={{ marginTop: 3 }}>
                              <Link
                                to={`/du-an/${p.id}?tab=facebook`}
                                className="badge badge-danger"
                                style={{ fontSize: '0.72rem', textDecoration: 'none' }}
                              >
                                🔔 Quá {fbRem.daysPassed} ngày chưa đăng FB
                              </Link>
                            </div>
                          )
                        }
                        return null
                      })()}
                    </td>
                    <td>{p.customer?.name || '—'}</td>
                    <td>{p.location || '—'}</td>
                    <td>
                      {formatDate(p.start_date)} → {formatDate(p.end_date)}
                    </td>
                    <td>{p.lead?.full_name || p.lead?.email || '—'}</td>
                    <td>
                      <ProjectStatusBadge status={p.status} />
                    </td>
                    {canEditCatalog && (
                      <td className="text-right font-bold text-green">
                        {formatCurrency(financesMap.get(p.id) || 0)}
                      </td>
                    )}
                    <td className="text-right">
                      <div className="row-actions">
                        <Link to={`/du-an/${p.id}`} className="btn btn-sm btn-primary">
                          Mở dự án
                        </Link>
                        {isManagerOrAdmin && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => openEditModal(p)}
                          >
                            Sửa
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => handleDeleteProject(p)}
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal tạo / sửa dự án */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingProject ? 'Cập nhật dự án' : 'Tạo dự án mới'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveProject} className="modal-body">
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Mã dự án (tự sinh DA-YYMM-001)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="VD: DA-2611-001"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      style={
                        duplicateProject
                          ? { borderColor: '#dc2626', backgroundColor: '#fef2f2' }
                          : undefined
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      title="Sinh mã dự án tự động không trùng"
                      onClick={() =>
                        setForm({
                          ...form,
                          code: generateProjectCode(
                            form.start_date,
                            projects,
                            editingProject?.id
                          ),
                        })
                      }
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      ⚡ Sinh mã
                    </button>
                  </div>
                  {duplicateProject ? (
                    <div className="text-xs text-red" style={{ marginTop: 4 }}>
                      ⚠️ Trùng mã với dự án: <strong>{duplicateProject.name}</strong>.{' '}
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: '0.78rem', padding: 0 }}
                        onClick={() =>
                          setForm({
                            ...form,
                            code: generateProjectCode(
                              form.start_date,
                              projects,
                              editingProject?.id
                            ),
                          })
                        }
                      >
                        Đổi sang mã kế tiếp
                      </button>
                    </div>
                  ) : form.code.trim() ? (
                    <div className="text-xs text-green" style={{ marginTop: 4 }}>
                      ✓ Mã dự án hợp lệ, chưa trùng
                    </div>
                  ) : null}
                </div>
                <div className="form-group">
                  <label>Trạng thái *</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Tên dự án / Sự kiện *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Tiệc cưới Anh Minh - Chị Lan tại Gem Center"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Khách hàng</label>
                  <select
                    value={form.customer_id}
                    onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  >
                    <option value="">-- Chọn khách hàng --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Địa điểm thi công</label>
                  <input
                    type="text"
                    placeholder="VD: Sảnh Castor - Gem Center, Q.1"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Ngày thi công (Start Date)</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => {
                      const nextStart = e.target.value
                      setForm({
                        ...form,
                        start_date: nextStart,
                        code: !editingProject
                          ? generateProjectCode(nextStart, projects)
                          : form.code,
                      })
                    }}
                  />
                </div>
                <div className="form-group">
                  <label>Ngày tháo dỡ / thu hồi dự kiến (End Date)</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label>Người phụ trách chính (Lead)</label>
                  <select
                    value={form.lead_id}
                    onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
                  >
                    <option value="">-- Chọn người phụ trách --</option>
                    {profiles.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.full_name || pr.email} ({pr.email})
                      </option>
                    ))}
                  </select>
                </div>

                {canEditCatalog && (
                  <div className="form-group">
                    <label>Giá trị hợp đồng (₫)</label>
                    <CurrencyInput
                      value={form.contract_value}
                      onChange={(num) => setForm({ ...form, contract_value: num })}
                      placeholder="VD: 15.000.000"
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Thành viên tham gia thi công (Nhân viên được phân công sẽ thấy dự án này)</label>
                <div className="members-checkbox-grid">
                  {profiles.map((pr) => (
                    <label key={pr.id} className="checkbox-label member-chip">
                      <input
                        type="checkbox"
                        checked={form.member_ids.includes(pr.id)}
                        onChange={() => toggleMember(pr.id)}
                      />
                      <span>{pr.full_name || pr.email}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Ghi chú dự án</label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Yêu cầu đặc biệt từ khách hàng, giờ bàn giao sảnh..."
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || Boolean(duplicateProject)}
                >
                  {saving ? 'Đang lưu...' : 'Lưu dự án'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
