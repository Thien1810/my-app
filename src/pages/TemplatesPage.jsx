import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatNumber, KIND_LABELS } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { KindBadge } from '../components/Badges'
import { compressImageUnder1MB, formatBytes } from '../lib/imageCompressor'

export const SET_CATEGORY_OPTIONS = [
  { value: 'Gia tiên', label: '🏮 Gia tiên', badgeClass: 'badge-green' },
  { value: 'Mâm quả', label: '🎁 Mâm quả', badgeClass: 'badge-blue' },
]

// Hỗ trợ đọc/ghi tương thích ngay cả khi database chưa chạy ALTER TABLE thêm cột category, image_url
const META_PREFIX = '__SETMETA__'

export function parseTemplateMeta(tpl) {
  if (!tpl) return { category: 'Gia tiên', image_url: '', cleanNote: '' }
  let category = tpl.category || ''
  let image_url = tpl.image_url || ''
  let cleanNote = tpl.note || ''

  if (cleanNote.startsWith(META_PREFIX)) {
    const endIdx = cleanNote.indexOf('__ENDMETA__')
    if (endIdx !== -1) {
      const jsonStr = cleanNote.slice(META_PREFIX.length, endIdx)
      cleanNote = cleanNote.slice(endIdx + '__ENDMETA__'.length).trim()
      try {
        const parsed = JSON.parse(jsonStr)
        if (!category && parsed.category) category = parsed.category
        if (!image_url && parsed.image_url) image_url = parsed.image_url
      } catch {
        // ignore parse errors
      }
    }
  }

  return {
    category: category || 'Gia tiên',
    image_url: image_url || '',
    cleanNote,
  }
}

function packTemplateNoteFallback(category, image_url, cleanNote) {
  const meta = JSON.stringify({
    category: category || 'Gia tiên',
    image_url: image_url || '',
  })
  const noteText = (cleanNote || '').trim()
  return `${META_PREFIX}${meta}__ENDMETA__${noteText ? ' ' + noteText : ''}`
}

