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
| `DATABASE_URL_1` | API | Database thứ nhất trong chuỗi failover; giữ nguyên vai trò hiện tại. |
| `DATABASE_URL_3` | API | Bản sao thứ ba; yêu cầu đồng bộ từ `DATABASE_URL` trước khi được phép promote. |
| `DATABASE_URL_4` | API | Bản sao thứ tư; yêu cầu đồng bộ từ `DATABASE_URL_3`. Không thể bỏ qua database thứ ba. |
| `NEON_DB1_DIRECT_URL`, `DATABASE_URL_DIRECT`, `DATABASE_URL_3_DIRECT`, `DATABASE_URL_4_DIRECT` | API/migration | URL Neon direct, không qua pooler. `DATABASE_URL_DIRECT` và các biến `_3_DIRECT`/`_4_DIRECT` tương ứng DB2/3/4; `NEON_DB1_DIRECT_URL` dùng cho DB1. |
| `NEON_SOURCE_DIRECT_URL`, `MIGRATE_DATABASE_URL_3_DIRECT`, `MIGRATE_DATABASE_URL_4_DIRECT` | Migration | Tên direct URL tương thích cho DB2/3/4 nếu không dùng các biến `DATABASE_URL_*_DIRECT`. Không in giá trị connection string vào log. |
| `NEON_API_KEY` | API | Secret dùng đọc mức CU của từng project; không đưa vào mã nguồn. |
| `NEON_PROJECT_ID_1`, `NEON_PROJECT_ID`, `NEON_PROJECT_ID_3`, `NEON_PROJECT_ID_4` | API | Project ID tương ứng với từng URL; cần project ID cho mọi database có thể được promote để xác nhận còn hạn mức CU. |
| `FAILOVER_REQUIRE_CU_CHECK` | API | Mặc định để trống: khi Neon API tạm lỗi, dùng số CU tốt gần nhất tối đa 10 phút hoặc tiếp tục phục vụ nhưng không chuyển kho theo CU. Đặt `1` để chặn request nếu không xác minh được CU. |
| `ALLOW_FORCE_FAILOVER` | API | Mặc định để trống, tắt chuyển cưỡng bức. Chỉ đặt `1` khi chủ sở hữu chủ động chấp nhận nguy cơ mất dữ liệu chưa đồng bộ. |
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

API dùng `pg` và Drizzle. Thứ tự failover là `DATABASE_URL_1` → `DATABASE_URL` → `DATABASE_URL_3` → `DATABASE_URL_4`; `DATABASE_URL` vẫn là database điều khiển trạng thái failover. Không có biến `DATABASE_URL_2` trong cấu hình này.

1. Cả bốn database phải có cùng schema và cùng cấu trúc sequence. Áp dụng các migration cho database mới trước khi tạo subscription; logical replication đồng bộ hàng dữ liệu, không đồng bộ DDL. Mã sẽ đồng bộ bộ đếm `serial`/identity trước khi promote; nếu thiếu hoặc khác sequence thì không promote.
2. Bật logical replication trên các publisher: `DATABASE_URL_1`, `DATABASE_URL` và `DATABASE_URL_3`. `DATABASE_URL_3` vừa nhận dữ liệu từ database 2 vừa phát dữ liệu sang database 4. `DATABASE_URL_4` là subscriber cuối cùng. Dùng direct/unpooled endpoint khi tạo hoặc quản lý replication.
3. Đặt các tên publication/subscription như sau: `socong_db1_to_source_v1` / `socong_source_from_db1_v1` (database 1 → `DATABASE_URL`, hiện có); `socong_source_to_db3_v1` / `socong_db3_from_source_v1` (`DATABASE_URL` → database 3); `socong_db3_to_db4_v1` / `socong_db4_from_db3_v1` (database 3 → database 4). Publication phải chứa đúng các bảng ứng dụng hiện tại: `appointments`, `attendance`, `card_top_ups`, `card_usage_history`, `manager_grants`, `member_versions`, `members`, `personal_services`, `personal_sessions`, `personal_settings`, `service_sessions`, `service_types`, `tasks`, `treatment_cards`. Không đưa `db_failover_state` vào publication; đó là bảng điều khiển nằm trên `DATABASE_URL`, không phải dữ liệu ứng dụng cần sao chép. Runtime kiểm tra đúng tên bảng, trạng thái đồng bộ và LSN; thiếu/thừa bảng hoặc bị trễ thì không promote.
4. Đảm bảo `DATABASE_URL_3` và `DATABASE_URL_4` trỏ direct, không pooler như anh đã cấu hình. `DATABASE_URL` hiện dùng cho state/control và thường là pooled; nếu hostname có `-pooler`, thêm `DATABASE_URL_DIRECT` trỏ direct tới **cùng database**. Nếu URL ứng dụng của database 3 hoặc 4 là pooled thì thêm `_3_DIRECT` hoặc `_4_DIRECT` tương ứng. Runtime cần direct connection để tắt subscription lúc promote.
5. Thêm các project ID tương ứng (`NEON_PROJECT_ID_3`, `NEON_PROJECT_ID_4`) vào Vercel Production. URL và tắt pooling chưa đủ để kiểm tra CU hoặc xác nhận replication.
6. Trước khi triển khai mã mới, chạy `pnpm --filter @workspace/db run migrate:database-failover-state` với `DATABASE_URL` tạm thời đặt bằng direct connection string của database điều khiển failover. Migration thêm metadata để phát hiện và xử lý an toàn lần chuyển bị gián đoạn; nếu trạng thái cũ đã kẹt mà không biết kho nguồn/đích, migration đánh dấu cần chủ sở hữu xử lý và giữ khóa ghi. Không chạy migration này với database Replit hoặc database khác.
7. Build API Vercel chạy `migrate:all-vercel-stores` tuần tự trên từng database đã cấu hình, ưu tiên URL direct, bỏ qua URL trùng, rồi chạy `migrate:verify-stores`. Database hoàn toàn trống được khởi tạo bằng migration đã duyệt; database có schema chưa đầy đủ sẽ làm build dừng. Các migration nghiệp vụ lặp lại an toàn. Build chỉ kiểm tra trạng thái failover; migration bảng điều phối vẫn phải chạy tường minh trước khi triển khai.
8. Vercel gọi `/api/retention/cleanup` mỗi Chủ nhật lúc 03:00 UTC. Đặt `CRON_SECRET` trong Production và Preview mà anh muốn chạy; không mở endpoint này cho yêu cầu không có Bearer token.

