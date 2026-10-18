# Triển khai SỔ CÔNG trên Vercel

## Định tuyến và build

`vercel.json` cấu hình ba service trong cùng workspace:

- `task-manager`: ứng dụng web tại `/`.
- `api-server`: API tại `/api/*`.
- `mockup-sandbox`: service nội bộ, không có rewrite public.

Các đường dẫn SPA như `/employees`, `/employees/:id` và `/sign-in` được chuyển tới `index.html` bằng request-path transform bên trong service `task-manager`; chỉ đổi `destination.path` ở rewrite cấp gốc là không đủ vì service vẫn nhận pathname ban đầu. `/assets/*`, `favicon.svg`, `logo.svg` và `robots.txt` được giữ nguyên; `/api/*` luôn được định tuyến tới API trước service frontend.

Mỗi service cài đúng workspace dependencies bằng pnpm, dùng lockfile cố định và build riêng. `package.json` ghim pnpm `10.26.1` và Node.js `24.x`. Vercel tự quản lý `NODE_ENV`; API chạy dưới dạng Function nên không cần `PORT`. Workflow Replit vẫn dùng `PORT` do artifact cung cấp.

API Express xuất ứng dụng trực tiếp để Vercel chạy dưới dạng Function; listener `app.listen()` chỉ bật trong môi trường Replit, nơi workflow cung cấp `PORT`.

## Biến môi trường cần thiết

Thêm các biến này trong Vercel Project Settings → Environment Variables. Giá trị được cấu hình trong Replit không tự đồng bộ sang Vercel.

| Biến | Dùng ở đâu | Lưu ý |
| --- | --- | --- |
| `DATABASE_URL` | API | Chuỗi kết nối Neon PostgreSQL dành cho deployment Vercel. Dùng connection string dạng pooled của Neon và giữ giá trị này bí mật. |
| `APP_CLERK_SECRET_KEY` | API | Secret key của Clerk Production bên ngoài. Không dùng khóa Clerk do Replit quản lý hoặc khóa Development. |
| `APP_CLERK_PUBLISHABLE_KEY` | API | Publishable key của cùng Clerk Production. |
| `VITE_APP_CLERK_PUBLISHABLE_KEY` | Web build | Cùng publishable key Production, được dùng ở giao diện trình duyệt. |
| `ADMIN_EMAIL` | API | Email chính đã xác minh của tài khoản chủ sở hữu duy nhất. |

## Đăng nhập chủ sở hữu và quyền khách

Ứng dụng dùng Clerk bên ngoài để cùng một phương thức đăng nhập hoạt động trên Replit và Vercel. Ứng dụng không dùng các biến `CLERK_*` do Replit quản lý vì chúng không xác thực được deployment Vercel.

1. Tạo hoặc chọn ứng dụng Clerk bên ngoài. Cấu hình domain và URL chuyển hướng riêng cho Replit Development và Vercel Production.
2. Thêm các biến ở trên vào Vercel Project Settings → Environment Variables bằng khóa **Production** của Clerk. Hai biến publishable phải cùng một khóa; giữ `APP_CLERK_SECRET_KEY` ở chế độ bí mật.
3. Đặt `ADMIN_EMAIL` bằng email chính đã xác minh của chủ trong Clerk Production. Chỉ phiên đăng nhập có email này mới xem được dữ liệu chỉ dành cho chủ hoặc thay đổi dữ liệu.
4. Replit Development dùng khóa **Development** của Clerk trong các biến tương ứng và cùng `ADMIN_EMAIL`. Người dùng Clerk Development và Production được tách riêng; cần tạo/cho phép tài khoản chủ ở mỗi môi trường. Secrets của Replit không tự đồng bộ sang Vercel.
5. Redeploy sau khi đổi biến Vercel. Tắt đăng ký công khai trong cả hai môi trường Clerk; giao diện ứng dụng không hiển thị liên kết đăng ký và đường dẫn `/sign-up` bị vô hiệu hóa.

Nếu thiếu biến xác thực hoặc khóa không hợp lệ, khách vẫn xem được phần quản lý nhân viên ở chế độ chỉ đọc nhưng không thể xem doanh thu cơ sở hoặc phần quản lý thẻ. Khách có thể xem toàn bộ chi tiết trong quản lý nhân viên, gồm lương đã ghi và lịch sử ca; mọi thao tác ghi đều bị từ chối.

API được truy cập cùng domain qua `/api/*`; không bật CORS cho mọi domain. Với các bản Preview, hãy dùng database riêng nếu không muốn chúng ghi vào dữ liệu production.

## Neon PostgreSQL cho Vercel

API đã dùng `pg` và Drizzle với `process.env.DATABASE_URL` (`lib/db/src/index.ts`), nên có thể dùng chuỗi kết nối PostgreSQL pooled của Neon mà không cần đổi driver.

1. Trong Neon, tạo/chọn database và lấy connection string pooled, có SSL.
2. Thêm chuỗi đó làm `DATABASE_URL` trong Vercel, tối thiểu ở môi trường Production. Dùng Neon branch riêng cho Preview nếu cần thử ghi dữ liệu.
3. Redeploy để API nhận giá trị mới.

Chỉ Vercel chuyển sang Neon; Replit tiếp tục dùng `DATABASE_URL` do Replit quản lý. Không thay biến đó trong Replit.

Đổi `DATABASE_URL` không sao chép dữ liệu. Database Neon mới phải được áp dụng schema trước khi ứng dụng đọc/ghi được. Dự án có migration ban đầu trong `lib/db/drizzle/0000_initial.sql` và lệnh `pnpm --filter @workspace/db run migrate` để tạo các bảng, bao gồm `members`. Chạy lệnh trong môi trường an toàn mà `DATABASE_URL` đang trỏ chính xác tới database Neon mới; không chạy với `DATABASE_URL` mặc định của Replit. Migration tạo cấu trúc bảng nhưng không sao chép dữ liệu Replit.

Không cấu hình migration để tự chạy trong mỗi lần build Vercel. Nếu database đã có bảng hoặc chứa dữ liệu cần giữ, hãy kiểm tra trạng thái schema trước khi chạy migration.

Không dán connection string hoặc thông tin đăng nhập vào chat hay mã nguồn.
