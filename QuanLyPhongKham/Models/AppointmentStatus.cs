namespace QuanLyPhongKham.Models
{
    // Hằng trạng thái lịch hẹn — thay cho "magic string" rải rác khắp code.
    // Giá trị giữ NGUYÊN chuỗi tiếng Việt đang lưu trong DB để tương thích dữ liệu cũ.
    public static class AppointmentStatus
    {
        public const string Pending   = "Chờ xác nhận";
        public const string Confirmed = "Đã xác nhận";
        public const string Rejected  = "Từ chối";
        public const string Paid      = "Đã thanh toán";
        public const string AiBusy    = "Bác sĩ bận - AI đang xử lý";
    }
}
