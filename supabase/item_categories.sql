-- =====================================================================
-- ĐẶNG WEDDING — NHÓM VẬT TƯ (item_categories) + KHÓA MÃ VẬT TƯ (2026-11-25)
--   1) Bảng public.item_categories: nhóm vật tư 2 cấp (nhóm cha / nhóm con), mã nhóm in hoa
--      dùng trong mã vật tư [TH|TSD]-[MÃ NHÓM]-[số].
--   2) Cột items.category_id (+ chỉ mục). GIỮ cột chữ cũ items.category: trigger tự đặt
--      items.category = tên NHÓM CHA khi có category_id, để báo cáo / mẫu set / xuất Excel không vỡ;
--      app cũ chỉ gửi chữ thì trigger tự tìm nhóm gốc khớp tên để gán category_id.
--   3) Nạp 5 nhóm chuẩn (ITEM_CATEGORY_PRESETS trong src/lib/formatters.js) + tạo nhóm cho mọi giá
--      trị items.category đang có, rồi gán items.category_id (backfill).
--   4) RLS: xem = mọi vai trò đã duyệt; tạo = admin/manager/storekeeper; sửa, xóa = admin/manager.
--   5) Khóa mã vật tư: đã có phiếu kho thì không đổi được items.code.
--   6) Chặn xóa nhóm còn vật tư / còn nhóm con, kèm thông báo tiếng Việt dễ hiểu.
--   7) View item_stock: thêm cột category_id vào CUỐI view (không đổi các cột đang có).
-- Chạy trong Supabase > SQL Editor > Run. Chạy lại nhiều lần không lỗi (idempotent):
--   (Lưu ý: chạy lại sau khi app đã dùng một thời gian KHÔNG hẳn là không đổi gì: khối 3b/3c sẽ tạo nhóm gốc cho các chữ nhóm mới app cũ gõ tay và gán vật tư chưa có category_id vào đó; nhóm chuẩn bị admin xóa sẽ được tạo lại. Nhóm đang ngưng vẫn có thể nhận vật tư khi chữ khớp.)
--   create table/index if not exists, add column if not exists, create or replace function,
--   drop trigger/policy if exists + create, nạp dữ liệu bằng on conflict do nothing, backfill chỉ
--   đụng vật tư chưa có category_id.
-- Yêu cầu: đã chạy schema.sql (items, stock_movements, has_role, view item_stock).
--   Không bắt buộc finance_schema.sql: nếu chưa có bảng stock_transfers thì khóa mã chỉ xét sổ kho.
-- Thứ tự khuyến nghị: chạy SAU các file đang có (schema.sql -> finance_schema.sql -> ... ->
--   audit_fixes_2026-11-25.sql -> FILE NÀY). File không đụng trigger/policy của các file khác.
-- KHUYẾN NGHỊ: backup/Branch trước khi chạy. File CHƯA được test trên DB thật.
-- TRƯỚC KHI CÀI: chạy các câu "TRƯỚC KHI CÀI" ở mục 8 cuối file, NHẤT LÀ (T0) xuất sao lưu
--   id, code, category của items (backfill có thể đổi cách viết items.category) và (T3) chuẩn hóa mã.
--   Xem thêm khối TÙY CHỌN gộp 'Hoa Giấy' vào 'Hoa & Lá' ở đầu mục 3b.
--
-- QUYẾT ĐỊNH / GIẢ ĐỊNH:
--  * KHÓA SO TÊN (hàm category_name_key) giống normalizeCategoryName() trong src/lib/itemCategories.js:
--    bỏ dấu tiếng Việt (normalize NFD + bỏ dấu tổ hợp, dự phòng bằng translate), đ -> d, chữ thường,
--    mọi ký tự không phải chữ/số -> khoảng trắng, gộp khoảng trắng, bỏ đầu cuối.
--    Ví dụ 'hoa la' = 'Hoa & Lá' = 'Hoa Lá' = 'HOA/LÁ' -> 'hoa la'. 'Hoa Giấy' -> 'hoa giay' là nhóm
--    RIÊNG (khác từ), KHÔNG tự gộp. 'HoaGiấy' (dính liền) -> 'hoagiay' khác 'hoa giay'.
--    Khóa này dùng ở 3b (tạo nhóm từ chữ cũ), 3c (backfill) và trigger đồng bộ 2a. Không dùng
--    extension unaccent (Supabase chưa bật sẵn; unaccent() không IMMUTABLE).
--  * Chỉ mục unique tên GIỮ lower(name) trong cùng nhóm cha (không dùng khóa mạnh trong chỉ mục): DB chỉ
--    chặn trùng hoa/thường; trùng "không dấu / khác dấu câu" do app chặn phía client. Lý do: khóa mạnh
--    dùng normalize() + regex lớp ký tự phụ thuộc phiên bản/locale, đưa vào chỉ mục unique có rủi ro
--    chỉ mục lệch nếu sau này đổi hàm; và đổi chỉ mục sẽ làm câu create index if not exists không còn
--    idempotent theo nghĩa "đúng định nghĩa mới". Hệ quả: nếu lỡ có 2 nhóm gốc cùng khóa mạnh (ví dụ
--    'Hoa La' tạo bằng SQL tay cạnh 'Hoa & Lá'), mọi chỗ so khớp chọn nhóm đang dùng, sort_order nhỏ,
--    rồi id nhỏ.
--  * Mã nhóm: chỉ A-Z, 0-9, 1-8 ký tự. Trigger tự upper()/bỏ khoảng trắng đầu cuối trước khi kiểm,
--    nên app gửi 'hoa' vẫn lưu 'HOA'. Vì luôn in hoa nên unique(code) = không phân biệt hoa/thường.
--  * items.category lấy TÊN NHÓM CHA (vật tư gán vào nhóm con vẫn hiện tên nhóm cha) để báo cáo,
--    mẫu set, xuất Excel đang gom theo items.category giữ đúng 5-10 nhóm lớn như hiện nay.
--    Tên nhóm con chỉ xem được qua category_id (app tự join).
--  * Trigger đồng bộ 2a (INSERT, hoặc UPDATE có đụng category_id / category) phải chạy được với CẢ
--    app cũ (ItemsPage hiện hành chỉ gửi chữ category, KHÔNG gửi category_id) lẫn app mới:
--      - category_id được gửi và đổi (hoặc INSERT có category_id): category_id THẮNG, category = tên
--        nhóm cha. Cả hai cùng đổi (app mới) -> vẫn theo category_id.
--      - Chỉ chữ category đổi (UPDATE app cũ), hoặc INSERT không có category_id mà có chữ: tìm NHÓM GỐC
--        (parent_id is null) theo khóa so tên rồi gán category_id; không thấy thì category_id = NULL
--        và GIỮ nguyên chữ người dùng gõ. Chữ mới chỉ khác cách viết so với nhóm gốc hiện tại của vật
--        tư (kể cả khi vật tư ở nhóm con) thì giữ nguyên category_id (không đá vật tư ra khỏi nhóm con).
--      - Không đổi gì (app cũ ghi lại đúng chữ cũ khi sửa tên/giá): category = tên nhóm cha như cũ.
--      - UPDATE đặt category_id = NULL (app mới bỏ nhóm): giữ chữ đang gửi, không tự gán lại.
--  * Đổi tên nhóm / đổi nhóm cha: trigger 2b cập nhật lại items.category của các vật tư liên quan.
--  * Khóa mã: chỉ chặn khi ĐÃ có mã cũ (khác rỗng), mã đổi THẬT (so upper(btrim()) hai bên, nên đổi
--    hoa/thường hoặc khoảng trắng thừa không bị chặn — app luôn trim().toUpperCase() khi lưu) và vật tư
--    đã có ít nhất 1 dòng stock_movements (hoặc stock_transfers). Vật tư chưa có mã vẫn được cấp mã lần
--    đầu. Xét cả stock_transfers dù thực tế chuyển kho luôn cần tồn — để an toàn khi dữ liệu được nhập
--    tay/import không qua guard. Áp cho MỌI vai trò, kể cả admin và SQL Editor.
--  * Mã nhóm sinh tự động: cùng thuật toán toCategoryCode() trong formatters.js (bỏ dấu, 1 từ -> 6
--    ký tự đầu, nhiều từ -> 5 ký tự đầu của từ đầu), trùng thì thêm hậu tố số: HOA -> HOA2, HOA3...
--    Ví dụ: 'Bàn Ghế' -> BAN, 'Keo nến' -> KEO, 'Hoa Giấy' -> HOA2 (vì HOA đã là 'Hoa & Lá').
--    Vật tư cũ đã có mã TH-HOA-xxx giữ nguyên mã (khóa mã), vật tư mới của 'Hoa Giấy' sẽ ra HOA2.
--  * GỢI Ý cho anh Thiện: muốn 'Hoa Giấy' thuộc 'Hoa & Lá' thì tốt nhất gộp TRƯỚC khi cài (khối tùy chọn
--    đầu mục 3b). Sau khi cài vẫn gộp được bằng giao diện (chuyển vật tư hoặc biến 'Hoa Giấy' thành
--    nhóm con của 'Hoa & Lá').
-- =====================================================================


