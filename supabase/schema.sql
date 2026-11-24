-- =====================================================================
-- APP THỐNG KÊ HÀNG HÓA - NGÀNH TRANG TRÍ (Phương án C+)
-- Dán toàn bộ file này vào Supabase > SQL Editor > New query > Run
-- File này có thể chạy lại nhiều lần mà không bị lỗi trùng (idempotent).
-- =====================================================================

-- ---------- 1. NGƯỜI DÙNG & VAI TRÒ ----------
-- pending = chờ duyệt (chưa có quyền), admin = Quản trị, manager = Quản lý,
-- storekeeper = Thủ kho, staff = Nhân viên thi công
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'pending'
    check (role in ('pending','admin','manager','storekeeper','staff')),
  created_at timestamptz not null default now()
);

-- Tự tạo hồ sơ khi có người đăng ký. Người đầu tiên = Quản trị.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = any(roles) from public.profiles where id = auth.uid()), false)
$$;

-- ---------- 2. DANH MỤC ----------
create table if not exists public.partners (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('supplier','customer')),
  name text not null,
  phone text,
  address text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id bigint generated always as identity primary key,
  code text unique,
  name text not null,
  category text,
  color text,
  kind text not null check (kind in ('consumable','reusable')), -- Tiêu hao / Tái sử dụng
  unit text not null default 'cái',
  cost numeric(14,2) not null default 0,          -- Giá nhập gần nhất
  min_stock numeric(14,2) not null default 0,     -- Tồn tối thiểu
  expected_uses int check (expected_uses > 0),    -- Số lần dùng dự kiến (đồ tái sử dụng)
  image_url text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.items add column if not exists color text;

-- ---------- 3. DỰ ÁN ----------
create table if not exists public.projects (
  id bigint generated always as identity primary key,
  code text unique,
  name text not null,
  customer_id bigint references public.partners(id),
  location text,
  start_date date,      -- Ngày thi công
  end_date date,        -- Ngày tháo dỡ / thu hồi dự kiến
  lead_id uuid references public.profiles(id),
  status text not null default 'quote'
    check (status in ('quote','preparing','in_progress','awaiting_return','done','cancelled')),
  note text,
  created_at timestamptz not null default now()
);

-- Thông tin tài chính tách riêng để Thủ kho / Nhân viên không xem được
create table if not exists public.project_finance (
  project_id bigint primary key references public.projects(id) on delete cascade,
  contract_value numeric(14,2) not null default 0
);

create table if not exists public.project_members (
  project_id bigint references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);

-- Kế hoạch vật tư (giữ chỗ) - dùng để cảnh báo thiếu đồ khi trùng lịch
create table if not exists public.project_plan (
  project_id bigint references public.projects(id) on delete cascade,
  item_id bigint references public.items(id),
  qty numeric(14,2) not null check (qty > 0),
  primary key (project_id, item_id)
);

create table if not exists public.project_costs (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  kind text not null,   -- nhân công, vận chuyển, thuê ngoài...
  amount numeric(14,2) not null,
  cost_date date not null default current_date,
  note text
);

-- ---------- 4. MẪU SET TRANG TRÍ ----------
create table if not exists public.set_templates (
  id bigint generated always as identity primary key,
  name text not null,
  category text default 'Gia tiên',
  image_url text,
  note text
);
alter table public.set_templates add column if not exists category text default 'Gia tiên';
alter table public.set_templates add column if not exists image_url text;

create table if not exists public.set_template_items (
  template_id bigint references public.set_templates(id) on delete cascade,
  item_id bigint references public.items(id),
  qty numeric(14,2) not null check (qty > 0),
  primary key (template_id, item_id)
);

-- ---------- 5. SỔ KHO (mọi phiếu nhập / xuất / thu hồi) ----------
create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  moved_at date not null default current_date,
  type text not null check (type in
    ('purchase','issue','return_good','return_damaged','return_lost','repair_done','dispose','adjust')),
  item_id bigint not null references public.items(id),
  project_id bigint references public.projects(id),
  partner_id bigint references public.partners(id),
  qty numeric(14,2) not null check (qty <> 0),
  unit_cost numeric(14,2),
  note text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check (type = 'adjust' or qty > 0),
  check (type not in ('issue','return_good','return_damaged','return_lost') or project_id is not null)
);
create index if not exists idx_stock_movements_item on public.stock_movements (item_id);
create index if not exists idx_stock_movements_project on public.stock_movements (project_id);
create index if not exists idx_stock_movements_date on public.stock_movements (moved_at);

