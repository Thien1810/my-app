import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatDate, generateProjectCode } from '../lib/formatters'
import { compressImageUnder1MB, formatBytes } from '../lib/imageCompressor'
import {
  buildMarkdownFromSeoStructure,
  emptySection,
  evaluateSeoChecklist,
  parseContentToSeoStructure,
} from '../lib/seoPostHelper'

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

const POST_CATEGORIES = [
  'Kinh nghiệm cưới',
  'Trang trí Gia tiên',
  'Mâm quả cưới hỏi',
  'Tiệc cưới & Backdrop',
]

function toSlug(str = '') {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function isMissingTableErr(err) {
  if (!err) return false
  const msg = (err.message || '').toLowerCase()
  return (
    err.code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  )
}

export default function WebsiteAdminPage() {
  const { isManagerOrAdmin, isStaff } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState('leads') // 'leads' | 'gallery' | 'posts' | 'settings'
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

  // Posts (SEO Blog) state
  const [posts, setPosts] = useState([])
  const [postsMissing, setPostsMissing] = useState(false)
  const [editingPostId, setEditingPostId] = useState(null)
  const [postForm, setPostForm] = useState({
    title: '',
    slug: '',
    category: 'Kinh nghiệm cưới',
    excerpt: '',
    content: '',
    cover_image_url: '',
    seo_keywords: '',
    is_published: true,
  })
  const [uploadingPostCover, setUploadingPostCover] = useState(false)
  const [savingPost, setSavingPost] = useState(false)
  const [postEditorMode, setPostEditorMode] = useState('structured') // 'structured' | 'raw'
  const [googlePreviewMode, setGooglePreviewMode] = useState('desktop') // 'desktop' | 'mobile'
  const [seoStruct, setSeoStruct] = useState({
    intro: '',
    sections: [emptySection(1), emptySection(2)],
    conclusionQuote: '',
  })

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
    setPostsMissing(false)
    try {
      const [leadsRes, settingsRes, galleryRes, postsRes] = await Promise.all([
        supabase.from('site_leads').select('*').order('created_at', { ascending: false }),
        supabase.from('site_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('site_gallery').select('*').order('created_at', { ascending: false }),
        supabase.from('site_posts').select('*').order('published_at', { ascending: false }),
      ])

      const err = leadsRes.error || settingsRes.error
      if (err) {
        if (isMissingTableErr(err)) {
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
        if (isMissingTableErr(galleryRes.error)) setGalleryMissing(true)
      } else {
        setGallery(galleryRes.data || [])
      }

      if (postsRes.error) {
        if (isMissingTableErr(postsRes.error)) setPostsMissing(true)
      } else {
        setPosts(postsRes.data || [])
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
      <div className="page-container">
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

  // Handlers Bài viết SEO
  const resetPostForm = () => {
    setEditingPostId(null)
    setPostForm({
      title: '',
      slug: '',
      category: 'Kinh nghiệm cưới',
      excerpt: '',
      content: '',
      cover_image_url: '',
      seo_keywords: '',
      is_published: true,
    })
    setSeoStruct({
      intro: '',
      sections: [emptySection(1), emptySection(2)],
      conclusionQuote: '',
    })
    setPostEditorMode('structured')
  }

  const syncStructToContent = (nextStruct) => {
    setSeoStruct(nextStruct)
    setPostForm((prev) => ({
      ...prev,
      content: buildMarkdownFromSeoStructure(nextStruct),
    }))
  }

  const handleSectionImageUpload = async (idx, e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPostCover(true)
    setErrorMsg('')
    try {
      const res = await compressImageUnder1MB(file)
      const nextSections = seoStruct.sections.map((s, i) =>
        i === idx
          ? {
              ...s,
              imageUrl: res.dataUrl,
              imageAlt: s.imageAlt || s.heading || 'Mẫu trang trí Đặng Wedding',
            }
          : s
      )
      syncStructToContent({ ...seoStruct, sections: nextSections })
      showToast('✓ Đã gắn ảnh minh họa vào mục!')
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setUploadingPostCover(false)
      e.target.value = ''
    }
  }

  const handlePostCoverUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPostCover(true)
    setErrorMsg('')
    try {
      const res = await compressImageUnder1MB(file)
      setPostForm((prev) => ({ ...prev, cover_image_url: res.dataUrl }))
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setUploadingPostCover(false)
      e.target.value = ''
    }
  }

  const handlePostInlineImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPostCover(true)
    setErrorMsg('')
    try {
      const res = await compressImageUnder1MB(file)
      const caption = window.prompt('Nhập chú thích ngắn cho ảnh (tốt cho SEO Google):', 'Mẫu trang trí thực tế tại Đặng Wedding') || 'Đặng Wedding'
      setPostForm((prev) => ({
        ...prev,
        content: `${prev.content.trimEnd()}\n\n![${caption}](${res.dataUrl})\n\n`,
      }))
      showToast('✓ Đã chèn ảnh vào nội dung bài viết!')
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setUploadingPostCover(false)
      e.target.value = ''
    }
  }

  const appendPostSnippet = (snippet) => {
    setPostForm((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content.trimEnd()}\n\n${snippet}` : snippet,
    }))
  }

  const handleSavePost = async (e) => {
    e.preventDefault()
    if (!postForm.title.trim() || !postForm.content.trim()) {
      setErrorMsg('Vui lòng nhập Tiêu đề và Nội dung bài viết.')
      return
    }
    setSavingPost(true)
    setErrorMsg('')
    try {
      const finalSlug = (postForm.slug.trim() || toSlug(postForm.title)) || `bai-viet-${Date.now()}`
      const payload = {
        title: postForm.title.trim(),
        slug: finalSlug,
        category: postForm.category || 'Kinh nghiệm cưới',
        excerpt: postForm.excerpt.trim(),
        content: postForm.content.trim(),
        cover_image_url: postForm.cover_image_url || '',
        seo_keywords: postForm.seo_keywords.trim(),
        is_published: Boolean(postForm.is_published),
      }
      if (editingPostId) {
        const { data, error } = await supabase
          .from('site_posts')
          .update(payload)
          .eq('id', editingPostId)
          .select('*')
          .single()
        if (error) throw error
        setPosts((prev) => prev.map((p) => (p.id === editingPostId ? data : p)))
        showToast('✓ Đã cập nhật bài viết SEO!')
      } else {
        const { data, error } = await supabase
          .from('site_posts')
          .insert({ ...payload, published_at: new Date().toISOString() })
          .select('*')
          .single()
        if (error) throw error
        setPosts((prev) => [data, ...prev])
        showToast('✓ Đã đăng bài viết mới lên Cẩm nang dangwed.com!')
      }
      resetPostForm()
    } catch (err) {
      setErrorMsg('Lỗi khi lưu bài viết: ' + err.message)
    } finally {
      setSavingPost(false)
    }
  }

  const handleEditPost = (post) => {
    setEditingPostId(post.id)
    setPostForm({
      title: post.title || '',
      slug: post.slug || '',
      category: post.category || 'Kinh nghiệm cưới',
      excerpt: post.excerpt || '',
      content: post.content || '',
      cover_image_url: post.cover_image_url || '',
      seo_keywords: post.seo_keywords || '',
      is_published: Boolean(post.is_published),
    })
    setSeoStruct(parseContentToSeoStructure(post.content || ''))
    setPostEditorMode('structured')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleTogglePostPublish = async (post) => {
    const next = !post.is_published
    const { error } = await supabase
      .from('site_posts')
      .update({ is_published: next })
      .eq('id', post.id)
    if (error) {
      setErrorMsg('Không thể cập nhật trạng thái bài viết: ' + error.message)
      return
    }
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_published: next } : p)))
    showToast(next ? 'Đã xuất bản bài viết lên Website.' : 'Đã chuyển bài viết về Nháp (ẩn).')
  }

  const handleDeletePost = async (post) => {
    if (!window.confirm(`Xóa bài viết "${post.title}"?`)) return
    const { error } = await supabase.from('site_posts').delete().eq('id', post.id)
    if (error) {
      setErrorMsg('Không thể xóa bài viết: ' + error.message)
      return
    }
    setPosts((prev) => prev.filter((p) => p.id !== post.id))
    if (editingPostId === post.id) resetPostForm()
    showToast('Đã xóa bài viết.')
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
    <div className="page-container">
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
          <div className="tabs-bar" style={{ marginBottom: 18 }}>
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
              className={`tab-btn ${tab === 'posts' ? 'active' : ''}`}
              onClick={() => setTab('posts')}
            >
              ✍️ Bài viết SEO ({posts.length})
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
              <div className="card filter-bar" style={{ marginBottom: 16 }}><div className="filter-group" style={{ alignItems: "center" }}>
                <input
                  type="text"
                  className="filter-input"
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

                    <div className="form-grid-2" style={{ marginBottom: 14 }}>
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
          ) : tab === 'posts' ? (
            /* Tab 3: Bài viết Cẩm nang SEO */
            <div style={{ display: 'grid', gap: 18 }}>
              {postsMissing ? (
                <div className="card" style={{ padding: 24 }}>
                  <h3 style={{ marginBottom: 8 }}>
                    ⚙️ Cần chạy lại SQL để bật mục Bài viết Cẩm nang SEO
                  </h3>
                  <p className="text-muted" style={{ marginBottom: 14, lineHeight: 1.6 }}>
                    Database chưa có bảng <code>site_posts</code>. Anh mở{' '}
                    <strong>Supabase → SQL Editor</strong>, dán toàn bộ file{' '}
                    <code>my-app/supabase/website_schema.sql</code> bản mới nhất rồi bấm{' '}
                    <strong>Run</strong> (sẽ tự tạo bảng và sẵn 3 bài viết mẫu chuẩn SEO), sau đó
                    bấm kiểm tra lại nhé.
                  </p>
                  <button type="button" className="btn btn-primary" onClick={loadData}>
                    🔄 Kiểm tra lại kết nối
                  </button>
                </div>
              ) : (
                <>
                  <form onSubmit={handleSavePost}>
                    <div className="seo-editor-layout">
                      {/* CỘT TRÁI: SOẠN THẢO BÀI VIẾT */}
                      <div className="seo-editor-main">
                        <div className="card" style={{ padding: 20 }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 14,
                              gap: 10,
                              flexWrap: 'wrap',
                            }}
                          >
                            <h3>
                              {editingPostId
                                ? '✏️ Chỉnh sửa bài viết SEO'
                                : '✍️ Viết bài Cẩm nang mới (Chuẩn SEO Google)'}
                            </h3>
                            {editingPostId && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={resetPostForm}
                              >
                                ✕ Hủy sửa / Viết bài mới
                              </button>
                            )}
                          </div>

                          <div className="form-group" style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <label>Tiêu đề bài viết (Thẻ H1) *</label>
                              <span className="text-xs text-muted">
                                {postForm.title.trim().length}/70 ký tự
                              </span>
                            </div>
                            <input
                              type="text"
                              required
                              style={{ fontSize: 16, fontWeight: 600 }}
                              placeholder="VD: Kinh nghiệm chọn tông màu trang trí Gia tiên sang trọng"
                              value={postForm.title}
                              onChange={(e) => {
                                const title = e.target.value
                                setPostForm((prev) => ({
                                  ...prev,
                                  title,
                                  slug: editingPostId ? prev.slug : toSlug(title),
                                }))
                              }}
                            />
                          </div>

                          <div className="form-group" style={{ marginBottom: 12 }}>
                            <label>Đường dẫn thân thiện (Permalink / Slug)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span className="text-xs text-muted">https://dangwed.com/cam-nang/</span>
                              <input
                                type="text"
                                style={{ flex: 1, minWidth: 200 }}
                                placeholder="kinh-nghiem-chon-mau-gia-tien"
                                value={postForm.slug}
                                onChange={(e) => setPostForm({ ...postForm, slug: e.target.value })}
                              />
                            </div>
                          </div>

                          <div className="form-group">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <label>Meta Description (Tóm tắt hiển thị trên Google)</label>
                              <span className="text-xs text-muted">
                                {postForm.excerpt.trim().length}/160 ký tự
                              </span>
                            </div>
                            <textarea
                              rows={2}
                              placeholder="1-2 câu mô tả hấp dẫn chứa từ khóa chính (khoảng 120–160 ký tự)..."
                              value={postForm.excerpt}
                              onChange={(e) => setPostForm({ ...postForm, excerpt: e.target.value })}
                            />
                          </div>
                        </div>

                        {/* KHUNG NỘI DUNG BÀI VIẾT */}
                        <div className="card" style={{ padding: 20 }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                              marginBottom: 14,
                            }}
                          >
                            <strong style={{ fontSize: 15 }}>
                              📄 Nội dung bài viết (Mở bài → Heading H2 &amp; Ảnh → Kết bài)
                            </strong>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                className={`btn btn-sm ${postEditorMode === 'structured' ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => {
                                  setSeoStruct(parseContentToSeoStructure(postForm.content))
                                  setPostEditorMode('structured')
                                }}
                              >
                                🧩 Theo từng mục SEO
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${postEditorMode === 'raw' ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => setPostEditorMode('raw')}
                              >
                                📝 Văn bản Markdown
                              </button>
                            </div>
                          </div>

                          {postEditorMode === 'structured' ? (
                            <div style={{ display: 'grid', gap: 12 }}>
                              <div className="sub-card">
                                <label className="text-xs font-bold" style={{ display: 'block', marginBottom: 6 }}>
                                  A. Đoạn Mở bài (Sapo dẫn nhập — nên nhắc từ khóa chính)
                                </label>
                                <textarea
                                  rows={3}
                                  placeholder="Viết 2-3 câu mở đầu giới thiệu chủ đề bài viết..."
                                  value={seoStruct.intro}
                                  onChange={(e) =>
                                    syncStructToContent({ ...seoStruct, intro: e.target.value })
                                  }
                                />
                              </div>

                              {seoStruct.sections.map((sec, idx) => (
                                <div
                                  key={idx}
                                  className="sub-card"
                                  style={{ borderLeft: '3px solid #163828' }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      marginBottom: 8,
                                      gap: 8,
                                    }}
                                  >
                                    <strong style={{ fontSize: 13.5, color: '#163828' }}>
                                      Mục Heading H2 #{idx + 1}
                                    </strong>
                                    {seoStruct.sections.length > 1 && (
                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm"
                                        style={{ color: '#dc2626', borderColor: '#fecaca' }}
                                        onClick={() => {
                                          const next = seoStruct.sections.filter((_, i) => i !== idx)
                                          syncStructToContent({ ...seoStruct, sections: next })
                                        }}
                                      >
                                        🗑 Xóa mục
                                      </button>
                                    )}
                                  </div>

                                  <div className="form-group" style={{ marginBottom: 8 }}>
                                    <input
                                      type="text"
                                      placeholder={`Tiêu đề mục H2 #${idx + 1} (VD: 1. Chọn tông màu Gia tiên...)`}
                                      value={sec.heading}
                                      onChange={(e) => {
                                        const next = seoStruct.sections.map((s, i) =>
                                          i === idx ? { ...s, heading: e.target.value } : s
                                        )
                                        syncStructToContent({ ...seoStruct, sections: next })
                                      }}
                                    />
                                  </div>

                                  <div className="form-group" style={{ marginBottom: 8 }}>
                                    <textarea
                                      rows={3}
                                      placeholder="Nội dung chi tiết của mục (dòng bắt đầu bằng '- ' sẽ tự thành danh sách gạch đầu dòng)..."
                                      value={sec.body}
                                      onChange={(e) => {
                                        const next = seoStruct.sections.map((s, i) =>
                                          i === idx ? { ...s, body: e.target.value } : s
                                        )
                                        syncStructToContent({ ...seoStruct, sections: next })
                                      }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <label
                                      className="btn btn-outline btn-sm"
                                      style={{ cursor: 'pointer', marginBottom: 0 }}
                                    >
                                      📷 {sec.imageUrl ? 'Đổi ảnh mục này' : 'Thêm ảnh minh họa'}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        disabled={uploadingPostCover}
                                        onChange={(e) => handleSectionImageUpload(idx, e)}
                                      />
                                    </label>
                                    {sec.imageUrl && (
                                      <>
                                        <input
                                          type="text"
                                          placeholder="Chú thích ảnh (Alt SEO)"
                                          value={sec.imageAlt}
                                          style={{ flex: 1, minWidth: 180, padding: '6px 10px', fontSize: 13 }}
                                          onChange={(e) => {
                                            const next = seoStruct.sections.map((s, i) =>
                                              i === idx ? { ...s, imageAlt: e.target.value } : s
                                            )
                                            syncStructToContent({ ...seoStruct, sections: next })
                                          }}
                                        />
                                        <button
                                          type="button"
                                          className="btn btn-outline btn-sm"
                                          onClick={() => {
                                            const next = seoStruct.sections.map((s, i) =>
                                              i === idx ? { ...s, imageUrl: '', imageAlt: '' } : s
                                            )
                                            syncStructToContent({ ...seoStruct, sections: next })
                                          }}
                                        >
                                          ✕ Gỡ
                                        </button>
                                      </>
                                    )}
                                  </div>
                                  {sec.imageUrl && (
                                    <img
                                      src={sec.imageUrl}
                                      alt={sec.imageAlt || sec.heading}
                                      style={{
                                        marginTop: 8,
                                        maxWidth: 240,
                                        maxHeight: 130,
                                        objectFit: 'cover',
                                        borderRadius: 6,
                                        border: '1px solid #e2e8f0',
                                      }}
                                    />
                                  )}
                                </div>
                              ))}

                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ justifySelf: 'start' }}
                                onClick={() =>
                                  syncStructToContent({
                                    ...seoStruct,
                                    sections: [
                                      ...seoStruct.sections,
                                      emptySection(seoStruct.sections.length + 1),
                                    ],
                                  })
                                }
                              >
                                ➕ Thêm mục Heading H2 mới
                              </button>

                              <div className="sub-card">
                                <label className="text-xs font-bold" style={{ display: 'block', marginBottom: 6 }}>
                                  B. Lời khuyên / Cam kết nổi bật cuối bài (tùy chọn)
                                </label>
                                <input
                                  type="text"
                                  placeholder="VD: Mẹo từ Đặng Wedding: Đặt lịch trước 3-4 tuần để giữ ngày đẹp..."
                                  value={seoStruct.conclusionQuote}
                                  onChange={(e) =>
                                    syncStructToContent({
                                      ...seoStruct,
                                      conclusionQuote: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => appendPostSnippet('## 1. Tiêu đề mục chính\nNội dung mục...')}
                                >
                                  + H2
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => appendPostSnippet('### Điểm nổi bật\nNội dung chi tiết...')}
                                >
                                  + H3
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => appendPostSnippet('- Ý thứ nhất\n- Ý thứ hai')}
                                >
                                  + Danh sách
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => appendPostSnippet('> Mẹo từ Đặng Wedding: ...')}
                                >
                                  + Ghi chú
                                </button>
                                <label
                                  className="btn btn-outline btn-sm"
                                  style={{ cursor: 'pointer', marginBottom: 0 }}
                                >
                                  📷 Chèn ảnh
                                  <input
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    disabled={uploadingPostCover}
                                    onChange={handlePostInlineImage}
                                  />
                                </label>
                              </div>
                              <textarea
                                rows={10}
                                required
                                placeholder={'Mở bài thu hút...\n\n## 1. Tiêu đề mục chính\nNội dung chi tiết...'}
                                value={postForm.content}
                                onChange={(e) => setPostForm({ ...postForm, content: e.target.value })}
                              />
                            </>
                          )}
                        </div>
                      </div>

                      {/* CỘT PHẢI: XUẤT BẢN + CHẤM ĐIỂM SEO RANKMATH + GOOGLE PREVIEW */}
                      <div className="seo-editor-sidebar">
                        {/* Box 1: Xuất bản & Phân loại */}
                        <div className="card" style={{ padding: 18 }}>
                          <strong style={{ display: 'block', marginBottom: 12, fontSize: 15 }}>
                            🚀 Xuất bản &amp; Phân loại
                          </strong>

                          <div className="form-group" style={{ marginBottom: 12 }}>
                            <label>Chuyên mục</label>
                            <select
                              value={postForm.category}
                              onChange={(e) => setPostForm({ ...postForm, category: e.target.value })}
                            >
                              {POST_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="form-group" style={{ marginBottom: 12 }}>
                            <label>Ảnh bìa bài viết (&lt; 1MB)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <label
                                className="btn btn-outline btn-sm"
                                style={{ cursor: 'pointer', marginBottom: 0 }}
                              >
                                {uploadingPostCover ? 'Đang nén...' : '📷 Chọn ảnh bìa'}
                                <input
                                  type="file"
                                  accept="image/*"
                                  hidden
                                  disabled={uploadingPostCover}
                                  onChange={handlePostCoverUpload}
                                />
                              </label>
                              {postForm.cover_image_url && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => setPostForm((p) => ({ ...p, cover_image_url: '' }))}
                                >
                                  ✕ Gỡ
                                </button>
                              )}
                            </div>
                            {postForm.cover_image_url && (
                              <img
                                src={postForm.cover_image_url}
                                alt="Cover preview"
                                style={{
                                  marginTop: 8,
                                  width: '100%',
                                  maxHeight: 150,
                                  objectFit: 'cover',
                                  borderRadius: 8,
                                  border: '1px solid #e2e8f0',
                                }}
                              />
                            )}
                          </div>

                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: 13.5,
                              cursor: 'pointer',
                              marginBottom: 14,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={postForm.is_published}
                              onChange={(e) =>
                                setPostForm({ ...postForm, is_published: e.target.checked })
                              }
                            />
                            Hiển thị công khai trên Website
                          </label>

                          <button
                            type="submit"
                            className="btn btn-primary btn-block"
                            disabled={savingPost || uploadingPostCover}
                          >
                            {savingPost
                              ? 'Đang lưu bài viết...'
                              : editingPostId
                                ? '💾 Cập nhật bài viết'
                                : '✍️ Đăng bài viết lên Website'}
                          </button>
                        </div>

                        {/* Box 2: RankMath SEO Score + Google Preview */}
                        {(() => {
                          const seoReport = evaluateSeoChecklist(postForm)
                          const scoreColor =
                            seoReport.score100 >= 80
                              ? '#16a34a'
                              : seoReport.score100 >= 50
                                ? '#d97706'
                                : '#dc2626'
                          const badgeCls =
                            seoReport.score100 >= 80
                              ? 'badge-green'
                              : seoReport.score100 >= 50
                                ? 'badge-amber'
                                : 'badge-danger'
                          return (
                            <div className="card" style={{ padding: 18 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                }}
                              >
                                <strong style={{ fontSize: 15 }}>📊 Điểm SEO Google</strong>
                                <span className={`badge ${badgeCls}`}>
                                  {seoReport.score100} / 100 điểm
                                </span>
                              </div>

                              <div className="seo-score-bar-track">
                                <div
                                  className="seo-score-bar-fill"
                                  style={{
                                    width: `${seoReport.score100}%`,
                                    backgroundColor: scoreColor,
                                  }}
                                />
                              </div>

                              <div className="form-group" style={{ marginBottom: 12 }}>
                                <label>Từ khóa chính (Focus Keyword)</label>
                                <input
                                  type="text"
                                  placeholder="VD: trang trí gia tiên, mâm quả..."
                                  value={postForm.seo_keywords}
                                  onChange={(e) =>
                                    setPostForm({ ...postForm, seo_keywords: e.target.value })
                                  }
                                />
                              </div>

                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: 6,
                                }}
                              >
                                <span className="text-xs font-bold text-muted">
                                  🔍 Xem trước trên Google:
                                </span>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${googlePreviewMode === 'desktop' ? 'btn-primary' : 'btn-outline'}`}
                                    style={{ padding: '2px 8px', fontSize: 11 }}
                                    onClick={() => setGooglePreviewMode('desktop')}
                                  >
                                    Máy tính
                                  </button>
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${googlePreviewMode === 'mobile' ? 'btn-primary' : 'btn-outline'}`}
                                    style={{ padding: '2px 8px', fontSize: 11 }}
                                    onClick={() => setGooglePreviewMode('mobile')}
                                  >
                                    Điện thoại
                                  </button>
                                </div>
                              </div>

                              <div
                                className={`seo-google-preview ${
                                  googlePreviewMode === 'mobile' ? 'mobile-mode' : ''
                                }`}
                              >
                                <div style={{ fontSize: 11.5, color: '#15803d', wordBreak: 'break-all' }}>
                                  dangwed.com › cam-nang ›{' '}
                                  {postForm.slug || toSlug(postForm.title) || 'bai-viet-moi'}
                                </div>
                                <div
                                  style={{
                                    fontSize: 15.5,
                                    color: '#1d4ed8',
                                    fontWeight: 500,
                                    margin: '3px 0',
                                  }}
                                >
                                  {postForm.title.trim() || 'Tiêu đề bài viết chuẩn SEO | Đặng Wedding'}
                                </div>
                                <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.45 }}>
                                  {postForm.excerpt.trim() ||
                                    'Meta Description sẽ hiển thị tại đây để thu hút cô dâu chú rể bấm vào đọc...'}
                                </div>
                              </div>

                              <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                                {seoReport.checks.map((ck, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      gap: 6,
                                      color: ck.ok ? '#15803d' : '#64748b',
                                    }}
                                  >
                                    <span>
                                      {ck.ok ? '✅' : '⬜'} {ck.label}
                                    </span>
                                    <span style={{ fontWeight: 600, flexShrink: 0 }}>
                                      +{ck.pts}đ
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </form>

                  <div className="card" style={{ padding: 20 }}>
                    <h3 style={{ marginBottom: 14 }}>📚 Danh sách bài viết ({posts.length})</h3>
                    {posts.length === 0 ? (
                      <div className="empty-state" style={{ padding: 24 }}>
                        Chưa có bài viết nào. Anh có thể viết bài đầu tiên ở form phía trên.
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 12 }}>
                        {posts.map((p) => (
                          <div
                            key={p.id}
                            className="sub-card"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: 14,
                              flexWrap: 'wrap',
                              opacity: p.is_published ? 1 : 0.65,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 240 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                                <span className="badge badge-green">{p.category}</span>
                                <span className={`badge ${p.is_published ? 'badge-blue' : 'badge-gray'}`}>
                                  {p.is_published ? 'Đang đăng' : 'Nháp (ẩn)'}
                                </span>
                                <span className="text-xs text-muted">
                                  {formatDate(p.published_at || p.created_at)}
                                </span>
                              </div>
                              <div className="font-bold" style={{ fontSize: 15, marginBottom: 4 }}>
                                {p.title}
                              </div>
                              {p.excerpt && (
                                <div className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
                                  {p.excerpt}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => handleTogglePostPublish(p)}
                              >
                                {p.is_published ? '👁 Đang hiện' : '🙈 Đang ẩn'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => handleEditPost(p)}
                              >
                                ✏️ Sửa
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ color: '#dc2626', borderColor: '#fecaca' }}
                                onClick={() => handleDeletePost(p)}
                              >
                                🗑
                              </button>
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
            /* Tab 4: Settings */
            <form onSubmit={handleSaveSettings} className="card" style={{ padding: 20 }}>
              {!isManagerOrAdmin && (
                <div className="alert alert-error" style={{ marginBottom: 16 }}>
                  Chỉ Quản trị (Admin) hoặc Quản lý (Manager) mới có quyền chỉnh sửa nội dung Website.
                </div>
              )}

              <h3 style={{ marginBottom: 12 }}>1. Phần mở đầu (Hero Banner & Slogan)</h3>
              <div className="form-grid-2" style={{ marginBottom: 16 }}>
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
              <div className="form-grid-2" style={{ marginBottom: 14 }}>
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
              <div className="form-grid-2" style={{ marginBottom: 14 }}>
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

              <div className="form-grid-2" style={{ marginBottom: 22 }}>
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

