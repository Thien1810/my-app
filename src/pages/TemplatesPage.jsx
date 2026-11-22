import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatNumber, KIND_LABELS } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { KindBadge } from '../components/Badges'

export default function TemplatesPage() {
  const { canEditCatalog, canDeleteCatalog } = useAuth()
  const [templates, setTemplates] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form tạo/sửa mẫu set
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([{ item_id: '', qty: 1 }])
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [tplRes, itemsRes] = await Promise.all([
        supabase
          .from('set_templates')
          .select('*, items:set_template_items(item_id, qty, item:items(id, code, name, unit, kind))')
          .order('name'),
        supabase.from('items').select('*').eq('active', true).order('name'),
      ])
      if (tplRes.error) throw tplRes.error
      if (itemsRes.error) throw itemsRes.error
      setTemplates(tplRes.data || [])
      setItems(itemsRes.data || [])
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách mẫu set trang trí')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const openCreateModal = () => {
    setEditingTemplate(null)
    setName('')
    setNote('')
    setLines([{ item_id: '', qty: 1 }])
    setModalOpen(true)
  }

  const openEditModal = (tpl) => {
    setEditingTemplate(tpl)
    setName(tpl.name || '')
    setNote(tpl.note || '')
    const existingLines = (tpl.items || []).map((ti) => ({
      item_id: String(ti.item_id),
      qty: Number(ti.qty),
    }))
    setLines(existingLines.length > 0 ? existingLines : [{ item_id: '', qty: 1 }])
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      let templateId = editingTemplate?.id
      const payload = {
        name: name.trim(),
        note: note.trim() || null,
      }

      if (editingTemplate) {
        const { error: err } = await supabase
          .from('set_templates')
          .update(payload)
          .eq('id', templateId)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase
          .from('set_templates')
          .insert([payload])
          .select('id')
          .single()
        if (err) throw err
        templateId = data.id
      }

      // Gộp các dòng trùng item_id
      const mergedMap = new Map()
      for (const l of lines) {
        if (!l.item_id || Number(l.qty) <= 0) continue
        const idNum = Number(l.item_id)
        mergedMap.set(idNum, (mergedMap.get(idNum) || 0) + Number(l.qty))
      }

      await supabase.from('set_template_items').delete().eq('template_id', templateId)

      const itemRows = Array.from(mergedMap.entries()).map(([item_id, qty]) => ({
        template_id: templateId,
        item_id,
        qty,
      }))

      if (itemRows.length > 0) {
        const { error: itemErr } = await supabase.from('set_template_items').insert(itemRows)
        if (itemErr) throw itemErr
      }

      setModalOpen(false)
      setSuccess('Đã lưu mẫu set trang trí!')
      await loadData()
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu mẫu set')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tpl) => {
    if (!window.confirm(`Xóa mẫu set "${tpl.name}"?`)) return
    try {
      const { error: err } = await supabase.from('set_templates').delete().eq('id', tpl.id)
      if (err) throw err
      await loadData()
    } catch (err) {
      setError(err.message || 'Không thể xóa mẫu set')
    }
  }

  const handleExport = () => {
    const rows = []
    for (const tpl of templates) {
      if (!tpl.items || tpl.items.length === 0) {
        rows.push({
          'Tên mẫu set': tpl.name,
          'Ghi chú set': tpl.note || '',
          'Mã vật tư': '',
          'Tên vật tư': '',
          'Phân loại': '',
          'Số lượng': 0,
          'ĐVT': '',
        })
      } else {
        for (const ti of tpl.items) {
          rows.push({
            'Tên mẫu set': tpl.name,
            'Ghi chú set': tpl.note || '',
            'Mã vật tư': ti.item?.code || '',
            'Tên vật tư': ti.item?.name || `#${ti.item_id}`,
            'Phân loại': KIND_LABELS[ti.item?.kind] || '',
            'Số lượng': Number(ti.qty),
            'ĐVT': ti.item?.unit || '',
          })
        }
      }
    }
    exportToExcel(rows, 'MauSetTrangTri', 'mau-set-trang-tri.xlsx')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Mẫu Set Trang Trí</h1>
          <p className="text-muted">
            Định nghĩa sẵn danh sách vật tư cho các gói trang trí tiêu chuẩn (Backdrop cưới, Sinh
            nhật, Khai trương...) để áp dụng nhanh vào Kế hoạch dự án
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={handleExport}>
            📥 Xuất Excel
          </button>
          {canEditCatalog && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Tạo mẫu set mới
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading-state">Đang tải danh sách mẫu set...</div>
      ) : templates.length === 0 ? (
        <div className="card empty-state">
          Chưa có mẫu set trang trí nào. Hãy tạo mẫu set đầu tiên để tăng tốc lập kế hoạch dự án.
        </div>
      ) : (
        <div className="templates-grid">
          {templates.map((tpl) => (
            <div key={tpl.id} className="card">
              <div className="card-header">
                <div>
                  <h3>✨ {tpl.name}</h3>
                  {tpl.note && <p className="text-xs text-muted">{tpl.note}</p>}
                </div>
                {canEditCatalog && (
                  <div className="row-actions">
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => openEditModal(tpl)}
                    >
                      Sửa
                    </button>
                    {canDeleteCatalog && (
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleDelete(tpl)}
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                )}
              </div>

              {!tpl.items || tpl.items.length === 0 ? (
                <div className="empty-state">Mẫu set chưa có vật tư</div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Vật tư</th>
                        <th>Loại</th>
                        <th className="text-right">Định mức SL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tpl.items.map((ti) => (
                        <tr key={ti.item_id}>
                          <td>
                            <span className="font-bold">
                              {ti.item?.name || `Vật tư #${ti.item_id}`}
                            </span>
                            {ti.item?.code && (
                              <span className="text-xs text-muted"> ({ti.item.code})</span>
                            )}
                          </td>
                          <td>{ti.item?.kind && <KindBadge kind={ti.item.kind} />}</td>
                          <td className="text-right font-bold">
                            {formatNumber(ti.qty)} {ti.item?.unit || ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal tạo / sửa mẫu set */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTemplate ? 'Cập nhật mẫu set' : 'Tạo mẫu set trang trí mới'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSave} className="modal-body">
              <div className="form-group">
                <label>Tên mẫu set *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Set Backdrop Cưới Hoa Lụa Cao Cấp 4m"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Mô tả / Ghi chú</label>
                <textarea
                  rows={2}
                  placeholder="Phù hợp cho sảnh tiệc 200-300 khách..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <h4 style={{ marginBottom: 8 }}>Danh sách vật tư trong mẫu set</h4>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vật tư *</th>
                      <th style={{ width: 140 }}>Số lượng *</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            required
                            value={line.item_id}
                            onChange={(e) => {
                              const val = e.target.value
                              setLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, item_id: val } : l))
                              )
                            }}
                          >
                            <option value="">-- Chọn vật tư --</option>
                            {items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.code ? `[${i.code}] ` : ''}
                                {i.name} ({KIND_LABELS[i.kind]} - {i.unit})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            required
                            value={line.qty}
                            onChange={(e) => {
                              const val = e.target.value
                              setLines((prev) =>
                                prev.map((l, i) => (i === idx ? { ...l, qty: val } : l))
                              )
                            }}
                          />
                        </td>
                        <td className="text-right">
                          {lines.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() =>
                                setLines((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setLines((prev) => [...prev, { item_id: '', qty: 1 }])}
                >
                  + Thêm dòng vật tư
                </button>
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
                  {saving ? 'Đang lưu...' : 'Lưu mẫu set'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
