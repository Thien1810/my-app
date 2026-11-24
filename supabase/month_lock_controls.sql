-- =====================================================================
-- ĐẶNG WEDDING — KIỂM SOÁT KHÓA SỔ THÁNG (lịch sử khóa/mở, chỉ khóa tháng đã qua,
-- chỉ admin được mở khóa kèm lý do, chặn ghi "Mất cọc" vào tháng đã khóa)
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent).
-- Yêu cầu: đã chạy schema.sql (có public.has_role, public.profiles) và
--          finance_schema.sql (có month_locks, is_month_locked, project_advances).
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File chưa được test trên DB thật.
-- Quyết định anh Thiện (2026-11-24): khóa tháng = admin hoặc manager; MỞ KHÓA = chỉ admin,
-- bắt buộc có lý do và được ghi lịch sử; chỉ khóa được tháng đã qua (theo giờ Việt Nam);
-- KHÔNG chụp số P&L khi khóa (chỉ giữ share_snapshot như cũ).
--
-- LƯU Ý QUAN TRỌNG:
--  * Sau khi chạy, nút Mở khóa của app (admin) phải gọi rpc('unlock_month', { p_month, p_reason }).
--    Xóa thẳng dòng month_locks từ app sẽ KHÔNG còn được nữa (không ai có quyền DELETE trực tiếp).
--  * Không đụng dữ liệu month_locks hiện có (các tháng đang khóa vẫn giữ nguyên).
--    Các lần khóa cũ (trước file này) không có dòng trong month_lock_log; xem mục backfill tùy chọn ở mục 1.
--  * Chạy lại file không lỗi.
-- =====================================================================

-- ---------- 1. BẢNG LỊCH SỬ KHÓA / MỞ KHÓA ----------
create table if not exists public.month_lock_log (
  id bigint generated always as identity primary key,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- 'YYYY-MM'
  action text not null check (action in ('lock','unlock')),
  acted_at timestamptz not null default now(),
  acted_by uuid default auth.uid() references public.profiles(id),
  note text   -- khóa: ghi chú lúc khóa | mở khóa: lý do bắt buộc
);
create index if not exists idx_month_lock_log_month on public.month_lock_log (month, acted_at);

alter table public.month_lock_log enable row level security;

-- Chỉ admin/manager được xem. KHÔNG có policy insert/update/delete cho người dùng:
-- chỉ trigger/hàm security definer bên dưới được ghi (chủ bảng không bị RLS chặn).
drop policy if exists "month_lock_log_select" on public.month_lock_log;
create policy "month_lock_log_select" on public.month_lock_log for select
  using (public.has_role(array['admin','manager']));

-- Gỡ mọi quyền mặc định rồi chỉ cấp SELECT (phòng Supabase tự cấp rộng cho bảng mới).
revoke all on public.month_lock_log from anon, authenticated;
grant select on public.month_lock_log to authenticated;

-- (Tùy chọn) Bổ sung lịch sử cho các tháng ĐÃ khóa từ trước. Bỏ comment nếu muốn; chỉ chèn tháng chưa có dòng 'lock':
-- insert into public.month_lock_log (month, action, acted_at, acted_by, note)
-- select l.month, 'lock', l.locked_at, l.locked_by, l.note
-- from public.month_locks l
-- where not exists (select 1 from public.month_lock_log g where g.month = l.month and g.action = 'lock');

-- ---------- 2. KHÓA THÁNG -> TỰ GHI LỊCH SỬ ----------
create or replace function public.log_month_lock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.month_lock_log (month, action, acted_by, note)
  -- acted_by lấy từ auth.uid(); chỉ khi không có phiên người dùng (chạy bằng quyền chủ bảng) mới dùng locked_by.
  values (new.month, 'lock', coalesce(auth.uid(), new.locked_by), new.note);
  return new;
end $$;

drop trigger if exists trg_month_locks_log on public.month_locks;
create trigger trg_month_locks_log after insert on public.month_locks
  for each row execute function public.log_month_lock();

-- ---------- 3. CHỈ KHÓA ĐƯỢC THÁNG ĐÃ QUA (GIỜ VIỆT NAM) ----------
-- 'YYYY-MM' so sánh chuỗi đúng thứ tự thời gian. Tháng hiện tại và tương lai bị chặn.
create or replace function public.guard_lock_past_month_only() returns trigger
language plpgsql
as $$
begin
  if new.month >= to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM') then
    raise exception 'Chỉ khóa được tháng đã qua (tháng % chưa kết thúc).', new.month;
  end if;
  -- Không tin locked_by do người dùng gửi: có phiên đăng nhập thì ép bằng người thực sự khóa (trigger BEFORE nên gán new được).
  if auth.uid() is not null then
    new.locked_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_month_locks_past_only on public.month_locks;
create trigger trg_month_locks_past_only before insert on public.month_locks
  for each row execute function public.guard_lock_past_month_only();

