import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, todayISO } from '../lib/formatters'
import {
  WATERMARK_POSITIONS,
  FB_POST_STATUS,
  getProjectFbData,
  saveProjectFbData,
  attachFbMetaToNote,
  calcProjectFbReminder,
  generateFacebookCaption,
  applyDangWeddingWatermark,
  downloadDataUrlImage,
} from '../lib/watermarkHelper'

export default function ProjectFacebookTab({ project, templates = [], onProjectUpdated }) {
  const [status, setStatus] = useState('unposted')
  const [fbUrl, setFbUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [postedAt, setPostedAt] = useState('')
  const [watermarkPos, setWatermarkPos] = useState('bottom-right')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.9)
  const [images, setImages] = useState([]) // [{ id, watermarkedUrl, rawUrl, width, height }]
  const [processingImg, setProcessingImg] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [msg, setMsg] = useState('')
  const [previewImg, setPreviewImg] = useState(null)

  useEffect(() => {
    if (!project?.id) return
    const data = getProjectFbData(project)
    setStatus(data.status || 'unposted')
    setFbUrl(data.fbUrl || '')
    setCaption(
      data.caption || generateFacebookCaption(project, 'luxury')
    )
    setPostedAt(data.postedAt || '')
    setWatermarkPos(data.watermarkPos || 'bottom-right')
    setWatermarkOpacity(data.watermarkOpacity ?? 0.9)
    setImages(Array.isArray(data.images) ? data.images : [])
  }, [project])

  const reminder = calcProjectFbReminder({
    ...project,
    note: attachFbMetaToNote(project?.note, { status, fbUrl, postedAt }),
  })

  const persistLocal = (nextOverrides = {}) => {
    const payload = {
      status,
      fbUrl,
      caption,
      postedAt,
      watermarkPos,
      watermarkOpacity,
      images,
      ...nextOverrides,
    }
    saveProjectFbData(project?.id, payload)
  }

  // Tải lên 1 hoặc nhiều ảnh -> Tự động gắn Watermark Đặng Wedding
  const handleUploadFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setProcessingImg(true)
    setMsg('')
    try {
      const added = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        // Lưu 1 bản ảnh gốc đã thu nhỏ nhẹ để có thể đổi vị trí watermark khi cần
        const wmRes = await applyDangWeddingWatermark(file, {
          position: watermarkPos,
          opacity: watermarkOpacity,
          projectText: project?.code || 'Trang Trí Gia Tiên & Mâm Quả',
        })
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          watermarkedUrl: wmRes.dataUrl,
          width: wmRes.width,
          height: wmRes.height,
        })
      }
      const nextImages = [...images, ...added]
      const nextStatus = status === 'unposted' ? 'draft' : status
      setImages(nextImages)
      setStatus(nextStatus)
      persistLocal({ images: nextImages, status: nextStatus })
      setMsg(`✓ Đã tự động gắn Watermark "Đặng Wedding" và nén gọn ${added.length} ảnh!`)
    } catch (err) {
      alert(err.message || 'Lỗi khi ghép Watermark vào ảnh')
    } finally {
      setProcessingImg(false)
      e.target.value = ''
    }
  }

  const handleRemoveImage = (imgId) => {
    const next = images.filter((i) => i.id !== imgId)
    setImages(next)
    persistLocal({ images: next })
  }

  const handleDownloadSingle = (img, idx) => {
    const code = project?.code || `du-an-${project?.id}`
    downloadDataUrlImage(
      img.watermarkedUrl,
      `dang-wedding-${code}-anh-${idx + 1}.jpg`
    )
  }

  const handleDownloadAll = () => {
    const code = project?.code || `du-an-${project?.id}`
    images.forEach((img, idx) => {
      setTimeout(() => {
        downloadDataUrlImage(
          img.watermarkedUrl,
          `dang-wedding-${code}-anh-${idx + 1}.jpg`
        )
      }, idx * 250)
    })
  }

  const handleGenerateCaption = (style) => {
    const setNames = templates.slice(0, 2).map((t) => t.name)
    const text = generateFacebookCaption(project, style, setNames)
    setCaption(text)
    persistLocal({ caption: text })
  }

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption)
      setMsg('✓ Đã copy nội dung bài viết Facebook vào bộ nhớ tạm! Bạn có thể dán thẳng lên Fanpage.')
    } catch {
      alert('Vui lòng bôi đen và nhấn Ctrl+C để copy bài viết.')
    }
  }

  const handleSaveStatusToCloud = async (newStatus = status) => {
    setSavingMeta(true)
    setMsg('')
    try {
      const nextPostedAt =
        newStatus === 'posted' ? postedAt || todayISO() : postedAt
      setStatus(newStatus)
      setPostedAt(nextPostedAt)
      persistLocal({ status: newStatus, postedAt: nextPostedAt })

      const updatedNote = attachFbMetaToNote(project?.note || '', {
        status: newStatus,
        fbUrl,
        postedAt: nextPostedAt,
      })

      await supabase
        .from('projects')
        .update({ note: updatedNote })
        .eq('id', project.id)

      if (onProjectUpdated) onProjectUpdated()
      setMsg(
        newStatus === 'posted'
          ? '🎉 Đã đánh dấu dự án ĐÃ ĐĂNG LÊN FACEBOOK (tắt cảnh báo nhắc 5 ngày)!'
          : '✓ Đã lưu thông tin bài đăng Facebook của dự án!'
      )
    } catch {
      setMsg('✓ Đã lưu trạng thái bài đăng Facebook trên trình duyệt!')
    } finally {
      setSavingMeta(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cảnh báo nhắc đăng bài nếu quá 5 ngày */}
      {reminder.isOverdue5Days && status !== 'posted' && (
        <div
          className="alert alert-error"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <strong>🔔 NHẮC ĐĂNG BÀI FACEBOOK (ĐÃ QUÁ {reminder.daysPassed} NGÀY):</strong> Dự án{' '}
            <strong>{project?.name}</strong> (mốc ngày {formatDate(reminder.refDateStr)}) đã quá 5
            ngày nhưng chưa được đánh dấu đăng lên Fanpage Đặng Wedding!
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => handleSaveStatusToCloud('posted')}
          >
            ✅ Đánh dấu Đã đăng Fanpage
          </button>
        </div>
      )}

      {msg && <div className="alert alert-success">{msg}</div>}

      {/* PHẦN 1: TẢI ẢNH LÊN & TỰ ĐỘNG ĐÓNG DẤU WATERMARK ĐẶNG WEDDING */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h3>1. Hình ảnh đăng Facebook & Tự động ghép Watermark &ldquo;Đặng Wedding&rdquo;</h3>
            <p className="text-xs text-muted">
              Tải ảnh nghiệm thu tiệc cưới lên (nhận mọi kích thước) → Hệ thống tự động đóng dấu
              Watermark Logo <strong>Đặng Wedding</strong> & nén gọn dưới 1MB để tải về đăng Fanpage
            </p>
          </div>
          {images.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDownloadAll}
            >
              📥 Tải tất cả {images.length} ảnh có Watermark
            </button>
          )}
        </div>

        {/* Tùy chọn vị trí Watermark & Nút tải ảnh */}
        <div
          className="sub-card"
          style={{
            marginTop: 10,
            marginBottom: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            alignItems: 'end',
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label>Vị trí đóng dấu Watermark Logo Đặng Wedding</label>
            <select
              value={watermarkPos}
              onChange={(e) => {
                setWatermarkPos(e.target.value)
                persistLocal({ watermarkPos: e.target.value })
              }}
            >
              {WATERMARK_POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Độ rõ của Watermark ({Math.round(watermarkOpacity * 100)}%)</label>
            <input
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              value={watermarkOpacity}
              onChange={(e) => {
                const val = Number(e.target.value)
                setWatermarkOpacity(val)
                persistLocal({ watermarkOpacity: val })
              }}
            />
          </div>

          <div>
            <label
              className="btn btn-primary btn-block"
              style={{ cursor: 'pointer', margin: 0, textAlign: 'center' }}
            >
              {processingImg
                ? '⏳ Đang ghép Watermark Đặng Wedding...'
                : '📷 Chọn ảnh tiệc cưới để ghép Watermark (Chọn nhiều ảnh)'}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={processingImg}
                onChange={handleUploadFiles}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        {/* Danh sách ảnh đã gắn Watermark */}
        {images.length === 0 ? (
          <div className="empty-state">
            Chưa có ảnh nào cho bài đăng Facebook của dự án này. Hãy bấm{' '}
            <strong>&ldquo;📷 Chọn ảnh tiệc cưới để ghép Watermark&rdquo;</strong> ở trên!
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 14,
            }}
          >
            {images.map((img, idx) => (
              <div
                key={img.id}
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    height: 185,
                    background: '#0f172a',
                    cursor: 'zoom-in',
                  }}
                  onClick={() =>
                    setPreviewImg({
                      url: img.watermarkedUrl,
                      name: `Ảnh #${idx + 1} (Đã gắn Watermark Đặng Wedding)`,
                    })
                  }
                >
                  <img
                    src={img.watermarkedUrl}
                    alt={`Ảnh ${idx + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                  <span
                    className="badge badge-green"
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                    }}
                  >
                    ✓ Đã gắn Logo
                  </span>
                </div>
                <div
                  style={{
                    padding: 10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => handleDownloadSingle(img, idx)}
                  >
                    📥 Tải ảnh về đăng
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ color: '#dc2626', borderColor: '#fecaca' }}
                    onClick={() => handleRemoveImage(img.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PHẦN 2: SOẠN NỘI DUNG BÀI ĐĂNG FACEBOOK & ĐÁNH DẤU ĐÃ ĐĂNG */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div>
            <h3>2. Nội dung bài viết (Caption) Facebook & Trạng thái đăng Fanpage</h3>
            <p className="text-xs text-muted">
              Bấm chọn phong cách viết bài tự động, chỉnh sửa theo ý muốn rồi bấm Copy để dán lên
              Fanpage Đặng Wedding
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => handleGenerateCaption('luxury')}
            >
              ✨ Mẫu 1: Sang trọng
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => handleGenerateCaption('warm')}
            >
              💞 Mẫu 2: Ấm cúng
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => handleGenerateCaption('short')}
            >
              ⚡ Mẫu 3: Ngắn gọn
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleCopyCaption}
            >
              📋 Copy bài viết
            </button>
          </div>
        </div>

        <div className="form-group">
          <textarea
            rows={9}
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value)
              persistLocal({ caption: e.target.value })
            }}
            placeholder="Nội dung bài đăng Facebook..."
            style={{ fontFamily: 'inherit', lineHeight: 1.55 }}
          />
        </div>

        <div
          className="sub-card"
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
            alignItems: 'end',
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label>Trạng thái đăng bài Facebook</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                persistLocal({ status: e.target.value })
              }}
            >
              {Object.entries(FB_POST_STATUS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Link bài viết đã đăng trên Fanpage (tùy chọn)</label>
            <input
              type="url"
              placeholder="https://www.facebook.com/..."
              value={fbUrl}
              onChange={(e) => {
                setFbUrl(e.target.value)
                persistLocal({ fbUrl: e.target.value })
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-outline"
              style={{ flex: 1 }}
              disabled={savingMeta}
              onClick={() => handleSaveStatusToCloud(status)}
            >
              Lưu trạng thái
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={savingMeta}
              onClick={() => handleSaveStatusToCloud('posted')}
            >
              ✅ Đã đăng Fanpage
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox xem ảnh phóng to */}
      {previewImg && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewImg(null)}
          style={{ zIndex: 100 }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 820, textAlign: 'center' }}
          >
            <div className="modal-header">
              <h3>{previewImg.name}</h3>
              <button className="btn-icon" onClick={() => setPreviewImg(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <img
                src={previewImg.url}
                alt={previewImg.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '76vh',
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
