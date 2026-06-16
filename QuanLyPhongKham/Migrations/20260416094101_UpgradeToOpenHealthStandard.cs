using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuanLyPhongKham.Migrations
{
    /// <inheritdoc />
    public partial class UpgradeToOpenHealthStandard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Email",
                table: "Patients");

            migrationBuilder.AlterColumn<string>(
                name: "PhoneNumber",
                table: "Patients",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "Patients",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DateOfBirth",
                table: "Patients",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Gender",
                table: "Patients",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Username",
                table: "Patients",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MedicalRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    PatientId = table.Column<int>(type: "INTEGER", nullable: false),
                    DoctorId = table.Column<int>(type: "INTEGER", nullable: false),
                    ExaminationDate = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Diagnosis = table.Column<string>(type: "TEXT", nullable: false),
                    Prescription = table.Column<string>(type: "TEXT", nullable: false),
                    Notes = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MedicalRecords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MedicalRecords_Doctors_DoctorId",
                        column: x => x.DoctorId,
                        principalTable: "Doctors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MedicalRecords_Patients_PatientId",
                        column: x => x.PatientId,
                        principalTable: "Patients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MedicalRecords_DoctorId",
                table: "MedicalRecords",
                column: "DoctorId");

            migrationBuilder.CreateIndex(
                name: "IX_MedicalRecords_PatientId",
                table: "MedicalRecords",
                column: "PatientId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MedicalRecords");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "DateOfBirth",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "Gender",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "Username",
                table: "Patients");

            migrationBuilder.AlterColumn<string>(
                name: "PhoneNumber",
                table: "Patients",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Patients",
                type: "TEXT",
                nullable: false,
                defaultValue: "");
        }
    }
}
