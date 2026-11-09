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
| `DATABASE_URL_1` | API | DB1: kho chính của chấm công cơ sở/nhân viên. |
| `DATABASE_URL` | API | DB2: kho chính của thẻ và lịch sử thẻ; giữ kín chuỗi kết nối. |
| `DATABASE_URL_3` | API | DB3: kho chính của sổ chấm công cá nhân. |
| `DATABASE_URL_4` | API | DB4: kho chính của dữ liệu dùng chung và bộ điều phối phân vùng. |
| `NEON_DB1_DIRECT_URL`, `NEON_DB2_DIRECT_URL`, `NEON_DB3_DIRECT_URL`, `NEON_DB4_DIRECT_URL` | Migration trong build | Bí danh direct tương ứng lần lượt với `DATABASE_URL_1`, `DATABASE_URL`, `DATABASE_URL_3`, `DATABASE_URL_4`; mỗi URL phải dùng `postgres://` hoặc `postgresql://` và hostname không có `-pooler`. Nếu không có biến direct, mã thử URL runtime tương ứng nhưng chỉ chấp nhận endpoint direct. |
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

## Migration tự động trong build Vercel

Chủ dự án đã chọn giữ migration tự động. Build của service `api-server` chạy đúng thứ tự trong `vercel.json`:

1. `pnpm --filter @workspace/db run migrate:all-vercel-stores`
2. `pnpm --filter @workspace/db run migrate:verify-stores`
3. `pnpm -r --filter @workspace/api-server... --if-present run build`

Chuỗi này chạy ở mỗi build của `api-server`; không nằm trong build của `task-manager` hay `mockup-sandbox`. `migrate:all-vercel-stores` kiểm tra cấu hình runtime và bốn URL migration direct hợp lệ, khác nhau trước khi mở kết nối hay thay đổi schema. Sau đó script xử lý theo thứ tự DB1 → DB2 → DB3 → DB4. Với kho trống, script áp dụng migration nền đã duyệt; với kho đã có bảng, script không tạo baseline hoặc reset dữ liệu mà chạy các migration tương thích. Sau khi cả bốn kho chạy xong mới bắt đầu bước xác minh; API chỉ build nếu xác minh thành công.

Migration không phải một giao dịch phân tán giữa bốn database. Nếu một script lỗi, build dừng tại đó nhưng các bước schema đã hoàn tất trước lỗi có thể vẫn còn. Các migration tương thích được thiết kế để chạy lại; sau khi sửa nguyên nhân, chạy lại build trên đúng môi trường để hoàn tất các bước còn thiếu và xác minh. Không xóa bảng, tạo baseline mới hoặc hoàn tác thủ công chỉ vì build dừng giữa chừng. Nếu lỗi là sai cấu trúc/dữ liệu, cần đối chiếu database và thông báo lỗi cụ thể trước khi chạy lại.

`apply-business-tenancy.mjs` bắt buộc cả bốn endpoint là PostgreSQL direct, không qua pooler. Nếu thiếu, lặp lại, sai định dạng hoặc trỏ qua pooler, bước preflight dừng build trước khi mở database; thông báo nêu DB và tên biến cần sửa nhưng không in URL. Hãy cấu hình các biến direct trong đúng môi trường Vercel đang build. Preview cũng chạy cùng chuỗi migration; dùng bốn database riêng cho Preview để tránh migration Preview chạm vào Production.

Trước khi phát hành Production, xác nhận bốn URL của môi trường Production trỏ tới bốn database khác nhau, bốn endpoint direct hợp lệ, và log build hoàn tất migration trên đủ bốn kho rồi xác minh schema. Không chạy một lệnh migration thủ công song song với build tự động.

## Neon PostgreSQL cho Vercel

API dùng `pg` và Drizzle. Bốn kho giữ phân vùng dữ liệu cố định; không tự chuyển toàn bộ ứng dụng hay di chuyển dữ liệu cũ:

