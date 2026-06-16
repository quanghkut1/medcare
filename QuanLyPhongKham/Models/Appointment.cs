using System;

namespace QuanLyPhongKham.Models
{
    public class Appointment
    {
        public int Id { get; set; }
        public string Symptoms { get; set; } = string.Empty; // Triệu chứng bệnh nhân nhập
        public DateTime AppointmentDate { get; set; } // Ngày giờ khám
        public string Status { get; set; } = "Chờ xác nhận"; // Trạng thái lịch hẹn
        
        // Khóa ngoại liên kết tới Bảng Bệnh nhân
        public int PatientId { get; set; }
        public Patient? Patient { get; set; }

        // Khóa ngoại liên kết tới Bảng Bác sĩ
        public int DoctorId { get; set; }
        public Doctor? Doctor { get; set; }
        public string? ApprovalToken { get; set; } // Mã định danh duy nhất cho mỗi lịch hẹn
        public string? Diagnosis { get; set; }      // Chẩn đoán từ EMR
        public string? Prescription { get; set; }   // Đơn thuốc từ EMR

        // Email bệnh nhân nhập lúc đặt lịch — để các email xác nhận/đổi lịch sau này
        // gửi ĐÚNG tới bệnh nhân thay vì rơi về hộp thư admin.
        public string? PatientEmail { get; set; }
    }
}
