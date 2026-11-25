// Tầng dữ liệu Mẫu set trang trí. App phải chạy được khi DB chưa chạy supabase/set_templates_v2.sql:
// thiếu bảng set_template_images hoặc cột description thì tắt tính năng mới thay vì lỗi.
import { supabase } from './supabase'
import { dataUrlToBlob, planImageSave, mimeToExt } from './setTemplateImages'
import {
  isMissingDescriptionColumn,
  isMissingImagesSchema,
  packTemplateNoteFallback,
} from './setTemplateMeta'

export const IMAGE_BUCKET = 'set-template-images'
const IMAGE_FIELDS = 'id, url, storage_path, sort_order, is_cover'
const ITEMS_EMBED = 'items:set_template_items(item_id, qty, item:items(id, code, name, unit, kind))'

// loadItems=false (nhân viên): không tải kho vật tư để giá vốn không về trình duyệt.
export async function loadTemplatesData({ loadItems = true } = {}) {
  const selectTemplates = (withImages) =>
    supabase
      .from('set_templates')
      .select(
        withImages
          ? `*, ${ITEMS_EMBED}, images:set_template_images(${IMAGE_FIELDS})`
          : `*, ${ITEMS_EMBED}`
      )
      .order('name')

  const [firstRes, itemsRes] = await Promise.all([
    selectTemplates(true),
    loadItems
      ? supabase.from('items').select('*').eq('active', true).order('name')
      : Promise.resolve({ data: [], error: null }),
  ])

  let tplRes = firstRes
  let imagesSupported = true
  if (tplRes.error && isMissingImagesSchema(tplRes.error)) {
    imagesSupported = false
    tplRes = await selectTemplates(false)
  }
  if (tplRes.error) throw tplRes.error
  if (itemsRes.error) throw itemsRes.error

  const templates = (tplRes.data || []).map((tpl) => ({ ...tpl, images: tpl.images || [] }))
  // select('*') trả đủ cột: nếu mẫu đầu tiên không có khóa description thì DB chưa có cột này.
  const descriptionSupported = templates.length > 0 ? 'description' in templates[0] : null
  return { templates, items: itemsRes.data || [], imagesSupported, descriptionSupported }
}

function removeStorageFiles(paths) {
  const clean = (paths || []).filter(Boolean)
  if (clean.length === 0) return Promise.resolve()
  return supabase.storage
    .from(IMAGE_BUCKET)
    .remove(clean)
    .catch(() => {})
}

function storageErrorMessage(error) {
  const text = String(error?.message || '')
  if (/bucket not found/i.test(text)) {
    return `Chưa có bucket "${IMAGE_BUCKET}" trên Supabase: cần chạy supabase/set_templates_v2.sql.`
  }
  if (/row-level security|unauthorized|not allowed/i.test(text)) {
    return 'Không có quyền tải ảnh lên (chỉ admin/quản lý/thủ kho).'
  }
  return text || 'Lỗi tải ảnh lên Supabase Storage.'
}

