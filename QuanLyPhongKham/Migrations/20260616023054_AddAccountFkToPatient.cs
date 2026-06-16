using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuanLyPhongKham.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountFkToPatient : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "Patients",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Patients_AccountId",
                table: "Patients",
                column: "AccountId");

            migrationBuilder.AddForeignKey(
                name: "FK_Patients_Accounts_AccountId",
                table: "Patients",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Patients_Accounts_AccountId",
                table: "Patients");

            migrationBuilder.DropIndex(
                name: "IX_Patients_AccountId",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "Patients");
        }
    }
}
