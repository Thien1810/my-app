import { useState, useMemo } from 'react'
import { useAuth } from '../lib/AuthContext'
import { todayISO } from '../lib/formatters'
import { useFinanceData } from '../lib/useFinanceData'
import { calcPnl } from '../lib/pnl'
import { toPnlProjects, buildPnlHistory, calcBySource } from '../lib/pnlHistory'
import PnlPanel from './finance/PnlPanel'
import FixedCostsPanel from './finance/FixedCostsPanel'
import AdsLedgerPanel from './finance/AdsLedgerPanel'

const TARGET_GROUPS = [
  {
    title: '📍 Nhóm 1: Kho Chính Xuân Lộc, Đồng Nai (50% ngân sách)',
    badge: 'Bán kính 18km',
    badgeClass: 'badge-green',
    adset: 'KHO_XUANLOC_DONGNAI_18KM',
    adsetLabel: 'Tên nhóm quảng cáo Xuân Lộc',
    map: 'Xuân Lộc, Đồng Nai (18km) + TP. Long Khánh (10km)',
    audience: '23–33 tuổi • Đã đính hôn, Đám cưới, Áo dài cưới, Chụp ảnh cưới',
    url: 'https://dangwed.com/?utm_source=fb_ads&utm_campaign=kho_xuanloc_18km#bao-gia',
    urlLabel: 'Link UTM Kho Xuân Lộc',
    urlButton: '🔗 Copy Link UTM Xuân Lộc',
  },
  {
    title: '📍 Nhóm 2: Kho Trung Chuyển Vĩnh Lộc, TP.HCM (50% ngân sách)',
    badge: 'Bán kính 12km',
    badgeClass: 'badge-blue',
    adset: 'KHO_VINHLOC_TPHCM_12KM',
    adsetLabel: 'Tên nhóm quảng cáo Vĩnh Lộc',
    map: 'Vĩnh Lộc A/B, Bình Chánh (12km — ôm Bình Tân, Tân Phú, Q.12, Hóc Môn, Gò Vấp)',
    audience: '24–34 tuổi • Đã đính hôn, Đám cưới, Tổ chức sự kiện cưới, Trang sức cưới',
    url: 'https://dangwed.com/?utm_source=fb_ads&utm_campaign=kho_vinhloc_12km#bao-gia',
    urlLabel: 'Link UTM Kho Vĩnh Lộc',
    urlButton: '🔗 Copy Link UTM Vĩnh Lộc',
  },
]

