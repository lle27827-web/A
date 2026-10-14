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
| `ADMIN_EMAIL` | API | Email đã xác minh trong Clerk, dùng để xác định chủ sở hữu. |
| `DATABASE_URL` | API | Chuỗi kết nối Neon PostgreSQL dành cho deployment Vercel. Dùng connection string dạng pooled của Neon và giữ giá trị này bí mật. |
| `CLERK_SECRET_KEY` | API | Khóa bí mật của cùng Clerk instance với ứng dụng. |
| `CLERK_PUBLISHABLE_KEY` | API | Publishable key của Clerk, dùng bởi Clerk middleware phía máy chủ. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Build frontend | Publishable key của cùng Clerk instance; biến `VITE_` được nhúng vào bundle trình duyệt. |

Không cần đặt `VITE_CLERK_PROXY_URL` trên Vercel: bản build production tự dùng đường dẫn cùng nguồn `/api/__clerk`. Nếu đặt biến này, hãy dùng đường dẫn tương đối đó để hoạt động trên cả preview và custom domain.

Chỉ thêm biến cần thiết cho từng môi trường. Với Preview, ưu tiên cơ sở dữ liệu thử nghiệm riêng thay vì cho bản preview quyền ghi vào dữ liệu production. Sau khi đổi `VITE_CLERK_PUBLISHABLE_KEY`, cần build/deploy lại frontend.

## Neon PostgreSQL cho Vercel

API đã dùng `pg` và Drizzle với `process.env.DATABASE_URL` (`lib/db/src/index.ts`), nên có thể dùng chuỗi kết nối PostgreSQL pooled của Neon mà không cần đổi driver.

1. Trong Neon, tạo/chọn database và lấy connection string pooled, có SSL.
2. Thêm chuỗi đó làm `DATABASE_URL` trong Vercel, tối thiểu ở môi trường Production. Dùng Neon branch riêng cho Preview nếu cần thử ghi dữ liệu.
3. Redeploy để API nhận giá trị mới.

Chỉ Vercel chuyển sang Neon; Replit tiếp tục dùng `DATABASE_URL` do Replit quản lý. Không thay biến đó trong Replit.

Đổi `DATABASE_URL` không sao chép dữ liệu. Dữ liệu hiện có trong Replit vẫn ở database Replit; database Neon mới cần có schema Drizzle trước khi ứng dụng đọc/ghi được. Lệnh `pnpm --filter @workspace/db run push` có thể áp dụng schema, nhưng chưa được tự chạy: phải xác nhận đúng Neon database/branch trước. Việc chuyển dữ liệu cũ là một bước riêng, cần sao lưu và xác nhận trước khi thực hiện.

Không dán connection string hoặc thông tin đăng nhập vào chat hay mã nguồn.
