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
- Ưu đãi: **doanh số** = giá gói gốc (ví dụ 10.000.000); **ưu đãi** = phần giảm cho khách (1.000.000); **doanh thu** = doanh số − ưu đãi (9.000.000). Chi phí tính trên doanh thu để ra biên lợi nhuận. **Đã chốt: `contract_value` lưu 9.000.000 (= doanh thu, là số khách thực trả, là số hiện trên báo giá).** Doanh số = contract_value + ưu đãi. Vì vậy FINANCE_SPEC (I) giữ nguyên, `calc.js` doanh thu không đổi. Cần làm: (1) thêm cột ưu đãi vào DB (hiện ưu đãi chỉ nằm trong localStorage của `ProjectQuoteTab`, mất khi đổi máy); (2) sửa `ProjectQuoteTab` (dòng `finalTotal = contract - discount` sẽ trừ ưu đãi lần hai); (3) dự án cũ đang lưu contract_value là giá gốc, cần quyết định chuyển đổi; (4) đổi test "cần xác nhận" ở calc.test.js.
- Số lượng âm: chặn ngay ở form nhập, không cho nhập số âm. **Ngoại lệ đã chốt: tab "Điều chỉnh" tồn kho (MovementsPage) vẫn cho nhập âm để điều chỉnh giảm.**
- Chi phí Ads: chỉ nhận diện qua bảng `ads_spend`, bỏ cách `kind.includes('ads')`.

## Trạng thái lỗi tính tiền (cập nhật 2026-11-24)
- ĐÃ SỬA: mất vật tư tiêu hao tính 2 lần (95b0684); nhận diện Ads bằng kind.includes('ads') và adsCostTotal đã bỏ khỏi calc.js, Ads chỉ ghi ở ads_spend (20c49ae); số lượng âm bị chặn ở các form nhập (f3ec3f8, trừ tab "Điều chỉnh" ở MovementsPage giữ cho nhập âm theo quyết định của anh Thiện).
- CÒN LẠI: chi phí khác âm làm giảm tổng chi phí; ROAS chia trên toàn bộ doanh thu (it.todo); Ads bị trừ 2 lần ở P&L (it.todo, sửa khi làm lại sổ Ads); ưu đãi chưa lưu DB, báo giá và ảnh PNG đang trừ ưu đãi lần hai (cần làm lại khối tiền dự án).
- Dữ liệu localStorage cũ (ưu đãi, sổ Ads nhập tay) là số thử, bỏ hết, không chuyển.
- SQL tài chính đã tách 2 file (be7ec41), CHƯA chạy lên Supabase.

## Tiến độ làm lại luồng tiền (cập nhật 2026-11-24, cuối buổi)
- XONG và đã commit: tách SQL thành finance_schema.sql + finance_data_migration.sql, anh Thiện đã chạy finance_schema.sql trên Supabase (chưa xác nhận kết quả 4 câu kiểm tra) và đã chạy thêm 2 dòng sửa chỉ mục uq_ads_spend_external; financeApi.js (tầng dữ liệu); doanh số/ưu đãi/doanh thu (ContractValueFields, ProjectsPage, ProjectQuoteTab, quoteExporter, calc.js trả thêm grossSales, discount, marginPct); chặn số âm ở form; bỏ adsCostTotal.
- CÒN LẠI (theo thứ tự đề xuất): (1) WebsiteAdminPage.jsx ~dòng 357 chèn contract_value vào bảng projects (cột không tồn tại, nút chuyển lead thành dự án có thể đang lỗi) và vẫn ghi [DW_ATTR] thay vì cột lead_source/warehouse_code; (2) sổ Ads dùng bảng ads_spend thay localStorage (dw_ads_spend_logs_v1) và tách MetaAdsManagerTab bằng một hook dữ liệu chung + 3 panel, sửa ROAS (chỉ doanh thu đám từ Ads) và điểm hòa vốn (bỏ số 4.000.000 cứng); (3) chi phí khác âm; (4) trang chi tiết dự án hiện doanh số, ưu đãi, biên cho admin; (5) tạm ứng/còn phải thu, chuyển kho, khóa sổ.
- CHỜ ANH THIỆN QUYẾT: ẩn ưu đãi với thủ kho ở mức DB (hiện RLS project_finance cho thủ kho đọc/ghi cả bảng, chỉ giao diện giấu ưu đãi).
- Quy trình: em làm bộ não, giao worker (Sonnet viết, Haiku đọc, Opus review độc lập), mình tự đọc diff và chạy test/lint/build trước khi commit.

