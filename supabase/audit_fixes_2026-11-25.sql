-- =====================================================================
-- ĐẶNG WEDDING — SỬA LỖI KIỂM TOÁN 2026-11-25
--   1) Khóa sổ tháng: sửa trigger chặn ghi sổ Ads / chi phí cứng của tháng đã khóa.
--   2) Sổ kho: chặn ở DB xuất kho vượt tồn và thu hồi vượt số đã xuất cho dự án;
--      ép created_by = người đang đăng nhập; chặn đổi dự án của phiếu xuất/thu hồi.
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent):
--   chỉ dùng create or replace function, drop trigger if exists + create trigger.
--   KHÔNG sửa/xóa dữ liệu nào, KHÔNG đổi policy RLS.
-- Yêu cầu: đã chạy schema.sql (stock_movements, items, profiles) và finance_schema.sql
--          (fixed_costs, ads_spend, month_locks, is_month_locked).
-- Thứ tự khuyến nghị: schema.sql -> finance_schema.sql -> month_lock_controls.sql ->
--          stock_receipts.sql -> stock_guards.sql -> FILE NÀY (chạy SAU CÙNG).
--   * Phần 2 KHÔNG gọi hàm item_balance của stock_guards.sql (tự tính lại cùng công thức view
--     item_stock), nên chạy được cả khi chưa chạy stock_guards.sql; nhưng nên chạy sau nó để
--     hai lớp chặn cùng có mặt.
--   * Nếu sau này chạy lại finance_schema.sql: nó tạo lại trigger trg_fixed_costs_lock /
--     trg_ads_spend_lock bằng hàm cũ guard_locked_month (có lỗi) -> PHẢI chạy lại file này.
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File CHƯA được test trên DB thật.
-- TRƯỚC KHI CÀI: chạy 2 câu kiểm tra "TRƯỚC KHI CÀI" ở mục 4 cuối file.
-- =====================================================================


-- =====================================================================
-- 1. KHÓA SỔ THÁNG: SỬA TRIGGER CHO ads_spend VÀ fixed_costs
-- =====================================================================
-- Lỗi cũ (finance_schema.sql, hàm guard_locked_month):
--   (a) ads_spend.month là cột GENERATED; trong trigger BEFORE INSERT/UPDATE giá trị NEW.month
--       chưa được tính (NULL) -> is_month_locked(NULL) = false -> ghi được vào tháng đã khóa.
--       UPDATE đổi spend_date cũng vậy (NEW.month vẫn là giá trị chưa tính lại).
--   (b) UPDATE fixed_costs chỉ xét NEW.month -> sửa một dòng của tháng khóa và đổi month sang
--       tháng mở là lọt (dòng biến mất khỏi tháng khóa).
-- Cách sửa: 2 hàm riêng; UPDATE xét cả dòng cũ lẫn dòng mới; DELETE xét dòng cũ.
-- Giữ nguyên hàm is_month_locked(text) và hàm cũ guard_locked_month (không xóa, chỉ thôi dùng).

