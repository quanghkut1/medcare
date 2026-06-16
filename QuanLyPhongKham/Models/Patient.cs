using System.ComponentModel.DataAnnotations;

namespace QuanLyPhongKham.Models
{
    public class Patient
    {
        public int Id { get; set; }
        
        [Required]
        public string FullName { get; set; } = string.Empty;
        
        public DateTime? DateOfBirth { get; set; }
        public string? Gender { get; set; } // Nam/Nữ/Khác
        public string? Address { get; set; }
        public string? PhoneNumber { get; set; }
        
        // Liên kết với tài khoản đăng nhập (giữ Username để tương thích ngược)
        public string? Username { get; set; }

        // Khóa ngoại CỨNG tới Account (thay liên kết mềm qua Username).
        // Nullable: bệnh nhân do admin tạo hộ có thể chưa gắn tài khoản.
        public int? AccountId { get; set; }
        public Account? Account { get; set; }
        
        public ICollection<Appointment>? Appointments { get; set; }
    }
}
