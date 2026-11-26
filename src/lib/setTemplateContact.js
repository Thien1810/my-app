import { supabase } from './supabase'

export const DEFAULT_CONTACT = Object.freeze({ phone: '0918.80.90.96', address: '', website: 'dangwed.com' })

// SĐT và địa chỉ lấy từ Quản trị Website (bảng site_settings), sửa ở đó là ảnh gửi khách đổi theo.
// Lỗi mạng hoặc chưa có bảng thì dùng số mặc định để vẫn gửi được.
export async function loadShareContact() {
  try {
    const { data, error } = await supabase.from('site_settings').select('phone, address').eq('id', 1).maybeSingle()
    if (error || !data) return DEFAULT_CONTACT
    return {
      ...DEFAULT_CONTACT,
      phone: data.phone?.trim() || DEFAULT_CONTACT.phone,
      address: data.address?.trim() || '',
    }
  } catch {
    return DEFAULT_CONTACT
  }
}
