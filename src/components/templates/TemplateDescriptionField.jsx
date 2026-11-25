import { useState } from 'react'
import { generateSetDescription } from '../../lib/setTemplateAi'
import './Templates.css'

/** Ô mô tả + "Viết mô tả bằng AI". Bản AI chỉ là nháp để sửa; chỉ vào mô tả khi bấm "Dùng bản này" rồi Lưu mẫu. */
export default function TemplateDescriptionField({ value, onChange, name, category, itemNames }) {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    setBusy(true)
    setError('')
    try {
      setDraft(await generateSetDescription({ name, category, itemNames }))
    } catch (err) {
      setError(err.message || 'Không viết được mô tả bằng AI.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ui-field">
      <label htmlFor="tpl-description">Mô tả cho khách</label>
      <textarea
        id="tpl-description"
        className="ui-textarea"
        rows={3}
        maxLength={400}
        placeholder="2-3 câu giới thiệu mẫu set để gửi khách..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="ui-hint">
        {value.length}/400 ký tự. Mô tả có thể hiện công khai trên website: không ghi số lượng vật tư hay giá.
      </span>

      <div>
        <button
          type="button"
          className={`ui-btn ui-btn--secondary ui-btn--sm${busy ? ' is-loading' : ''}`}
          disabled={busy || !name.trim()}
          onClick={handleGenerate}
        >
          ✨ Viết mô tả bằng AI
        </button>
        {!name.trim() && <span className="ui-hint"> Nhập tên mẫu trước.</span>}
      </div>
      {error && <div className="ui-alert ui-alert--danger">{error}</div>}

      {draft !== null && (
        <div className="ui-alert ui-alert--info tpl-draft">
          <strong>Bản nháp của AI (chưa lưu, anh sửa thoải mái)</strong>
          <textarea
            className="ui-textarea"
            rows={4}
            maxLength={400}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="tpl-draft__actions">
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--sm"
              disabled={!draft.trim()}
              onClick={() => {
                onChange(draft.trim())
                setDraft(null)
              }}
            >
              Dùng bản này
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={handleGenerate}>
              Viết lại
            </button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setDraft(null)}>
              Bỏ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
