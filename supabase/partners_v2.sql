-- =====================================================================
-- ĐỐI TÁC V2: LƯU TRỮ, KHÓA SĐT, CHẶN ĐỔI LOẠI, PHÂN QUYỀN
-- Anh Thiện tự chạy cả file trong SQL Editor sau khi sao lưu.
-- Phụ thuộc: schema.sql đã được cài (partners/projects/project_members,
-- stock_movements, has_role, can_see_project). Bản schema.sql cập nhật
-- dùng cùng policy partners với file này.
-- partnersApi lịch sử khách cần project_finance từ schema.sql; receipt_code
-- từ stock_receipts.sql là tùy chọn. Không thêm công nợ NCC hay đổi site_leads.
-- Idempotent; chạy trong một giao dịch. Không lọc archived_at trong RLS:
-- khách lưu trữ vẫn phải hiện tên ở các dự án lịch sử.
-- =====================================================================
begin;

alter table public.partners add column if not exists archived_at timestamptz;
alter table public.partners add column if not exists phone_key text;

-- Chính xác phoneKey JS: xóa dấu chấm/gạch nối/ECMAScript whitespace,
-- đổi +84/+840 hoặc 84 đứng trước đúng 9 chữ số thành 0.
-- Chỉ nhận 9–11 chữ số ASCII, còn lại ''.
create or replace function public.partner_phone_key(value text)
returns text language sql immutable set search_path = '' as $$
  select case when normalized collate "C" ~ '^[0-9]{9,11}$'
    then normalized else '' end
  from (select regexp_replace(
    regexp_replace(
      translate(coalesce(value, ''),
        U&' .-\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', ''),
      '^\+840?', '0') collate "C",
    '^84([0-9]{9})$', E'0\\1') as normalized) n;
$$;

create or replace function public.partners_set_phone_key()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.phone_key := public.partner_phone_key(new.phone);
  return new;
end;
$$;
drop trigger if exists partners_set_phone_key on public.partners;
create trigger partners_set_phone_key before insert or update on public.partners
for each row execute function public.partners_set_phone_key();

update public.partners set phone_key = public.partner_phone_key(phone)
where phone_key is distinct from public.partner_phone_key(phone);
create index if not exists idx_partners_phone_key on public.partners(phone_key)
where phone_key <> '';

-- SECURITY DEFINER để thấy mọi tham chiếu kể cả người sửa bị RLS che.
create or replace function public.partners_guard_kind()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.partners where id = old.id for update;
  if exists (select 1 from public.projects where customer_id = old.id)
     or exists (select 1 from public.stock_movements where partner_id = old.id) then
    raise exception using errcode = '23503',
      message = 'Không thể đổi loại đối tác đã có dự án hoặc phiếu kho liên quan.';
  end if;
  return new;
end;
$$;
drop trigger if exists partners_guard_kind on public.partners;
create trigger partners_guard_kind before update of kind on public.partners
for each row when (old.kind is distinct from new.kind)
execute function public.partners_guard_kind();

-- Phân công có thật: projects.lead_id hoặc project_members.user_id.
-- can_see_project hiện có là SECURITY DEFINER, không đọc partners.
-- Helper này giữ quan hệ customer_id, không nhận user_id từ phía client.
create or replace function public.can_see_partner_customer(partner_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['staff']) and exists (
    select 1 from public.projects p
    where p.customer_id = partner_id and public.can_see_project(p.id)
  );
$$;

revoke all on function public.partner_phone_key(text) from public, anon;
revoke all on function public.partners_set_phone_key() from public, anon, authenticated;
revoke all on function public.partners_guard_kind() from public, anon, authenticated;
revoke all on function public.can_see_partner_customer(bigint) from public, anon;
grant execute on function public.partner_phone_key(text) to authenticated, service_role;
grant execute on function public.can_see_partner_customer(bigint) to authenticated;

alter table public.partners enable row level security;
drop policy if exists partners_select on public.partners;
create policy partners_select on public.partners for select to authenticated
using (public.has_role(array['admin','manager','storekeeper'])
  or (public.has_role(array['staff']) and
    (kind = 'supplier' or (kind = 'customer' and public.can_see_partner_customer(id)))));
