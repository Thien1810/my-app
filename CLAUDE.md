# CLAUDE.md — Đặng Wedding (my-app)

Hệ thống quản lý kho vật tư, dự án trang trí cưới, báo giá và truyền thông Facebook cho chủ dự án (anh Thiện — Đặng Wedding). Bối cảnh nghiệp vụ đầy đủ nằm ở `CONTEXT-DU-AN.md`: **đọc file đó trước khi sửa logic nghiệp vụ, phân quyền hoặc giao diện.** File này chỉ tóm tắt những gì cần biết để làm việc nhanh và an toàn.

## Tech stack
Vite + React 19 + React Router 7 + Supabase (Auth, PostgreSQL, RLS) + Recharts + SheetJS (`xlsx`) + HTML5 Canvas (nén ảnh, watermark) + CSS thuần. Tông màu chủ đạo xanh lá `#16a34a` / `#14532d`, tối giản, phải dùng tốt trên cả desktop và mobile.

## Lệnh thường dùng
Chạy trong thư mục `my-app` (đường dẫn Windows: `D:\0. AI\1.Vibe code app\my-app`, shell là PowerShell).

```powershell
npm install        # cài thư viện
npm run dev        # chạy dev (Vite)
npm run lint       # oxlint
npm run build      # build production, dùng để kiểm tra trước khi commit
npm run preview    # xem thử bản build
```

Dự án **chưa có test tự động**. Tiêu chí hoàn thành tối thiểu cho mọi thay đổi: `npm run lint` không lỗi mới và `npm run build` thành công. Khi sửa logic tính toán trong `src/lib/calc.js` hoặc `src/lib/formatters.js`, đề xuất viết test (ví dụ Vitest) trước khi sửa.

## Cấu trúc chính
- `src/pages/`: các trang (Dashboard, Items, Projects, ProjectDetail, Movements, Reports, Templates, Users, Auth...).
- `src/components/`: thành phần dùng lại (`CurrencyInput`, `ProjectQuoteTab`, `ProjectFacebookTab`, `Layout`...).
- `src/lib/`: logic dùng chung. Quan trọng nhất: `calc.js` (tồn kho, thu hồi, lãi/lỗ), `formatters.js` (tiền tệ, sinh mã), `imageCompressor.js`, `quoteExporter.js`, `watermarkHelper.js`, `AuthContext.jsx`, `supabase.js`.
- `supabase/schema.sql`: toàn bộ bảng, view, trigger, RLS. Viết theo kiểu idempotent (chạy lại nhiều lần không lỗi), giữ nguyên tính chất này khi sửa.
- `api/`, `vercel.json`: cấu hình Vercel (rewrite SPA).

## Quy tắc nghiệp vụ không được phá
- **Hai loại vật tư:** tiêu hao (`consumable`, mã `TH`) và tái sử dụng (`reusable`, mã `TSD`). Luồng xuất, thu hồi (`return_good`, `return_damaged`, `return_lost`), sửa (`repair_done`) và thanh lý (`dispose`) được mô tả ở mục 2.1 của `CONTEXT-DU-AN.md`.
- **Mã tự động:** vật tư `[TH|TSD]-[NHÓM]-[3 số]`, dự án `DA-[YYMM]-[3 số]`. Giữ cơ chế chống trùng 3 lớp.
- **Tiền tệ:** luôn dùng dấu chấm ngăn cách hàng nghìn (`1.000.000`), cả khi hiển thị lẫn khi nhập. Dùng `formatPriceDots`, `formatCurrency`, `CurrencyInput`.
- **Ảnh tải lên:** luôn nén xuống dưới 1MB bằng `imageCompressor.js`.
- **Báo giá cho khách:** chỉ hiện hình ảnh mẫu, tên mẫu set, tên vật tư trong gói và **GIÁ TRỊ HỢP ĐỒNG** trọn gói. **Tuyệt đối không hiện số lượng từng vật tư và không lấy giá vốn trong kho.**
- **Phân quyền 4 vai trò** (`admin`, `manager`, `storekeeper`, `staff`): xem mục 3 của `CONTEXT-DU-AN.md`. Mọi thay đổi giao diện phải giữ đúng việc ẩn/hiện doanh thu, lãi/lỗ, chi phí khác theo vai trò, và phải khớp với RLS trong `schema.sql`.

