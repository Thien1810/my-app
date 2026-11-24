import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { buildTemplateWorkbookData, parsePurchaseRows } from '../lib/purchaseImport'
import './PurchaseExcelImport.css'

const MAX_BYTES = 2 * 1024 * 1024
const STATUS_ICON = { ok: '✅', warn: '⚠️', error: '❌' }
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('vi-VN') : '—')

export default function PurchaseExcelImport({ items, disabled, onApply }) {
  const inputRef = useRef(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')

  function downloadTemplate() {
    const data = buildTemplateWorkbookData(items || [])
    const wb = XLSX.utils.book_new()
    const sheets = [
      ['Nhập hàng', data.nhapHang, [16, 34, 12, 20, 28]],
      ['Hướng dẫn', data.huongDan, [120]],
      ['Danh mục vật tư', data.danhMuc, [18, 36, 10, 26, 22]],
    ]
    for (const [name, aoa, widths] of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = widths.map((wch) => ({ wch }))
      XLSX.utils.book_append_sheet(wb, ws, name)
    }
    XLSX.writeFile(wb, 'file-mau-nhap-hang.xlsx')
  }

  function close() {
    setResult(null)
    setError('')
    setFileName('')
  }

  async function handleFile(e) {
    const input = e.target
    const file = input.files && input.files[0]
    input.value = ''
    if (!file) return
    setResult(null)
    setError('')
    setFileName(file.name)
    if (file.size > MAX_BYTES) {
      setError('File quá lớn (tối đa 2MB). Hãy giảm bớt dòng hoặc bỏ ảnh/định dạng thừa.')
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheetName = wb.SheetNames.includes('Nhập hàng') ? 'Nhập hàng' : wb.SheetNames[0]
      if (!sheetName) {
        setError('File không có sheet nào.')
        return
      }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
      const parsed = parsePurchaseRows(rows, items || [])
      if (parsed.fatal) {
        setError(parsed.fatal)
        return
      }
      setResult(parsed)
    } catch {
      setError('Không đọc được file. Hãy kiểm tra file là Excel (.xlsx, .xls) hoặc CSV hợp lệ rồi thử lại.')
    }
  }

  function apply() {
    if (!result || result.summary.error > 0) return
    const lines = result.lines
      .filter((l) => l.status === 'ok' || l.status === 'warn')
      .map((l) => ({
        item_id: String(l.item_id),
        qty: Number(l.qty),
        unit_cost: Number(l.unit_cost),
        note: l.note || '',
      }))
    onApply(lines)
    close()
  }

  const s = result?.summary

  return (
    <div className="pei">
      <div className="pei-actions">
        <button type="button" className="pei-btn pei-btn-outline" onClick={downloadTemplate} disabled={disabled}>
          📥 Tải file mẫu Excel
        </button>
        <button
          type="button"
          className="pei-btn pei-btn-primary"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          📤 Nhập từ Excel
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="pei-file"
          onChange={handleFile}
        />
      </div>

      {error && (
        <div className="pei-panel pei-panel-error" role="alert">
          <p>❌ {error}</p>
          <button type="button" className="pei-btn pei-btn-outline" onClick={close}>Đóng</button>
        </div>
      )}

      {result && (
        <div className="pei-panel">
          <div className="pei-head">
            <strong>Xem trước{fileName ? `: ${fileName}` : ''}</strong>
            <span className="pei-summary">
              {s.ok} dòng hợp lệ, {s.warn} cảnh báo, {s.error} lỗi
            </span>
          </div>
          <div className="table-responsive pei-table-wrap">
            <table className="pei-table">
              <thead>
                <tr>
                  <th>Dòng Excel</th>
                  <th>Mã</th>
                  <th>Tên (từ danh mục)</th>
                  <th className="pei-num">SL</th>
                  <th className="pei-num">Đơn giá</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.rowNo} className={`pei-row-${l.status}`}>
                    <td>{l.rowNo}</td>
                    <td>{l.code || '—'}</td>
                    <td>{l.name || '—'}</td>
                    <td className="pei-num">{fmt(l.qty)}{l.unit ? ` ${l.unit}` : ''}</td>
                    <td className="pei-num">{fmt(l.unit_cost)}</td>
                    <td>
                      {STATUS_ICON[l.status]} {l.status === 'ok' ? 'Hợp lệ' : l.messages.join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.error > 0 && <p className="pei-hint-error">Có dòng lỗi. Sửa file rồi tải lại.</p>}
          <div className="pei-footer">
            <button type="button" className="pei-btn pei-btn-outline" onClick={close}>Hủy</button>
            <button
              type="button"
              className="pei-btn pei-btn-primary"
              onClick={apply}
              disabled={s.error > 0 || s.ok + s.warn === 0}
            >
              Đổ {s.ok + s.warn} dòng vào phiếu
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