-- =====================================================================
-- 1. BẢNG NHÓM VẬT TƯ
-- =====================================================================
create table if not exists public.item_categories (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) > 0),
  code text not null check (code ~ '^[A-Z0-9]{1,8}$'),        -- mã nhóm in hoa, tối đa 8 ký tự
  parent_id bigint references public.item_categories(id) on delete restrict,
  default_kind text check (default_kind in ('consumable','reusable')),
  default_unit text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  check (parent_id is null or parent_id <> id)                 -- không tự trỏ chính mình
);

-- Mã nhóm duy nhất toàn bảng, không phân biệt hoa/thường (check đã ép in hoa, upper() cho chắc).
create unique index if not exists uq_item_categories_code
  on public.item_categories (upper(code));
-- Tên không trùng trong cùng nhóm cha (nhóm gốc coi như cha = 0). CỐ Ý chỉ lower(), KHÔNG dùng khóa
-- mạnh category_name_key — xem QUYẾT ĐỊNH ở đầu file. Trùng không dấu / khác dấu câu do app chặn.
create unique index if not exists uq_item_categories_parent_name
  on public.item_categories (coalesce(parent_id, 0), lower(name));
create index if not exists idx_item_categories_parent
  on public.item_categories (parent_id);

-- KHÓA SO TÊN (khóa mạnh), giống normalizeCategoryName() trong src/lib/itemCategories.js:
--   bỏ dấu (NFD + bỏ dấu tổ hợp U+0300..U+036F; dự phòng translate nếu normalize() không chạy được),
--   đ/Đ -> d, chữ thường, ký tự không phải chữ/số -> khoảng trắng (gộp), bỏ khoảng trắng đầu cuối.
--   'Hoa & Lá' -> 'hoa la'; 'Hoa Lá' -> 'hoa la'; 'Hoa Giấy' -> 'hoa giay'; NULL/'&&' -> ''.
-- Bỏ dấu bằng translate TRƯỚC lower() nên không phụ thuộc collation khi hạ chữ có dấu tiếng Việt.
-- Hàm thuần (không đọc bảng), ai gọi cũng vô hại.
create or replace function public.category_name_key(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s text := coalesce(p_name, '');
begin
  begin
    s := normalize(s, NFD);          -- tách dấu ra khỏi chữ (giống JS normalize('NFD'))
  exception when others then
    null;                            -- không chuẩn hóa được thì để translate bên dưới lo
  end;
  s := regexp_replace(s, '[̀-ͯ]', '', 'g');        -- bỏ dấu tổ hợp
  -- Dự phòng: bỏ dấu tiếng Việt dựng sẵn (chữ thường rồi chữ hoa) + đ/Đ (NFD không tách đ)
  s := translate(s,
    'àáảãạăằắẳẵặâầấẩẫậ' || 'èéẻẽẹêềếểễệ' || 'ìíỉĩị' || 'òóỏõọôồốổỗộơờớởỡợ' || 'ùúủũụưừứửữự' || 'ỳýỷỹỵ' || 'đ',
    repeat('a', 17) || repeat('e', 11) || repeat('i', 5) || repeat('o', 17) || repeat('u', 11) || repeat('y', 5) || 'd');
  s := translate(s,
    'ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ' || 'ÈÉẺẼẸÊỀẾỂỄỆ' || 'ÌÍỈĨỊ' || 'ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ' || 'ÙÚỦŨỤƯỪỨỬỮỰ' || 'ỲÝỶỸỴ' || 'Đ',
    repeat('A', 17) || repeat('E', 11) || repeat('I', 5) || repeat('O', 17) || repeat('U', 11) || repeat('Y', 5) || 'D');
  s := lower(s);
  -- Ký tự không phải chữ/số (dấu câu, &, /, khoảng trắng, NBSP, gạch dưới...) -> 1 khoảng trắng
  s := btrim(regexp_replace(s, '[^[:alnum:]]+', ' ', 'g'));
  return s;
end $$;

-- Sinh mã nhóm từ tên (giống toCategoryCode trong src/lib/formatters.js, không xét preset).
create or replace function public.category_code_from_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s text := coalesce(p_name, '');
  w text[];
begin
  begin
    s := normalize(s, NFC);          -- gộp dấu tổ hợp thành ký tự dựng sẵn (DB UTF8)
  exception when others then
    null;                            -- không chuẩn hóa được thì dùng nguyên chuỗi
  end;
  -- Bỏ dấu tiếng Việt (chữ thường rồi chữ hoa), không cần extension unaccent
  s := translate(s,
    'àáảãạăằắẳẵặâầấẩẫậ' || 'èéẻẽẹêềếểễệ' || 'ìíỉĩị' || 'òóỏõọôồốổỗộơờớởỡợ' || 'ùúủũụưừứửữự' || 'ỳýỷỹỵ' || 'đ',
    repeat('a', 17) || repeat('e', 11) || repeat('i', 5) || repeat('o', 17) || repeat('u', 11) || repeat('y', 5) || 'd');
  s := translate(s,
    'ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ' || 'ÈÉẺẼẸÊỀẾỂỄỆ' || 'ÌÍỈĨỊ' || 'ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ' || 'ÙÚỦŨỤƯỪỨỬỮỰ' || 'ỲÝỶỸỴ' || 'Đ',
    repeat('A', 17) || repeat('E', 11) || repeat('I', 5) || repeat('O', 17) || repeat('U', 11) || repeat('Y', 5) || 'D');
  s := regexp_replace(s, '[̀-ͯ]', '', 'g');          -- dấu tổ hợp còn sót
  s := upper(s);
  s := btrim(regexp_replace(s, '[^A-Z0-9]+', ' ', 'g'));       -- ký tự khác A-Z0-9 -> khoảng trắng
  if s = '' then
    return 'VT';
  end if;
  w := string_to_array(s, ' ');
  if array_length(w, 1) = 1 then
    return left(w[1], 6);
  end if;
  return left(w[1], 5);
end $$;

-- ---------- 1b. CHUẨN HÓA + CHẶN QUÁ 2 CẤP ----------
-- security definer: cần khóa / đọc dòng nhóm cha bất kể RLS (thủ kho không có quyền UPDATE).
create or replace function public.guard_item_category_write() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_parent bigint;
  v_parent_name text;
begin
  -- Chuẩn hóa: tên bỏ khoảng trắng thừa; mã in hoa; đơn vị rỗng -> NULL
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '[\s ]+', ' ', 'g'));
  new.code := upper(btrim(coalesce(new.code, '')));
  new.default_unit := nullif(btrim(coalesce(new.default_unit, '')), '');

  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Nhóm không thể là nhóm cha của chính nó.';
    end if;

    -- Khóa dòng nhóm cha để 2 thao tác cùng lúc không tạo ra cấp 3
    select c.parent_id, c.name into v_parent_parent, v_parent_name
      from public.item_categories c
     where c.id = new.parent_id
       for no key update;
    -- Không tìm thấy nhóm cha: để khóa ngoại tự từ chối
    if found and v_parent_parent is not null then
      raise exception 'Chỉ có 2 cấp: "%" đã là nhóm con, không tạo nhóm con bên trong được.', v_parent_name;
    end if;

    -- Nhóm đang có nhóm con thì không được trở thành nhóm con (sẽ thành 3 cấp)
    if tg_op = 'UPDATE' and exists (select 1 from public.item_categories c where c.parent_id = new.id) then
      raise exception 'Nhóm "%" đang có nhóm con nên không chuyển thành nhóm con được.', new.name;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_item_category_write on public.item_categories;
