# Triển khai SỔ CÔNG trên Vercel

## Định tuyến và build

`vercel.json` cấu hình ba service trong cùng workspace:

- `task-manager`: ứng dụng web tại `/`.
- `api-server`: API tại `/api/*`.
- `mockup-sandbox`: service nội bộ, không có rewrite public.

Mỗi service cài đúng workspace dependencies bằng pnpm, dùng lockfile cố định và build riêng. `package.json` ghim pnpm `10.26.1` và Node.js `24.x`. Vercel tự cung cấp `PORT` và `NODE_ENV`; không cần tạo hai biến này.

## Biến môi trường cần thiết

Thêm các biến này trong Vercel Project Settings → Environment Variables. Giá trị được cấu hình trong Replit không tự đồng bộ sang Vercel.

| Biến | Dùng ở đâu | Lưu ý |
| --- | --- | --- |
| `ADMIN_EMAIL` | API | Email đã xác minh trong Clerk, dùng để xác định chủ sở hữu. |
| `DATABASE_URL` | API | Dùng URL kết nối từ xa lấy trong phần cài đặt Database của Replit; URL nội bộ do Replit cấp không truy cập được từ Vercel. Giữ giá trị này bí mật. |
| `CLERK_SECRET_KEY` | API | Khóa bí mật của cùng Clerk instance với ứng dụng. |
| `CLERK_PUBLISHABLE_KEY` | API | Publishable key của Clerk, dùng bởi Clerk middleware phía máy chủ. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Build frontend | Publishable key của cùng Clerk instance; biến `VITE_` được nhúng vào bundle trình duyệt. |

Không cần đặt `VITE_CLERK_PROXY_URL` trên Vercel: bản build production tự dùng đường dẫn cùng nguồn `/api/__clerk`. Nếu đặt biến này, hãy dùng đường dẫn tương đối đó để hoạt động trên cả preview và custom domain.

Chỉ thêm biến cần thiết cho từng môi trường. Với Preview, ưu tiên cơ sở dữ liệu thử nghiệm riêng thay vì cho bản preview quyền ghi vào dữ liệu production. Sau khi đổi `VITE_CLERK_PUBLISHABLE_KEY`, cần build/deploy lại frontend.

## Cơ sở dữ liệu Replit

Vercel không thể kết nối bằng `DATABASE_URL` nội bộ của Replit. Trong Database của Replit, mở phần cài đặt và tạo/đọc URL dành cho kết nối từ xa; chỉ đưa URL đó vào biến `DATABASE_URL` trong Vercel. Không dán URL hoặc thông tin đăng nhập vào chat hay mã nguồn.

Trước khi triển khai, xác nhận URL từ xa được bật và cho phép kết nối an toàn từ bên ngoài. Nếu Database không cấp URL kết nối từ xa cho workspace hiện tại, Vercel không thể dùng trực tiếp database đó; cần một database có endpoint truy cập được từ Vercel và chuyển cấu hình `DATABASE_URL` sang endpoint đó.