// Mục Target 2 đầu kho + copy link UTM (nội dung giữ nguyên bản cũ).
function TargetUtmSection({ onCopied }) {
  const copyText = (txt, label) => {
    navigator.clipboard?.writeText(txt)
    onCopied(`Đã copy ${label}!`)
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ marginBottom: 6 }}>
        🎯 Cấu trúc Target Chuẩn 2 Đầu Kho & Link UTM Theo Dõi Nguồn Khách Tự Động
      </h3>
      <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        Copy nhanh thông số thả ghim bản đồ và đường dẫn UTM gắn vào bài quảng cáo để khi khách đặt
        lịch trên <strong>dangwed.com</strong> và chuyển thành Dự án, hệ thống tự động gắn nhãn{' '}
        <strong>Kho Xuân Lộc</strong> hoặc <strong>Kho Vĩnh Lộc</strong>.
      </p>

      <div className="form-grid-2">
        {TARGET_GROUPS.map((g) => (
          <div key={g.adset} className="sub-card" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <strong style={{ color: '#163828', fontSize: 15 }}>{g.title}</strong>
              <span className={`badge ${g.badgeClass}`}>{g.badge}</span>
            </div>
            <ul style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, marginBottom: 12 }}>
              <li>
                <strong>Tên nhóm chuẩn:</strong> <code>{g.adset}</code>
              </li>
              <li>
                <strong>Thả ghim bản đồ:</strong> {g.map}
              </li>
              <li>
                <strong>Độ tuổi & Sở thích:</strong> {g.audience}
              </li>
            </ul>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => copyText(g.url, g.urlLabel)}
              >
                {g.urlButton}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => copyText(g.adset, g.adsetLabel)}
              >
                📋 Copy Tên AdSet
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MetaAdsManagerTab({ projectProfitReport = [] }) {
  const { isManagerOrAdmin } = useAuth()

  const [selectedMonth, setSelectedMonth] = useState(() => todayISO().slice(0, 7))
  const [viewScope, setViewScope] = useState('all') // 'all' | mã kho

  const {
    adsRows,
    fixedCosts,
    templates,
    shares,
    warehouses,
    isLocked,
    notice,
    setNotice,
    actions,
  } = useFinanceData({ month: selectedMonth })

  const projects = useMemo(() => toPnlProjects(projectProfitReport), [projectProfitReport])

  const pnl = useMemo(() => {
    const history = buildPnlHistory({ projects, month: selectedMonth, scope: viewScope })
    // Tạm ứng/forfeit (advances) sẽ nối sau khi có giao diện tạm ứng.
    return calcPnl({
      month: selectedMonth,
      scope: viewScope,
      projects,
      adsRows,
      fixedCosts,
      shares,
      advances: [],
      history,
    })
  }, [projects, selectedMonth, viewScope, adsRows, fixedCosts, shares])

  const bySource = useMemo(
    () => calcBySource({ projects, month: selectedMonth, scope: viewScope }),
    [projects, selectedMonth, viewScope],
  )

  // Bảo vệ nghiêm ngặt: Chỉ Quản lý (manager) & Quản trị (admin) mới được xem.
  // Đặt sau toàn bộ hook để thứ tự gọi hook luôn cố định (rules-of-hooks).
  if (!isManagerOrAdmin) {
    return null
  }

  const noticeClass =
    notice?.type === 'error'
      ? 'alert-error'
      : notice?.type === 'success'
        ? 'alert-success'
        : 'alert-info'

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: 'linear-gradient(135deg, #163828 0%, #1e4633 100%)',
          color: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 17 }}>🏛️ Báo Cáo Quản Trị P&L</strong>
            <span
              className="badge"
              style={{
                background: 'rgba(255,255,255,0.18)',
                color: '#fef08a',
                border: '1px solid rgba(254,240,138,0.4)',
              }}
            >
              🔒 Chỉ Quản trị & Quản lý
            </span>
            {isLocked && (
              <span className="badge badge-amber">🔒 Đã khóa sổ</span>
            )}
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            Đồng bộ tự động từ Meta sẽ được bổ sung sau (token không lưu trên trình duyệt).
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={viewScope}
            onChange={(e) => setViewScope(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              color: '#163828',
            }}
          >
            <option value="all">Tất cả</option>
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.name || w.code}
              </option>
            ))}
          </select>

          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              color: '#163828',
            }}
          />
        </div>
      </div>

      {notice && (
        <div
          className={`alert ${noticeClass}`}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Đóng thông báo"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      <PnlPanel
        pnl={pnl}
        bySource={bySource}
        month={selectedMonth}
        scope={viewScope}
        warehouses={warehouses}
      />

      <FixedCostsPanel
        month={selectedMonth}
        scope={viewScope}
        rows={fixedCosts}
        templates={templates}
        warehouses={warehouses}
        isLocked={isLocked}
        canWrite={isManagerOrAdmin}
        onAdd={actions.addFixedCost}
        onRemove={actions.removeFixedCost}
        onApplyTemplates={actions.applyTemplates}
        onSaveAsTemplate={actions.saveMonthAsTemplate}
      />

      <AdsLedgerPanel
        month={selectedMonth}
        scope={viewScope}
        rows={adsRows}
        warehouses={warehouses}
        isLocked={isLocked}
        canWrite={isManagerOrAdmin}
        onAdd={actions.addAdsRow}
        onRemove={actions.removeAdsRow}
      />

      <TargetUtmSection onCopied={(text) => setNotice({ type: 'success', text })} />
    </div>
  )
}
