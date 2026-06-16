using Microsoft.EntityFrameworkCore;
using QuanLyPhongKham.Models;

namespace QuanLyPhongKham.Data
{   
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        public DbSet<Doctor> Doctors { get; set; }
        public DbSet<Patient> Patients { get; set; }
        public DbSet<Appointment> Appointments { get; set; }
        public DbSet<Account> Accounts { get; set; } // Bảng Tài khoản

        public DbSet<MedicalRecord> MedicalRecords { get; set; }
        public DbSet<ChatMessage> ChatMessages { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Index hỗ trợ truy vấn chống đặt trùng giờ + liệt kê lịch theo bác sĩ/thời gian.
            modelBuilder.Entity<Appointment>()
                .HasIndex(a => new { a.DoctorId, a.AppointmentDate });
        }
    }
}
