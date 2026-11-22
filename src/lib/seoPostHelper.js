// Chuyển đổi giữa Cấu trúc bài SEO (Mở bài -> Các mục H2 + Ảnh -> Lưu ý) và Markdown lưu trong Supabase

export function emptySection(index = 1) {
  return {
    heading: `${index}. `,
    body: '',
    imageUrl: '',
    imageAlt: '',
  }
}

export function parseContentToSeoStructure(content = '') {
  const blocks = String(content || '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  const introParts = []
  const sections = []
  let conclusionQuote = ''
  let current = null

  for (const block of blocks) {
    if (block.startsWith('## ')) {
      if (current) sections.push(current)
      const lines = block.split('\n')
      current = {
        heading: lines[0].replace(/^##\s+/, '').trim(),
        body: lines.slice(1).join('\n').trim(),
        imageUrl: '',
        imageAlt: '',
      }
      continue
    }

    const imgMatch = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (imgMatch) {
      if (current) {
        if (!current.imageUrl) {
          current.imageAlt = imgMatch[1].trim()
          current.imageUrl = imgMatch[2].trim()
        } else {
          current.body = current.body ? `${current.body}\n\n${block}` : block
        }
      } else {
        introParts.push(block)
      }
      continue
    }

    if (block.startsWith('> ')) {
      conclusionQuote = block.replace(/^>\s+/, '').trim()
      continue
    }

    if (current) {
      current.body = current.body ? `${current.body}\n\n${block}` : block
    } else {
      introParts.push(block)
    }
  }

  if (current) sections.push(current)

  return {
    intro: introParts.join('\n\n'),
    sections: sections.length > 0 ? sections : [emptySection(1), emptySection(2)],
    conclusionQuote,
  }
}

export function buildMarkdownFromSeoStructure({ intro = '', sections = [], conclusionQuote = '' }) {
  const parts = []
  if (intro.trim()) parts.push(intro.trim())

  for (const sec of sections) {
    const h = (sec.heading || '').trim()
    const b = (sec.body || '').trim()
    const img = (sec.imageUrl || '').trim()
    const alt = (sec.imageAlt || h || 'Đặng Wedding').trim()

    if (h || b || img) {
      let block = h ? `## ${h}` : ''
      if (b) block = block ? `${block}\n${b}` : b
      if (block) parts.push(block)
      if (img) parts.push(`![${alt}](${img})`)
    }
  }

  if (conclusionQuote.trim()) {
    parts.push(`> ${conclusionQuote.trim()}`)
  }

  return parts.join('\n\n')
}

export function evaluateSeoChecklist({ title = '', excerpt = '', seo_keywords = '', cover_image_url = '', content = '' }) {
  const titleLen = title.trim().length
  const descLen = excerpt.trim().length
  const h2Count = (String(content).match(/^##\s+/gm) || []).length
  const hasImg = Boolean(cover_image_url) || /!\[[^\]]*\]\([^)]+\)/.test(content)
  const hasKeywords = seo_keywords.trim().length >= 3

  const checks = [
    {
      label: `Tiêu đề SEO (${titleLen}/70 ký tự — chuẩn 35–70)`,
      ok: titleLen >= 25 && titleLen <= 80,
    },
    {
      label: `Meta Description / Tóm tắt (${descLen}/160 ký tự — chuẩn 80–165)`,
      ok: descLen >= 60 && descLen <= 180,
    },
    {
      label: 'Có từ khóa tìm kiếm Google',
      ok: hasKeywords,
    },
    {
      label: `Có cấu trúc mục H2 rõ ràng (${h2Count} mục — khuyên dùng ≥ 2)`,
      ok: h2Count >= 2,
    },
    {
      label: 'Có hình ảnh bìa hoặc ảnh minh họa trong bài',
      ok: hasImg,
    },
  ]

  const score = checks.filter((c) => c.ok).length
  return { checks, score, total: checks.length }
}
