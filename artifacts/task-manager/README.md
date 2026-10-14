# Cùng Làm — hướng dẫn cấu hình

Ứng dụng lưu công việc trong Replit Database. Danh sách được phép xem công khai; chỉ tài khoản chủ sở hữu mới được thêm, sửa, hoàn tất hoặc xóa công việc.

## Cấp quyền chủ sở hữu

1. Trong phần biến môi trường của dự án, đặt `ADMIN_EMAIL` thành email đã xác minh mà chủ sở hữu sẽ dùng với Clerk.
2. Khởi động lại API Server sau khi đổi biến.
3. Chủ sở hữu đăng ký hoặc đăng nhập trong ứng dụng bằng đúng email đó.

Email được so khớp ở máy chủ với địa chỉ đã xác minh trong Clerk. Nếu `ADMIN_EMAIL` chưa được cấu hình, tất cả khách truy cập vẫn chỉ xem được và các yêu cầu ghi bị từ chối ở API. Trong giai đoạn chuyển đổi, `OWNER_EMAIL` cũ vẫn được dùng làm giá trị dự phòng.

## Lưu ý dữ liệu

Lần đầu khởi tạo có một công việc mẫu được gắn nhãn “Mẫu”. Có thể xóa công việc này sau khi đăng nhập bằng tài khoản chủ sở hữu.
