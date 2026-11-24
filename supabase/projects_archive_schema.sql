-- =====================================================================
-- ĐẶNG WEDDING — HỦY / LƯU TRỮ DỰ ÁN (ngày hủy, cờ lưu trữ, chặn xóa dự án có dữ liệu)
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent).
-- Yêu cầu: đã chạy schema.sql và finance_schema.sql (cần projects, stock_movements,
--          project_costs, project_advances).
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File chưa được test trên DB thật.
-- Quyết định anh Thiện (2026-11-24): dự án hủy vẫn tính chi phí đã phát sinh vào P&L
-- theo THÁNG HỦY (cancelled_at); dự án đã có phiếu kho/chi phí/tạm ứng không được xóa;
-- lưu trữ = cờ ẩn (archived_at), không xóa dữ liệu, mọi báo cáo vẫn tính.
-- Không đổi policy/RLS: projects_update (admin/manager) đủ để ghi archived_at,
-- projects_delete (chỉ admin) giữ nguyên. Không cần grant mới.
-- =====================================================================

-- ---------- 1. HAI CỘT MỚI ----------
alter table public.projects add column if not exists cancelled_at date;        -- ngày hủy (tháng hủy dùng cho P&L)
alter table public.projects add column if not exists archived_at timestamptz;  -- có giá trị = đã lưu trữ (chỉ ẩn khỏi danh sách)

-- ---------- 2. TỰ ĐẶT / XÓA cancelled_at THEO status ----------
-- Lưu ý: UPDATE chỉ đổi cancelled_at (không đổi status) không kích hoạt trigger này,
-- nên anh vẫn sửa tay được ngày hủy.
create or replace function public.set_cancelled_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' then
    if tg_op = 'INSERT' or old.status is distinct from 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, current_date);
    end if;
  else
    new.cancelled_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_cancelled_at on public.projects;
create trigger trg_set_cancelled_at before insert or update of status on public.projects
  for each row execute function public.set_cancelled_at();

-- ---------- 3. BỔ SUNG NGÀY HỦY CHO DỰ ÁN HỦY CŨ ----------
-- Xem trước các dự án sẽ được điền:
select id, code, status, start_date, created_at
from public.projects
where status = 'cancelled' and cancelled_at is null
order by id;

-- Chỉ điền chỗ trống (không ghi đè ngày đã có). Ngày hủy cũ chỉ là ƯỚC TÍNH
-- (lấy ngày thi công, không có thì ngày tạo); anh có thể sửa tay sau.
update public.projects
set cancelled_at = coalesce(start_date, created_at::date)
where status = 'cancelled' and cancelled_at is null;

-- ---------- 4. CHẶN XÓA DỰ ÁN ĐÃ CÓ DỮ LIỆU ----------
-- BEFORE DELETE chạy trước các xóa dây chuyền (on delete cascade) nên chặn đúng thứ tự.
create or replace function public.prevent_delete_nonempty_project() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.stock_movements where project_id = old.id)
     or exists (select 1 from public.project_costs where project_id = old.id)
     or exists (select 1 from public.project_advances where project_id = old.id) then
    raise exception 'Dự án đã có phiếu kho, chi phí hoặc tạm ứng nên không xóa được. Hãy chuyển sang trạng thái Đã hủy rồi lưu trữ.';
  end if;
  return old;
end $$;

drop trigger if exists trg_prevent_delete_nonempty_project on public.projects;
create trigger trg_prevent_delete_nonempty_project before delete on public.projects
  for each row execute function public.prevent_delete_nonempty_project();

-- ---------- 5. CÂU KIỂM TRA (bỏ comment từng câu để chạy) ----------
-- (a) 2 cột tồn tại (phải ra 2 dòng):
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'projects'
--    and column_name in ('cancelled_at', 'archived_at');
-- (b) 2 trigger tồn tại (phải ra 2 dòng):
-- select tgname from pg_trigger
--  where tgrelid = 'public.projects'::regclass and not tgisinternal
--    and tgname in ('trg_set_cancelled_at', 'trg_prevent_delete_nonempty_project');
-- (c) dự án hủy chưa có ngày hủy (phải = 0):
-- select count(*) from public.projects where status = 'cancelled' and cancelled_at is null;
