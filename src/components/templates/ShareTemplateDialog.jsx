import { useEffect, useMemo, useRef, useState } from 'react'
import { imageUrlToFile } from '../../lib/setTemplateImages'
import { buildShareText } from '../../lib/setTemplates'
import TemplateLightbox from './TemplateLightbox'
import TemplateModal from './TemplateModal'
import './Templates.css'

const MAX_SHARE_IMAGES = 10
// Cảnh báo mềm: nội dung gửi khách không được có giá/tiền.
const PRICE_HINT =
  /\d[\d.,]*\s*(?:đ|₫|vnđ|vnd|k|tr|triệu|nghìn|ngàn)(?!\p{L})|(?<!\p{L})giá(?!\p{L})/iu

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(area)
    return ok
  }
}

// Zalo: điện thoại dùng https://zalo.me/ (liên kết ứng dụng: mở app Zalo nếu đã cài, không thì mở trang Zalo),
// máy tính dùng Zalo Web. Không dùng zalo:// vì chưa cài app sẽ báo lỗi trang trắng.
function zaloUrl() {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
  return mobile ? 'https://zalo.me/' : 'https://chat.zalo.me/'
}

/**
 * Gửi mẫu cho khách: chọn ảnh, sửa nội dung, rồi chia sẻ (Web Share có file) hoặc sao chép + tải ảnh + mở Zalo.
 * Nội dung chỉ lấy tên, loại, mô tả: KHÔNG có số lượng vật tư, giá vốn hay giá.
 */
