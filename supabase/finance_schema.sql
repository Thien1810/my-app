-- =====================================================================
-- ĐẶNG WEDDING — SCHEMA TÀI CHÍNH QUẢN TRỊ (Phương án A)
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi.
-- Yêu cầu: đã chạy schema.sql (có public.has_role, projects, items, item_stock).
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File chưa được test trên DB thật.
-- =====================================================================

-- ---------- 1. KHO (2 đầu kho) ----------
create table if not exists public.warehouses (
  code text primary key,
  name text not null,
  is_main boolean not null default false,   -- kho chứa toàn bộ tài sản ban đầu
  active boolean not null default true
);
insert into public.warehouses (code, name, is_main) values
  ('xuan_loc', 'Kho Xuân Lộc (Đồng Nai)', true),
  ('vinh_loc', 'Kho Vĩnh Lộc (TP.HCM)', false)
on conflict (code) do nothing;

-- ---------- 2. DỰ ÁN: Nguồn khách + Đầu kho thành cột thật ----------
alter table public.projects add column if not exists lead_source text not null default 'unknown';
alter table public.projects add column if not exists warehouse_code text references public.warehouses(code);

alter table public.projects drop constraint if exists projects_lead_source_check;
alter table public.projects add constraint projects_lead_source_check
  check (lead_source in ('unknown','meta_ads','tiktok_ads','google_seo','referral','partner'));

-- Chuyển dữ liệu cũ từ thẻ [DW_ATTR:...] trong note sang cột: xem supabase/finance_data_migration.sql (BƯỚC 1-3).

-- Ưu đãi (giảm giá cho khách). contract_value = doanh thu thực khách trả (đã trừ ưu đãi);
-- doanh số = contract_value + discount.
alter table public.project_finance add column if not exists discount numeric(14,2) not null default 0;
alter table public.project_finance drop constraint if exists project_finance_discount_check;
alter table public.project_finance add constraint project_finance_discount_check check (discount >= 0);