create trigger trg_guard_item_category_write before insert or update on public.item_categories
  for each row execute function public.guard_item_category_write();

-- ---------- 1c. CHẶN XÓA NHÓM ĐANG DÙNG (thông báo dễ hiểu; on delete restrict vẫn là lớp chặn cuối) ----------
-- Chỉ có tác dụng sau khi đã có cột items.category_id (mục 2). Hàm plpgsql chỉ kiểm tên cột lúc chạy.
create or replace function public.guard_item_category_delete() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items bigint;
  v_children bigint;
begin
  select count(*) into v_children from public.item_categories c where c.parent_id = old.id;
  if v_children > 0 then
    raise exception 'Không xóa được nhóm "%": còn % nhóm con. Hãy chuyển hoặc xóa nhóm con trước.', old.name, v_children;
  end if;

  select count(*) into v_items from public.items i where i.category_id = old.id;
  if v_items > 0 then
    raise exception 'Không xóa được nhóm "%": còn % vật tư thuộc nhóm. Hãy chuyển vật tư sang nhóm khác hoặc tắt nhóm (ngừng dùng).', old.name, v_items;
  end if;

  return old;
end $$;

drop trigger if exists trg_guard_item_category_delete on public.item_categories;
create trigger trg_guard_item_category_delete before delete on public.item_categories
  for each row execute function public.guard_item_category_delete();


-- =====================================================================
-- 2. CỘT items.category_id + ĐỒNG BỘ CỘT CHỮ items.category
-- =====================================================================
alter table public.items
  add column if not exists category_id bigint references public.item_categories(id) on delete restrict;
create index if not exists idx_items_category_id on public.items (category_id);

-- 2a. Ghi vật tư: đồng bộ 2 chiều giữa category_id (app mới) và chữ category (app cũ).
--     Thứ tự ưu tiên (xem QUYẾT ĐỊNH đầu file):
--       (1) category_id được gửi và đổi / INSERT có category_id -> category_id THẮNG, chữ = tên nhóm cha.
--       (2) UPDATE đặt category_id = NULL -> giữ chữ đang gửi (không tự gán lại).
--       (3) Chỉ chữ đổi (app cũ đổi nhóm) / INSERT chỉ có chữ -> tìm NHÓM GỐC theo khóa so tên;
--           thấy thì gán category_id, không thấy thì category_id = NULL và GIỮ chữ.
--       (4) Không đổi gì -> chữ = tên nhóm cha (như cũ).
--     Trigger chỉ sửa NEW, không ghi bảng khác -> không có vòng lặp. Lệnh update của 2b đặt chữ = tên
--     nhóm cha mới, rơi vào (3) nhánh "cùng khóa với nhóm gốc hiện tại" nên giữ nguyên category_id.
create or replace function public.sync_item_category_text() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_root_id bigint;
  v_key text;
