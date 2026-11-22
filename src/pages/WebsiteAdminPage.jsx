import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatDate, generateProjectCode } from '../lib/formatters'
import { compressImageUnder1MB, formatBytes } from '../lib/imageCompressor'

const LEAD_STATUS_META = {
  new: { label: 'Mới đăng ký', cls: 'badge-amber' },
  contacted: { label: 'Đã liên hệ', cls: 'badge-blue' },
  converted: { label: 'Đã tạo dự án', cls: 'badge-green' },
  closed: { label: 'Đã đóng', cls: 'badge-gray' },
}

const DEFAULT_SETTINGS = {
  id: 1,
  brand_name: 'Đặng Wedding',
  slogan: 'Là ngày đẹp nhất',
  hero_subtitle:
    'Kiến tạo không gian lễ Gia tiên, Mâm quả cưới hỏi & Tiệc cưới tinh tế, chỉn chu trong từng chi tiết.',
  hero_image_url: '',
  about_title: 'Gói trọn yêu thương trong từng chi tiết nhỏ',
  about_body:
    'Với 3 năm đồng hành cùng hơn 100 lễ cưới trọn vẹn, Đặng Wedding tin rằng mỗi câu chuyện tình yêu đều xứng đáng có một không gian khởi đầu thật đẹp, trang trọng và mang đậm dấu ấn riêng của hai bạn.',
  years_exp: '3+',
  weddings_count: '100+',
  phone: '0918.80.90.96',
  service_area: '',
  address: '',
  facebook_url: 'https://www.facebook.com/profile.php?id=100035319916172',
  tiktok_url: 'https://www.tiktok.com/@dangweddingg?lang=en',
}

const GALLERY_CATEGORIES = [
  'Gia tiên',
  'Mâm quả',
  'Cổng hoa',
  'Backdrop',
  'Rạp & bàn ghế',
  'Đám thực tế',
]