-- ---------- 4. MỞ KHÓA: CHỈ ADMIN, BẮT BUỘC LÝ DO, GHI LỊCH SỬ ----------
create or replace function public.unlock_month(p_month text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_n int;
begin
  if not public.has_role(array['admin']) then
    raise exception 'Chỉ admin mới được mở khóa sổ.';
  end if;
  if v_reason is null then
    raise exception 'Phải ghi lý do mở khóa.';
  end if;
  -- Xóa trước rồi mới ghi log theo số dòng xóa thật: hai admin mở cùng lúc thì chỉ một người xóa được (v_n = 1) và ghi log,
  -- người còn lại v_n = 0 -> báo lỗi, không ghi log trùng.
  delete from public.month_locks where month = p_month;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Tháng % chưa khóa.', p_month;
  end if;

  insert into public.month_lock_log (month, action, acted_by, note)
  values (p_month, 'unlock', auth.uid(), v_reason);
end $$;

revoke execute on function public.unlock_month(text, text) from public, anon;
grant execute on function public.unlock_month(text, text) to authenticated;

-- ---------- 5. RLS month_locks ----------
-- Hiện trạng (finance_schema.sql mục 9): vòng lặp tạo policy "month_locks_all" (for all) cho
-- admin + manager, nên chỉ admin/manager đọc được danh sách khóa -> GIỮ NGUYÊN quyền SELECT này.
-- Thay policy "month_locks_all" (CHỈ trên month_locks, các bảng khác trong vòng lặp không đụng) bằng:
--   SELECT: admin/manager (như cũ) | INSERT: admin/manager | UPDATE: không ai | DELETE: không ai trực tiếp
--   (xóa chỉ qua unlock_month, hàm security definer của chủ bảng nên không bị RLS chặn).
-- Lưu ý: nếu chạy lại finance_schema.sql, vòng lặp sẽ tạo lại "month_locks_all"; khi đó chạy lại file này.
drop policy if exists "month_locks_all" on public.month_locks;
drop policy if exists "month_locks_select" on public.month_locks;
drop policy if exists "month_locks_insert" on public.month_locks;
create policy "month_locks_select" on public.month_locks for select
  using (public.has_role(array['admin','manager']));
create policy "month_locks_insert" on public.month_locks for insert
  with check (public.has_role(array['admin','manager']));

-- Thu hồi thêm quyền ở mức GRANT (chặn hai lớp): không ai sửa/xóa trực tiếp.
revoke update, delete, truncate on public.month_locks from authenticated, anon;

-- ---------- 6. CHẶN GHI / SỬA / XÓA "MẤT CỌC" TRONG THÁNG ĐÃ KHÓA ----------
-- Chỉ kind = 'forfeit' (thu nhập khác, vào P&L). Tạm ứng/hoàn cọc thường (advance/refund) KHÔNG bị chặn.
-- UPDATE xét cả dòng cũ (không cho sửa/đổi ngày mất cọc đang nằm trong tháng khóa) và dòng mới (không cho dời vào tháng khóa).
create or replace function public.guard_locked_forfeit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare m text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.kind = 'forfeit' then
    m := to_char(old.received_date, 'YYYY-MM');
    if public.is_month_locked(m) then
      raise exception 'Tháng % đã khóa sổ, không ghi/sửa/xóa Mất cọc được.', m;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.kind = 'forfeit' then
    m := to_char(new.received_date, 'YYYY-MM');
    if public.is_month_locked(m) then
      raise exception 'Tháng % đã khóa sổ, không ghi/sửa/xóa Mất cọc được.', m;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_project_advances_forfeit_lock on public.project_advances;
create trigger trg_project_advances_forfeit_lock before insert or update or delete on public.project_advances
  for each row execute function public.guard_locked_forfeit();

-- ---------- 7. CÂU KIỂM TRA (bỏ comment từng câu để chạy) ----------
-- (a) bảng lịch sử tồn tại và bật RLS (phải ra 1 dòng, relrowsecurity = true):
-- select relname, relrowsecurity from pg_class where oid = 'public.month_lock_log'::regclass;
-- (b) 3 trigger trên month_locks/project_advances (phải ra 3 dòng):
-- select tgname from pg_trigger
--  where not tgisinternal
--    and tgname in ('trg_month_locks_log', 'trg_month_locks_past_only', 'trg_project_advances_forfeit_lock');
-- (c) policy month_locks (phải ra month_locks_select và month_locks_insert, KHÔNG còn month_locks_all):
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'month_locks';
-- (d) hàm unlock_month chỉ authenticated gọi được (không có anon/PUBLIC trong danh sách):
-- select grantee, privilege_type from information_schema.routine_privileges
--  where routine_schema = 'public' and routine_name = 'unlock_month';
-- (e) thử khóa tháng hiện tại phải báo lỗi 'Chỉ khóa được tháng đã qua'.
--     CẢNH BÁO: nếu trigger trg_month_locks_past_only CHƯA được tạo thì câu insert này sẽ khóa THẬT tháng hiện tại,
--     nên luôn bọc trong begin ... rollback (bỏ comment cả 3 dòng, chạy cùng một lần; rollback hủy mọi thay đổi):
-- begin;
-- insert into public.month_locks (month) values (to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM'));
-- rollback;
-- (f) xem lịch sử khóa/mở gần nhất:
-- select month, action, acted_at, acted_by, note from public.month_lock_log order by id desc limit 20;
