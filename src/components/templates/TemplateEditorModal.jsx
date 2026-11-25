import { useMemo, useState } from 'react'
import { KIND_LABELS } from '../../lib/formatters'
import { buildEditorImages } from '../../lib/setTemplateImages'
import {
  MAX_CATEGORY_LENGTH,
  NEW_CATEGORY,
  canonicalCategory,
  categoryIcon,
  parseTemplateMeta,
  resolveCategoryChoice,
} from '../../lib/setTemplateMeta'
import TemplateDescriptionField from './TemplateDescriptionField'
import TemplateImageManager from './TemplateImageManager'
import TemplateModal from './TemplateModal'
import './Templates.css'

/**
 * Hộp thoại tạo/sửa mẫu set. Chỉ admin/manager/storekeeper mở được (canEditCatalog).
 * onSave(payload) trả Promise; ném lỗi thì hiện ngay trong hộp thoại.
 */
export default function TemplateEditorModal({
  template,
  items,
  categoryOptions,
  defaultCategory,
  imagesSupported,
  descriptionSupported,
  canDelete,
  onSave,
  onDelete,
  onClose,
  onPreview,
}) {
  const meta = useMemo(() => parseTemplateMeta(template), [template])
  const [catChoice, setCatChoice] = useState(() =>
    canonicalCategory(template ? meta.category : defaultCategory || 'Gia tiên', categoryOptions)
  )
  const [newCat, setNewCat] = useState('')
  const [name, setName] = useState(template?.name || '')
  const [images, setImages] = useState(() =>
    imagesSupported
      ? buildEditorImages(
          { image_url: meta.image_url },
          template?.images || []
        )
      : meta.image_url
        ? [{ key: 'legacy', kind: 'legacy', url: meta.image_url }]
        : []
  )
  const [description, setDescription] = useState(template?.description || '')
  const [note, setNote] = useState(meta.cleanNote || '')
  const [lines, setLines] = useState(() => {
    const existing = (template?.items || []).map((ti) => ({
      item_id: String(ti.item_id),
      qty: Number(ti.qty),
    }))
    return existing.length > 0 ? existing : [{ item_id: '', qty: 1 }]
  })
  const [saving, setSaving] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [error, setError] = useState('')
  // Không cho đóng khi đang lưu (Escape, ✕, Hủy) để không mất kết quả lưu
  const requestClose = () => {
    if (!saving) onClose()
  }

  const resolved = resolveCategoryChoice(catChoice, newCat, categoryOptions)
  const itemNames = lines
    .map((line) => items.find((i) => String(i.id) === String(line.item_id))?.name)
    .filter(Boolean)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (imageBusy) {
      setError('Đang nén ảnh, vui lòng chờ xong rồi lưu.')
      return
    }
    if (resolved.error) {
      setError(resolved.error)
      return
    }
    if (lines.some((l) => Number(l.qty) < 0)) {
      setError('Số lượng vật tư không được là số âm. Vui lòng kiểm tra lại.')
      return
    }
    // Gộp các dòng trùng item_id; chặn lưu nếu không còn dòng hợp lệ (tránh xóa sạch mẫu)
    const merged = new Map()
    for (const l of lines) {
      if (!l.item_id || Number(l.qty) <= 0) continue
      const id = Number(l.item_id)
      merged.set(id, (merged.get(id) || 0) + Number(l.qty))
    }
    if (merged.size === 0) {
      setError('Mẫu set phải có ít nhất 1 vật tư với số lượng lớn hơn 0.')
      return
    }

    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        category: resolved.category,
        note: note.trim(),
        description: description.trim(),
        lines: [...merged.entries()],
        images: { multi: imagesSupported, list: images },
      })
    } catch (err) {
      setError(err.message || 'Lỗi khi lưu mẫu set')
    } finally {
      setSaving(false)
    }
  }

  const setLine = (idx, patch) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  return (
    <TemplateModal
      title={template ? 'Cập nhật mẫu set' : 'Tạo mẫu set trang trí mới'}
      onClose={requestClose}
      onSubmit={handleSubmit}
      closeOnBackdrop={false}
      wide
      footer={
        <>
          {template && canDelete && (
            <button
              type="button"
              className="ui-btn ui-btn--ghost tpl-danger-text tpl-delete-btn"
              disabled={saving}
              onClick={() => onDelete(template)}
            >
              Xóa mẫu này
            </button>
          )}
          <button type="button" className="ui-btn ui-btn--secondary" disabled={saving} onClick={requestClose}>
            Hủy
          </button>
          <button type="submit" className={`ui-btn ui-btn--primary${saving ? ' is-loading' : ''}`}
            disabled={saving || imageBusy}
          >
            Lưu mẫu set
          </button>
        </>
      }
    >
      <div className="ui-stack">
        {error && <div className="ui-alert ui-alert--danger">{error}</div>}

        <div className="ui-form-grid ui-form-grid--2">
          <div className="ui-field">
            <label htmlFor="tpl-category">
              Loại set<span className="ui-required">*</span>
            </label>
            <select
              id="tpl-category"
              className="ui-select"
              value={catChoice}
              onChange={(event) => setCatChoice(event.target.value)}
            >
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {categoryIcon(option)} {option}
                </option>
              ))}
              <option value={NEW_CATEGORY}>+ Thêm loại mới</option>
            </select>
            {catChoice === NEW_CATEGORY && (
              <>
                <input
                  type="text"
                  className="ui-input"
                  placeholder="Tên loại mới, VD: Cổng hoa"
                  maxLength={MAX_CATEGORY_LENGTH}
                  value={newCat}
                  onChange={(event) => setNewCat(event.target.value)}
                  autoFocus
                />
                {resolved.duplicateOf && (
                  <span className="ui-hint">Loại này đã có, sẽ dùng &ldquo;{resolved.duplicateOf}&rdquo;.</span>
                )}
              </>
            )}
          </div>

          <div className="ui-field">
            <label htmlFor="tpl-name">
              Tên mẫu set<span className="ui-required">*</span>
            </label>
            <input
              id="tpl-name"
              type="text"
              className="ui-input"
              required
              placeholder="VD: Set Gia Tiên Đỏ Rượu Truyền Thống"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>

        <TemplateImageManager
          images={images}
          onChange={setImages}
          multi={imagesSupported}
          onPreview={onPreview}
          onError={setError}
          onBusyChange={setImageBusy}
        />

        {descriptionSupported !== false && (
          <TemplateDescriptionField
            value={description}
            onChange={setDescription}
            name={name}
            category={resolved.category}
            itemNames={itemNames}
          />
        )}

        <div className="ui-field">
          <label htmlFor="tpl-note">Ghi chú hiện trên báo giá và website (khách có thể thấy)</label>
          <textarea
            id="tpl-note"
            className="ui-textarea"
            rows={2}
            placeholder="Kích thước phông, tông màu, lưu ý cho khách..."
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <span className="ui-hint">
            Khách có thể thấy ghi chú này trên báo giá và website. Không ghi số lượng vật tư, giá vốn hay giá.
          </span>
        </div>

        <div className="ui-field">
          <span className="ui-label">Vật tư trong mẫu set</span>
          <div className="tpl-lines">
            {lines.map((line, idx) => (
              <div key={idx} className="tpl-line">
                <select
                  className="ui-select"
                  required
                  aria-label="Vật tư"
                  value={line.item_id}
                  onChange={(event) => setLine(idx, { item_id: event.target.value })}
                >
                  <option value="">-- Chọn vật tư --</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code ? `[${i.code}] ` : ''}
                      {i.name} ({KIND_LABELS[i.kind]} - {i.unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="ui-input"
                  aria-label="Số lượng"
                  min="0.01"
                  step="any"
                  required
                  value={line.qty}
                  onChange={(event) => setLine(idx, { qty: event.target.value })}
                />
                {lines.length > 1 ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost ui-btn--icon"
                    aria-label="Bỏ dòng vật tư"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          <div>
            <button
              type="button"
              className="ui-btn ui-btn--secondary ui-btn--sm"
              onClick={() => setLines((prev) => [...prev, { item_id: '', qty: 1 }])}
            >
              + Thêm dòng vật tư
            </button>
          </div>
        </div>
      </div>
    </TemplateModal>
  )
}
