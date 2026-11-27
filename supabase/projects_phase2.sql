-- =====================================================================
-- ĐẶNG WEDDING — DỰ ÁN ĐỢT 2: KHÓA NGHIỆP VỤ DỰ ÁN Ở DB
--   1) Chặn chuyển dự án sang 'done' / 'cancelled' khi còn đồ TÁI SỬ DỤNG đã xuất chưa
--      thu hồi / ghi hỏng / ghi mất. Chặn rời 'cancelled' khi đã có Mất cọc hoặc tháng hủy
--      đã khóa sổ.
--   2) Chỉ cho XUẤT kho (type 'issue') khi dự án ở 'preparing' (Đang chuẩn bị) hoặc
--      'in_progress' (Đang thi công) và chưa lưu trữ. Thu hồi KHÔNG bị chặn theo trạng thái.
--   3) RPC apply_templates_to_plan: nạp mẫu set vào kế hoạch, chế độ 'add' (cộng thêm) hoặc
--      'replace' (chỉ thay số lượng các vật tư có trong mẫu, KHÔNG xóa vật tư khác), nguyên tử.
--   4) Tạm ứng / cọc (project_advances): dấu số tiền theo loại, Mất cọc chỉ khi dự án đã hủy,
--      tiền đang giữ không âm, khóa dòng dự án chống hai người cùng hoàn.
--   5) RPC issue_project_by_plan: "Xuất theo kế hoạch" tính phần còn thiếu và ghi trong MỘT
--      giao dịch có khóa (chống xuất đôi khi bấm 2 lần / 2 máy).
--   6) Bảng project_quotes: lưu báo giá lên Supabase (thay localStorage).
--
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent):
--   create table if not exists, create or replace function, drop ... if exists + create.
--   KHÔNG sửa / xóa dữ liệu cũ nào. File bọc trong begin ... commit: lỗi giữa chừng thì
--   không có gì được ghi.
--
-- PHỤ THUỘC (BẮT BUỘC, anh đã chạy): schema.sql (projects, items, stock_movements,
--   project_plan, set_template_items, profiles, has_role, can_see_project),
--   finance_schema.sql (project_advances, month_locks, is_month_locked),
--   audit_fixes_2026-11-25.sql.
-- KHÔNG PHỤ THUỘC (chạy được dù CHƯA chạy):
--   * projects_archive_schema.sql: file này đọc cột archived_at / cancelled_at qua to_jsonb(dòng)
--     nên không lỗi khi cột chưa có (coi như chưa lưu trữ; tháng hủy rơi về start_date).
--     Khi chạy file đó sau, các trigger ở đây tự dùng cột mới, KHÔNG cần chạy lại file này.
--   * month_lock_controls.sql: chỉ dùng is_month_locked (có từ finance_schema.sql). Trigger chặn
--     Mất cọc trong tháng khóa của file đó (nếu chạy) chạy song song, không xung đột.
--   * stock_guards.sql, stock_receipts.sql: không dùng tới. Mục 2b có hàm/trigger
--     block_stock_movement_core_update GIỐNG HỆT stock_guards.sql (cùng tên), chạy trước hay sau đều được.
-- Thứ tự khuyến nghị nếu chạy cùng lúc: projects_archive_schema.sql -> month_lock_controls.sql
--   -> FILE NÀY. Chạy file này trước cũng được.
--
-- KHUYẾN NGHỊ: backup / Branch trước khi chạy. File CHƯA được test trên DB thật.
-- TRƯỚC KHI CÀI: chạy các câu kiểm tra "TRƯỚC KHI CÀI" ở mục 8 (chỉ đọc). Có dòng nào thì đọc
--   ghi chú của câu đó; KHÔNG tự sửa dữ liệu, gửi kết quả cho em xem.
-- =====================================================================

begin;

