using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuanLyPhongKham.Models;
using QuanLyPhongKham.Data;
using QuanLyPhongKham.Helpers;
using Microsoft.AspNetCore.Authorization;
using System.Net;
using System.Net.Mail;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using System.IO;
using System.Text;

namespace QuanLyPhongKham.Controllers
{
    [Authorize]
    public class HomeController : Controller
    {
        private readonly ApplicationDbContext _context;
        private readonly IConfiguration _config;
        private readonly string _emailAppPassword;
        private readonly string _adminEmail;
        private readonly string _bankAccount;
        private readonly string _bankOwner;

        public HomeController(ApplicationDbContext context, IConfiguration config)
        {
            _context = context;
            _config  = config;
            _emailAppPassword = config["EmailSettings:AppPassword"] ?? "";
            _adminEmail       = config["EmailSettings:FromEmail"] ?? "";
            _bankAccount      = config["PaymentSettings:BankAccount"] ?? "";
            _bankOwner        = config["PaymentSettings:BankOwner"] ?? "";
            QuestPDF.Settings.License = LicenseType.Community;
        }

        [AllowAnonymous]
        // Trang chủ thật là file tĩnh phongkham_v6_final.html (giao diện MedCare chính).
        // Chuyển hướng để "/" và "/Home/Index" luôn về đúng trang chính,
        // không hiện trang MVC cũ ("MediCore AI") nữa.
        public IActionResult Index() => Redirect("/phongkham_v6_final.html");

        // ==========================================
        // CÁC TRANG RIÊNG (multi-page) — dùng layout chung _PageLayout
        // ==========================================
        [AllowAnonymous]
        public IActionResult ChuyenKhoa() => View();

        [AllowAnonymous]
        public IActionResult BacSi() =>
            View(_context.Doctors.OrderBy(d => d.Specialty).ThenBy(d => d.FullName).ToList());

        [AllowAnonymous]
        public IActionResult TinTuc() => View();

        [AllowAnonymous]
        public IActionResult LienHe() => View();

        // ==========================================
        // 1. LUỒNG ĐẶT LỊCH & BÁC SĨ XÁC NHẬN
        // ==========================================
        // [ĐÃ XÓA] DatLich — luồng đặt lịch MVC cũ. Form gọi nó (Index.cshtml cũ) đã
        // chết vì Index redirect sang trang chính. Code này còn dính lỗi khóa ngoại
        // (dùng Account.Id làm Appointment.PatientId). Đặt lịch hiện dùng API
        // /api/send-email (ApiController) — đã xử lý PatientId đúng.

