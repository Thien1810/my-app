import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, todayISO } from '../lib/formatters'
import {
  WATERMARK_COLORS,
  WATERMARK_POSITIONS,
  WATERMARK_SIZES,
  FB_POST_STATUS,
  getProjectFbData,
  saveProjectFbData,
  attachFbMetaToNote,
  calcProjectFbReminder,
  generateFacebookCaption,
  prepareBasePhotoDataUrl,
  applyDangWeddingWatermark,
  downloadDataUrlImage,
} from '../lib/watermarkHelper'
import { generateFacebookCaptionWithAi, getSavedGeminiKey } from '../lib/aiSeoWriter'
import AiLoadingBanner from './AiLoadingBanner'

export default function ProjectFacebookTab({ project, templates = [], onProjectUpdated }) {
  const [status, setStatus] = useState('unposted')
  const [fbUrl, setFbUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [postedAt, setPostedAt] = useState('')
  const [watermarkColor, setWatermarkColor] = useState('white') // 'white' | 'black'
  const [watermarkPos, setWatermarkPos] = useState('bottom-right')
  const [watermarkScale, setWatermarkScale] = useState(0.28)
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.92)
  const [images, setImages] = useState([]) // [{ id, name, baseDataUrl, watermarkedUrl, color, width, height }]
  const [processingImg, setProcessingImg] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [aiCaptionBusy, setAiCaptionBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const [msg, setMsg] = useState('')
  const [previewImg, setPreviewImg] = useState(null)

  useEffect(() => {
    if (!project?.id) return
    const data = getProjectFbData(project)
    setStatus(data.status || 'unposted')
    setFbUrl(data.fbUrl || '')
    setCaption(data.caption || generateFacebookCaption(project, 'luxury'))
    setPostedAt(data.postedAt || '')
    setWatermarkColor(data.watermarkColor || 'white')
    setWatermarkPos(data.watermarkPos || 'bottom-right')
    setWatermarkScale(data.watermarkScale ?? 0.28)
    setWatermarkOpacity(data.watermarkOpacity ?? 0.92)
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
      watermarkColor,
      watermarkPos,
      watermarkScale,
      watermarkOpacity,
      images,
      ...nextOverrides,
    }
    saveProjectFbData(project?.id, payload)
  }

  // Cập nhật lại Watermark trên toàn bộ ảnh đã tải lên khi đổi Màu (Trắng/Đen), Vị trí, Kích thước, Độ đậm
  const reRenderAllWatermarks = async ({
    nextColor = watermarkColor,
    nextPos = watermarkPos,
    nextScale = watermarkScale,
    nextOpacity = watermarkOpacity,
  } = {}) => {
    if (images.length === 0) return
    setProcessingImg(true)
    try {
      const updated = []
      for (const img of images) {
        const sourceUrl = img.baseDataUrl || img.watermarkedUrl
        const useColor = nextColor || img.color || 'white'
        const res = await applyDangWeddingWatermark(sourceUrl, {
          color: useColor,
          position: nextPos,
          scaleRatio: nextScale,
          opacity: nextOpacity,
        })
        updated.push({
          ...img,
          color: useColor,
          watermarkedUrl: res.dataUrl,
          width: res.width,
          height: res.height,
        })
      }
      setImages(updated)
      persistLocal({
        watermarkColor: nextColor,
        watermarkPos: nextPos,
        watermarkScale: nextScale,
        watermarkOpacity: nextOpacity,
        images: updated,
      })
    } catch {
      // ignore
    } finally {
      setProcessingImg(false)
    }
  }

  // Đổi màu Trắng <-> Đen cho riêng 1 tấm ảnh
  const handleToggleSingleImageColor = async (imgId) => {
    const target = images.find((i) => i.id === imgId)
    if (!target) return
    const nextColor = target.color === 'black' ? 'white' : 'black'
    const sourceUrl = target.baseDataUrl || target.watermarkedUrl
    try {
      const res = await applyDangWeddingWatermark(sourceUrl, {
        color: nextColor,
        position: watermarkPos,
        scaleRatio: watermarkScale,
        opacity: watermarkOpacity,
      })
      const nextImages = images.map((i) =>
        i.id === imgId
          ? { ...i, color: nextColor, watermarkedUrl: res.dataUrl }
          : i
      )
      setImages(nextImages)
      persistLocal({ images: nextImages })
    } catch (err) {
      alert(err.message || 'Không thể đổi màu watermark')
    }
  }

  // Tải lên 1 hoặc nhiều ảnh -> Tự động gắn Watermark Đặng Wedding (Trắng hoặc Đen)
  const handleUploadFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setProcessingImg(true)
    setMsg('')
    try {
      const added = []
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const baseRes = await prepareBasePhotoDataUrl(file)
        const wmRes = await applyDangWeddingWatermark(baseRes.baseDataUrl, {
          color: watermarkColor,
          position: watermarkPos,
          scaleRatio: watermarkScale,
          opacity: watermarkOpacity,
        })
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          baseDataUrl: baseRes.baseDataUrl,
          watermarkedUrl: wmRes.dataUrl,
          color: watermarkColor,
          width: wmRes.width,
          height: wmRes.height,
        })
      }
      const nextImages = [...images, ...added]
      const nextStatus = status === 'unposted' ? 'draft' : status
      setImages(nextImages)
      setStatus(nextStatus)
      persistLocal({ images: nextImages, status: nextStatus })
      setMsg(
        `✓ Đã tự động đóng dấu Watermark Đặng Wedding (${
          watermarkColor === 'black' ? 'Bản Đen' : 'Bản Trắng'
        }) cho ${added.length} ảnh!`
      )
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

  const handleAiGenerateFacebookCaption = async () => {
    setAiCaptionBusy(true)
    setAiErr('')
    setMsg('')
    try {
      const setNames = templates.slice(0, 3).map((t) => t.name).join(', ')
      const text = await generateFacebookCaptionWithAi({
        apiKey: getSavedGeminiKey(),
        fbContext: {
          projectName: project?.name || '',
          customerName: project?.customer?.name || '',
          setNames,
          tone: 'Sang trọng, tối giản, tinh tế, ấm áp',
        },
      })
      if (text) {
        setCaption(text)
        persistLocal({ caption: text })
        setMsg('✨ AI Studio đã viết xong bài đăng Facebook mới cho dự án này!')
      }
    } catch (err) {
      setAiErr(err.message)
    } finally {
      setAiCaptionBusy(false)
    }
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

      {/* PHẦN 1: TẢI ẢNH LÊN & TỰ ĐỘNG ĐÓNG DẤU WATERMARK ĐẶNG WEDDING (TRẮNG / ĐEN) */}
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
            <h3>1. Ghép Watermark Đặng Wedding (Bản Trắng / Bản Đen) & Tải ảnh đăng Facebook</h3>
            <p className="text-xs text-muted">
              Chọn mẫu <strong>Watermark Trắng</strong> hoặc <strong>Watermark Đen</strong> bên
              dưới. Có thể đổi màu Trắng ↔ Đen cho cả bộ ảnh hoặc đổi riêng cho từng ảnh!
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

        {/* Bộ chọn Watermark Trắng / Đen kèm hình minh họa trực quan */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 12,
            marginTop: 10,
            marginBottom: 14,
          }}
        >
          {WATERMARK_COLORS.map((wm) => {
            const isSelected = watermarkColor === wm.value
            const isWhite = wm.value === 'white'
            return (
              <div
                key={wm.value}
                onClick={() => {
                  setWatermarkColor(wm.value)
                  reRenderAllWatermarks({ nextColor: wm.value })
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: isSelected ? '2px solid #16a34a' : '1px solid #cbd5e1',
                  background: isSelected ? '#f0fdf4' : '#ffffff',
                }}
              >
                <div
                  style={{
                    width: 96,
                    height: 68,
                    borderRadius: 8,
                    background: isWhite ? '#1e293b' : '#f8fafc',
                    border: '1px solid #cbd5e1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 6,
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={wm.src}
                    alt={wm.label}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </div>
                <div>
                  <div className="font-bold text-sm" style={{ color: '#0f172a' }}>
                    {wm.label}
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 3 }}>
                    {isWhite
                      ? 'Chữ trắng nổi bật trên ảnh tối / nhiều màu'
                      : 'Chữ đen nổi bật trên ảnh sáng / phông trắng'}
                  </div>
                  {isSelected && (
                    <span
                      className="badge badge-green"
                      style={{ marginTop: 5, display: 'inline-block' }}
                    >
                      ✓ Đang chọn
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Tùy chọn vị trí, kích thước Watermark & Nút tải ảnh */}
        <div
          className="sub-card"
          style={{
            marginBottom: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            alignItems: 'end',
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label>Vị trí đặt Watermark</label>
            <select
              value={watermarkPos}
              onChange={(e) => {
                const val = e.target.value
                setWatermarkPos(val)
                reRenderAllWatermarks({ nextPos: val })
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
            <label>Kích thước Watermark</label>
            <select
              value={watermarkScale}
              onChange={(e) => {
                const val = Number(e.target.value)
                setWatermarkScale(val)
                reRenderAllWatermarks({ nextScale: val })
              }}
            >
              {WATERMARK_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Độ rõ ({Math.round(watermarkOpacity * 100)}%)</label>
            <input
              type="range"
              min="0.4"
              max="1"
              step="0.04"
              value={watermarkOpacity}
              onChange={(e) => {
                const val = Number(e.target.value)
                setWatermarkOpacity(val)
                reRenderAllWatermarks({ nextOpacity: val })
              }}
            />
          </div>

          <div>
            <label
              className="btn btn-primary btn-block"
              style={{ cursor: 'pointer', margin: 0, textAlign: 'center' }}
            >
              {processingImg
                ? '⏳ Đang ghép Watermark...'
                : '📷 Tải ảnh lên để ghép Watermark'}
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
            Chưa có ảnh nào. Hãy chọn mẫu <strong>Watermark Trắng</strong> hoặc{' '}
            <strong>Watermark Đen</strong> ở trên rồi bấm{' '}
            <strong>&ldquo;📷 Tải ảnh lên để ghép Watermark&rdquo;</strong>!
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
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
                    height: 195,
                    background: '#0f172a',
                    cursor: 'zoom-in',
                  }}
                  onClick={() =>
                    setPreviewImg({
                      url: img.watermarkedUrl,
                      name: `Ảnh #${idx + 1} (Watermark ${
                        img.color === 'black' ? 'Đen' : 'Trắng'
                      })`,
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
                    className="badge"
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      background: img.color === 'black' ? '#0f172a' : '#ffffff',
                      color: img.color === 'black' ? '#ffffff' : '#0f172a',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.28)',
                    }}
                  >
                    {img.color === 'black' ? '⚫ Logo Đen' : '⚪ Logo Trắng'}
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
                    className="btn btn-sm btn-outline"
                    title="Đổi màu Watermark Trắng / Đen cho riêng tấm ảnh này"
                    onClick={() => handleToggleSingleImageColor(img.id)}
                  >
                    {img.color === 'black' ? 'Đổi sang ⚪ Trắng' : 'Đổi sang ⚫ Đen'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => handleDownloadSingle(img, idx)}
                  >
                    📥 Tải về
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
              Có sẵn địa chỉ <strong>Đồng Nai - TP.HCM</strong> &{' '}
              <strong>SĐT/Zalo 0918.80.90.96</strong>. Bấm Copy để dán lên Fanpage Đặng Wedding
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={aiCaptionBusy}
              onClick={handleAiGenerateFacebookCaption}
            >
              {aiCaptionBusy ? '⏳ AI đang viết...' : '🤖 AI Viết bài Facebook'}
            </button>
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
          {aiErr && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              {aiErr}
            </div>
          )}
          <AiLoadingBanner
            active={aiCaptionBusy}
            label="AI Studio đang viết bài đăng Fanpage Facebook cho dự án này..."
            estimatedSeconds={8}
          />
          <textarea
            rows={10}
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
