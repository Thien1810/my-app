import { useEffect, useState } from 'react'
import { compressImageUnder1MB, formatBytes } from '../../lib/imageCompressor'
import {
  MAX_TEMPLATE_IMAGES,
  dataUrlToBlob,
  moveEditorImage,
  normalizeEditorImages,
  setEditorCover,
} from '../../lib/setTemplateImages'
import './Templates.css'

/**
 * Quản lý ảnh trong form sửa mẫu set. images: danh sách theo thứ tự, phần tử đầu là ảnh bìa.
 * multi=false (DB chưa có bảng ảnh): chỉ 1 ảnh, lưu dạng cũ vào image_url.
 */
export default function TemplateImageManager({ images, onChange, multi, onPreview, onError, onBusyChange }) {
  const [busy, setBusy] = useState(null) // { done, total }
  const [stats, setStats] = useState(null)

  useEffect(() => {
    onBusyChange?.(Boolean(busy))
  }, [busy, onBusyChange])

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    onError('')

    const room = multi ? MAX_TEMPLATE_IMAGES - images.length : 1
    if (room <= 0) {
      onError(`Mỗi mẫu tối đa ${MAX_TEMPLATE_IMAGES} ảnh. Hãy xóa bớt ảnh trước khi thêm.`)
      return
    }
    const picked = files.slice(0, room)
    if (files.length > picked.length) {
      onError(`Chỉ thêm được ${picked.length} ảnh (tối đa ${MAX_TEMPLATE_IMAGES} ảnh mỗi mẫu).`)
    }

    setBusy({ done: 0, total: picked.length })
    for (let i = 0; i < picked.length; i += 1) {
      try {
        const res = await compressImageUnder1MB(picked[i])
        if (multi) {
          const added = {
            key: `new-${Date.now()}-${i}`,
            kind: 'new',
            url: res.dataUrl,
            blob: dataUrlToBlob(res.dataUrl),
            size: res.compressedSize,
          }
          // Dùng updater để luôn cộng vào danh sách mới nhất (người dùng có thể xóa/đổi thứ tự khi đang nén)
          onChange((prev) =>
            prev.length >= MAX_TEMPLATE_IMAGES ? prev : normalizeEditorImages([...prev, added])
          )
        } else {
          onChange(() => [{ key: 'legacy', kind: 'legacy', url: res.dataUrl, size: res.compressedSize }])
        }
        setStats(res)
      } catch (err) {
        onError(err.message || 'Lỗi khi xử lý hình ảnh mẫu set')
      }
      setBusy({ done: i + 1, total: picked.length })
    }
    setBusy(null)
  }

  const labelOf = (index) => {
    if (index === 0) return 'Ảnh bìa'
    return `Ảnh ${index + 1}`
  }
  const noteOf = (image) => {
    if (image.kind === 'legacy') return 'Ảnh cũ của mẫu'
    if (image.kind === 'new') return `Mới, chưa lưu${image.size ? ` · ${formatBytes(image.size)}` : ''}`
    return ''
  }

  return (
    <div className="ui-field">
      <span className="ui-label">
        {multi ? `Ảnh mẫu set (tối đa ${MAX_TEMPLATE_IMAGES} ảnh, ảnh đầu là ảnh bìa)` : 'Hình ảnh mẫu set'}
      </span>

      {images.length > 0 && (
        <div className="tpl-imgs">
          {images.map((image, index) => (
            <div key={image.key} className="tpl-img-row">
              <button
                type="button"
                className="tpl-img-row__thumb"
                aria-label="Phóng to ảnh"
                onClick={() => onPreview?.(images.map((i) => i.url), index)}
              >
                <img src={image.url} alt="" />
              </button>
              <div className="tpl-img-row__meta">
                <span className={`ui-badge ${index === 0 ? 'ui-badge--success' : 'ui-badge--neutral'}`}>
                  {labelOf(index)}
                </span>
                {noteOf(image) && <span className="ui-hint">{noteOf(image)}</span>}
              </div>
              <div className="tpl-img-row__actions">
                {multi && (
                  <>
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary ui-btn--sm ui-btn--icon"
                      aria-label="Đưa ảnh lên trước"
                      disabled={index === 0}
                      onClick={() => onChange((prev) => moveEditorImage(prev, index, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary ui-btn--sm ui-btn--icon"
                      aria-label="Đưa ảnh xuống sau"
                      disabled={index === images.length - 1}
                      onClick={() => onChange((prev) => moveEditorImage(prev, index, 1))}
                    >
                      ↓
                    </button>
                    {index > 0 && (
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        onClick={() => onChange((prev) => setEditorCover(prev, index))}
                      >
                        ★ Đặt làm bìa
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="ui-btn ui-btn--ghost ui-btn--sm tpl-danger-text"
                  onClick={() => {
                    if (
                      image.kind !== 'new' &&
                      !window.confirm('Xóa ảnh này khỏi mẫu? Ảnh sẽ bị xóa hẳn khi bấm "Lưu mẫu set".')
                    ) {
                      return
                    }
                    onChange((prev) => normalizeEditorImages(prev.filter((i) => i.key !== image.key)))
                  }}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className={`ui-btn ui-btn--secondary ui-btn--sm tpl-file-btn${busy ? ' is-busy' : ''}`}>
        {busy
          ? `Đang nén ảnh ${Math.min(busy.done + 1, busy.total)}/${busy.total}...`
          : multi
            ? '📷 Thêm ảnh / Chụp ảnh'
            : images.length > 0
              ? '📷 Đổi ảnh khác'
              : '📷 Chọn ảnh / Chụp ảnh'}
        <input
          type="file"
          accept="image/*"
          multiple={multi}
          disabled={Boolean(busy)}
          onChange={handleFiles}
          className="ui-sr-only"
        />
      </label>
      {stats ? (
        <span className="ui-hint">
          ✓ Ảnh vừa chọn đã thu nhỏ từ {formatBytes(stats.originalSize)} xuống {formatBytes(stats.compressedSize)} (
          {stats.width}×{stats.height}px).
        </span>
      ) : (
        <span className="ui-hint">Nhận mọi kích thước, tự thu nhỏ và nén dưới 1MB.</span>
      )}
      {!multi && (
        <div className="ui-alert ui-alert--warn">
          Chưa thể thêm nhiều ảnh: cần chạy <code>supabase/set_templates_v2.sql</code> trên Supabase. Hiện mỗi mẫu chỉ
          có 1 ảnh.
        </div>
      )}
    </div>
  )
}