export default function WebsiteAdminPage() {
  const { isManagerOrAdmin, isStaff } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState('leads') // 'leads' | 'gallery' | 'settings'
  const [loading, setLoading] = useState(true)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [toast, setToast] = useState('')

  // Leads state
  const [leads, setLeads] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [convertingId, setConvertingId] = useState(null)

  // Gallery state (ảnh đám thực tế tải lên riêng)
  const [gallery, setGallery] = useState([])
  const [galleryMissing, setGalleryMissing] = useState(false)
  const [galFilter, setGalFilter] = useState('all')
  const [galForm, setGalForm] = useState({
    title: '',
    category: 'Gia tiên',
    event_date: '',
    description: '',
    images: [], // [{ dataUrl, info }]
  })
  const [uploadingGal, setUploadingGal] = useState(false)
  const [savingGal, setSavingGal] = useState(false)

  // Settings state
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [bannerInfo, setBannerInfo] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setErrorMsg('')
    setSchemaMissing(false)
    setGalleryMissing(false)
    try {
      const [leadsRes, settingsRes, galleryRes] = await Promise.all([
        supabase.from('site_leads').select('*').order('created_at', { ascending: false }),
        supabase.from('site_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('site_gallery').select('*').order('created_at', { ascending: false }),
      ])

      const err = leadsRes.error || settingsRes.error
      if (err) {
        const msg = (err.message || '').toLowerCase()
        if (
          err.code === '42P01' ||
          msg.includes('does not exist') ||
          msg.includes('schema cache') ||
          msg.includes('could not find the table')
        ) {
          setSchemaMissing(true)
        } else {
          setErrorMsg(err.message)
        }
      } else {
        setLeads(leadsRes.data || [])
        if (settingsRes.data) {
          setSettings({ ...DEFAULT_SETTINGS, ...settingsRes.data })
        }
      }

      if (galleryRes.error) {
        const gmsg = (galleryRes.error.message || '').toLowerCase()
        if (
          galleryRes.error.code === '42P01' ||
          gmsg.includes('does not exist') ||
          gmsg.includes('schema cache') ||
          gmsg.includes('could not find the table')
        ) {
          setGalleryMissing(true)
        }
      } else {
        setGallery(galleryRes.data || [])
      }
    } catch (e) {
      setErrorMsg(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (isStaff) {
    return (
      <div className="page">
        <div className="alert alert-error">
          Bạn không có quyền truy cập trang Quản trị Website.
        </div>
      </div>
    )
  }

  const handleUpdateLeadStatus = async (leadId, newStatus) => {
    const { error } = await supabase
      .from('site_leads')
      .update({ status: newStatus })
      .eq('id', leadId)
    if (error) {
      setErrorMsg('Không thể cập nhật trạng thái: ' + error.message)
      return
    }
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
    )
    showToast('Đã cập nhật trạng thái khách hàng.')
  }

  const handleDeleteLead = async (lead) => {
    if (!window.confirm(`Xóa yêu cầu báo giá của "${lead.customer_name}"?`)) return
    const { error } = await supabase.from('site_leads').delete().eq('id', lead.id)
    if (error) {
      setErrorMsg('Không thể xóa yêu cầu: ' + error.message)
      return
    }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id))
    showToast('Đã xóa yêu cầu báo giá.')
  }

  const handleConvertToProject = async (lead) => {
    if (
      !window.confirm(
        `Tạo khách hàng "${lead.customer_name}" và một Dự án Báo giá mới từ yêu cầu này?`
      )
    ) {
      return
    }

    setConvertingId(lead.id)
    setErrorMsg('')
    try {
      // 1. Tìm khách hàng trùng SĐT hoặc tạo mới
      const cleanPhone = (lead.phone || '').trim()
      let customerId = null

      if (cleanPhone) {
        const { data: existingPartners } = await supabase
          .from('partners')
          .select('id, phone')
          .eq('kind', 'customer')
          .eq('phone', cleanPhone)
          .limit(1)
        if (existingPartners && existingPartners.length > 0) {
          customerId = existingPartners[0].id
        }
      }

      if (!customerId) {
        const { data: newPartner, error: partnerErr } = await supabase
          .from('partners')
          .insert({
            kind: 'customer',
            name: lead.customer_name,
            phone: cleanPhone || null,
            address: lead.location || null,
            note: 'Khách đăng ký từ Website dangwed.com',
          })
          .select('id')
          .single()
        if (partnerErr) throw partnerErr
        customerId = newPartner.id
      }

      // 2. Tạo mã dự án tự động DA-YYMM-XXX
      const { data: existingProjects } = await supabase
        .from('projects')
        .select('id, code')
      const code = generateProjectCode(lead.event_date || '', existingProjects || [])

      const noteParts = []
      if (lead.selected_template) noteParts.push(`Mẫu quan tâm: ${lead.selected_template}`)
      if (lead.service_interest) noteParts.push(`Dịch vụ: ${lead.service_interest}`)
      if (lead.note) noteParts.push(`Ghi chú khách: ${lead.note}`)
      noteParts.push('Nguồn: Website dangwed.com')

      const projectName = `${lead.service_interest || 'Tiệc cưới'} - ${lead.customer_name}`

      const { data: newProject, error: projErr } = await supabase
        .from('projects')
        .insert({
          code,
          name: projectName,
          customer_id: customerId,
          location: lead.location || null,
          start_date: lead.event_date || null,
          end_date: lead.event_date || null,
          status: 'quote',
          contract_value: 0,
          note: noteParts.join('\n'),
        })
        .select('id')
        .single()
      if (projErr) throw projErr

      // 3. Đánh dấu lead đã chuyển đổi
      await supabase.from('site_leads').update({ status: 'converted' }).eq('id', lead.id)
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, status: 'converted' } : l))
      )

      navigate(`/du-an/${newProject.id}`)
    } catch (e) {
      setErrorMsg('Lỗi khi tạo dự án từ yêu cầu: ' + e.message)
    } finally {
      setConvertingId(null)
    }
  }

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingBanner(true)
    setErrorMsg('')
    try {
      const res = await compressImageUnder1MB(file)
      setSettings((prev) => ({ ...prev, hero_image_url: res.dataUrl }))
      setBannerInfo(
        `Đã nén ảnh từ ${formatBytes(res.originalSize)} → ${formatBytes(res.compressedSize)} (${res.width}×${res.height})`
      )
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setUploadingBanner(false)
      e.target.value = ''
    }
  }

  const handleSaveSettings = async (e) => {
    e.preventDefault()
    if (!isManagerOrAdmin) return
    setSavingSettings(true)
    setErrorMsg('')
    try {
      const payload = {
        id: 1,
        brand_name: settings.brand_name?.trim() || 'Đặng Wedding',
        slogan: settings.slogan?.trim() || 'Là ngày đẹp nhất',
        hero_subtitle: settings.hero_subtitle?.trim() || '',
        hero_image_url: settings.hero_image_url || null,
        about_title: settings.about_title?.trim() || '',
        about_body: settings.about_body?.trim() || '',
        years_exp: settings.years_exp?.trim() || '3+',
        weddings_count: settings.weddings_count?.trim() || '100+',
        phone: settings.phone?.trim() || '0918.80.90.96',
        service_area: settings.service_area?.trim() || 'Đồng Nai - TP.HCM',
        address: settings.address?.trim() || '',
        facebook_url: settings.facebook_url?.trim() || '',
        tiktok_url: settings.tiktok_url?.trim() || '',
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('site_settings')
        .upsert(payload, { onConflict: 'id' })
      if (error) throw error
      showToast('✓ Đã lưu nội dung Website! Khách truy cập dangwed.com sẽ thấy ngay.')
    } catch (err) {
      setErrorMsg('Không thể lưu cấu hình: ' + err.message)
    } finally {
      setSavingSettings(false)
    }
  }

  const handleGalleryFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploadingGal(true)
    setErrorMsg('')
    try {
      const compressed = []
      for (const file of files.slice(0, 10)) {
        const res = await compressImageUnder1MB(file)
        compressed.push({
          dataUrl: res.dataUrl,
          info: `${formatBytes(res.originalSize)} → ${formatBytes(res.compressedSize)}`,
        })
      }
      setGalForm((prev) => ({
        ...prev,
        images: [...prev.images, ...compressed],
      }))
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setUploadingGal(false)
      e.target.value = ''
    }
  }

  const handleAddGallery = async (e) => {
    e.preventDefault()
    if (!galForm.title.trim()) {
      setErrorMsg('Vui lòng nhập tên đám hoặc tiêu đề ảnh.')
      return
    }
    if (galForm.images.length === 0) {
      setErrorMsg('Vui lòng chọn ít nhất 1 ảnh đám thực tế để tải lên.')
      return
    }
    setSavingGal(true)
    setErrorMsg('')
    try {
      const rows = galForm.images.map((img, idx) => ({
        title:
          galForm.images.length > 1
            ? `${galForm.title.trim()} (${idx + 1})`
            : galForm.title.trim(),
        category: galForm.category || 'Gia tiên',
        image_url: img.dataUrl,
        description: galForm.description.trim() || '',
        event_date: galForm.event_date || null,
        is_featured: true,
      }))
      const { data, error } = await supabase.from('site_gallery').insert(rows).select('*')
      if (error) throw error
      setGallery((prev) => [...(data || []), ...prev])
      setGalForm({
        title: '',
        category: galForm.category,
        event_date: '',
        description: '',
        images: [],
      })
      showToast(`✓ Đã đăng ${rows.length} ảnh lên mục Thư viện của dangwed.com!`)
    } catch (err) {
      setErrorMsg('Không thể lưu ảnh thư viện: ' + err.message)
    } finally {
      setSavingGal(false)
    }
  }

  const handleToggleFeatured = async (item) => {
    const next = !item.is_featured
    const { error } = await supabase
      .from('site_gallery')
      .update({ is_featured: next })
      .eq('id', item.id)
    if (error) {
      setErrorMsg('Không thể cập nhật trạng thái hiển thị: ' + error.message)
      return
    }
    setGallery((prev) =>
      prev.map((g) => (g.id === item.id ? { ...g, is_featured: next } : g))
    )
    showToast(next ? 'Đã bật hiển thị ảnh trên Website.' : 'Đã tạm ẩn ảnh khỏi Website.')
  }

  const handleDeleteGallery = async (item) => {
    if (!window.confirm(`Xóa ảnh "${item.title}" khỏi Thư viện?`)) return
    const { error } = await supabase.from('site_gallery').delete().eq('id', item.id)
    if (error) {
      setErrorMsg('Không thể xóa ảnh: ' + error.message)
      return
    }
    setGallery((prev) => prev.filter((g) => g.id !== item.id))
    showToast('Đã xóa ảnh khỏi Thư viện.')
  }

  const filteredLeads = leads.filter((l) => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${l.customer_name || ''} ${l.phone || ''} ${l.location || ''} ${l.service_interest || ''} ${l.selected_template || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const newLeadsCount = leads.filter((l) => l.status === 'new').length
  const contactedCount = leads.filter((l) => l.status === 'contacted').length
  const convertedCount = leads.filter((l) => l.status === 'converted').length

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>🌐 Quản trị Website (dangwed.com)</h1>
          <p className="text-muted">
            Nhận yêu cầu báo giá từ khách hàng & chỉnh sửa nội dung, banner trang chủ Đặng Wedding
          </p>
        </div>
        <div className="header-actions">
          <Link to="/mau-set" className="btn btn-outline">
            ✨ Quản lý Mẫu Set
          </Link>
          <a
            href="https://dangwed.com"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            ↗ Xem Website
          </a>
        </div>
      </div>

      {toast && <div className="alert alert-success">{toast}</div>}
      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}

      {schemaMissing ? (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>⚙️ Cần kích hoạt bảng dữ liệu Website trên Supabase</h3>
          <p className="text-muted" style={{ marginBottom: 14, lineHeight: 1.6 }}>
            Database hiện chưa có bảng <code>site_settings</code> và <code>site_leads</code>. Bạn
            hãy mở <strong>Supabase → SQL Editor</strong>, dán toàn bộ nội dung file{' '}
            <code>my-app/supabase/website_schema.sql</code> rồi bấm <strong>Run</strong>, sau đó tải
            lại trang này.
          </p>
          <button type="button" className="btn btn-primary" onClick={loadData}>
            🔄 Kiểm tra lại kết nối
          </button>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="tabs" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className={`tab-btn ${tab === 'leads' ? 'active' : ''}`}
              onClick={() => setTab('leads')}
            >
              📩 Khách đăng ký báo giá
              {newLeadsCount > 0 && (
                <span className="badge badge-amber" style={{ marginLeft: 8 }}>
                  {newLeadsCount} mới
                </span>
              )}
            </button>
            <button
              type="button"
              className={`tab-btn ${tab === 'gallery' ? 'active' : ''}`}
              onClick={() => setTab('gallery')}
            >
              🖼 Thư viện ảnh đám thực tế ({gallery.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${tab === 'settings' ? 'active' : ''}`}
              onClick={() => setTab('settings')}
            >
              🎨 Nội dung & Banner trang chủ
            </button>
          </div>

          {loading ? (
            <div className="loading-state">Đang tải dữ liệu Website...</div>
          ) : tab === 'leads' ? (
            <>
              {/* KPI */}
              <div className="kpi-grid" style={{ marginBottom: 18 }}>
                <div className="kpi-card">
                  <div className="kpi-label">Tổng yêu cầu từ Web</div>
                  <div className="kpi-value">{leads.length}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Chưa liên hệ</div>
                  <div className="kpi-value text-amber">{newLeadsCount}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Đã tư vấn</div>
                  <div className="kpi-value">{contactedCount}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Đã chuyển thành Dự án</div>
                  <div className="kpi-value text-green">{convertedCount}</div>
                </div>
              </div>

              {/* Filter bar */}
              <div className="filter-bar" style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Tìm tên khách, SĐT, khu vực, mẫu..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="new">Mới đăng ký</option>
                  <option value="contacted">Đã liên hệ</option>
                  <option value="converted">Đã tạo dự án</option>
                  <option value="closed">Đã đóng</option>
                </select>
                <button type="button" className="btn btn-outline" onClick={loadData}>
                  🔄 Làm mới
                </button>
              </div>

              {/* Leads list */}
              {filteredLeads.length === 0 ? (
                <div className="card">
                  <div className="empty-state" style={{ padding: 36 }}>
                    {leads.length === 0
                      ? 'Chưa có yêu cầu báo giá nào từ dangwed.com. Khi khách điền form trên website, thông tin sẽ tự động đổ về đây.'
                      : 'Không tìm thấy yêu cầu nào khớp bộ lọc.'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {filteredLeads.map((lead) => {
                    const meta = LEAD_STATUS_META[lead.status] || LEAD_STATUS_META.new
                    const cleanDigits = (lead.phone || '').replace(/\D/g, '')
                    return (
                      <div key={lead.id} className="card" style={{ padding: 16 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 12,
                            flexWrap: 'wrap',
                            marginBottom: 10,
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 16 }}>{lead.customer_name}</strong>
                              <span className={`badge ${meta.cls}`}>{meta.label}</span>
                            </div>
                            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                              Gửi lúc: {formatDate(lead.created_at)}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {cleanDigits && (
                              <>
                                <a
                                  href={`tel:${cleanDigits}`}
                                  className="btn btn-outline btn-sm"
                                >
                                  📞 {lead.phone}
                                </a>
                                <a
                                  href={`https://zalo.me/${cleanDigits}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-outline btn-sm"
                                >
                                  💬 Zalo
                                </a>
                              </>
                            )}
                            <select
                              value={lead.status}
                              onChange={(e) => handleUpdateLeadStatus(lead.id, e.target.value)}
                              style={{ padding: '6px 10px', fontSize: 13 }}
                            >
                              <option value="new">Mới đăng ký</option>
                              <option value="contacted">Đã liên hệ</option>
                              <option value="converted">Đã tạo dự án</option>
                              <option value="closed">Đã đóng</option>
                            </select>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: 10,
                            padding: '10px 12px',
                            background: '#f8fafc',
                            borderRadius: 8,
                            fontSize: 13.5,
                            marginBottom: 12,
                          }}
                        >
                          <div>
                            <span className="text-muted">Dịch vụ: </span>
                            <strong>{lead.service_interest || '—'}</strong>
                          </div>
                          <div>
                            <span className="text-muted">Ngày tổ chức: </span>
                            <strong>{lead.event_date ? formatDate(lead.event_date) : 'Chưa rõ'}</strong>
                          </div>
                          <div>
                            <span className="text-muted">Khu vực: </span>
                            <strong>{lead.location || '—'}</strong>
                          </div>
                          {lead.selected_template && (
                            <div>
                              <span className="text-muted">Mẫu đã chọn: </span>
                              <strong style={{ color: '#163828' }}>{lead.selected_template}</strong>
                            </div>
                          )}
                        </div>

                        {lead.note && (
                          <div style={{ fontSize: 13.5, marginBottom: 12, color: '#334155' }}>
                            <strong>Ghi chú khách:</strong> {lead.note}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          {lead.status !== 'converted' ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={convertingId === lead.id}
                              onClick={() => handleConvertToProject(lead)}
                            >
                              {convertingId === lead.id
                                ? 'Đang tạo dự án...'
                                : '✨ Tạo Khách & Dự án Báo giá'}
                            </button>
                          ) : (
                            <span className="text-xs text-green" style={{ alignSelf: 'center' }}>
                              ✓ Đã chuyển sang mục Dự án
                            </span>
                          )}

                          {isManagerOrAdmin && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ color: '#dc2626', borderColor: '#fecaca' }}
                              onClick={() => handleDeleteLead(lead)}
                            >
                              🗑 Xóa
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : tab === 'gallery' ? (
            /* Tab 2: Thư viện ảnh đám thực tế */
            <div style={{ display: 'grid', gap: 18 }}>
              {galleryMissing ? (
                <div className="card" style={{ padding: 24 }}>
                  <h3 style={{ marginBottom: 8 }}>
                    ⚙️ Cần cập nhật SQL để bật mục Tải ảnh đám thực tế
                  </h3>
                  <p className="text-muted" style={{ marginBottom: 14, lineHeight: 1.6 }}>
                    Database chưa có bảng <code>site_gallery</code>. Anh mở{' '}
                    <strong>Supabase → SQL Editor</strong>, dán lại toàn bộ file{' '}
                    <code>my-app/supabase/website_schema.sql</code> bản mới nhất rồi bấm{' '}
                    <strong>Run</strong>, sau đó bấm nút kiểm tra lại bên dưới nhé.
                  </p>
                  <button type="button" className="btn btn-primary" onClick={loadData}>
                    🔄 Kiểm tra lại kết nối
                  </button>
                </div>
              ) : (
                <>
                  <form onSubmit={handleAddGallery} className="card" style={{ padding: 20 }}>
                    <h3 style={{ marginBottom: 4 }}>📷 Đăng ảnh đám đã làm thực tế lên Thư viện</h3>
                    <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
                      Mục <strong>Thư viện</strong> trên <strong>dangwed.com</strong> sẽ hiển thị
                      gộp cả ảnh đám thực tế anh tải lên ở đây cùng với các mẫu trong{' '}
                      <Link to="/mau-set" style={{ color: '#163828', fontWeight: 600 }}>
                        ✨ Mẫu set trang trí
                      </Link>
                      .
                    </p>

                    <div className="form-grid" style={{ marginBottom: 14 }}>
                      <div className="form-group">
                        <label>Tên đám / Tiêu đề ảnh *</label>
                        <input
                          type="text"
                          required
                          placeholder="VD: Gia tiên tone trắng xanh - Nhà anh Tuấn"
                          value={galForm.title}
                          onChange={(e) => setGalForm({ ...galForm, title: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Hạng mục hiển thị</label>
                        <select
                          value={galForm.category}
                          onChange={(e) => setGalForm({ ...galForm, category: e.target.value })}
                        >
                          {GALLERY_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Ngày tổ chức (tùy chọn)</label>
                        <input
                          type="date"
                          value={galForm.event_date}
                          onChange={(e) =>
                            setGalForm({ ...galForm, event_date: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label>Mô tả ngắn (tùy chọn)</label>
                      <input
                        type="text"
                        placeholder="VD: Hoa tươi nhập khẩu phối voan lụa kem, lắp đặt trọn gói tại tư gia..."
                        value={galForm.description}
                        onChange={(e) =>
                          setGalForm({ ...galForm, description: e.target.value })
                        }
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 16 }}>
                      <label>
                        Chọn ảnh thực tế (có thể chọn nhiều ảnh cùng lúc, tự động nén &lt; 1MB)
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                        <label
                          className="btn btn-outline btn-sm"
                          style={{ cursor: 'pointer', marginBottom: 0 }}
                        >
                          {uploadingGal ? 'Đang nén ảnh...' : '📁 Chọn 1 hoặc nhiều ảnh'}
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            hidden
                            disabled={uploadingGal}
                            onChange={handleGalleryFiles}
                          />
                        </label>
                        {galForm.images.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => setGalForm((prev) => ({ ...prev, images: [] }))}
                          >
                            ✕ Xóa ảnh đã chọn ({galForm.images.length})
                          </button>
                        )}
                      </div>

                      {galForm.images.length > 0 && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                            gap: 10,
                            marginTop: 12,
                          }}
                        >
                          {galForm.images.map((img, i) => (
                            <div
                              key={i}
                              style={{
                                position: 'relative',
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                overflow: 'hidden',
                                background: '#fff',
                              }}
                            >
                              <img
                                src={img.dataUrl}
                                alt={`Preview ${i + 1}`}
                                style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
                              />
                              <div style={{ padding: '4px 6px', fontSize: 10.5, color: '#64748b' }}>
                                {img.info}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={savingGal || uploadingGal}
                    >
                      {savingGal ? 'Đang đăng lên Website...' : '✨ Đăng ảnh lên Thư viện Website'}
                    </button>
                  </form>

                  {/* Danh sách ảnh đã đăng */}
                  <div className="card" style={{ padding: 20 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                        marginBottom: 14,
                      }}
                    >
                      <h3>🖼 Ảnh đám thực tế đã đăng ({gallery.length})</h3>
                      <select
                        value={galFilter}
                        onChange={(e) => setGalFilter(e.target.value)}
                        style={{ padding: '6px 10px', fontSize: 13 }}
                      >
                        <option value="all">Tất cả hạng mục</option>
                        {GALLERY_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    {gallery.filter((g) => galFilter === 'all' || g.category === galFilter).length === 0 ? (
                      <div className="empty-state" style={{ padding: 28 }}>
                        Chưa có ảnh đám thực tế nào được tải lên ở mục này.
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                          gap: 14,
                        }}
                      >
                        {gallery
                          .filter((g) => galFilter === 'all' || g.category === galFilter)
                          .map((item) => (
                            <div
                              key={item.id}
                              style={{
                                border: '1px solid #e2e8f0',
                                borderRadius: 10,
                                overflow: 'hidden',
                                background: '#fff',
                                opacity: item.is_featured ? 1 : 0.6,
                              }}
                            >
                              <img
                                src={item.image_url}
                                alt={item.title}
                                style={{ width: '100%', height: 165, objectFit: 'cover', display: 'block' }}
                              />
                              <div style={{ padding: 12 }}>
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 6,
                                    marginBottom: 6,
                                  }}
                                >
                                  <span className="badge badge-green">{item.category}</span>
                                  {item.event_date && (
                                    <span className="text-xs text-muted">
                                      {formatDate(item.event_date)}
                                    </span>
                                  )}
                                </div>
                                <div className="font-bold" style={{ fontSize: 14, marginBottom: 4 }}>
                                  {item.title}
                                </div>
                                {item.description && (
                                  <div className="text-xs text-muted" style={{ marginBottom: 10 }}>
                                    {item.description}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{ flex: 1 }}
                                    onClick={() => handleToggleFeatured(item)}
                                  >
                                    {item.is_featured ? '👁 Đang hiện' : '🙈 Đang ẩn'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{ color: '#dc2626', borderColor: '#fecaca' }}
                                    onClick={() => handleDeleteGallery(item)}
                                  >
                                    🗑
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Tab 3: Settings */
            <form onSubmit={handleSaveSettings} className="card" style={{ padding: 20 }}>
              {!isManagerOrAdmin && (
                <div className="alert alert-error" style={{ marginBottom: 16 }}>
                  Chỉ Quản trị (Admin) hoặc Quản lý (Manager) mới có quyền chỉnh sửa nội dung Website.
                </div>
              )}

              <h3 style={{ marginBottom: 12 }}>1. Phần mở đầu (Hero Banner & Slogan)</h3>
              <div className="form-grid" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label>Slogan chính trên trang chủ</label>
                  <input
                    type="text"
                    disabled={!isManagerOrAdmin}
                    value={settings.slogan}
                    onChange={(e) => setSettings({ ...settings, slogan: e.target.value })}
                    placeholder="Là ngày đẹp nhất"
                  />
                </div>
                <div className="form-group">
                  <label>Khu vực phục vụ</label>
                  <input
                    type="text"
                    disabled={!isManagerOrAdmin}
                    value={settings.service_area}
                    onChange={(e) => setSettings({ ...settings, service_area: e.target.value })}
                    placeholder="Đồng Nai - TP.HCM"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Câu mô tả ngắn ngay dưới Slogan</label>
                <textarea
                  rows={2}
                  disabled={!isManagerOrAdmin}
                  value={settings.hero_subtitle}
                  onChange={(e) => setSettings({ ...settings, hero_subtitle: e.target.value })}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 22 }}>
                <label>Ảnh Banner đầu trang (tự động nén &lt; 1MB, khuyên dùng ảnh ngang đẹp nhất)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                  {isManagerOrAdmin && (
                    <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                      {uploadingBanner ? 'Đang nén ảnh...' : '📷 Chọn ảnh Banner mới'}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={uploadingBanner}
                        onChange={handleBannerUpload}
                      />
                    </label>
                  )}
                  {settings.hero_image_url && isManagerOrAdmin && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setSettings({ ...settings, hero_image_url: '' })
                        setBannerInfo('')
                      }}
                    >
                      ✕ Gỡ ảnh (dùng khung mặc định)
                    </button>
                  )}
                  {bannerInfo && <span className="text-xs text-green">{bannerInfo}</span>}
                </div>

                {settings.hero_image_url && (
                  <div style={{ marginTop: 12 }}>
                    <img
                      src={settings.hero_image_url}
                      alt="Hero Banner Preview"
                      style={{
                        maxWidth: 420,
                        width: '100%',
                        maxHeight: 220,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                      }}
                    />
                  </div>
                )}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

              <h3 style={{ marginBottom: 12 }}>2. Câu chuyện thương hiệu & Con số nổi bật</h3>
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <div className="form-group">
                  <label>Số năm kinh nghiệm (VD: 3+)</label>
                  <input
                    type="text"
                    disabled={!isManagerOrAdmin}
                    value={settings.years_exp}
                    onChange={(e) => setSettings({ ...settings, years_exp: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Số lễ cưới đã thực hiện (VD: 100+)</label>
                  <input
                    type="text"
                    disabled={!isManagerOrAdmin}
                    value={settings.weddings_count}
                    onChange={(e) => setSettings({ ...settings, weddings_count: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Tiêu đề giới thiệu</label>
                <input
                  type="text"
                  disabled={!isManagerOrAdmin}
                  value={settings.about_title}
                  onChange={(e) => setSettings({ ...settings, about_title: e.target.value })}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 22 }}>
                <label>Nội dung giới thiệu Đặng Wedding</label>
                <textarea
                  rows={4}
                  disabled={!isManagerOrAdmin}
                  value={settings.about_body}
                  onChange={(e) => setSettings({ ...settings, about_body: e.target.value })}
                />
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

              <h3 style={{ marginBottom: 12 }}>3. Thông tin liên hệ & Mạng xã hội</h3>
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <div className="form-group">
                  <label>Hotline / Zalo hiển thị</label>
                  <input
                    type="text"
                    disabled={!isManagerOrAdmin}
                    value={settings.phone}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Địa chỉ cửa hàng / kho (để trống nếu không muốn hiện)</label>
                  <input
                    type="text"
                    disabled={!isManagerOrAdmin}
                    value={settings.address || ''}
                    onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                    placeholder="VD: Biên Hòa, Đồng Nai"
                  />
                </div>
              </div>

              <div className="form-grid" style={{ marginBottom: 22 }}>
                <div className="form-group">
                  <label>Link Fanpage Facebook</label>
                  <input
                    type="url"
                    disabled={!isManagerOrAdmin}
                    value={settings.facebook_url}
                    onChange={(e) => setSettings({ ...settings, facebook_url: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Link TikTok</label>
                  <input
                    type="url"
                    disabled={!isManagerOrAdmin}
                    value={settings.tiktok_url}
                    onChange={(e) => setSettings({ ...settings, tiktok_url: e.target.value })}
                  />
                </div>
              </div>

              <div className="sub-card" style={{ marginBottom: 20 }}>
                <strong>💡 Lưu ý về Thư viện trên Website:</strong>
                <p className="text-muted" style={{ fontSize: 13.5, marginTop: 4 }}>
                  Mục Thư viện trên <strong>dangwed.com</strong> tự động gộp hình ảnh từ tab{' '}
                  <strong>🖼 Thư viện ảnh đám thực tế</strong> ở trên cùng với các mẫu trong{' '}
                  <Link to="/mau-set" style={{ color: '#163828', fontWeight: 600 }}>
                    ✨ Mẫu set trang trí
                  </Link>
                  . Giá vốn và số lượng vật tư nội bộ hoàn toàn được ẩn khỏi khách hàng.
                </p>
              </div>

              {isManagerOrAdmin && (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingSettings}
                >
                  {savingSettings ? 'Đang lưu...' : '💾 Lưu thay đổi lên Website'}
                </button>
              )}
            </form>
          )}
        </>
      )}
    </div>
  )
}
