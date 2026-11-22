# Hướng Dẫn Cài Đặt & Sử Dụng Ứng Dụng Quản Lý Kho Trang Trí

## 1. Khởi tạo Cơ sở dữ liệu trên Supabase

1. Đăng nhập vào [Supabase Dashboard](https://supabase.com/dashboard) và tạo một Project mới.
2. Vào mục **SQL Editor** → **New query**.
3. Mở file `supabase/schema.sql` trong dự án này, sao chép toàn bộ nội dung dán vào khung truy vấn và nhấn **Run**.
4. Nếu bạn muốn người dùng đăng ký và đăng nhập được ngay không cần xác nhận link trong email: vào **Authentication → Providers → Email** và tắt tùy chọn **Confirm email**.

---

## 2. Cấu hình biến môi trường khi chạy trên máy cá nhân (Local)

1. Tại thư mục `my-app` (cùng cấp với `package.json`), tạo một file mới tên là `.env.local` (có thể sao chép từ file `.env.example`).
2. Vào Supabase Dashboard → **Project Settings → API**, lấy **Project URL** và **anon / public key** điền vào `.env.local`:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

3. Chạy ứng dụng:

```bash
npm install
npm run dev
```

*(Lưu ý: `.env` và `.env.local` đã được đưa vào `.gitignore` để bảo mật khóa kết nối).*

---

## 3. Cấu hình biến môi trường khi triển khai lên Vercel

1. Mở dự án của bạn trên [Vercel Dashboard](https://vercel.com/dashboard).
2. Vào **Project Settings → Environment Variables**.
3. Thêm 2 biến môi trường sau (cho cả Production, Preview và Development):
   - `VITE_SUPABASE_URL`: Giá trị Project URL từ Supabase.
   - `VITE_SUPABASE_ANON_KEY`: Giá trị `anon` `public` key từ Supabase.
4. Vào tab **Deployments**, chọn bản deploy gần nhất → bấm **Redeploy** để Vercel nạp biến môi trường mới vào bản build.

---

## 4. Cơ chế Quản trị viên đầu tiên & Duyệt người dùng mới

- **Người đăng ký đầu tiên tự động làm Quản trị (`admin`)**:
  Trigger `handle_new_user()` trong `supabase/schema.sql` tự động kiểm tra bảng `profiles`. Nếu bảng chưa có ai, tài khoản đăng ký đầu tiên sẽ được gán quyền **Quản trị (`admin`)** ngay lập tức.
- **Các tài khoản đăng ký tiếp theo**:
  Mặc định sẽ có vai trò **Chờ duyệt (`pending`)**. Khi đăng nhập, họ sẽ thấy màn hình *"Tài khoản đang chờ Quản trị duyệt"* và chưa thể xem hay thao tác dữ liệu.
- **Cách Quản trị viên duyệt và phân quyền**:
  1. Đăng nhập bằng tài khoản **Quản trị (`admin`)**.
  2. Trên thanh menu bên trái, vào mục **Người dùng**.
  3. Tại cột **Đổi vai trò**, chuyển vai trò của tài khoản từ **Chờ duyệt** sang một trong các quyền:
     - **Quản trị (`admin`)**: Toàn quyền hệ thống, quản lý người dùng, xóa dữ liệu.
     - **Quản lý (`manager`)**: Quản lý dự án, xem giá trị hợp đồng, chi phí khác, báo cáo lãi/lỗ.
     - **Thủ kho (`storekeeper`)**: Quản lý vật tư, đối tác, mẫu set, phiếu nhập/xuất/thu hồi, kế hoạch vật tư (không thấy giá trị hợp đồng và lợi nhuận dự án).
     - **Nhân viên thi công (`staff`)**: Chỉ xem các dự án mình phụ trách hoặc tham gia và xác nhận thu hồi vật tư cho dự án đó.
