import { useState } from 'react'
import { formatNumber, KIND_LABELS } from '../../lib/formatters'
import { categoryBadgeVariant, categoryIcon } from '../../lib/setTemplateMeta'
import './Templates.css'

function Chevron({ open }) {
  return (
    <svg className={`tpl-chevron${open ? ' is-open' : ''}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Thẻ mẫu set gọn. template đã được làm giàu: parsedCategory, parsedNote, imageUrls.
 * canSeeQty: số lượng vật tư chỉ hiện cho admin/manager/storekeeper.
 */
export default function TemplateCard({
  template,
  canEdit,
  canSeeQty,
  onEdit,
  onShare,
  onPreview,
}) {
  const [open, setOpen] = useState(false)
  const { imageUrls, parsedCategory: category } = template
  const itemCount = (template.items || []).length
  const description = (template.description || '').trim()

  return (
    <article className="ui-card tpl-card">
      <div className="tpl-card__top">
        <button
          type="button"
          className="tpl-card__thumb"
          disabled={imageUrls.length === 0}
          aria-label={imageUrls.length ? `Xem ảnh mẫu ${template.name}` : 'Chưa có ảnh'}
          onClick={() => onPreview(template, 0)}
        >
          {imageUrls.length > 0 ? (
            <img src={imageUrls[0]} alt="" loading="lazy" />
          ) : (
            <span aria-hidden="true">{categoryIcon(category)}</span>
          )}
          {imageUrls.length > 1 && <span className="tpl-card__count">{imageUrls.length} ảnh</span>}
        </button>

        <div className="tpl-card__info">
          <span className={`ui-badge ui-badge--${categoryBadgeVariant(category)}`}>
            {categoryIcon(category)} {category}
          </span>
          <h3 className="tpl-card__name">{template.name}</h3>
          {description ? (
            <p className="tpl-card__desc">{description}</p>
          ) : (
            template.parsedNote && <p className="tpl-card__desc ui-text-muted">{template.parsedNote}</p>
          )}
        </div>
      </div>

      <div className="tpl-card__actions">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => onShare(template)}>
          Gửi khách
        </button>
        {canEdit && (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onEdit(template)}>
            Sửa
          </button>
        )}
      </div>

      <button
        type="button"
        className="tpl-card__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          Vật tư trong mẫu · {itemCount} món
        </span>
        <Chevron open={open} />
      </button>

      {open &&
        (itemCount === 0 ? (
          <div className="ui-empty">Mẫu set chưa có vật tư</div>
        ) : (
          <div className={`ui-table-wrap tpl-items-wrap${itemCount > 8 ? " is-long" : ""}`}>
            <table className="tpl-items">
              <thead>
                <tr>
                  <th>Vật tư</th>
                  {canSeeQty && <th className="tpl-items__num">Định mức</th>}
                </tr>
              </thead>
              <tbody>
                {template.items.map((ti) => (
                  <tr key={ti.item_id}>
                    <td>
                      <div className="tpl-items__name">{ti.item?.name || `Vật tư #${ti.item_id}`}</div>
                      <div className="ui-hint">
                        {[ti.item?.code, ti.item?.kind && KIND_LABELS[ti.item.kind]].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    {canSeeQty && (
                      <td className="tpl-items__num">
                        {formatNumber(ti.qty)} {ti.item?.unit || ''}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </article>
  )
}