begin
  -- (1) App mới gửi category_id (INSERT, hoặc UPDATE có đổi category_id; cả 2 cột cùng đổi cũng vào đây)
  if new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    select coalesce(p.name, c.name) into v_name
      from public.item_categories c
      left join public.item_categories p on p.id = c.parent_id
     where c.id = new.category_id;
    if found then
      new.category := v_name;
    end if;
    -- Không tìm thấy nhóm: để khóa ngoại tự từ chối
    return new;
  end if;

  -- (2) App mới bỏ nhóm (category_id -> NULL): giữ nguyên chữ đang gửi
  if tg_op = 'UPDATE' and new.category_id is null and old.category_id is not null then
    return new;
  end if;

  -- (3) App cũ: chỉ chữ category đổi (UPDATE, category_id giữ nguyên), hoặc INSERT không có category_id
  if tg_op = 'INSERT' or new.category is distinct from old.category then
    v_key := public.category_name_key(new.category);
    if v_key = '' then
      new.category_id := null;       -- chữ rỗng = chưa phân nhóm
      return new;
    end if;

    -- Chữ mới chỉ khác cách viết so với nhóm gốc hiện tại của vật tư (kể cả vật tư ở nhóm con):
    -- giữ category_id, chuẩn lại chữ = tên nhóm cha
    if new.category_id is not null then
      select coalesce(p.name, c.name) into v_name
        from public.item_categories c
        left join public.item_categories p on p.id = c.parent_id
       where c.id = new.category_id;
      if found and public.category_name_key(v_name) = v_key then
        new.category := v_name;
        return new;
      end if;
    end if;

    -- Tìm NHÓM GỐC cùng khóa (ưu tiên nhóm đang dùng, sort_order nhỏ, id nhỏ)
    select c.id, c.name into v_root_id, v_name
      from public.item_categories c
     where c.parent_id is null
       and public.category_name_key(c.name) = v_key
     order by c.active desc, c.sort_order, c.id
     limit 1;
    if found then
      new.category_id := v_root_id;
      new.category := v_name;
    else
      new.category_id := null;       -- không có nhóm gốc khớp: bỏ liên kết, GIỮ nguyên chữ
    end if;
    return new;
  end if;

  -- (4) UPDATE không đổi 2 cột (app cũ ghi lại chữ cũ khi sửa tên/giá): chữ = tên nhóm cha
  if new.category_id is not null then
    select coalesce(p.name, c.name) into v_name
      from public.item_categories c
      left join public.item_categories p on p.id = c.parent_id
     where c.id = new.category_id;
    if found then
      new.category := v_name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_item_category_text on public.items;
create trigger trg_sync_item_category_text before insert or update of category_id, category on public.items
  for each row execute function public.sync_item_category_text();

-- 2b. Đổi tên nhóm / đổi nhóm cha: cập nhật lại items.category của vật tư thuộc nhóm đó và các nhóm con.
--     Lệnh update chỉ đặt cột category nên trigger 2a vẫn chạy (nhánh 3: chữ mới cùng khóa với nhóm gốc
--     hiện tại) -> giữ nguyên category_id (kể cả nhóm con) và ra cùng giá trị chữ.
create or replace function public.resync_items_after_category_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name or new.parent_id is distinct from old.parent_id then
    update public.items i
       set category = coalesce(p.name, c.name)
      from public.item_categories c
      left join public.item_categories p on p.id = c.parent_id
     where i.category_id = c.id
       and (c.id = new.id or c.parent_id = new.id)
       and i.category is distinct from coalesce(p.name, c.name);
  end if;
  return null;
end $$;

drop trigger if exists trg_resync_items_after_category_change on public.item_categories;
create trigger trg_resync_items_after_category_change after update of name, parent_id on public.item_categories
  for each row execute function public.resync_items_after_category_change();

revoke execute on function public.guard_item_category_write() from public, anon, authenticated;
revoke execute on function public.guard_item_category_delete() from public, anon, authenticated;
revoke execute on function public.sync_item_category_text() from public, anon, authenticated;
revoke execute on function public.resync_items_after_category_change() from public, anon, authenticated;


-- =====================================================================
-- 3. NẠP DỮ LIỆU NHÓM (idempotent)
-- =====================================================================
-- 3a. 5 nhóm chuẩn (khớp ITEM_CATEGORY_PRESETS). Trùng mã hoặc trùng tên thì bỏ qua.
insert into public.item_categories (name, code, default_kind, default_unit, sort_order) values
  ('Hoa & Lá',              'HOA',   'consumable', 'bó',   10),
  ('Phụ kiện & Vật tư phụ', 'PHU',   'consumable', 'cái',  20),
  ('Khung & Backdrop',      'KHUNG', 'reusable',   'bộ',   30),
  ('Đèn & Ánh sáng',        'DEN',   'reusable',   'cái',  40),
  ('Vải, Rèm & Thảm',       'VAI',   'reusable',   'tấm',  50)
on conflict do nothing;

-- ---------- TÙY CHỌN cho anh Thiện: GỘP 'Hoa Giấy' VÀO 'Hoa & Lá' TRƯỚC KHI CÀI ----------
-- Mặc định 'Hoa Giấy' (khóa 'hoa giay') thành nhóm GỐC RIÊNG, mã nhóm HOA2 (vì HOA đã là 'Hoa & Lá').
-- Nếu KHÔNG muốn nhóm riêng: bỏ comment câu dưới (để nguyên chỗ này, nó chạy TRƯỚC 3b nên 3b không tạo
-- nhóm 'Hoa Giấy'), hoặc chạy riêng sau khi đã chạy mục 1 + 2 + 3a. Hậu quả:
--   * Mọi vật tư đang ghi 'Hoa Giấy' (mọi cách viết: 'hoa giay', 'HOA GIẤY'...) đổi chữ thành 'Hoa & Lá'
--     và được trigger 2a gán luôn vào nhóm 'Hoa & Lá'. Báo cáo / xuất Excel theo nhóm gộp làm một.
--   * Mã vật tư cũ (ví dụ TH-HOA-xxx) GIỮ NGUYÊN (khóa mã + câu này không đụng cột code). Vật tư mới
--     tạo sau đó trong 'Hoa & Lá' ra mã HOA.
--   * Không tự hoàn tác được: muốn tách lại phải dựa vào bản sao lưu (T0) ở mục 8.
--   * Muốn phân biệt hoa giấy về sau: tạo nhóm con 'Hoa Giấy' trong 'Hoa & Lá' bằng giao diện.
--   * Chạy lại lần 2 không đổi gì (không còn dòng 'hoa giay').
-- update public.items set category = 'Hoa & Lá' where public.category_name_key(category) = 'hoa giay';

