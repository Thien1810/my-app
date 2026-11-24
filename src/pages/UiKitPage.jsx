import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

// Trang style guide của UI kit (chỉ admin, không nằm trong menu). Dữ liệu giả, không gọi Supabase.

const COLOR_TOKENS = [
  ['--primary', 'Chính (xanh lá)'],
  ['--primary-hover', 'Chính, hover'],
  ['--primary-light', 'Chính, nhạt'],
  ['--accent', 'Nhấn phụ (nâu trầm)'],
  ['--accent-light', 'Nhấn phụ, nhạt'],
  ['--red', 'Nguy hiểm'],
  ['--amber', 'Cảnh báo'],
  ['--blue', 'Thông tin'],
  ['--bg', 'Nền'],
  ['--surface', 'Bề mặt'],
  ['--border', 'Viền'],
  ['--text-muted', 'Chữ phụ'],
]

const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8']

const ROWS = [
  { code: 'TSD-DEN-001', name: 'Đèn thả pha lê trang trí cổng hoa', qty: 12, status: 'success', statusLabel: 'Sẵn sàng', note: 'Kho Quận 7' },
  { code: 'TSD-BAN-014', name: 'Bàn tiệc tròn 10 người', qty: 3, status: 'warn', statusLabel: 'Sắp hết', note: 'Kho Thủ Đức' },
  { code: 'TH-HOA-102', name: 'Hoa hồng kem nhập khẩu', qty: 0, status: 'danger', statusLabel: 'Hết hàng', note: 'Kho Quận 7' },
]

function Section({ title, cls, children }) {
  return (
    <section className="ui-card">
      <div className="ui-card__header">
        {title} {cls && <code className="ui-text-muted" style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}>{cls}</code>}
      </div>
      <div className="ui-card__body ui-stack">{children}</div>
    </section>
  )
}

function Tag({ children }) {
  return <code className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>{children}</code>
}