export default function TemplatesPage() {
  const { canEditCatalog, canDeleteCatalog } = useAuth()
  const [templates, setTemplates] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')

  // Form tạo/sửa mẫu set
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Gia tiên')
  const [imageUrl, setImageUrl] = useState('')
  const [imageCompressing, setImageCompressing] = useState(false)
  const [imageStats, setImageStats] = useState(null)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([{ item_id: '', qty: 1 }])
  const [saving, setSaving] = useState(false)
  const [previewLightbox, setPreviewLightbox] = useState(null)

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

  const enrichedTemplates = useMemo(() => {
    return templates.map((tpl) => {
      const meta = parseTemplateMeta(tpl)
      return {
        ...tpl,
        parsedCategory: meta.category,
        parsedImageUrl: meta.image_url,
        parsedNote: meta.cleanNote,
      }
    })
  }, [templates])

  const filteredTemplates = useMemo(() => {
    if (filterCategory === 'all') return enrichedTemplates
    return enrichedTemplates.filter((t) => t.parsedCategory === filterCategory)
  }, [enrichedTemplates, filterCategory])

  const openCreateModal = () => {
    setEditingTemplate(null)
    setName('')
    setCategory('Gia tiên')
    setImageUrl('')
    setImageStats(null)
    setNote('')
    setLines([{ item_id: '', qty: 1 }])
    setModalOpen(true)
  }

  const openEditModal = (tpl) => {
    const meta = parseTemplateMeta(tpl)
    setEditingTemplate(tpl)
    setName(tpl.name || '')
    setCategory(meta.category || 'Gia tiên')
    setImageUrl(meta.image_url || '')
    setImageStats(null)
    setNote(meta.cleanNote || '')
    const existingLines = (tpl.items || []).map((ti) => ({
      item_id: String(ti.item_id),
      qty: Number(ti.qty),
    }))
    setLines(existingLines.length > 0 ? existingLines : [{ item_id: '', qty: 1 }])
    setModalOpen(true)
  }

  const handleImageFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageCompressing(true)
    setError('')
    try {
      const res = await compressImageUnder1MB(file)
      setImageUrl(res.dataUrl)
      setImageStats(res)
    } catch (err) {
      setError(err.message || 'Lỗi khi xử lý hình ảnh mẫu set')
    } finally {
      setImageCompressing(false)
      e.target.value = ''
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (lines.some((l) => Number(l.qty) < 0)) {
      setError('Số lượng vật tư không được là số âm. Vui lòng kiểm tra lại.')
      return
    }

    // Gộp các dòng trùng item_id; chặn lưu nếu không còn dòng hợp lệ (tránh xóa sạch mẫu)
    const mergedMap = new Map()
    for (const l of lines) {
      if (!l.item_id || Number(l.qty) <= 0) continue
      const idNum = Number(l.item_id)
      mergedMap.set(idNum, (mergedMap.get(idNum) || 0) + Number(l.qty))
    }
    if (mergedMap.size === 0) {
      setError('Mẫu set phải có ít nhất 1 vật tư với số lượng lớn hơn 0.')
      return
    }

    setSaving(true)
    try {
      let templateId = editingTemplate?.id
      const cleanNote = note.trim()

      const payloadWithCols = {
        name: name.trim(),
        category: category || 'Gia tiên',
        image_url: imageUrl || null,
        note: cleanNote || null,
      }

      const payloadFallback = {
        name: name.trim(),
        note: packTemplateNoteFallback(category, imageUrl, cleanNote),
      }

      const saveHeader = async (pl) => {
        if (editingTemplate) {
          return supabase.from('set_templates').update(pl).eq('id', templateId)
        }
        return supabase.from('set_templates').insert([pl]).select('id').single()
      }

      let res = await saveHeader(payloadWithCols)
      if (
        res.error &&
        (String(res.error.message || '').toLowerCase().includes('category') ||
          String(res.error.message || '').toLowerCase().includes('image_url'))
      ) {
        res = await saveHeader(payloadFallback)
      }
      if (res.error) throw res.error
      if (!editingTemplate && res.data?.id) {
        templateId = res.data.id
      }

      const itemRows = Array.from(mergedMap.entries()).map(([item_id, qty]) => ({
        template_id: templateId,
        item_id,
        qty,
      }))

      // 1) Ghi/ cập nhật các dòng còn lại TRƯỚC (không xóa gì trước khi ghi thành công)
      const { error: itemErr } = await supabase
        .from('set_template_items')
        .upsert(itemRows, { onConflict: 'template_id,item_id' })
      if (itemErr) {
        if (!editingTemplate && templateId) {
          // Mẫu mới tạo dở: dọn phần đầu mẫu (nếu RLS cho phép) để không để mẫu rỗng
          await supabase.from('set_templates').delete().eq('id', templateId)
        }
        throw itemErr
      }

      // 2) Xóa đúng các vật tư bị bỏ khỏi mẫu
      const keep = new Set(mergedMap.keys())
      const removed = (editingTemplate?.items || [])
        .map((ti) => Number(ti.item_id))
        .filter((id) => !keep.has(id))
      if (removed.length > 0) {
        const { data: deleted, error: delErr } = await supabase
          .from('set_template_items')
          .delete()
          .eq('template_id', templateId)
          .in('item_id', removed)
          .select('item_id')
        if (delErr) throw delErr
        if ((deleted || []).length < removed.length) {
          await loadData()
          setError(
            `Đã lưu các thay đổi khác, nhưng chưa bỏ được ${removed.length - (deleted || []).length}/${removed.length} vật tư khỏi mẫu: chỉ admin/quản lý được bỏ vật tư khỏi mẫu. Hãy nhờ admin/quản lý xóa, hoặc thêm lại vật tư đó vào mẫu.`
          )
          return
        }
      }

      setModalOpen(false)
      setSuccess('Đã lưu mẫu set trang trí thành công!')
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
      const { data: deleted, error: err } = await supabase
        .from('set_templates')
        .delete()
        .eq('id', tpl.id)
        .select('id')
      if (err) throw err
      if (!deleted || deleted.length === 0) {
        setError('Không xóa được mẫu set: bạn không có quyền xóa (chỉ admin/quản lý) hoặc mẫu không còn tồn tại.')
        return
      }
      await loadData()
    } catch (err) {
      setError(err.message || 'Không thể xóa mẫu set')
    }
  }

  const handleExport = () => {
    const rows = []
    for (const tpl of filteredTemplates) {
      if (!tpl.items || tpl.items.length === 0) {
        rows.push({
          'Phân loại set': tpl.parsedCategory,
          'Tên mẫu set': tpl.name,
          'Ghi chú set': tpl.parsedNote || '',
          'Mã vật tư': '',
          'Tên vật tư': '',
          'Phân loại vật tư': '',
          'Số lượng': 0,
          'ĐVT': '',
        })
      } else {
        for (const ti of tpl.items) {
          rows.push({
            'Phân loại set': tpl.parsedCategory,
            'Tên mẫu set': tpl.name,
            'Ghi chú set': tpl.parsedNote || '',
            'Mã vật tư': ti.item?.code || '',
            'Tên vật tư': ti.item?.name || `#${ti.item_id}`,
            'Phân loại vật tư': KIND_LABELS[ti.item?.kind] || '',
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
            Quản lý các mẫu set Gia tiên & Mâm quả kèm hình ảnh mẫu thực tế để áp dụng nhanh vào Kế
            hoạch dự án
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

      {/* Bộ lọc Phân loại Set: Gia tiên / Mâm quả */}
      <div className="card filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-group" style={{ alignItems: 'center' }}>
          <span className="text-sm font-bold" style={{ color: '#475569' }}>
            Phân loại mẫu set:
          </span>
          <button
            type="button"
            className={`btn btn-sm ${filterCategory === 'all' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilterCategory('all')}
          >
            Tất cả ({enrichedTemplates.length})
          </button>
          {SET_CATEGORY_OPTIONS.map((opt) => {
            const count = enrichedTemplates.filter((t) => t.parsedCategory === opt.value).length
            return (
              <button
                key={opt.value}
                type="button"
                className={`btn btn-sm ${
                  filterCategory === opt.value ? 'btn-primary' : 'btn-outline'
                }`}
                onClick={() => setFilterCategory(opt.value)}
              >
                {opt.label} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Đang tải danh sách mẫu set...</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card empty-state">
          Chưa có mẫu set trang trí nào trong mục này. Hãy bấm &ldquo;+ Tạo mẫu set mới&rdquo; để
          thêm mẫu Gia tiên hoặc Mâm quả.
        </div>
      ) : (
        <div className="templates-grid">
          {filteredTemplates.map((tpl) => (
            <div key={tpl.id} className="card">
              <div
                className="card-header"
                style={{ alignItems: 'flex-start', gap: 14, marginBottom: 12 }}
              >
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1 }}>
                  {tpl.parsedImageUrl ? (
                    <img
                      src={tpl.parsedImageUrl}
                      alt={tpl.name}
                      title="Bấm để phóng to ảnh mẫu set"
                      onClick={() =>
                        setPreviewLightbox({
                          url: tpl.parsedImageUrl,
                          name: `${tpl.name} (${tpl.parsedCategory})`,
                        })
                      }
                      style={{
                        width: 76,
                        height: 76,
                        objectFit: 'cover',
                        borderRadius: 12,
                        border: '1px solid #cbd5e1',
                        cursor: 'zoom-in',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 76,
                        height: 76,
                        borderRadius: 12,
                        border: '1px dashed #cbd5e1',
                        background: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 24,
                        color: '#94a3b8',
                        flexShrink: 0,
                      }}
                    >
                      {tpl.parsedCategory === 'Mâm quả' ? '🎁' : '🏮'}
                    </div>
                  )}

                  <div>
                    <div style={{ marginBottom: 4 }}>
                      <span
                        className={`badge ${
                          tpl.parsedCategory === 'Mâm quả' ? 'badge-blue' : 'badge-green'
                        }`}
                      >
                        {tpl.parsedCategory === 'Mâm quả' ? '🎁 Mâm quả' : '🏮 Gia tiên'}
                      </span>
                    </div>
                    <h3 style={{ margin: 0 }}>{tpl.name}</h3>
                    {tpl.parsedNote && (
                      <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                        {tpl.parsedNote}
                      </p>
                    )}
                  </div>
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
                        style={{ color: '#dc2626', borderColor: '#fecaca' }}
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
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Phân loại mẫu set *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {SET_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Tên mẫu set *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Set Gia Tiên Đỏ Rượu Truyền Thống / Set 6 Mâm Quả Rồng Phượng"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>
                  Hình ảnh mẫu set (nhận mọi kích thước, tự động thu nhỏ & nén dưới 1MB)
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 12,
                    border: '1px dashed #cbd5e1',
                    borderRadius: 10,
                    background: '#f8fafc',
                    flexWrap: 'wrap',
                  }}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="Xem trước mẫu set"
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        background: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 26,
                        color: '#94a3b8',
                      }}
                    >
                      📷
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <label
                        className="btn btn-outline btn-sm"
                        style={{ cursor: 'pointer', margin: 0 }}
                      >
                        {imageCompressing
                          ? '⏳ Đang nén ảnh...'
                          : imageUrl
                            ? '📷 Đổi ảnh mẫu khác'
                            : '📷 Chọn ảnh mẫu set / Chụp ảnh'}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageFileSelect}
                          disabled={imageCompressing}
                          style={{ display: 'none' }}
                        />
                      </label>
                      {imageUrl && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ color: '#dc2626', borderColor: '#fecaca' }}
                          onClick={() => {
                            setImageUrl('')
                            setImageStats(null)
                          }}
                        >
                          Xóa ảnh
                        </button>
                      )}
                    </div>
                    {imageStats ? (
                      <div className="text-xs text-green" style={{ marginTop: 6 }}>
                        ✓ Đã tự động thu nhỏ từ{' '}
                        <strong>{formatBytes(imageStats.originalSize)}</strong> →{' '}
                        <strong>{formatBytes(imageStats.compressedSize)}</strong> (
                        {imageStats.width}×{imageStats.height}px)
                      </div>
                    ) : (
                      <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                        Tải lên ảnh mẫu Gia tiên / Mâm quả dung lượng bất kỳ, hệ thống tự nén gọn
                        dưới 1MB (~100KB).
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Mô tả / Ghi chú</label>
                <textarea
                  rows={2}
                  placeholder="Kích thước phông, tông màu, lưu ý khi lắp đặt..."
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
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || imageCompressing}
                >
                  {saving ? 'Đang lưu...' : 'Lưu mẫu set'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox phóng to ảnh mẫu set */}
      {previewLightbox && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewLightbox(null)}
          style={{ zIndex: 100 }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 680, textAlign: 'center' }}
          >
            <div className="modal-header">
              <h3>{previewLightbox.name}</h3>
              <button className="btn-icon" onClick={() => setPreviewLightbox(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <img
                src={previewLightbox.url}
                alt={previewLightbox.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '72vh',
                  borderRadius: 12,
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