-- 3b. Tạo nhóm (cấp gốc) cho mọi giá trị items.category chưa có NHÓM GỐC cùng khóa so tên.
--     Gom theo khóa mạnh: 'Hoa Lá', 'hoa la', 'Hoa & Lá' gộp vào nhóm chuẩn 'Hoa & Lá' (không tạo mới).
--     Chỉ xét nhóm GỐC (parent_id is null): có nhóm CON cùng tên vẫn tạo nhóm gốc riêng.
--     Tên hiển thị = cách viết xuất hiện nhiều nhất; loại / đơn vị mặc định chỉ đặt khi mọi vật tư
--     của nhóm cùng một giá trị. Chạy lần 2: khóa đã có nhóm gốc nên bỏ qua.
do $$
declare
  r record;
  v_base text;
  v_code text;
  n int;
begin
  for r in
    with src as (
      select btrim(regexp_replace(i.category, '[\s ]+', ' ', 'g')) as nm, i.kind, i.unit
        from public.items i
       where i.category is not null and btrim(i.category) <> ''
    ), g as (
      select public.category_name_key(nm) as k,
             mode() within group (order by nm) as display_name,
             case when count(distinct kind) = 1 then min(kind) end as dk,
             case when count(distinct unit) = 1 then min(unit) end as du
        from src
       group by public.category_name_key(nm)
    )
    select g.*
      from g
     where g.k <> ''
       and not exists (select 1 from public.item_categories c
                        where c.parent_id is null
                          and public.category_name_key(c.name) = g.k)
     order by g.display_name
  loop
    v_base := public.category_code_from_name(r.display_name);
    v_code := v_base;
    n := 1;
    while exists (select 1 from public.item_categories c where upper(c.code) = v_code) loop
      n := n + 1;
      v_code := left(v_base, 8 - length(n::text)) || n::text;
    end loop;

    insert into public.item_categories (name, code, default_kind, default_unit, sort_order)
    values (r.display_name, v_code, r.dk, r.du, 100)
    on conflict do nothing;
  end loop;
end $$;

-- 3c. Backfill: gán category_id cho vật tư CHƯA có, chỉ vào NHÓM GỐC cùng khóa so tên (không bao giờ
--     gán vào nhóm con cùng tên). Nhiều nhóm gốc cùng khóa: nhóm đang dùng, sort_order nhỏ, id nhỏ.
--     Trigger 2a (nhánh 1) đặt lại items.category = tên nhóm chuẩn, nên CÁCH VIẾT có thể đổi
--     (ví dụ 'hoa la' / 'Hoa Lá' -> 'Hoa & Lá'); xuất sao lưu (T0) trước khi cài để đối chiếu.
--     Chỉ đổi cách viết, không đổi nhóm. Vật tư đã có category_id không bị đụng.
update public.items i
   set category_id = m.cat_id
  from (
    select i2.id as item_id,
           (select c.id
              from public.item_categories c
             where c.parent_id is null
               and public.category_name_key(c.name) = public.category_name_key(i2.category)
             order by c.active desc, c.sort_order, c.id
             limit 1) as cat_id
      from public.items i2
     where i2.category_id is null
       and i2.category is not null
       and btrim(i2.category) <> ''
  ) m
 where i.id = m.item_id
   and m.cat_id is not null;


-- =====================================================================
-- 4. PHÂN QUYỀN (RLS) + CẤP QUYỀN BẢNG
-- =====================================================================
-- GHI CHÚ:
--  * Thủ kho (storekeeper) CHỈ được INSERT nhóm mới: không sửa tên, không đổi nhóm cha, không tắt nhóm
--    (active = false cũng là UPDATE), không xóa. Muốn tắt/sửa nhóm phải là admin/manager.
--  * Vì vậy app phải tạo nhóm bằng INSERT THUẦN (supabase .insert()), KHÔNG dùng .upsert(): upsert
--    là "insert ... on conflict do update", gặp trùng sẽ cần quyền UPDATE -> thủ kho bị RLS từ chối
--    (báo lỗi khó hiểu). Gặp trùng mã/tên thì app báo "nhóm đã có" và chọn nhóm có sẵn.
--  * Hai hàm category_name_key / category_code_from_name là hàm THUẦN (chỉ biến đổi chuỗi, không đọc
--    hay ghi bảng, không security definer) nên để mặc định ai cũng gọi được: vô hại. Các hàm trigger
--    security definer thì đã revoke execute ở mục 2.
alter table public.item_categories enable row level security;

drop policy if exists "item_categories_select" on public.item_categories;
create policy "item_categories_select" on public.item_categories for select
  using (public.has_role(array['admin','manager','storekeeper','staff']));

drop policy if exists "item_categories_insert" on public.item_categories;
create policy "item_categories_insert" on public.item_categories for insert
  with check (public.has_role(array['admin','manager','storekeeper']));

-- Thủ kho được tạo nhóm mới nhưng KHÔNG đổi tên / sửa / xóa
drop policy if exists "item_categories_update" on public.item_categories;
create policy "item_categories_update" on public.item_categories for update
  using (public.has_role(array['admin','manager']))
  with check (public.has_role(array['admin','manager']));

drop policy if exists "item_categories_delete" on public.item_categories;
create policy "item_categories_delete" on public.item_categories for delete
  using (public.has_role(array['admin','manager']));

grant select, insert, update, delete on public.item_categories to authenticated;
-- schema.sql có "grant select on all tables to anon"; bảng này không cần cho khách chưa đăng nhập.
-- (RLS đã chặn anon vì has_role trả false; revoke thêm cho chắc. Chạy lại schema.sql sẽ cấp lại
--  quyền select cho anon nhưng RLS vẫn chặn.)
revoke all on public.item_categories from anon;

do $$
declare
  v_seq text := pg_get_serial_sequence('public.item_categories', 'id');
begin
  if v_seq is not null then
    execute format('grant usage, select on sequence %s to authenticated', v_seq);
  end if;
end $$;


-- =====================================================================
-- 5. KHÓA MÃ VẬT TƯ KHI ĐÃ CÓ PHIẾU KHO
-- =====================================================================
-- security definer: cần thấy MỌI phiếu kho bất kể RLS.
-- Chỉ coi là "đổi mã" khi upper(btrim(cũ)) khác upper(btrim(mới)): app luôn trim().toUpperCase() khi
-- lưu, nên mã cũ chữ thường / có khoảng trắng thừa (ví dụ ' th-hoa-001') vẫn sửa tên/giá được; lần lưu
-- đó mã được ghi lại dạng chuẩn 'TH-HOA-001' (cùng mã, chỉ khác cách viết). Xem câu kiểm tra T3.
create or replace function public.lock_item_code_after_movements() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Vật tư chưa có mã: cho cấp mã lần đầu
  if old.code is null or btrim(old.code) = '' then
    return new;
  end if;

  if exists (select 1 from public.stock_movements m where m.item_id = old.id) then
    raise exception 'Không đổi được mã vật tư "%": vật tư đã có phiếu kho. Mã đã in trên phiếu/nhãn nên phải giữ nguyên.', old.code;
  end if;

  -- Phiếu chuyển kho (bảng có ở finance_schema.sql; chưa chạy file đó thì bỏ qua)
  if to_regclass('public.stock_transfers') is not null then
    if exists (select 1 from public.stock_transfers t where t.item_id = old.id) then
      raise exception 'Không đổi được mã vật tư "%": vật tư đã có phiếu chuyển kho.', old.code;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.lock_item_code_after_movements() from public, anon, authenticated;

