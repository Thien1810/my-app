-- =====================================================================
-- ĐẶNG WEDDING — DI CHUYỂN DỮ LIỆU THẬT cho phần tài chính
-- CHẠY SAU finance_schema.sql.
-- CHỈ chạy trên Supabase Branch hoặc sau khi đã BACKUP.
-- Chạy từng BƯỚC một (bôi đen đoạn của bước đó rồi Run), đọc kết quả SELECT
-- trước khi chạy bước kế tiếp. KHÔNG bấm Run cả file một lần.
-- Mọi câu làm đổi dữ liệu đều để COMMENT, trừ BƯỚC 2 (bọc trong transaction, xem ghi chú).
-- File chưa được chạy thử trên DB thật.
-- =====================================================================

-- ---------- BƯỚC 1 (preview, chỉ SELECT): dự án còn thẻ [DW_ATTR:...] ----------
select id, note,
  substring(note from '\[DW_ATTR:\{[^}]*"source":"([a-z_]+)"') as src_extracted,
  substring(note from '\[DW_ATTR:\{[^}]*"hub":"([a-z_]+)"')    as hub_extracted,
  lead_source, warehouse_code
from public.projects
where note like '%[DW_ATTR:%'
order by id;

select count(*) as so_du_an_con_the_dw_attr
from public.projects
where note like '%[DW_ATTR:%';

-- ---------- BƯỚC 2: chuyển source/hub sang lead_source/warehouse_code ----------
-- Câu này SỬA DỮ LIỆU. Chỉ chạy sau khi đã xem BƯỚC 1. Mặc định để COMMENT:
-- bỏ comment cả khối từ BEGIN đến SELECT kiểm tra, chạy, đọc kết quả rồi tự quyết
-- COMMIT (giữ) hoặc ROLLBACK (hủy). Chưa COMMIT thì thay đổi chưa có hiệu lực.
-- Lưu ý: giá trị source nằm ngoài danh sách của projects_lead_source_check sẽ làm câu UPDATE lỗi
-- (khi đó transaction hỏng, chạy ROLLBACK); hub không có trong bảng warehouses cũng lỗi khóa ngoại.
--
-- begin;
-- update public.projects
-- set lead_source = coalesce(
--       nullif(substring(note from '\[DW_ATTR:\{[^}]*"source":"([a-z_]+)"'), ''), lead_source),
--     warehouse_code = coalesce(
--       warehouse_code,
--       nullif(substring(note from '\[DW_ATTR:\{[^}]*"hub":"([a-z_]+)"'), ''))
-- where note like '%[DW_ATTR:%'
--   and lead_source = 'unknown';
--
-- -- Kiểm tra: đối chiếu cột mới với thẻ trong note, mọi dòng phải khớp
-- select id, lead_source, warehouse_code,
--   substring(note from '\[DW_ATTR:\{[^}]*"source":"([a-z_]+)"') as src_in_note,
--   substring(note from '\[DW_ATTR:\{[^}]*"hub":"([a-z_]+)"')    as hub_in_note
-- from public.projects
-- where note like '%[DW_ATTR:%'
-- order by id;
-- -- Khớp -> commit;   Không khớp -> rollback;
-- commit;

-- ---------- BƯỚC 3: xóa thẻ [DW_ATTR:...] khỏi note (mặc định COMMENT) ----------
-- Chỉ chạy sau khi BƯỚC 2 đã COMMIT và kiểm tra khớp.
-- KHÔNG HOÀN TÁC ĐƯỢC nếu không có backup (nội dung note bị ghi đè).
--
-- update public.projects
-- set note = nullif(trim(regexp_replace(note, E'\\n?\\[DW_ATTR:\\{[^}]*\\}\\]', '', 'g')), '')
-- where note like '%[DW_ATTR:%'
--   and lead_source <> 'unknown';

-- ---------- BƯỚC 4 (preview, chỉ SELECT): dòng Ads cũ trong project_costs ----------
-- Dùng đúng regex đã sửa trong trigger block_ads_in_project_costs (finance_schema.sql, mục 8).
select id, project_id, kind, amount, cost_date, note
from public.project_costs
where lower(kind) ~ '(^|[^[:alpha:]])ads($|[^[:alpha:]])|quảng cáo|quang cao|marketing'
   or note ilike '%[ADS-SYNC:%'
order by cost_date, id;

-- ---------- BƯỚC 5: INSERT sang ads_spend + DELETE khỏi project_costs (mặc định COMMENT) ----------
-- Chỉ chạy sau khi đã đọc kỹ BƯỚC 4. Bỏ comment cả khối, chạy, kiểm tra, rồi commit hoặc rollback.
-- Lưu ý: trigger khóa sổ trên ads_spend (guard_locked_month) sẽ báo lỗi nếu có dòng thuộc tháng đã khóa
-- -> cả transaction lỗi, chạy rollback; mở khóa tháng đó (xóa dòng month_locks) hoặc tự xử lý riêng dòng đó.
-- Không có thông tin kho/kênh nên gắn channel 'other', source 'legacy'.
-- Trigger chặn Ads chỉ chạy khi INSERT/UPDATE project_costs, không ảnh hưởng DELETE ở đây.
-- DELETE không hoàn tác được sau khi commit nếu không có backup.
--
-- begin;
-- insert into public.ads_spend (spend_date, channel, source, spend, note)
-- select cost_date, 'other', 'legacy', amount, 'Chuyển từ project_costs #' || id || ' — ' || coalesce(note, '')
-- from public.project_costs
-- where lower(kind) ~ '(^|[^[:alpha:]])ads($|[^[:alpha:]])|quảng cáo|quang cao|marketing'
--    or note ilike '%[ADS-SYNC:%';
-- -- Lưu ý: ads_spend.spend có check (spend >= 0); dòng amount âm sẽ làm INSERT lỗi -> rollback và xử lý tay.
-- delete from public.project_costs
-- where lower(kind) ~ '(^|[^[:alpha:]])ads($|[^[:alpha:]])|quảng cáo|quang cao|marketing'
--    or note ilike '%[ADS-SYNC:%';
-- -- Kiểm tra: số dòng legacy vừa chuyển phải bằng số dòng ở BƯỚC 4
-- select count(*) as da_chuyen, coalesce(sum(spend), 0) as tong_tien
-- from public.ads_spend where source = 'legacy' and note like 'Chuyển từ project_costs #%';
-- commit;   -- hoặc rollback;
