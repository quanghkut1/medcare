namespace QuanLyPhongKham.Models
{
    public class Doctor
    {
        public int Id { get; set; }
        public string FullName { get; set; } = string.Empty;
        public string Specialty { get; set; } = string.Empty; // Chuyên khoa (TimMach, TieuHoa...)
        public string PhoneNumber { get; set; } = string.Empty;
    }
}
