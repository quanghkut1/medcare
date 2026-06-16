using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuanLyPhongKham.Migrations
{
    /// <inheritdoc />
    public partial class AddChatMessagesAndAppointmentFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Diagnosis",
                table: "Appointments",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Prescription",
                table: "Appointments",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ChatMessages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    PatientId = table.Column<int>(type: "INTEGER", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    IsAiResponse = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChatMessages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChatMessages_Accounts_PatientId",
                        column: x => x.PatientId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChatMessages_PatientId",
                table: "ChatMessages",
                column: "PatientId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "Diagnosis",
                table: "Appointments");

            migrationBuilder.DropColumn(
                name: "Prescription",
                table: "Appointments");
        }
    }
}