-- Cập nhật giá nhập gần nhất khi nhập mua
create or replace function public.update_item_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'purchase' and new.unit_cost is not null then
    update public.items set cost = new.unit_cost where id = new.item_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_update_item_cost on public.stock_movements;
create trigger trg_update_item_cost after insert on public.stock_movements
  for each row execute function public.update_item_cost();

-- ---------- 6. VIEW TỒN KHO ----------
create or replace view public.item_stock with (security_invoker = on) as
select
  i.*,
  coalesce(sum(case
    when m.type in ('purchase','return_good','repair_done','adjust') then m.qty
    when m.type = 'issue' then -m.qty else 0 end), 0) as in_stock,          -- Trong kho
  case when i.kind = 'reusable' then coalesce(sum(case
    when m.type = 'issue' then m.qty
    when m.type in ('return_good','return_damaged','return_lost') then -m.qty else 0 end), 0)
    else 0 end as at_project,                                               -- Đang ở dự án
  coalesce(sum(case
    when m.type = 'return_damaged' then m.qty
    when m.type in ('repair_done','dispose') then -m.qty else 0 end), 0) as in_repair, -- Chờ sửa
  coalesce(sum(case when m.type = 'return_lost' then m.qty else 0 end), 0) as lost_total
from public.items i
left join public.stock_movements m on m.item_id = i.id
group by i.id;

-- ---------- 7. PHÂN QUYỀN (Row Level Security) ----------
alter table public.profiles           enable row level security;
alter table public.partners           enable row level security;
alter table public.items              enable row level security;
alter table public.projects           enable row level security;
alter table public.project_finance    enable row level security;
alter table public.project_members    enable row level security;
alter table public.project_plan       enable row level security;
alter table public.project_costs      enable row level security;
alter table public.set_templates      enable row level security;
alter table public.set_template_items enable row level security;
alter table public.stock_movements    enable row level security;

-- Hồ sơ: ai cũng xem được hồ sơ của mình; người có quyền xem tất cả; chỉ Quản trị đổi vai trò
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.has_role(array['admin','manager','storekeeper','staff']));

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles for delete
  using (public.has_role(array['admin']));

