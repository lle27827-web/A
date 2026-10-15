# Triển khai SỔ CÔNG trên Vercel

## Định tuyến và build

`vercel.json` cấu hình ba service trong cùng workspace:

- `task-manager`: ứng dụng web tại `/`.
- `api-server`: API tại `/api/*`.
- `mockup-sandbox`: service nội bộ, không có rewrite public.

Mỗi service cài đúng workspace dependencies bằng pnpm, dùng lockfile cố định và build riêng. `package.json` ghim pnpm `10.26.1` và Node.js `24.x`. Vercel tự quản lý `NODE_ENV`; API chạy dưới dạng Function nên không cần `PORT`. Workflow Replit vẫn dùng `PORT` do artifact cung cấp.

API Express xuất ứng dụng trực tiếp để Vercel chạy dưới dạng Function; listener `app.listen()` chỉ bật trong môi trường Replit, nơi workflow cung cấp `PORT`.

## Biến môi trường cần thiết

Thêm các biến này trong Vercel Project Settings → Environment Variables. Giá trị được cấu hình trong Replit không tự đồng bộ sang Vercel.

| Biến | Dùng ở đâu | Lưu ý |
| --- | --- | --- |
| `DATABASE_URL` | API | Chuỗi kết nối Neon PostgreSQL dành cho deployment Vercel. Dùng connection string dạng pooled của Neon và giữ giá trị này bí mật. |

Không cần cấu hình đăng nhập. Cảnh báo: API công khai cho phép bất kỳ ai truy cập website đọc và thay đổi dữ liệu, bao gồm số điện thoại khách hàng và thông tin lương. Với Preview, hãy dùng cơ sở dữ liệu thử nghiệm riêng thay vì cho bản preview quyền ghi vào dữ liệu production.

## Neon PostgreSQL cho Vercel

API đã dùng `pg` và Drizzle với `process.env.DATABASE_URL` (`lib/db/src/index.ts`), nên có thể dùng chuỗi kết nối PostgreSQL pooled của Neon mà không cần đổi driver.

1. Trong Neon, tạo/chọn database và lấy connection string pooled, có SSL.
2. Thêm chuỗi đó làm `DATABASE_URL` trong Vercel, tối thiểu ở môi trường Production. Dùng Neon branch riêng cho Preview nếu cần thử ghi dữ liệu.
3. Redeploy để API nhận giá trị mới.

Chỉ Vercel chuyển sang Neon; Replit tiếp tục dùng `DATABASE_URL` do Replit quản lý. Không thay biến đó trong Replit.

Đổi `DATABASE_URL` không sao chép dữ liệu. Database Neon mới phải được áp dụng schema trước khi ứng dụng đọc/ghi được. Dự án có migration ban đầu trong `lib/db/drizzle/0000_initial.sql` và lệnh `pnpm --filter @workspace/db run migrate` để tạo các bảng, bao gồm `members`. Chạy lệnh trong môi trường an toàn mà `DATABASE_URL` đang trỏ chính xác tới database Neon mới; không chạy với `DATABASE_URL` mặc định của Replit. Migration tạo cấu trúc bảng nhưng không sao chép dữ liệu Replit.

Không cấu hình migration để tự chạy trong mỗi lần build Vercel. Nếu database đã có bảng hoặc chứa dữ liệu cần giữ, hãy kiểm tra trạng thái schema trước khi chạy migration.

Không dán connection string hoặc thông tin đăng nhập vào chat hay mã nguồn.
