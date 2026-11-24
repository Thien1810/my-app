-- =====================================================================
-- ĐẶNG WEDDING — CHẶN Ở DB CHO SỔ KHO VÀ CHUYỂN KHO (khớp quy tắc giao diện)
-- Mục đích: giao diện đã chặn (movementRules.js, stockTransfers.js) nhưng ai gọi thẳng API
--           vẫn lách được; file này đặt thêm trigger để DB tự từ chối:
--   a) INSERT stock_movements: điều chỉnh giảm vượt tồn; sửa xong / thanh lý vượt số chờ sửa.
--   b) DELETE stock_movements: xóa phiếu làm tồn / số ở dự án / số chờ sửa âm (canDeleteMovement);
--      kiểm theo CÂU LỆNH (transition table) trên số dư CUỐI CÙNG sau khi xóa.
--   b2) UPDATE stock_movements: chặn sửa loại phiếu, vật tư, số lượng (phải xóa rồi ghi lại).
--   c) INSERT stock_transfers: chuyển vượt số đang có ở kho đi; ghi vào tháng đã khóa sổ.
--   d) DELETE stock_transfers: xóa phiếu ở tháng đã khóa; xóa làm số ở kho đến âm.
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent).
-- Yêu cầu: đã chạy schema.sql (stock_movements, items, view item_stock) và finance_schema.sql
--          (warehouses, stock_transfers, month_locks, is_month_locked).
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File CHƯA được test trên DB thật.
-- TRƯỚC KHI CÀI: chạy câu kiểm tra "TRƯỚC KHI CÀI" ở cuối file (mục 5) để xem vật tư nào đang âm.
-- Guard áp cho MỌI đường ghi, kể cả SQL Editor / import hàng loạt: import phải đúng thứ tự
-- (nhập mua trước, điều chỉnh âm / sửa xong / thanh lý sau), nếu không sẽ bị từ chối.
--
-- LƯU Ý / GIỚI HẠN ĐÃ BIẾT:
--  * KHÔNG chặn phiếu 'issue' (xuất dự án) và các loại phiếu khác khi INSERT (giữ luồng hiện tại).
--  * Mỗi trigger khóa dòng vật tư (select ... for no key update) để 2 phiếu cùng lúc không cùng
--    "thấy" một mức tồn rồi cùng qua. Khóa chỉ giữ tới hết giao dịch nên rất ngắn.
--  * Trigger DELETE chạy theo CÂU LỆNH và kiểm số dư CUỐI CÙNG: xóa nhiều dòng một lúc chỉ bị chặn
--    nếu kết quả cuối làm âm; xóa toàn bộ lịch sử một vật tư (số dư về 0) thì qua.
--    Xóa dây chuyền (cascade) cũng được kiểm; dự án có phiếu kho đã bị trigger riêng chặn xóa
--    (projects_archive_schema.sql).
--  * Vật tư đang âm sẵn từ trước sẽ không xóa được phiếu nhập cho tới khi điều chỉnh lại.
--  * stock_transfers không có policy UPDATE nên không cần trigger UPDATE; nếu sau này mở
--    UPDATE thì phải thêm trigger tương tự.
--  * Phiếu chuyển kho chỉ chấp nhận vật tư TÁI SỬ DỤNG đang hoạt động (view
--    warehouse_asset_value bỏ qua các vật tư khác nên chuyển kho chúng không có ý nghĩa).
--  * Số "đang có ở kho đi" tính đúng công thức view warehouse_asset_value / calcWarehouseHoldings:
--    kho is_main = tổng sở hữu (max(0,in_stock)+max(0,at_project)+max(0,in_repair)) + phiếu chuyển vào - chuyển ra;
--    kho khác = chỉ phiếu chuyển vào - chuyển ra.
-- =====================================================================

