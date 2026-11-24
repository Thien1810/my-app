-- =====================================================================
-- ĐẶNG WEDDING — MÃ PHIẾU KHO (PN / KK / DH / CK) + BỘ ĐẾM TỰ TĂNG
-- Mục đích: thêm cột receipt_code cho phiếu sổ kho (stock_movements) và phiếu chuyển kho
--           (stock_transfers); tạo bộ đếm theo (tiền tố, tháng) và hàm next_receipt_code()
--           để giao diện xin mã phiếu dạng PN-2611-001 (PN = phiếu nhập mua, KK = kiểm kho
--           (điều chỉnh), DH = đồ hỏng (sửa xong / thanh lý), CK = chuyển kho).
--           Mã lấy theo THÁNG HIỆN TẠI giờ Việt Nam, không theo ngày ghi trên phiếu.
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent).
-- Yêu cầu: đã chạy schema.sql (stock_movements, has_role) và finance_schema.sql (stock_transfers).
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File CHƯA được test trên DB thật.
-- LƯU Ý: không nên chạy lại schema.sql (có dòng đặt tài khoản thành admin) — đừng chạy lại.
-- Ghi chú: mã tăng nguyên tử (insert ... on conflict do update) nên 2 người bấm cùng lúc
--          vẫn không trùng mã. Mã đã cấp mà phiếu không lưu được sẽ bị bỏ trống số (chấp nhận).
-- =====================================================================

-- ---------- 1. CỘT MÃ PHIẾU (cho phép trống để dữ liệu cũ không bị ảnh hưởng) ----------
alter table public.stock_movements add column if not exists receipt_code text;
alter table public.stock_transfers add column if not exists receipt_code text;

create index if not exists idx_stock_movements_receipt_code on public.stock_movements (receipt_code);
create index if not exists idx_stock_transfers_receipt_code on public.stock_transfers (receipt_code);

-- ---------- 2. BẢNG ĐẾM ----------
-- Chỉ hàm security definer bên dưới được ghi: bật RLS và KHÔNG tạo policy nào cho người dùng.
create table if not exists public.receipt_counters (
  prefix  text not null,           -- PN | KK | DH | CK
  ym      text not null,           -- YYMM theo giờ Việt Nam, ví dụ '2611'
  last_no int  not null default 0, -- số thứ tự đã cấp gần nhất trong tháng
  primary key (prefix, ym)
);
alter table public.receipt_counters enable row level security;
revoke all on public.receipt_counters from anon, authenticated;

-- ---------- 3. HÀM XIN MÃ PHIẾU ----------
create or replace function public.next_receipt_code(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ym text;
  v_no int;
begin
  -- Chỉ người đã đăng nhập và có vai trò kho/quản lý
  if auth.uid() is null or not public.has_role(array['admin','manager','storekeeper']) then
    raise exception 'Bạn không có quyền tạo mã phiếu.';
  end if;

  if p_prefix is null or p_prefix not in ('PN','KK','DH','CK') then
    raise exception 'Tiền tố mã phiếu không hợp lệ (chỉ nhận PN, KK, DH, CK).';
  end if;

  -- Tháng theo GIỜ VIỆT NAM (DB mặc định UTC)
  v_ym := to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYMM');

  -- Tăng bộ đếm nguyên tử, tránh trùng khi nhiều người cùng bấm
  insert into public.receipt_counters as rc (prefix, ym, last_no)
  values (p_prefix, v_ym, 1)
  on conflict (prefix, ym) do update set last_no = rc.last_no + 1
  returning rc.last_no into v_no;

  -- lpad cắt chuỗi khi số > 999 nên chỉ đệm số 0 khi < 1000
  return p_prefix || '-' || v_ym || '-' ||
    case when v_no < 1000 then lpad(v_no::text, 3, '0') else v_no::text end;
end $$;

revoke execute on function public.next_receipt_code(text) from public, anon;
grant execute on function public.next_receipt_code(text) to authenticated;

-- ---------- 4. CÂU KIỂM TRA (bỏ comment từng câu để chạy) ----------
-- (a) 2 cột tồn tại (phải ra 2 dòng):
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and column_name = 'receipt_code'
--    and table_name in ('stock_movements', 'stock_transfers');
-- (b) bảng đếm có bật RLS (relrowsecurity = true) và không có policy (phải ra 0 dòng ở câu thứ hai):
-- select relname, relrowsecurity from pg_class where oid = 'public.receipt_counters'::regclass;
-- select * from pg_policies where schemaname = 'public' and tablename = 'receipt_counters';
-- (c) thử xin mã (chạy trong SQL Editor sẽ báo "không có quyền" vì không có auth.uid(); thử từ app
--     bằng tài khoản thủ kho/quản lý: supabase.rpc('next_receipt_code', { p_prefix: 'PN' })):
-- select public.next_receipt_code('PN');
-- (d) xem bộ đếm hiện tại:
-- select * from public.receipt_counters order by ym desc, prefix;
