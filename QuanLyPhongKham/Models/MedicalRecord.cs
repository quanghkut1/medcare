namespace QuanLyPhongKham.Models
{
    public class MedicalRecord
    {
        public int Id { get; set; }
        public int PatientId { get; set; }
        public Patient? Patient { get; set; }
        
        public int DoctorId { get; set; }
        public Doctor? Doctor { get; set; }
        
        public DateTime ExaminationDate { get; set; } = DateTime.Now;
        public string Diagnosis { get; set; } = string.Empty; // Chẩn đoán bệnh
        public string Prescription { get; set; } = string.Empty; // Đơn thuốc
        public string Notes { get; set; } = string.Empty; // Ghi chú thêm
    }
}
