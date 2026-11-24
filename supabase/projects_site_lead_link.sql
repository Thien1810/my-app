-- =====================================================================
-- ĐẶNG WEDDING — LIÊN KẾT LEAD WEBSITE VỚI DỰ ÁN (projects.site_lead_id)
-- Mục đích: mỗi lead (public.site_leads) chỉ được chuyển thành tối đa 1 dự án.
--   Chống tạo trùng dự án ở mức DB (bấm đúp, 2 người cùng bấm, 2 tab).
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent).
-- Yêu cầu: đã chạy schema.sql (bảng projects) và site_leads_*.sql (bảng site_leads).
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File chưa được test trên DB thật.
-- Lưu ý: projects.lead_id là NGƯỜI PHỤ TRÁCH dự án (profile), KHÔNG liên quan site_leads.
--   Cột mới site_lead_id mới là liên kết tới lead khách đăng ký.
-- Không đổi policy/RLS: quyền đọc/ghi projects giữ nguyên.
-- App chạy bình thường khi chưa chạy file này (chỉ thiếu chống trùng ở mức DB).
-- =====================================================================

-- ---------- 1. CỘT MỚI (nullable; xóa lead thì dự án giữ nguyên, chỉ mất liên kết) ----------
alter table public.projects
  add column if not exists site_lead_id bigint references public.site_leads(id) on delete set null;

-- ---------- 2. MỖI LEAD TỐI ĐA 1 DỰ ÁN ----------
-- Dùng chỉ mục UNIQUE MỘT PHẦN (where site_lead_id is not null): dự án tạo tay không có
-- lead (site_lead_id null) không bị ràng buộc. Phù hợp vì app chỉ INSERT dự án,
-- không dùng upsert (on conflict) nên không cần ràng buộc unique đầy đủ.
-- Nếu đã có 2 dự án cùng site_lead_id thì lệnh này sẽ lỗi: xem câu kiểm tra số 2 ở cuối file.
create unique index if not exists uq_projects_site_lead
  on public.projects (site_lead_id)
  where site_lead_id is not null;

-- ---------- 3. CÂU KIỂM TRA (chạy riêng sau khi xong) ----------
-- 3.1 Cột đã có? (kỳ vọng 1 dòng)
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'projects' and column_name = 'site_lead_id';
-- 3.2 Lead nào đang có nhiều hơn 1 dự án? (kỳ vọng 0 dòng)
-- select site_lead_id, count(*) from public.projects
--  where site_lead_id is not null group by site_lead_id having count(*) > 1;
-- 3.3 Chỉ mục đã có? (kỳ vọng 1 dòng)
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public' and indexname = 'uq_projects_site_lead';
