-- =====================================================================
-- BỔ SUNG DATABASE CHO WEBSITE CHÍNH (dangwed.com) & QUẢN TRỊ WEB
-- Dán vào Supabase > SQL Editor > Run (chạy lại nhiều lần không lỗi)
-- =====================================================================

-- 1. Bảng Cấu hình nội dung Website (chỉ có 1 dòng id = 1)
create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  brand_name text not null default 'Đặng Wedding',
  slogan text not null default 'Là ngày đẹp nhất',
  hero_subtitle text not null default 'Kiến tạo không gian lễ Gia tiên, Mâm quả cưới hỏi & Tiệc cưới tinh tế, chỉn chu trong từng chi tiết.',
  hero_image_url text,
  about_title text not null default 'Gói trọn yêu thương trong từng chi tiết nhỏ',
  about_body text not null default 'Với 3 năm đồng hành cùng hơn 100 lễ cưới trọn vẹn, Đặng Wedding tin rằng mỗi câu chuyện tình yêu đều xứng đáng có một không gian khởi đầu thật đẹp, trang trọng và mang đậm dấu ấn riêng của hai bạn.',
  years_exp text not null default '3+',
  weddings_count text not null default '100+',
  phone text not null default '0918.80.90.96',
  service_area text not null default '',
  address text default '',
  facebook_url text not null default 'https://www.facebook.com/profile.php?id=100035319916172',
  tiktok_url text not null default 'https://www.tiktok.com/@dangweddingg?lang=en',
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- 2. Bảng Yêu cầu tư vấn / Nhận báo giá từ khách hàng trên dangwed.com
create table if not exists public.site_leads (
  id bigint generated always as identity primary key,
  customer_name text not null,
  phone text not null,
  event_date date,
  location text,
  service_interest text,
  selected_template text,
  note text,
  status text not null default 'new' check (status in ('new','contacted','converted','closed')),
  created_at timestamptz not null default now()
);

-- 3. Bật RLS & Phân quyền công khai an toàn cho Website khách hàng
alter table public.site_settings enable row level security;
alter table public.site_leads enable row level security;

-- Ai cũng xem được cấu hình web & bộ sưu tập mẫu set (chỉ xem, không sửa)
drop policy if exists "site_settings_public_read" on public.site_settings;
create policy "site_settings_public_read" on public.site_settings for select using (true);

drop policy if exists "site_settings_admin_write" on public.site_settings;
create policy "site_settings_admin_write" on public.site_settings for all
  using (public.has_role(array['admin','manager']))
  with check (public.has_role(array['admin','manager']));

-- Cho phép khách truy cập web (anon) xem danh sách Mẫu set trang trí (Gia tiên / Mâm quả)
drop policy if exists "set_templates_public_read" on public.set_templates;
create policy "set_templates_public_read" on public.set_templates for select using (true);

-- Khách truy cập web (anon) được gửi form yêu cầu báo giá; chỉ Admin/Manager/Thủ kho xem & xử lý
drop policy if exists "site_leads_public_insert" on public.site_leads;
create policy "site_leads_public_insert" on public.site_leads for insert with check (true);

drop policy if exists "site_leads_staff_select" on public.site_leads;
create policy "site_leads_staff_select" on public.site_leads for select
  using (public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "site_leads_staff_update" on public.site_leads;
create policy "site_leads_staff_update" on public.site_leads for update
  using (public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "site_leads_admin_delete" on public.site_leads;
create policy "site_leads_admin_delete" on public.site_leads for delete
  using (public.has_role(array['admin','manager']));

-- Cấp quyền GRANT cho API anon và authenticated
grant select on public.site_settings, public.set_templates to anon, authenticated;
grant insert on public.site_leads to anon, authenticated;
grant select, update, delete on public.site_settings, public.site_leads to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
