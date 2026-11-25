import { describe, expect, it } from 'vitest'
import {
  buildEditorImages,
  dataUrlToBlob,
  moveEditorImage,
  normalizeEditorImages,
  planImageSave,
  safeFileBase,
  setEditorCover,
} from './setTemplateImages'

const legacy = { key: 'legacy', kind: 'legacy', url: 'data:image/webp;base64,AAAA' }
const a = { key: 'row-1', kind: 'existing', id: 1, url: 'https://x/a.webp' }
const b = { key: 'row-2', kind: 'existing', id: 2, url: 'https://x/b.webp' }
const c = { key: 'new-1', kind: 'new', url: 'data:image/webp;base64,BBBB' }

describe('setTemplateImages', () => {
  it('xếp ảnh cũ làm bìa mặc định, sau đó đến ảnh phụ theo sort_order', () => {
    const list = buildEditorImages(
      { image_url: legacy.url },
      [
        { id: 2, url: b.url, sort_order: 1, is_cover: false },
        { id: 1, url: a.url, sort_order: 0, is_cover: false },
      ]
    )
    expect(list.map((i) => i.kind)).toEqual(['legacy', 'existing', 'existing'])
    expect(list.map((i) => i.id)).toEqual([undefined, 1, 2])
  })

  it('đổi bìa sang ảnh khác thì ảnh cũ đứng ngay sau bìa', () => {
    const list = setEditorCover([legacy, a, b], 2)
    expect(list.map((i) => i.key)).toEqual(['row-2', 'legacy', 'row-1'])
  })

  it('đưa lại ảnh cũ lên đầu thì nó là bìa', () => {
    expect(moveEditorImage([a, legacy, b], 1, -1).map((i) => i.key)).toEqual(['legacy', 'row-1', 'row-2'])
    expect(normalizeEditorImages([a, b])).toEqual([a, b])
  })

  it('kế hoạch ghi: bìa là phần tử đầu, ảnh cũ không có dòng', () => {
    const plan = planImageSave([a, legacy, c], [
      { id: 1, url: a.url },
      { id: 9, url: 'https://x/old.webp', storage_path: '1/old.webp' },
    ])
    expect(plan.deleteRows.map((r) => r.id)).toEqual([9])
    expect(plan.updates).toEqual([{ id: 1, sort_order: 0, is_cover: true }])
    expect(plan.adds).toEqual([{ image: c, sort_order: 2, is_cover: false }])
    expect(plan.hasLegacy).toBe(true)
    expect(planImageSave([legacy, a], []).updates).toEqual([{ id: 1, sort_order: 1, is_cover: false }])
  })

  it('chuyển ảnh base64 cũ sang Blob', () => {
    const blob = dataUrlToBlob('data:image/webp;base64,AAAA')
    expect(blob.type).toBe('image/webp')
    expect(blob.size).toBe(3)
  })

  it('tên file không dấu', () => {
    expect(safeFileBase('Set Gia Tiên Đỏ')).toBe('set-gia-tien-do')
  })
})