// Ghi ảnh theo kế hoạch của planImageSave. Thứ tự an toàn để lỗi giữa chừng không làm mất bìa:
// tải ảnh mới -> thêm dòng ảnh phụ -> cập nhật thứ tự -> đổi cờ bìa -> cuối cùng mới xóa dòng/file bị bỏ.
// Trả về { newUrls: [url ảnh mới theo thứ tự plan.adds] }.
async function persistImages(templateId, plan, existingRows) {
  const uploaded = []
  try {
    // 1) Tải ảnh mới lên Storage (ảnh đã có URL ngoài thì dùng luôn, không tải lên)
    for (const add of plan.adds) {
      if (!add.image.blob) {
        if (!add.image.url) throw new Error('Thiếu dữ liệu ảnh để tải lên.')
        uploaded.push({ path: null, url: add.image.url })
        continue
      }
      const blob = add.image.blob
      const path = `${templateId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${mimeToExt(blob.type)}`
      const { error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, blob, { contentType: blob.type || 'image/webp', cacheControl: '31536000', upsert: false })
      if (error) throw new Error(storageErrorMessage(error))
      const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path)
      uploaded.push({ path, url: data.publicUrl })
    }

    // 2) Thêm dòng ảnh phụ mới (chưa là bìa)
    const plainAdds = plan.adds.map((add, i) => ({ add, i })).filter(({ add }) => !add.is_cover)
    if (plainAdds.length > 0) {
      const { error } = await supabase.from('set_template_images').insert(
        plainAdds.map(({ add, i }) => ({
          template_id: templateId,
          url: uploaded[i].url,
          storage_path: uploaded[i].path,
          sort_order: add.sort_order,
          is_cover: false,
        }))
      )
      if (error) throw error
    }
  } catch (err) {
    await removeStorageFiles(uploaded.map((file) => file.path))
    throw err
  }

  // 3) Cập nhật thứ tự ảnh phụ còn lại (chưa đụng cờ bìa)
  const results = await Promise.all(
    plan.updates
      .filter((row) => !row.is_cover)
      .map((row) =>
        supabase
          .from('set_template_images')
          .update({ sort_order: row.sort_order })
          .eq('id', row.id)
          .eq('template_id', templateId)
      )
  )
  const failed = results.find((res) => res.error)
  if (failed) throw failed.error

  // 4) Đổi bìa: chỉ bỏ cờ cũ ngay trước khi ghi bìa mới; ghi bìa mới hỏng thì trả lại cờ cũ
  const coverUpdate = plan.updates.find((row) => row.is_cover)
  const coverAddIndex = plan.adds.findIndex((add) => add.is_cover)
  const previousCover = (existingRows || []).find((row) => row.is_cover)
  const { error: clearErr } = await supabase
    .from('set_template_images')
    .update({ is_cover: false })
    .eq('template_id', templateId)
    .eq('is_cover', true)
  if (clearErr) throw clearErr

  let coverErr = null
  if (coverUpdate) {
    const res = await supabase
      .from('set_template_images')
      .update({ sort_order: coverUpdate.sort_order, is_cover: true })
      .eq('id', coverUpdate.id)
      .eq('template_id', templateId)
    coverErr = res.error
  } else if (coverAddIndex >= 0) {
    const add = plan.adds[coverAddIndex]
    const res = await supabase.from('set_template_images').insert({
      template_id: templateId,
      url: uploaded[coverAddIndex].url,
      storage_path: uploaded[coverAddIndex].path,
      sort_order: add.sort_order,
      is_cover: true,
    })
    coverErr = res.error
    if (coverErr) await removeStorageFiles([uploaded[coverAddIndex].path])
  }
  if (coverErr) {
    if (previousCover) {
      await supabase.from('set_template_images').update({ is_cover: true }).eq('id', previousCover.id)
    }
    throw coverErr
  }

  // 5) Cuối cùng mới xóa các dòng bị bỏ (và file Storage, chỉ khi dòng đã xóa thật)
  if (plan.deleteRows.length > 0) {
    const { data: deleted, error } = await supabase
      .from('set_template_images')
      .delete()
      .eq('template_id', templateId)
      .in('id', plan.deleteRows.map((row) => row.id))
      .select('id, storage_path')
    if (error) throw error
    await removeStorageFiles((deleted || []).map((row) => row.storage_path))
    if ((deleted || []).length < plan.deleteRows.length) {
      throw new Error('Không xóa được một số ảnh (chỉ admin/quản lý/thủ kho được xóa ảnh).')
    }
  }

  return { newUrls: uploaded.map((file) => file.url) }
}

// imageUrl === undefined: không đụng cột image_url (giữ nguyên bìa hiện tại cho tới khi có URL mới).
async function saveHeader({ templateId, name, category, imageUrl, note, description, descriptionSupported }) {
  const run = (payload) =>
    templateId
      ? supabase.from('set_templates').update(payload).eq('id', templateId)
      : supabase.from('set_templates').insert([payload]).select('id').single()

  const base = { name, category, note: note || null }
  if (imageUrl !== undefined) base.image_url = imageUrl || null
  let descriptionUnsupported = descriptionSupported === false
  let res = await run(
    descriptionUnsupported ? base : { ...base, description: description || null }
  )

  if (res.error && !descriptionUnsupported && isMissingDescriptionColumn(res.error)) {
    descriptionUnsupported = true
    res = await run(base)
  }
  if (
    res.error &&
    /category|image_url/i.test(String(res.error.message || ''))
  ) {
    res = await run({ name, note: packTemplateNoteFallback(category, imageUrl || '', note) })
  }
  if (res.error) throw res.error
  return {
    id: templateId || res.data?.id,
    descriptionDropped: descriptionUnsupported && Boolean(description),
    descriptionUnsupported,
  }
}

// Ảnh cũ (image_url, thường là base64) đang là bìa thì giữ nguyên. Nếu người dùng chọn bìa khác,
// chuyển ảnh cũ thành ảnh phụ trong thư viện (tải lên Storage) để image_url được đồng bộ theo bìa mới mà không mất ảnh.
function migrateLegacyImage(list) {
  const legacy = list.find((image) => image.kind === 'legacy')
  if (!legacy || list[0] === legacy) return list
  const migrated = { key: legacy.key, kind: 'new', url: legacy.url }
  if (String(legacy.url).startsWith('data:')) migrated.blob = dataUrlToBlob(legacy.url)
  return list.map((image) => (image === legacy ? migrated : image))
}

/**
 * Lưu mẫu set (đầu mẫu, vật tư, ảnh).
 * params: { editingTemplate, name, category, note, description, lines: [[item_id, qty]],
 *           images: { multi, list }, descriptionSupported }
 * Trả về { warnings: string[], descriptionUnsupported }.
 * Nếu đầu mẫu đã tạo mà bước sau lỗi, lỗi ném ra có `savedTemplateId` để form chuyển sang chế độ sửa (không tạo trùng).
 */