-- Danh mục (vật tư, đối tác, mẫu set): mọi người đã duyệt được xem; Quản trị/Quản lý/Thủ kho được sửa
do $$
declare t text;
begin
  foreach t in array array['items','partners','set_templates','set_template_items'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s', t);
    execute format('create policy "%1$s_select" on public.%1$s for select using (public.has_role(array[''admin'',''manager'',''storekeeper'',''staff'']))', t);
    execute format('create policy "%1$s_insert" on public.%1$s for insert with check (public.has_role(array[''admin'',''manager'',''storekeeper'']))', t);
    execute format('create policy "%1$s_update" on public.%1$s for update using (public.has_role(array[''admin'',''manager'',''storekeeper'']))', t);
    execute format('create policy "%1$s_delete" on public.%1$s for delete using (public.has_role(array[''admin'',''manager'']))', t);
  end loop;
end $$;

-- Dự án: Quản trị/Quản lý/Thủ kho xem tất cả; Nhân viên chỉ xem dự án mình tham gia
create or replace function public.can_see_project(pid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin','manager','storekeeper'])
      or (public.has_role(array['staff']) and (
            exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid())
         or exists (select 1 from public.projects where id = pid and lead_id = auth.uid())))
$$;

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select using (public.can_see_project(id));
drop policy if exists "projects_write" on public.projects;
create policy "projects_write"  on public.projects for insert with check (public.has_role(array['admin','manager']));
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update using (public.has_role(array['admin','manager']));
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete using (public.has_role(array['admin']));

drop policy if exists "members_select" on public.project_members;
create policy "members_select" on public.project_members for select using (public.can_see_project(project_id));
drop policy if exists "members_write" on public.project_members;
create policy "members_write"  on public.project_members for all
  using (public.has_role(array['admin','manager'])) with check (public.has_role(array['admin','manager']));

drop policy if exists "plan_select" on public.project_plan;
create policy "plan_select" on public.project_plan for select using (public.can_see_project(project_id));
drop policy if exists "plan_write" on public.project_plan;
create policy "plan_write"  on public.project_plan for all
  using (public.has_role(array['admin','manager','storekeeper']))
  with check (public.has_role(array['admin','manager','storekeeper']));

-- Tài chính dự án: Giá trị hợp đồng cho Quản trị/Quản lý/Thủ kho (để gửi báo giá); Chi phí khác chỉ Quản trị/Quản lý
drop policy if exists "finance_all" on public.project_finance;
create policy "finance_all" on public.project_finance for all
  using (public.has_role(array['admin','manager','storekeeper']))
  with check (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists "costs_all" on public.project_costs;
create policy "costs_all" on public.project_costs for all
  using (public.has_role(array['admin','manager'])) with check (public.has_role(array['admin','manager']));

-- Sổ kho: mọi người đã duyệt xem được (nhân viên chỉ thấy phiếu của dự án mình + phiếu không gắn dự án)
drop policy if exists "moves_select" on public.stock_movements;
create policy "moves_select" on public.stock_movements for select
  using (public.has_role(array['admin','manager','storekeeper'])
         or (public.has_role(array['staff']) and (project_id is null or public.can_see_project(project_id))));
-- Quản trị/Quản lý/Thủ kho tạo mọi phiếu; Nhân viên chỉ được xác nhận thu hồi cho dự án mình
drop policy if exists "moves_insert" on public.stock_movements;
create policy "moves_insert" on public.stock_movements for insert
  with check (public.has_role(array['admin','manager','storekeeper'])
     or (public.has_role(array['staff'])
         and type in ('return_good','return_damaged','return_lost')
         and public.can_see_project(project_id)));
drop policy if exists "moves_update" on public.stock_movements;
create policy "moves_update" on public.stock_movements for update using (public.has_role(array['admin','manager']));
drop policy if exists "moves_delete" on public.stock_movements;
create policy "moves_delete" on public.stock_movements for delete using (public.has_role(array['admin','manager']));

-- ---------- 8. CẤP QUYỀN TRUY CẬP BẢNG CHO SUPABASE API ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- !!! CẢNH BÁO AN TOÀN !!!
-- Trước đây ở đây có câu lệnh đặt MỌI tài khoản trong auth.users thành 'admin'
-- (insert ... 'admin' from auth.users on conflict do update set role='admin').
-- Đã GỠ BỎ: chạy lại file này sẽ nâng toàn bộ tài khoản (kể cả nhân viên, thủ kho)
-- lên admin. KHÔNG thêm lại câu lệnh đó.
-- Tài khoản mới được tạo hồ sơ 'pending' bởi trigger; admin duyệt ở menu Người dùng.
--
-- Chỉ khi hệ thống CHƯA có admin nào, tạo admin đầu tiên bằng tay (chạy 1 lần
-- trong SQL Editor, thay email của bạn, rồi để nguyên dạng comment trong file):
--   update public.profiles set role = 'admin' where email = 'email-cua-ban@example.com';
--   -- nếu chưa có dòng profiles cho tài khoản đó:
--   -- insert into public.profiles (id, email, full_name, role)
--   -- select id, email, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 'admin'
--   -- from auth.users where email = 'email-cua-ban@example.com'
--   -- on conflict (id) do update set role = 'admin';

-- Hàm hỗ trợ Quản trị xóa hoàn toàn tài khoản người dùng (cả trong profiles và auth.users)
create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']) then
    raise exception 'Chỉ Quản trị viên mới có quyền xóa người dùng.';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Không thể tự xóa tài khoản của chính mình.';
  end if;
  delete from public.project_members where user_id = target_user_id;
  update public.projects set lead_id = null where lead_id = target_user_id;
  update public.stock_movements set created_by = null where created_by = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;