drop trigger if exists trg_lock_item_code_after_movements on public.items;
create trigger trg_lock_item_code_after_movements before update of code on public.items
  for each row
  when (upper(btrim(old.code)) is distinct from upper(btrim(new.code)))
  execute function public.lock_item_code_after_movements();


-- =====================================================================
-- 6. VIEW item_stock: THÊM CỘT category_id VÀO CUỐI
-- =====================================================================
-- View tạo bằng "i.*" nên cột mới của items KHÔNG tự có trong view. create or replace view chỉ cho
-- thêm cột ở CUỐI, nên khối dưới đọc danh sách cột hiện có của view, giữ nguyên thứ tự, rồi nối
-- category_id ở cuối. Có sẵn category_id rồi thì bỏ qua (chạy lại không đổi gì). Cột chữ category
-- trong view vẫn là items.category (đã được trigger đồng bộ), các view phụ thuộc
-- (warehouse_asset_value, warehouse_share) không bị ảnh hưởng.
-- Nếu cấu trúc view khác dự kiến thì chỉ báo NOTICE và bỏ qua (app vẫn đọc category_id từ items).
do $$
declare
  v_view oid := to_regclass('public.item_stock');
  v_cols text;
  v_bad text;
  v_max_item_col int;
  v_min_agg_col int;
  v_agg_count int;
begin
  if v_view is null then
    raise notice 'Chưa có view item_stock, bỏ qua mục 6.';
    return;
  end if;

  if exists (select 1 from pg_attribute a
              where a.attrelid = v_view and a.attname = 'category_id' and not a.attisdropped) then
    return;   -- đã có
  end if;

  select count(*), min(a.attnum) into v_agg_count, v_min_agg_col
    from pg_attribute a
   where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped
     and a.attname in ('in_stock','at_project','in_repair','lost_total');

  select max(a.attnum),
         string_agg(format('i.%I', a.attname), ', ' order by a.attnum)
    into v_max_item_col, v_cols
    from pg_attribute a
   where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('in_stock','at_project','in_repair','lost_total');

  select string_agg(a.attname, ', ') into v_bad
    from pg_attribute a
   where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('in_stock','at_project','in_repair','lost_total')
     and not exists (select 1 from pg_attribute b
                      where b.attrelid = 'public.items'::regclass
                        and b.attname = a.attname and b.attnum > 0 and not b.attisdropped);

  if v_agg_count <> 4 or v_bad is not null or v_cols is null or v_max_item_col > v_min_agg_col then
    -- DỪNG (quay lui cả file) thay vì chỉ báo NOTICE: nếu bỏ qua, app mới không đọc được items.category_id
    -- từ view item_stock và sẽ làm vật tư mất liên kết nhóm. Gửi kết quả câu T2 cho người hỗ trợ để sửa khối này.
    raise exception 'View item_stock có cấu trúc khác dự kiến (cột lạ: %). Đã dừng, không có gì bị thay đổi. Chạy câu kiểm tra T2 và gửi kết quả để sửa mục 6.', coalesce(v_bad, '-');
  end if;

  execute format($v$
    create or replace view public.item_stock with (security_invoker = on) as
    select
      %s,
      coalesce(sum(case
        when m.type in ('purchase','return_good','repair_done','adjust') then m.qty
        when m.type = 'issue' then -m.qty else 0 end), 0) as in_stock,
      case when i.kind = 'reusable' then coalesce(sum(case
        when m.type = 'issue' then m.qty
        when m.type in ('return_good','return_damaged','return_lost') then -m.qty else 0 end), 0)
        else 0 end as at_project,
      coalesce(sum(case
        when m.type = 'return_damaged' then m.qty
        when m.type in ('repair_done','dispose') then -m.qty else 0 end), 0) as in_repair,
      coalesce(sum(case when m.type = 'return_lost' then m.qty else 0 end), 0) as lost_total,
      i.category_id
    from public.items i
    left join public.stock_movements m on m.item_id = i.id
    group by i.id
  $v$, v_cols);
end $$;

-- Báo PostgREST (API Supabase) nạp lại cấu trúc bảng để app thấy bảng/cột mới ngay.
notify pgrst, 'reload schema';


