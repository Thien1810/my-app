# 🌿 BỐI CẢNH & KIẾN TRÚC DỰ ÁN — ĐẶNG WEDDING (DÀNH CHO AI AGENT & LẬP TRÌNH VIÊN)

> **Hướng dẫn cho AI Agent (Antigravity):** Khi làm việc với dự án này trên tài khoản mới hoặc phiên trò chuyện mới, hãy đọc kỹ toàn bộ file này trước khi chỉnh sửa code để giữ đúng quy tắc nghiệp vụ, phân quyền và phong cách thiết kế của chủ dự án (**Anh Thiện — Đặng Wedding**).

---

## 1. Thông tin tổng quan & Hạ tầng triển khai

| Hạng mục | Chi tiết |
|---|---|
| **Tên thương hiệu / Dự án** | **Đặng Wedding** — Hệ thống Quản lý Kho Vật tư, Dự án Trang trí Cưới, Báo giá & Truyền thông Facebook |
| **Thông tin liên hệ trên ấn phẩm** | Khu vực: **Đồng Nai - TP.HCM** • SĐT / Zalo: **0918.80.90.96** |
| **Thư mục Source Code trên máy** | `d:\0. AI\1.Vibe code app\my-app` |
| **GitHub Repository** | `https://github.com/Thien1810/my-app.git` (nhánh `main`, user: `Thien1810`, email: `datthien97@gmail.com`) |
| **Link Web Online (Vercel)** | `https://my-app-gold-six-81.vercel.app/` (Tự động deploy khi `git push origin main`) |
| **Supabase Project (Cloud DB)** | • Project Ref: `kdcendxxipxstlxuhnwh`<br>• URL: `https://kdcendxxipxstlxuhnwh.supabase.co`<br>• Publishable / Anon Key: `sb_publishable_0GJolCoGzUmNbO8MAwC3YQ_IclKm0bt` (đã cấu hình trong `.env.local` và fallback mặc định trong `src/lib/supabase.js`) |
| **Tech Stack** | Vite + React 19 + React Router + Supabase (Auth & PostgreSQL RLS) + Recharts + SheetJS (`xlsx`) + HTML5 Canvas (nén ảnh & đóng dấu Watermark) + Plain CSS (tông chủ đạo Xanh lá `#16a34a` / `#14532d`, tối giản, hỗ trợ cả Desktop & Mobile) |

---

## 2. Mô hình dữ liệu & Nghiệp vụ cốt lõi (Phương án C+ Ngành Trang Trí Cưới)

File cấu trúc Database đầy đủ (Idempotent — có thể chạy lại nhiều lần không lỗi): `my-app/supabase/schema.sql`.

### 2.1. Phân biệt 2 loại Vật tư (`public.items` & view `public.item_stock`)
1. **🟢 Vật tư Tiêu hao (`kind = 'consumable'`, tiền tố mã `TH`):**
   - Dùng 1 lần (hoa tươi, bóng bay, băng keo, formex in ấn...).
   - Khi xuất cho dự án (`issue`): trừ khỏi tồn kho (`in_stock`).
   - Khi xong tiệc: nếu còn dư nguyên bịch/cuộn thì nhập lại qua phiếu thu hồi (`return_good`).
   - Tính vào chi phí dự án: `(SL xuất - SL dư) * cost`.
2. **🔵 Đồ Tái sử dụng (`kind = 'reusable'`, tiền tố mã `TSD`):**
   - Đồ trang trí & dụng cụ (khung backdrop, đèn, vải rèm, hoa lụa, bàn ghế, đạo cụ, thang, kìm...).
   - Khi xuất cho dự án (`issue`): trừ `in_stock` và chuyển sang trạng thái **"Đang ở dự án" (`at_project`)**.
   - Khi tháo dỡ tiệc về kho, bắt buộc phải **Thu hồi** theo 3 trạng thái:
     - `return_good` (SL Tốt) → cộng lại vào `in_stock`.
     - `return_damaged` (SL Hỏng) → chuyển sang trạng thái **"Chờ sửa" (`in_repair`)**. Khi sửa xong lập phiếu `repair_done` để về lại `in_stock`, hoặc không sửa được thì lập phiếu `dispose` (Thanh lý).
     - `return_lost` (SL Mất) → cộng vào `lost_total` và tính vào thiệt hại dự án.
   - Tính vào chi phí dự án: **Khấu hao mỗi lần dùng** (`SL xuất * cost / expected_uses`) + **Giá trị đồ hỏng/mất** (`(SL hỏng + SL mất) * cost`).

