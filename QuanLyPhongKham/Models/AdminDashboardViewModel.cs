namespace QuanLyPhongKham.Models
{
    public class AdminDashboardViewModel
    {
        public int TotalDoctors { get; set; }
        public int TotalPatients { get; set; }
        public int TotalAppointments { get; set; }
        public int PendingAppts { get; set; }
        public List<Account> Accounts { get; set; } = new();
    }
}
