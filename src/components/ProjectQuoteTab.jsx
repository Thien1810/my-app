import { useState, useEffect, useMemo } from 'react'
import { formatCurrency, formatNumber } from '../lib/formatters'
import { exportToExcel } from '../lib/exportExcel'
import { compressImageUnder1MB } from '../lib/imageCompressor'
import { parseTemplateMeta, SET_CATEGORY_OPTIONS } from '../pages/TemplatesPage'
import { exportQuoteToPng } from '../lib/quoteExporter'
import ContractValueFields from './ContractValueFields'
import { saveProjectFinance } from '../lib/financeApi'

export default function ProjectQuoteTab({
  project,
  templates = [],
  contractValue = 0,
  discount = 0,
  isManagerOrAdmin = false,
  onSyncContractValue,
  onSyncFinance,
  onApplySetsToPlan,
}) {
  const storageKey = `dw_quote_project_${project?.id}`

  const [quoteLines, setQuoteLines] = useState([])
  // Bản nháp khi sửa: doanh số (giá gói) và ưu đãi; doanh thu = doanh số - ưu đãi
  const [draftFinance, setDraftFinance] = useState(null)
  const [financeValid, setFinanceValid] = useState(true)
  const [quoteNote, setQuoteNote] = useState('')
  const [filterSetCat, setFilterSetCat] = useState('all')
  const [exportingPng, setExportingPng] = useState(false)
  const [savingContract, setSavingContract] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [saveError, setSaveError] = useState('')
  const [previewImg, setPreviewImg] = useState(null)

  // Chuẩn hóa danh sách mẫu set có hình ảnh và phân loại
  const enrichedTemplates = useMemo(() => {
    return templates.map((t) => {
      const meta = parseTemplateMeta(t)
      return {
        ...t,
        parsedCategory: meta.category,
        parsedImageUrl: meta.image_url,
        parsedNote: meta.cleanNote,
      }
    })
  }, [templates])

  const visibleTemplates = useMemo(() => {
    if (filterSetCat === 'all') return enrichedTemplates
    return enrichedTemplates.filter((t) => t.parsedCategory === filterSetCat)
  }, [enrichedTemplates, filterSetCat])

  // Tải danh sách Set trang trí đã chọn cho báo giá dự án này
  useEffect(() => {
    if (!project?.id) return
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        setQuoteLines(Array.isArray(parsed.lines) ? parsed.lines : [])
        setQuoteNote(parsed.quoteNote || '')
      }
    } catch {
      // ignore
    }
  }, [project?.id, storageKey])

  const persistQuote = (nextLines, nextNote) => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          lines: nextLines,
          quoteNote: nextNote,
          updatedAt: new Date().toISOString(),
        })
      )
    } catch {
      // ignore
    }
  }

  // Đưa Mẫu set vào báo giá: chỉ lấy Hình ảnh + Tên set + Phân loại + Tên các vật tư (KHÔNG lấy số lượng vật tư & KHÔNG lấy giá vốn)
  const handleAddTemplateToQuote = (tpl) => {
    setSyncMsg('')
    const itemNames = (tpl.items || [])
      .map((ti) => ti.item?.name)
      .filter(Boolean)
      .join(', ')

    const defaultDesc = tpl.parsedNote
      ? tpl.parsedNote
      : itemNames
        ? `Gồm: ${itemNames}`
        : ''

    const newLine = {
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      template_id: tpl.id,
      name: tpl.name,
      category: tpl.parsedCategory || 'Gia tiên',
      image_url: tpl.parsedImageUrl || '',
      qty: 1,
      note: defaultDesc,
    }
    const next = [...quoteLines, newLine]
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleAddCustomLine = () => {
    const newLine = {
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      template_id: null,
      name: '',
      category: 'Gia tiên',
      image_url: '',
      qty: 1,
      note: '',
    }
    const next = [...quoteLines, newLine]
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleUpdateLine = (uid, field, value) => {
    const next = quoteLines.map((l) => (l.uid === uid ? { ...l, [field]: value } : l))
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleRemoveLine = (uid) => {
    const next = quoteLines.filter((l) => l.uid !== uid)
    setQuoteLines(next)
    persistQuote(next, quoteNote)
  }

  const handleLineImageUpload = async (uid, file) => {
    if (!file) return
    try {
      const compressed = await compressImageUnder1MB(file)
      handleUpdateLine(uid, 'image_url', compressed.dataUrl)
    } catch (err) {
      alert(err.message || 'Lỗi khi nén ảnh')
    }
  }

  // contractValue (props) = doanh thu, số khách thực trả. Không trừ ưu đãi thêm lần nào.
  const finalTotal = Number(contractValue || 0)
  const safeDiscount = Math.max(0, Number(discount || 0))
  const packagePrice = finalTotal + safeDiscount

  const handleSaveFinance = async () => {
    if (!isManagerOrAdmin || !draftFinance || !financeValid) return
    setSavingContract(true)
    setSyncMsg('')
    setSaveError('')
    try {
      const revenue = draftFinance.grossSales - draftFinance.discount
      const { data, error } = await saveProjectFinance(project.id, {
        contractValue: revenue,
        discount: draftFinance.discount,
      })
      if (error) throw error
      const cv = Number(data?.contract_value ?? revenue)
      const d = Number(data?.discount ?? draftFinance.discount)
      setDraftFinance(null)
      if (onSyncFinance) onSyncFinance({ contractValue: cv, discount: d })
      if (onSyncContractValue) onSyncContractValue(cv)
      setSyncMsg(`✓ Đã lưu giá trị hợp đồng (doanh thu): ${formatCurrency(cv)}`)
    } catch (err) {
      setSaveError(err?.message || 'Không thể lưu giá trị hợp đồng và ưu đãi.')
    } finally {
      setSavingContract(false)
    }
  }

  const handlePushSetsToPlan = async () => {
    const templateIds = quoteLines
      .filter((l) => l.template_id)
      .map((l) => ({ template_id: l.template_id, mult: Number(l.qty || 1) }))
    if (templateIds.length === 0) {
      alert('Chưa có Mẫu set trang trí nào trong báo giá để nạp sang Kế hoạch vật tư.')
      return
    }
    if (onApplySetsToPlan) {
      await onApplySetsToPlan(templateIds)
      setSyncMsg('✓ Đã nạp toàn bộ vật tư định mức của các Set đã chọn sang tab Kế hoạch vật tư!')
    }
  }

  const handleExportPng = async () => {
    if (quoteLines.length === 0) {
      alert('Vui lòng chọn ít nhất 1 Set trang trí vào báo giá trước khi xuất ảnh.')
      return
    }
    setExportingPng(true)
    try {
      await exportQuoteToPng({
        project,
        quoteLines,
        contractValue: finalTotal,
        discount: safeDiscount,
        quoteNote,
      })
    } finally {
      setExportingPng(false)
    }
  }

  const handleExportExcel = () => {
    const rows = quoteLines.map((l, i) => ({
      STT: i + 1,
      'Phân loại': l.category || 'Gia tiên',
      'Hạng mục / Mẫu Set Trang Trí': l.name,
      'Danh sách vật tư / Mô tả': l.note || '',
    }))
    if (safeDiscount > 0) {
      rows.push({
        STT: '',
        'Phân loại': '',
        'Hạng mục / Mẫu Set Trang Trí': 'GIÁ GÓI',
        'Danh sách vật tư / Mô tả': formatCurrency(packagePrice),
      })
      rows.push({
        STT: '',
        'Phân loại': '',
        'Hạng mục / Mẫu Set Trang Trí': 'ƯU ĐÃI',
        'Danh sách vật tư / Mô tả': `-${formatCurrency(safeDiscount)}`,
      })
    }
    rows.push({
      STT: '',
      'Phân loại': '',
      'Hạng mục / Mẫu Set Trang Trí': safeDiscount > 0 ? 'GIÁ TRỊ THANH TOÁN' : 'GIÁ TRỊ HỢP ĐỒNG TRỌN GÓI',
      'Danh sách vật tư / Mô tả': formatCurrency(finalTotal),
    })
    exportToExcel(
      rows,
      'BaoGiaDangWedding',
      `bao-gia-dang-wedding-${project?.code || project?.id}.xlsx`
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {syncMsg && <div className="alert alert-success">{syncMsg}</div>}

      {/* BƯỚC 1: CHỌN MẪU SET TRANG TRÍ TỪ HÌNH ẢNH */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <h3>1. Chọn Mẫu Set Trang Trí đưa vào Báo giá (Kèm hình ảnh mẫu)</h3>
            <p className="text-xs text-muted">
              Bấm chọn các mẫu <strong>Gia tiên</strong> hoặc <strong>Mâm quả</strong> bên dưới để
              đưa hình ảnh mẫu vào Phiếu Báo Giá (tuyệt đối không lộ giá vốn vật tư trong kho)
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${filterSetCat === 'all' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilterSetCat('all')}
            >
              Tất cả ({enrichedTemplates.length})
            </button>
            {SET_CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`btn btn-sm ${
                  filterSetCat === opt.value ? 'btn-primary' : 'btn-outline'
                }`}
                onClick={() => setFilterSetCat(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {visibleTemplates.length === 0 ? (
          <div className="empty-state">
            Chưa có mẫu set nào trong mục này. Hãy tạo mẫu Gia tiên / Mâm quả kèm hình ảnh tại menu
            &ldquo;✨ Mẫu set trang trí&rdquo;.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: 12,
              marginTop: 10,
            }}
          >
            {visibleTemplates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  border: '1px solid #d5e6dc',
                  borderRadius: 12,
                  padding: 12,
                  background: '#f8fbf9',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {tpl.parsedImageUrl ? (
                    <img
                      src={tpl.parsedImageUrl}
                      alt={tpl.name}
                      onClick={() =>
                        setPreviewImg({ url: tpl.parsedImageUrl, name: tpl.name })
                      }
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        cursor: 'zoom-in',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 10,
                        border: '1px dashed #cbd5e1',
                        background: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        flexShrink: 0,
                      }}
                    >
                      {tpl.parsedCategory === 'Mâm quả' ? '🎁' : '🏮'}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span
                      className={`badge ${
                        tpl.parsedCategory === 'Mâm quả' ? 'badge-blue' : 'badge-green'
                      }`}
                      style={{ marginBottom: 4, display: 'inline-block' }}
                    >
                      {tpl.parsedCategory === 'Mâm quả' ? '🎁 Mâm quả' : '🏮 Gia tiên'}
                    </span>
                    <div className="font-bold text-sm" style={{ wordBreak: 'break-word' }}>
                      {tpl.name}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary btn-block"
                  onClick={() => handleAddTemplateToQuote(tpl)}
                >
                  + Đưa mẫu này vào Báo giá
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BƯỚC 2: BẢNG PHƯƠNG ÁN TRANG TRÍ & GIÁ TRỊ HỢP ĐỒNG */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div>
            <h3>2. Phương án Trang trí & Báo giá Hợp đồng ({quoteLines.length} mẫu đã chọn)</h3>
            <p className="text-xs text-muted">
              Hiển thị hình ảnh các Set trang trí đã chọn cùng <strong>Giá trị hợp đồng</strong> trọn
              gói để xuất Ảnh Báo Giá (.png) gửi khách hàng
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleAddCustomLine}
            >
              + Thêm hạng mục khác
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handlePushSetsToPlan}
              disabled={quoteLines.length === 0}
              title="Đưa toàn bộ vật tư của các Set trong báo giá sang tab Kế hoạch vật tư"
            >
              📋 Nạp vật tư sang Kế hoạch
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleExportExcel}
              disabled={quoteLines.length === 0}
            >
              📥 Xuất Excel
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleExportPng}
              disabled={exportingPng || quoteLines.length === 0}
            >
              {exportingPng ? '⏳ Đang tạo ảnh...' : '🖼️ Xuất Ảnh Báo Giá (.png)'}
            </button>
          </div>
        </div>

        {quoteLines.length === 0 ? (
          <div className="empty-state">
            Chưa có mẫu set nào trong báo giá. Hãy bấm{' '}
            <strong>&ldquo;+ Đưa mẫu này vào Báo giá&rdquo;</strong> ở danh sách Mẫu set phía trên!
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Hình ảnh mẫu</th>
                    <th style={{ width: 165 }}>Phân loại</th>
                    <th>Tên Mẫu Set & Các vật tư trong gói</th>
                    <th style={{ width: 55 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {quoteLines.map((line) => (
                    <tr key={line.uid}>
                      <td>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            alignItems: 'center',
                          }}
                        >
                          {line.image_url ? (
                            <img
                              src={line.image_url}
                              alt={line.name}
                              onClick={() =>
                                setPreviewImg({ url: line.image_url, name: line.name })
                              }
                              style={{
                                width: 72,
                                height: 72,
                                objectFit: 'cover',
                                borderRadius: 10,
                                border: '1px solid #cbd5e1',
                                cursor: 'zoom-in',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 72,
                                height: 72,
                                borderRadius: 10,
                                border: '1px dashed #cbd5e1',
                                background: '#f8fafc',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 22,
                              }}
                            >
                              🖼️
                            </div>
                          )}
                          <label
                            className="btn-link"
                            style={{ fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}
                          >
                            Đổi ảnh
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) =>
                                handleLineImageUpload(line.uid, e.target.files?.[0])
                              }
                            />
                          </label>
                        </div>
                      </td>
                      <td>
                        <select
                          value={line.category || 'Gia tiên'}
                          onChange={(e) =>
                            handleUpdateLine(line.uid, 'category', e.target.value)
                          }
                        >
                          {SET_CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                          <option value="Hạng mục khác">✨ Hạng mục khác</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          placeholder="Tên gói set trang trí..."
                          value={line.name}
                          onChange={(e) =>
                            handleUpdateLine(line.uid, 'name', e.target.value)
                          }
                          style={{ fontWeight: 600, marginBottom: 6 }}
                        />
                        <input
                          type="text"
                          placeholder="Các vật tư trong gói / Ghi chú (chỉ hiện tên vật tư, không hiện số lượng)..."
                          value={line.note || ''}
                          onChange={(e) =>
                            handleUpdateLine(line.uid, 'note', e.target.value)
                          }
                          style={{ fontSize: '0.82rem', color: '#475569' }}
                        />
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          style={{ color: '#dc2626', borderColor: '#fecaca' }}
                          onClick={() => handleRemoveLine(line.uid)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Khung Giá trị hợp đồng hiển thị trên Báo giá */}
            <div
              className="sub-card"
              style={{
                marginTop: 16,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 16,
                alignItems: 'end',
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label>Ghi chú cuối Phiếu Báo Giá</label>
                <input
                  type="text"
                  placeholder="VD: Giá trọn gói đã bao gồm lắp đặt & tháo dỡ..."
                  value={quoteNote}
                  onChange={(e) => {
                    setQuoteNote(e.target.value)
                    persistQuote(quoteLines, e.target.value)
                  }}
                />
              </div>

              {isManagerOrAdmin && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 12,
                      alignItems: 'start',
                    }}
                  >
                    <ContractValueFields
                      key={`${project?.id}-${finalTotal}-${safeDiscount}`}
                      grossSales={packagePrice}
                      discount={safeDiscount}
                      canEdit
                      canSeeDiscount
                      onChange={(v) => setDraftFinance(v)}
                      onValidChange={(ok) => setFinanceValid(ok)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ whiteSpace: 'nowrap', marginTop: 8 }}
                    disabled={savingContract || !financeValid || !draftFinance}
                    onClick={handleSaveFinance}
                  >
                    {savingContract ? 'Đang lưu...' : 'Lưu giá HĐ & ưu đãi'}
                  </button>
                  {saveError && (
                    <div style={{ color: '#dc2626', fontSize: '0.85em', marginTop: 4 }}>
                      {saveError}
                    </div>
                  )}
                </div>
              )}

              <div style={{ textAlign: 'right' }}>
                {safeDiscount > 0 && (
                  <div className="text-xs text-muted">
                    Giá gói: {formatCurrency(packagePrice)} • Ưu đãi: -{formatCurrency(safeDiscount)}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    color: '#15803d',
                    marginTop: 4,
                  }}
                >
                  {safeDiscount > 0 ? 'Giá trị thanh toán' : 'Giá trị hợp đồng'}: {formatCurrency(finalTotal)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Lightbox phóng to ảnh */}
      {previewImg && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewImg(null)}
          style={{ zIndex: 100 }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 680, textAlign: 'center' }}
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
                  maxHeight: '72vh',
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
