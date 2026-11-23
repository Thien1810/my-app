import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { formatCurrency, formatNumber, formatDate, todayISO } from '../lib/formatters'
import CurrencyInput from './CurrencyInput'
import {
  WAREHOUSE_HUBS,
  PROJECT_LEAD_SOURCES,
  FIXED_COST_CATEGORIES,
  getSavedMetaAdsConfig,
  saveMetaAdsConfig,
  getSavedManualAdsLogs,
  saveManualAdsLogs,
  getSavedFixedCosts,
  saveFixedCosts,
  getSavedFixedCostTemplate,
  saveFixedCostTemplate,
  fetchMetaAdsInsights,
  getSampleTwoHubAdsInsights,
  evaluateAdPerformance,
  extractProjectAttribution,
} from '../lib/metaAdsClient'

export default function MetaAdsManagerTab({ projectProfitReport = [] }) {
  const { isManagerOrAdmin } = useAuth()

  // Kỳ báo cáo P&L theo tháng (YYYY-MM) hoặc Tất cả các tháng ('all')
  const [selectedMonth, setSelectedMonth] = useState(() => todayISO().slice(0, 7))
  const [viewScope, setViewScope] = useState('month') // 'month' | 'all'

  // Cấu hình Meta API
  const [config, setConfig] = useState(() => getSavedMetaAdsConfig())
  const [showConfigPanel, setShowConfigPanel] = useState(false)
  const [datePreset, setDatePreset] = useState('this_month')
  const [level, setLevel] = useState('ad')
  const [customSince, setCustomSince] = useState(() => `${todayISO().slice(0, 7)}-01`)
  const [customUntil, setCustomUntil] = useState(() => todayISO())

  // Dữ liệu Insights từ Meta API + Nhật ký Ads bổ sung (TikTok / Zalo / Google)
  const [apiRows, setApiRows] = useState([])
  const [manualLogs, setManualLogs] = useState(() => getSavedManualAdsLogs())
  const [syncingApi, setSyncingApi] = useState(false)
  const [apiNotice, setApiNotice] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Sổ Chi phí cứng / Phí cố định hàng tháng (Fixed Overhead Costs)
  const [fixedCosts, setFixedCosts] = useState(() => getSavedFixedCosts())
  const [fixedTemplate, setFixedTemplate] = useState(() => getSavedFixedCostTemplate())
  const [fixedForm, setFixedForm] = useState({
    category: FIXED_COST_CATEGORIES[0],
    title: '',
    hub: 'all', // 'all' | 'xuan_loc' | 'vinh_loc'
    amount: '',
    month: todayISO().slice(0, 7),
  })

  // Form thêm nhanh dòng Ads bổ sung (TikTok Boost Video 20% / Google / Meta nhập tay)
  const [manualForm, setManualForm] = useState({
    channel: 'TikTok Ads (20%)',
    hubId: 'xuan_loc',
    campaign_name: 'Boost Video Before/After Gia Tiên',
    spend: '',
    messages: '',
    date: todayISO(),
  })

  // Bảo vệ nghiêm ngặt: Chỉ Quản lý (manager) & Quản trị (admin) mới được xem
  if (!isManagerOrAdmin) {
    return null
  }

  const handleSaveConfig = (e) => {
    e.preventDefault()
    const saved = saveMetaAdsConfig(config)
    setConfig(saved)
    setSuccessMsg('✓ Đã lưu cấu hình Meta Marketing API & Ngưỡng KPI Ads.')
    setTimeout(() => setSuccessMsg(''), 3500)
  }

  const handleSyncFromMetaApi = async () => {
    setErrorMsg('')
    setSuccessMsg('')
    setApiNotice('')
    setSyncingApi(true)
    try {
      const rows = await fetchMetaAdsInsights({
        adAccountId: config.adAccountId,
        accessToken: config.accessToken,
        level,
        datePreset,
        since: customSince,
        until: customUntil,
        config,
      })
      setApiRows(rows)
      if (rows.length === 0) {
        setApiNotice(
          'Kết nối Meta API thành công nhưng chưa có chiến dịch nào phát sinh chi phí trong khoảng thời gian đã chọn.'
        )
      } else {
        setSuccessMsg(
          `✓ Đã kéo thành công ${rows.length} dòng chỉ số trực tiếp từ Meta Marketing API!`
        )
      }
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi khi gọi Meta Marketing API')
    } finally {
      setSyncingApi(false)
    }
  }

  const handleLoadSampleInsights = () => {
    setErrorMsg('')
    const sample = getSampleTwoHubAdsInsights(config, selectedMonth)
    setApiRows(sample)
    setApiNotice(
      `💡 Đang hiển thị bộ số liệu Meta API mô phỏng tháng ${selectedMonth} cho 2 Đầu Kho (Xuân Lộc 18km & Vĩnh Lộc 12km). Hệ thống đã tự động khớp vào Báo cáo Lợi nhuận ròng 3 tầng bên dưới.`
    )
  }

  // --- QUẢN LÝ SỔ CHI PHÍ CỨNG / PHÍ CỐ ĐỊNH HÀNG THÁNG ---
  const handleAddFixedCost = (e) => {
    e.preventDefault()
    const amt = Number(fixedForm.amount || 0)
    if (amt <= 0) {
      setErrorMsg('Vui lòng nhập Số tiền chi phí cứng cố định > 0.')
      return
    }
    const targetM = viewScope === 'month' ? selectedMonth : fixedForm.month || todayISO().slice(0, 7)
    const newEntry = {
      id: `fixed_${Date.now()}`,
      month: targetM,
      category: fixedForm.category,
      title: fixedForm.title.trim() || fixedForm.category,
      hub: fixedForm.hub || 'all',
      amount: amt,
      created_at: todayISO(),
    }
    const next = [newEntry, ...fixedCosts]
    setFixedCosts(next)
    saveFixedCosts(next)
    setFixedForm((prev) => ({ ...prev, title: '', amount: '' }))
    setSuccessMsg(`✓ Đã ghi nhận khoản Chi phí cứng cố định vào tháng ${targetM}.`)
  }

  const handleDeleteFixedCost = (id) => {
    const next = fixedCosts.filter((c) => c.id !== id)
    setFixedCosts(next)
    saveFixedCosts(next)
  }

  const handleApplyMonthlyFixedTemplate = () => {
    const targetM = selectedMonth || todayISO().slice(0, 7)
    const existingInMonth = fixedCosts.filter((c) => c.month === targetM)
    if (
      existingInMonth.length > 0 &&
      !window.confirm(
        `Tháng ${targetM} đang có ${existingInMonth.length} khoản chi phí cứng. Anh có muốn nạp bộ Định mức Chi phí cứng mặc định (ghi đè các mục trùng tên) cho tháng ${targetM} không?`
      )
    ) {
      return
    }

    const filteredOut = fixedCosts.filter((c) => c.month !== targetM)
    const generated = fixedTemplate.map((tpl, idx) => ({
      id: `fixed_${targetM}_${idx}_${Date.now()}`,
      month: targetM,
      category: tpl.category,
      title: tpl.title,
      hub: tpl.hub || 'all',
      amount: Number(tpl.amount || 0),
      created_at: todayISO(),
    }))
    const next = [...generated, ...filteredOut]
    setFixedCosts(next)
    saveFixedCosts(next)
    setSuccessMsg(
      `✓ Đã nạp ${generated.length} khoản Chi phí cứng định mức vào tháng ${targetM}!`
    )
  }

  const handleSaveCurrentMonthAsTemplate = () => {
    const inMonth = fixedCosts.filter((c) => c.month === selectedMonth)
    if (inMonth.length === 0) {
      setErrorMsg(`Tháng ${selectedMonth} chưa có khoản chi phí cứng nào để lưu làm định mức.`)
      return
    }
    const nextTpl = inMonth.map((c) => ({
      category: c.category,
      title: c.title,
      hub: c.hub || 'all',
      amount: Number(c.amount || 0),
    }))
    setFixedTemplate(nextTpl)
    saveFixedCostTemplate(nextTpl)
    setSuccessMsg(
      `✓ Đã lưu ${nextTpl.length} khoản chi phí cứng của tháng ${selectedMonth} làm Định mức chuẩn cho các tháng sau!`
    )
  }

  // --- QUẢN LÝ SỔ CHI PHÍ ADS BỔ SUNG (TIKTOK / GOOGLE / NHẬP TAY) ---
  const handleAddManualAdsLog = (e) => {
    e.preventDefault()
    const spendNum = Number(manualForm.spend || 0)
    if (spendNum <= 0 || !manualForm.campaign_name.trim()) {
      setErrorMsg('Vui lòng nhập Tên chiến dịch và Số tiền đã chi > 0.')
      return
    }
    const msgNum = Number(manualForm.messages || 0)
    const evalMeta = evaluateAdPerformance({
      spend: spendNum,
      totalResults: msgNum,
      config,
    })
    const hubObj =
      WAREHOUSE_HUBS.find((h) => h.id === manualForm.hubId) || WAREHOUSE_HUBS[0]
    const dateStr = manualForm.date || todayISO()
    const newRow = {
      id: `manual_${Date.now()}`,
      campaign_name: manualForm.campaign_name.trim(),
      adset_name: manualForm.channel,
      ad_name: manualForm.campaign_name.trim(),
      hubId: hubObj.id,
      hubTag: hubObj.label,
      spend: spendNum,
      impressions: 0,
      reach: 0,
      clicks: 0,
      ctr: 0,
      cpc: 0,
      messages: msgNum,
      leads: 0,
      totalResults: msgNum,
      cpl: evalMeta.cpl,
      status: evalMeta.status,
      badgeCls: evalMeta.badgeCls,
      statusLabel: evalMeta.label,
      date_start: dateStr,
      date_stop: dateStr,
      month: dateStr.slice(0, 7),
      source: manualForm.channel,
      isManual: true,
    }
    const nextLogs = [newRow, ...manualLogs]
    setManualLogs(nextLogs)
    saveManualAdsLogs(nextLogs)
    setManualForm((prev) => ({ ...prev, spend: '', messages: '' }))
    setSuccessMsg('✓ Đã ghi nhận khoản chi phí Ads vào Sổ Marketing.')
  }

  const handleDeleteManualLog = (id) => {
    const next = manualLogs.filter((l) => l.id !== id)
    setManualLogs(next)
    saveManualAdsLogs(next)
  }

  // --- LỌC DỮ LIỆU THEO KỲ ĐANG XEM (THÁNG HOẶC TOÀN BỘ) ---
  const filteredProjectsReport = useMemo(() => {
    return projectProfitReport
      .filter((r) => {
        if (r.project?.status === 'cancelled') return false
        if (viewScope === 'all') return true
        const d = r.project?.start_date || r.project?.end_date || String(r.project?.created_at || '')
        return d.startsWith(selectedMonth)
      })
      .map((r) => ({
        ...r,
        attr: extractProjectAttribution(r.project),
      }))
  }, [projectProfitReport, viewScope, selectedMonth])

  const filteredFixedCosts = useMemo(() => {
    if (viewScope === 'all') return fixedCosts
    return fixedCosts.filter((c) => c.month === selectedMonth)
  }, [fixedCosts, viewScope, selectedMonth])

  const filteredAdsRows = useMemo(() => {
    const combined = [...apiRows, ...manualLogs]
    if (viewScope === 'all') return combined
    return combined.filter((r) => {
      const m = r.month || String(r.date_stop || r.date_start || '').slice(0, 7)
      return !m || m === selectedMonth
    })
  }, [apiRows, manualLogs, viewScope, selectedMonth])

  // --- TỔNG HỢP BÁO CÁO P&L 3 TẦNG + ĐIỂM HÒA VỐN + CAC THEO KHO ---
  const pnlSummary = useMemo(() => {
    // Tầng 1: Doanh thu & Chi phí xoay vòng tại các đám cưới (Rotating Project Costs)
    const projectCount = filteredProjectsReport.length
    const totalRevenue = filteredProjectsReport.reduce((s, r) => s + Number(r.contractValue || 0), 0)
    const totalConsumable = filteredProjectsReport.reduce((s, r) => s + Number(r.consumableCost || 0), 0)
    const totalDepreciation = filteredProjectsReport.reduce((s, r) => s + Number(r.depreciationCost || 0), 0)
    const totalDamagedLost = filteredProjectsReport.reduce((s, r) => s + Number(r.damagedLostCost || 0), 0)
    const totalDirectOther = filteredProjectsReport.reduce((s, r) => s + Number(r.otherCostTotal || 0), 0)
    const totalRotatingCost =
      totalConsumable + totalDepreciation + totalDamagedLost + totalDirectOther
    const grossProfit = totalRevenue - totalRotatingCost
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

    // Tầng 2A: Chi phí Marketing & Ads trong kỳ
    const totalAdsSpend = filteredAdsRows.reduce((s, r) => s + Number(r.spend || 0), 0)
    const totalAdsMessages = filteredAdsRows.reduce((s, r) => s + Number(r.totalResults || 0), 0)
    const avgCpl = totalAdsMessages > 0 ? Math.round(totalAdsSpend / totalAdsMessages) : 0

    // Số dự án có nguồn từ Quảng cáo trả phí (Meta Ads / TikTok Ads)
    const paidAdsProjects = filteredProjectsReport.filter((r) => r.attr.isPaidAds)
    const paidAdsProjectCount = paidAdsProjects.length
    const paidAdsRevenue = paidAdsProjects.reduce((s, r) => s + Number(r.contractValue || 0), 0)
    const cacPerWedding =
      paidAdsProjectCount > 0 ? Math.round(totalAdsSpend / paidAdsProjectCount) : 0
    const roas = totalAdsSpend > 0 ? totalRevenue / totalAdsSpend : 0
    const cirPct = totalRevenue > 0 ? (totalAdsSpend / totalRevenue) * 100 : 0

    // Tầng 2B: Chi phí cứng / Phí cố định hàng tháng (Fixed Overhead Costs)
    const totalFixedCost = filteredFixedCosts.reduce((s, c) => s + Number(c.amount || 0), 0)

    // Tầng 3: Lợi nhuận ròng bỏ túi (Net Profit) & Điểm hòa vốn (Break-Even Point)
    const totalOperatingOverhead = totalAdsSpend + totalFixedCost
    const netProfit = grossProfit - totalOperatingOverhead
    const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

    // Lãi gộp trung bình mỗi đám cưới -> Cần bao nhiêu đám để bù đủ (Chi phí cứng + Chi phí Ads)
    const avgGrossProfitPerWedding =
      projectCount > 0 ? grossProfit / projectCount : 4000000 // mặc định ước tính 4tr lãi gộp/đám nếu tháng mới chưa có đám
    const breakEvenWeddings =
      avgGrossProfitPerWedding > 0
        ? Math.ceil(totalOperatingOverhead / avgGrossProfitPerWedding)
        : 0

    // Bóc tách hiệu quả theo 2 Đầu Kho (Kho Xuân Lộc vs. Kho Vĩnh Lộc)
    const byHub = WAREHOUSE_HUBS.map((h) => {
      const hubProjects = filteredProjectsReport.filter((r) => r.attr.hub === h.id)
      const hubAdsProj = hubProjects.filter((r) => r.attr.isPaidAds)
      const hubRevenue = hubProjects.reduce((s, r) => s + Number(r.contractValue || 0), 0)
      const hubRotatingCost = hubProjects.reduce((s, r) => s + Number(r.totalCost || 0), 0)
      const hubGrossProfit = hubRevenue - hubRotatingCost

      const hubAdsSpend = filteredAdsRows
        .filter((a) => a.hubId === h.id)
        .reduce((s, a) => s + Number(a.spend || 0), 0)
      const hubMessages = filteredAdsRows
        .filter((a) => a.hubId === h.id)
        .reduce((s, a) => s + Number(a.totalResults || 0), 0)
      const hubCac = hubAdsProj.length > 0 ? Math.round(hubAdsSpend / hubAdsProj.length) : 0
      const hubRoas = hubAdsSpend > 0 ? hubRevenue / hubAdsSpend : 0

      return {
        hub: h,
        projectCount: hubProjects.length,
        paidAdsProjectCount: hubAdsProj.length,
        revenue: hubRevenue,
        rotatingCost: hubRotatingCost,
        grossProfit: hubGrossProfit,
        adsSpend: hubAdsSpend,
        messages: hubMessages,
        cac: hubCac,
        roas: hubRoas,
        netBeforeSharedFixed: hubGrossProfit - hubAdsSpend,
      }
    })

    // Bóc tách theo Nguồn khách hàng
    const bySource = PROJECT_LEAD_SOURCES.map((src) => {
      const srcProjects = filteredProjectsReport.filter((r) => r.attr.source === src.id)
      const srcRevenue = srcProjects.reduce((s, r) => s + Number(r.contractValue || 0), 0)
      const srcGross = srcProjects.reduce((s, r) => s + Number(r.profit || 0), 0)
      const aov = srcProjects.length > 0 ? Math.round(srcRevenue / srcProjects.length) : 0
      return {
        source: src,
        count: srcProjects.length,
        revenue: srcRevenue,
        grossProfit: srcGross,
        aov,
      }
    })

    return {
      projectCount,
      totalRevenue,
      totalConsumable,
      totalDepreciation,
      totalDamagedLost,
      totalDirectOther,
      totalRotatingCost,
      grossProfit,
      grossMarginPct,
      totalAdsSpend,
      totalAdsMessages,
      avgCpl,
      paidAdsProjectCount,
      paidAdsRevenue,
      cacPerWedding,
      roas,
      cirPct,
      totalFixedCost,
      totalOperatingOverhead,
      netProfit,
      netMarginPct,
      avgGrossProfitPerWedding,
      breakEvenWeddings,
      byHub,
      bySource,
    }
  }, [filteredProjectsReport, filteredAdsRows, filteredFixedCosts])

  const copyText = (txt, label) => {
    navigator.clipboard?.writeText(txt)
    setSuccessMsg(`✓ Đã copy ${label}!`)
    setTimeout(() => setSuccessMsg(''), 2500)
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* HEADER CHỌN KỲ P&L & PHÂN QUYỀN */}
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
            <strong style={{ fontSize: 17 }}>
              🏛️ Báo Cáo Quản Trị P&L 3 Tầng: Chi Phí Xoay Vòng • Chi Phí Cứng • Chi Phí Ads
            </strong>
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
          </div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            Kiến trúc chuẩn ERP không trùng luồng: Tách riêng <strong>Chi phí xoay vòng tại đám</strong>,{' '}
            <strong>Chi phí cứng cố định tháng</strong> và <strong>Sổ Ads Meta API</strong>.
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
            <option value="month">Theo Tháng</option>
            <option value="all">Tất cả các kỳ</option>
          </select>

          {viewScope === 'month' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                color: '#163828',
              }}
            />
          )}

          <button
            type="button"
            className="btn btn-sm"
            style={{ background: '#fff', color: '#163828', fontWeight: 600 }}
            onClick={() => setShowConfigPanel((v) => !v)}
          >
            ⚙️ {showConfigPanel ? 'Ẩn cấu hình API' : 'Cấu hình Meta API'}
          </button>

          <button
            type="button"
            className="btn btn-sm"
            style={{
              background: 'rgba(255,255,255,0.16)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.35)',
            }}
            onClick={handleLoadSampleInsights}
          >
            🧪 Nạp số liệu Ads mẫu
          </button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {apiNotice && <div className="alert alert-warning">{apiNotice}</div>}

      {/* 1. BẢNG TỔNG HỢP P&L 3 TẦNG & ĐIỂM HÒA VỐN */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">1️⃣ Doanh thu & Chi phí Xoay vòng</div>
          <div className="kpi-value">{formatCurrency(pnlSummary.totalRevenue)}</div>
          <div className="kpi-sub">
            {pnlSummary.projectCount} đám • Chi phí xoay vòng:{' '}
            <strong>{formatCurrency(pnlSummary.totalRotatingCost)}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">2️⃣ Lãi Gộp Thi Công (Gross Profit)</div>
          <div className="kpi-value text-green">{formatCurrency(pnlSummary.grossProfit)}</div>
          <div className="kpi-sub">
            Biên lãi gộp thi công: <strong>{pnlSummary.grossMarginPct.toFixed(1)}%</strong> (TB{' '}
            {formatCurrency(Math.round(pnlSummary.avgGrossProfitPerWedding))}/đám)
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">3️⃣ Chi phí Cứng + Chi phí Ads</div>
          <div className="kpi-value text-amber">
            {formatCurrency(pnlSummary.totalOperatingOverhead)}
          </div>
          <div className="kpi-sub">
            🏢 Phí cứng: <strong>{formatCurrency(pnlSummary.totalFixedCost)}</strong> • 📢 Ads:{' '}
            <strong>{formatCurrency(pnlSummary.totalAdsSpend)}</strong>
          </div>
        </div>

        <div
          className={`kpi-card ${
            pnlSummary.netProfit >= 0 ? 'kpi-success' : 'kpi-danger'
          }`}
        >
          <div className="kpi-label">🏆 Lợi Nhuận Ròng Bỏ Túi (Net Profit)</div>
          <div
            className={`kpi-value ${
              pnlSummary.netProfit >= 0 ? 'text-green' : 'text-red'
            }`}
          >
            {formatCurrency(pnlSummary.netProfit)}
          </div>
          <div className="kpi-sub">
            Tỷ suất ròng: <strong>{pnlSummary.netMarginPct.toFixed(1)}%</strong> • Điểm hòa vốn:{' '}
            <strong>{pnlSummary.breakEvenWeddings} đám</strong>
          </div>
        </div>
      </div>

      {/* BẢNG BÁO CÁO KẾT QUẢ KINH DOANH CHI TIẾT (P&L STATEMENT) */}
      <div className="card" style={{ padding: 20 }}>
        <div
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
            <h3 style={{ marginBottom: 4 }}>
              📑 Báo Cáo Kết Quả Kinh Doanh (P&L) —{' '}
              {viewScope === 'month' ? `Tháng ${selectedMonth}` : 'Toàn bộ các kỳ'}
            </h3>
            <p className="text-muted" style={{ fontSize: 13 }}>
              Tách bạch rõ ràng: <strong>Chi phí xoay vòng theo từng đám</strong> (Đánh giá đội thi
              công) và <strong>Chi phí cứng + Chi phí Ads</strong> (Đánh giá vận hành doanh nghiệp).
            </p>
          </div>
          <div className="badge badge-blue" style={{ fontSize: 13, padding: '6px 12px' }}>
            ⚖️ Điểm hòa vốn kỳ này: Cần tối thiểu{' '}
            <strong>{pnlSummary.breakEvenWeddings} đám cưới</strong> (Hiện có{' '}
            <strong>{pnlSummary.projectCount} đám</strong>)
          </div>
        </div>

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Chỉ tiêu Tài chính & Quản trị</th>
                <th>Phân loại Chi phí</th>
                <th>Diễn giải nguồn dữ liệu</th>
                <th className="text-right">Số tiền (₫)</th>
                <th className="text-right">Tỷ trọng / Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-bold">I. TỔNG DOANH THU HỢP ĐỒNG ({pnlSummary.projectCount} đám)</td>
                <td><span className="badge badge-green">Doanh thu</span></td>
                <td className="text-xs text-muted">Tổng giá trị hợp đồng các dự án trong kỳ</td>
                <td className="text-right font-bold text-green">
                  {formatCurrency(pnlSummary.totalRevenue)}
                </td>
                <td className="text-right font-bold">100%</td>
              </tr>

              <tr>
                <td style={{ paddingLeft: 24 }}>1. Vật tư tiêu hao thực tế tại đám</td>
                <td><span className="badge badge-gray">Chi phí xoay vòng</span></td>
                <td className="text-xs text-muted">(SL xuất − SL thu hồi tốt) × Giá vốn</td>
                <td className="text-right">{formatCurrency(pnlSummary.totalConsumable)}</td>
                <td className="text-right">
                  {pnlSummary.totalRevenue > 0
                    ? `${((pnlSummary.totalConsumable / pnlSummary.totalRevenue) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>

              <tr>
                <td style={{ paddingLeft: 24 }}>2. Khấu hao đồ decor tái sử dụng</td>
                <td><span className="badge badge-gray">Chi phí xoay vòng</span></td>
                <td className="text-xs text-muted">SL xuất × Giá vốn ÷ Số lần sử dụng dự kiến</td>
                <td className="text-right">{formatCurrency(pnlSummary.totalDepreciation)}</td>
                <td className="text-right">
                  {pnlSummary.totalRevenue > 0
                    ? `${((pnlSummary.totalDepreciation / pnlSummary.totalRevenue) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>

              <tr>
                <td style={{ paddingLeft: 24 }}>3. Hao hụt hỏng & mất tại dự án</td>
                <td><span className="badge badge-gray">Chi phí xoay vòng</span></td>
                <td className="text-xs text-muted">(SL hỏng + SL mất) × Giá vốn</td>
                <td className="text-right text-red">{formatCurrency(pnlSummary.totalDamagedLost)}</td>
                <td className="text-right">
                  {pnlSummary.totalRevenue > 0
                    ? `${((pnlSummary.totalDamagedLost / pnlSummary.totalRevenue) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>

              <tr>
                <td style={{ paddingLeft: 24 }}>4. Nhân công, Xe vận chuyển & Hoa tươi theo đám</td>
                <td><span className="badge badge-gray">Chi phí xoay vòng</span></td>
                <td className="text-xs text-muted">Tổng mục &ldquo;Chi phí khác&rdquo; trực tiếp tại từng dự án</td>
                <td className="text-right">{formatCurrency(pnlSummary.totalDirectOther)}</td>
                <td className="text-right">
                  {pnlSummary.totalRevenue > 0
                    ? `${((pnlSummary.totalDirectOther / pnlSummary.totalRevenue) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>

              <tr style={{ background: '#f0fdf4' }}>
                <td className="font-bold" style={{ color: '#166534' }}>
                  II. LÃI GỘP THI CÔNG (GROSS PROFIT = I − Tổng Chi phí xoay vòng)
                </td>
                <td><span className="badge badge-green">Lãi gộp đám</span></td>
                <td className="text-xs text-muted">Đánh giá hiệu quả của Đội Thi Công & Kho</td>
                <td className="text-right font-bold text-green">
                  {formatCurrency(pnlSummary.grossProfit)}
                </td>
                <td className="text-right font-bold text-green">
                  {pnlSummary.grossMarginPct.toFixed(1)}%
                </td>
              </tr>

              <tr>
                <td style={{ paddingLeft: 24 }}>5. Chi phí Marketing & Chạy Ads (Meta API + TikTok)</td>
                <td><span className="badge badge-blue">Chi phí Marketing</span></td>
                <td className="text-xs text-muted">
                  {pnlSummary.totalAdsMessages} tin nhắn/Lead • CPL TB:{' '}
                  {formatCurrency(pnlSummary.avgCpl)} • CAC/đám Ads:{' '}
                  {formatCurrency(pnlSummary.cacPerWedding)}
                </td>
                <td className="text-right font-bold text-blue">
                  {formatCurrency(pnlSummary.totalAdsSpend)}
                </td>
                <td className="text-right">
                  {pnlSummary.cirPct.toFixed(1)}%
                </td>
              </tr>

              <tr>
                <td style={{ paddingLeft: 24 }}>
                  6. Chi phí Cứng / Phí Cố định hàng tháng ({filteredFixedCosts.length} khoản)
                </td>
                <td><span className="badge badge-amber">Chi phí cứng cố định</span></td>
                <td className="text-xs text-muted">
                  Thuê kho Xuân Lộc & Vĩnh Lộc, lương cứng, điện nước, web/server...
                </td>
                <td className="text-right font-bold text-amber">
                  {formatCurrency(pnlSummary.totalFixedCost)}
                </td>
                <td className="text-right">
                  {pnlSummary.totalRevenue > 0
                    ? `${((pnlSummary.totalFixedCost / pnlSummary.totalRevenue) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>

              <tr style={{ background: pnlSummary.netProfit >= 0 ? '#ecfdf5' : '#fef2f2' }}>
                <td className="font-bold" style={{ fontSize: 15 }}>
                  III. LỢI NHUẬN RÒNG BỎ TÚI (NET PROFIT = Lãi gộp II − Ads − Chi phí cứng)
                </td>
                <td>
                  <span className={`badge ${pnlSummary.netProfit >= 0 ? 'badge-green' : 'badge-danger'}`}>
                    Lãi ròng thực tế
                  </span>
                </td>
                <td className="text-xs text-muted">
                  Lợi nhuận cuối cùng sau khi trừ mọi chi phí xoay vòng, phí cố định và quảng cáo
                </td>
                <td
                  className={`text-right font-bold ${
                    pnlSummary.netProfit >= 0 ? 'text-green' : 'text-red'
                  }`}
                  style={{ fontSize: 16 }}
                >
                  {formatCurrency(pnlSummary.netProfit)}
                </td>
                <td
                  className={`text-right font-bold ${
                    pnlSummary.netProfit >= 0 ? 'text-green' : 'text-red'
                  }`}
                >
                  {pnlSummary.netMarginPct.toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. QUẢN LÝ SỔ CHI PHÍ CỨNG / PHÍ CỐ ĐỊNH HÀNG THÁNG (FIXED OVERHEAD COSTS) */}
      <div className="card" style={{ padding: 20 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <h3 style={{ marginBottom: 4 }}>
              🏢 Sổ Chi Phí Cứng / Phí Cố Định Hàng Tháng (Ngoài chi phí xoay vòng)
            </h3>
            <p className="text-muted" style={{ fontSize: 13.5 }}>
              Hạch toán các khoản phí cố định mỗi tháng (Thuê kho Xuân Lộc & Vĩnh Lộc, lương cứng,
              điện nước, phần mềm, bảo dưỡng xe...). Có thể nạp tự động bộ định mức chuẩn mỗi đầu
              tháng chỉ với 1 nút bấm.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleApplyMonthlyFixedTemplate}
            >
              ⚡ Nạp bộ Chi phí cứng định mức vào tháng {selectedMonth}
            </button>
            {filteredFixedCosts.length > 0 && viewScope === 'month' && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleSaveCurrentMonthAsTemplate}
              >
                💾 Lưu tháng {selectedMonth} làm Định mức chuẩn
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleAddFixedCost} className="sub-card" style={{ marginBottom: 16, padding: 14 }}>
          <div className="form-grid-4">
            <div className="form-group">
              <label>Nhóm chi phí cứng cố định *</label>
              <select
                value={fixedForm.category}
                onChange={(e) => setFixedForm({ ...fixedForm, category: e.target.value })}
              >
                {FIXED_COST_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Diễn giải chi tiết</label>
              <input
                type="text"
                placeholder="VD: Tiền thuê kho Vĩnh Lộc + Điện nước tháng này"
                value={fixedForm.title}
                onChange={(e) => setFixedForm({ ...fixedForm, title: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Đầu kho áp dụng</label>
              <select
                value={fixedForm.hub}
                onChange={(e) => setFixedForm({ ...fixedForm, hub: e.target.value })}
              >
                <option value="all">Chung toàn Đặng Wedding (2 Kho)</option>
                {WAREHOUSE_HUBS.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Số tiền cố định / tháng (₫) *</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <CurrencyInput
                  required
                  placeholder="VD: 3.000.000"
                  value={fixedForm.amount}
                  onChange={(num) => setFixedForm({ ...fixedForm, amount: num })}
                />
                <button type="submit" className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                  + Thêm phí cứng
                </button>
              </div>
            </div>
          </div>
        </form>

        {filteredFixedCosts.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            Tháng {selectedMonth} chưa ghi nhận khoản Chi phí cứng cố định nào. Anh hãy bấm nút{' '}
            <strong>&ldquo;⚡ Nạp bộ Chi phí cứng định mức vào tháng {selectedMonth}&rdquo;</strong>{' '}
            ở góc phải trên để khởi tạo nhanh!
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kỳ tháng</th>
                  <th>Nhóm chi phí cứng</th>
                  <th>Diễn giải</th>
                  <th>Đầu kho</th>
                  <th className="text-right">Số tiền (₫)</th>
                  <th className="text-right">Xóa</th>
                </tr>
              </thead>
              <tbody>
                {filteredFixedCosts.map((c) => (
                  <tr key={c.id}>
                    <td><code>{c.month}</code></td>
                    <td className="font-bold">{c.category}</td>
                    <td>{c.title}</td>
                    <td>
                      <span className="badge badge-gray">
                        {c.hub === 'xuan_loc'
                          ? 'Kho Xuân Lộc'
                          : c.hub === 'vinh_loc'
                          ? 'Kho Vĩnh Lộc'
                          : 'Chung 2 Kho'}
                      </span>
                    </td>
                    <td className="text-right font-bold">{formatCurrency(c.amount)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleDeleteFixedCost(c.id)}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. HIỆU QUẢ KINH DOANH & CAC THEO 2 ĐẦU KHO (XUÂN LỘC vs. VĨNH LỘC) & NGUỒN KHÁCH */}
      <div className="form-grid-2">
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>📍 So sánh Hiệu quả 2 Đầu Kho (Xuân Lộc vs. Vĩnh Lộc)</h3>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Tự động khớp các Dự án cưới theo nhãn <strong>Đầu kho phụ trách</strong> với{' '}
            <strong>Tiền chạy Ads của kho đó</strong> (không cần chia tay vào từng dự án).
          </p>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Đầu kho</th>
                  <th className="text-right">Số đám</th>
                  <th className="text-right">Doanh thu</th>
                  <th className="text-right">Lãi gộp đám</th>
                  <th className="text-right">Tiền Ads</th>
                  <th className="text-right">CAC / Đám</th>
                </tr>
              </thead>
              <tbody>
                {pnlSummary.byHub.map((row) => (
                  <tr key={row.hub.id}>
                    <td>
                      <div className="font-bold" style={{ color: '#163828' }}>
                        {row.hub.shortLabel}
                      </div>
                      <div className="text-xs text-muted">
                        {row.paidAdsProjectCount} đám từ Ads
                      </div>
                    </td>
                    <td className="text-right font-bold">{row.projectCount}</td>
                    <td className="text-right">{formatCurrency(row.revenue)}</td>
                    <td className="text-right text-green font-bold">
                      {formatCurrency(row.grossProfit)}
                    </td>
                    <td className="text-right text-blue">{formatCurrency(row.adsSpend)}</td>
                    <td className="text-right font-bold">
                      {row.cac > 0 ? formatCurrency(row.cac) : '0 ₫'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>📢 Phân tích Đơn hàng theo Nguồn Khách (Attribution)</h3>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Đo lường kênh nào mang về nhiều đám cưới nhất và giá trị trung bình mỗi đơn (AOV) cao
            nhất.
          </p>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nguồn khách hàng</th>
                  <th className="text-right">Số đám</th>
                  <th className="text-right">Doanh thu HĐ</th>
                  <th className="text-right">TB / Đám (AOV)</th>
                  <th className="text-right">Lãi gộp</th>
                </tr>
              </thead>
              <tbody>
                {pnlSummary.bySource.map((row) => (
                  <tr key={row.source.id}>
                    <td>
                      <span
                        className={`badge ${
                          row.source.isPaidAds ? 'badge-blue' : 'badge-gray'
                        }`}
                      >
                        {row.source.label}
                      </span>
                    </td>
                    <td className="text-right font-bold">{row.count}</td>
                    <td className="text-right">{formatCurrency(row.revenue)}</td>
                    <td className="text-right font-bold">
                      {row.aov > 0 ? formatCurrency(row.aov) : '—'}
                    </td>
                    <td className="text-right text-green font-bold">
                      {formatCurrency(row.grossProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 4. PANEL CẤU HÌNH META MARKETING API */}
      {showConfigPanel && (
        <form onSubmit={handleSaveConfig} className="card" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 6 }}>🔌 Kết nối Meta Marketing API (Graph API v21.0)</h3>
          <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
            Nhập <strong>Ad Account ID</strong> và <strong>Access Token</strong> (quyền{' '}
            <code>ads_read</code>) để kéo tự động số tiền đã chi, số tin nhắn và CPL về Sổ
            Marketing.
          </p>

          <div className="form-grid-3" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label>Ad Account ID (VD: act_123456789)</label>
              <input
                type="text"
                placeholder="act_..."
                value={config.adAccountId}
                onChange={(e) => setConfig({ ...config, adAccountId: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Meta Access Token (quyền ads_read)</label>
              <input
                type="password"
                placeholder="EAAB..."
                value={config.accessToken}
                onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Meta Pixel ID (gắn trên dangwed.com)</label>
              <input
                type="text"
                placeholder="VD: 10829384756..."
                value={config.pixelId}
                onChange={(e) => setConfig({ ...config, pixelId: e.target.value })}
              />
            </div>
          </div>

          <div className="form-grid-3" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label>Ngân sách Ads mục tiêu tháng (₫)</label>
              <CurrencyInput
                value={config.monthlyBudget}
                onChange={(num) => setConfig({ ...config, monthlyBudget: num })}
              />
            </div>
            <div className="form-group">
              <label>Ngưỡng CPL Tốt để tăng ngân sách (₫)</label>
              <CurrencyInput
                value={config.targetCplMax}
                onChange={(num) => setConfig({ ...config, targetCplMax: num })}
              />
            </div>
            <div className="form-group">
              <label>Ngưỡng CPL Cao cảnh báo tắt mẫu (₫)</label>
              <CurrencyInput
                value={config.killCplThreshold}
                onChange={(num) => setConfig({ ...config, killCplThreshold: num })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="submit" className="btn btn-primary">
              💾 Lưu cấu hình API
            </button>
          </div>
        </form>
      )}

      {/* 5. BẢNG SỔ CHI PHÍ MARKETING & CHỈ SỐ META API */}
      <div className="card" style={{ padding: 20 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h3 style={{ marginBottom: 4 }}>
              📡 Sổ Chi Phí Marketing & Chỉ Số Chiến Dịch (Meta API 80% + TikTok 20%)
            </h3>
            <p className="text-muted" style={{ fontSize: 13 }}>
              Tự động chấm điểm hiệu quả từng nhóm/bài quảng cáo theo Quy tắc 3 Mốc Vàng và tổng hợp
              thẳng lên Báo cáo P&L.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              style={{ padding: '7px 10px', fontSize: 13 }}
            >
              <option value="ad">Xem theo: Từng bài Ads (Ad)</option>
              <option value="adset">Xem theo: Nhóm 2 Đầu Kho (Ad Set)</option>
              <option value="campaign">Xem theo: Chiến dịch (Campaign)</option>
            </select>

            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              style={{ padding: '7px 10px', fontSize: 13 }}
            >
              <option value="this_month">Tháng này</option>
              <option value="last_7d">7 ngày qua</option>
              <option value="last_14d">14 ngày qua</option>
              <option value="last_30d">30 ngày qua</option>
              <option value="today">Hôm nay</option>
              <option value="custom">Tùy chọn ngày</option>
            </select>

            {datePreset === 'custom' && (
              <>
                <input
                  type="date"
                  value={customSince}
                  onChange={(e) => setCustomSince(e.target.value)}
                  style={{ padding: '6px 8px', fontSize: 13 }}
                />
                <input
                  type="date"
                  value={customUntil}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  style={{ padding: '6px 8px', fontSize: 13 }}
                />
              </>
            )}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncingApi}
              onClick={handleSyncFromMetaApi}
            >
              {syncingApi ? '⏳ Đang kéo Meta API...' : '🔄 Kéo chỉ số từ Meta API'}
            </button>
          </div>
        </div>

        {/* Form nhập nhanh chi phí TikTok Boost Video (20%) hoặc nhập tay */}
        <form
          onSubmit={handleAddManualAdsLog}
          className="sub-card"
          style={{ marginBottom: 16, padding: 14 }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#163828' }}>
            ➕ Ghi thêm Chi phí Ads bổ sung (TikTok Boost Video 20% / Google / Meta nhập tay):
          </div>
          <div className="form-grid-4">
            <div className="form-group">
              <label>Kênh & Cụm kho</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={manualForm.channel}
                  onChange={(e) => setManualForm({ ...manualForm, channel: e.target.value })}
                >
                  <option value="TikTok Ads (20%)">TikTok Ads (20%)</option>
                  <option value="Meta Ads (80%)">Meta Ads (80%)</option>
                  <option value="FB Reels Boost">FB Reels Boost</option>
                  <option value="Google Search">Google Search</option>
                </select>
                <select
                  value={manualForm.hubId}
                  onChange={(e) => setManualForm({ ...manualForm, hubId: e.target.value })}
                >
                  {WAREHOUSE_HUBS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.shortLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Tên chiến dịch / Mẫu bài *</label>
              <input
                type="text"
                required
                placeholder="VD: Boost Video Before/After Gia Tiên"
                value={manualForm.campaign_name}
                onChange={(e) =>
                  setManualForm({ ...manualForm, campaign_name: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>Số tiền đã chi (₫) *</label>
              <CurrencyInput
                required
                placeholder="VD: 450.000"
                value={manualForm.spend}
                onChange={(num) => setManualForm({ ...manualForm, spend: num })}
              />
            </div>

            <div className="form-group">
              <label>Số tin nhắn / Lead thu được</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number"
                  min="0"
                  placeholder="VD: 10"
                  value={manualForm.messages}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, messages: e.target.value })
                  }
                />
                <button type="submit" className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }}>
                  + Ghi sổ Ads
                </button>
              </div>
            </div>
          </div>
        </form>

        {filteredAdsRows.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            Chưa có dòng chi phí Ads nào trong kỳ đang xem. Anh có thể bấm{' '}
            <strong>&ldquo;🔄 Kéo chỉ số từ Meta API&rdquo;</strong>, ghi nhanh vào ô bên trên, hoặc
            bấm <strong>&ldquo;🧪 Nạp số liệu Ads mẫu&rdquo;</strong> ở góc phải trên cùng.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Đầu kho / Kênh</th>
                  <th>Chiến dịch / Nhóm / Bài Ads</th>
                  <th className="text-right">Đã chi (₫)</th>
                  <th className="text-right">Hiển thị / Click</th>
                  <th className="text-right">Tin nhắn / Lead</th>
                  <th className="text-right">Giá / Mess (CPL)</th>
                  <th>Khuyến nghị (Quy tắc 3 mốc vàng)</th>
                  <th className="text-right">Xóa</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdsRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-bold" style={{ color: '#163828' }}>
                        {row.hubTag}
                      </div>
                      <div className="text-xs text-muted">
                        {row.source} • {row.date_stop || row.month}
                      </div>
                    </td>
                    <td>
                      <div className="font-bold">
                        {row.ad_name !== '—' ? row.ad_name : row.campaign_name}
                      </div>
                      <div className="text-xs text-muted">
                        {row.campaign_name} {row.adset_name !== '—' ? `• ${row.adset_name}` : ''}
                      </div>
                    </td>
                    <td className="text-right font-bold">{formatCurrency(row.spend)}</td>
                    <td className="text-right">
                      {row.impressions > 0 ? (
                        <>
                          <div>{formatNumber(row.impressions)} lượt</div>
                          <div className="text-xs text-muted">
                            {formatNumber(row.clicks)} click ({row.ctr}%)
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-muted">Ghi sổ</span>
                      )}
                    </td>
                    <td className="text-right font-bold text-blue">
                      {formatNumber(row.totalResults)}
                    </td>
                    <td className="text-right font-bold">
                      {row.cpl > 0 ? formatCurrency(row.cpl) : '—'}
                    </td>
                    <td>
                      <span className={`badge ${row.badgeCls}`}>{row.statusLabel}</span>
                    </td>
                    <td className="text-right">
                      {row.isManual ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ color: '#dc2626' }}
                          onClick={() => handleDeleteManualLog(row.id)}
                        >
                          ✕
                        </button>
                      ) : (
                        <span className="text-xs text-muted">API</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. BẢNG CẤU TRÚC TARGET 2 ĐẦU KHO & TRÌNH COPY LINK UTM TRACKING */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 6 }}>
          🎯 Cấu trúc Target Chuẩn 2 Đầu Kho & Link UTM Theo Dõi Nguồn Khách Tự Động
        </h3>
        <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
          Copy nhanh thông số thả ghim bản đồ và đường dẫn UTM gắn vào bài quảng cáo để khi khách
          đặt lịch trên <strong>dangwed.com</strong> và chuyển thành Dự án, hệ thống tự động gắn
          nhãn <strong>Kho Xuân Lộc</strong> hoặc <strong>Kho Vĩnh Lộc</strong>.
        </p>

        <div className="form-grid-2">
          <div className="sub-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ color: '#163828', fontSize: 15 }}>
                📍 Nhóm 1: Kho Chính Xuân Lộc, Đồng Nai (50% ngân sách)
              </strong>
              <span className="badge badge-green">Bán kính 18km</span>
            </div>
            <ul style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, marginBottom: 12 }}>
              <li>
                <strong>Tên nhóm chuẩn:</strong> <code>KHO_XUANLOC_DONGNAI_18KM</code>
              </li>
              <li>
                <strong>Thả ghim bản đồ:</strong> Xuân Lộc, Đồng Nai (18km) + TP. Long Khánh (10km)
              </li>
              <li>
                <strong>Độ tuổi & Sở thích:</strong> 23–33 tuổi • Đã đính hôn, Đám cưới, Áo dài cưới,
                Chụp ảnh cưới
              </li>
            </ul>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() =>
                  copyText(
                    'https://dangwed.com/?utm_source=fb_ads&utm_campaign=kho_xuanloc_18km#bao-gia',
                    'Link UTM Kho Xuân Lộc'
                  )
                }
              >
                🔗 Copy Link UTM Xuân Lộc
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() =>
                  copyText('KHO_XUANLOC_DONGNAI_18KM', 'Tên nhóm quảng cáo Xuân Lộc')
                }
              >
                📋 Copy Tên AdSet
              </button>
            </div>
          </div>

          <div className="sub-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ color: '#163828', fontSize: 15 }}>
                📍 Nhóm 2: Kho Trung Chuyển Vĩnh Lộc, TP.HCM (50% ngân sách)
              </strong>
              <span className="badge badge-blue">Bán kính 12km</span>
            </div>
            <ul style={{ paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, marginBottom: 12 }}>
              <li>
                <strong>Tên nhóm chuẩn:</strong> <code>KHO_VINHLOC_TPHCM_12KM</code>
              </li>
              <li>
                <strong>Thả ghim bản đồ:</strong> Vĩnh Lộc A/B, Bình Chánh (12km — ôm Bình Tân, Tân
                Phú, Q.12, Hóc Môn, Gò Vấp)
              </li>
              <li>
                <strong>Độ tuổi & Sở thích:</strong> 24–34 tuổi • Đã đính hôn, Đám cưới, Tổ chức sự
                kiện cưới, Trang sức cưới
              </li>
            </ul>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() =>
                  copyText(
                    'https://dangwed.com/?utm_source=fb_ads&utm_campaign=kho_vinhloc_12km#bao-gia',
                    'Link UTM Kho Vĩnh Lộc'
                  )
                }
              >
                🔗 Copy Link UTM Vĩnh Lộc
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() =>
                  copyText('KHO_VINHLOC_TPHCM_12KM', 'Tên nhóm quảng cáo Vĩnh Lộc')
                }
              >
                📋 Copy Tên AdSet
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
