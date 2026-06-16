using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using QuanLyPhongKham.Data;
using QuanLyPhongKham.Models;
using System.Security.Claims;

// ════════════════════════════════════════════════════════
// Cài NuGet trước khi build:
//   dotnet add package BCrypt.Net-Next
// ════════════════════════════════════════════════════════

namespace QuanLyPhongKham.Controllers
{
    public class AuthController : Controller
    {
        private readonly ApplicationDbContext _context;

        public AuthController(ApplicationDbContext context)
        {
            _context = context;
        }

        // GET: /Auth/Login
        public IActionResult Login() => View();

        // ════════════════════════════════════════════════
        // POST: /Auth/Login
        // Xác thực đúng: hash password + kiểm tra Role
        // ════════════════════════════════════════════════
        [HttpPost]
        public async Task<IActionResult> Login(string username, string password, string role)
        {
            // Chống brute-force cơ bản — delay nhỏ
            await Task.Delay(300);

            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            {
                ViewBag.Error = "Vui lòng nhập đầy đủ thông tin!";
                return View();
            }

            // Tìm theo username + role (không so sánh password ở DB query)
            var user = _context.Accounts
                .FirstOrDefault(a => a.Username == username && a.Role == role);

            if (user == null)
            {
                ViewBag.Error = "Tài khoản không tồn tại hoặc sai vai trò!";
                return View();
            }

            // Kiểm tra password — hỗ trợ cả plain text cũ lẫn BCrypt mới
            bool passwordOk = VerifyPassword(password, user.Password);

            if (!passwordOk)
            {
                ViewBag.Error = "Mật khẩu không chính xác!";
                return View();
            }

            // Nếu password đang là plain text → tự động upgrade lên BCrypt
            if (!user.Password.StartsWith("$2"))
            {
                user.Password = BCrypt.Net.BCrypt.HashPassword(password);
                _context.SaveChanges();
            }

            // Tạo Claims
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.Name,           user.FullName),
                new Claim(ClaimTypes.Role,           user.Role),
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim("Username",                user.Username),
                new Claim("Email",                   user.Email ?? ""),
            };

            var claimsIdentity = new ClaimsIdentity(
                claims, CookieAuthenticationDefaults.AuthenticationScheme);

            var authProperties = new AuthenticationProperties
            {
                IsPersistent = true,                        // Nhớ đăng nhập
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8)
            };

            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(claimsIdentity),
                authProperties);

            // Điều hướng theo Role
            return user.Role switch
            {
                "Admin"   => RedirectToAction("AdminDashboard", "Home"),
                "Doctor"  => RedirectToAction("Index", "Home"),
                "Patient" => RedirectToAction("Index", "Home"),
                _         => RedirectToAction("Index", "Home"),
            };
        }

        // ════════════════════════════════════════════════
        // POST: /Auth/Register
        // Đăng ký với BCrypt hash ngay từ đầu
        // ════════════════════════════════════════════════
        [HttpPost]
        public IActionResult Register(Account model)
        {
            if (string.IsNullOrWhiteSpace(model.Username) ||
                string.IsNullOrWhiteSpace(model.Password) ||
                string.IsNullOrWhiteSpace(model.FullName))
            {
                ViewBag.Error = "Vui lòng nhập đầy đủ thông tin!";
                return View("Login");
            }

            if (_context.Accounts.Any(a => a.Username == model.Username))
            {
                ViewBag.RegisterError = "Tên đăng nhập đã tồn tại!";
                return View("Login");
            }

            // Chỉ cho phép đăng ký role Patient từ form public
            // Admin và Doctor chỉ tạo được qua trang Admin
            model.Role     = "Patient";
            model.Password = BCrypt.Net.BCrypt.HashPassword(model.Password);
            model.Email    = model.Email ?? "";

            _context.Accounts.Add(model);
            _context.SaveChanges();

            TempData["RegisterSuccess"] = "Đăng ký thành công! Vui lòng đăng nhập.";
            return RedirectToAction("Login");
        }

        // ════════════════════════════════════════════════
        // GET: /Auth/Logout
        // ════════════════════════════════════════════════
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(
                CookieAuthenticationDefaults.AuthenticationScheme);
            return Redirect("/"); // về trang chủ MedCare sau khi đăng xuất
        }

        // ════════════════════════════════════════════════
        // HELPER — Verify password (hỗ trợ cả 2 format)
        // ════════════════════════════════════════════════
        private static bool VerifyPassword(string inputPassword, string storedPassword)
        {
            // BCrypt hash bắt đầu bằng $2a$ hoặc $2b$
            if (storedPassword.StartsWith("$2"))
            {
                return BCrypt.Net.BCrypt.Verify(inputPassword, storedPassword);
            }

            // Plain text cũ — so sánh trực tiếp (sẽ tự upgrade sau login)
            return inputPassword == storedPassword;
        }
    }
}