        [AllowAnonymous]
        public IActionResult ConfirmFromEmail(int id, string token)
        {
            var app = _context.Appointments
                .Include(a => a.Patient)
                .Include(a => a.Doctor)
                .FirstOrDefault(a => a.Id == id && a.ApprovalToken == token);

            if (app != null)
            {
                app.Status        = "Đã xác nhận";
                app.ApprovalToken = null;
                _context.SaveChanges();

                // Phí khám theo CHUYÊN KHOA (đồng bộ với email đặt lịch — không dùng số cố định)
                long examFee = PricingService.GetExamFee(app.Doctor?.Specialty);

                // Mã thanh toán theo lịch hẹn
                string payCode = $"MEDCARE {app.Id:D6}";
                string qrUrl   = $"https://img.vietqr.io/image/MB-{_bankAccount}-compact2.jpg" +
                                  $"?amount={examFee}&addInfo={Uri.EscapeDataString(payCode)}" +
                                  $"&accountName={Uri.EscapeDataString(_bankOwner)}";

                string subject = $"[MedCare] ✅ Lịch khám #{app.Id} đã được xác nhận!";
                string body    = $@"
                <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px;max-width:560px'>
                  <h2 style='color:#00b896'>✅ Lịch khám đã được duyệt!</h2>
                  <p>Chào <b>{app.Patient?.FullName}</b>,</p>
                  <p>Hẹn gặp bạn vào lúc: <b>{app.AppointmentDate:dd/MM/yyyy HH:mm}</b></p>
                  <hr/>
                  <h3 style='color:#1057a4'>💳 Thanh toán trước qua VietQR</h3>
                  <p>Số tiền: <b style='color:#e53935'>{examFee:N0} VNĐ</b></p>
                  <p>Nội dung CK: <b style='color:#e53935'>{payCode}</b></p>
                  <img src='{qrUrl}' style='width:200px;border-radius:10px;margin-top:8px'/>
                </div>";

                SendEmailToPatient(app.PatientEmail ?? _adminEmail, subject, body, null);

                return Content(@"<html><body style='text-align:center;padding-top:60px;font-family:Arial'>
                    <h1 style='color:#00b896'>✔️ XÁC NHẬN THÀNH CÔNG!</h1>
                    <p>Email thông báo đã gửi đến bệnh nhân.</p>
                    </body></html>", "text/html; charset=utf-8");
            }
            return Content("Mã không hợp lệ hoặc đã hết hạn.");
        }

        // ==========================================
        // 2. LUỒNG AI AGENT XỬ LÝ LỊCH TỪ CHỐI
        // ==========================================
        [AllowAnonymous]
        public IActionResult RejectFromEmail(int id, string token)
        {
            var app = _context.Appointments
                .Include(a => a.Patient)
                .FirstOrDefault(a => a.Id == id && a.ApprovalToken == token);

            if (app != null)
            {
                app.Status        = "Bác sĩ bận - AI đang xử lý";
                app.ApprovalToken = null;
                _context.SaveChanges();

                var suggestedSlots = GetAiSuggestedSlots(app.DoctorId, app.AppointmentDate);
                SendAiSuggestionToPatient(app, suggestedSlots);

                return Content(@"<html><body style='text-align:center;padding-top:60px;font-family:Arial'>
                    <h1 style='color:#e53935'>❌ ĐÃ TỪ CHỐI</h1>
                    <p>AI Agent đang liên hệ với bệnh nhân để đổi lịch.</p>
                    </body></html>", "text/html; charset=utf-8");
            }
            return Content("Mã không hợp lệ.");
        }

        private List<DateTime> GetAiSuggestedSlots(int doctorId, DateTime busyDate)
        {
            var suggestions = new List<DateTime>();
            var busySlots   = _context.Appointments
                .Where(a => a.DoctorId == doctorId && a.Status != "Từ chối")
                .Select(a => a.AppointmentDate).ToList();

            DateTime checkDate = busyDate.Date;
            int[] hours = { 8, 9, 10, 14, 15, 16 };

            for (int d = 0; d < 3; d++)
            {
                foreach (int h in hours)
                {
                    DateTime slot = checkDate.AddDays(d).AddHours(h);
                    if (slot > DateTime.Now && !busySlots.Contains(slot))
                    {
                        suggestions.Add(slot);
                        if (suggestions.Count >= 3) return suggestions;
                    }
                }
            }
            return suggestions;
        }

        [AllowAnonymous]
        public IActionResult PatientConfirmNewSlot(int id, long newDate)
        {
            var app = _context.Appointments.FirstOrDefault(a => a.Id == id);
            if (app != null)
            {
                app.AppointmentDate = new DateTime(newDate);
                app.Status          = "Đã xác nhận (AI)";
                _context.SaveChanges();

                // Gửi email xác nhận lịch mới + QR mới
                string payCode = $"MEDCARE {app.Id:D6}";
                string qrUrl   = $"https://img.vietqr.io/image/MB-{_bankAccount}-compact2.jpg" +
                                  $"?amount=200000&addInfo={Uri.EscapeDataString(payCode)}" +
                                  $"&accountName={Uri.EscapeDataString(_bankOwner)}";

                string subject = $"[MedCare] 🗓️ Lịch khám mới: {app.AppointmentDate:dd/MM/yyyy HH:mm}";
                string body    = $@"
                <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px;max-width:560px'>
                  <h2 style='color:#1057a4'>🗓️ Lịch khám đã được cập nhật!</h2>
                  <p>Giờ khám mới: <b style='color:#00b896'>{app.AppointmentDate:dd/MM/yyyy HH:mm}</b></p>
                  <hr/>
                  <h3 style='color:#1057a4'>💳 Thanh toán qua VietQR</h3>
                  <p>Nội dung CK: <b style='color:#e53935'>{payCode}</b></p>
                  <img src='{qrUrl}' style='width:200px;border-radius:10px;margin-top:8px'/>
                </div>";

                SendEmailToPatient(app.PatientEmail ?? _adminEmail, subject, body, null);

                return Content(@"<html><body style='text-align:center;padding-top:60px;font-family:Arial'>
                    <h1 style='color:#00b896'>✔️ AI ĐÃ CẬP NHẬT LỊCH!</h1>
                    <p>Hẹn gặp bạn tại phòng khám.</p>
                    </body></html>", "text/html; charset=utf-8");
            }
            return Content("Lỗi xác nhận.");
        }

        // ==========================================
        // 3. LUỒNG LẬP BỆNH ÁN & XUẤT HÓA ĐƠN PDF
        // ==========================================
        [HttpPost]
        [Authorize(Roles = "Doctor")]
        public IActionResult LuuBenhAn(int AppointmentId, string Diagnosis, string Prescription, string Notes)
        {
            var app = _context.Appointments
                .Include(a => a.Patient)
                .Include(a => a.Doctor)
                .FirstOrDefault(a => a.Id == AppointmentId);

            if (app != null)
            {
                app.Status       = "Đã khám & Xuất HĐ";
                // LƯU chẩn đoán & đơn thuốc vào DB — MedBot và AI-brief đọc từ đây
                // (trước đây chỉ in PDF mà không lưu → grounding thiếu dữ liệu).
                app.Diagnosis    = Diagnosis;
                app.Prescription = Prescription;
                _context.SaveChanges();

                // Hóa đơn = phí khám theo chuyên khoa + tiền thuốc theo đơn (PricingService)
                var invoice = PricingService.EstimateFromText(app.Doctor?.Specialty, Prescription);
                long total  = invoice.GrandTotal;

                var pdfBytes = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A5);
                        page.Margin(1.5f, Unit.Centimetre);
                        page.PageColor(Colors.White);
                        page.DefaultTextStyle(x => x.FontSize(11).FontFamily(Fonts.Arial));

                        page.Header().AlignCenter()
                            .Text("MEDCARE PHÒNG KHÁM ĐA KHOA")
                            .SemiBold().FontSize(16).FontColor(Colors.Blue.Darken2);

                        page.Content().PaddingVertical(1, Unit.Centimetre).Column(x =>
                        {
                            x.Item().AlignCenter().Text("BỆNH ÁN & HÓA ĐƠN").Bold().FontSize(14);
                            x.Item().PaddingTop(10).Text($"Mã phiếu: #{app.Id}");
                            x.Item().Text($"Bệnh nhân: {app.Patient?.FullName}");
                            x.Item().Text($"Thời gian: {DateTime.Now:dd/MM/yyyy HH:mm}");
                            x.Item().PaddingTop(5).LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
                            x.Item().PaddingTop(10).Text("CHẨN ĐOÁN:").Bold();
                            x.Item().Text(Diagnosis);
                            x.Item().PaddingTop(10).Text("ĐƠN THUỐC:").Bold();
                            x.Item().Text(Prescription);
                            if (!string.IsNullOrEmpty(Notes))
                            {
                                x.Item().PaddingTop(10).Text("GHI CHÚ:").Bold();
                                x.Item().Text(Notes);
                            }
                            x.Item().PaddingTop(5).LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
                            x.Item().PaddingTop(10).AlignRight()
                                .Text($"Phí khám ({app.Doctor?.Specialty ?? "Đa khoa"}): {invoice.ExamFee:N0} VNĐ");
                            x.Item().AlignRight()
                                .Text($"Tiền thuốc: {invoice.DrugTotal:N0} VNĐ");
                            x.Item().AlignRight()
                                .Text($"TỔNG TIỀN: {total:N0} VNĐ").Bold().FontColor(Colors.Red.Medium);
                        });
                    });
                }).GeneratePdf();

