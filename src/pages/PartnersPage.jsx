import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PARTNER_KIND_LABELS } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { PartnerKindBadge } from '../components/Badges'

const INITIAL_FORM = {
  kind: 'customer',
  name: '',
  phone: '',
  address: '',
  note: '',
}

export default function PartnersPage() {
  const { canEditCatalog, canDeleteCatalog } = useAuth()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingPartner, setEditingPartner] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)

  const loadPartners = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('partners')
        .select('*')
        .order('name', { ascending: true })
      if (err) throw err
      setPartners(data || [])
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách đối tác')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPartners()
  }, [])

  const filteredPartners = useMemo(() => {
    return partners.filter((p) => {
      if (filterKind !== 'all' && p.kind !== filterKind) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = p.name?.toLowerCase().includes(q)
        const matchPhone = p.phone?.toLowerCase().includes(q)
        const matchAddr = p.address?.toLowerCase().includes(q)
        if (!matchName && !matchPhone && !matchAddr) return false
      }
      return true
    })
  }, [partners, filterKind, search])

  const openCreateModal = () => {
    setEditingPartner(null)
    setForm(INITIAL_FORM)
    setModalOpen(true)
  }

  const openEditModal = (p) => {
    setEditingPartner(p)
    setForm({
      kind: p.kind || 'customer',
      name: p.name || '',
      phone: p.phone || '',
      address: p.address || '',
      note: p.note || '',
    })
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        kind: form.kind,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        note: form.note.trim() || null,
      }
      if (editingPartner) {
        const { error: err } = await supabase
          .from('partners')
          .update(payload)
          .eq('id', editingPartner.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('partners').insert([payload])
        if (err) throw err
      }
      setModalOpen(false)
      await loadPartners()
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu đối tác')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p) => {
    if (!window.confirm(`Xóa đối tác "${p.name}"?`)) return
    try {
      const { error: err } = await supabase.from('partners').delete().eq('id', p.id)
      if (err) throw err
      await loadPartners()
    } catch (err) {
      setError(err.message || 'Không thể xóa đối tác đã gắn với dự án hoặc phiếu nhập')
    }
  }

  const handleExport = () => {
    const rows = filteredPartners.map((p) => ({
      'Loại đối tác': PARTNER_KIND_LABELS[p.kind] || p.kind,
      'Tên đối tác': p.name,
      'Số điện thoại': p.phone || '',
      'Địa chỉ': p.address || '',
      'Ghi chú': p.note || '',
    }))
    exportToExcel(rows, 'DanhSachDoiTac', 'danh-sach-doi-tac.xlsx')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Quản lý Đối tác</h1>
          <p className="text-muted">Danh sách Khách hàng đặt dịch vụ và Nhà cung cấp vật tư</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={handleExport}>
            📥 Xuất Excel
          </button>
          {canEditCatalog && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Thêm đối tác
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card filter-bar">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Tìm theo tên, số điện thoại, địa chỉ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input"
          />
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
            <option value="all">Tất cả đối tác</option>
            <option value="customer">Khách hàng</option>
            <option value="supplier">Nhà cung cấp</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-state">Đang tải danh sách đối tác...</div>
        ) : filteredPartners.length === 0 ? (
          <div className="empty-state">Không tìm thấy đối tác nào.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Phân loại</th>
                  <th>Tên đối tác</th>
                  <th>Số điện thoại</th>
                  <th>Địa chỉ</th>
                  <th>Ghi chú</th>
                  {canEditCatalog && <th className="text-right">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {filteredPartners.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <PartnerKindBadge kind={p.kind} />
                    </td>
                    <td className="font-bold">{p.name}</td>
                    <td>{p.phone || '—'}</td>
                    <td>{p.address || '—'}</td>
                    <td>{p.note || '—'}</td>
                    {canEditCatalog && (
                      <td className="text-right">
                        <div className="row-actions">
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => openEditModal(p)}
                          >
                            Sửa
                          </button>
                          {canDeleteCatalog && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => handleDelete(p)}
                            >
                              Xóa
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingPartner ? 'Cập nhật đối tác' : 'Thêm đối tác mới'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSave} className="modal-body">
              <div className="form-group">
                <label>Loại đối tác *</label>
                <select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                >
                  <option value="customer">Khách hàng (Thuê trang trí / Sự kiện)</option>
                  <option value="supplier">Nhà cung cấp (Bán vật tư / Phụ kiện)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Tên đối tác / Công ty *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Chị Hương / Kho Hoa Lụa Sài Gòn"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Số điện thoại</label>
                <input
                  type="text"
                  placeholder="090xxxxxxx"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Địa chỉ</label>
                <input
                  type="text"
                  placeholder="Địa chỉ liên hệ..."
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
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
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu đối tác'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