-- =====================================================================
-- 0. HÀM PHỤ
-- =====================================================================
-- Nhãn trạng thái dự án, khớp PROJECT_STATUS_LABELS (src/lib/formatters.js).
create or replace function public.project_status_label(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'quote' then 'Báo giá'
    when 'preparing' then 'Đang chuẩn bị'
    when 'in_progress' then 'Đang thi công'
    when 'awaiting_return' then 'Chờ thu hồi'
    when 'done' then 'Hoàn thành'
    when 'cancelled' then 'Đã hủy'
    else coalesce(p_status, '?')
  end
$$;

-- Tiền dạng 1.000.000 (dấu chấm ngăn nghìn) cho câu báo lỗi.
create or replace function public.format_vnd(p_amount numeric)
returns text
language sql
stable
set search_path = public
as $$
  select replace(to_char(round(coalesce(p_amount, 0)), 'FM999,999,999,999,990'), ',', '.')
$$;

-- Ảnh hưởng của 1 khoản tạm ứng tới "tiền đang giữ của khách", ĐÚNG quy ước advances.js:
-- held = Σ|advance| − Σ|refund| − Σ|forfeit| (dùng abs để chịu cả dữ liệu cũ sai dấu).
create or replace function public.advance_held_delta(p_kind text, p_amount numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'advance' then abs(coalesce(p_amount, 0))
    when p_kind in ('refund', 'forfeit') then -abs(coalesce(p_amount, 0))
    else 0
  end
$$;

revoke all on function public.project_status_label(text) from public, anon;
revoke all on function public.format_vnd(numeric) from public, anon;
revoke all on function public.advance_held_delta(text, numeric) from public, anon;
grant execute on function public.project_status_label(text) to authenticated;
grant execute on function public.format_vnd(numeric) to authenticated;
grant execute on function public.advance_held_delta(text, numeric) to authenticated;


-- =====================================================================
-- 1. CHẶN ĐỔI TRẠNG THÁI DỰ ÁN
-- =====================================================================
-- (a) Sang 'done' hoặc 'cancelled': không còn đồ tái sử dụng ở dự án
--     (Σ xuất − Σ thu tốt/hỏng/mất > 0, CÙNG công thức calcProjectItemStats.outstanding).
-- (b) Rời 'cancelled' sang trạng thái khác: chặn khi dự án đã có khoản Mất cọc (forfeit), hoặc
--     tháng hủy (cancelled_at, trống thì start_date — cùng quy tắc P&L) đã khóa sổ.
-- Chỉ chạy khi status THỰC SỰ đổi. Người không có quyền sửa dự án bị RLS (projects_update)
-- lọc trước nên trigger không chạy cho họ.
-- security definer: đọc đủ sổ kho / tạm ứng bất kể RLS.
create or replace function public.guard_project_status_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_list text;
  v_old jsonb;
  v_cancel_day date;
  v_month text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- (a) Đóng dự án khi còn đồ tái sử dụng
  if new.status in ('done', 'cancelled') then
    with o as (
      select i.name, i.unit,
             sum(case when m.type = 'issue' then m.qty else -m.qty end) as out_qty
        from public.stock_movements m
        join public.items i on i.id = m.item_id
       where m.project_id = old.id
         and i.kind = 'reusable'
         and m.type in ('issue', 'return_good', 'return_damaged', 'return_lost')
       group by i.id, i.name, i.unit
      having sum(case when m.type = 'issue' then m.qty else -m.qty end) > 0
    ), r as (
      select o.*, row_number() over (order by o.name) as rn from o
    )
    select count(*)::int,
           string_agg(format('"%s": %s %s', r.name, trim_scale(r.out_qty)::text, coalesce(r.unit, '')),
                      '; ' order by r.name) filter (where r.rn <= 8)
      into v_n, v_list
      from r;

    if v_n > 0 then
      raise exception 'Chưa thể chuyển dự án "%" sang "%": còn % đồ tái sử dụng chưa thu hồi hoặc chưa ghi hỏng/mất: %. Hãy ghi thu hồi ở tab "Thu hồi vật tư" trước.',
        old.name, public.project_status_label(new.status), v_n,
        v_list || case when v_n > 8 then format(' ... và %s vật tư khác', v_n - 8) else '' end
        using errcode = 'P0001';
    end if;
  end if;

  -- (b) Rời trạng thái Đã hủy
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    if exists (select 1 from public.project_advances a where a.project_id = old.id and a.kind = 'forfeit') then
      raise exception 'Không mở lại được dự án "%": dự án đã ghi Mất cọc. Muốn mở lại, hãy xóa khoản Mất cọc trước (nếu tháng đó chưa khóa sổ).',
        old.name using errcode = 'P0001';
    end if;

    -- cancelled_at có thể chưa tồn tại (chưa chạy projects_archive_schema.sql): đọc qua jsonb.
    v_old := to_jsonb(old);
    v_cancel_day := coalesce(nullif(v_old ->> 'cancelled_at', '')::date, old.start_date);
    if v_cancel_day is not null then
      v_month := to_char(v_cancel_day, 'YYYY-MM');
      if public.is_month_locked(v_month) then
        raise exception 'Không mở lại được dự án "%": tháng hủy % đã khóa sổ. Nhờ Quản trị mở khóa tháng (ghi lý do) rồi mới đổi trạng thái.',
          old.name, v_month using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.guard_project_status_change() from public, anon, authenticated;

drop trigger if exists trg_guard_project_status_change on public.projects;
create trigger trg_guard_project_status_change before update of status on public.projects
  for each row execute function public.guard_project_status_change();

-- ---------- 1b. CHẶN DỜI THÁNG HỦY RA / VÀO THÁNG ĐÃ KHÓA ----------
-- Dự án đang hủy (cũ và mới đều 'cancelled'): tháng hủy = cancelled_at, trống thì start_date.
-- Sửa start_date (khi chưa có cancelled_at) hoặc sửa cancelled_at làm đổi tháng hủy thì kiểm CẢ
-- tháng cũ lẫn tháng mới: một trong hai đã khóa sổ là chặn (không lách khỏi tháng khóa, không
-- nhét chi phí vào tháng khóa). Đổi ngày trong cùng tháng vẫn cho.
-- Trigger "before update" KHÔNG ghi "of cancelled_at" vì cột đó có thể chưa tồn tại (chưa chạy
-- projects_archive_schema.sql); đọc qua to_jsonb nên không lỗi.
-- Đổi status ra / vào 'cancelled' do mục 1 (và trg_set_cancelled_at) xử lý, ở đây bỏ qua.
create or replace function public.guard_cancel_month_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_day date;
  v_new_day date;
  v_old_m text;
  v_new_m text;
begin
  if old.status is distinct from 'cancelled' or new.status is distinct from 'cancelled' then
    return new;
  end if;
  v_old_day := coalesce(nullif(to_jsonb(old) ->> 'cancelled_at', '')::date, old.start_date);
  v_new_day := coalesce(nullif(to_jsonb(new) ->> 'cancelled_at', '')::date, new.start_date);
  v_old_m := to_char(v_old_day, 'YYYY-MM');
  v_new_m := to_char(v_new_day, 'YYYY-MM');
  if v_old_m is not distinct from v_new_m then
    return new;
  end if;
  if (v_old_m is not null and public.is_month_locked(v_old_m))
     or (v_new_m is not null and public.is_month_locked(v_new_m)) then
    raise exception 'Không đổi được tháng hủy của dự án "%" từ % sang %: có tháng đã khóa sổ. Nhờ Quản trị mở khóa tháng (ghi lý do) trước.',
      old.name, coalesce(v_old_m, '(trống)'), coalesce(v_new_m, '(trống)') using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.guard_cancel_month_change() from public, anon, authenticated;

drop trigger if exists trg_guard_cancel_month_change on public.projects;
create trigger trg_guard_cancel_month_change before update on public.projects
  for each row execute function public.guard_cancel_month_change();


-- =====================================================================
-- 2. CHỈ XUẤT KHO KHI DỰ ÁN ĐANG CHUẨN BỊ / ĐANG THI CÔNG VÀ CHƯA LƯU TRỮ
-- =====================================================================
-- Áp cho INSERT phiếu 'issue' có project_id, và UPDATE đổi phiếu thành 'issue' / đổi dự án
-- (stock_guards / audit_fixes đã chặn 2 kiểu sửa này, đây là lớp dự phòng).
-- Khóa dòng dự án FOR SHARE: nếu ai đó đang đổi trạng thái cùng lúc thì phiếu xuất chờ, đọc
-- trạng thái mới nhất. issue_project_by_plan (mục 5) giữ khóa mạnh hơn trên cùng dòng.
-- Người không có quyền xuất (staff...): trả về để RLS moves_insert tự từ chối, không lộ thông tin.
create or replace function public.guard_issue_project_status() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj jsonb;
  v_status text;
begin
  if new.type is distinct from 'issue' or new.project_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.type = 'issue' and old.project_id is not distinct from new.project_id then
    return new;
  end if;
  if auth.uid() is not null and not public.has_role(array['admin','manager','storekeeper']) then
    return new;
  end if;

  select to_jsonb(p.*) into v_proj from public.projects p where p.id = new.project_id for share;
  if v_proj is null then
    return new;   -- dự án không tồn tại: khóa ngoại tự từ chối
  end if;

  v_status := v_proj ->> 'status';
  if v_status not in ('preparing', 'in_progress') then
    raise exception 'Không xuất kho được: dự án "%" đang ở trạng thái "%". Chỉ xuất kho khi dự án ở "Đang chuẩn bị" hoặc "Đang thi công"; hãy đổi trạng thái dự án trước.',
      v_proj ->> 'name', public.project_status_label(v_status) using errcode = 'P0001';
  end if;
  if nullif(v_proj ->> 'archived_at', '') is not null then
    raise exception 'Không xuất kho được: dự án "%" đã lưu trữ. Hãy bỏ lưu trữ trước.',
      v_proj ->> 'name' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke execute on function public.guard_issue_project_status() from public, anon, authenticated;

drop trigger if exists trg_guard_issue_project_status on public.stock_movements;
create trigger trg_guard_issue_project_status before insert or update of type, project_id on public.stock_movements
  for each row execute function public.guard_issue_project_status();

-- ---------- 2b. CHẶN SỬA CỘT LÕI CỦA PHIẾU KHO (loại phiếu, vật tư, số lượng) ----------
-- Không có lớp này thì admin/manager (policy moves_update) có thể TĂNG qty của một phiếu xuất cũ
-- sau khi dự án đã đóng, hoặc đổi loại/vật tư để lách mọi kiểm tra lúc INSERT (tồn, trạng thái
-- dự án, thu hồi <= xuất). Đổi dự án đã bị chặn ở audit_fixes_2026-11-25.sql
-- (trg_block_stock_movement_project_update).
-- CÙNG TÊN HÀM + TÊN TRIGGER + NỘI DUNG với stock_guards.sql mục 2b: chạy file nào trước/sau cũng
-- chỉ còn một trigger, cùng một hành vi (create or replace + drop/create trigger).
create or replace function public.block_stock_movement_core_update() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type is distinct from old.type
     or new.qty is distinct from old.qty
     or new.item_id is distinct from old.item_id then
    raise exception 'Không sửa được loại phiếu, vật tư hoặc số lượng. Hãy xóa phiếu và ghi phiếu mới.';
  end if;
  return new;
end $$;

revoke execute on function public.block_stock_movement_core_update() from public, anon, authenticated;

drop trigger if exists trg_block_stock_movement_core_update on public.stock_movements;
create trigger trg_block_stock_movement_core_update before update of type, qty, item_id on public.stock_movements
  for each row execute function public.block_stock_movement_core_update();


-- =====================================================================
-- 3. RPC NẠP MẪU SET VÀO KẾ HOẠCH (nguyên tử)
-- =====================================================================
-- p_entries: [{ "template_id": 12, "mult": 2 }, ...]  (mult = số bộ, mặc định 1)
-- p_mode: 'add'     = cộng thêm vào số đang có;
--         'replace' = vật tư có trong mẫu lấy ĐÚNG số của mẫu; vật tư khác trong kế hoạch GIỮ NGUYÊN.
-- Quyền: giống policy plan_write (admin / manager / storekeeper).
-- Trả { "count": số vật tư đã ghi, "mode": ... }.
create or replace function public.apply_templates_to_plan(
  p_project_id bigint,
  p_entries jsonb,
  p_mode text default 'add'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_bad int;
begin
  if auth.uid() is not null and not public.has_role(array['admin','manager','storekeeper']) then
    raise exception 'Bạn không có quyền sửa kế hoạch vật tư.' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('add', 'replace') then
    raise exception 'Chế độ nạp mẫu set không hợp lệ (chỉ "add" hoặc "replace").' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'Chưa chọn mẫu set nào để nạp.' using errcode = '22023';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_entries) x
   where jsonb_typeof(x -> 'template_id') is distinct from 'number'
      or (x ? 'mult' and case when jsonb_typeof(x -> 'mult') = 'number'
                              then (x ->> 'mult')::numeric <= 0 else true end);
  if v_bad > 0 then
    raise exception 'Danh sách mẫu set không hợp lệ (mã mẫu hoặc số bộ sai).' using errcode = '22023';
  end if;

  -- Khóa dòng dự án: tuần tự hóa các lần ghi kế hoạch cùng dự án
  perform 1 from public.projects where id = p_project_id for no key update;
  if not found then
    raise exception 'Không tìm thấy dự án.' using errcode = 'P0002';
  end if;

  with e as (
    select (x ->> 'template_id')::bigint as template_id,
           coalesce((x ->> 'mult')::numeric, 1) as mult
      from jsonb_array_elements(p_entries) x
  ), a as (
    select ti.item_id, sum(ti.qty * e.mult) as qty
      from e
      join public.set_template_items ti on ti.template_id = e.template_id
     group by ti.item_id
    having sum(ti.qty * e.mult) > 0
  )
  insert into public.project_plan (project_id, item_id, qty)
  select p_project_id, a.item_id, a.qty from a order by a.item_id
  on conflict (project_id, item_id) do update
    set qty = case when p_mode = 'replace' then excluded.qty
                   else public.project_plan.qty + excluded.qty end;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'Các mẫu set đã chọn chưa có vật tư nào để nạp sang kế hoạch.' using errcode = 'P0001';
  end if;

  return jsonb_build_object('count', v_n, 'mode', p_mode);
end $$;

revoke all on function public.apply_templates_to_plan(bigint, jsonb, text) from public, anon;
grant execute on function public.apply_templates_to_plan(bigint, jsonb, text) to authenticated;


-- =====================================================================
-- 4. TẠM ỨNG / CỌC: KIỂM Ở DB (khớp src/lib/advances.js)
-- =====================================================================
-- * Dấu: advance > 0, refund < 0 (toAdvanceRow lưu âm), forfeit > 0. Chỉ kiểm dòng MỚI hoặc dòng
--   bị đổi kind/amount -> dữ liệu cũ sai dấu không bị đụng (xem câu kiểm tra V3).
-- * Mất cọc (forfeit) chỉ ghi khi dự án đang 'cancelled'.
-- * Tiền đang giữ = Σ|advance| − Σ|refund| − Σ|forfeit| không được âm sau thao tác. Thao tác làm
--   số này TĂNG (vd xóa khoản hoàn ghi nhầm) vẫn cho qua dù dữ liệu cũ đang âm, để sửa được.
-- * Khóa dòng dự án (FOR NO KEY UPDATE) trước khi cộng: hai người cùng hoàn cọc phải chờ nhau.
-- * Không cho đổi dự án của khoản tạm ứng (xóa rồi ghi lại).
-- * Xóa dây chuyền khi xóa dự án: dòng dự án đã bị xóa trong cùng giao dịch -> bỏ qua.
-- Người không có quyền (RLS project_advances_all chỉ admin/manager): INSERT trả về để RLS từ
-- chối; UPDATE/DELETE đã bị RLS lọc trước.
create or replace function public.guard_project_advance() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid bigint;
  v_status text;
  v_before numeric;
  v_after numeric;
begin
  if tg_op = 'INSERT' and auth.uid() is not null and not public.has_role(array['admin','manager']) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Không đổi được dự án của khoản tạm ứng/cọc. Hãy xóa khoản này và ghi lại ở đúng dự án.'
      using errcode = 'P0001';
  end if;

  v_pid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  select p.status into v_status from public.projects p where p.id = v_pid for no key update;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT' or new.kind is distinct from old.kind or new.amount is distinct from old.amount then
      if new.kind = 'advance' and not (new.amount > 0) then
        raise exception 'Khoản "Khách đưa" phải là số tiền dương.' using errcode = '23514';
      elsif new.kind = 'refund' and not (new.amount < 0) then
        raise exception 'Khoản "Hoàn lại khách" phải lưu số âm (app tự đổi dấu khi ghi).' using errcode = '23514';
      elsif new.kind = 'forfeit' and not (new.amount > 0) then
        raise exception 'Khoản "Mất cọc" phải là số tiền dương.' using errcode = '23514';
      end if;
    end if;
    if new.kind = 'forfeit' and (tg_op = 'INSERT' or old.kind is distinct from 'forfeit')
       and v_status is distinct from 'cancelled' then
      raise exception 'Chỉ ghi Mất cọc cho dự án đã hủy. Dự án đang ở trạng thái "%": hãy chuyển sang "Đã hủy" trước.',
        public.project_status_label(v_status) using errcode = 'P0001';
    end if;
  end if;

  select coalesce(sum(public.advance_held_delta(a.kind, a.amount)), 0)
    into v_before
    from public.project_advances a
   where a.project_id = v_pid;

  v_after := v_before;
  if tg_op in ('UPDATE', 'DELETE') then
    v_after := v_after - public.advance_held_delta(old.kind, old.amount);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := v_after + public.advance_held_delta(new.kind, new.amount);
  end if;

  if v_after < 0 and v_after < v_before then
    raise exception 'Số tiền đang giữ của khách không được âm: hiện đang giữ % ₫, sau thao tác này còn % ₫. Hãy kiểm tra lại số hoàn cọc / mất cọc.',
      public.format_vnd(v_before), public.format_vnd(v_after) using errcode = 'P0001';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function public.guard_project_advance() from public, anon, authenticated;

drop trigger if exists trg_guard_project_advance on public.project_advances;
create trigger trg_guard_project_advance before insert or update or delete on public.project_advances
  for each row execute function public.guard_project_advance();


-- =====================================================================
-- 5. RPC "XUẤT THEO KẾ HOẠCH" (một giao dịch, có khóa)
-- =====================================================================
-- Còn thiếu của từng dòng kế hoạch:
--   * Tái sử dụng: kế hoạch − max(0, đã xuất − đã thu hồi (tốt + hỏng + mất))  [= đang ở dự án]
--   * Tiêu hao:    kế hoạch − đã xuất  (SL dư trả kho không làm xuất thêm, giữ như luồng cũ)
-- Khóa: dòng dự án FOR NO KEY UPDATE (2 lần bấm / 2 máy cùng dự án phải chờ nhau; phiếu xuất
-- lẻ cùng dự án cũng chờ vì trigger mục 2 cần FOR SHARE), rồi từng vật tư theo item_id tăng dần
-- (cùng thứ tự với audit_fixes) để không deadlock.
-- Tồn kho kiểm sau khi khóa; thiếu bất kỳ dòng nào thì KHÔNG ghi dòng nào (như luồng cũ).
-- Quyền: giống moves_insert cho phiếu 'issue' (admin / manager / storekeeper).
-- Trả { "count": n, "lines": [{ "item_id", "qty" }] }; count = 0 nghĩa là đã xuất đủ.
create or replace function public.issue_project_by_plan(
  p_project_id bigint,
  p_moved_at date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj jsonb;
  v_status text;
  r record;
  v_in_stock numeric;
  v_short text[] := array[]::text[];
  v_ids bigint[] := array[]::bigint[];
  v_qtys numeric[] := array[]::numeric[];
  v_plan_ids bigint[];
  v_date date := coalesce(p_moved_at, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_note text := coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Xuất theo kế hoạch dự án');
begin
  if auth.uid() is not null and not public.has_role(array['admin','manager','storekeeper']) then
    raise exception 'Bạn không có quyền xuất kho cho dự án.' using errcode = '42501';
  end if;

  select to_jsonb(p.*) into v_proj from public.projects p where p.id = p_project_id for no key update;
  if v_proj is null then
    raise exception 'Không tìm thấy dự án.' using errcode = 'P0002';
  end if;
  v_status := v_proj ->> 'status';
  if v_status not in ('preparing', 'in_progress') then
    raise exception 'Không xuất kho được: dự án "%" đang ở trạng thái "%". Chỉ xuất kho khi dự án ở "Đang chuẩn bị" hoặc "Đang thi công"; hãy đổi trạng thái dự án trước.',
      v_proj ->> 'name', public.project_status_label(v_status) using errcode = 'P0001';
  end if;
  if nullif(v_proj ->> 'archived_at', '') is not null then
    raise exception 'Không xuất kho được: dự án "%" đã lưu trữ. Hãy bỏ lưu trữ trước.',
      v_proj ->> 'name' using errcode = 'P0001';
  end if;

  -- Khóa TẤT CẢ vật tư trong kế hoạch theo item_id tăng dần TRƯỚC khi đọc số liệu; sau đó mới
  -- đọc lại kế hoạch, số đã xuất/thu hồi và tồn kho (không dùng số đọc trước khi khóa).
  -- Chỉ xét các vật tư đã khóa (dòng kế hoạch thêm vào sau thời điểm này để lần bấm sau).
  v_plan_ids := array(select pl.item_id from public.project_plan pl
                       where pl.project_id = p_project_id order by pl.item_id);
  perform 1
     from public.items i
    where i.id = any(v_plan_ids)
    order by i.id
      for no key update;

  for r in
    with mv as (
      select m.item_id,
             sum(case when m.type = 'issue' then m.qty else 0 end) as issued,
             sum(case when m.type in ('return_good','return_damaged','return_lost') then m.qty else 0 end) as returned
        from public.stock_movements m
       where m.project_id = p_project_id
         and m.type in ('issue','return_good','return_damaged','return_lost')
       group by m.item_id
    )
    select pl.item_id, i.name, i.unit,
           pl.qty - case when i.kind = 'reusable'
                         then greatest(coalesce(mv.issued, 0) - coalesce(mv.returned, 0), 0)
                         else coalesce(mv.issued, 0) end as need
      from public.project_plan pl
      join public.items i on i.id = pl.item_id
      left join mv on mv.item_id = pl.item_id
     where pl.project_id = p_project_id
       and pl.item_id = any(v_plan_ids)
     order by pl.item_id
  loop
    continue when r.need is null or r.need <= 0;

    -- Tồn trong kho (vật tư đã khóa ở trên), CÙNG công thức in_stock của view item_stock
    select coalesce(sum(case
             when m.type in ('purchase','return_good','repair_done','adjust') then m.qty
             when m.type = 'issue' then -m.qty
             else 0 end), 0)
      into v_in_stock
      from public.stock_movements m
     where m.item_id = r.item_id;

    if r.need > v_in_stock then
      v_short := v_short || format('"%s": cần %s, trong kho còn %s %s',
        r.name, trim_scale(r.need)::text, trim_scale(greatest(v_in_stock, 0))::text, coalesce(r.unit, ''));
    else
      v_ids := v_ids || r.item_id;
      v_qtys := v_qtys || r.need;
    end if;
  end loop;

  if cardinality(v_short) > 0 then
    raise exception 'Không đủ tồn trong kho để xuất theo kế hoạch, chưa ghi phiếu nào: %',
      array_to_string(v_short, '; ') using errcode = 'P0001';
  end if;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('count', 0, 'lines', '[]'::jsonb);
  end if;

  insert into public.stock_movements (moved_at, type, item_id, project_id, qty, note)
  select v_date, 'issue', t.item_id, p_project_id, t.qty, v_note
    from unnest(v_ids, v_qtys) as t(item_id, qty)
   order by t.item_id;

  return jsonb_build_object(
    'count', cardinality(v_ids),
    'lines', (select jsonb_agg(jsonb_build_object('item_id', t.item_id, 'qty', t.qty) order by t.item_id)
                from unnest(v_ids, v_qtys) as t(item_id, qty))
  );
end $$;

revoke all on function public.issue_project_by_plan(bigint, date, text) from public, anon;
grant execute on function public.issue_project_by_plan(bigint, date, text) to authenticated;


-- =====================================================================
-- 6. BÁO GIÁ LƯU TRÊN SUPABASE: project_quotes
-- =====================================================================
-- data (jsonb) = { "version": 1, "quoteNote": "...", "lines": [ { uid, template_id, name, category,
--   qty (số bộ), note, image_source: 'template' | 'custom' | 'none', image_url } ] }
-- * KHÔNG chứa số lượng từng vật tư, giá vốn, giá trị HĐ hay ưu đãi (giá trị HĐ / ưu đãi vẫn ở
--   project_finance, không tạo nguồn thứ hai).
-- * Ảnh mẫu set: chỉ lưu tham chiếu template_id (image_source = 'template', image_url rỗng), app
--   lấy ảnh từ mẫu khi hiển thị. Chỉ ảnh tự tải lên (đã nén < 1 MB, thường ~200 KB) mới nằm trong
--   jsonb. Trần cả báo giá 4 MB.
-- * updated_at do DB tự đặt mỗi lần đổi data: app so updated_at để phát hiện hai máy sửa cùng lúc.
-- * Quyền: đúng nhóm đang thấy tab Báo giá (canEditCatalog): admin, manager, storekeeper đọc/ghi;
--   xóa: admin, manager. staff và anon KHÔNG đọc được.
create table if not exists public.project_quotes (
  project_id bigint primary key references public.projects(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null
);

create or replace function public.project_quotes_before_write() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_bytes int;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Không đổi được dự án của báo giá.' using errcode = 'P0001';
    end if;
    -- Chỉ đổi updated_by (vd xóa người dùng -> set null): không coi là sửa báo giá.
    if new.data is not distinct from old.data then
      new.updated_at := old.updated_at;
      return new;
    end if;
  end if;

  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    raise exception 'Dữ liệu báo giá không hợp lệ.' using errcode = '22023';
  end if;
  v_bytes := octet_length(new.data::text);
  if v_bytes > 4 * 1024 * 1024 then
    raise exception 'Báo giá quá lớn (% KB, tối đa 4096 KB). Hãy bỏ bớt ảnh tự tải lên.',
      (v_bytes / 1024) using errcode = '54000';
  end if;

  new.updated_at := clock_timestamp();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

revoke execute on function public.project_quotes_before_write() from public, anon, authenticated;

drop trigger if exists trg_project_quotes_before_write on public.project_quotes;
create trigger trg_project_quotes_before_write before insert or update on public.project_quotes
  for each row execute function public.project_quotes_before_write();

alter table public.project_quotes enable row level security;

drop policy if exists "project_quotes_select" on public.project_quotes;
create policy "project_quotes_select" on public.project_quotes for select to authenticated
  using (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists "project_quotes_insert" on public.project_quotes;
create policy "project_quotes_insert" on public.project_quotes for insert to authenticated
  with check (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists "project_quotes_update" on public.project_quotes;
create policy "project_quotes_update" on public.project_quotes for update to authenticated
  using (public.has_role(array['admin','manager','storekeeper']))
  with check (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists "project_quotes_delete" on public.project_quotes;
create policy "project_quotes_delete" on public.project_quotes for delete to authenticated
  using (public.has_role(array['admin','manager']));

revoke all on public.project_quotes from anon;
grant select, insert, update, delete on public.project_quotes to authenticated;

commit;


-- =====================================================================
-- 7. GIỚI HẠN ĐÃ BIẾT
-- =====================================================================
--  * Dự án ĐÃ ở 'done'/'cancelled' mà còn đồ (câu V1) không bị đổi gì; chỉ lần đổi trạng thái sau
--    mới bị kiểm. Đổi dự án 'done' -> 'cancelled' cũng bị kiểm đồ.
--  * Mở lại dự án hủy bị chặn khi có Mất cọc: muốn mở lại phải xóa khoản Mất cọc trước (bị trigger
--    khóa sổ của month_lock_controls.sql chặn nếu tháng đó đã khóa).
--  * Phiếu xuất cũ của dự án không ở Chuẩn bị/Đang thi công (câu V2) giữ nguyên; xóa phiếu vẫn theo
--    quy tắc cũ (không bị chặn theo trạng thái).
--  * Trigger chặn xuất áp cho MỌI đường ghi có phiên đăng nhập hoặc không (SQL Editor, import):
--    muốn xuất cho dự án Báo giá/Chờ thu hồi phải đổi trạng thái trước.
--  * Báo giá: app dùng so khớp updated_at (khóa lạc quan). Hai máy sửa cùng lúc: máy lưu sau nhận
--    báo xung đột và chọn tải bản mới hoặc ghi đè; không gộp từng dòng.


-- =====================================================================
-- 8. CÂU KIỂM TRA (bỏ comment từng khối để chạy)
-- =====================================================================
-- ---- TRƯỚC KHI CÀI (chỉ đọc, không chặn cài; có dòng thì gửi em xem, KHÔNG tự sửa) ----
-- (V1) Dự án đã Hoàn thành / Đã hủy nhưng còn đồ tái sử dụng chưa thu hồi:
-- select p.id, p.code, p.name, p.status, i.name as vat_tu,
--        sum(case when m.type = 'issue' then m.qty else -m.qty end) as con_o_du_an
--   from public.stock_movements m
--   join public.items i on i.id = m.item_id
--   join public.projects p on p.id = m.project_id
--  where i.kind = 'reusable' and p.status in ('done','cancelled')
--    and m.type in ('issue','return_good','return_damaged','return_lost')
--  group by p.id, p.code, p.name, p.status, i.name
-- having sum(case when m.type = 'issue' then m.qty else -m.qty end) > 0
--  order by p.code, i.name;
--
-- (V2) Phiếu xuất của dự án KHÔNG ở Chuẩn bị / Đang thi công (chỉ để biết; phiếu cũ giữ nguyên):
-- select p.id, p.code, p.name, p.status, count(*) as so_phieu_xuat, max(m.moved_at) as lan_cuoi
--   from public.stock_movements m join public.projects p on p.id = m.project_id
--  where m.type = 'issue' and p.status not in ('preparing','in_progress')
--  group by p.id, p.code, p.name, p.status order by lan_cuoi desc;
--
-- (V3) Khoản tạm ứng sai dấu (advance/forfeit <= 0, refund >= 0). Dòng cũ không bị chặn, nhưng
--      sửa số tiền/loại của dòng đó sẽ bị kiểm dấu:
-- select a.id, a.project_id, p.code, a.kind, a.amount, a.received_date
--   from public.project_advances a join public.projects p on p.id = a.project_id
--  where (a.kind = 'advance' and a.amount <= 0) or (a.kind = 'refund' and a.amount >= 0)
--     or (a.kind = 'forfeit' and a.amount <= 0)
--  order by a.project_id, a.id;
--
-- (V4) Mất cọc ở dự án KHÔNG ở trạng thái Đã hủy:
-- select a.id, a.project_id, p.code, p.status, a.amount, a.received_date
--   from public.project_advances a join public.projects p on p.id = a.project_id
--  where a.kind = 'forfeit' and p.status <> 'cancelled';
--
-- (V5) Dự án đang giữ tiền âm (hoàn + mất cọc > đã nhận). Sau khi cài, mọi thao tác làm số này
--      giảm thêm sẽ bị chặn; thao tác làm tăng (xóa khoản hoàn nhầm) vẫn được:
-- select a.project_id, p.code, p.name,
--        sum(case when a.kind = 'advance' then abs(a.amount) else 0 end) as da_nhan,
--        sum(case when a.kind = 'refund' then abs(a.amount) else 0 end) as da_hoan,
--        sum(case when a.kind = 'forfeit' then abs(a.amount) else 0 end) as mat_coc
--   from public.project_advances a join public.projects p on p.id = a.project_id
--  group by a.project_id, p.code, p.name
-- having sum(case when a.kind = 'advance' then abs(a.amount) when a.kind in ('refund','forfeit') then -abs(a.amount) else 0 end) < 0;
--
-- (V6) Dự án hủy đã có Mất cọc (sau khi cài sẽ KHÔNG mở lại được trừ khi xóa Mất cọc):
-- select p.id, p.code, p.name, count(*) as so_khoan_mat_coc
--   from public.projects p join public.project_advances a on a.project_id = p.id and a.kind = 'forfeit'
--  where p.status = 'cancelled' group by p.id, p.code, p.name;
--
-- (V7) Bảng project_quotes đã có từ trước chưa (0 dòng = chưa có, bình thường):
-- select to_regclass('public.project_quotes');
--
-- ---- SAU KHI CÀI ----
-- (A) 6 trigger (phải ra 6 dòng):
-- select tgrelid::regclass as bang, tgname, tgfoid::regproc as ham from pg_trigger
--  where not tgisinternal and tgname in ('trg_guard_project_status_change', 'trg_guard_cancel_month_change',
--    'trg_guard_issue_project_status', 'trg_block_stock_movement_core_update',
--    'trg_guard_project_advance', 'trg_project_quotes_before_write')
--  order by 1, 2;
--
-- (B) 11 hàm, đều có search_path (proconfig). security definer (prosecdef = true):
--     guard_project_status_change, guard_cancel_month_change, guard_issue_project_status,
--     guard_project_advance, apply_templates_to_plan, issue_project_by_plan. Các hàm còn lại: false.
-- select proname, prosecdef, proconfig from pg_proc
--  where pronamespace = 'public'::regnamespace and proname in (
--    'project_status_label', 'format_vnd', 'advance_held_delta', 'guard_project_status_change',
--    'guard_cancel_month_change', 'guard_issue_project_status', 'block_stock_movement_core_update',
--    'apply_templates_to_plan', 'guard_project_advance', 'issue_project_by_plan', 'project_quotes_before_write')
--  order by proname;
--
-- (B2) Thử tăng số lượng phiếu xuất cũ (phải báo 'Không sửa được loại phiếu, vật tư hoặc số lượng'):
-- begin;
--   update public.stock_movements set qty = qty + 1 where id = <id_phieu_xuat>;
-- rollback;
--
-- (B3) Dự án hủy chưa có cancelled_at, tháng start_date đã khóa: dời start_date sang tháng mở
--      (phải báo 'Không đổi được tháng hủy'):
-- begin;
--   update public.projects set start_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date where id = <project_id_huy>;
-- rollback;
--
-- (C) RPC chỉ authenticated gọi được (không có anon / PUBLIC):
-- select routine_name, grantee, privilege_type from information_schema.routine_privileges
--  where routine_schema = 'public'
--    and routine_name in ('apply_templates_to_plan', 'issue_project_by_plan')
--  order by 1, 2;
--
-- (D) RLS project_quotes bật và đúng 4 policy; anon không có quyền bảng:
-- select relname, relrowsecurity from pg_class where oid = 'public.project_quotes'::regclass;
-- select policyname, cmd, roles, qual, with_check from pg_policies
--  where schemaname = 'public' and tablename = 'project_quotes' order by policyname;
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'project_quotes' and grantee in ('anon', 'authenticated');
--
-- (E) Thử chặn hoàn tất dự án còn đồ (đổi <project_id> là dự án còn đồ TSD chưa thu; phải báo
--     'Chưa thể chuyển dự án ...'):
-- begin;
--   update public.projects set status = 'done' where id = <project_id>;
-- rollback;
--
-- (F) Thử xuất cho dự án Báo giá (đổi <item_id>, <project_id> là dự án status 'quote'; phải báo
--     'Không xuất kho được: dự án ... đang ở trạng thái "Báo giá"'):
-- begin;
--   insert into public.stock_movements (type, item_id, project_id, qty, note)
--     values ('issue', <item_id>, <project_id>, 1, 'thu chan xuat');
-- rollback;
--
-- (G) Thử hoàn cọc vượt số đang giữ (phải báo 'Số tiền đang giữ của khách không được âm'):
-- begin;
--   insert into public.project_advances (project_id, kind, amount, note)
--     values (<project_id>, 'refund', -999999999, 'thu chan hoan');
-- rollback;
--
-- (H) Thử Mất cọc cho dự án chưa hủy (phải báo 'Chỉ ghi Mất cọc cho dự án đã hủy'):
-- begin;
--   insert into public.project_advances (project_id, kind, amount, note) values (<project_id>, 'forfeit', 1, 'thu');
-- rollback;
--
-- (I) Thử nạp mẫu chế độ thay thế rồi hủy (phải trả {"count": n, "mode": "replace"}):
-- begin;
--   select public.apply_templates_to_plan(<project_id>, '[{"template_id": <template_id>, "mult": 1}]'::jsonb, 'replace');
--   select * from public.project_plan where project_id = <project_id> order by item_id;
-- rollback;
--
-- (J) Thử xuất theo kế hoạch 2 lần trong cùng giao dịch (lần 2 phải ra "count": 0):
-- begin;
--   select public.issue_project_by_plan(<project_id>, null, 'thu');
--   select public.issue_project_by_plan(<project_id>, null, 'thu');
-- rollback;
--
-- (K) Báo giá quá 4 MB bị chặn (phải báo 'Báo giá quá lớn'):
-- begin;
--   insert into public.project_quotes (project_id, data)
--     values (<project_id>, jsonb_build_object('x', repeat('a', 5 * 1024 * 1024)));
-- rollback;


-- =====================================================================
-- 9. HOÀN TÁC (anh Thiện quyết định sau khi sao lưu, KHÔNG chạy tự động)
-- =====================================================================
-- Ưu tiên hoàn tác code app trước; app tự quay về luồng cũ khi thiếu RPC/bảng (trừ dữ liệu báo
-- giá đã lên DB: app cũ chỉ đọc localStorage nên sẽ không thấy báo giá trên DB).
-- Nếu cần gỡ hẳn, chạy trong một giao dịch riêng:
-- begin;
--   drop trigger if exists trg_guard_project_status_change on public.projects;
--   drop trigger if exists trg_guard_cancel_month_change on public.projects;
--   drop function if exists public.guard_cancel_month_change();
--   drop trigger if exists trg_guard_issue_project_status on public.stock_movements;
--   -- trg_block_stock_movement_core_update / block_stock_movement_core_update: GIỮ NGUYÊN nếu đã/sẽ chạy
--   -- stock_guards.sql (cùng tên, dùng chung). Chỉ gỡ khi không dùng stock_guards.sql.
--   drop trigger if exists trg_guard_project_advance on public.project_advances;
--   drop function if exists public.guard_project_status_change();
--   drop function if exists public.guard_issue_project_status();
--   drop function if exists public.guard_project_advance();
--   drop function if exists public.apply_templates_to_plan(bigint, jsonb, text);
--   drop function if exists public.issue_project_by_plan(bigint, date, text);
--   -- Bảng báo giá CHỨA DỮ LIỆU: sao lưu trước (vd: select project_id, data, updated_at from public.project_quotes;)
--   -- drop trigger if exists trg_project_quotes_before_write on public.project_quotes;
--   -- drop function if exists public.project_quotes_before_write();
--   -- drop table if exists public.project_quotes;
--   -- Hàm phụ chỉ gỡ khi không còn hàm nào dùng:
--   -- drop function if exists public.advance_held_delta(text, numeric);
--   -- drop function if exists public.format_vnd(numeric);
--   -- drop function if exists public.project_status_label(text);
-- commit;