-- Tháng 'YYYY-MM' từ một ngày, ĐÚNG công thức cột generated ads_spend.month (finance_schema.sql).
create or replace function public.month_key_of(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_date is null then null else
    lpad(extract(year from p_date)::int::text, 4, '0') || '-' || lpad(extract(month from p_date)::int::text, 2, '0')
  end
$$;

-- 1a. Sổ Ads: tính tháng từ spend_date (không đọc cột generated month).
create or replace function public.guard_locked_month_ads_spend() returns trigger
language plpgsql
set search_path = public
as $$
declare
  m text;
begin
  -- Dòng cũ (UPDATE / DELETE): không cho sửa hoặc xóa dòng đang thuộc tháng đã khóa.
  if tg_op in ('UPDATE', 'DELETE') then
    m := public.month_key_of(old.spend_date);
    if public.is_month_locked(m) then
      raise exception 'Tháng % đã khóa sổ, không được sửa/xóa chi phí Ads.', m;
    end if;
  end if;
  -- Dòng mới (INSERT / UPDATE): không cho ghi mới hoặc dời ngày vào tháng đã khóa.
  if tg_op in ('INSERT', 'UPDATE') then
    m := public.month_key_of(new.spend_date);   -- spend_date NULL -> m NULL -> ràng buộc NOT NULL tự từ chối
    if public.is_month_locked(m) then
      raise exception 'Tháng % đã khóa sổ, không được ghi chi phí Ads vào tháng này.', m;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- 1b. Chi phí cứng: month là cột thường -> xét old.month và new.month.
create or replace function public.guard_locked_month_fixed_costs() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.is_month_locked(old.month) then
    raise exception 'Tháng % đã khóa sổ, không được sửa/xóa chi phí cứng.', old.month;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.is_month_locked(new.month) then
    raise exception 'Tháng % đã khóa sổ, không được ghi chi phí cứng vào tháng này.', new.month;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Gắn lại trigger (CÙNG TÊN với finance_schema.sql để thay thế, không chạy song song 2 trigger).
drop trigger if exists trg_fixed_costs_lock on public.fixed_costs;
create trigger trg_fixed_costs_lock before insert or update or delete on public.fixed_costs
  for each row execute function public.guard_locked_month_fixed_costs();

drop trigger if exists trg_ads_spend_lock on public.ads_spend;
create trigger trg_ads_spend_lock before insert or update or delete on public.ads_spend
  for each row execute function public.guard_locked_month_ads_spend();


-- =====================================================================
-- 2. SỔ KHO: CHẶN XUẤT VƯỢT TỒN, THU HỒI VƯỢT SỐ ĐÃ XUẤT
-- =====================================================================
-- Quyết định nghiệp vụ (CONTEXT-DU-AN.md mục 2.1):
--   * 'issue' (xuất cho dự án): áp cho CẢ HAI loại vật tư. Cả tiêu hao và tái sử dụng đều trừ
--     in_stock khi xuất, nên không được xuất quá số đang có trong kho.
--   * Thu hồi ('return_good' | 'return_damaged' | 'return_lost'): áp cho CẢ HAI loại vật tư,
--     KHÔNG chỉ tái sử dụng, vì vật tư tiêu hao cũng có thu hồi (phiếu 'return_good' = "SL dư"
--     nhập lại kho, ProjectDetailPage). Quy tắc: tổng đã thu hồi (tốt + hỏng + mất) của
--     (vật tư, dự án) sau khi ghi phiếu này <= tổng đã xuất cho (vật tư, dự án) đó.
--     Chỉ tính phiếu xuất CỦA CHÍNH DỰ ÁN ĐÓ (phiếu xuất của dự án khác không được cộng vào).
--   * Áp cho MỌI vai trò (admin, manager, storekeeper, staff) và mọi đường ghi (app, API,
--     SQL Editor, import), vì trigger chạy ở DB.
--   * Các loại phiếu khác ('purchase', 'adjust', 'repair_done', 'dispose') KHÔNG bị trigger này
--     đụng tới: nhập kho, kiểm kho (điều chỉnh), sửa xong / thanh lý chạy như cũ (điều chỉnh âm,
--     sửa xong, thanh lý đã có chặn riêng ở stock_guards.sql). Chuyển kho là bảng khác
--     (stock_transfers), không bị ảnh hưởng.
--   * Đơn vị tính: qty luôn theo items.unit của vật tư; DB không quy đổi đơn vị. Phiếu xuất và
--     phiếu thu hồi cùng item_id nên cùng đơn vị, so sánh trực tiếp là đúng.
-- Chống tranh chấp: khóa dòng vật tư (items ... for no key update) giống stock_guards.sql, nên
--   2 phiếu cùng vật tư ghi cùng lúc phải chờ nhau, không cùng "thấy" một mức tồn rồi cùng qua.
--   Lệnh insert NHIỀU DÒNG khóa nhiều vật tư theo thứ tự dòng gửi lên: app phải sắp dòng theo
--   item_id trước khi insert (đã làm ở ProjectDetailPage) để 2 người xuất cùng lúc không deadlock.
-- Ghi nhiều dòng trong 1 lệnh insert: trigger theo DÒNG (before row) thấy các dòng đã chèn
--   trước đó trong cùng lệnh, nên "nhập mua rồi xuất" trong cùng 1 lệnh vẫn qua; ngược lại 2 dòng
--   xuất cùng vật tư trong 1 lệnh được cộng dồn đúng.
-- security definer: cần để (1) đọc đủ sổ kho bất kể RLS (nhân viên chỉ thấy phiếu dự án mình),
--   (2) khóa dòng items (nhân viên không có quyền UPDATE items nên tự khóa sẽ bị từ chối).
create or replace function public.guard_stock_issue_return_insert() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_in_stock numeric;
  v_issued numeric;
  v_returned numeric;
begin
  -- Chỉ người CÓ QUYỀN ghi mới được đi tiếp (khớp policy moves_insert). Người không đủ quyền:
  -- để RLS tự từ chối, không để câu báo lỗi lộ tên vật tư / số liệu kho (trigger chạy trước RLS).
  -- Không có phiên đăng nhập (SQL Editor, service_role): auth.uid() NULL -> vẫn kiểm tra như cũ.
  if auth.uid() is not null then
    if new.type = 'issue' then
      if not public.has_role(array['admin','manager','storekeeper']) then
        return new;
      end if;
    elsif new.type in ('return_good', 'return_damaged', 'return_lost') then
      if not (public.has_role(array['admin','manager','storekeeper'])
              or (public.has_role(array['staff']) and public.can_see_project(new.project_id))) then
        return new;
      end if;
    end if;
  end if;

  if new.type = 'issue' then
    -- Khóa dòng vật tư (tuần tự hóa theo vật tư)
    select i.name into v_name from public.items i where i.id = new.item_id for no key update;
    if not found then
      return new;   -- item_id không tồn tại: để khóa ngoại tự từ chối
    end if;

    -- Tồn trong kho hiện tại, CÙNG công thức cột in_stock của view item_stock (schema.sql)
    select coalesce(sum(case
             when m.type in ('purchase','return_good','repair_done','adjust') then m.qty
             when m.type = 'issue' then -m.qty
             else 0 end), 0)
      into v_in_stock
      from public.stock_movements m
     where m.item_id = new.item_id;

    -- qty NULL hoặc <= 0: để ràng buộc NOT NULL / check (qty > 0) của bảng tự từ chối
    if new.qty > v_in_stock then
      raise exception 'Xuất kho vượt tồn: "%" chỉ còn % trong kho, phiếu xuất %.',
        v_name, trim_scale(greatest(v_in_stock, 0))::text, trim_scale(new.qty)::text;
    end if;

  elsif new.type in ('return_good', 'return_damaged', 'return_lost') then
    -- Thu hồi bắt buộc có dự án (check của bảng sẽ từ chối nếu NULL); NULL thì không so được
    if new.project_id is null then
      return new;
    end if;

    select i.name into v_name from public.items i where i.id = new.item_id for no key update;
    if not found then
      return new;
    end if;

    -- Chỉ tính phiếu của CHÍNH (vật tư, dự án) này
    select coalesce(sum(case when m.type = 'issue' then m.qty else 0 end), 0),
           coalesce(sum(case when m.type in ('return_good','return_damaged','return_lost') then m.qty else 0 end), 0)
      into v_issued, v_returned
      from public.stock_movements m
     where m.item_id = new.item_id
       and m.project_id = new.project_id;

    if v_returned + new.qty > v_issued then
      raise exception 'Thu hồi vượt số đã xuất: "%" đã xuất cho dự án này %, đã thu hồi %, chỉ còn thu hồi được tối đa %.',
        v_name, trim_scale(v_issued)::text, trim_scale(v_returned)::text,
        trim_scale(greatest(v_issued - v_returned, 0))::text;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.guard_stock_issue_return_insert() from public, anon, authenticated;

drop trigger if exists trg_guard_stock_issue_return_insert on public.stock_movements;
create trigger trg_guard_stock_issue_return_insert before insert on public.stock_movements
  for each row execute function public.guard_stock_issue_return_insert();


-- ---------- 2c. ÉP NGƯỜI TẠO PHIẾU = NGƯỜI ĐANG ĐĂNG NHẬP ----------
-- Chọn cách TRIGGER thay vì sửa policy moves_insert (with check created_by = auth.uid()):
--   * Sửa policy sẽ làm hỏng mọi lệnh insert gửi created_by khác/NULL; app hiện không gửi
--     created_by (dùng default auth.uid()) nên trigger không đổi hành vi app.
--   * Không phải sửa schema.sql, không đụng RLS.
-- Có phiên đăng nhập (auth.uid() có giá trị): luôn ghi đè created_by bằng auth.uid().
-- Không có phiên (SQL Editor, service_role, import): giữ nguyên giá trị gửi lên.
create or replace function public.force_stock_movement_created_by() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_force_stock_movement_created_by on public.stock_movements;
create trigger trg_force_stock_movement_created_by before insert on public.stock_movements
  for each row execute function public.force_stock_movement_created_by();

-- Chặn sửa created_by sang người KHÁC (admin/manager có quyền UPDATE phiếu).
-- Vẫn cho đặt về NULL vì admin_delete_user (schema.sql) và nút xóa người dùng ở UsersPage
-- gỡ created_by = null trước khi xóa tài khoản.
create or replace function public.block_stock_movement_created_by_update() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'Không sửa được người tạo phiếu kho.';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_stock_movement_created_by_update on public.stock_movements;
create trigger trg_block_stock_movement_created_by_update before update of created_by on public.stock_movements
  for each row execute function public.block_stock_movement_created_by_update();

-- ---------- 2d. CHẶN ĐỔI DỰ ÁN CỦA PHIẾU XUẤT / THU HỒI ----------
-- stock_guards.sql đã chặn sửa type/qty/item_id nhưng chưa chặn project_id: admin/manager có thể
-- dời phiếu thu hồi sang dự án khác để lách mục 2 (thu hồi > xuất). App hiện không có chỗ nào
-- sửa project_id của phiếu kho nên chặn không ảnh hưởng luồng đang chạy.
create or replace function public.block_stock_movement_project_update() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id
     and (old.type in ('issue','return_good','return_damaged','return_lost')
          or new.type in ('issue','return_good','return_damaged','return_lost')) then
    raise exception 'Không đổi được dự án của phiếu xuất / thu hồi. Hãy xóa phiếu và ghi phiếu mới.';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_stock_movement_project_update on public.stock_movements;
create trigger trg_block_stock_movement_project_update before update of project_id on public.stock_movements
  for each row execute function public.block_stock_movement_project_update();


-- =====================================================================
-- 3. GIỚI HẠN ĐÃ BIẾT (chưa xử lý trong file này)
-- =====================================================================
--  * Vật tư đang có tồn ÂM sẵn (xuất vượt từ trước) sẽ KHÔNG xuất thêm được cho tới khi nhập
--    mua / kiểm kho bù lại. Xem câu kiểm tra (T1).
--  * (Vật tư, dự án) đang thu hồi vượt số xuất sẵn từ trước: mọi phiếu thu hồi mới của cặp đó
--    bị chặn cho tới khi sửa dữ liệu. Xem câu kiểm tra (T2).
--  * XÓA phiếu xuất: trigger xóa của stock_guards.sql chỉ kiểm tổng "đang ở dự án" của vật tư
--    (mọi dự án cộng lại), chưa kiểm theo TỪNG dự án -> xóa phiếu xuất của dự án A vẫn có thể làm
--    A "thu hồi > xuất" nếu dự án B đang giữ đồ cùng loại. Cần trigger xóa theo dự án nếu muốn chặn.
--  * Không chặn xuất cho dự án đã hủy/đã xong, không chặn ghi phiếu kho vào tháng đã khóa sổ.


-- =====================================================================
-- 4. CÂU KIỂM TRA (bỏ comment từng khối để chạy; khối thử ghi luôn bọc begin ... rollback)
-- =====================================================================
-- ---- TRƯỚC KHI CÀI ----
-- (T1) Vật tư đang tồn âm (đã xuất/điều chỉnh vượt). Có dòng nào thì vật tư đó sẽ KHÔNG xuất
--      thêm được sau khi cài cho tới khi nhập bù:
-- select id, code, name, kind, unit, in_stock, at_project, in_repair
--   from public.item_stock
--  where in_stock < 0 or at_project < 0 or in_repair < 0
--  order by name;
--
-- (T2) (Vật tư, dự án) đang thu hồi nhiều hơn số đã xuất. Có dòng nào thì cặp đó sẽ KHÔNG ghi
--      thêm thu hồi được sau khi cài:
-- select m.item_id, i.name, i.kind, m.project_id, p.code as ma_du_an,
--        sum(case when m.type = 'issue' then m.qty else 0 end) as da_xuat,
--        sum(case when m.type in ('return_good','return_damaged','return_lost') then m.qty else 0 end) as da_thu_hoi
--   from public.stock_movements m
--   join public.items i on i.id = m.item_id
--   left join public.projects p on p.id = m.project_id
--  where m.project_id is not null
--  group by m.item_id, i.name, i.kind, m.project_id, p.code
-- having sum(case when m.type in ('return_good','return_damaged','return_lost') then m.qty else 0 end)
--      > sum(case when m.type = 'issue' then m.qty else 0 end)
--  order by p.code, i.name;
--
-- (T3) Dòng chi phí Ads / chi phí cứng đang nằm trong tháng đã khóa (chỉ để biết, không chặn cài):
-- select 'ads_spend' as bang, a.id, public.month_key_of(a.spend_date) as thang from public.ads_spend a
--  where public.is_month_locked(public.month_key_of(a.spend_date))
-- union all
-- select 'fixed_costs', f.id, f.month from public.fixed_costs f where public.is_month_locked(f.month);
-- (Câu T3 cần hàm month_key_of nên chạy SAU khi cài; trước khi cài thay month_key_of(a.spend_date) bằng a.month.)
--
-- ---- SAU KHI CÀI ----
-- (A) Các trigger đúng hàm mới (phải ra 7 dòng):
-- select tgrelid::regclass as bang, tgname, tgfoid::regproc as ham from pg_trigger
--  where not tgisinternal and tgname in (
--    'trg_fixed_costs_lock', 'trg_ads_spend_lock',
--    'trg_guard_stock_issue_return_insert', 'trg_force_stock_movement_created_by',
--    'trg_block_stock_movement_created_by_update', 'trg_block_stock_movement_project_update',
--    'trg_guard_stock_movement_insert')
--  order by 1, 2;
-- -- trg_fixed_costs_lock -> guard_locked_month_fixed_costs, trg_ads_spend_lock -> guard_locked_month_ads_spend
-- -- (trg_guard_stock_movement_insert chỉ có nếu đã chạy stock_guards.sql)
--
-- (B) month_key_of khớp cột generated trên mọi dòng ads_spend (phải ra 0 dòng):
-- select id, spend_date, month from public.ads_spend where month is distinct from public.month_key_of(spend_date);
--
-- (C) Thử ghi Ads vào tháng đã khóa (phải báo 'Tháng ... đã khóa sổ, không được ghi chi phí Ads...').
--     Khóa tạm tháng trước NGAY TRONG giao dịch rồi rollback (không khóa thật). Nếu tháng trước
--     đã khóa sẵn thì câu insert month_locks báo trùng khóa: bỏ dòng đó đi.
-- begin;
--   insert into public.month_locks (month)
--     values (to_char(((now() at time zone 'Asia/Ho_Chi_Minh') - interval '1 month'), 'YYYY-MM'));
--   insert into public.ads_spend (spend_date, channel, spend)
--     values ((date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')) - interval '1 day')::date, 'other', 1);
-- rollback;
--
-- (D) Thử đổi month của chi phí cứng thuộc tháng khóa sang tháng mở (phải báo 'không được sửa/xóa chi phí cứng').
--     Đổi <id> là id một dòng fixed_costs thuộc tháng ĐÃ khóa:
-- begin;
--   update public.fixed_costs set month = to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM') where id = <id>;
-- rollback;
--
-- (E) Thử xuất vượt tồn (phải báo 'Xuất kho vượt tồn: ...'). Đổi <item_id>, <project_id>:
-- begin;
--   insert into public.stock_movements (type, item_id, project_id, qty, note)
--     values ('issue', <item_id>, <project_id>, 999999, 'thu chan xuat');
-- rollback;
--
-- (F) Thử thu hồi vượt số đã xuất (phải báo 'Thu hồi vượt số đã xuất: ...'):
-- begin;
--   insert into public.stock_movements (type, item_id, project_id, qty, note)
--     values ('return_good', <item_id>, <project_id>, 999999, 'thu chan thu hoi');
-- rollback;
--
-- (G) Luồng đúng vẫn chạy (phải KHÔNG lỗi): nhập 5, xuất 3, thu hồi 2 tốt + 1 hỏng, trong 1 giao dịch rồi hủy.
-- begin;
--   insert into public.stock_movements (type, item_id, qty, unit_cost, note) values ('purchase', <item_id>, 5, 1000, 'thu');
--   insert into public.stock_movements (type, item_id, project_id, qty, note) values ('issue', <item_id>, <project_id>, 3, 'thu');
--   insert into public.stock_movements (type, item_id, project_id, qty, note) values
--     ('return_good', <item_id>, <project_id>, 2, 'thu'),
--     ('return_damaged', <item_id>, <project_id>, 1, 'thu');
--   -- dòng sau phải lỗi vì đã thu hồi đủ 3 (bỏ comment nếu muốn thử, giao dịch sẽ hủy hết):
--   -- insert into public.stock_movements (type, item_id, project_id, qty, note) values ('return_lost', <item_id>, <project_id>, 1, 'thu');
-- rollback;
--   LƯU Ý: phiếu 'purchase' có unit_cost sẽ cập nhật items.cost (trigger trg_update_item_cost),
--   nhưng rollback hủy cả việc đó.
--
-- (H) created_by bị ép theo người đăng nhập (giả lập phiên bằng request.jwt.claims; <uuid_a> là
--     id một tài khoản trong profiles, <uuid_b> là id tài khoản khác). Phải ra created_by = <uuid_a>:
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid_a>', 'role', 'authenticated')::text, true);
--   insert into public.stock_movements (type, item_id, qty, unit_cost, created_by, note)
--     values ('purchase', <item_id>, 1, 1000, '<uuid_b>', 'thu created_by') returning id, created_by;
-- rollback;