-- ---------- 0. HÀM PHỤ (chỉ dùng nội bộ trong trigger) ----------
-- Tồn của 1 vật tư theo CÙNG công thức view item_stock (tính trực tiếp từ sổ kho).
create or replace function public.item_balance(
  p_item bigint,
  out o_in_stock numeric,
  out o_in_repair numeric,
  out o_at_project numeric,
  out o_kind text,
  out o_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(case
      when m.type in ('purchase','return_good','repair_done','adjust') then m.qty
      when m.type = 'issue' then -m.qty else 0 end), 0),
    coalesce(sum(case
      when m.type = 'return_damaged' then m.qty
      when m.type in ('repair_done','dispose') then -m.qty else 0 end), 0),
    case when i.kind = 'reusable' then coalesce(sum(case
      when m.type = 'issue' then m.qty
      when m.type in ('return_good','return_damaged','return_lost') then -m.qty else 0 end), 0)
      else 0 end,
    i.kind,
    i.name
  from public.items i
  left join public.stock_movements m on m.item_id = i.id
  where i.id = p_item
  group by i.id
$$;

-- Số lượng 1 vật tư đang có ở 1 kho (quy ước warehouse_asset_value / calcWarehouseHoldings).
-- Gọi trong trigger khi row đang xét: INSERT thì dòng chưa có trong bảng; DELETE thì dòng còn trong bảng.
create or replace function public.wh_holding(p_item bigint, p_wh text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select
    (case when coalesce((select w.is_main from public.warehouses w where w.code = p_wh), false)
          then coalesce((select greatest(coalesce(s.in_stock,0),0) + greatest(coalesce(s.at_project,0),0)
                                + greatest(coalesce(s.in_repair,0),0)
                         from public.item_stock s where s.id = p_item), 0)
          else 0 end)
    + coalesce((select sum(t.qty) from public.stock_transfers t where t.item_id = p_item and t.to_wh = p_wh), 0)
    - coalesce((select sum(t.qty) from public.stock_transfers t where t.item_id = p_item and t.from_wh = p_wh), 0)
$$;

revoke execute on function public.item_balance(bigint) from public, anon, authenticated;
revoke execute on function public.wh_holding(bigint, text) from public, anon, authenticated;

-- ---------- 1. (a) CHẶN KHI GHI PHIẾU SỔ KHO ----------
create or replace function public.guard_stock_movement_insert() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  if new.type = 'adjust' and new.qty < 0 then
    perform 1 from public.items where id = new.item_id for no key update;  -- tuần tự hóa theo vật tư
    select * into b from public.item_balance(new.item_id);
    if -new.qty > coalesce(b.o_in_stock, 0) then
      raise exception 'Điều chỉnh giảm vượt quá tồn trong kho hiện có.';
    end if;
  elsif new.type in ('repair_done', 'dispose') then
    perform 1 from public.items where id = new.item_id for no key update;
    select * into b from public.item_balance(new.item_id);
    if new.qty > coalesce(b.o_in_repair, 0) then
      raise exception 'Số lượng vượt quá số đang chờ sửa.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_stock_movement_insert on public.stock_movements;
create trigger trg_guard_stock_movement_insert before insert on public.stock_movements
  for each row execute function public.guard_stock_movement_insert();

-- ---------- 2. (b) CHẶN XÓA PHIẾU SỔ KHO LÀM TỒN ÂM (như canDeleteMovement) ----------
-- Bỏ trigger theo từng dòng cũ (nếu đã cài trước đây)
drop trigger if exists trg_guard_stock_movement_delete on public.stock_movements;
drop function if exists public.guard_stock_movement_delete();

-- Trigger theo CÂU LỆNH + transition table: xóa xong mới kiểm số dư CUỐI CÙNG.
create or replace function public.guard_stock_movement_delete_stmt() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  b record;
  v_name text;
begin
  for r in
    select o.item_id,
           sum(case when o.type in ('purchase','return_good','repair_done','adjust') then o.qty
                    when o.type = 'issue' then -o.qty else 0 end) as d_stock,
           sum(case when o.type = 'return_damaged' then o.qty
                    when o.type in ('repair_done','dispose') then -o.qty else 0 end) as d_repair,
           sum(case when o.type = 'issue' then o.qty
                    when o.type in ('return_good','return_damaged','return_lost') then -o.qty else 0 end) as d_project
      from old_rows o
     group by o.item_id
     order by o.item_id  -- thứ tự cố định để tránh deadlock
  loop
    perform 1 from public.items where id = r.item_id for no key update;
    select * into b from public.item_balance(r.item_id);  -- số dư SAU khi xóa
    v_name := case when b.o_name is not null then '"' || b.o_name || '"' else 'vật tư này' end;

    if r.d_stock > 0 and coalesce(b.o_in_stock, 0) < 0 then
      raise exception 'Không xóa được: xóa phiếu sẽ làm tồn trong kho của % âm (sau khi xóa còn %).',
        v_name, trim_scale(coalesce(b.o_in_stock, 0))::text;
    end if;
    if r.d_repair > 0 and coalesce(b.o_in_repair, 0) < 0 then
      raise exception 'Không xóa được: xóa phiếu sẽ làm số chờ sửa của % âm (sau khi xóa còn %).',
        v_name, trim_scale(coalesce(b.o_in_repair, 0))::text;
    end if;
    -- Vật tư tiêu hao luôn có số ở dự án = 0 nên tự bỏ qua
    if r.d_project > 0 and coalesce(b.o_at_project, 0) < 0 then
      raise exception 'Không xóa được: xóa phiếu sẽ làm số đang ở dự án của % âm (sau khi xóa còn %).',
        v_name, trim_scale(coalesce(b.o_at_project, 0))::text;
    end if;
  end loop;

  return null;
end $$;

drop trigger if exists trg_guard_stock_movement_delete_stmt on public.stock_movements;
create trigger trg_guard_stock_movement_delete_stmt after delete on public.stock_movements
  referencing old table as old_rows
  for each statement execute function public.guard_stock_movement_delete_stmt();

-- ---------- 2b. CHẶN SỬA LÕI PHIẾU KHO (loại phiếu, vật tư, số lượng) ----------
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

drop trigger if exists trg_block_stock_movement_core_update on public.stock_movements;
create trigger trg_block_stock_movement_core_update before update of type, qty, item_id on public.stock_movements
  for each row execute function public.block_stock_movement_core_update();

-- ---------- 3. (c) CHẶN KHI GHI PHIẾU CHUYỂN KHO ----------
create or replace function public.guard_stock_transfer_insert() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month text;
  v_kind text;
  v_active boolean;
  v_have numeric;
begin
  v_month := to_char(new.transferred_at, 'YYYY-MM');
  if public.is_month_locked(v_month) then
    raise exception 'Tháng % đã khóa sổ, không ghi phiếu chuyển kho được.', v_month;
  end if;

  -- Khóa dòng vật tư để 2 phiếu cùng lúc không cùng qua
  select i.kind, i.active into v_kind, v_active from public.items i where i.id = new.item_id for no key update;
  if v_kind is distinct from 'reusable' or v_active is not true then
    raise exception 'Chỉ chuyển kho được vật tư tái sử dụng đang hoạt động.';
  end if;

  -- Kho đi và kho đến phải đang hoạt động
  if not coalesce((select w.active from public.warehouses w where w.code = new.from_wh), false)
     or not coalesce((select w.active from public.warehouses w where w.code = new.to_wh), false) then
    raise exception 'Kho đi hoặc kho đến đã ngừng hoạt động.';
  end if;

  v_have := public.wh_holding(new.item_id, new.from_wh);
  if new.qty > v_have then
    raise exception 'Số lượng chuyển (%) vượt quá số đang có ở kho đi (%).',
      trim_scale(new.qty)::text, trim_scale(greatest(v_have, 0))::text;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_stock_transfer_insert on public.stock_transfers;
create trigger trg_guard_stock_transfer_insert before insert on public.stock_transfers
  for each row execute function public.guard_stock_transfer_insert();

-- ---------- 4. (d) CHẶN XÓA PHIẾU CHUYỂN KHO ----------
create or replace function public.guard_stock_transfer_delete() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month text;
  v_have numeric;
begin
  v_month := to_char(old.transferred_at, 'YYYY-MM');
  if public.is_month_locked(v_month) then
    raise exception 'Tháng % đã khóa sổ, không xóa được phiếu chuyển kho.', v_month;
  end if;

  perform 1 from public.items where id = old.item_id for no key update;

  -- Dòng old vẫn còn trong bảng nên số ở kho đến đang đã gồm old.qty
  v_have := public.wh_holding(old.item_id, old.to_wh);
  if v_have - old.qty < 0 then
    raise exception 'Không xóa được: xóa phiếu chuyển kho này sẽ làm số vật tư ở kho đến âm (đang có %, phiếu %).',
      trim_scale(v_have)::text, trim_scale(old.qty)::text;
  end if;

  return old;
end $$;

drop trigger if exists trg_guard_stock_transfer_delete on public.stock_transfers;
create trigger trg_guard_stock_transfer_delete before delete on public.stock_transfers
  for each row execute function public.guard_stock_transfer_delete();

-- ---------- 5. CÂU KIỂM TRA (bỏ comment từng câu để chạy) ----------
-- TRƯỚC KHI CÀI (chạy trước khi Run file này): liệt kê vật tư đang có số âm.
--   Nếu có dòng nào, vật tư đó sẽ không xóa được phiếu nhập cho tới khi điều chỉnh.
-- select id, name, kind, in_stock, at_project, in_repair from public.item_stock
--  where in_stock < 0 or at_project < 0 or in_repair < 0;
-- (a) 5 trigger tồn tại (phải ra 5 dòng):
-- select tgrelid::regclass as bang, tgname from pg_trigger
--  where not tgisinternal and tgname in (
--    'trg_guard_stock_movement_insert', 'trg_guard_stock_movement_delete_stmt',
--    'trg_block_stock_movement_core_update',
--    'trg_guard_stock_transfer_insert', 'trg_guard_stock_transfer_delete')
--  order by 1, 2;
-- (b) 7 hàm tồn tại (phải ra 7 dòng) và hàm xóa theo dòng cũ không còn:
-- select proname from pg_proc
--  where pronamespace = 'public'::regnamespace and proname in (
--    'item_balance', 'wh_holding', 'guard_stock_movement_insert', 'guard_stock_movement_delete_stmt',
--    'block_stock_movement_core_update', 'guard_stock_transfer_insert', 'guard_stock_transfer_delete');
-- (c) so khớp tồn tính bằng hàm với view item_stock trên MỌI vật tư (phải ra 0 dòng):
-- select s.id, s.name from public.item_stock s, lateral public.item_balance(s.id) b
--  where b.o_in_stock <> s.in_stock or b.o_in_repair <> s.in_repair or b.o_at_project <> s.at_project;
-- (d) thử chặn trong giao dịch rồi hủy (phải báo 'Số lượng chuyển (1) vượt quá số đang có ở kho đi (0).'):
--     đổi <item_id> là id vật tư tái sử dụng; kho đi 'vinh_loc' chưa có hàng thì 1 đơn vị đã bị chặn.
-- begin;
--   insert into public.stock_transfers (item_id, from_wh, to_wh, qty) values (<item_id>, 'vinh_loc', 'xuan_loc', 1);
-- rollback;
-- (e) thử chặn điều chỉnh giảm quá tồn (phải báo 'Điều chỉnh giảm vượt quá tồn trong kho hiện có.'):
-- begin;
--   insert into public.stock_movements (type, item_id, qty, note) values ('adjust', <item_id>, -999999, 'thu chan');
-- rollback;
