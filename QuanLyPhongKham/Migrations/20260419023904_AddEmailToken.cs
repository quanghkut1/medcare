using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuanLyPhongKham.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovalToken",
                table: "Appointments",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApprovalToken",
                table: "Appointments");
        }
    }
}
