# SỔ CÔNG — hướng dẫn cấu hình

Ứng dụng quản lý nhân viên, ca làm, dịch vụ và thẻ liệu trình bằng Replit Database. Tài khoản đã đăng nhập có thể xem dữ liệu; quyền chỉnh sửa phụ thuộc vào vai trò chủ sở hữu hoặc quản lý.

## Cấu hình chủ sở hữu

1. Trong biến môi trường, đặt `ADMIN_EMAIL` thành email đã xác minh mà chủ sở hữu dùng với Clerk.
2. Khởi động lại API Server sau khi đổi biến.
3. Chủ sở hữu đăng ký hoặc đăng nhập trong ứng dụng bằng đúng email đó.

Máy chủ so khớp email đã xác minh trong Clerk. Nếu chưa cấu hình `ADMIN_EMAIL`, không tài khoản nào được cấp quyền chủ sở hữu và các yêu cầu thay đổi dữ liệu sẽ bị từ chối.

## Triển khai Vercel

Xem [hướng dẫn cấu hình Vercel](../../VERCEL_DEPLOYMENT.md). Biến môi trường trong Replit không tự chuyển sang Vercel.