export default function UiKitPage() {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState('a')
  const [seg, setSeg] = useState('day')
  const [modal, setModal] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!isAdmin) return <Navigate to="/" replace />

  const startLoading = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 1500)
  }

  return (
    <div className="ui-stack ui-stack--lg ui-has-sticky-bar" style={{ maxWidth: 1000 }}>
      <div>
        <h2>UI kit (style guide)</h2>
        <p className="ui-text-muted">Kiểm tra ở 375px / 768px / desktop. Trang chỉ để xem, dữ liệu giả, không ghi gì.</p>
      </div>

      <Section title="Màu và token" cls="tokens.css">
        <div className="ui-grid ui-grid--4">
          {COLOR_TOKENS.map(([v, label]) => (
            <div key={v} className="ui-row" style={{ flexWrap: 'nowrap' }}>
              <span style={{ width: 36, height: 36, flex: '0 0 36px', borderRadius: 'var(--radius-sm)', background: `var(${v})`, border: '1px solid var(--border)' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{label}</div>
                <Tag>{v}</Tag>
              </div>
            </div>
          ))}
        </div>
        <div className="ui-stack ui-stack--sm">
          {SPACES.map((s) => (
            <div key={s} className="ui-row" style={{ flexWrap: 'nowrap' }}>
              <span style={{ width: `var(${s})`, height: 12, background: 'var(--accent)', borderRadius: 2 }} />
              <Tag>{s}</Tag>
            </div>
          ))}
        </div>
        <div className="ui-text-muted">
          Cỡ chữ: <Tag>--fs-xs 11 / sm 13 / md 14 / lg 16 / xl 20 / 2xl 24</Tag>. Bo góc: <Tag>--radius-sm 6 / md 10 / lg 14</Tag>.
          Vùng bấm: <Tag>--tap 44 / --tap-sm 40</Tag>. Lớp: <Tag>--z-sticky 44 / nav 45 / modal 200 / toast 300</Tag>.
        </div>
      </Section>

      <Section title="Bố cục" cls=".ui-stack .ui-row .ui-grid--2/3/4 .ui-container .ui-hide-mobile .ui-show-mobile">
        <div className="ui-grid ui-grid--3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="ui-card ui-card__body">Ô lưới {n}</div>
          ))}
        </div>
        <div className="ui-hide-mobile ui-alert ui-alert--info">Chỉ hiện trên màn hình lớn (.ui-hide-mobile)</div>
        <div className="ui-show-mobile ui-alert ui-alert--warn">Chỉ hiện trên điện thoại (.ui-show-mobile)</div>
      </Section>

      <Section title="Nút" cls=".ui-btn --primary --secondary --danger --ghost --sm --block .is-loading .ui-btn-group">
        <div className="ui-btn-group ui-btn-group--end">
          <button type="button" className="ui-btn ui-btn--secondary">Hủy</button>
          <button type="button" className="ui-btn ui-btn--primary">Lưu</button>
        </div>
        <div className="ui-row">
          <button type="button" className="ui-btn ui-btn--primary">Chính</button>
          <button type="button" className="ui-btn ui-btn--secondary">Phụ (viền)</button>
          <button type="button" className="ui-btn ui-btn--danger">Xóa</button>
          <button type="button" className="ui-btn ui-btn--ghost">Ghost</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm">Nhỏ 40px</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled>Vô hiệu</button>
          <button type="button" className={`ui-btn ui-btn--primary${loading ? ' is-loading' : ''}`} onClick={startLoading}>Đang lưu (bấm thử)</button>
        </div>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block">Nút full-width (.ui-btn--block)</button>
        <div className="ui-segmented" role="group">
          {[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([k, l]) => (
            <button key={k} type="button" className={`ui-segmented__item${seg === k ? ' is-active' : ''}`} onClick={() => setSeg(k)}>{l}</button>
          ))}
        </div>
        <Tag>.ui-segmented / .ui-segmented__item.is-active</Tag>
      </Section>

      <Section title="Biểu mẫu" cls=".ui-field .ui-input .ui-select .ui-textarea .ui-hint .ui-error .is-invalid .ui-required .ui-form-grid--2">
        <div className="ui-form-grid ui-form-grid--2">
          <div className="ui-field">
            <label htmlFor="k1">Tên vật tư <span className="ui-required">*</span></label>
            <input id="k1" className="ui-input" defaultValue="Đèn thả pha lê" />
            <span className="ui-hint">Gợi ý: nhập tên dễ tìm.</span>
          </div>
          <div className="ui-field is-invalid">
            <label htmlFor="k2">Số lượng <span className="ui-required">*</span></label>
            <input id="k2" className="ui-input" defaultValue="-5" aria-invalid="true" />
            <span className="ui-error">Số lượng không được âm.</span>
          </div>
          <div className="ui-field ui-span-all">
            <label htmlFor="k3">Ô chọn có tên rất dài</label>
            <select id="k3" className="ui-select" defaultValue="long">
              <option value="long">Combo trang trí cổng hoa kèm backdrop sân khấu và bàn ký tên phong cách châu Âu 2026</option>
              <option value="short">Ngắn</option>
            </select>
          </div>
          <div className="ui-field ui-span-all">
            <label htmlFor="k4">Ghi chú</label>
            <textarea id="k4" className="ui-textarea" defaultValue="" placeholder="Nhập ghi chú..." />
          </div>
        </div>
      </Section>

      <Section title="Thẻ, huy hiệu, cảnh báo, trống" cls=".ui-card .ui-badge .ui-alert .ui-empty">
        <div className="ui-row">
          {['success', 'warn', 'danger', 'info', 'neutral', 'accent'].map((c) => (
            <span key={c} className={`ui-badge ui-badge--${c}`}>{c}</span>
          ))}
        </div>
        {['success', 'warn', 'danger', 'info'].map((c) => (
          <div key={c} className={`ui-alert ui-alert--${c}`}>Thông báo mẫu loại {c}.</div>
        ))}
        <div className="ui-card">
          <div className="ui-empty">
            <div className="ui-empty__title">Chưa có dữ liệu</div>
            Bấm "Thêm mới" để bắt đầu.
          </div>
        </div>
      </Section>

      <Section title="Tab" cls=".ui-tabs .ui-tab.is-active (cuộn ngang trên điện thoại)">
        <div className="ui-tabs" role="tablist">
          {[['a', 'Nhập hàng'], ['b', 'Chuyển kho'], ['c', 'Đồ hỏng'], ['d', 'Kiểm kho'], ['e', 'Báo cáo tháng']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="ui-text-muted">Nội dung tab: {tab.toUpperCase()}</div>
      </Section>

      <Section title="KPI" cls=".ui-kpi">
        <div className="ui-grid ui-grid--4">
          <div className="ui-kpi"><span className="ui-kpi__label">Doanh thu tháng</span><span className="ui-kpi__value">125.000.000</span><span className="ui-kpi__note">+8% so với tháng trước</span></div>
          <div className="ui-kpi"><span className="ui-kpi__label">Dự án đang chạy</span><span className="ui-kpi__value">14</span></div>
          <div className="ui-kpi"><span className="ui-kpi__label">Vật tư sắp hết</span><span className="ui-kpi__value">6</span></div>
          <div className="ui-kpi"><span className="ui-kpi__label">Biên lợi nhuận</span><span className="ui-kpi__value">32%</span></div>
        </div>
      </Section>

      <Section title="Bảng thành thẻ" cls=".ui-table td[data-label] .ui-table__primary .ui-col-hide-mobile .ui-table__actions">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Tên vật tư</th><th>Mã</th><th>Tồn</th><th>Trạng thái</th><th className="ui-col-hide-mobile">Kho</th><th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.code}>
                  <td data-label="Tên vật tư" className="ui-table__primary">{r.name}</td>
                  <td data-label="Mã">{r.code}</td>
                  <td data-label="Tồn">{r.qty}</td>
                  <td data-label="Trạng thái"><span className={`ui-badge ui-badge--${r.status}`}>{r.statusLabel}</span></td>
                  <td data-label="Kho" className="ui-col-hide-mobile">{r.note}</td>
                  <td data-label="Thao tác" className="ui-table__actions">
                    <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm">Sửa</button>
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm">Xem</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Hộp thoại" cls=".ui-modal-backdrop .ui-modal .ui-modal__header/__body/__footer">
        <div>
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => setModal(true)}>Mở thử hộp thoại</button>
        </div>
        <span className="ui-text-muted">Điện thoại: ngăn kéo dưới màn hình; desktop: giữa màn hình.</span>
      </Section>

      <Section title="Thanh dính đáy" cls=".ui-sticky-bar (+ .ui-has-sticky-bar ở trang)">
        <span className="ui-text-muted">Thanh bên dưới trang: trên điện thoại nằm trên thanh menu dưới, desktop là thanh thường.</span>
        <div className="ui-sr-only">Tiện ích: .ui-text-muted .ui-truncate .ui-nowrap .ui-sr-only</div>
        <div className="ui-truncate" style={{ maxWidth: 220 }}>.ui-truncate: chuỗi rất dài sẽ bị cắt bằng dấu ba chấm</div>
      </Section>

      <div className="ui-sticky-bar">
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div className="ui-text-muted" style={{ fontSize: 'var(--fs-sm)' }}>Tổng cộng</div>
          <strong>12.500.000</strong>
        </div>
        <button type="button" className="ui-btn ui-btn--primary">Lưu phiếu</button>
      </div>

      {modal && (
        <div className="ui-modal-backdrop" onClick={() => setModal(false)}>
          <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Hộp thoại mẫu" onClick={(e) => e.stopPropagation()}>
            <div className="ui-modal__header">Hộp thoại mẫu</div>
            <div className="ui-modal__body ui-stack">
              <p>Chỉ để xem, không ghi dữ liệu.</p>
              <div className="ui-field">
                <label htmlFor="m1">Ghi chú</label>
                <input id="m1" className="ui-input" />
              </div>
            </div>
            <div className="ui-modal__footer">
              <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setModal(false)}>Đóng</button>
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => setModal(false)}>Xác nhận</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