-- =====================================================================
-- 7. RỦI RO / GIỚI HẠN ĐÃ BIẾT
-- =====================================================================
--  * SAU KHI CHẠY FILE NÀY, KHÔNG chạy lại schema.sql nguyên file: câu create or replace view
--    item_stock trong đó dùng "i.*" sẽ chèn category_id vào GIỮA view và báo lỗi
--    "cannot change name of view column". (Việc thêm bất kỳ cột nào vào items đều gây lỗi này.)
--    Khi cần sửa schema.sql, đổi view sang danh sách cột tường minh giống mục 6.
--  * Khóa so tên (category_name_key) bỏ dấu TRƯỚC khi lower() nên chữ tiếng Việt không phụ thuộc
--    collation. Còn phụ thuộc: (a) chỉ mục unique lower(name) với chữ có dấu (Supabase thường là
--    en_US.UTF-8 nên 'Đ' -> 'đ' đúng; collation "C" thì chỉ hạ chữ ASCII) — xem T5; (b) chữ ngoài tiếng
--    Việt có dấu lạ / chữ không phải Latin: [:alnum:] theo locale DB, có thể lệch nhẹ với JS \p{L}\p{N}.
--  * Chỉ mục unique tên chỉ dùng lower(name): DB vẫn cho 2 nhóm cùng cha 'Hoa & Lá' và 'Hoa La' (khác
--    dấu câu / dấu) nếu ghi bằng SQL tay; app chặn phía client. Khi đó so khớp chọn nhóm đang dùng,
--    sort_order nhỏ, id nhỏ. Kiểm bằng câu (C2) sau khi cài.
--  * App cũ (chỉ gửi chữ category): đổi sang chữ KHÔNG khớp nhóm gốc nào -> category_id = NULL (vật tư
--    rời nhóm, giữ chữ; app hiện như nhóm ảo). App cũ không đưa được vật tư vào NHÓM CON (chữ luôn là
--    tên nhóm cha); đổi vật tư đang ở nhóm con sang nhóm gốc khác thì vật tư rời nhóm con (đúng ý).
--    Chữ trùng tên một nhóm CON nhưng không trùng nhóm gốc nào -> không gán (chỉ khớp nhóm gốc).
--  * App mới gửi CẢ category_id và category: category_id thắng, chữ bị ghi đè bằng tên nhóm cha.
--    App mới chỉ gửi category_id = NULL để bỏ nhóm: chữ giữ nguyên, không tự gán lại nhóm.
--  * Khóa mã cho phép đổi mã CHỈ khác hoa/thường/khoảng trắng đầu cuối (lần lưu ghi lại dạng chuẩn).
--    Mã cũ có khoảng trắng GIỮA mã hoặc ký tự lạ thì vẫn bị coi là khác -> chuẩn hóa trước bằng T3.
--  * Thủ kho chỉ INSERT nhóm: app dùng upsert sẽ lỗi RLS (xem ghi chú mục 4).
--  * Gộp 'Hoa Giấy' (khối tùy chọn 3b) không tự hoàn tác; giữ file xuất T0.
--  * Khóa mã áp cho MỌI người kể cả SQL Editor. Khi thật sự cần sửa mã sai của vật tư đã có phiếu:
--    begin; alter table public.items disable trigger trg_lock_item_code_after_movements;
--    update ...; alter table public.items enable trigger trg_lock_item_code_after_movements; commit;
--  * Mẫu set (set_templates.category) là nhóm MẪU SET, không phải nhóm vật tư: file này không đụng.
--  * Vật tư gán vào nhóm con: items.category hiện tên nhóm cha, báo cáo theo nhóm con phải dùng
--    category_id.
--  * category_name_key có khối exception (mỗi lần gọi là 1 subtransaction nhỏ) và trigger 2a / 3c gọi
--    nó cho từng nhóm khi tìm: bảng nhóm chỉ vài chục dòng nên chậm không đáng kể; nếu sau này có hàng
--    trăm nhóm và import hàng nghìn vật tư một lúc thì cân nhắc thêm cột khóa lưu sẵn.
--  * Trigger 2a chạy cả khi import / SQL tay: ghi chữ category không khớp nhóm gốc nào sẽ làm
--    category_id = NULL dù trước đó có nhóm (cố ý, theo nghĩa "đổi nhóm" của app cũ).
--  * Xóa nhóm cha và nhóm con trong CÙNG một lệnh delete vẫn bị chặn (trigger xét từng dòng):
--    xóa nhóm con trước, nhóm cha sau.
--  * Tên nhóm không trùng chỉ xét trong cùng nhóm cha: nhóm con 'Khác' có thể có ở nhiều nhóm cha.