export default function ShareTemplateDialog({ template, onClose }) {
  const urls = template.imageUrls
  // Danh sách theo thứ tự chọn: số thứ tự trên ảnh cũng là thứ tự gửi
  const [selected, setSelected] = useState(() => urls.slice(0, MAX_SHARE_IMAGES))
  const [text, setText] = useState(() =>
    buildShareText({
      name: template.name,
      category: template.parsedCategory,
      description: template.description,
    })
  )
  const [preparing, setPreparing] = useState(false)
  const [message, setMessage] = useState({ kind: '', text: '' })
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const filesRef = useRef(new Map())
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const priceWarning = PRICE_HINT.test(text)
  const selectedKey = useMemo(() => selected.join('\n'), [selected])

  const fileFor = (url) => {
    const index = urls.indexOf(url)
    if (!filesRef.current.has(url)) {
      const promise = imageUrlToFile(url, template.name, index)
      promise.catch(() => {})
      filesRef.current.set(url, promise)
    }
    return filesRef.current.get(url)
  }

  // Tải sẵn ảnh đã chọn thành File để nút chia sẻ không phải chờ (trình duyệt di động đòi chia sẻ ngay sau khi bấm).
  useEffect(() => {
    if (!canNativeShare || selected.length === 0) return undefined
    let alive = true
    setPreparing(true)
    Promise.allSettled(selected.map(fileFor)).then(() => {
      if (alive) setPreparing(false)
    })
    return () => {
      alive = false
    }
    // fileFor chỉ phụ thuộc urls/template đã cố định khi mở hộp thoại
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, canNativeShare])

  const toggle = (url) => {
    setMessage({ kind: '', text: '' })
    if (selected.includes(url)) {
      setSelected(selected.filter((u) => u !== url))
    } else if (selected.length >= MAX_SHARE_IMAGES) {
      setMessage({ kind: 'warn', text: `Chỉ gửi được tối đa ${MAX_SHARE_IMAGES} ảnh một lần. Bỏ bớt ảnh để chọn ảnh khác.` })
    } else {
      setSelected([...selected, url])
    }
  }

  const selectAll = () => {
    setSelected(urls.slice(0, MAX_SHARE_IMAGES))
    setMessage(
      urls.length > MAX_SHARE_IMAGES
        ? { kind: 'warn', text: `Mẫu có ${urls.length} ảnh, chỉ chọn ${MAX_SHARE_IMAGES} ảnh đầu (tối đa mỗi lần gửi).` }
        : { kind: '', text: '' }
    )
  }

  const loadFiles = async () => {
    const results = await Promise.allSettled(selected.map(fileFor))
    const files = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    return { files, failed: results.length - files.length }
  }

  const handleShare = async () => {
    setMessage({ kind: '', text: '' })
    // Chép sẵn lời nhắn ngay trong thao tác bấm (một số app như Zalo chỉ nhận ảnh, bỏ qua chữ)
    const copying = copyText(text)
    try {
      const { files, failed } = await loadFiles()
      const data = { title: template.name, text }
      let note = failed > 0 ? `Có ${failed} ảnh không tải được nên không được gửi kèm.` : ''
      if (files.length > 0) {
        if (!navigator.canShare || navigator.canShare({ files })) {
          data.files = files
        } else {
          note = 'Thiết bị này không gửi kèm ảnh được. Đã chia sẻ nội dung, hãy mở phần "Cách khác" để tải ảnh về rồi gửi thủ công.'
        }
      }
      await navigator.share(data)
      const copied = await copying
      setMessage({
        kind: note ? 'warn' : 'success',
        text: `${note ? `${note} ` : ''}${copied ? 'Đã chép sẵn chữ, nếu Zalo chỉ nhận ảnh thì dán vào.' : ''}`.trim(),
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (await copying) setMessage({ kind: 'success', text: 'Đã chép sẵn chữ, nếu Zalo chỉ nhận ảnh thì dán vào.' })
        return
      }
      setMessage({ kind: 'danger', text: err?.message || 'Không chia sẻ được. Hãy dùng Sao chép nội dung và Tải ảnh về.' })
    }
  }

  const handleCopy = async () => {
    const ok = await copyText(text)
    setMessage(
      ok
        ? { kind: 'success', text: 'Đã sao chép nội dung. Dán vào Zalo/Messenger để gửi khách.' }
        : { kind: 'danger', text: 'Không sao chép được. Hãy bôi đen nội dung rồi sao chép thủ công.' }
    )
  }

  const handleDownload = async () => {
    setMessage({ kind: '', text: '' })
    const { files, failed } = await loadFiles()
    for (const file of files) {
      const href = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = file.name
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      setTimeout(() => URL.revokeObjectURL(href), 10000)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    setMessage(
      failed > 0
        ? { kind: 'warn', text: `Đã tải ${files.length} ảnh, ${failed} ảnh không tải được.` }
        : { kind: 'success', text: `Đã tải ${files.length} ảnh về máy.` }
    )
  }

  const manual = (
    <div className="ui-btn-group tpl-share-manual">
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={handleCopy}>
        Sao chép nội dung
      </button>
      <button
        type="button"
        className="ui-btn ui-btn--secondary ui-btn--sm"
        disabled={selected.length === 0}
        onClick={handleDownload}
      >
        Tải ảnh về
      </button>
      <button
        type="button"
        className="ui-btn ui-btn--secondary ui-btn--sm"
        onClick={() => window.open(zaloUrl(), '_blank', 'noopener,noreferrer')}
      >
        Mở Zalo
      </button>
    </div>
  )

  return (
    <>
      <TemplateModal
        title={`Gửi khách: ${template.name}`}
        onClose={onClose}
        closeOnBackdrop={false}
        footer={
          canNativeShare ? (
            <>
              <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose}>
                Đóng
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                disabled={preparing || !text.trim()}
                onClick={handleShare}
              >
                {preparing ? `Đang chuẩn bị ${selected.length} ảnh…` : 'Chia sẻ'}
              </button>
            </>
          ) : (
            <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose}>
              Đóng
            </button>
          )
        }
      >
        <div className="ui-stack">
          {message.text && <div className={`ui-alert ui-alert--${message.kind}`}>{message.text}</div>}

          <div className="ui-field">
            <span className="ui-label">
              Chọn ảnh gửi khách ({selected.length}/{Math.min(urls.length, MAX_SHARE_IMAGES)})
            </span>
            {urls.length === 0 ? (
              <span className="ui-hint">Mẫu này chưa có ảnh, chỉ gửi được nội dung.</span>
            ) : (
              <>
                <div className="tpl-share-tools">
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={selectAll}>
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn--secondary ui-btn--sm"
                    onClick={() => {
                      setSelected(urls.slice(0, 1))
                      setMessage({ kind: '', text: '' })
                    }}
                  >
                    Chỉ ảnh bìa
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost ui-btn--sm"
                    onClick={() => {
                      setSelected([])
                      setMessage({ kind: '', text: '' })
                    }}
                  >
                    Bỏ chọn
                  </button>
                </div>
                <div className="tpl-share-grid">
                  {urls.map((url, index) => {
                    const order = selected.indexOf(url)
                    const on = order >= 0
                    return (
                      <div key={url.slice(-80) + index} className="tpl-share-cell">
                        <button
                          type="button"
                          className={`tpl-share-pick${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          aria-label={`Ảnh ${index + 1}${index === 0 ? ' (bìa)' : ''}${on ? `, đã chọn thứ ${order + 1}` : ''}`}
                          onClick={() => toggle(url)}
                        >
                          <img src={url} alt="" loading="lazy" />
                          <span className="tpl-share-pick__tick" aria-hidden="true">
                            {on ? order + 1 : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="tpl-share-zoom"
                          aria-label={`Xem ảnh ${index + 1}`}
                          onClick={() => setLightboxIndex(index)}
                        >
                          🔍
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="ui-field">
            <label htmlFor="tpl-share-text">Nội dung gửi khách (sửa được)</label>
            <textarea
              id="tpl-share-text"
              className="ui-textarea tpl-share-text"
              rows={5}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="ui-hint">Chỉ gồm tên, loại và mô tả. Không ghi số lượng vật tư, giá vốn hay giá.</span>
            {priceWarning && (
              <div className="ui-alert ui-alert--warn">
                Nội dung có vẻ chứa giá hoặc số tiền. Hãy xóa trước khi gửi khách.
              </div>
            )}
          </div>

          {canNativeShare ? (
            <details className="tpl-share-more">
              <summary>Cách khác: sao chép, tải ảnh, mở Zalo</summary>
              {manual}
            </details>
          ) : (
            <div className="ui-field">
              <span className="ui-label">Gửi khách</span>
              <span className="ui-hint">
                Trình duyệt này chưa hỗ trợ chia sẻ kèm ảnh. Sao chép nội dung, tải ảnh về rồi gửi qua Zalo.
              </span>
              {manual}
            </div>
          )}
        </div>
      </TemplateModal>

      {lightboxIndex !== null && (
        <TemplateLightbox
          urls={urls}
          index={lightboxIndex}
          title={template.name}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