Ngưỡng mặc định cho từng database là 100 CU-giờ và 1.000.000.000 byte. Có thể đặt ngưỡng dung lượng riêng qua `DATABASE_URL_1_MAX_BYTES`, `DATABASE_URL_MAX_BYTES`, `DATABASE_URL_3_MAX_BYTES` và `DATABASE_URL_4_MAX_BYTES`. Bản sao đầy đủ không cộng dồn dung lượng; nếu tất cả cùng chứa một dữ liệu, chuyển dự phòng không giải quyết được khi chúng cùng chạm ngưỡng lưu trữ.

Trước các API route, runtime kiểm tra dung lượng và CU khi có request, không chạy khi ứng dụng nhàn rỗi; kết quả thành công được dùng lại tối đa 30 giây. Khi Neon API tạm lỗi, runtime dùng số CU tốt gần nhất tối đa 10 phút; nếu không có số gần đây thì mặc định tiếp tục phục vụ nhưng bỏ qua chuyển kho dựa trên CU và ghi cảnh báo. `FAILOVER_REQUIRE_CU_CHECK=1` bật chế độ chặn request khi không xác minh được CU. API Neon có backoff tối đa 60 giây.

Lỗi hết kết nối PostgreSQL (`53300`, pool-acquisition timeout) không tự kích hoạt failover. Với lỗi kết nối thực sự, runtime cần ít nhất 3 lỗi trong 30 giây và một kết nối mới `SELECT 1` thất bại; sau một lần thử chuyển, có cooldown 60 giây. Chuyển cưỡng bức qua `POST /api/database/failover` cần chủ sở hữu, `force: true`, xác nhận `FORCE_<nguồn>_TO_<đích>`, `ALLOW_FORCE_FAILOVER=1`, kho nguồn không kết nối được và kho đích vượt kiểm tra sức khỏe/công suất/sequence. Thao tác này có thể làm mất dữ liệu chưa đồng bộ và cần rà soát lại replication.

Nếu lần chuyển bị gián đoạn, hệ thống đợi 3 phút rồi chỉ tự quay lại kho nguồn khi kho nguồn khỏe, replication nguồn→đích còn bật và chiều ngược đã tắt. Nếu không xác minh được, hệ thống giữ khóa ghi và đưa cảnh báo cho chủ sở hữu; endpoint `POST /api/database/failover/recover` yêu cầu xác nhận nguồn/đích và vẫn chỉ khôi phục khi kiểm tra an toàn đạt.

Nếu không cấu hình `DATABASE_FAILOVER_COORDINATOR_URL`, bảng trạng thái chuyển kho vẫn nằm trên `DATABASE_URL` (DB2). Khi DB2 không truy cập được, runtime có thể không ghi được trạng thái để chuyển tiếp sang DB3/DB4. Muốn bảo đảm chuỗi failover vẫn điều khiển được khi DB2 hỏng, cần một PostgreSQL điều phối độc lập nằm ngoài bốn kho dữ liệu.

Các biến này là cấu hình Vercel; không thay `DATABASE_URL` do Replit quản lý trong môi trường Replit.

Đổi `DATABASE_URL` không sao chép dữ liệu. Database Neon mới phải được áp dụng schema trước khi ứng dụng đọc/ghi được. Dự án có migration ban đầu trong `lib/db/drizzle/0000_initial.sql` và lệnh `pnpm --filter @workspace/db run migrate` để tạo các bảng, bao gồm `members`. Chạy lệnh trong môi trường an toàn mà `DATABASE_URL` đang trỏ chính xác tới database Neon mới; không chạy với `DATABASE_URL` mặc định của Replit. Migration tạo cấu trúc bảng nhưng không sao chép dữ liệu Replit.

Không cấu hình migration để tự chạy trong mỗi lần build Vercel. Nếu database đã có bảng hoặc chứa dữ liệu cần giữ, hãy kiểm tra trạng thái schema trước khi chạy migration.

Không dán connection string hoặc thông tin đăng nhập vào chat hay mã nguồn.
