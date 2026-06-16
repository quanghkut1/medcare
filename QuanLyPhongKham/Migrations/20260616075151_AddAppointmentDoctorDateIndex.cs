using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuanLyPhongKham.Migrations
{
    /// <inheritdoc />
    public partial class AddAppointmentDoctorDateIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Appointments_DoctorId",
                table: "Appointments");

            migrationBuilder.CreateIndex(
                name: "IX_Appointments_DoctorId_AppointmentDate",
                table: "Appointments",
                columns: new[] { "DoctorId", "AppointmentDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Appointments_DoctorId_AppointmentDate",
                table: "Appointments");

            migrationBuilder.CreateIndex(
                name: "IX_Appointments_DoctorId",
                table: "Appointments",
                column: "DoctorId");
        }
    }
}