## Điều cấm / cần hỏi trước
- **Không tự `git push`.** Push lên `main` làm Vercel tự deploy lên domain chính thức `app.dangwed.com`. Chỉ commit trên nhánh làm việc; push, merge vào `main` hoặc deploy chỉ khi anh Thiện yêu cầu rõ.
- Không sửa, in ra hay commit `.env.local` và mọi file `.env*` (trừ `.env.example`). Biến môi trường dùng tiền tố `VITE_`; **tuyệt đối không đưa `service_role` key của Supabase vào code phía client.**
- Không chạy lệnh làm đổi dữ liệu thật trên Supabase (xóa bảng, xóa dữ liệu, thay đổi RLS) khi chưa hỏi. Thay đổi schema phải thêm vào `supabase/schema.sql` và báo anh Thiện tự chạy trên Supabase.
- Không xóa thư mục `dist/`, `public/` (logo, watermark) và không đổi tên hai file `watermark-white.png`, `watermark-black.png`.
- Không thêm thư viện mới khi chưa nói rõ lý do.

## Quy ước làm việc
- Giao diện và thông báo cho người dùng bằng **tiếng Việt**; tên biến, hàm theo kiểu code hiện có.
- Sửa nhỏ, tập trung. Không tái cấu trúc lớn khi chỉ được nhờ sửa một lỗi.
- Commit message ngắn, tiếng Việt không dấu như hiện tại (ví dụ `Sua loi bao gia`).
- Sau mỗi thay đổi: chạy `npm run lint` và `npm run build`, báo kết quả, và tóm tắt file đã sửa.

## Tài liệu liên quan
- `CONTEXT-DU-AN.md`: bối cảnh và nghiệp vụ đầy đủ (nguồn chính).
- `HUONG-DAN.md`: cài đặt kỹ thuật. `HUONG-DAN-SU-DUNG.md`: cẩm nang cho đội ngũ.
- Thư mục `..\.agents\rules\project-context.md`: bản quy tắc cũ của Antigravity (trùng nội dung với `CONTEXT-DU-AN.md`).

## Khi nén ngữ cảnh (compact), phải giữ lại
- Danh sách lỗi tính tiền đã tìm ra và trạng thái: mất vật tư tiêu hao bị tính 2 lần, Ads bị trừ 2 lần, ROAS chia trên toàn bộ doanh thu, số lượng âm không bị chặn, chi phí khác âm làm giảm tổng chi phí, nhận diện Ads bằng kind.includes('ads').
- Các test đang it.todo hoặc gắn nhãn "hành vi hiện tại, đang sai" trong src/lib/calc.test.js.
- Các quyết định của anh Thiện (dùng Supabase làm nguồn dữ liệu duy nhất; câu hỏi ưu đãi trong giá trị hợp đồng nếu đã được trả lời).
- Nhánh đang làm: claude-migration. Chưa push, chưa chạy SQL nào lên Supabase.

## Tiết kiệm token
- Mỗi lỗi một phiên: xong thì /clear. Dùng /compact khi phiên dài.
- Chỉ đọc đúng file cần, không quét cả project.
- Việc lớn thì trình bày kế hoạch trước, chờ duyệt rồi mới sửa.

## Quyết định đã chốt (anh Thiện, 2026-11-24)
- Ưu đãi: **doanh số** = giá gói gốc (ví dụ 10.000.000); **ưu đãi** = phần giảm cho khách (1.000.000); **doanh thu** = doanh số − ưu đãi (9.000.000). Chi phí được tính trên doanh thu để ra biên lợi nhuận. Cần thêm trường ưu đãi; hiện `calc.js` chưa có (test đang khẳng định không có `discount`). FINANCE_SPEC.md (I) đang ghi doanh thu = Σ contract_value, phải đối chiếu lại khi làm.
- Số lượng âm: chặn ngay ở form nhập, không cho nhập số âm.
- Chi phí Ads: chỉ nhận diện qua bảng `ads_spend`, bỏ cách `kind.includes('ads')`.
