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

-- 3. Bảng Thư viện ảnh các đám đã làm thực tế (hiển thị chung trong mục Thư viện trên dangwed.com)
create table if not exists public.site_gallery (
  id bigint generated always as identity primary key,
  title text not null,
  category text not null default 'Gia tiên',
  image_url text not null,
  description text default '',
  event_date date,
  is_featured boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 4. Bảng Bài viết Cẩm nang cưới & SEO (hiển thị trên dangwed.com)
create table if not exists public.site_posts (
  id bigint generated always as identity primary key,
  title text not null,
  slug text not null unique,
  category text not null default 'Kinh nghiệm cưới',
  excerpt text default '',
  content text not null,
  cover_image_url text default '',
  seo_keywords text default '',
  is_published boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 5. Bật RLS & Phân quyền công khai an toàn cho Website khách hàng
alter table public.site_settings enable row level security;
alter table public.site_leads enable row level security;
alter table public.site_gallery enable row level security;
alter table public.site_posts enable row level security;

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

-- Thư viện ảnh đám thực tế: khách xem ảnh đang bật hiển thị; Admin/Manager/Thủ kho thêm/sửa/xóa
drop policy if exists "site_gallery_public_read" on public.site_gallery;
create policy "site_gallery_public_read" on public.site_gallery for select
  using (is_featured = true or public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "site_gallery_staff_write" on public.site_gallery;
create policy "site_gallery_staff_write" on public.site_gallery for all
  using (public.has_role(array['admin','manager','storekeeper']))
  with check (public.has_role(array['admin','manager','storekeeper']));

-- Bài viết SEO: khách đọc bài đã xuất bản; Admin/Manager/Thủ kho đăng/sửa/xóa
drop policy if exists "site_posts_public_read" on public.site_posts;
create policy "site_posts_public_read" on public.site_posts for select
  using (is_published = true or public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "site_posts_staff_write" on public.site_posts;
create policy "site_posts_staff_write" on public.site_posts for all
  using (public.has_role(array['admin','manager','storekeeper']))
  with check (public.has_role(array['admin','manager','storekeeper']));

-- Cấp quyền GRANT cho API anon và authenticated
grant select on public.site_settings, public.set_templates, public.site_gallery, public.site_posts to anon, authenticated;
grant insert on public.site_leads to anon, authenticated;
grant select, update, delete on public.site_settings, public.site_leads to authenticated;
grant select, insert, update, delete on public.site_gallery, public.site_posts to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Dữ liệu bài viết SEO mẫu ban đầu (chỉ chèn nếu chưa tồn tại)
insert into public.site_posts (title, slug, category, excerpt, content, seo_keywords) values
(
  'Kinh nghiệm chọn tông màu trang trí Gia tiên sang trọng và hợp phong thủy',
  'kinh-nghiem-chon-tong-mau-trang-tri-gia-tien-sang-trong',
  'Trang trí Gia tiên',
  'Cách phối màu trắng kem, xanh rêu, đỏ rượu hay vàng champagne giúp không gian lễ gia tiên vừa trang nghiêm vừa lên hình tinh tế.',
  E'Không gian lễ gia tiên là nơi chứng kiến nghi thức thiêng liêng nhất trong ngày trọng đại. Việc chọn đúng tông màu giúp tổng thể phòng khách trở nên rộng rãi, ấm cúng và lên ảnh thật tự nhiên.\n\n## 1. Tông Trắng Kem – Vàng Champagne (Tối giản & Thanh lịch)\nPhù hợp với những cặp đôi yêu thích phong cách nhẹ nhàng, hiện đại. Sắc trắng kem kết hợp hoa lụa hoặc hoa tươi tông pastel giúp không gian sáng bừng và dễ phối hợp với áo dài cô dâu chú rể.\n\n## 2. Tông Xanh Rêu – Trắng (Sang trọng & Tinh tế)\nSắc xanh rêu trầm ấm mang lại chiều sâu rất riêng, đặc biệt nổi bật khi kết hợp cùng ánh đèn vàng ấm và phụ kiện đồng hoặc pha lê.\n\n## 3. Tông Đỏ Rượu – Vàng Đồng (Truyền thống & Ấm áp)\nĐây là lựa chọn kinh điển được nhiều gia đình yêu thích vì mang ý nghĩa may mắn, sung túc mà vẫn giữ được nét sang trọng khi tiết chế vừa đủ.\n\n## Lưu ý khi đặt dịch vụ trang trí Gia tiên\nBạn nên đặt lịch trước ngày lễ khoảng 3–4 tuần để đội ngũ Đặng Wedding khảo sát kích thước phòng khách, tư vấn mẫu phù hợp diện tích và chuẩn bị hoa, bàn ghế đồng bộ.',
  'trang trí gia tiên sang trọng, chọn tông màu gia tiên, trang trí gia tiên tối giản'
),
(
  'Trọn bộ Mâm quả cưới hỏi truyền thống gồm những gì? Hướng dẫn chuẩn bị chỉn chu',
  'tron-bo-mam-qua-cuoi-hoi-truyen-thong-gom-nhung-gi',
  'Mâm quả cưới hỏi',
  'Tìm hiểu ý nghĩa của bộ 5, 6 hoặc 8 mâm quả cưới hỏi miền Nam và cách kết hoa tươi nghệ thuật để lễ rước dâu thật trọn vẹn.',
  E'Mâm quả cưới hỏi không chỉ là lễ vật ra mắt gia tiên hai họ mà còn thể hiện sự trân trọng của nhà trai dành cho nhà gái.\n\n## Bộ 6 mâm quả phổ biến nhất hiện nay\nThông thường, các gia đình ưu tiên chọn 6 mâm quả tượng trưng cho lộc phát, bao gồm: Trầu cau, Trà rượu – đèn cầy, Bánh phu thê (hoặc bánh cốm), Trái cây ngũ quả, Xôi gấc – gà luộc (hoặc heo quay), và Bánh kem / Bánh pía.\n\n## Xu hướng kết mâm quả hiện đại\nThay vì mâm quả bọc giấy kính đơn thuần, xu hướng hiện nay là sử dụng tráp sơn mài, tráp gỗ hoặc mâm đồng kết hợp hoa tươi đồng bộ tông màu với lễ gia tiên và áo dài bưng quả.\n\n## Chuẩn bị đội hình bưng quả\nNhà trai và nhà gái nên thống nhất trước số lượng mâm quả (5, 6 hoặc 8 mâm) để chuẩn bị đội hình nam thanh nữ tú đồng đều, giúp nghi thức trao nhận quả diễn ra suôn sẻ và đẹp mắt.',
  'mâm quả cưới hỏi, tráp cưới đẹp, mâm quả rồng phượng hiện đại'
),
(
  'Nên đặt dịch vụ trang trí cưới hỏi trước bao lâu để có mẫu đẹp và đúng giờ lành?',
  'nen-dat-dich-vu-trang-tri-cuoi-hoi-truoc-bao-lau',
  'Kinh nghiệm cưới',
  'Lịch trình chuẩn bị từ khâu chọn mẫu gia tiên, cổng hoa, backdrop đến thi công lắp đặt trước giờ làm lễ.',
  E'Vào mùa cưới cao điểm (từ tháng 9 đến tháng 3 âm lịch), các ngày đẹp thường trùng vào cuối tuần nên lịch thi công rất nhanh kín.\n\n## Thời điểm vàng để đặt lịch: Trước 1 – 2 tháng\nĐặt sớm giúp hai bạn thoải mái lựa chọn mẫu gia tiên, cổng hoa và backdrop ưng ý nhất, đồng thời có đủ thời gian chỉnh sửa bảng chữ tên dâu rể hoặc phối màu hoa theo sở thích riêng.\n\n## Thời gian thi công thực tế tại tư gia\nVới trọn gói Gia tiên, Cổng hoa và Rạp bàn ghế, đội ngũ Đặng Wedding thường tiến hành lắp đặt trước giờ làm lễ từ 1 buổi đến 1 ngày để đảm bảo mọi chi tiết đều hoàn thiện chỉn chu, sạch đẹp trước khi họ hàng hai bên có mặt.',
  'kinh nghiệm chuẩn bị đám cưới, đặt trang trí gia tiên trước bao lâu, thuê rạp bàn ghế cưới'
)
on conflict (slug) do nothing;
