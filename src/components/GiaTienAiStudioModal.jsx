import { useState } from 'react'
import {
  FLOWER_OPTIONS,
  RATIO_OPTIONS,
  STYLE_OPTIONS,
  TONE_OPTIONS,
  buildGiaTienPrompt,
  runGiaTienComfyWorkflow,
} from '../lib/giaTienComfy'
import { generateAiWeddingImage } from '../lib/aiSeoWriter'
import AiLoadingBanner from './AiLoadingBanner'

export default function GiaTienAiStudioModal({
  open,
  onClose,
  comfyUrl = 'http://127.0.0.1:8188',
  defaultRatio = '16:9',
  defaultExtra = '',
  onUseImage,
}) {
  const [engine, setEngine] = useState('comfyui') // 'comfyui' | 'cloud'
  const [ratio, setRatio] = useState(defaultRatio)
  const [tone, setTone] = useState('Đỏ truyền thống & Vàng đồng')
  const [style, setStyle] = useState('Truyền thống (Song Hỷ, Lư đồng)')
  const [flower, setFlower] = useState('Hoa Hồng & Lan Hồ Điệp')
  const [hasCouple, setHasCouple] = useState(false)
  const [couplePose, setCouplePose] = useState('dung')
  const [extra, setExtra] = useState(defaultExtra)
  const [referenceFile, setReferenceFile] = useState(null)
  const [referencePreview, setReferencePreview] = useState('')
  const [denoise, setDenoise] = useState(0.65)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resultUrl, setResultUrl] = useState('')

  if (!open) return null

  const handleSelectReference = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setReferenceFile(f)
    const reader = new FileReader()
    reader.onload = () => setReferencePreview(String(reader.result || ''))
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const handleGenerate = async () => {
    setBusy(true)
    setErr('')
    try {
      if (engine === 'comfyui') {
        const res = await runGiaTienComfyWorkflow({
          baseUrl: comfyUrl,
          ratio,
          tone,
          style,
          flower,
          hasCouple,
          couplePose,
          extra,
          referenceFile,
          denoise,
        })
        setResultUrl(res.dataUrl)
      } else {
        const prompt = buildGiaTienPrompt({
          tone,
          style,
          flower,
          hasCouple,
          couplePose,
          isImg2Img: false,
          extra,
        })
        const dataUrl = await generateAiWeddingImage({ prompt })
        setResultUrl(dataUrl)
      }
    } catch (e) {
      setErr(e.message || 'Không thể tạo ảnh')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmUse = () => {
    if (!resultUrl) return
    const altText = `Trang trí Gia tiên ${style} ${tone} - Đặng Wedding`
    onUseImage?.(resultUrl, altText)
    onClose?.()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-lg"
        style={{ maxWidth: 860 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>🎨 Studio Tạo ảnh Decor Gia Tiên AI (Flux.1 ComfyUI)</h3>
            <div className="text-xs text-muted">
              Tạo concept mới hoặc biến đổi trực tiếp từ ảnh mặt bằng nhà khách (Img2Img)
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
          {err && <div className="alert alert-error">{err}</div>}

          {/* Chọn Engine */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-xs font-bold">Nguồn tạo ảnh:</span>
            <button
              type="button"
              className={`btn btn-sm ${engine === 'comfyui' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setEngine('comfyui')}
            >
              🖥️ ComfyUI Flux.1 Local ({comfyUrl})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${engine === 'cloud' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setEngine('cloud')}
            >
              ☁️ AI Cloud dự phòng (khi không mở máy)
            </button>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Tỷ lệ ảnh đầu ra</label>
              <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                {RATIO_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Tone màu chủ đạo (chọn hoặc tự gõ)</label>
              <input
                type="text"
                list="giatien-tone-list"
                placeholder="VD: Xanh rêu & Vàng champagne..."
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
              <datalist id="giatien-tone-list">
                {TONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.label} />
                ))}
              </datalist>
            </div>

            <div className="form-group">
              <label>Phong cách decor (chọn hoặc tự gõ)</label>
              <input
                type="text"
                list="giatien-style-list"
                placeholder="VD: Tối giản sang trọng, Indochine..."
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              />
              <datalist id="giatien-style-list">
                {STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.label} />
                ))}
              </datalist>
            </div>

            <div className="form-group">
              <label>Loại hoa chính (chọn hoặc tự gõ)</label>
              <input
                type="text"
                list="giatien-flower-list"
                placeholder="VD: Hoa Tulip trắng, Hồng Juliet..."
                value={flower}
                onChange={(e) => setFlower(e.target.value)}
              />
              <datalist id="giatien-flower-list">
                {FLOWER_OPTIONS.map((f) => (
                  <option key={f.value} value={f.label} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Cô dâu chú rể */}
          <div
            className="sub-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={hasCouple}
                onChange={(e) => setHasCouple(e.target.checked)}
              />
              Có Cô dâu &amp; Chú rể (áo dài truyền thống) trong khung hình
            </label>

            {hasCouple && (
              <select
                value={couplePose}
                onChange={(e) => setCouplePose(e.target.value)}
                style={{ padding: '6px 10px', fontSize: 13.5 }}
              >
                <option value="dung">Dáng đứng trước phông Gia tiên</option>
                <option value="ngoi">Dáng ngồi bàn Gia tiên</option>
              </select>
            )}
          </div>

          {/* Ảnh mặt bằng khách (Img2Img) */}
          {engine === 'comfyui' && (
            <div className="sub-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ fontSize: 13.5 }}>
                    🏠 Ảnh mặt bằng nhà khách (tùy chọn — Img2Img)
                  </strong>
                  <div className="text-xs text-muted">
                    Tải ảnh phòng khách thực tế để Flux giữ nguyên kiến trúc nhà &amp; thay decor Gia tiên vào.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                    📷 {referenceFile ? 'Đổi ảnh mặt bằng' : 'Chọn ảnh mặt bằng'}
                    <input type="file" accept="image/*" hidden onChange={handleSelectReference} />
                  </label>
                  {referenceFile && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setReferenceFile(null)
                        setReferencePreview('')
                      }}
                    >
                      ✕ Gỡ
                    </button>
                  )}
                </div>
              </div>

              {referenceFile && (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {referencePreview && (
                      <img
                        src={referencePreview}
                        alt="Mặt bằng gốc"
                        style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid #cbd5e1' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label className="text-xs font-bold" style={{ display: 'block', marginBottom: 4 }}>
                        Mức độ biến đổi decor (Denoise: {denoise.toFixed(2)} — khuyên dùng 0.65):
                      </label>
                      <input
                        type="range"
                        min={0.5}
                        max={0.75}
                        step={0.05}
                        value={denoise}
                        onChange={(e) => setDenoise(parseFloat(e.target.value))}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ghi chú thêm */}
          <div className="form-group">
            <label>Mô tả / Ghi chú thêm (tùy chọn)</label>
            <input
              type="text"
              placeholder="VD: Thêm đèn lồng vàng ấm, ghế Louis trắng kem..."
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </div>

          <AiLoadingBanner
            active={busy}
            label={
              engine === 'comfyui'
                ? 'ComfyUI Flux.1 Dev đang render ảnh trên GPU máy anh...'
                : 'AI Cloud đang vẽ ảnh minh họa...'
            }
            estimatedSeconds={engine === 'comfyui' ? 35 : 10}
          />

          {resultUrl && (
            <div className="sub-card" style={{ textAlign: 'center', background: '#ffffff' }}>
              <img
                src={resultUrl}
                alt="Kết quả AI Gia Tiên"
                style={{
                  maxWidth: '100%',
                  maxHeight: 340,
                  borderRadius: 8,
                  margin: '0 auto 10px',
                  display: 'block',
                  border: '1px solid #e2e8f0',
                }}
              />
              <div className="text-xs text-green">✓ Đã tạo ảnh xong! Anh có thể bấm Dùng ảnh này hoặc Vẽ lại.</div>
            </div>
          )}

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Đóng
            </button>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={resultUrl ? 'btn btn-outline' : 'btn btn-primary'}
                disabled={busy}
                onClick={handleGenerate}
              >
                {busy ? '⏳ Đang tạo ảnh...' : resultUrl ? '🔄 Vẽ lại mẫu khác' : '🎨 Tạo ảnh ngay'}
              </button>
              {resultUrl && (
                <button type="button" className="btn btn-primary" onClick={handleConfirmUse}>
                  ✅ Dùng ảnh này
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