                // QR đúng số tài khoản thật + đúng TỔNG TIỀN (phí khám + thuốc)
                string payCode = $"MEDCARE {app.Id:D6}";
                string qrUrl   = $"https://img.vietqr.io/image/MB-{_bankAccount}-compact2.jpg" +
                                  $"?amount={total}&addInfo={Uri.EscapeDataString(payCode)}" +
                                  $"&accountName={Uri.EscapeDataString(_bankOwner)}";

                string subject = $"[MedCare] Bệnh án & Hóa đơn #{app.Id}";
                string body    = $@"
                <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px;text-align:center;max-width:560px'>
                  <h2 style='color:#1057a4'>🏥 Hoàn Tất Khám Bệnh</h2>
                  <p>Xin chào <b>{app.Patient?.FullName}</b>, file PDF bệnh án đã được đính kèm.</p>
                  <hr/>
                  <h3 style='color:#1057a4'>💳 Thanh toán {total:N0} VNĐ</h3>
                  <p style='font-size:13px;color:#6b7280'>Phí khám: {invoice.ExamFee:N0}đ · Tiền thuốc: {invoice.DrugTotal:N0}đ</p>
                  <p>MB Bank · <b>{_bankAccount}</b> · {_bankOwner}</p>
                  <p>Nội dung CK: <b style='color:#e53935'>{payCode}</b></p>
                  <img src='{qrUrl}' style='width:220px;border-radius:10px;margin-top:8px'/>
                </div>";