1. Cặp kho cố định: cơ sở/chấm công `DB1 → DB2`; thẻ và nhật ký thẻ `DB2 → DB3`; sổ cá nhân `DB3 → DB4`; dữ liệu dùng chung `DB4 → DB3`. Mỗi thao tác được ghi vào đúng hai kho của cặp, còn DB4 điều phối thứ tự thao tác.
2. Không còn ngưỡng 100 CU-giờ/1 GB hoặc truy vấn dung lượng/CU trên từng API request. Nếu ghi nhận lỗi đầy dung lượng, thao tác dừng ở cặp kho đã gán để anh tự nâng cấp. Chỉ lỗi kết nối thật mới được thử một cặp khác; không đổi kho vì CU/dung lượng và không di chuyển dữ liệu cũ.
3. Cả bốn database cần schema ứng dụng và schema nhật ký phân vùng. Build tự động áp dụng rồi xác minh schema theo quy trình ở mục “Migration tự động trong build Vercel”; giữ đủ bốn URL runtime và bốn URL direct migration.
4. Không đưa `storage_partition_events` vào publication/subscription Neon. Ứng dụng ghi hai bản sao theo cặp cố định. Các subscription failover cũ không còn được dùng để chuyển toàn bộ database. Nếu không còn hệ thống nào khác cần replication cũ, có thể dừng các subscription `socong_source_from_db1_v1` (DB2), `socong_db3_from_source_v1` (DB3), `socong_db4_from_db3_v1` (DB4), `socong_db1_from_db2_v1` (DB1), `socong_db2_from_db3_v1` (DB2), `socong_db3_from_db4_v1` (DB3) để giảm công việc replication. Kiểm tra dữ liệu nền cũ và đối soát trước; gỡ subscription trước publication.
5. Vercel gọi `/api/retention/cleanup` mỗi Chủ nhật lúc 03:00 UTC. Giữ `CRON_SECRET` trong Production và Preview mà anh muốn chạy; không mở endpoint này cho yêu cầu không có Bearer token.

Để giảm CU khi đọc, mỗi lần đọc không có cache chỉ truy vấn nhật ký ở ba kho trước; kho thứ tư chỉ được hỏi nếu cần thay thế một kho không đọc được. Vì mỗi sự kiện đã có hai bản sao trên hai kho khác nhau, ba kho bất kỳ vẫn chứa ít nhất một bản sao của mọi sự kiện. Bản dữ liệu nền được đọc từ kho đầu tiên đọc được, chỉ thử kho kế tiếp nếu truy vấn đó lỗi. Kiểm tra schema điều phối DB4 được cache 60 giây; cache kết quả đọc vẫn là 3 giây. Đường ghi tiếp tục xác nhận hai bản sao và trạng thái thao tác trên DB4 để giữ khả năng khôi phục/idempotency.

Ứng dụng không còn gọi Neon Usage API, truy vấn ngưỡng CU/dung lượng, hay tự chuyển kho theo các ngưỡng đó. Sau khi triển khai bản này, có thể xóa các biến cũ chỉ phục vụ việc đo ngưỡng và failover toàn cục: `NEON_API_KEY`, `NEON_PROJECT_ID_1`, `NEON_PROJECT_ID`, `NEON_PROJECT_ID_3`, `NEON_PROJECT_ID_4`, `DATABASE_URL_1_MAX_BYTES`, `DATABASE_URL_MAX_BYTES`, `DATABASE_URL_3_MAX_BYTES`, `DATABASE_URL_4_MAX_BYTES`, `FAILOVER_REQUIRE_CU_CHECK`, `PARTITION_REQUIRE_CU_CHECK`, `ALLOW_FORCE_FAILOVER`, `DATABASE_FAILOVER_COORDINATOR_URL` và `DATABASE_FAILOVER_COORDINATOR_BACKEND`. Việc xóa các biến này không xóa dữ liệu và không đổi phân vùng DB1–DB4. Không xóa `DATABASE_URL`, `DATABASE_URL_1`, `DATABASE_URL_3`, `DATABASE_URL_4`, `DATABASE_STORAGE_MODE`, các URL direct dùng cho migration, `CRON_SECRET` hoặc khóa Clerk.

Các biến này là cấu hình Vercel; không thay `DATABASE_URL` do Replit quản lý trong môi trường Replit.

Đổi `DATABASE_URL` không sao chép dữ liệu. Lệnh đơn kho `pnpm --filter @workspace/db run migrate` dùng cho thao tác chủ động trên một database đã chọn; không thay thế chuỗi build Vercel tự động nhiều kho. Chỉ chạy lệnh này trong môi trường an toàn mà `DATABASE_URL` trỏ chính xác tới database đích; không chạy với `DATABASE_URL` mặc định của Replit. Migration tạo cấu trúc bảng nhưng không sao chép dữ liệu Replit.

Build Vercel áp dụng và xác minh schema trên bốn kho bằng hai lệnh ở trên. Không thêm migration baseline khác vào build; nếu thay đổi quy trình build, cần có lựa chọn rõ ràng của chủ dự án và kiểm tra đúng môi trường cùng bốn URL trước để tránh ghi nhầm database.

Không dán connection string hoặc thông tin đăng nhập vào chat hay mã nguồn.
