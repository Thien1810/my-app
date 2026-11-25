import { useEffect, useRef, useState } from 'react'
import { AI_MIN_GAP_MS, generateSetDescription } from '../../lib/setTemplateAi'
import { categoryIcon } from '../../lib/setTemplateMeta'
import TemplateLightbox from './TemplateLightbox'
import TemplateModal from './TemplateModal'
import './Templates.css'

const MAX_RATE_RETRIES = 2
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Viết mô tả cho các mẫu còn thiếu, TUẦN TỰ từng mẫu: AI viết nháp -> người duyệt Lưu/Bỏ qua -> mẫu kế tiếp.
 * Nghỉ tối thiểu AI_MIN_GAP_MS giữa 2 lần gọi (giới hạn máy chủ 30 lần/phút), gặp 429 thì chờ rồi thử lại.
 * queue: danh sách mẫu đã làm giàu (parsedCategory, items). onSaveDescription(template, text) trả Promise.
 */
export default function BatchDescriptionDialog({ queue, onSaveDescription, onClose }) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('generating') // generating | review | error | done
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [waitNote, setWaitNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [counts, setCounts] = useState({ saved: 0, skipped: 0 })
  const lastCallRef = useRef(0)
  const template = queue[index]
  // Chỉ tên vật tư, không có số lượng
  const itemNames = [...new Set((template?.items || []).map((ti) => ti.item?.name).filter(Boolean))]

  useEffect(() => {
    if (phase !== 'generating' || !template) return undefined
    let cancelled = false
    ;(async () => {
      const gap = AI_MIN_GAP_MS - (Date.now() - lastCallRef.current)
      if (gap > 0) await sleep(gap)
      for (let retry = 0; retry <= MAX_RATE_RETRIES; retry += 1) {
        if (cancelled) return
        lastCallRef.current = Date.now()
        try {
          const text = await generateSetDescription({
            name: template.name,
            category: template.parsedCategory,
            itemNames: (template.items || []).map((ti) => ti.item?.name).filter(Boolean),
          })
          if (cancelled) return
          setWaitNote('')
          setDraft(text)
          setPhase('review')
          return
        } catch (err) {
          if (cancelled) return
          if (err?.status === 429 && retry < MAX_RATE_RETRIES) {
            const seconds = Math.min(Math.max(err.retryAfter || 20, 5), 65)
            for (let left = seconds; left > 0; left -= 1) {
              if (cancelled) return
              setWaitNote(`Đạt giới hạn tần suất của AI, tự thử lại sau ${left} giây...`)
              await sleep(1000)
            }
            setWaitNote('')
            continue
          }
          setWaitNote('')
          setError(err?.message || 'Không viết được mô tả bằng AI.')
          setPhase('error')
          return
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phase, index, attempt, template])

  const next = (kind) => {
    setCounts((c) => ({ ...c, [kind]: c[kind] + 1 }))
    setError('')
    if (index + 1 >= queue.length) {
      setPhase('done')
    } else {
      setIndex(index + 1)
      setPhase('generating')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await onSaveDescription(template, draft.trim())
      next('saved')
    } catch (err) {
      setError(err?.message || 'Không lưu được mô tả.')
      if (err?.missingColumn) setPhase('error')
    } finally {
      setSaving(false)
    }
  }

  const retry = () => {
    setError('')
    setAttempt((value) => value + 1)
    setPhase('generating')
  }

  const title = `Viết mô tả cho mẫu còn thiếu${queue.length ? ` (${Math.min(index + 1, queue.length)}/${queue.length})` : ''}`

  return (
    <>
    <TemplateModal
      title={title}
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        phase === 'review' ? (
          <>
            <button type="button" className="ui-btn ui-btn--secondary" disabled={saving} onClick={() => next('skipped')}>
              Bỏ qua
            </button>
            <button
              type="button"
              className={`ui-btn ui-btn--primary${saving ? ' is-loading' : ''}`}
              disabled={saving || !draft.trim()}
              onClick={handleSave}
            >
              Lưu mô tả
            </button>
          </>
        ) : phase === 'error' ? (
          <>
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => next('skipped')}>
              Bỏ qua mẫu này
            </button>
            <button type="button" className="ui-btn ui-btn--primary" onClick={retry}>
              Thử lại
            </button>
          </>
        ) : (
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose}>
            {phase === 'done' ? 'Xong' : 'Dừng'}
          </button>
        )
      }
    >
      <div className="ui-stack">
        {phase === 'done' ? (
          <div className="ui-alert ui-alert--success">
            Hoàn tất: đã lưu {counts.saved} mô tả, bỏ qua {counts.skipped} mẫu.
          </div>
        ) : (
          template && (
            <>
              <div className="tpl-batch-head">
                {template.imageUrls?.length > 0 && (
                  <button
                    type="button"
                    className="tpl-batch-thumb"
                    aria-label="Phóng to ảnh bìa"
                    onClick={() => setZoom(true)}
                  >
                    <img src={template.imageUrls[0]} alt="" />
                  </button>
                )}
                <div className="tpl-batch-head__info">
                  <span className="ui-badge ui-badge--neutral">
                    {categoryIcon(template.parsedCategory)} {template.parsedCategory}
                  </span>
                  <h3 className="tpl-card__name">{template.name}</h3>
                  <span className="ui-hint">
                    {(template.items || []).length} món · đã lưu {counts.saved}, bỏ qua {counts.skipped}
                  </span>
                </div>
              </div>
              {itemNames.length > 0 && (
                <p className="ui-hint tpl-batch-items">
                  Vật tư: {itemNames.slice(0, 12).join(', ')}
                  {itemNames.length > 12 ? ` và ${itemNames.length - 12} món khác` : ''}
                </p>
              )}

              {phase === 'generating' && (
                <div className="ui-alert ui-alert--info">{waitNote || 'AI đang viết mô tả...'}</div>
              )}
              {error && <div className="ui-alert ui-alert--danger">{error}</div>}

              {phase === 'review' && (
                <div className="ui-field">
                  <label htmlFor="tpl-batch-draft">Bản nháp (sửa được, chỉ lưu khi bấm &ldquo;Lưu mô tả&rdquo;)</label>
                  <textarea
                    id="tpl-batch-draft"
                    className="ui-textarea"
                    rows={5}
                    maxLength={400}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <span className="ui-hint">
                    {draft.length}/400 ký tự. Mô tả có thể hiện công khai trên website, không ghi số lượng hay giá.
                  </span>
                </div>
              )}
            </>
          )
        )}
      </div>
    </TemplateModal>
      {zoom && template?.imageUrls?.length > 0 && (
        <TemplateLightbox
          urls={template.imageUrls}
          index={0}
          title={template.name}
          onIndex={() => {}}
          onClose={() => setZoom(false)}
        />
      )}
    </>
  )
}
