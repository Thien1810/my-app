-- Ghi nhận nguồn khách (UTM) vào cột riêng cho bảng site_leads
-- Chạy trên Supabase -> SQL Editor. An toàn khi chạy lại nhiều lần (idempotent).
-- Website (dangwed.com) tự thử ghi các cột này; nếu chưa chạy file này thì vẫn gửi form bình thường
-- (nguồn khách vẫn nằm trong cột note như trước).

alter table public.site_leads add column if not exists utm_source   text;
alter table public.site_leads add column if not exists utm_medium   text;
alter table public.site_leads add column if not exists utm_campaign text;
alter table public.site_leads add column if not exists utm_content  text;
alter table public.site_leads add column if not exists fbclid       text;
alter table public.site_leads add column if not exists landing_path text;  -- trang khách vào đầu tiên, vd /khu-vuc/long-khanh
alter table public.site_leads add column if not exists referrer     text;  -- trang giới thiệu (Google, Facebook...)
alter table public.site_leads add column if not exists heard_from   text;  -- khách tự chọn trong form: "Hai bạn biết Đặng Wedding qua đâu?"

-- Kiểm tra sau khi chạy: phải ra 8 dòng
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'site_leads'
--    and column_name in ('utm_source','utm_medium','utm_campaign','utm_content','fbclid','landing_path','referrer','heard_from');