-- ---------- 3. TẠM ỨNG / TIỀN CỌC (không phải doanh thu) ----------
create table if not exists public.project_advances (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  amount numeric(14,2) not null check (amount <> 0),   -- âm = hoàn tạm ứng
  received_date date not null default current_date,
  kind text not null default 'advance' check (kind in ('advance','refund','forfeit')),
  -- advance: khách đưa | refund: hoàn lại | forfeit: khách hủy, mất cọc -> thu nhập khác
  note text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_project_advances_project on public.project_advances (project_id);
create index if not exists idx_project_advances_date on public.project_advances (received_date);

-- ---------- 4. SỔ CHI PHÍ CỨNG HÀNG THÁNG ----------
create table if not exists public.fixed_costs (
  id bigint generated always as identity primary key,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- 'YYYY-MM'
  category text not null,
  title text not null,
  warehouse_code text references public.warehouses(code),
  -- null = chi phí chung -> chia theo tỷ trọng giá trị tài sản mỗi kho (xem view bên dưới)
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_fixed_costs_month on public.fixed_costs (month);

create table if not exists public.fixed_cost_templates (
  id bigint generated always as identity primary key,
  category text not null,
  title text not null,
  warehouse_code text references public.warehouses(code),
  amount numeric(14,2) not null check (amount > 0),
  sort_order int not null default 0
);

-- ---------- 5. SỔ CHI PHÍ ADS ----------
create table if not exists public.ads_spend (
  id bigint generated always as identity primary key,
  spend_date date not null,
  -- extract/lpad là immutable; to_char(date) không dùng được trong cột generated (lỗi 42P17)
  month text generated always as (
    lpad(extract(year from spend_date)::int::text, 4, '0') || '-' || lpad(extract(month from spend_date)::int::text, 2, '0')
  ) stored,
  channel text not null check (channel in ('meta','tiktok','google','other')),
  source text not null default 'manual' check (source in ('meta_api','manual','legacy')),
  warehouse_code text references public.warehouses(code),
  campaign_name text,
  adset_name text,
  ad_name text,
  external_id text,                 -- ad_id/adset_id từ Meta, để upsert không trùng
  spend numeric(14,2) not null check (spend >= 0),
  messages int not null default 0,
  leads int not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  note text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
drop index if exists public.uq_ads_spend_external;
-- Không dùng chỉ mục một phần (where ...): upsert onConflict của PostgREST không khớp được. external_id NULL không bao giờ trùng nhau nên vẫn đúng.
create unique index uq_ads_spend_external
  on public.ads_spend (channel, external_id, spend_date);
create index if not exists idx_ads_spend_month on public.ads_spend (month);

-- ---------- 6. CHUYỂN KHO TÀI SẢN (căn cứ chia chi phí cứng) ----------
create table if not exists public.stock_transfers (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.items(id),
  from_wh text not null references public.warehouses(code),
  to_wh text not null references public.warehouses(code),
  qty numeric(14,2) not null check (qty > 0),
  transferred_at date not null default current_date,
  note text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check (from_wh <> to_wh)
);
create index if not exists idx_stock_transfers_item on public.stock_transfers (item_id);
-- TODO: chưa kiểm tra qty chuyển có vượt tồn kho của kho nguồn (from_wh) hay không; hiện chỉ check qty > 0 và from_wh <> to_wh.

-- Giá trị tài sản tái sử dụng hiện đang đặt ở mỗi kho.
-- Giả định: toàn bộ tài sản ban đầu nằm ở kho is_main, sau đó cộng/trừ theo phiếu chuyển kho.
create or replace view public.warehouse_asset_value with (security_invoker = on) as
with owned as (
  select id as item_id, cost,
         greatest(coalesce(in_stock,0),0) + greatest(coalesce(at_project,0),0)
           + greatest(coalesce(in_repair,0),0) as qty
  from public.item_stock
  where kind = 'reusable' and active
),
moved as (
  select item_id, to_wh as wh, qty from public.stock_transfers
  union all
  select item_id, from_wh as wh, -qty from public.stock_transfers
)
select w.code, w.name,
  (case when w.is_main then (select coalesce(sum(qty * cost), 0) from owned) else 0 end)
  + coalesce((select sum(m.qty * o.cost) from moved m join owned o on o.item_id = m.item_id
              where m.wh = w.code), 0) as asset_value
from public.warehouses w
where w.active;

-- Tỷ trọng chia chi phí cứng chung. Nếu chưa có giá trị tài sản -> chia đều.
create or replace view public.warehouse_share with (security_invoker = on) as
select code, name, asset_value,
  case when sum(asset_value) over () > 0
       then asset_value / sum(asset_value) over ()
       else 1.0 / count(*) over () end as share
from public.warehouse_asset_value;

-- ---------- 7. KHÓA SỔ THÁNG ----------
create table if not exists public.month_locks (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  locked_at timestamptz not null default now(),
  locked_by uuid default auth.uid() references public.profiles(id),
  share_snapshot jsonb,   -- lưu tỷ trọng kho lúc khóa, để tháng cũ không nhảy số
  note text
);

create or replace function public.is_month_locked(m text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.month_locks where month = m)
$$;

-- Chặn sửa sổ chi phí cứng / ads của tháng đã khóa (admin mở khóa bằng hàm unlock_month trong month_lock_controls.sql, có ghi lý do)
create or replace function public.guard_locked_month() returns trigger
language plpgsql as $$
declare m text;
begin
  m := case when tg_op = 'DELETE' then old.month else new.month end;
  if public.is_month_locked(m) then
    raise exception 'Tháng % đã khóa sổ, không được sửa.', m;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_fixed_costs_lock on public.fixed_costs;
create trigger trg_fixed_costs_lock before insert or update or delete on public.fixed_costs
  for each row execute function public.guard_locked_month();
drop trigger if exists trg_ads_spend_lock on public.ads_spend;
create trigger trg_ads_spend_lock before insert or update or delete on public.ads_spend
  for each row execute function public.guard_locked_month();

-- ---------- 8. CHẶN GHI "CHI PHÍ ADS" VÀO CHI PHÍ KHÁC CỦA DỰ ÁN (tránh trừ 2 lần) ----------
create or replace function public.block_ads_in_project_costs() returns trigger
language plpgsql as $$
begin
  -- 'ads' chỉ khớp khi là từ riêng (không có chữ cái liền trước/sau); [[:alpha:]] gồm cả chữ có dấu.
  -- Ví dụ (kiểm tra bằng mắt, chưa chạy trên DB):
  --   CHẶN:        'Chi phí Ads', 'Ads Facebook', 'Quảng cáo', 'quang cao', 'Marketing'
  --   KHÔNG CHẶN:  'Thuê pads/loa', 'Nhân công'
  if lower(new.kind) ~ '(^|[^[:alpha:]])ads($|[^[:alpha:]])|quảng cáo|quang cao|marketing' then
    raise exception 'Chi phí Ads ghi ở Sổ Ads (Báo cáo > P&L), không ghi vào Chi phí khác của dự án.';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_ads_project_costs on public.project_costs;
create trigger trg_block_ads_project_costs before insert or update on public.project_costs
  for each row execute function public.block_ads_in_project_costs();

-- Di chuyển dữ liệu Ads cũ (project_costs -> ads_spend): xem supabase/finance_data_migration.sql (BƯỚC 4-5).

-- ---------- 9. PHÂN QUYỀN (RLS) ----------
alter table public.warehouses            enable row level security;
alter table public.project_advances      enable row level security;
alter table public.fixed_costs           enable row level security;
alter table public.fixed_cost_templates  enable row level security;
alter table public.ads_spend             enable row level security;
alter table public.stock_transfers       enable row level security;
alter table public.month_locks           enable row level security;

-- Kho: ai đã duyệt xem được; admin/manager sửa
drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select
  using (public.has_role(array['admin','manager','storekeeper','staff']));
drop policy if exists "warehouses_write" on public.warehouses;
create policy "warehouses_write" on public.warehouses for all
  using (public.has_role(array['admin','manager'])) with check (public.has_role(array['admin','manager']));

-- Tài chính: CHỈ admin + manager
do $$
declare t text;
begin
  foreach t in array array['project_advances','fixed_costs','fixed_cost_templates','ads_spend'] loop
    execute format('drop policy if exists "%1$s_all" on public.%1$s', t);
    execute format('create policy "%1$s_all" on public.%1$s for all using (public.has_role(array[''admin'',''manager''])) with check (public.has_role(array[''admin'',''manager'']))', t);
  end loop;
end $$;

-- month_locks KHÔNG dùng policy "for all": chỉ select + insert (admin/manager); không ai sửa/xóa trực tiếp.
-- Quyền mở khóa chỉ qua hàm unlock_month trong month_lock_controls.sql.
-- Giống hệt policy trong month_lock_controls.sql (drop + create nên chạy hai file theo thứ tự nào cũng không xung đột).
drop policy if exists "month_locks_all" on public.month_locks;
drop policy if exists "month_locks_select" on public.month_locks;
drop policy if exists "month_locks_insert" on public.month_locks;
create policy "month_locks_select" on public.month_locks for select
  using (public.has_role(array['admin','manager']));
create policy "month_locks_insert" on public.month_locks for insert
  with check (public.has_role(array['admin','manager']));

-- Chuyển kho: thủ kho cũng được ghi (đây là nghiệp vụ kho), nhưng không xóa
drop policy if exists "stock_transfers_select" on public.stock_transfers;
create policy "stock_transfers_select" on public.stock_transfers for select
  using (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists "stock_transfers_insert" on public.stock_transfers;
create policy "stock_transfers_insert" on public.stock_transfers for insert
  with check (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists "stock_transfers_delete" on public.stock_transfers;
create policy "stock_transfers_delete" on public.stock_transfers for delete
  using (public.has_role(array['admin','manager']));

grant select, insert, update, delete on
  public.warehouses, public.project_advances, public.fixed_costs, public.fixed_cost_templates,
  public.ads_spend, public.stock_transfers to authenticated;
-- month_locks: chỉ select + insert; quyền mở khóa chỉ qua hàm unlock_month trong month_lock_controls.sql
grant select, insert on public.month_locks to authenticated;
grant select on public.warehouse_asset_value, public.warehouse_share to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_month_locked(text) to authenticated;
