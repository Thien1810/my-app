import { useEffect, useMemo, useState } from 'react'
import { extractCardDescription, renderTemplateCard } from '../../lib/setTemplateCard'
import { loadShareContact } from '../../lib/setTemplateContact'
import { safeFileBase } from '../../lib/setTemplateImages'
import { buildShareText } from '../../lib/setTemplates'
import TemplateLightbox from './TemplateLightbox'
import TemplateModal from './TemplateModal'
import './Templates.css'

const MAX_SHARE_IMAGES = 10
const COPIED_NOTE = 'Đã chép sẵn chữ, nếu Zalo chỉ nhận ảnh thì dán vào.'
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
 * Gửi mẫu cho khách: gộp ảnh đã chọn + tên + loại + mô tả thành MỘT ảnh thẻ (JPEG) rồi chia sẻ đúng 1 file đó.
 * Nội dung chỉ lấy tên, loại, mô tả: KHÔNG có số lượng vật tư, giá vốn hay giá.
 */
export default function ShareTemplateDialog({ template, onClose }) {
  const urls = template.imageUrls
  // Danh sách theo thứ tự chọn: số thứ tự trên ảnh cũng là thứ tự xếp trong thẻ
  const [selected, setSelected] = useState(() => urls.slice(0, MAX_SHARE_IMAGES))
  const [text, setText] = useState(() =>
    buildShareText({
      name: template.name,
      category: template.parsedCategory,
      description: template.description,
    })
  )
  const [card, setCard] = useState({ status: 'building', file: null, url: '', skipped: [], error: '' })
  const [message, setMessage] = useState({ kind: '', text: '' })
  // null = đang tải; chờ có liên hệ mới dựng thẻ để không gửi nhầm thẻ thiếu thông tin
  const [contact, setContact] = useState(null)
  useEffect(() => {
    let alive = true
    loadShareContact().then((value) => alive && setContact(value))
    return () => {
      alive = false
    }
  }, [])
  const [manualOpen, setManualOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const priceWarning = PRICE_HINT.test(text)
  const selectedKey = useMemo(() => selected.join('\n'), [selected])
  const cardDescription = useMemo(
    () => extractCardDescription(text, { name: template.name, category: template.parsedCategory }),
    [text, template.name, template.parsedCategory]
  )

  // Dựng ảnh thẻ ngay khi mở; dựng lại (chờ 450ms) khi đổi ảnh đã chọn hoặc sửa nội dung
  useEffect(() => {
    let alive = true
    let objectUrl = ''
    setCard((prev) => ({ ...prev, status: 'building' }))
    if (!contact) return undefined
    const timer = setTimeout(async () => {
      try {
        const result = await renderTemplateCard({
          name: template.name,
          category: template.parsedCategory,
          description: cardDescription,
          imageUrls: selected,
          contact,
        })
        if (!alive) return
        objectUrl = URL.createObjectURL(result.blob)
        const file = new File([result.blob], `${safeFileBase(template.name)}.jpg`, { type: 'image/jpeg' })
        setCard({ status: 'ready', file, url: objectUrl, skipped: result.skipped, error: '' })
      } catch (err) {
        if (alive) setCard({ status: 'error', file: null, url: '', skipped: [], error: err?.message || '' })
      }
    }, 450)
    return () => {
      alive = false
      clearTimeout(timer)
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    }
    // selected được đại diện bởi selectedKey; template cố định khi mở hộp thoại
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, cardDescription, contact])

  const toggle = (url) => {
    setMessage({ kind: '', text: '' })
    if (selected.includes(url)) {
      setSelected(selected.filter((u) => u !== url))
    } else if (selected.length >= MAX_SHARE_IMAGES) {
      setMessage({ kind: 'warn', text: `Chỉ chọn được tối đa ${MAX_SHARE_IMAGES} ảnh. Bỏ bớt ảnh để chọn ảnh khác.` })
    } else {
      setSelected([...selected, url])
    }
  }

  const selectAll = () => {
    setSelected(urls.slice(0, MAX_SHARE_IMAGES))
    setMessage(
      urls.length > MAX_SHARE_IMAGES
        ? { kind: 'warn', text: `Mẫu có ${urls.length} ảnh, chỉ chọn ${MAX_SHARE_IMAGES} ảnh đầu (tối đa mỗi lần).` }
        : { kind: '', text: '' }
    )
  }

  const handleShare = async () => {
    if (!card.file) return
    setMessage({ kind: '', text: '' })
    // Chép sẵn lời nhắn ngay trong thao tác bấm (một số app như Zalo chỉ nhận ảnh, bỏ qua chữ)
    const copying = copyText(text)
    try {
      const data = { files: [card.file], text }
      if (navigator.canShare && !navigator.canShare({ files: data.files })) {
        setManualOpen(true)
        setMessage({
          kind: 'warn',
          text: 'Thiết bị này không chia sẻ kèm ảnh được. Hãy bấm "Tải ảnh về" rồi gửi ảnh thủ công; chữ đã được chép sẵn để dán.',
        })
        return
      }
      await navigator.share(data)
      setMessage((await copying) ? { kind: 'success', text: COPIED_NOTE } : { kind: '', text: '' })
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (await copying) setMessage({ kind: 'success', text: COPIED_NOTE })
        return
      }
      setManualOpen(true)
      const copied = await copying
      setMessage({
        kind: 'danger',
        text: `Không chia sẻ được${err?.message ? ` (${err.message})` : ''}. Hãy bấm "Tải ảnh về" rồi gửi ảnh thủ công${copied ? '; chữ đã được chép sẵn để dán' : ''}.`,
      })
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

  const handleDownload = () => {
    if (!card.file) return
    const anchor = document.createElement('a')
    anchor.href = card.url
    anchor.download = card.file.name
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    setMessage({ kind: 'success', text: 'Đã tải ảnh thẻ về máy.' })
  }

  const manual = (
    <div className="ui-btn-group tpl-share-manual">
      <button
        type="button"
        className="ui-btn ui-btn--secondary ui-btn--sm"
        disabled={card.status !== 'ready'}
        onClick={handleDownload}
      >
        Tải ảnh về
      </button>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={handleCopy}>
        Sao chép nội dung
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
                disabled={card.status !== 'ready' || !text.trim()}
                onClick={handleShare}
              >
                {card.status === 'building' ? 'Đang dựng ảnh thẻ…' : 'Gửi khách'}
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
            <span className="ui-label">Ảnh thẻ sẽ gửi (1 file)</span>
            <div className="tpl-card-preview">
              {card.url && (
                <img
                  src={card.url}
                  alt="Xem trước ảnh thẻ mẫu set"
                  className={card.status === 'building' ? 'is-stale' : ''}
                />
              )}
              {card.status === 'building' && <span className="ui-hint">Đang dựng ảnh thẻ…</span>}
              {card.status === 'error' && (
                <div className="ui-alert ui-alert--danger">
                  Không dựng được ảnh thẻ{card.error ? `: ${card.error}` : ''}. Thử bỏ bớt ảnh đã chọn.
                </div>
              )}
            </div>
            {card.skipped.length > 0 && (
              <div className="ui-alert ui-alert--warn">
                Bỏ qua {card.skipped.length} ảnh không tải được ({card.skipped[0].message})
                {card.skipped.some((item) => item.code === 'cors')
                  ? ' Kiểm tra đã chạy set_templates_v2.sql (bucket công khai, có CORS).'
                  : ''}
              </div>
            )}
          </div>

          <div className="ui-field">
            <span className="ui-label">
              Chọn ảnh đưa vào thẻ ({selected.length}/{Math.min(urls.length, MAX_SHARE_IMAGES)})
            </span>
            {urls.length === 0 ? (
              <span className="ui-hint">Mẫu này chưa có ảnh, thẻ chỉ có tên và mô tả.</span>
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
                <span className="ui-hint">Thẻ xếp tối đa 9 ảnh: ảnh chọn đầu tiên là ảnh bìa lớn.</span>
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
            <span className="ui-hint">
              Chỉ gồm tên, loại và mô tả. Không ghi số lượng vật tư, giá vốn hay giá. Phần mô tả cũng được in lên ảnh thẻ.
            </span>
            {priceWarning && (
              <div className="ui-alert ui-alert--warn">
                Nội dung có vẻ chứa giá hoặc số tiền. Hãy xóa trước khi gửi khách.
              </div>
            )}
          </div>

          {canNativeShare ? (
            <details
              className="tpl-share-more"
              open={manualOpen}
              onToggle={(event) => setManualOpen(event.currentTarget.open)}
            >
              <summary>Cách khác: tải ảnh thẻ, sao chép, mở Zalo</summary>
              {manual}
            </details>
          ) : (
            <div className="ui-field">
              <span className="ui-label">Gửi khách</span>
              <span className="ui-hint">
                Trình duyệt này chưa hỗ trợ chia sẻ kèm ảnh. Tải ảnh thẻ về, sao chép nội dung rồi gửi qua Zalo.
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
