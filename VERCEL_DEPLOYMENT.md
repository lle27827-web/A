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
| `DATABASE_URL` | API | DB2: kho chính của thẻ và lịch sử thẻ; giữ kín chuỗi kết nối. |
| `DATABASE_URL_1` | API | DB1: kho chính của chấm công cơ sở/nhân viên. |
| `DATABASE_URL_3` | API | DB3: kho chính của sổ chấm công cá nhân. |
| `DATABASE_URL_4` | API | DB4: kho chính của dữ liệu dùng chung và bộ điều phối phân vùng. |
| `NEON_DB1_DIRECT_URL`, `DATABASE_URL_DIRECT`, `DATABASE_URL_3_DIRECT`, `DATABASE_URL_4_DIRECT` | API/migration | URL Neon direct, không qua pooler. `DATABASE_URL_DIRECT` và các biến `_3_DIRECT`/`_4_DIRECT` tương ứng DB2/3/4; `NEON_DB1_DIRECT_URL` dùng cho DB1. Các biến direct được ưu tiên khi có; nếu không, bước tạo index ngày dùng URL pooled với DDL giao dịch an toàn. |
| `NEON_SOURCE_DIRECT_URL`, `MIGRATE_DATABASE_URL_3_DIRECT`, `MIGRATE_DATABASE_URL_4_DIRECT` | Migration | Tên direct URL tương thích cho DB2/3/4 nếu không dùng các biến `DATABASE_URL_*_DIRECT`. Không in giá trị connection string vào log. |
| `DATABASE_STORAGE_MODE` | API | Giữ `domain_partitioned` để dùng các cặp kho cố định theo loại dữ liệu; `partitioned` cũng được hiểu theo cùng cách. |
| `APP_CLERK_SECRET_KEY` | API | Secret key của Clerk Production bên ngoài. Không dùng khóa Clerk do Replit quản lý hoặc khóa Development. |
| `APP_CLERK_PUBLISHABLE_KEY` | API | Publishable key của cùng Clerk Production. |
| `VITE_APP_CLERK_PUBLISHABLE_KEY` | Web build | Cùng publishable key Production, được dùng ở giao diện trình duyệt. |
| `ADMIN_EMAIL` | API | Email chính đã xác minh của tài khoản chủ sở hữu duy nhất. |
| `CRON_SECRET` | API | Chuỗi bí mật dài, ngẫu nhiên để Vercel Cron gọi dọn lịch sử. Endpoint chỉ nhận `Authorization: Bearer <CRON_SECRET>`. |

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

API dùng `pg` và Drizzle. Bốn kho giữ phân vùng dữ liệu cố định; không tự chuyển toàn bộ ứng dụng hay di chuyển dữ liệu cũ:

1. Cặp kho cố định: cơ sở/chấm công `DB1 → DB2`; thẻ và nhật ký thẻ `DB2 → DB3`; sổ cá nhân `DB3 → DB4`; dữ liệu dùng chung `DB4 → DB3`. Mỗi thao tác được ghi vào đúng hai kho của cặp, còn DB4 điều phối thứ tự thao tác.
2. Không còn ngưỡng 100 CU-giờ/1 GB hoặc truy vấn dung lượng/CU trên từng API request. Nếu ghi nhận lỗi đầy dung lượng, thao tác dừng ở cặp kho đã gán để anh tự nâng cấp. Chỉ lỗi kết nối thật mới được thử một cặp khác; không đổi kho vì CU/dung lượng và không di chuyển dữ liệu cũ.
3. Cả bốn database cần schema ứng dụng và schema nhật ký phân vùng. Build Vercel tiếp tục chạy `migrate:all-vercel-stores` rồi `migrate:verify-stores`; giữ đủ bốn URL database và URL direct migration.
4. Không đưa `storage_partition_events` vào publication/subscription Neon. Ứng dụng ghi hai bản sao theo cặp cố định. Các subscription failover cũ không còn được dùng để chuyển toàn bộ database. Nếu không còn hệ thống nào khác cần replication cũ, có thể dừng các subscription `socong_source_from_db1_v1` (DB2), `socong_db3_from_source_v1` (DB3), `socong_db4_from_db3_v1` (DB4), `socong_db1_from_db2_v1` (DB1), `socong_db2_from_db3_v1` (DB2), `socong_db3_from_db4_v1` (DB3) để giảm công việc replication. Kiểm tra dữ liệu nền cũ và đối soát trước; gỡ subscription trước publication.
5. Vercel gọi `/api/retention/cleanup` mỗi Chủ nhật lúc 03:00 UTC. Giữ `CRON_SECRET` trong Production và Preview mà anh muốn chạy; không mở endpoint này cho yêu cầu không có Bearer token.

