// Hàm thuần cho form tạo / sửa dự án (trang Dự án).

import { stripFbMetaFromNote } from './watermarkHelper'
import { stripProjectAttributionFromNote } from './metaAdsClient'

const FB_META_START = '__FBMETA__'
const FB_META_END = '__ENDFBMETA__'

// Lấy nguyên văn khối trạng thái Facebook đang nằm trong note ('' nếu không có).
export function extractFbMetaBlock(note) {
  const str = String(note || '')
  const start = str.indexOf(FB_META_START)
  if (start === -1) return ''
  const end = str.indexOf(FB_META_END, start + FB_META_START.length)
  if (end === -1) return ''
  return str.slice(start, end + FB_META_END.length)
}

// Phần chữ người dùng đọc/sửa được: bỏ mọi khối trạng thái Facebook và thẻ nguồn [DW_ATTR].
export function cleanProjectNote(note) {
  let text = String(note || '')
  for (let prev = null; prev !== text; ) {
    prev = text
    text = stripFbMetaFromNote(text)
  }
  return stripProjectAttributionFromNote(text).trim()
}

// Quyền ghi ô tiền của form sửa, theo dữ liệu project_finance đã tải:
// 'locked' = tải lỗi / chưa tải được: khóa ô, không ghi;
// 'verify' = tải được nhưng dự án chưa có dòng: đọc lại CSDL trước khi ghi;
// 'ready'  = đã có số liệu: ghi bình thường.
export function financeEditAccess(loadOk, hasRow) {
  if (!loadOk) return 'locked'
  return hasRow ? 'ready' : 'verify'
}

// Ghép ghi chú người dùng vừa sửa với khối Facebook của note MỚI NHẤT trong CSDL.
// Khối meta nằm trong editedNote (nếu có) bị bỏ; chỉ CSDL quyết định trạng thái Facebook.
// Trả null khi không còn gì để lưu.
export function mergeNoteKeepingFbMeta(editedNote, latestNote) {
  const text = stripFbMetaFromNote(editedNote || '').trim()
  const block = extractFbMetaBlock(latestNote)
  return [text, block].filter(Boolean).join(' ') || null
}

// So đội thi công lúc mở form với lúc lưu: chỉ ghi phần thay đổi.
export function diffMembers(before = [], after = []) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    toAdd: [...afterSet].filter((id) => !beforeSet.has(id)),
    toRemove: [...beforeSet].filter((id) => !afterSet.has(id)),
  }
}

// Nội dung hộp xác nhận khi đổi trạng thái sang Đã hủy / Hoàn thành; null nếu không cần hỏi.
export function statusChangeWarning(prevStatus, nextStatus, projectName = '') {
  if (prevStatus === nextStatus) return null
  if (nextStatus === 'cancelled') {
    return {
      title: 'Chuyển sang Đã hủy',
      message: `Dự án "${projectName}" sẽ chuyển sang "Đã hủy": không còn tính doanh thu, chi phí đã phát sinh vẫn tính vào lãi/lỗ. Hãy kiểm tra vật tư đã xuất và tiền cọc của khách.`,
      confirmLabel: 'Vẫn lưu',
      cancelLabel: 'Quay lại',
      danger: true,
    }
  }
  if (nextStatus === 'done') {
    return {
      title: 'Chuyển sang Hoàn thành',
      message: `Dự án "${projectName}" sẽ chuyển sang "Hoàn thành". Hãy kiểm tra đã thu hồi đủ vật tư, ghi đủ chi phí và thu đủ tiền khách.`,
      confirmLabel: 'Vẫn lưu',
      cancelLabel: 'Quay lại',
    }
  }
  return null
}
