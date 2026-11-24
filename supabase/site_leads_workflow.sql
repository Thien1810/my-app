-- =====================================================================
-- ĐẶNG WEDDING — QUY TRÌNH TRẠNG THÁI LEAD (site_leads): trạng thái mới, lý do mất,
-- thời điểm đổi trạng thái, nguồn nhập tay.
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent).
-- Yêu cầu: đã chạy website_schema.sql (bảng public.site_leads) và site_leads_attribution.sql.
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File chưa được test trên DB thật.
-- Ràng buộc để website dangwed.com không hỏng (APP_HANDOFF_LEADS.md, mục A4):
--   * status = 'new' luôn hợp lệ và vẫn là giá trị mặc định (web luôn gửi 'new').
--   * Mọi cột mới đều nullable hoặc có default (web không biết các cột này).
--   * KHÔNG đổi RLS/policy/grant: anon vẫn chỉ được INSERT. Bảng đã grant theo bảng nên cột
--     mới không cần grant thêm.
--   * Trigger không phải security definer, không đụng bảng khác, nên lệnh INSERT của khách
--     ẩn danh (anon) chạy bình thường.
-- Thứ tự khuyến nghị: chạy file này TRƯỚC hoặc SAU khi đưa app mới lên đều an toàn, vì check
-- vẫn cho phép cả bộ trạng thái cũ (xem mục 2).
-- =====================================================================

-- ---------- 1. CỘT MỚI (đều nullable hoặc có default) ----------
alter table public.site_leads add column if not exists lost_reason text;                  -- lý do mất (chỉ khi status = lost)
alter table public.site_leads add column if not exists status_changed_at timestamptz;     -- lần đổi trạng thái gần nhất
alter table public.site_leads add column if not exists entry_source text;                 -- nguồn khi nhập tay (Messenger, Zalo...)
alter table public.site_leads add column if not exists created_via text default 'web_form'; -- 'web_form' hoặc 'manual'

-- Ràng buộc giá trị. Kiểm tra tồn tại theo tên để chạy lại không lỗi.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.site_leads'::regclass and conname = 'site_leads_lost_reason_check'
  ) then
    alter table public.site_leads add constraint site_leads_lost_reason_check
      check (lost_reason is null or lost_reason in
        ('gia_cao','chon_don_vi_khac','doi_huy_ngay_cuoi','khong_lien_lac_duoc','ngoai_vung','khac'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.site_leads'::regclass and conname = 'site_leads_created_via_check'
  ) then
    alter table public.site_leads add constraint site_leads_created_via_check
      check (created_via is null or created_via in ('web_form','manual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.site_leads'::regclass and conname = 'site_leads_entry_source_check'
  ) then
    alter table public.site_leads add constraint site_leads_entry_source_check
      check (entry_source is null or entry_source in
        ('Messenger từ quảng cáo','Messenger tự nhiên','Zalo','Gọi điện','Giới thiệu','Khác'));
  end if;
end $$;

-- ---------- 2. CHECK CỦA status: BỘ MỚI + BỘ CŨ (giai đoạn chuyển tiếp) ----------
-- Bộ mới: new, consulting, quoted, deposited, completed, lost.
-- Bộ cũ (contacted, converted, closed) VẪN được phép để bản app đang chạy trên app.dangwed.com
-- (chưa cập nhật) không bị lỗi khi anh chạy SQL này trước. Sau khi app mới lên và đã chuyển dữ
-- liệu cũ (mục 5), có thể siết lại check, bỏ 3 giá trị cũ.
-- 'new' luôn hợp lệ, default vẫn là 'new'.
do $$
declare
  r record;
begin
  -- Tìm mọi check constraint trên site_leads có nhắc tới cột status (tên tự sinh, thường site_leads_status_check)
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.site_leads'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.site_leads drop constraint %I', r.conname);
  end loop;

  alter table public.site_leads add constraint site_leads_status_check
    check (status in ('new','consulting','quoted','deposited','completed','lost',
                      'contacted','converted','closed'));
end $$;

alter table public.site_leads alter column status set default 'new';

-- ---------- 3. TRIGGER GHI THỜI ĐIỂM ĐỔI TRẠNG THÁI + DỌN LÝ DO MẤT ----------
-- Không security definer, không đụng bảng khác, không cần quyền đặc biệt -> an toàn cho INSERT của anon.
create or replace function public.set_lead_status_changed() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status_changed_at := coalesce(new.status_changed_at, now());
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  -- Chỉ trạng thái mất (lost, hoặc closed của bộ cũ) mới có lý do mất
  if new.status is null or new.status not in ('lost','closed') then
    new.lost_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_lead_status_changed on public.site_leads;
create trigger trg_set_lead_status_changed
  before insert or update of status on public.site_leads
  for each row execute function public.set_lead_status_changed();

-- ---------- 4. RLS / POLICY / GRANT: KHÔNG ĐỔI ----------
-- (cố ý không có lệnh nào ở đây)

-- ---------- 5. DỮ LIỆU CŨ — CHỈ CHẠY SAU KHI APP MỚI ĐÃ ĐƯA LÊN app.dangwed.com ----------
-- (App mới đã tự hiểu trạng thái cũ khi hiển thị/đếm, nên bước này không gấp.)
-- Bỏ comment 3 lệnh dưới khi sẵn sàng:
-- update public.site_leads set status = 'consulting' where status = 'contacted';
-- update public.site_leads set status = 'quoted'     where status = 'converted';
-- update public.site_leads set status = 'lost', lost_reason = 'khac' where status = 'closed';
-- Lưu ý: lệnh 3 đặt lost_reason cùng lúc đổi status nên trigger giữ nguyên lý do (status = 'lost').
-- Sau đó có thể siết lại check, bỏ 3 giá trị cũ:
-- alter table public.site_leads drop constraint site_leads_status_check;
-- alter table public.site_leads add constraint site_leads_status_check
--   check (status in ('new','consulting','quoted','deposited','completed','lost'));

-- ---------- 6. CÂU KIỂM TRA (bỏ comment từng câu để chạy) ----------
-- 6.1. Bốn cột mới đã có (phải ra 4 dòng):
-- select column_name, data_type, column_default from information_schema.columns
--  where table_schema = 'public' and table_name = 'site_leads'
--    and column_name in ('lost_reason','status_changed_at','entry_source','created_via');
-- 6.2. Các constraint (phải thấy site_leads_status_check, _lost_reason_check, _created_via_check, _entry_source_check):
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.site_leads'::regclass and contype = 'c';
-- 6.3. Trigger (phải ra 1 dòng):
-- select tgname from pg_trigger
--  where tgrelid = 'public.site_leads'::regclass and tgname = 'trg_set_lead_status_changed';
-- 6.4. Mô phỏng khách ẩn danh insert (chạy trong SQL Editor; rollback để không lưu lead thử):
-- begin;
--   set local role anon;
--   insert into public.site_leads (customer_name, phone, status) values ('TEST xoa', '0900000000', 'new');
-- rollback;
-- Nếu không báo lỗi thì web vẫn gửi form được.
-- QUAN TRỌNG (A4.5): sau khi chạy file, PHẢI gửi 1 lead thử từ form thật trên dangwed.com
-- (tên "TEST xoa"), kiểm tra trong app có status = new và status_changed_at đã có giá trị,
-- rồi XÓA lead thử.