-- =====================================================================
-- 8. CÂU KIỂM TRA (bỏ comment từng khối để chạy; khối thử ghi luôn bọc begin ... rollback)
-- =====================================================================
-- ---- TRƯỚC KHI CÀI ----
-- (T0) SAO LƯU: chạy rồi bấm Export / Download CSV, cất file. Backfill (3c) và trigger 2a có thể đổi
--      CÁCH VIẾT items.category ('hoa la' -> 'Hoa & Lá'); khối tùy chọn gộp 'Hoa Giấy' đổi hẳn nhóm.
-- select id, code, category from public.items order by id;
--
-- (T1) Các giá trị nhóm chữ đang có và số vật tư (để biết sẽ tạo những nhóm nào):
-- select btrim(regexp_replace(category, '\s+', ' ', 'g')) as nhom, count(*) as so_vat_tu,
--        string_agg(distinct kind, ',') as loai, string_agg(distinct unit, ',') as don_vi
--   from public.items where category is not null and btrim(category) <> ''
--  group by 1 order by 1;
--
-- (T2) Cột view item_stock hiện tại (mục 6 cần: các cột của items trước, 4 cột tồn ở cuối):
-- select attnum, attname from pg_attribute
--  where attrelid = 'public.item_stock'::regclass and attnum > 0 and not attisdropped order by attnum;
--
-- (T3) Mã vật tư CHƯA chuẩn (chữ thường / khoảng trắng thừa). Nên chuẩn hóa TRƯỚC khi cài (lúc đó
--      khóa mã chưa có), ví dụ sau khi xem kỹ danh sách:
--        update public.items set code = upper(btrim(code)) where code <> upper(btrim(code));
--      (kiểm tra không trùng với mã khác trước khi chạy). Khoảng trắng GIỮA mã thì sửa tay từng dòng.
-- select id, code, upper(btrim(code)) as ma_chuan, name from public.items
--  where code <> upper(btrim(code)) order by id;
--
-- (T4) Mã vật tư rỗng (khóa mã không sửa được về sau nếu đã có phiếu kho; mã rỗng vẫn cấp được):
-- select id, code, name from public.items where code is null or btrim(code) = '' order by id;
--
-- (T5) Collation có hạ chữ có dấu không (phải ra 'đèn & ánh sáng'; chỉ ảnh hưởng chỉ mục unique tên):
-- select lower('ĐÈN & ÁNH SÁNG');
--
-- (T6) Các cách viết sẽ bị GỘP theo khóa so tên (cần hàm category_name_key: chạy riêng khối tạo hàm ở
--      mục 1 trước — vô hại, không đổi dữ liệu). Dòng có nhiều cách viết = sẽ gộp làm một nhóm:
-- select public.category_name_key(category) as khoa, string_agg(distinct category, ' | ') as cach_viet,
--        count(*) as so_vat_tu
--   from public.items where category is not null and btrim(category) <> ''
--  group by 1 order by 1;
--   Kiểm hàm (phải ra 'hoa la', 'hoa la', 'hoa la', 'hoa giay', 'den anh sang 2', ''):
-- select public.category_name_key('hoa la'), public.category_name_key('Hoa & Lá'),
--        public.category_name_key(' HOA  LÁ '), public.category_name_key('Hoa Giấy'),
--        public.category_name_key('ĐÈN /  Ánh sáng — 2!'), public.category_name_key(null);
--
-- ---- SAU KHI CÀI ----
-- (A) Bảng nhóm (5 nhóm chuẩn + nhóm tạo từ dữ liệu cũ):
-- select id, code, name, parent_id, default_kind, default_unit, sort_order, active
--   from public.item_categories order by sort_order, name;
--
-- (B) Vật tư còn chưa gán nhóm (chỉ nên là vật tư có category rỗng):
-- select id, code, name, category from public.items where category_id is null order by name;
--
-- (C) items.category lệch tên nhóm cha (phải ra 0 dòng):
-- select i.id, i.name, i.category, coalesce(p.name, c.name) as ten_nhom
--   from public.items i
--   join public.item_categories c on c.id = i.category_id
--   left join public.item_categories p on p.id = c.parent_id
--  where i.category is distinct from coalesce(p.name, c.name);
--
-- (C2) Nhóm gốc trùng khóa so tên (phải ra 0 dòng; có thì gộp bằng giao diện):
-- select public.category_name_key(name) as khoa, string_agg(name || ' #' || id, ' | ') as nhom
--   from public.item_categories where parent_id is null
--  group by 1 having count(*) > 1;
--
-- (D) 5 trigger tồn tại (phải ra 5 dòng):
-- select tgrelid::regclass as bang, tgname, tgfoid::regproc as ham from pg_trigger
--  where not tgisinternal and tgname in (
--    'trg_guard_item_category_write', 'trg_guard_item_category_delete',
--    'trg_resync_items_after_category_change', 'trg_sync_item_category_text',
--    'trg_lock_item_code_after_movements')
--  order by 1, 2;
--
-- (E) View item_stock có category_id ở cuối:
-- select id, name, category, category_id, in_stock from public.item_stock order by name limit 20;
--
-- (F) Sinh mã từ tên (phải ra BAN, KEO, HOA, DEN, VT):
-- select public.category_code_from_name('Bàn Ghế'), public.category_code_from_name('Keo nến'),
--        public.category_code_from_name('Hoa Giấy'), public.category_code_from_name('Đèn'),
--        public.category_code_from_name('&&');
--
-- (G) Thử chặn 3 cấp và tự trỏ (mỗi câu phải báo lỗi; chạy RIÊNG từng khối):
-- begin;
--   insert into public.item_categories (name, code, parent_id)
--     select 'Thu con', 'THUCON', id from public.item_categories where code = 'HOA';
--   insert into public.item_categories (name, code, parent_id)
--     select 'Thu chau', 'THUCHAU', id from public.item_categories where code = 'THUCON';
--   -- phải báo: Chỉ có 2 cấp: "Thu con" đã là nhóm con...
-- rollback;
-- begin;
--   update public.item_categories set parent_id = id where code = 'HOA';
--   -- phải báo lỗi (check constraint hoặc 'Nhóm không thể là nhóm cha của chính nó.')
-- rollback;
--
-- (H) Thử trùng tên khác hoa/thường trong cùng cha và trùng mã (phải báo duplicate key):
-- begin;
--   insert into public.item_categories (name, code) values ('  hoa  &  lá ', 'HOAX');
-- rollback;
-- begin;
--   insert into public.item_categories (name, code) values ('Nhom thu', 'hoa');   -- tự in hoa -> trùng HOA
-- rollback;
--
-- (I) Thử xóa nhóm còn vật tư (phải báo 'Không xóa được nhóm "Hoa & Lá": còn ... vật tư...'):
-- begin;
--   delete from public.item_categories where code = 'HOA';
-- rollback;
--
-- (J) Thử gán vật tư vào nhóm con -> items.category = tên nhóm cha. Đổi <item_id>:
-- begin;
--   insert into public.item_categories (name, code, parent_id)
--     select 'Hoa lụa thử', 'HLTHU', id from public.item_categories where code = 'HOA';
--   update public.items set category_id = (select id from public.item_categories where code = 'HLTHU')
--    where id = <item_id> returning id, category_id, category;   -- category phải là 'Hoa & Lá'
--   update public.item_categories set name = 'Hoa & Lá (đổi tên thử)' where code = 'HOA';
--   select id, category from public.items where id = <item_id>;   -- phải là 'Hoa & Lá (đổi tên thử)'
-- rollback;
--
-- (K) Thử đổi mã vật tư ĐÃ có phiếu kho (phải báo 'Không đổi được mã vật tư ...'). Đổi <item_id>:
-- begin;
--   update public.items set code = code || '-X' where id = <item_id>;
-- rollback;
--
-- (L) Vật tư CHƯA có phiếu kho vẫn đổi mã được (phải KHÔNG lỗi):
-- begin;
--   update public.items set code = code || '-X'
--    where id = (select i.id from public.items i
--                 where i.code is not null
--                   and not exists (select 1 from public.stock_movements m where m.item_id = i.id)
--                 limit 1)
--   returning id, code;
-- rollback;
--
-- (L2) Khóa mã không chặn khi chỉ khác hoa/thường/khoảng trắng (phải KHÔNG lỗi, kể cả vật tư có phiếu):
-- begin;
--   update public.items set code = ' ' || lower(code) || ' ' where id = <item_id>
--    returning id, code;   -- phải KHÔNG lỗi (cùng mã, chỉ khác cách viết)
-- rollback;
--
-- (M) RLS: thủ kho tạo được nhưng không sửa được (giả lập phiên; <uuid_thu_kho> là id tài khoản
--     storekeeper trong profiles). Lệnh update phải ra 0 dòng (RLS ẩn dòng, không báo lỗi):
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid_thu_kho>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   insert into public.item_categories (name, code) values ('Nhom thu kho tao', 'TKTAO') returning id;
--   update public.item_categories set name = 'Doi ten' where code = 'TKTAO' returning id;   -- 0 dòng
-- rollback;
--
-- (N) Giả lập APP CŨ (chỉ gửi chữ). Đổi <item_id> (vật tư đang ở 'Hoa & Lá'):
-- begin;
--   update public.items set category = 'đèn & ánh sáng' where id = <item_id>
--    returning id, category_id, category;   -- category_id = id nhóm DEN, category = 'Đèn & Ánh sáng'
--   update public.items set category = 'Nhóm chưa có xyz' where id = <item_id>
--    returning id, category_id, category;   -- category_id NULL, category = 'Nhóm chưa có xyz'
--   update public.items set name = name where id = <item_id>
--    returning id, category_id, category;   -- không đụng cột nhóm: không đổi
-- rollback;
-- begin;
--   insert into public.items (code, name, kind, unit, category)
--   values ('TEST-XOA-001', 'Vật tư thử', 'consumable', 'cái', 'hoa la')
--   returning id, category_id, category;     -- category_id = id nhóm HOA, category = 'Hoa & Lá'
-- rollback;
--   (Nếu insert báo thiếu cột bắt buộc của items thì thêm cột đó; khối bọc rollback nên không lưu.)
--
-- (O) Giả lập APP MỚI gửi cả 2 cột lệch nhau: category_id thắng. Đổi <item_id>:
-- begin;
--   update public.items
--      set category_id = (select id from public.item_categories where code = 'DEN'), category = 'Hoa & Lá'
--    where id = <item_id> returning id, category_id, category;   -- category = 'Đèn & Ánh sáng'
-- rollback;
