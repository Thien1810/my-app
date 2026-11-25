import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { KIND_LABELS } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { orderTemplateImages, buildCategoryOptions, categoryKey } from '../lib/setTemplates'
import { canonicalCategory, categoryIcon, parseTemplateMeta } from '../lib/setTemplateMeta'
import {
  deleteTemplate,
  loadTemplatesData,
  saveTemplate,
  saveTemplateDescription,
} from '../lib/setTemplatesApi'
import BatchDescriptionDialog from '../components/templates/BatchDescriptionDialog'
import ShareTemplateDialog from '../components/templates/ShareTemplateDialog'
import TemplateCard from '../components/templates/TemplateCard'
import TemplateEditorModal from '../components/templates/TemplateEditorModal'
import TemplateLightbox from '../components/templates/TemplateLightbox'
import '../components/templates/Templates.css'

export default function TemplatesPage() {
  const { canEditCatalog, canDeleteCatalog } = useAuth()
  const [templates, setTemplates] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [warnings, setWarnings] = useState([])
  const [filterCategory, setFilterCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [imagesSupported, setImagesSupported] = useState(true)
  const [descriptionSupported, setDescriptionSupported] = useState(null)

  const [editor, setEditor] = useState(null) // { template }
  const [shareTarget, setShareTarget] = useState(null)
  const [lightbox, setLightbox] = useState(null) // { urls, index, title }
  const [batchQueue, setBatchQueue] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await loadTemplatesData()
      setTemplates(data.templates)
      setItems(data.items)
      setImagesSupported(data.imagesSupported)
      setDescriptionSupported((prev) =>
        data.descriptionSupported === null ? prev : data.descriptionSupported
      )
      return data
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách mẫu set trang trí')
    } finally {
      setLoading(false)
    }
    return null
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const categoryOptions = useMemo(
    () =>
      buildCategoryOptions(
        templates.map((tpl) => ({ category: parseTemplateMeta(tpl).category }))
      ),
    [templates]
  )

  const enrichedTemplates = useMemo(
    () =>
      templates.map((tpl) => {
        const meta = parseTemplateMeta(tpl)
        return {
          ...tpl,
          parsedCategory: canonicalCategory(meta.category, categoryOptions),
          parsedNote: meta.cleanNote,
          imageUrls: orderTemplateImages({ image_url: meta.image_url }, tpl.images),
        }
      }),
    [templates, categoryOptions]
  )

  const activeFilter =
    filterCategory === 'all' || categoryOptions.some((c) => categoryKey(c) === categoryKey(filterCategory))
      ? filterCategory
      : 'all'

  const filteredTemplates = useMemo(() => {
    const needle = categoryKey(query)
    return enrichedTemplates.filter((t) => {
      if (activeFilter !== 'all' && categoryKey(t.parsedCategory) !== categoryKey(activeFilter)) return false
      if (!needle) return true
      // Tìm không dấu theo tên, loại, mô tả
      return categoryKey(`${t.name} ${t.parsedCategory} ${t.description || ''}`).includes(needle)
    })
  }, [enrichedTemplates, activeFilter, query])

  const missingDescription = useMemo(
    () => enrichedTemplates.filter((t) => !(t.description || '').trim()),
    [enrichedTemplates]
  )

  const openEditor = (template) => setEditor({ template, key: `${template?.id ?? 'new'}-${Date.now()}` })

  const handleSave = async (payload) => {
    setError('')
    setSuccess('')
    setWarnings([])
    const opened = editor
    let result
    try {
      result = await saveTemplate({
        editingTemplate: opened?.template || null,
        ...payload,
        descriptionSupported,
      })
    } catch (err) {
      if (err?.savedTemplateId) {
        // Đầu mẫu đã tạo: chuyển form sang chế độ sửa mẫu đó để lần lưu sau không tạo trùng
        const data = await loadData()
        const saved = data?.templates.find((t) => t.id === err.savedTemplateId)
        setEditor((cur) =>
          cur && cur.key === opened.key
            ? { ...cur, template: saved || { id: err.savedTemplateId, items: [], images: [] } }
            : cur
        )
      }
      throw err
    }
    if (result.descriptionUnsupported) setDescriptionSupported(false)
    // Chỉ đóng nếu đang mở đúng mẫu vừa lưu
    setEditor((cur) => (cur && opened && cur.key === opened.key ? null : cur))
    setWarnings(result.warnings)
    if (result.warnings.length === 0) setSuccess('Đã lưu mẫu set trang trí thành công!')
    await loadData()
  }

  const handleDelete = async (tpl) => {
    if (!window.confirm(`Xóa mẫu set "${tpl.name}"? Ảnh của mẫu cũng bị xóa và không khôi phục được.`)) return false
    setError('')
    setSuccess('')
    try {
      await deleteTemplate(tpl)
      await loadData()
      return true
    } catch (err) {
      setError(err.message || 'Không thể xóa mẫu set')
      return false
    }
  }

  const handleBatchSave = async (tpl, text) => {
    try {
      await saveTemplateDescription(tpl.id, text)
    } catch (err) {
      if (err.missingColumn) setDescriptionSupported(false)
      throw err
    }
    setTemplates((prev) => prev.map((t) => (t.id === tpl.id ? { ...t, description: text } : t)))
  }

  const handlePreview = (tpl, index = 0) =>
    setLightbox({ urls: tpl.imageUrls, index, title: tpl.name })

  const handleExport = () => {
    const rows = []
    for (const tpl of filteredTemplates) {
      const base = {
        'Phân loại set': tpl.parsedCategory,
        'Tên mẫu set': tpl.name,
        'Mô tả': tpl.description || '',
        'Ghi chú set': tpl.parsedNote || '',
      }
      if (!tpl.items || tpl.items.length === 0) {
        rows.push({
          ...base,
          'Mã vật tư': '',
          'Tên vật tư': '',
          'Phân loại vật tư': '',
          'Số lượng': 0,
          'ĐVT': '',
        })
      } else {
        for (const ti of tpl.items) {
          rows.push({
            ...base,
            'Mã vật tư': ti.item?.code || '',
            'Tên vật tư': ti.item?.name || `#${ti.item_id}`,
            'Phân loại vật tư': KIND_LABELS[ti.item?.kind] || '',
            'Số lượng': Number(ti.qty),
            'ĐVT': ti.item?.unit || '',
          })
        }
      }
    }
    exportToExcel(rows, 'MauSetTrangTri', 'mau-set-trang-tri.xlsx')
  }

  const unsupported = []
  if (!imagesSupported) unsupported.push('nhiều ảnh cho mỗi mẫu')
  if (descriptionSupported === false) unsupported.push('mô tả và viết mô tả bằng AI')

  return (
    <div className="page-container">
      <div className="tpl-header">
        <div>
          <h1>Mẫu Set Trang Trí</h1>
          <p className="text-muted">
            Quản lý các mẫu set kèm ảnh thực tế, áp dụng nhanh vào Kế hoạch dự án và gửi cho khách.
          </p>
        </div>
        <div className="ui-btn-group ui-btn-group--end tpl-header__actions">
          {canEditCatalog && (
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--sm tpl-create-btn"
              onClick={() => openEditor(null)}
            >
              + Tạo mẫu set mới
            </button>
          )}
          {canEditCatalog && descriptionSupported !== false && missingDescription.length > 0 && (
            <button
              type="button"
              className="ui-btn ui-btn--secondary ui-btn--sm"
              onClick={() => setBatchQueue(missingDescription)}
            >
              ✨ Viết mô tả cho mẫu còn thiếu ({missingDescription.length})
            </button>
          )}
          {canEditCatalog && (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm tpl-export-btn" onClick={handleExport}>
              Xuất Excel
            </button>
          )}
        </div>
      </div>

      <div className="ui-stack ui-stack--sm tpl-notices">
        {error && <div className="ui-alert ui-alert--danger">{error}</div>}
        {success && <div className="ui-alert ui-alert--success">{success}</div>}
        {warnings.map((text) => (
          <div key={text} className="ui-alert ui-alert--warn">
            {text}
          </div>
        ))}
        {canEditCatalog && unsupported.length > 0 && (
          <div className="ui-alert ui-alert--info">
            Tính năng {unsupported.join(' và ')} chưa bật vì cơ sở dữ liệu chưa được cập nhật. Nhờ anh Thiện chạy{' '}
            <code>supabase/set_templates_v2.sql</code> trên Supabase.
          </div>
        )}
      </div>

      <div className="tpl-search">
        <input
          type="search"
          className="ui-input"
          placeholder="Tìm mẫu theo tên hoặc mô tả (không cần gõ dấu)"
          aria-label="Tìm mẫu set"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="ui-tabs tpl-tabs" role="tablist" aria-label="Lọc theo loại set">
        {[
          { value: 'all', label: 'Tất cả', count: enrichedTemplates.length },
          ...categoryOptions.map((option) => ({
            value: option,
            label: `${categoryIcon(option)} ${option}`,
            count: enrichedTemplates.filter((t) => categoryKey(t.parsedCategory) === categoryKey(option)).length,
          })),
        ].map((tab) => {
          const active = tab.value === activeFilter
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ui-tab${active ? ' is-active' : ''}`}
              onClick={() => setFilterCategory(tab.value)}
            >
              {tab.label} ({tab.count})
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="ui-empty">Đang tải danh sách mẫu set...</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="ui-card ui-empty">
          <div className="ui-empty__title">
            {query.trim() ? 'Không có mẫu nào khớp với từ khóa' : 'Chưa có mẫu set nào trong mục này'}
          </div>
          {canEditCatalog && !query.trim() && <>Hãy bấm &ldquo;+ Tạo mẫu set mới&rdquo; để thêm mẫu.</>}
        </div>
      ) : (
        <div className="ui-grid ui-grid--3 tpl-grid">
          {filteredTemplates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              canEdit={canEditCatalog}
              canSeeQty={canEditCatalog}
              onEdit={openEditor}
              onShare={setShareTarget}
              onPreview={handlePreview}
            />
          ))}
        </div>
      )}

      {editor && canEditCatalog && (
        <TemplateEditorModal
          key={editor.key}
          template={editor.template}
          items={items}
          categoryOptions={categoryOptions}
          defaultCategory={activeFilter === 'all' ? 'Gia tiên' : activeFilter}
          imagesSupported={imagesSupported}
          descriptionSupported={descriptionSupported}
          canDelete={canDeleteCatalog}
          onDelete={async (tpl) => {
            if (await handleDelete(tpl)) setEditor(null)
          }}
          onSave={handleSave}
          onClose={() => setEditor(null)}
          onPreview={(urls, index) => setLightbox({ urls, index, title: editor.template?.name || 'Mẫu set' })}
        />
      )}

      {shareTarget && <ShareTemplateDialog template={shareTarget} onClose={() => setShareTarget(null)} />}

      {batchQueue && (
        <BatchDescriptionDialog
          queue={batchQueue}
          onSaveDescription={handleBatchSave}
          onClose={() => setBatchQueue(null)}
        />
      )}

      {lightbox && (
        <TemplateLightbox
          urls={lightbox.urls}
          index={lightbox.index}
          title={lightbox.title}
          onIndex={(index) => setLightbox((prev) => ({ ...prev, index }))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