drop policy if exists partners_insert on public.partners;
create policy partners_insert on public.partners for insert to authenticated
with check (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists partners_update on public.partners;
create policy partners_update on public.partners for update to authenticated
using (public.has_role(array['admin','manager','storekeeper']))
with check (public.has_role(array['admin','manager','storekeeper']));
drop policy if exists partners_delete on public.partners;
create policy partners_delete on public.partners for delete to authenticated
using (public.has_role(array['admin','manager']));
revoke all on public.partners from anon;
grant select, insert, update, delete on public.partners to authenticated;
grant usage, select on sequence public.partners_id_seq to authenticated;

commit;

-- =====================================================================
-- KIỂM TRA SAU KHI CHẠY (chạy riêng; chỉ đọc)
-- select column_name, data_type from information_schema.columns
-- where table_schema='public' and table_name='partners'
-- and column_name in ('archived_at','phone_key'); -- 2 dòng
-- select count(*) from public.partners
-- where phone_key is distinct from public.partner_phone_key(phone); -- 0
-- select public.partner_phone_key('+84 918.809-096'),
-- public.partner_phone_key('+840918809096'), public.partner_phone_key('84918809096'),
-- public.partner_phone_key('918809096'), public.partner_phone_key('abc');
-- -- kỳ vọng: 0918809096, 0918809096, 0918809096, 918809096, chuỗi rỗng
-- select has_function_privilege('service_role', 'public.partner_phone_key(text)', 'execute'); -- true
-- select indexname, indexdef from pg_indexes
-- where schemaname='public' and tablename='partners'; -- phone_key NON-UNIQUE
-- select policyname, cmd, roles, qual, with_check from pg_policies
-- where schemaname='public' and tablename='partners'; -- đúng 4 policy ở trên
-- select tgname from pg_trigger where tgrelid='public.partners'::regclass
-- and not tgisinternal; -- 2 trigger mới
-- Dùng tài khoản thử: staff đọc supplier và khách dự án lead_id/member,
-- không đọc khách khác/ghi đối tác; storekeeper đọc SĐT, thêm/sửa, không xóa;
-- admin/manager đủ CRUD. Kiểm tra join tên khách cả hồ sơ lưu trữ.
-- Quyền xuất Excel là kiểm soát UI/API JS; RLS không phân biệt đọc và xuất.
-- Không có RPC chuyển lead trong file này. Luồng client không atomic;
-- projects_site_lead_link.sql cung cấp unique site_lead_id chống trùng liên máy.
-- Trước khi có file liên kết đó, client vẫn chạy nhưng không bảo đảm chống
-- trùng giữa nhiều máy hoặc khi phản hồi insert bị mất. Có thể còn hồ sơ
-- khách chưa gắn dự án nếu tạo khách thành công nhưng tạo dự án thất bại.
--
-- HOÀN TÁC (anh Thiện quyết định sau sao lưu, KHÔNG chạy tự động):
-- 1. Nếu lỗi trước COMMIT: ROLLBACK; toàn bộ file được hoàn tác.
-- 2. Sau COMMIT: ưu tiên rollback code, giữ cột và RLS để không mất lưu trữ
--    hoặc mở lại danh bạ khách cho staff. Không chạy schema.sql để rollback.
-- 3. Nếu cần gỡ cột: sao lưu id, archived_at trước; trong transaction riêng:
--    drop trigger if exists partners_set_phone_key on public.partners;
--    drop trigger if exists partners_guard_kind on public.partners;
--    drop function if exists public.partners_set_phone_key();
--    drop function if exists public.partners_guard_kind();
--    drop index if exists public.idx_partners_phone_key;
--    alter table public.partners drop column if exists phone_key;
--    alter table public.partners drop column if exists archived_at;
--    drop function if exists public.partner_phone_key(text);
--    Giữ can_see_partner_customer và 4 policy an toàn. Muốn trả policy cũ,
--    phải khôi phục từ bản sao pg_policies/grants trước migration và chấp
--    nhận staff có thể thấy tất cả khách; chỉ sau khi anh Thiện phê duyệt.
