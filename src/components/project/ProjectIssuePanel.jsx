import ProjectFeedback from './ProjectFeedback'
import ItemPicker from '../ItemPicker'

export default function ProjectIssuePanel({
  canEditCatalog, feedback, items, issueBlock, issueDate, setIssueDate, issueNote, setIssueNote,
  issueLines, busyIssue, handleIssueByPlan, handleManualIssue, handleAddIssueLine, handleIssueLineChange,
  handleRemoveIssueLine,
}) {
  return (
    <div className="card ui-card">
      <div className="card-header">
        <div>
          <h3>📤 Xuất vật tư cho dự án</h3>
          <p className="text-xs text-muted">
            Xuất nhanh toàn bộ vật tư còn thiếu theo kế hoạch chỉ với 1 cú nhấp chuột, hoặc thêm
            dòng xuất lẻ bổ sung.
          </p>
        </div>
        {canEditCatalog && (
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            onClick={handleIssueByPlan}
            disabled={busyIssue || !!issueBlock}
            title={issueBlock || undefined}
          >
            Xuất theo kế hoạch
          </button>
        )}
      </div>

      <ProjectFeedback feedback={feedback.issueByPlan} />
      {issueBlock && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          🔒 {issueBlock}
        </div>
      )}

      {canEditCatalog && (
        <form onSubmit={handleManualIssue} className="sub-card ui-card ui-has-sticky-bar" style={{ marginTop: 12 }}>
          <h4>Xuất kho thủ công / Xuất bổ sung</h4>
          <div className="form-grid-2" style={{ marginTop: 10 }}>
            <div className="form-group">
              <label>Ngày xuất kho *</label>
              <input className="ui-input"
                type="date"
                required
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Ghi chú phiếu xuất</label>
              <input className="ui-input"
                type="text"
                placeholder="VD: Xuất đợt 1 lên xe tải..."
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
              />
            </div>
          </div>

          <div className="project-issue-table" style={{ marginTop: 10 }}>
            <table className="data-table ui-table">
              <thead>
                <tr>
                  <th>Vật tư *</th>
                  <th style={{ width: 150 }}>Số lượng xuất *</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {issueLines.map((line, idx) => (
                  <tr key={line.key}>
                    <td className="ui-table__primary" data-label="Vật tư">
                      <ItemPicker
                        items={items}
                        value={line.item_id}
                        ariaLabel={`Vật tư dòng ${idx + 1}`}
                        required
                        onChange={(value) => handleIssueLineChange(line.key, { item_id: value })}
                      />
                    </td>
                    <td data-label="Số lượng xuất">
                      <input className="ui-input"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        aria-label={`Số lượng xuất dòng ${idx + 1}`}
                        step="any"
                        required
                        value={line.qty}
                        onChange={(e) => handleIssueLineChange(line.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="ui-table__actions text-right" data-label="Bỏ dòng">
                      {issueLines.length > 1 && (
                        <button
                          type="button"
                          className="ui-btn ui-btn--secondary"
                          aria-label={`Bỏ dòng ${idx + 1}`}
                          onClick={() => handleRemoveIssueLine(line.key)}
                        >
                          ✕ Bỏ dòng
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="ui-btn ui-btn--secondary project-issue-add"
            onClick={handleAddIssueLine}
          >
            + Thêm dòng
          </button>

          <div className="ui-sticky-bar project-actions-bar">
            <ProjectFeedback feedback={feedback.issueManual} />
            <button type="submit" className="ui-btn ui-btn--primary" disabled={busyIssue || !!issueBlock}>
              {busyIssue ? 'Đang xử lý...' : 'Lưu phiếu xuất dự án'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
