import { describe, it, expect } from 'vitest'
import {
  extractFbMetaBlock,
  mergeNoteKeepingFbMeta,
  diffMembers,
  statusChangeWarning,
  cleanProjectNote,
  financeEditAccess,
} from './projectForm'
import { attachFbMetaToNote, getProjectFbData, stripFbMetaFromNote } from './watermarkHelper'

const meta = { status: 'posted', fbUrl: 'https://facebook.com/p/1', postedAt: '2026-11-20' }
const saved = attachFbMetaToNote('Bàn giao sảnh 7h', meta)

describe('extractFbMetaBlock', () => {
  it('lấy nguyên văn khối meta', () => {
    const block = extractFbMetaBlock(saved)
    expect(block.startsWith('__FBMETA__')).toBe(true)
    expect(saved.endsWith(block)).toBe(true)
  })

  it('trả rỗng khi không có hoặc khối bị cụt', () => {
    expect(extractFbMetaBlock(null)).toBe('')
    expect(extractFbMetaBlock('ghi chú')).toBe('')
    expect(extractFbMetaBlock('a __FBMETA__{"status":"posted"}')).toBe('')
    expect(extractFbMetaBlock('__ENDFBMETA__ a __FBMETA__')).toBe('')
  })
})

describe('mergeNoteKeepingFbMeta', () => {
  it('giữ trạng thái Facebook khi sửa ghi chú', () => {
    const note = mergeNoteKeepingFbMeta('Bàn giao sảnh 9h', saved)
    expect(stripFbMetaFromNote(note)).toBe('Bàn giao sảnh 9h')
    expect(getProjectFbData({ note })).toMatchObject(meta)
  })

  it('mở form rồi lưu không đổi gì thì note y nguyên', () => {
    expect(mergeNoteKeepingFbMeta(stripFbMetaFromNote(saved), saved)).toBe(saved)
  })

  it('xóa hết ghi chú vẫn còn khối meta', () => {
    expect(mergeNoteKeepingFbMeta('  ', saved)).toBe(extractFbMetaBlock(saved))
  })

  it('lấy meta của note mới nhất, bỏ meta cũ lẫn trong chữ đang sửa', () => {
    const stale = attachFbMetaToNote('Chữ mới', { status: 'draft' })
    const note = mergeNoteKeepingFbMeta(stale, saved)
    expect(note).toBe(`Chữ mới ${extractFbMetaBlock(saved)}`)
    expect(note.match(/__FBMETA__/g)).toHaveLength(1)
  })

  it('không có meta thì chỉ giữ chữ, rỗng thì null', () => {
    expect(mergeNoteKeepingFbMeta(' abc ', 'cũ')).toBe('abc')
    expect(mergeNoteKeepingFbMeta('', null)).toBeNull()
    expect(mergeNoteKeepingFbMeta(null, '')).toBeNull()
  })
})

describe('cleanProjectNote', () => {
  it('bỏ khối Facebook và thẻ nguồn, giữ chữ', () => {
    const note = `${saved}\n[DW_ATTR:{"source":"meta_ads","hub":"xuan_loc"}]`
    expect(cleanProjectNote(note)).toBe('Bàn giao sảnh 7h')
  })

  it('bỏ cả khi có nhiều khối', () => {
    const block = extractFbMetaBlock(saved)
    expect(cleanProjectNote(`a ${block} ${block}`)).toBe('a')
  })

  it('note chỉ có thẻ hoặc trống thì trả rỗng', () => {
    expect(cleanProjectNote(extractFbMetaBlock(saved))).toBe('')
    expect(cleanProjectNote('[DW_ATTR:{"source":"meta_ads"}]')).toBe('')
    expect(cleanProjectNote(null)).toBe('')
  })
})

describe('financeEditAccess', () => {
  it('tải lỗi thì khóa, kể cả khi còn số cũ', () => {
    expect(financeEditAccess(false, false)).toBe('locked')
    expect(financeEditAccess(false, true)).toBe('locked')
  })

  it('thiếu dòng thì phải đọc lại trước khi ghi', () => {
    expect(financeEditAccess(true, false)).toBe('verify')
    expect(financeEditAccess(true, true)).toBe('ready')
  })
})

describe('diffMembers', () => {
  it('không đổi (kể cả khác thứ tự) thì không ghi gì', () => {
    expect(diffMembers(['a', 'b'], ['b', 'a'])).toEqual({ toAdd: [], toRemove: [] })
  })

  it('tách phần thêm và phần bỏ, không trùng lặp', () => {
    expect(diffMembers(['a', 'b'], ['b', 'c', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] })
  })
})

describe('statusChangeWarning', () => {
  it('hỏi khi đổi sang Đã hủy hoặc Hoàn thành', () => {
    expect(statusChangeWarning('preparing', 'cancelled', 'A')?.title).toBe('Chuyển sang Đã hủy')
    expect(statusChangeWarning('in_progress', 'done', 'A')?.title).toBe('Chuyển sang Hoàn thành')
    expect(statusChangeWarning('done', 'cancelled', 'A')).not.toBeNull()
  })

  it('không hỏi khi trạng thái không đổi hoặc đổi sang trạng thái khác', () => {
    expect(statusChangeWarning('done', 'done')).toBeNull()
    expect(statusChangeWarning('cancelled', 'cancelled')).toBeNull()
    expect(statusChangeWarning('quote', 'preparing')).toBeNull()
  })
})

describe('cleanProjectNote với thẻ đóng lẻ', () => {
  it('thẻ đóng đứng trước thẻ mở không làm lặp vô hạn', () => {
    expect(() => cleanProjectNote('A__ENDFBMETA__B__FBMETA__C')).not.toThrow()
    expect(cleanProjectNote('A__ENDFBMETA__B__FBMETA__C').length).toBeLessThanOrEqual(30)
  })
})