### 2.2. Quy tắc đặt mã tự động & Kiểm tra chống trùng 3 lớp (`src/lib/formatters.js`)
- **Mã Vật tư:** `[TH|TSD]-[MÃ NHÓM]-[3 chữ số]` (Ví dụ: `TH-HOA-001`, `TSD-KHUNG-001`, `TSD-DEN-001`).
  - 5 danh mục gợi ý cốt lõi: *Hoa & Lá (`HOA`)*, *Khung & Backdrop (`KHUNG`)*, *Đèn & Ánh sáng (`DEN`)*, *Vải, Rèm & Thảm (`VAI`)*, *Phụ kiện & Vật tư phụ (`PHU`)* + các nhóm đã có sẵn trong kho.
- **Mã Dự án:** `DA-[YYMM]-[3 chữ số]` theo năm/tháng ngày thi công (Ví dụ: `DA-2611-001`).
- **Chống trùng 3 lớp:** (1) Vòng lặp `while` khi tự sinh mã → (2) Cảnh báo đỏ tức thời ngay khi gõ tay trùng mã → (3) Kiểm tra lại trên Supabase trước khi `insert/update`.

### 2.3. Quy tắc định dạng tiền tệ & Màu sắc & Hình ảnh
- **Giá tiền:** Luôn dùng dấu chấm `.` ngăn cách giữa mỗi 3 chữ số (`10.000`, `250.000`, `1.000.000`) cả khi hiển thị (`formatPriceDots`, `formatCurrency`) lẫn ngay trong lúc gõ vào ô nhập (`src/components/CurrencyInput.jsx`).
- **Màu sắc vật tư:** Chọn từ hộp chọn Dropdown `<select>` có icon màu đứng trước tên màu (`⚪ Trắng`, `🌕 Trắng kem`, `🩷 Hồng Pastel`, `🍷 Đỏ rượu`, `🟡 Vàng đồng`, `🟢 Xanh lá`...).
- **Hình ảnh (Vật tư & Mẫu Set):** Nhận file ảnh kích thước bất kỳ, dùng `src/lib/imageCompressor.js` tự động thu nhỏ và nén WebP/JPEG ngay trên trình duyệt về **dưới 1MB** (thực tế chỉ ~60–150 KB).

---

## 3. Phân quyền 4 vai trò (`public.profiles.role`)

1. **👑 Quản trị (`admin`):**
   - Toàn quyền hệ thống.
   - Là vai trò duy nhất được truy cập menu **👥 Người dùng** để duyệt tài khoản mới (`pending`), đổi vai trò và **Xóa người dùng**.
2. **📊 Quản lý (`manager`):**
   - Xem toàn bộ Tổng quan (gồm cả Giá trị tồn kho và Biểu đồ Doanh thu & Lợi nhuận), tạo/sửa dự án, xóa vật tư, nhập Chi phí khác, xem Tổng kết Lãi/Lỗ dự án và Báo cáo Lãi/Lỗ.
3. **📦 Thủ kho (`storekeeper`):**
   - **Ở mục Tổng quan:** Xem các chỉ số số lượng vật tư, biểu đồ lượng Nhập/Xuất/Thu hồi, bảng cảnh báo tồn kho và danh sách **Các dự án đang chạy**. **Ẩn** Giá trị tiền tồn kho và **Ẩn** Biểu đồ Doanh thu & Lợi nhuận.
   - **Ở mục Vật tư:** Được Thêm / Sửa / Ẩn vật tư (không được Xóa vĩnh viễn vật tư).
   - **Ở mục Dự án:** Xem được **Giá trị hợp đồng**, mở được tab **🧾 Báo giá (Set trang trí)** để chọn mẫu set và xuất Ảnh Báo Giá gửi khách; lập kế hoạch vật tư, xuất kho, thu hồi. **Ẩn** tab Chi phí khác và **Ẩn** tab Tổng kết Lãi/Lỗ.