export async function saveTemplate({
  editingTemplate,
  name,
  category,
  note,
  description,
  lines,
  images,
  descriptionSupported,
}) {
  const warnings = []
  const multi = Boolean(images?.multi)
  const originalList = images?.list || []
  const list = multi ? migrateLegacyImage(originalList) : originalList
  const legacyMigrated = multi && list.some((image, i) => image !== originalList[i])
  const first = list[0]
  const legacyCover = first?.kind === 'legacy' ? first : null

  // Chỉ ghi image_url ngay khi đã biết URL cuối cùng (ảnh cũ làm bìa, ảnh đã lưu, hoặc không còn ảnh).
  // Bìa là ảnh mới (chưa có URL) thì để nguyên và đồng bộ sau khi tải lên xong.
  let headerImageUrl
  if (!multi) headerImageUrl = first?.url || null
  else if (list.length === 0) headerImageUrl = null
  else if (legacyCover) headerImageUrl = legacyCover.url
  else if (legacyMigrated) headerImageUrl = undefined // giữ ảnh cũ cho tới khi ảnh cũ được lưu vào thư viện
  else if (first.kind === 'existing') headerImageUrl = first.url
  else headerImageUrl = undefined

  const header = await saveHeader({
    templateId: editingTemplate?.id,
    name,
    category,
    imageUrl: headerImageUrl,
    note,
    description,
    descriptionSupported,
  })
  const templateId = header.id
  const createdNow = !editingTemplate
  if (header.descriptionDropped) {
    warnings.push('Chưa lưu được mô tả vì cơ sở dữ liệu chưa có cột description (cần chạy set_templates_v2.sql).')
  }

  const failAfterCreate = (error, text) => {
    if (!createdNow) return error
    const wrapped = new Error(`${text}${error?.message || ''}. Mẫu đã được tạo, bấm Lưu lại để hoàn tất.`)
    wrapped.savedTemplateId = templateId
    return wrapped
  }

  const itemRows = lines.map(([item_id, qty]) => ({ template_id: templateId, item_id, qty }))
  const { error: itemErr } = await supabase
    .from('set_template_items')
    .upsert(itemRows, { onConflict: 'template_id,item_id' })
  if (itemErr) throw failAfterCreate(itemErr, 'Chưa lưu được vật tư: ')

  const keep = new Set(lines.map(([item_id]) => item_id))
  const removed = (editingTemplate?.items || [])
    .map((ti) => Number(ti.item_id))
    .filter((id) => !keep.has(id))
  if (removed.length > 0) {
    const { data: deleted, error: delErr } = await supabase
      .from('set_template_items')
      .delete()
      .eq('template_id', templateId)
      .in('item_id', removed)
      .select('item_id')
    if (delErr) throw delErr
    if ((deleted || []).length < removed.length) {
      warnings.push(
        `Đã lưu các thay đổi khác, nhưng chưa bỏ được ${removed.length - (deleted || []).length}/${removed.length} vật tư khỏi mẫu: chỉ admin/quản lý được bỏ vật tư khỏi mẫu. Hãy nhờ admin/quản lý xóa, hoặc thêm lại vật tư đó vào mẫu.`
      )
    }
  }

  if (multi) {
    try {
      const existingRows = editingTemplate?.images || []
      const plan = planImageSave(list, existingRows)
      const { newUrls } = await persistImages(templateId, plan, existingRows)
      // Đồng bộ image_url theo bìa mới (chỉ sau khi đã có URL thật) để Báo giá/website cùng thấy bìa mới
      if (first && !legacyCover) {
        const coverUrl = first.kind === 'new' ? newUrls[plan.adds.findIndex((a) => a.image === first)] : first.url
        if (coverUrl && coverUrl !== headerImageUrl) {
          const { error } = await supabase.from('set_templates').update({ image_url: coverUrl }).eq('id', templateId)
          if (error) throw error
        }
      }
    } catch (err) {
      warnings.push(`Đã lưu mẫu nhưng chưa xong phần ảnh: ${err?.message || 'lỗi không rõ'}`)
    }
  }

  return { warnings, descriptionUnsupported: header.descriptionUnsupported }
}

// Lưu riêng phần mô tả (dùng cho "Viết mô tả cho mẫu còn thiếu").
export async function saveTemplateDescription(templateId, description) {
  const { data, error } = await supabase
    .from('set_templates')
    .update({ description: description || null })
    .eq('id', templateId)
    .select('id')
  if (error) {
    const wrapped = new Error(
      isMissingDescriptionColumn(error)
        ? 'Cơ sở dữ liệu chưa có cột description (cần chạy set_templates_v2.sql).'
        : error.message
    )
    wrapped.missingColumn = isMissingDescriptionColumn(error)
    throw wrapped
  }
  if (!data || data.length === 0) {
    throw new Error('Không lưu được mô tả: bạn không có quyền sửa mẫu này.')
  }
}

export async function deleteTemplate(template) {
  const paths = (template.images || []).map((image) => image.storage_path).filter(Boolean)
  const { data, error } = await supabase
    .from('set_templates')
    .delete()
    .eq('id', template.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Không xóa được mẫu set: bạn không có quyền xóa (chỉ admin/quản lý) hoặc mẫu không còn tồn tại.')
  }
  await removeStorageFiles(paths)
}