Để giảm CU khi đọc, mỗi lần đọc không có cache chỉ truy vấn nhật ký ở ba kho trước; kho thứ tư chỉ được hỏi nếu cần thay thế một kho không đọc được. Vì mỗi sự kiện đã có hai bản sao trên hai kho khác nhau, ba kho bất kỳ vẫn chứa ít nhất một bản sao của mọi sự kiện. Bản dữ liệu nền được đọc từ kho đầu tiên đọc được, chỉ thử kho kế tiếp nếu truy vấn đó lỗi. Kiểm tra schema điều phối DB4 được cache 60 giây; cache kết quả đọc vẫn là 3 giây. Đường ghi tiếp tục xác nhận hai bản sao và trạng thái thao tác trên DB4 để giữ khả năng khôi phục/idempotency.

Ứng dụng không còn gọi Neon Usage API, truy vấn ngưỡng CU/dung lượng, hay tự chuyển kho theo các ngưỡng đó. Sau khi triển khai bản này, có thể xóa các biến cũ chỉ phục vụ việc đo ngưỡng và failover toàn cục: `NEON_API_KEY`, `NEON_PROJECT_ID_1`, `NEON_PROJECT_ID`, `NEON_PROJECT_ID_3`, `NEON_PROJECT_ID_4`, `DATABASE_URL_1_MAX_BYTES`, `DATABASE_URL_MAX_BYTES`, `DATABASE_URL_3_MAX_BYTES`, `DATABASE_URL_4_MAX_BYTES`, `FAILOVER_REQUIRE_CU_CHECK`, `PARTITION_REQUIRE_CU_CHECK`, `ALLOW_FORCE_FAILOVER`, `DATABASE_FAILOVER_COORDINATOR_URL` và `DATABASE_FAILOVER_COORDINATOR_BACKEND`. Việc xóa các biến này không xóa dữ liệu và không đổi phân vùng DB1–DB4. Không xóa `DATABASE_URL`, `DATABASE_URL_1`, `DATABASE_URL_3`, `DATABASE_URL_4`, `DATABASE_STORAGE_MODE`, các URL direct dùng cho migration, `CRON_SECRET` hoặc khóa Clerk.

Các biến này là cấu hình Vercel; không thay `DATABASE_URL` do Replit quản lý trong môi trường Replit.

Đổi `DATABASE_URL` không sao chép dữ liệu. Database Neon mới phải được áp dụng schema trước khi ứng dụng đọc/ghi được. Dự án có migration ban đầu trong `lib/db/drizzle/0000_initial.sql` và lệnh `pnpm --filter @workspace/db run migrate` để tạo các bảng, bao gồm `members`. Chạy lệnh trong môi trường an toàn mà `DATABASE_URL` đang trỏ chính xác tới database Neon mới; không chạy với `DATABASE_URL` mặc định của Replit. Migration tạo cấu trúc bảng nhưng không sao chép dữ liệu Replit.

Build Vercel hiện áp dụng và xác minh schema trên bốn kho bằng hai lệnh ở trên. Không thêm migration baseline khác vào build; nếu thay đổi quy trình build, phải kiểm tra đúng môi trường và đúng bốn URL trước để tránh ghi nhầm database.

Không dán connection string hoặc thông tin đăng nhập vào chat hay mã nguồn.