                // Gửi ĐÚNG bệnh nhân (email lưu lúc đặt lịch); fallback hộp thư phòng khám
                SendEmailToPatient(app.PatientEmail ?? _adminEmail, subject, body, pdfBytes);
                TempData["Message"] = "✅ Đã lưu bệnh án và gửi Hóa đơn PDF + QR đến bệnh nhân!";
            }
            return RedirectToAction("DanhSachLichHen");
        }

        public IActionResult DanhSachLichHen() =>
            View(_context.Appointments.Include(a => a.Patient).OrderByDescending(a => a.Id).ToList());

        public IActionResult Privacy() => View();

        // ==========================================
        // 4. ADMIN DASHBOARD — QUẢN LÝ TÀI KHOẢN
        // ==========================================
        [Authorize(Roles = "Admin")]
        public IActionResult AdminDashboard()
        {
            var vm = new AdminDashboardViewModel
            {
                TotalDoctors      = _context.Accounts.Count(a => a.Role == "Doctor"),
                TotalPatients     = _context.Accounts.Count(a => a.Role == "Patient"),
                TotalAppointments = _context.Appointments.Count(),
                PendingAppts      = _context.Appointments.Count(a => a.Status == "Chờ xác nhận"),
                Accounts          = _context.Accounts.OrderBy(a => a.Role).ToList(),
            };
            return View(vm);
        }

        [Authorize(Roles = "Admin")]
        public IActionResult QuanLyTaiKhoan()
        {
            var accounts = _context.Accounts
                .OrderBy(a => a.Role).ThenBy(a => a.Username).ToList();
            return View(accounts);
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [Authorize(Roles = "Admin")]
        public IActionResult TaoTaiKhoan(Account model)
        {
            if (_context.Accounts.Any(a => a.Username == model.Username))
            {
                TempData["Error"] = "Tên đăng nhập đã tồn tại!";
                return RedirectToAction("QuanLyTaiKhoan");
            }

            model.Password = BCrypt.Net.BCrypt.HashPassword(model.Password);
            model.Email    = model.Email ?? "";
            _context.Accounts.Add(model);
            _context.SaveChanges();

            TempData["Success"] = $"Đã tạo tài khoản {model.Role}: {model.Username}";
            return RedirectToAction("QuanLyTaiKhoan");
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [Authorize(Roles = "Admin")]
        public IActionResult XoaTaiKhoan(int id)
        {
            var acc = _context.Accounts.Find(id);
            if (acc != null && acc.Role != "Admin")
            {
                _context.Accounts.Remove(acc);
                _context.SaveChanges();
                TempData["Success"] = $"Đã xóa tài khoản: {acc.Username}";
            }
            return RedirectToAction("QuanLyTaiKhoan");
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        [Authorize(Roles = "Admin")]
        public IActionResult ResetPassword(int id, string newPassword)
        {
            var acc = _context.Accounts.Find(id);
            if (acc != null && !string.IsNullOrWhiteSpace(newPassword))
            {
                acc.Password = BCrypt.Net.BCrypt.HashPassword(newPassword);
                _context.SaveChanges();
                TempData["Success"] = $"Đã reset mật khẩu cho: {acc.Username}";
            }
            return RedirectToAction("QuanLyTaiKhoan");
        }

        // [ĐÃ XÓA] SendEmailToDoctor — chỉ phục vụ DatLich (đã xóa). Email lịch hẹn
        // hiện do ApiController.SendEmail đảm nhiệm.

        private void SendAiSuggestionToPatient(Appointment app, List<DateTime> slots)
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append($@"
                <div style='font-family:Arial;border:1px solid #ddd;padding:24px;border-radius:12px;max-width:560px'>
                  <h2 style='color:#1057a4'>🤖 AI Agent — Gợi ý lịch khám mới</h2>
                  <p>Bác sĩ hiện bận lịch đột xuất. Vui lòng chọn một trong các khung giờ trống sau:</p>
                  <ul style='list-style:none;padding:0'>");

                foreach (var slot in slots)
                {
                    string url = $"{Request.Scheme}://{Request.Host}/Home/PatientConfirmNewSlot" +
                                 $"?id={app.Id}&newDate={slot.Ticks}";
                    sb.Append($@"
                    <li style='margin-bottom:12px'>
                      <a href='{url}' style='background:#1057a4;color:white;padding:10px 20px;
                         text-decoration:none;border-radius:8px;font-weight:bold'>
                         📅 {slot:dd/MM/yyyy} · {slot:HH:mm}–{slot.AddHours(1):HH:mm}
                      </a>
                    </li>");
                }
                sb.Append("</ul></div>");

                var mail = new MailMessage(_adminEmail, app.PatientEmail ?? _adminEmail)
                {
                    Subject    = "[MedCare] 🤖 AI gợi ý khung giờ khám mới",
                    Body       = sb.ToString(),
                    IsBodyHtml = true
                };
                new SmtpClient("smtp.gmail.com", 587)
                {
                    Credentials = new NetworkCredential(_adminEmail, _emailAppPassword),
                    EnableSsl   = true
                }.Send(mail);
            }
            catch (Exception ex) { Console.WriteLine($"[SendAiSuggestion] {ex.Message}"); }
        }

        private void SendEmailToPatient(string toEmail, string subject,
                                        string bodyHtml, byte[]? pdfAttachment)
        {
            try
            {
                // ── Ưu tiên Brevo HTTP API (cổng 443) — Railway CHẶN cổng SMTP 587.
                //    (Cùng lý do ApiController.SendMailAsync đã chuyển sang Brevo.) ──
                var brevoKey = _config["BrevoApiKey"];
                if (!string.IsNullOrWhiteSpace(brevoKey))
                {
                    using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                    http.DefaultRequestHeaders.Add("api-key", brevoKey);
                    object payload = pdfAttachment == null
                        ? new
                          {
                              sender      = new { email = _adminEmail, name = "MedCare" },
                              to          = new[] { new { email = toEmail } },
                              subject,
                              htmlContent = bodyHtml,
                          }
                        : new
                          {
                              sender      = new { email = _adminEmail, name = "MedCare" },
                              to          = new[] { new { email = toEmail } },
                              subject,
                              htmlContent = bodyHtml,
                              attachment  = new[] { new { name = "BenhAn_HoaDon.pdf",
                                                          content = Convert.ToBase64String(pdfAttachment) } },
                          };
                    var resp = System.Net.Http.Json.HttpClientJsonExtensions
                        .PostAsJsonAsync(http, "https://api.brevo.com/v3/smtp/email", payload)
                        .GetAwaiter().GetResult();
                    if (!resp.IsSuccessStatusCode)
                        Console.WriteLine($"[SendEmailToPatient] Brevo {(int)resp.StatusCode}: " +
                            resp.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                    return;
                }

                // ── Local dev: Gmail SMTP (máy cá nhân không chặn cổng 587) ──
                var mail = new MailMessage(_adminEmail, toEmail)
                {
                    Subject    = subject,
                    Body       = bodyHtml,
                    IsBodyHtml = true
                };
                if (pdfAttachment != null)
                    mail.Attachments.Add(new Attachment(
                        new MemoryStream(pdfAttachment),
                        "BenhAn_HoaDon.pdf",
                        "application/pdf"));

                new SmtpClient("smtp.gmail.com", 587)
                {
                    Credentials = new NetworkCredential(_adminEmail, _emailAppPassword),
                    EnableSsl   = true
                }.Send(mail);
            }
            catch (Exception ex) { Console.WriteLine($"[SendEmailToPatient] {ex.Message}"); }
        }
    }
}