4. **🛠️ Nhân viên thi công (`staff`):**
   - **Ở mục Tổng quan:** Xem chỉ số vật tư và danh sách **Các dự án đang chạy** (ẩn toàn bộ doanh thu & lãi/lỗ).
   - Chỉ thấy các dự án mình được phân công làm Phụ trách (`lead_id`) hoặc Thành viên (`project_members`), xem kế hoạch đồ và nhập xác nhận **Thu hồi** sau tiệc.

---

## 4. Các tính năng đặc thù của Đặng Wedding đã xây dựng

### 4.1. Mẫu Set Trang Trí (`src/pages/TemplatesPage.jsx`)
- Phân loại thành **🏮 Gia tiên** và **🎁 Mâm quả**.
- Lưu hình ảnh mẫu thực tế (tự động nén < 1MB) + danh sách vật tư định mức.

### 4.2. Báo giá Dự án từ Hình ảnh Set Trang Trí (`src/components/ProjectQuoteTab.jsx` & `src/lib/quoteExporter.js`)
- Nằm ở tab **"🧾 Báo giá (Set trang trí)"** trong chi tiết Dự án.
- Chọn các mẫu **Gia tiên / Mâm quả** từ danh sách hình ảnh để đưa vào Báo giá.
- **Quy tắc quan trọng:** Trên báo giá chỉ hiển thị **Hình ảnh mẫu**, **Tên mẫu set & Tên các vật tư trong gói** (tuyệt đối **không hiện số lượng từng vật tư** và **không lấy giá vốn vật tư trong kho**). Giá tiền cuối báo giá chỉ hiển thị duy nhất **GIÁ TRỊ HỢP ĐỒNG** trọn gói của dự án (kèm ưu đãi nếu có).
- Xuất ra **file Ảnh Báo Giá (`.png`)** sắc nét có Logo Đặng Wedding + hình ảnh các Set trang trí để gửi Zalo cho khách, hoặc xuất Excel (`.xlsx`), hoặc bấm 1 nút nạp vật tư của các Set đã chọn sang tab **Kế hoạch vật tư**.

### 4.3. Truyền thông Facebook, Nhắc đăng bài > 5 ngày & Ghép Watermark Trắng/Đen (`src/components/ProjectFacebookTab.jsx` & `src/lib/watermarkHelper.js`)
- **Nhắc đăng bài tự động (> 5 ngày):** Dự án nào đã qua 5 ngày kể từ ngày thi công (`start_date`) hoặc ngày tạo mà chưa đánh dấu **"Đã đăng Fanpage" (`posted`)** sẽ hiện cảnh báo nhắc ở trang **Tổng quan**, trang **Danh sách Dự án** và trên tab **📱 Đăng Facebook & Watermark**.
- **Đóng dấu Watermark chính thức (Trắng / Đen):**
  - 2 file watermark PNG nền trong suốt chính thức nằm tại:
    - `public/watermark-white.png` (⚪ Bản chữ Trắng — dùng cho ảnh nền tối/rực rỡ)
    - `public/watermark-black.png` (⚫ Bản chữ Đen — dùng cho ảnh nền sáng/trắng kem)
  - Cho phép tải nhiều ảnh tiệc cưới lên cùng lúc, chọn vị trí & kích thước watermark, đổi qua lại giữa **Trắng ↔ Đen** cho cả bộ ảnh hoặc cho riêng từng tấm ảnh, rồi tải ảnh về đăng Fanpage.
- **Soạn Caption Facebook tự động:** 3 mẫu phong cách (*Sang trọng*, *Ấm cúng*, *Ngắn gọn*) có sẵn địa chỉ `Đồng Nai - TP.HCM` và `SĐT/Zalo: 0918.80.90.96`.

---

## 5. Cấu trúc thư mục mã nguồn (`my-app/`)