## Tiến độ sổ Ads và P&L (cập nhật 2026-11-24, cuối buổi)
- XONG và đã commit: nguồn khách/đầu kho ghi vào cột lead_source/warehouse_code (bỏ thẻ [DW_ATTR]; đã sửa nút chuyển lead thành dự án); pnl.js (công thức P&L thuần, test theo FINANCE_SPEC); pnlHistory.js (lịch sử hòa vốn 3 tháng, gom theo nguồn, resolveShares dùng share_snapshot khi tháng đã khóa); hook useFinanceData; panel Sổ Ads, Chi phí cứng, P&L; MetaAdsManagerTab thành container mỏng; ROAS chỉ tính doanh thu đám từ Ads; hòa vốn không còn số 4.000.000; token Meta và localStorage tài chính cũ bị xóa khi mở tab P&L.
- ĐÃ BỎ KHỎI BẢN MỚI (làm lại sau): đồng bộ Meta + ô token (Task 4: không lưu token ở trình duyệt), nút nạp số liệu mẫu, bảng "3 mốc vàng".
- CÒN LẠI: quyết định có tính chi phí kênh Google/Khác vào CAC/ROAS không (hiện tính mọi kênh Ads, chỉ đám nguồn meta_ads/tiktok_ads được coi là đám từ Ads); phân trang truy vấn ở ReportsPage (giới hạn 1000 dòng Supabase); nút Khóa sổ tháng (financeApi.lockMonth có sẵn, chưa có nút); tạm ứng/còn phải thu + thu nhập khác (forfeit) vào P&L (calcPnl nhận advances, container đang truyền []); chuyển kho; lưu mẫu chi phí cứng chưa atomic; chi phí khác âm (calc.js); trang chi tiết dự án hiện doanh số/ưu đãi/biên; ẩn ưu đãi với thủ kho ở mức DB (RLS).
- CHƯA KIỂM CHỨNG: toàn bộ giao diện mới chưa được chạy thử trên trình duyệt/Supabase thật. Cần anh Thiện thử `npm run dev` (Báo cáo, tab P&L; Dự án, tab Báo giá).

## Tiến độ tạm ứng và còn phải thu (cập nhật 2026-11-24, cuối buổi)
- XONG và đã commit: advances.js (summarizeAdvances, validateAdvanceInput, canDeleteAdvance, monthlyCashIn, toAdvanceRow) kèm test; ProjectAdvancesPanel trong tab Tổng kết & Lãi/Lỗ của dự án (chỉ admin/manager); mất cọc (forfeit) chỉ ghi được cho dự án đã hủy, chặn ở tháng đã khóa sổ (chỉ phía trình duyệt); P&L dòng VII thu nhập khác gán thẳng vào kho của dự án (không có kho thì chia theo share), có thêm dòng tiền cọc thu trong tháng (chỉ theo dõi, không vào P&L); trang Báo cáo gom còn 3 tab nhóm (Kho & Cảnh báo, Hiệu quả vật tư, Tài chính).
- CÒN LẠI: trigger SQL khóa sổ cho project_advances (hiện chỉ chặn ở giao diện, cần anh Thiện chạy nếu muốn chặn thật); quyết định chi phí kênh Google/Khác có vào CAC/ROAS không; nút Khóa sổ tháng; chuyển kho; đồng bộ Meta không lưu token; phân trang truy vấn ở Báo cáo; chi phí khác âm; trang chi tiết dự án hiện doanh số/ưu đãi/biên; ẩn ưu đãi với thủ kho ở mức DB.
- CHƯA KIỂM CHỨNG: ghi/xóa tạm ứng thật trên Supabase, tài khoản thủ kho/nhân viên, giao diện điện thoại. Anh Thiện cần thử `npm run dev`.
