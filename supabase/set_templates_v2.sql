-- =====================================================================
-- MẪU SET V2: MÔ TẢ + NHIỀU ẢNH (bảng set_template_images) + BUCKET STORAGE
-- Mục đích: mỗi mẫu set có mô tả (description) và nhiều ảnh, 1 ảnh bìa;
--   ảnh mới lưu ở Supabase Storage (bucket công khai để gửi link cho khách).
-- Thứ tự chạy: sau schema.sql (cần set_templates, has_role) và website_schema.sql.
--   Chạy cả file một lần trong Supabase > SQL Editor > Run.
-- File idempotent: chạy lại nhiều lần không lỗi (if not exists / drop policy if exists).
-- ANH THIỆN TỰ CHẠY trên Supabase. Claude/Codex KHÔNG chạy SQL trên dữ liệu thật.
-- Không đụng quyền anon của set_templates (xem ghi chú cuối file).
-- =====================================================================

-- ---------- 1. MÔ TẢ MẪU SET ----------
alter table public.set_templates add column if not exists description text;

-- ---------- 2. ẢNH CỦA MẪU SET ----------
create table if not exists public.set_template_images (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.set_templates(id) on delete cascade,
  url text not null,
  storage_path text,                 -- ảnh mới ở Storage; ảnh cũ (image_url) có thể để trống
  sort_order int not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists idx_set_template_images_template_sort
  on public.set_template_images (template_id, sort_order);

-- Mỗi mẫu set chỉ có tối đa 1 ảnh bìa
create unique index if not exists uq_set_template_images_one_cover
  on public.set_template_images (template_id) where is_cover;

alter table public.set_template_images enable row level security;

-- Xem: mọi người đã duyệt (cùng điều kiện với set_templates). KHÔNG có quyền cho anon.
drop policy if exists "set_template_images_select" on public.set_template_images;
create policy "set_template_images_select" on public.set_template_images for select
  using (public.has_role(array['admin','manager','storekeeper','staff']));

-- Thêm/sửa/xóa: Quản trị, Quản lý, Thủ kho
drop policy if exists "set_template_images_insert" on public.set_template_images;
create policy "set_template_images_insert" on public.set_template_images for insert
  with check (public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "set_template_images_update" on public.set_template_images;
create policy "set_template_images_update" on public.set_template_images for update
  using (public.has_role(array['admin','manager','storekeeper']))
  with check (public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "set_template_images_delete" on public.set_template_images;
create policy "set_template_images_delete" on public.set_template_images for delete
  using (public.has_role(array['admin','manager','storekeeper']));

-- Quyền bảng: chỉ authenticated; thu hồi anon
revoke all on public.set_template_images from anon;
grant select, insert, update, delete on public.set_template_images to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 3. BUCKET STORAGE 'set-template-images' ----------
-- Công khai đọc (URL công khai để gửi khách), tối đa 1 MB/file, chỉ jpeg/png/webp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('set-template-images', 'set-template-images', true, 1048576,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Đọc file qua URL công khai không cần policy; policy select dưới đây chỉ để
-- người dùng đã duyệt liệt kê/ghi đè (upsert) qua API.
drop policy if exists "set_template_images_storage_select" on storage.objects;
create policy "set_template_images_storage_select" on storage.objects for select to authenticated
  using (bucket_id = 'set-template-images'
         and public.has_role(array['admin','manager','storekeeper','staff']));

drop policy if exists "set_template_images_storage_insert" on storage.objects;
create policy "set_template_images_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'set-template-images'
              and public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "set_template_images_storage_update" on storage.objects;
create policy "set_template_images_storage_update" on storage.objects for update to authenticated
  using (bucket_id = 'set-template-images'
         and public.has_role(array['admin','manager','storekeeper']))
  with check (bucket_id = 'set-template-images'
              and public.has_role(array['admin','manager','storekeeper']));

drop policy if exists "set_template_images_storage_delete" on storage.objects;
create policy "set_template_images_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'set-template-images'
         and public.has_role(array['admin','manager','storekeeper']));

-- =====================================================================
-- 4. KIỂM TRA SAU KHI CHẠY (chạy riêng từng câu; chỉ đọc)
-- =====================================================================
-- (a) Cột description đã có chưa (kỳ vọng 1 dòng, is_nullable = YES):
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='set_templates' and column_name='description';
--
-- (b) Bảng + RLS bật (kỳ vọng relrowsecurity = true):
--   select relname, relrowsecurity from pg_class
--   where oid = 'public.set_template_images'::regclass;
--
-- (c) Policy của bảng (kỳ vọng 4: select/insert/update/delete) và index:
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='set_template_images';
--   select indexname from pg_indexes
--   where schemaname='public' and tablename='set_template_images';
--
-- (d) anon KHÔNG có quyền trên bảng ảnh (kỳ vọng 0 dòng):
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='set_template_images' and grantee='anon';
--
-- (e) Bucket (kỳ vọng public=true, file_size_limit=1048576, 3 mime):
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets
--   where id='set-template-images';
--
-- (f) Policy Storage (kỳ vọng 4 dòng):
--   select policyname, cmd from pg_policies
--   where schemaname='storage' and tablename='objects'
--     and policyname like 'set_template_images_storage_%';
--
-- GHI CHÚ QUYỀN CÔNG KHAI:
--  * website_schema.sql đang cho anon SELECT TOÀN BỘ cột của set_templates
--    (policy "set_templates_public_read" using (true) + grant select). Vì vậy cột
--    description MỚI SẼ CÔNG KHAI. Chỉ viết mô tả không chứa số lượng vật tư hay giá.
--  * Bucket public: ai có link đều xem được ảnh; không đưa ảnh có thông tin nội bộ.
--  * File này KHÔNG sửa quyền anon. Đề xuất (nếu muốn chặt hơn, làm file riêng):
--    thu hồi select cấp bảng của anon và chỉ grant theo cột
--    (id, name, category, image_url, description), hoặc tạo view công khai
--    chỉ gồm các cột cần hiển thị. Cần kiểm tra dangwed-site đang select cột nào trước.
-- =====================================================================