```text
my-app/
├── public/
│   ├── logo.jpg                              # Logo chính thức Đặng Wedding
│   ├── favicon-rounded.png                   # Favicon bo góc tròn trên tab trình duyệt
│   ├── watermark-white.png                   # Watermark PNG trong suốt bản chữ Trắng
│   ├── watermark-black.png                   # Watermark PNG trong suốt bản chữ Đen
│   └── huong-dan-su-dung-dang-wedding.png    # Ảnh Infographic hướng dẫn sử dụng
├── supabase/
│   └── schema.sql                            # Toàn bộ cấu trúc bảng, view, trigger, RLS (Idempotent)
├── src/
│   ├── components/
│   │   ├── Badges.jsx                        # Nhãn màu cho Loại vật tư, Trạng thái dự án, Vai trò
│   │   ├── CurrencyInput.jsx                 # Ô nhập tiền tự động tách dấu chấm (10.000; 1.000.000)
│   │   ├── Layout.jsx                        # Sidebar desktop, Header & Bottom nav mobile
│   │   ├── PendingApprovalScreen.jsx         # Màn hình chờ Admin duyệt tài khoản
│   │   ├── ProjectFacebookTab.jsx            # Tab ghép Watermark Trắng/Đen & soạn bài Facebook
│   │   ├── ProjectQuoteTab.jsx               # Tab Báo giá từ hình ảnh Set trang trí & Giá trị HĐ
│   │   └── SetupScreen.jsx                   # Màn hình hướng dẫn khi thiếu biến môi trường
│   ├── lib/
│   │   ├── AuthContext.jsx                   # Quản lý đăng nhập, đổi mật khẩu, phân quyền
│   │   ├── calc.js                           # Tính trùng lịch kho, thống kê thu hồi, quyết toán lãi/lỗ
│   │   ├── exportExcel.js                    # Xuất Excel (.xlsx) từng bảng & toàn bộ dữ liệu thô
│   │   ├── formatters.js                     # Định dạng tiền dấu chấm, sinh mã tự động chống trùng, màu sắc
│   │   ├── imageCompressor.js                # Tự động thu nhỏ & nén mọi ảnh tải lên về dưới 1MB
│   │   ├── quoteExporter.js                  # Vẽ và xuất Phiếu Báo Giá Đặng Wedding ra ảnh PNG
│   │   ├── supabase.js                       # Khởi tạo kết nối Supabase
│   │   └── watermarkHelper.js                # Ghép Watermark Trắng/Đen, nhắc 5 ngày, tạo Caption FB
│   └── pages/
│       ├── AuthPage.jsx                      # Đăng nhập / Đăng ký / Quên mật khẩu
│       ├── DashboardPage.jsx                 # Tổng quan hệ thống & Cảnh báo
│       ├── ItemDetailPage.jsx                # Chi tiết vật tư & Lịch sử biến động
│       ├── ItemsPage.jsx                     # Danh mục vật tư (Ảnh, Màu sắc, Tự sinh mã, Xóa)
│       ├── MovementsPage.jsx                 # Nhập mua, Điều chỉnh, Sửa xong, Thanh lý & Sổ kho
│       ├── PartnersPage.jsx                  # Nhà cung cấp & Khách hàng
│       ├── ProjectDetailPage.jsx             # Chi tiết dự án (6 tab vận hành)
│       ├── ProjectsPage.jsx                  # Danh sách & Tạo/Sửa dự án
│       ├── ReportsPage.jsx                   # 7 Báo cáo thống kê & Dự báo mua hàng
│       ├── TemplatesPage.jsx                 # Mẫu set trang trí (Gia tiên / Mâm quả kèm hình ảnh)
│       └── UsersPage.jsx                     # Duyệt phân quyền & Xóa người dùng (Admin)
├── CONTEXT-DU-AN.md                          # File bối cảnh toàn diện này
├── HUONG-DAN.md                              # Hướng dẫn cài đặt kỹ thuật
├── HUONG-DAN-SU-DUNG.md                      # Cẩm nang hướng dẫn sử dụng cho đội ngũ
└── vercel.json                               # Cấu hình rewrite SPA cho Vercel
```

---

## 6. Quy trình cập nhật & Deploy dành cho AI Agent tiếp theo

Mỗi khi chỉnh sửa hoặc thêm tính năng mới theo yêu cầu của anh Thiện:
1. Chạy kiểm tra build tại thư mục `d:\0. AI\1.Vibe code app\my-app`:
   ```powershell
   cd "d:\0. AI\1.Vibe code app\my-app"
   npm run build
   ```
2. Đẩy lên GitHub để Vercel tự động cập nhật bản online (`https://my-app-gold-six-81.vercel.app/`):
   ```powershell
   git add .
   git commit -m "Mo ta thay doi"
   git push origin main
   ```
