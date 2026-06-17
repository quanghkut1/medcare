using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using QuanLyPhongKham.Data;
using QuanLyPhongKham.Helpers;
using QuanLyPhongKham.Models;
using System.Net;
using System.Net.Http.Json;
using System.Net.Mail;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

// ════════════════════════════════════════════════════════════════
//  ApiController.cs  —  REST API cho phongkham_v6.html
//  Tất cả endpoint đều trả JSON, không dùng Razor View
// ════════════════════════════════════════════════════════════════

namespace QuanLyPhongKham.Controllers
{
    [Route("api")]
    [ApiController]
    public class ApiController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        private readonly string _emailPass;
        private readonly string _fromEmail;
        private readonly string _bankAcc;
        private readonly string _bankOwner;

        private readonly IConfiguration _config;
        private readonly HttpClient     _http;
        private readonly IMemoryCache   _cache;
        private const string ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

        public ApiController(ApplicationDbContext context, IConfiguration config, IHttpClientFactory httpFactory, IMemoryCache cache)
        {
            _context   = context;
            _config    = config;
            _cache     = cache;
            _emailPass = config["EmailSettings:AppPassword"] ?? "";
            _fromEmail = config["EmailSettings:FromEmail"] ?? "";
            _bankAcc   = config["PaymentSettings:BankAccount"] ?? "";
            _bankOwner = config["PaymentSettings:BankOwner"] ?? "";
            _http      = httpFactory.CreateClient();
            var apiKey = config["AnthropicApiKey"];
            if (!string.IsNullOrWhiteSpace(apiKey))
                _http.DefaultRequestHeaders.Add("x-api-key", apiKey);
            _http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
        }

        // ════════════════════════════════════════
        // POST /api/login
        // Body: { username, password, role }
        // ════════════════════════════════════════
        // ── Khóa tạm chống dò mật khẩu: 5 lần sai → khóa 5 phút (theo username) ──
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string,(int count, DateTime until)> _lockouts = new();
        // Idempotency webhook: nhớ các transaction đã xử lý (chống Casso gửi lặp)
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string,byte> _processedTx = new();
        private const int MAX_FAILS = 5;
        private static readonly TimeSpan LOCK_DURATION = TimeSpan.FromMinutes(5);
        private static void RegisterFail(string key)
        {
            var e = _lockouts.TryGetValue(key, out var v) ? v : (count: 0, until: default(DateTime));
            int c = e.count + 1;
            DateTime until = c >= MAX_FAILS ? DateTime.UtcNow.Add(LOCK_DURATION) : default;
            _lockouts[key] = (c, until);
        }

        [HttpPost("login")]
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
        public async Task<IActionResult> Login([FromBody] LoginRequest req)
        {
            await Task.Delay(200); // chống brute-force nhẹ

            if (string.IsNullOrWhiteSpace(req.Username) ||
                string.IsNullOrWhiteSpace(req.Password))
                return BadRequest(new { success = false, error = "Vui lòng nhập đầy đủ thông tin!" });

            string lockKey = req.Username.Trim().ToLowerInvariant();
            if (_lockouts.TryGetValue(lockKey, out var lo))
            {
                if (lo.until > DateTime.UtcNow)
                {
                    int secs = (int)(lo.until - DateTime.UtcNow).TotalSeconds;
                    return StatusCode(429, new { success = false, error = $"Tài khoản tạm khóa do sai mật khẩu quá nhiều lần. Thử lại sau {secs} giây." });
                }
                if (lo.until != default) _lockouts.TryRemove(lockKey, out _); // hết khóa → reset đếm
            }

            var user = _context.Accounts
                .FirstOrDefault(a => a.Username == req.Username && a.Role == req.Role);

            if (user == null)
            {
                RegisterFail(lockKey);
                return Unauthorized(new { success = false, error = "Tài khoản không tồn tại hoặc sai vai trò!" });
            }

            // CHỈ chấp nhận mật khẩu băm BCrypt — KHÔNG còn so sánh plain-text.
            // (Toàn bộ tài khoản seed/đăng ký/reset đều đã hash, nên an toàn.)
            bool ok = user.Password.StartsWith("$2") &&
                      BCrypt.Net.BCrypt.Verify(req.Password, user.Password);

            if (!ok)
            {
                RegisterFail(lockKey);
                return Unauthorized(new { success = false, error = "Mật khẩu không chính xác!" });
            }

            _lockouts.TryRemove(lockKey, out _); // đăng nhập thành công → xóa bộ đếm

            // Tạo cookie session
            var claims = new List<Claim>
            {
                new(ClaimTypes.Name,           user.FullName),
                new(ClaimTypes.Role,           user.Role),
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new("Username",                user.Username),
                new("Email",                   user.Email ?? ""),
            };

            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)),
                new AuthenticationProperties { IsPersistent = true, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8) });

            return Ok(new
            {
                success  = true,
                id       = user.Id,
                fullName = user.FullName,
                username = user.Username,
                role     = user.Role,
                email    = user.Email ?? "",
            });
        }

        // ════════════════════════════════════════
        // POST /api/register  — đăng ký tài khoản Bệnh nhân
        // ════════════════════════════════════════
        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<IActionResult> Register([FromBody] RegisterRequest req)
        {
            await Task.Delay(200); // chống spam nhẹ

            // Validate
            if (string.IsNullOrWhiteSpace(req.FullName))
                return BadRequest(new { success = false, error = "Vui lòng nhập họ và tên." });
            if (string.IsNullOrWhiteSpace(req.Username) || req.Username.Trim().Length < 4)
                return BadRequest(new { success = false, error = "Tên đăng nhập tối thiểu 4 ký tự." });
            if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
                return BadRequest(new { success = false, error = "Mật khẩu tối thiểu 6 ký tự." });
            // Độ mạnh: mật khẩu phải có cả CHỮ và SỐ
            if (!req.Password.Any(char.IsLetter) || !req.Password.Any(char.IsDigit))
                return BadRequest(new { success = false, error = "Mật khẩu phải gồm cả chữ và số." });
            // Định dạng email (nếu có nhập)
            if (!string.IsNullOrWhiteSpace(req.Email) &&
                !System.Text.RegularExpressions.Regex.IsMatch(req.Email.Trim(), @"^[^\s@]+@[^\s@]+\.[^\s@]+$"))
                return BadRequest(new { success = false, error = "Email không đúng định dạng." });

            string uname = req.Username.Trim();

            // Trùng tên đăng nhập?
            if (_context.Accounts.Any(a => a.Username == uname))
                return Conflict(new { success = false, error = "Tên đăng nhập đã tồn tại. Vui lòng chọn tên khác." });

            // Tạo tài khoản (luôn là Patient — không cho tự đăng ký Doctor/Admin)
            var acc = new Account
            {
                Username = uname,
                Password = BCrypt.Net.BCrypt.HashPassword(req.Password),
                FullName = req.FullName.Trim(),
                Email    = req.Email?.Trim() ?? "",
                Role     = "Patient",
            };
            _context.Accounts.Add(acc);
            await _context.SaveChangesAsync();

            // Ngày sinh: parse "yyyy-MM-dd" từ input HTML (nếu có)
            DateTime? dob = null;
            if (!string.IsNullOrWhiteSpace(req.DateOfBirth) &&
                DateTime.TryParse(req.DateOfBirth, out var d0))
                dob = d0;

            // Tạo hồ sơ bệnh nhân tương ứng
            _context.Patients.Add(new Patient
            {
                FullName    = acc.FullName,
                Username    = uname,
                AccountId   = acc.Id,   // khóa ngoại cứng tới Account
                PhoneNumber = req.Phone?.Trim(),
                Gender      = string.IsNullOrWhiteSpace(req.Gender) ? null : req.Gender,
                DateOfBirth = dob,
            });
            await _context.SaveChangesAsync();

            // Đăng nhập luôn sau khi đăng ký
            var claims = new List<Claim>
            {
                new(ClaimTypes.Name,           acc.FullName),
                new(ClaimTypes.Role,           acc.Role),
                new(ClaimTypes.NameIdentifier, acc.Id.ToString()),
                new("Username",                acc.Username),
                new("Email",                   acc.Email ?? ""),
            };
            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)),
                new AuthenticationProperties { IsPersistent = true, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8) });

            return Ok(new
            {
                success  = true,
                id       = acc.Id,
                fullName = acc.FullName,
                username = acc.Username,
                role     = acc.Role,
                email    = acc.Email ?? "",
            });
        }

        // ════════════════════════════════════════
        // POST /api/logout
        // ════════════════════════════════════════
        [HttpPost("logout")]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Ok(new { success = true });
        }

        // ════════════════════════════════════════
        // POST /api/forgot-password  — Quên mật khẩu (gửi mật khẩu tạm qua email)
        // ════════════════════════════════════════
        [HttpPost("forgot-password")]
        [AllowAnonymous]
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
        public async Task<IActionResult> ForgotPassword([FromBody] ForgotRequest req)
        {
            await Task.Delay(200);
            var uname = (req.Username ?? "").Trim();
            var email = (req.Email ?? "").Trim();
            if (string.IsNullOrEmpty(uname) || string.IsNullOrEmpty(email))
                return BadRequest(new { success = false, error = "Vui lòng nhập tên đăng nhập và email." });

            var acc = _context.Accounts.FirstOrDefault(a => a.Username == uname);
            // Không tiết lộ tài khoản có tồn tại hay không (chống dò) → luôn báo chung
            if (acc == null || !string.Equals(acc.Email?.Trim(), email, StringComparison.OrdinalIgnoreCase))
                return Ok(new { success = true, message = "Nếu thông tin khớp, mật khẩu mới đã được gửi tới email của bạn." });

            // Sinh mật khẩu tạm (có chữ + số), lưu hash
            string temp = "MedCare@" + new Random().Next(1000, 9999);
            acc.Password = BCrypt.Net.BCrypt.HashPassword(temp);
            _context.SaveChanges();

            try
            {
                string body = $@"<div style='font-family:Arial;padding:20px'>
                    <h2 style='color:#1057a4'>MedCare — Đặt lại mật khẩu</h2>
                    <p>Mật khẩu mới của tài khoản <b>{uname}</b> là:</p>
                    <p style='font-size:22px;font-weight:bold;color:#00b896'>{temp}</p>
                    <p>Vui lòng đăng nhập và đổi lại mật khẩu trong phần Hồ sơ.</p></div>";
                await SendMailAsync(email, "[MedCare] Mật khẩu mới của bạn", body);
            }
            catch (Exception ex) { return Ok(new { success = false, error = "Không gửi được email: " + ex.Message }); }

            return Ok(new { success = true, message = "Mật khẩu mới đã được gửi tới email của bạn." });
        }

        // ════════════════════════════════════════
        // GET /api/profile  — thông tin cá nhân người đang đăng nhập
        // ════════════════════════════════════════
        [HttpGet("profile")]
        [Authorize]
        public IActionResult GetProfile()
        {
            var uname = User.FindFirst("Username")?.Value;
            var acc = _context.Accounts.FirstOrDefault(a => a.Username == uname);
            if (acc == null) return NotFound(new { success = false });
            var pat = _context.Patients.FirstOrDefault(p => p.Username == uname);
            return Ok(new
            {
                success     = true,
                username    = acc.Username,
                role        = acc.Role,
                fullName    = acc.FullName,
                email       = acc.Email ?? "",
                phone       = pat?.PhoneNumber ?? "",
                gender      = pat?.Gender ?? "",
                dateOfBirth = pat?.DateOfBirth?.ToString("yyyy-MM-dd") ?? "",
            });
        }

        // ════════════════════════════════════════
        // POST /api/profile  — cập nhật thông tin cá nhân
        // ════════════════════════════════════════
        [HttpPost("profile")]
        [Authorize]
        public IActionResult UpdateProfile([FromBody] ProfileRequest req)
        {
            var uname = User.FindFirst("Username")?.Value;
            var acc = _context.Accounts.FirstOrDefault(a => a.Username == uname);
            if (acc == null) return NotFound(new { success = false });

            if (string.IsNullOrWhiteSpace(req.FullName))
                return BadRequest(new { success = false, error = "Họ tên không được để trống." });
            if (!string.IsNullOrWhiteSpace(req.Email) &&
                !System.Text.RegularExpressions.Regex.IsMatch(req.Email.Trim(), @"^[^\s@]+@[^\s@]+\.[^\s@]+$"))
                return BadRequest(new { success = false, error = "Email không đúng định dạng." });

            acc.FullName = req.FullName.Trim();
            acc.Email    = req.Email?.Trim() ?? "";

            var pat = _context.Patients.FirstOrDefault(p => p.Username == uname);
            if (pat != null)
            {
                pat.FullName    = acc.FullName;
                pat.PhoneNumber = req.Phone?.Trim();
                pat.Gender      = string.IsNullOrWhiteSpace(req.Gender) ? null : req.Gender;
                if (!string.IsNullOrWhiteSpace(req.DateOfBirth) &&
                    DateTime.TryParse(req.DateOfBirth, out var d0)) pat.DateOfBirth = d0;
            }
            _context.SaveChanges();
            return Ok(new { success = true, fullName = acc.FullName, email = acc.Email });
        }

        // ════════════════════════════════════════
        // POST /api/change-password  — đổi mật khẩu
        // ════════════════════════════════════════
        [HttpPost("change-password")]
        [Authorize]
        public IActionResult ChangePassword([FromBody] ChangePasswordRequest req)
        {
            var uname = User.FindFirst("Username")?.Value;
            var acc = _context.Accounts.FirstOrDefault(a => a.Username == uname);
            if (acc == null) return NotFound(new { success = false });

            bool ok = acc.Password.StartsWith("$2") &&
                      BCrypt.Net.BCrypt.Verify(req.CurrentPassword ?? "", acc.Password);
            if (!ok) return BadRequest(new { success = false, error = "Mật khẩu hiện tại không đúng." });

            var np = req.NewPassword ?? "";
            if (np.Length < 6 || !np.Any(char.IsLetter) || !np.Any(char.IsDigit))
                return BadRequest(new { success = false, error = "Mật khẩu mới tối thiểu 6 ký tự, gồm cả chữ và số." });

            acc.Password = BCrypt.Net.BCrypt.HashPassword(np);
            _context.SaveChanges();
            return Ok(new { success = true });
        }

        // ════════════════════════════════════════
        // GET /api/me
        // Trả về user đang đăng nhập
        // ════════════════════════════════════════
        [HttpGet("me")]
        public IActionResult Me()
        {
            if (User.Identity?.IsAuthenticated != true)
                return Ok(new { loggedIn = false });

            return Ok(new
            {
                loggedIn = true,
                fullName = User.FindFirst(ClaimTypes.Name)?.Value,
                role     = User.FindFirst(ClaimTypes.Role)?.Value,
                username = User.FindFirst("Username")?.Value,
                email    = User.FindFirst("Email")?.Value,
                id       = User.FindFirst(ClaimTypes.NameIdentifier)?.Value,
            });
        }

        // ════════════════════════════════════════
        // POST /api/send-email
        // Gửi email SMTP + lưu lịch hẹn vào DB
        // ════════════════════════════════════════
        [HttpPost("send-email")]
        public async Task<IActionResult> SendEmail([FromBody] EmailRequest req)
        {
            // Lưu lịch hẹn vào DB.
            // LƯU Ý: Appointment.PatientId là FK tới bảng Patients (KHÔNG phải Accounts).
            // Phải tra Patient theo Username của tài khoản đăng nhập, KHÔNG dùng thẳng
            // claim NameIdentifier (đó là Account.Id) → trước đây gây "FOREIGN KEY constraint failed".
            Patient? patient = null;
            var uname = User.FindFirst("Username")?.Value;
            if (!string.IsNullOrEmpty(uname))
                patient = _context.Patients.FirstOrDefault(p => p.Username == uname);

            // Tài khoản không phải bệnh nhân (admin/doctor) hoặc khách đặt hộ →
            // tạo hồ sơ bệnh nhân nhẹ từ thông tin form để lịch hẹn vẫn hợp lệ.
            if (patient == null)
            {
                patient = new Patient
                {
                    FullName    = req.PatientName ?? "Khách đặt lịch",
                    PhoneNumber = req.Phone,
                    Username    = uname,
                };
                _context.Patients.Add(patient);
                _context.SaveChanges();
            }
            int patientId = patient.Id;

            var doctor = _context.Doctors.FirstOrDefault(d => d.Specialty == req.Spec)
                         ?? new Doctor { FullName = req.Doctor ?? "Bác sĩ phụ trách", Specialty = req.Spec ?? "Đa khoa" };
            if (doctor.Id == 0) { _context.Doctors.Add(doctor); _context.SaveChanges(); }

            // Phí đặt lịch = phí khám theo CHUYÊN KHOA (thay cho 200k cố định).
            // Lúc đặt lịch chưa khám nên chỉ tính phí tư vấn; tiền thuốc tính sau khi lập bệnh án.
            req.Amount = PricingService.GetExamFee(req.Spec ?? doctor.Specialty);

            string token = Guid.NewGuid().ToString();
            string shortCode = token[..6].ToUpper();

            // Parse date/time
            DateTime apptDate = DateTime.TryParse(req.Date, out var d) ? d : DateTime.Today.AddDays(1);
            if (TimeSpan.TryParse(req.Time?.Split('–')[0].Trim(), out var t))
                apptDate = apptDate.Date.Add(t);

            // ── CHỐNG ĐẶT TRÙNG GIỜ: cùng bác sĩ + cùng khung giờ + chưa bị từ chối ──
            bool slotTaken = _context.Appointments.Any(a =>
                a.DoctorId == doctor.Id &&
                a.AppointmentDate == apptDate &&
                a.Status != AppointmentStatus.Rejected &&
                a.Status != AppointmentStatus.AiBusy);
            if (slotTaken)
                return Conflict(new { success = false,
                    error = "Khung giờ này của bác sĩ đã có người đặt. Vui lòng chọn giờ khác." });

            var appt = new Appointment
            {
                Symptoms        = req.Symptom ?? req.PatientName ?? "Chưa cung cấp",
                AppointmentDate = apptDate,
                Status          = AppointmentStatus.Pending,
                PatientId       = patientId,
                DoctorId        = doctor.Id,
                ApprovalToken   = token,
                PatientEmail    = req.PatientEmail,   // lưu để các email sau gửi đúng bệnh nhân
            };
            _context.Appointments.Add(appt);
            await _context.SaveChangesAsync();

            string payCode = $"MEDCARE {appt.Id:D6}";
            string qrUrl   = $"https://img.vietqr.io/image/MB-{_bankAcc}-compact2.jpg" +
                             $"?amount={req.Amount}&addInfo={Uri.EscapeDataString(payCode)}" +
                             $"&accountName={Uri.EscapeDataString(_bankOwner)}";

            // Deep links
            string host       = $"{Request.Scheme}://{Request.Host}";
            string confirmUrl = $"{host}/Home/ConfirmFromEmail?id={appt.Id}&token={token}";
            string rejectUrl  = $"{host}/Home/RejectFromEmail?id={appt.Id}&token={token}";

            // Email bệnh nhân
            string patSubject = $"[MedCare] ✅ Xác nhận lịch khám — {req.PatientName} — {req.Date}";
            string patBody    = BuildPatientBookingEmail(req, payCode, qrUrl, appt.Id);

            // Email bác sĩ
            string docSubject = $"[MedCare] 🔔 Lịch hẹn mới: {req.PatientName} — {req.Date} {req.Time}";
            string docBody    = BuildDoctorBookingEmail(req, appt.Id, confirmUrl, rejectUrl);

            // Đợi gửi email để BIẾT kết quả (lịch đã lưu DB rồi → KHÔNG fail đặt lịch nếu email lỗi).
            bool    emailSent  = false;
            string? emailError = null;
            try
            {
                await Task.WhenAll(
                    SendMailAsync(req.PatientEmail ?? _fromEmail, patSubject, patBody),
                    SendMailAsync(req.DoctorEmail  ?? _fromEmail, docSubject, docBody));
                emailSent = true;
            }
            catch (Exception ex)
            {
                emailError = ex.Message;
                Serilog.Log.Error(ex, "Gửi email đặt lịch thất bại");
            }

            return Ok(new
            {
                success       = true,
                appointmentId = appt.Id,
                shortCode,
                token,
                emailSent,
                emailError,
            });
        }

        // ════════════════════════════════════════
        // GET /api/appointments
        // Danh sách lịch hẹn (Doctor/Admin only)
        // ════════════════════════════════════════
        [HttpGet("appointments")]
        [Authorize(Roles = "Doctor,Admin")]
        public IActionResult GetAppointments()
        {
            var list = _context.Appointments
                .Include(a => a.Patient)
                .Include(a => a.Doctor)
                .OrderByDescending(a => a.Id)
                .Select(a => new
                {
                    id        = a.Id,
                    patientId = a.PatientId,
                    patient   = a.Patient != null ? a.Patient.FullName : "—",
                    symptom   = a.Symptoms,
                    doctor    = a.Doctor != null ? a.Doctor.FullName : "—",
                    date      = a.AppointmentDate.ToString("dd/MM/yyyy"),
                    time      = a.AppointmentDate.ToString("HH:mm"),
                    status    = a.Status,
                })
                .ToList();

            return Ok(list);
        }

        // ════════════════════════════════════════
        // GET /api/doctors
        // ════════════════════════════════════════
        [HttpGet("doctors")]
        [AllowAnonymous]
        public IActionResult GetDoctors()
        {
            // Cache 5 phút — danh sách bác sĩ ít thay đổi, tránh query mỗi request.
            var docs = _cache.GetOrCreate("doctors_list", entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
                return _context.Doctors
                    .Select(d => new { d.Id, d.FullName, d.Specialty })
                    .ToList();
            });
            return Ok(docs);
        }

        // ════════════════════════════════════════
        // POST /api/payment-webhook  (Casso)
        // ════════════════════════════════════════
        [HttpPost("payment-webhook")]
        [AllowAnonymous]
        public async Task<IActionResult> PaymentWebhook()
        {
            // ── BẢO MẬT: xác thực webhook bằng secure-token cấu hình trên Casso ──
            // Nếu đã cấu hình CassoWebhookSecret thì BẮT BUỘC khớp; nếu chưa thì
            // cảnh báo (cho phép demo nhưng nhắc nhở chưa an toàn).
            var configuredSecret = _config["CassoWebhookSecret"] ?? "";
            if (!string.IsNullOrEmpty(configuredSecret))
            {
                var token = Request.Headers["secure-token"].FirstOrDefault() ?? "";
                if (!MedCareHelpers.TokensMatch(token, configuredSecret))
                {
                    Console.WriteLine("[Casso Webhook] ⛔ secure-token không hợp lệ — từ chối.");
                    return Unauthorized(new { success = false, error = "Invalid webhook token" });
                }
            }
            else
            {
                Console.WriteLine("[Casso Webhook] ⚠️ Chưa cấu hình CassoWebhookSecret — webhook ĐANG KHÔNG được bảo vệ!");
            }

            using var reader = new StreamReader(Request.Body);
            string body = await reader.ReadToEndAsync();
            Console.WriteLine($"[Casso Webhook] {body}");

            try
            {
                var data = JsonSerializer.Deserialize<JsonElement>(body);
                var transactions = data.TryGetProperty("data", out var arr) && arr.ValueKind == JsonValueKind.Array
                    ? arr.EnumerateArray().ToList()
                    : new List<JsonElement> { data };

                foreach (var tx in transactions)
                {
                    // IDEMPOTENCY (cấp giao dịch): nếu transaction này đã xử lý → bỏ qua.
                    // Casso có thể gửi lặp cùng 1 giao dịch → tránh xử lý/gửi mail nhiều lần.
                    string txId = tx.TryGetProperty("id", out var tid) ? tid.ToString()
                                : tx.TryGetProperty("tid", out var t2) ? t2.ToString()
                                : tx.TryGetProperty("reference", out var rf) ? (rf.GetString() ?? "") : "";
                    if (!string.IsNullOrEmpty(txId) && !_processedTx.TryAdd(txId, 0)) continue;

                    string desc = (tx.TryGetProperty("description", out var d) ? d.GetString() : "") ?? "";

                    var extractedId = MedCareHelpers.ExtractAppointmentId(desc);
                    if (extractedId == null) continue;
                    int apptId = extractedId.Value;

                    var appt = _context.Appointments.Include(a => a.Patient).FirstOrDefault(a => a.Id == apptId);
                    if (appt == null || appt.Status.Contains(AppointmentStatus.Paid)) continue;

                    long amount = tx.TryGetProperty("amount", out var am) ? am.GetInt64() : 200000;
                    appt.Status = AppointmentStatus.Paid;
                    _context.SaveChanges();

                    Console.WriteLine($"[Payment] ✅ Lịch #{apptId} — {appt.Patient?.FullName} — {amount:N0}đ");

                    // Email bệnh nhân
                    string patBody = $@"
                    <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px;text-align:center'>
                      <h2 style='color:#00b896'>✅ THANH TOÁN THÀNH CÔNG</h2>
                      <div style='font-size:28px;font-weight:800;color:#1057a4'>{amount:N0}đ</div>
                      <p>Lịch khám #{apptId} · {appt.AppointmentDate:dd/MM/yyyy HH:mm}</p>
                      <p>Vui lòng đến đúng giờ. Hotline: <b>1900-1234</b></p>
                    </div>";

                    // Email bác sĩ
                    string docBody = $@"
                    <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px'>
                      <h2 style='color:#1057a4'>💰 Bệnh nhân đã thanh toán</h2>
                      <p><b>Bệnh nhân:</b> {appt.Patient?.FullName}</p>
                      <p><b>Lịch #{apptId}:</b> {appt.AppointmentDate:dd/MM/yyyy HH:mm}</p>
                      <p><b>Số tiền:</b> {amount:N0}đ</p>
                    </div>";

                    await Task.WhenAll(
                        SendMailAsync(_fromEmail, $"[MedCare] 💳 Xác nhận thanh toán lịch #{apptId}", patBody),
                        SendMailAsync(_fromEmail, $"[MedCare] 💰 Bệnh nhân đã TT — Lịch #{apptId}", docBody)
                    );
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Webhook Error] {ex.Message}");
            }

            return Ok(new { success = true });
        }

        // ════════════════════════════════════════
        // HELPERS
        // ════════════════════════════════════════
        // Bọc SendMailAsync để dùng fire-and-forget an toàn: nuốt lỗi + ghi log (không làm sập request).
        private async Task SendMailSafe(string to, string subject, string html)
        {
            try { await SendMailAsync(to, subject, html); }
            catch (Exception ex) { Serilog.Log.Error(ex, "Gửi email thất bại tới {To}", to); }
        }

        private async Task SendMailAsync(string to, string subject, string html)
        {
            // ── Ưu tiên Brevo HTTP API (cổng 443) — vì cloud (Railway/Render...) CHẶN cổng SMTP 587 ──
            var brevoKey = _config["BrevoApiKey"];
            if (!string.IsNullOrWhiteSpace(brevoKey))
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                http.DefaultRequestHeaders.Add("api-key", brevoKey);
                var payload = new
                {
                    sender      = new { email = _fromEmail, name = "MedCare" },
                    to          = new[] { new { email = to } },
                    subject,
                    htmlContent = html
                };
                var resp = await http.PostAsJsonAsync("https://api.brevo.com/v3/smtp/email", payload);
                if (!resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync();
                    throw new Exception($"Brevo API {(int)resp.StatusCode}: {body}");
                }
                return;
            }

            // ── Local dev: Gmail SMTP (chạy được vì máy cá nhân không chặn cổng 587) ──
            var mail = new MailMessage(_fromEmail, to)
            {
                Subject = subject, Body = html, IsBodyHtml = true
            };
            var smtp = new SmtpClient("smtp.gmail.com", 587)
            {
                Credentials = new NetworkCredential(_fromEmail, _emailPass),
                EnableSsl   = true,
                Timeout     = 15000
            };
            await Task.Run(() => smtp.Send(mail));
        }

        private string BuildPatientBookingEmail(EmailRequest r, string payCode, string qrUrl, int apptId) => $@"
        <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px;max-width:560px'>
          <h2 style='color:#1057a4'>🏥 MedCare — Xác nhận lịch khám</h2>
          <p>Kính gửi <b>{r.PatientName}</b>,</p>
          <p>Lịch khám của bạn đã được ghi nhận và đang chờ bác sĩ xác nhận.</p>
          <table style='width:100%;border-collapse:collapse;margin:16px 0'>
            <tr><td style='padding:6px;color:#6b7280'>📅 Ngày khám</td><td style='padding:6px;font-weight:600'>{r.Date}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>⏰ Giờ khám</td><td style='padding:6px;font-weight:600'>{r.Time}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>👨‍⚕️ Bác sĩ</td><td style='padding:6px;font-weight:600'>{r.Doctor}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>🏥 Chuyên khoa</td><td style='padding:6px;font-weight:600'>{r.Spec}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>🔢 Mã lịch</td><td style='padding:6px;font-weight:600'>#{apptId}</td></tr>
          </table>
          <hr/>
          <h3 style='color:#00b896'>💳 Thanh toán qua VietQR</h3>
          <p>MB Bank · <b>{_bankAcc}</b> · {_bankOwner}</p>
          <p>Phí khám ({r.Spec}): <b style='color:#e53935'>{r.Amount:N0}đ</b></p>
          <p style='font-size:12px;color:#6b7280'>* Tiền thuốc (nếu có) sẽ được tính sau khi bác sĩ khám và lập đơn.</p>
          <p>Nội dung CK: <b style='color:#e53935'>{payCode}</b></p>
          <img src='{qrUrl}' style='width:200px;border-radius:10px;margin-top:8px'/>
        </div>";

        private string BuildDoctorBookingEmail(EmailRequest r, int apptId, string confirmUrl, string rejectUrl) => $@"
        <div style='font-family:Arial;padding:24px;border:1px solid #ddd;border-radius:12px;max-width:560px'>
          <h2 style='color:#1057a4'>🔔 MedCare — Lịch hẹn mới #{apptId}</h2>
          <table style='width:100%;border-collapse:collapse;margin:16px 0'>
            <tr><td style='padding:6px;color:#6b7280'>👤 Bệnh nhân</td><td style='padding:6px;font-weight:600'>{r.PatientName}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>📞 SĐT</td><td style='padding:6px;font-weight:600'>{r.Phone}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>🩺 Triệu chứng</td><td style='padding:6px;font-weight:600'>{r.Symptom}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>📅 Ngày hẹn</td><td style='padding:6px;font-weight:600'>{r.Date}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>⏰ Giờ hẹn</td><td style='padding:6px;font-weight:600'>{r.Time}</td></tr>
            <tr><td style='padding:6px;color:#6b7280'>🏥 Chuyên khoa</td><td style='padding:6px;font-weight:600'>{r.Spec}</td></tr>
          </table>
          <div style='text-align:center;padding:20px'>
            <a href='{confirmUrl}' style='background:#00b896;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;margin-right:12px'>✅ CHẤP NHẬN</a>
            <a href='{rejectUrl}' style='background:#e53935;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold'>❌ TỪ CHỐI</a>
          </div>
          <p style='text-align:center;font-size:12px;color:#9badbf'>Link hết hạn sau 24 giờ · Mã lịch #{apptId}</p>
        </div>";

        // ════════════════════════════════════════
        // GET /api/news  —  Proxy RSS VnExpress Sức khỏe
        // ════════════════════════════════════════
        [HttpGet("news")]
        [AllowAnonymous]
        public async Task<IActionResult> GetNews([FromQuery] int count = 3)
    {
        const string RSS_URL = "https://vnexpress.net/rss/suc-khoe.rss";
        try
        {
            // Cache 10 phút — RSS ít đổi, tránh gọi VnExpress mỗi request.
            var items = await _cache.GetOrCreateAsync($"news_{count}", async entry =>
            {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            using var http   = new HttpClient();
            http.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0");
            http.Timeout = TimeSpan.FromSeconds(8);

            var xml  = await http.GetStringAsync(RSS_URL);
            var doc  = System.Xml.Linq.XDocument.Parse(xml);
            var ns   = System.Xml.Linq.XNamespace.None;
            var media = System.Xml.Linq.XNamespace.Get("http://search.yahoo.com/mrss/");

            return doc.Descendants("item")
                .Take(count)
                .Select(item =>
                {
                    var thumb = item.Element(media + "thumbnail")?.Attribute("url")?.Value
                             ?? item.Descendants(media + "content").FirstOrDefault()?.Attribute("url")?.Value
                             ?? "";
                    // Thử lấy ảnh từ description nếu không có media
                    if (string.IsNullOrEmpty(thumb))
                    {
                        var desc = item.Element("description")?.Value ?? "";
                        var m    = System.Text.RegularExpressions.Regex.Match(desc, @"<img[^>]+src=""([^""]+)""");
                        if (m.Success) thumb = m.Groups[1].Value;
                    }
                    var descText = System.Text.RegularExpressions.Regex.Replace(
                        item.Element("description")?.Value ?? "", "<[^>]+>", "").Trim();
                    return new
                    {
                        title       = item.Element("title")?.Value ?? "",
                        link        = item.Element("link")?.Value ?? "",
                        description = descText.Length > 200 ? descText[..200] : descText,
                        pubDate     = item.Element("pubDate")?.Value ?? "",
                        thumbnail   = thumb,
                    };
                })
                .ToList();
            });

            return Ok(new { success = true, items });
        }
        catch (Exception ex)
        {
            return Ok(new { success = false, error = ex.Message, items = new List<object>() });
        }
    }
        // ════════════════════════════════════════
        // GET /api/ai-brief/{patientId}
        // Tóm tắt hồ sơ bệnh nhân cho bác sĩ trước khi khám
        // ════════════════════════════════════════
        [HttpGet("ai-brief/{patientId:int}")]
        [Authorize(Roles = "Doctor,Admin")]
        public async Task<IActionResult> GetAiBrief(int patientId)
        {
            if (string.IsNullOrWhiteSpace(_config["AnthropicApiKey"]))
                return Ok(new { success = false, brief = "", warning = "Chưa cấu hình AnthropicApiKey." });

            var patient = await _context.Patients.FindAsync(patientId);
            if (patient == null)
                return NotFound(new { success = false, brief = "" });

            int? ageVal = patient.DateOfBirth.HasValue
                ? (int)((DateTime.Now - patient.DateOfBirth.Value).TotalDays / 365)
                : (int?)null;
            // Chưa có ngày sinh → KHÔNG ghi "0 tuổi" (gây hiểu nhầm); ghi rõ là chưa có.
            string ageText = ageVal.HasValue ? $"{ageVal} tuổi" : "chưa rõ tuổi (hồ sơ chưa có ngày sinh)";

            var records = await _context.MedicalRecords
                .Where(r => r.PatientId == patientId)
                .Include(r => r.Doctor)
                .OrderByDescending(r => r.ExaminationDate)
                .Take(5)
                .ToListAsync();

            var appts = await _context.Appointments
                .Where(a => a.PatientId == patientId && a.Status == "Đã khám & Xuất HĐ")
                .Include(a => a.Doctor)
                .OrderByDescending(a => a.AppointmentDate)
                .Take(5)
                .ToListAsync();

            var sb = new StringBuilder();
            sb.AppendLine($"Bệnh nhân: {patient.FullName}, {ageText}, {patient.Gender ?? "không rõ giới tính"}.");
            if (records.Any())
            {
                sb.AppendLine("Hồ sơ bệnh án gần đây:");
                foreach (var r in records)
                    sb.AppendLine($"  - [{r.ExaminationDate:dd/MM/yyyy}] {r.Diagnosis} | Thuốc: {r.Prescription} | BS: {r.Doctor?.FullName}");
            }
            else if (appts.Any())
            {
                sb.AppendLine("Lịch sử khám:");
                foreach (var a in appts)
                    sb.AppendLine($"  - [{a.AppointmentDate:dd/MM/yyyy}] Triệu chứng: {a.Symptoms} | Chẩn đoán: {a.Diagnosis ?? "chưa có"} | BS: {a.Doctor?.FullName}");
            }
            else
            {
                sb.AppendLine("Bệnh nhân chưa có lịch sử khám tại phòng khám.");
            }

            var prompt = $@"{sb}

Dựa vào thông tin trên, hãy viết một đoạn tóm tắt ngắn gọn (3-5 câu) dành cho bác sĩ đọc TRƯỚC KHI khám. Bao gồm:
1. Tình trạng bệnh nền / bệnh mãn tính nếu có
2. Thuốc đang dùng quan trọng cần lưu ý
3. Cảnh báo hoặc điểm đặc biệt bác sĩ nên chú ý
4. Thời gian kể từ lần khám cuối

Viết bằng tiếng Việt, súc tích, chuyên nghiệp, KHÔNG dùng bullet points, chỉ 3-5 câu liền mạch.
LƯU Ý: Nếu thiếu thông tin (tuổi, giới tính, tiền sử), hãy ghi rõ là ""chưa có/chưa rõ"" và đề nghị bác sĩ thu thập — TUYỆT ĐỐI không suy đoán hay bịa số liệu (ví dụ không ghi ""0 tuổi"").";

            try
            {
                var payload = new
                {
                    model      = "claude-haiku-4-5-20251001",
                    max_tokens = 300,
                    messages   = new[] { new { role = "user", content = prompt } }
                };
                var res     = await _http.PostAsJsonAsync(ANTHROPIC_URL, payload);
                var rawBody = await res.Content.ReadAsStringAsync();
                if (!res.IsSuccessStatusCode) return Ok(new { success = false, brief = "", warning = rawBody });

                var json  = JsonSerializer.Deserialize<JsonElement>(rawBody);
                var brief = json.GetProperty("content")[0].GetProperty("text").GetString() ?? "";
                return Ok(new { success = true, brief, patientName = patient.FullName, age = ageVal, gender = patient.Gender });
            }
            catch (Exception ex)
            {
                return Ok(new { success = false, brief = "", warning = ex.Message });
            }
        }

        // ════════════════════════════════════════
        // POST /api/pricing/estimate
        // Tính hóa đơn chi tiết: phí khám theo chuyên khoa + tiền thuốc theo đơn
        // ════════════════════════════════════════
        [HttpPost("pricing/estimate")]
        [Authorize(Roles = "Doctor,Admin")]
        public IActionResult EstimatePricing([FromBody] PricingRequest req)
        {
            var drugs = (req.Drugs ?? new())
                .Select(d => new PricingService.DrugLine { Name = d.Name ?? "", Days = d.Days })
                .ToList();

            var inv = PricingService.Estimate(req.Specialty, drugs);

            return Ok(new
            {
                success    = true,
                examFee    = inv.ExamFee,
                drugTotal  = inv.DrugTotal,
                grandTotal = inv.GrandTotal,
                drugs = inv.Drugs.Select(d => new {
                    name = d.Name, days = d.Days,
                    unitPrice = d.UnitPrice, quantity = d.Quantity, lineTotal = d.LineTotal
                })
            });
        }

        // ════════════════════════════════════════
        // GET /api/stats — số liệu thật cho trang chủ & dashboard
        // ════════════════════════════════════════
        [HttpGet("stats")]
        [AllowAnonymous]
        public IActionResult GetStats()
        {
            var today = DateTime.Now.Date;
            return Ok(new
            {
                totalDoctors      = _context.Doctors.Count(),
                totalPatients     = _context.Accounts.Count(a => a.Role == "Patient"),
                totalAppointments = _context.Appointments.Count(),
                completed         = _context.Appointments.Count(a => a.Status == "Đã khám & Xuất HĐ"),
                pending           = _context.Appointments.Count(a => a.Status == "Chờ xác nhận"),
                today             = _context.Appointments.Count(a => a.AppointmentDate >= today && a.AppointmentDate < today.AddDays(1)),
                medicalRecords    = _context.MedicalRecords.Count(),
            });
        }

        // GET /api/pricing/exam-fees — bảng phí khám theo chuyên khoa
        [HttpGet("pricing/exam-fees")]
        [AllowAnonymous]
        public IActionResult GetExamFees()
        {
            string[] specs = { "TimMach", "TieuHoa", "CoXuongKhop", "ThanKinh", "HoHap", "DaKhoa" };
            return Ok(specs.Select(s => new { specialty = s, fee = PricingService.GetExamFee(s) }));
        }

    } // end ApiController

    // ════════════════════════════════════════
    // REQUEST MODELS
    // ════════════════════════════════════════
    public class LoginRequest
    {
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public string Role     { get; set; } = "Patient";
    }

    public class RegisterRequest
    {
        public string  FullName { get; set; } = "";
        public string  Username { get; set; } = "";
        public string  Password { get; set; } = "";
        public string? Email    { get; set; }
        public string? Phone       { get; set; }
        public string? Gender      { get; set; }
        public string? DateOfBirth { get; set; }  // "yyyy-MM-dd" từ form đăng ký
    }

    public class ForgotRequest
    {
        public string? Username { get; set; }
        public string? Email    { get; set; }
    }

    public class ProfileRequest
    {
        public string  FullName    { get; set; } = "";
        public string? Email       { get; set; }
        public string? Phone       { get; set; }
        public string? Gender      { get; set; }
        public string? DateOfBirth { get; set; }
    }

    public class ChangePasswordRequest
    {
        public string? CurrentPassword { get; set; }
        public string? NewPassword     { get; set; }
    }

    public class PricingRequest
    {
        public string? Specialty { get; set; }
        public List<PricingDrug>? Drugs { get; set; }
    }
    public class PricingDrug
    {
        public string? Name { get; set; }
        public int     Days { get; set; }
    }

    public class EmailRequest
    {
        public string? PatientName  { get; set; }
        public string? PatientEmail { get; set; }
        public string? DoctorEmail  { get; set; }
        public string? Date         { get; set; }
        public string? Time         { get; set; }
        public string? Doctor       { get; set; }
        public string? Spec         { get; set; }
        public long    Amount       { get; set; } = 200000;
        public string? Symptom      { get; set; }
        public string? Phone        { get; set; }
        public string? Mode         { get; set; } = "booking";
    }
}
