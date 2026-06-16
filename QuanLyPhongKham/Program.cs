using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using QuanLyPhongKham.Data;
using QuanLyPhongKham.Models;
using Serilog;

// PostgreSQL (Npgsql) yêu cầu DateTime UTC. Bật chế độ tương thích để chấp nhận
// DateTime Kind=Unspecified/Local (map sang 'timestamp without time zone') — phải đặt
// TRƯỚC khi mở kết nối Npgsql đầu tiên. Không ảnh hưởng SQLite.
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

// ── Serilog: ghi log ra Console + file (logs/medcare-YYYYMMDD.txt, giữ 14 ngày) ──
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.File("logs/medcare-.txt", rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14)
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog(); // thay logging mặc định bằng Serilog

// ── Railway/Heroku cấp PORT động → bind vào đúng cổng đó (nếu không có thì giữ mặc định 8080) ──
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// ── Database — chọn provider: "Sqlite" (local dev, mặc định) hoặc "Postgres" (Docker/production) ──
var dbProvider       = builder.Configuration["DatabaseProvider"] ?? "Sqlite";
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

// ── Railway/Heroku cấp DATABASE_URL dạng postgres://user:pass@host:port/db → chuyển sang chuỗi Npgsql ──
var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
if (!string.IsNullOrEmpty(databaseUrl))
{
    var uri  = new Uri(databaseUrl);
    var info = uri.UserInfo.Split(':');
    connectionString = $"Host={uri.Host};Port={(uri.Port > 0 ? uri.Port : 5432)};" +
                       $"Database={uri.AbsolutePath.TrimStart('/')};Username={info[0]};Password={info[1]};" +
                       $"SSL Mode=Require;Trust Server Certificate=true";
    dbProvider = "Postgres";
}
builder.Services.AddDbContext<ApplicationDbContext>(options =>
{
    if (dbProvider.Equals("Postgres", StringComparison.OrdinalIgnoreCase))
        options.UseNpgsql(connectionString);
    else
        options.UseSqlite(connectionString);
});

// ── Data Protection: lưu khóa mã hóa cookie ra thư mục "keys" (mount volume trong Docker)
// → restart/tạo lại container KHÔNG làm người dùng bị đăng xuất. Local: ./keys
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, "keys")))
    .SetApplicationName("MedCare");

// Cache trong bộ nhớ (news RSS, danh sách bác sĩ) — giảm HTTP/truy vấn lặp lại.
builder.Services.AddMemoryCache();

// ── Auth Cookie ──
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath        = "/Auth/Login";
        options.AccessDeniedPath = "/Auth/Login";
        options.Cookie.Name         = "PhongKhamCookie";
        options.ExpireTimeSpan      = TimeSpan.FromHours(8);
        options.Cookie.SameSite     = SameSiteMode.Lax;
        options.Cookie.HttpOnly     = true;   // JS không đọc được cookie → chống XSS đánh cắp session
        // SameAsRequest: tự gắn cờ Secure khi chạy HTTPS (production),
        // vẫn hoạt động qua HTTP khi dev → an toàn mà không vỡ môi trường dev.
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        // Quan trọng: API trả 401 thay vì redirect khi chưa đăng nhập
        options.Events.OnRedirectToLogin = ctx =>
        {
            if (ctx.Request.Path.StartsWithSegments("/api"))
            {
                ctx.Response.StatusCode = 401;
                return Task.CompletedTask;
            }
            ctx.Response.Redirect(ctx.RedirectUri);
            return Task.CompletedTask;
        };
    });

// ── CORS — cho phép HTML file gọi API ──
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
        policy
            .WithOrigins(
                "http://localhost:3000",       // Node.js (nếu serve HTML từ đây)
                "http://localhost:5500",       // Live Server VS Code
                "http://127.0.0.1:5500",
                "null"                         // file:// (mở thẳng file HTML)
            )
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());              // Cần cho Cookie auth
});

// ── HttpClient cho Anthropic (ChatController) ──
builder.Services.AddHttpClient("anthropic", client =>
{
    client.BaseAddress = new Uri("https://api.anthropic.com");
    client.Timeout = TimeSpan.FromSeconds(30);
});

// ── Rate Limiting — chống spam/brute-force ──
builder.Services.AddRateLimiter(options =>
{
    // Khi vượt giới hạn → trả 429 kèm thông báo JSON
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (ctx, token) =>
    {
        ctx.HttpContext.Response.ContentType = "application/json; charset=utf-8";
        await ctx.HttpContext.Response.WriteAsync(
            "{\"success\":false,\"error\":\"Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.\"}",
            token);
    };

    // Hàm tiện ích: tạo policy fixed-window theo địa chỉ IP
    static System.Threading.RateLimiting.RateLimitPartition<string> ByIp(
        HttpContext http, int permit, int seconds)
    {
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ip,
            factory: _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = permit,
                Window      = TimeSpan.FromSeconds(seconds),
                QueueLimit  = 0
            });
    }

    // Đăng nhập/đăng ký: tối đa 5 lần / 1 phút / IP (chống brute-force)
    options.AddPolicy("auth", http => ByIp(http, 5, 60));
    // AI (chat + OCR): tối đa 15 lần / 1 phút / IP (chống lạm dụng API tốn phí)
    options.AddPolicy("ai", http => ByIp(http, 15, 60));
});

// ── Controllers ──
builder.Services.AddControllersWithViews();

var app = builder.Build();

app.UseSerilogRequestLogging(); // ghi log mỗi HTTP request (method, path, status, thời gian)

// ── Seed dữ liệu ban đầu ──
using (var scope = app.Services.CreateScope())
{
    var db  = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    // SQLite: dùng Migrations (đã có sẵn). Postgres: tạo schema từ model (EnsureCreated)
    // vì migrations là đặc thù theo provider.
    if (dbProvider.Equals("Postgres", StringComparison.OrdinalIgnoreCase))
        db.Database.EnsureCreated();
    else
        db.Database.Migrate();
    var rng = new Random(42);

    // ── 1. Admin ──
    if (!db.Accounts.Any(a => a.Role == "Admin"))
    {
        db.Accounts.Add(new Account
        {
            Username = "admin",
            Password = BCrypt.Net.BCrypt.HashPassword("Admin@123"),
            FullName = "Quản trị viên",
            Role     = "Admin",
            Email    = "admin@medcare.vn"
        });
        db.SaveChanges();
        Console.WriteLine("✅ Admin:  admin / Admin@123");
    }

    // ── 2. Doctors (tài khoản + hồ sơ bác sĩ) ──
    var doctorSeeds = new[]
    {
        ("bsnguyenvana",  "Nguyễn Văn An",    "TimMach",      "0901111001", "bsnguyenvana@medcare.vn"),
        ("bstranthib",    "Trần Thị Bình",     "TieuHoa",      "0901111002", "bstranthib@medcare.vn"),
        ("bslevanc",      "Lê Văn Cường",      "CoXuongKhop",  "0901111003", "bslevanc@medcare.vn"),
        ("bsphamthid",    "Phạm Thị Dung",     "ThanKinh",     "0901111004", "bsphamthid@medcare.vn"),
        ("bshoange",      "Hoàng Văn Em",      "HoHap",        "0901111005", "bshoange@medcare.vn"),
    };

    foreach (var (uname, fname, spec, phone, email) in doctorSeeds)
    {
        if (!db.Accounts.Any(a => a.Username == uname))
        {
            db.Accounts.Add(new Account { Username=uname, Password=BCrypt.Net.BCrypt.HashPassword("Doctor@123"), FullName=fname, Role="Doctor", Email=email });
            if (!db.Doctors.Any(d => d.FullName == fname))
                db.Doctors.Add(new Doctor { FullName=fname, Specialty=spec, PhoneNumber=phone });
            Console.WriteLine($"✅ Doctor: {uname} / Doctor@123  ({spec})");
        }
    }
    db.SaveChanges();

    // ── 3. 100 Bệnh nhân ──
    if (db.Accounts.Count(a => a.Role == "Patient") < 10)
    {
        string[] hoList  = { "Nguyễn","Trần","Lê","Phạm","Hoàng","Huỳnh","Phan","Vũ","Võ","Đặng","Bùi","Đỗ","Hồ","Ngô","Dương","Lý" };
        string[] demList = { "Văn","Thị","Hữu","Minh","Quốc","Thanh","Xuân","Đức","Bảo","Kim","Thu","Lan","Mai","Hoa","Hùng","Dũng" };
        string[] tenList = { "An","Bình","Cường","Dung","Em","Phong","Giang","Hải","Lan","Minh","Nam","Oanh","Phúc","Quân","Sơn","Tâm","Uy","Vân","Wên","Xuân","Yến","Anh","Bảo","Chi","Danh","Hiếu","Khoa","Long","Ngọc","Phát","Quý","Rạng","Sang","Thành","Uyên","Vinh" };
        string[] cities  = { "Hà Nội","TP.HCM","Đà Nẵng","Cần Thơ","Hải Phòng","Biên Hoà","Nha Trang","Huế","Vũng Tàu","Buôn Ma Thuột" };
        string[] streets = { "Nguyễn Huệ","Lê Lợi","Trần Phú","Điện Biên Phủ","Lý Thường Kiệt","Hai Bà Trưng","Nguyễn Trãi","Hoàng Diệu","Phan Đình Phùng","Bà Triệu" };

        var diagList = new[]
        {
            ("Tăng huyết áp giai đoạn I",        "Amlodipine 5mg x 1 viên/ngày; Losartan 50mg x 1 viên/ngày"),
            ("Viêm dạ dày mãn tính",              "Omeprazole 20mg x 2 lần/ngày trước ăn; Domperidone 10mg x 3 lần/ngày"),
            ("Đau lưng cơ học",                   "Ibuprofen 400mg x 3 lần/ngày; Myolastan 50mg x 2 viên/ngày; chườm nóng"),
            ("Viêm phế quản cấp",                 "Amoxicillin 500mg x 3 lần/ngày x 7 ngày; Bromhexine 8mg x 3 lần/ngày"),
            ("Đái tháo đường type 2",             "Metformin 500mg x 2 lần/ngày sau ăn; kiểm soát đường huyết hàng ngày"),
            ("Rối loạn lo âu",                    "Escitalopram 10mg x 1 viên/ngày buổi sáng; tái khám sau 4 tuần"),
            ("Viêm khớp gối",                     "Celecoxib 200mg x 2 lần/ngày; Glucosamine 1500mg x 1 viên/ngày"),
            ("Hội chứng ruột kích thích",         "Mebeverine 135mg x 3 lần/ngày trước ăn; tránh thức ăn cay nóng"),
            ("Suy tim độ II (NYHA)",              "Furosemide 40mg x 1 viên/sáng; Carvedilol 6.25mg x 2 lần/ngày"),
            ("Viêm xoang mãn tính",               "Amoxicillin-clavulanate 875mg x 2 lần/ngày; Fluticasone xịt mũi 2 lần/ngày"),
            ("Thoát vị đĩa đệm L4-L5",           "Pregabalin 75mg x 2 lần/ngày; vật lý trị liệu 3 lần/tuần"),
            ("Thiếu máu thiếu sắt",               "Ferrous sulfate 325mg x 2 lần/ngày; Vitamin C 500mg/ngày"),
            ("Cường giáp",                        "Methimazole 10mg x 2 lần/ngày; tái khám xét nghiệm sau 6 tuần"),
            ("Viêm gan B mãn tính",               "Tenofovir 300mg x 1 viên/ngày; theo dõi men gan 3 tháng/lần"),
            ("Sỏi thận",                          "Tamsulosin 0.4mg x 1 viên/tối; uống nhiều nước >2L/ngày; siêu âm tái kiểm"),
        };

        string[] symptomList =
        {
            "Đau đầu, chóng mặt, khó ngủ",
            "Đau bụng vùng thượng vị, buồn nôn",
            "Đau lưng dưới lan xuống chân phải",
            "Ho khan kéo dài, sốt nhẹ",
            "Khát nước nhiều, tiểu nhiều, mệt mỏi",
            "Lo âu, hồi hộp, mất ngủ",
            "Đau khớp gối hai bên khi đi lại",
            "Đau bụng quặn từng cơn, tiêu chảy xen kẽ táo bón",
            "Khó thở khi gắng sức, phù chân",
            "Nghẹt mũi mãn tính, đau đầu vùng trán",
            "Tê bì chân trái, đau vùng thắt lưng",
            "Mệt mỏi, da xanh, hoa mắt",
            "Hồi hộp, run tay, sụt cân",
            "Vàng da nhẹ, mệt mỏi, chán ăn",
            "Đau hông lưng, tiểu buốt",
        };

        string[] notesList =
        {
            "Bệnh nhân dị ứng Penicillin. Cần theo dõi huyết áp tại nhà.",
            "Khuyến cáo chế độ ăn ít muối, ít mỡ.",
            "Hẹn tái khám sau 2 tuần hoặc khi có triệu chứng nặng hơn.",
            "Bệnh nhân cần giảm cân. BMI hiện tại 28.5.",
            "Kết quả XN: Glucose lúc đói 7.8 mmol/L, HbA1c 7.2%.",
            "Không có tiền sử dị ứng thuốc. Huyết áp đo được 145/90 mmHg.",
            "Siêu âm bụng: Không phát hiện bất thường.",
            "Bệnh nhân hút thuốc lá >10 năm. Tư vấn cai thuốc.",
            "Điện tâm đồ bình thường. Chụp X-quang ngực không phát hiện bất thường.",
            "Xét nghiệm máu: Hb 9.2 g/dL, MCV 68 fL.",
            "",
            "Tái khám định kỳ 1 tháng/lần.",
            "Bệnh nhân có tiền sử cao huyết áp gia đình.",
            "Kết quả nội soi dạ dày: Viêm hang vị, H.pylori dương tính.",
            "Cần theo dõi chức năng gan định kỳ.",
        };

        var doctors    = db.Doctors.ToList();
        var statusPool = new[] { "Đã khám & Xuất HĐ","Đã xác nhận","Chờ xác nhận" };

        for (int i = 1; i <= 100; i++)
        {
            string ho    = hoList[rng.Next(hoList.Length)];
            string dem   = demList[rng.Next(demList.Length)];
            string ten   = tenList[rng.Next(tenList.Length)];
            string fname = $"{ho} {dem} {ten}";
            string uname = $"bn{i:D3}";
            string email = $"benhnhan{i:D3}@gmail.com";
            string phone = $"09{rng.Next(10000000,99999999)}";
            string addr  = $"{rng.Next(1,500)} {streets[rng.Next(streets.Length)]}, {cities[rng.Next(cities.Length)]}";
            int dobYear = 1950 + rng.Next(55), dobMonth = rng.Next(1,13);
            var dob     = new DateTime(dobYear, dobMonth, rng.Next(1, DateTime.DaysInMonth(dobYear, dobMonth) + 1));

            var acc = new Account
            {
                Username = uname,
                Password = BCrypt.Net.BCrypt.HashPassword("Patient@123"),
                FullName = fname,
                Role     = "Patient",
                Email    = email,
            };
            db.Accounts.Add(acc);
            db.SaveChanges(); // để có acc.Id

            var pat = new Patient
            {
                FullName    = fname,
                DateOfBirth = dob,
                Gender      = rng.Next(2) == 0 ? "Nam" : "Nữ",
                Address     = addr,
                PhoneNumber = phone,
                Username    = uname,
            };
            db.Patients.Add(pat);
            db.SaveChanges();

            // 1-3 lịch hẹn mỗi bệnh nhân
            int apptCount = rng.Next(1, 4);
            for (int j = 0; j < apptCount; j++)
            {
                var diagIdx  = rng.Next(diagList.Length);
                var (diag, presc) = diagList[diagIdx];
                var symptom  = symptomList[diagIdx];
                var note     = notesList[rng.Next(notesList.Length)];
                var doctor   = doctors.Count > 0 ? doctors[rng.Next(doctors.Count)] : null;
                var apptDate = DateTime.Now.AddDays(-rng.Next(1, 365));
                var status   = statusPool[rng.Next(statusPool.Length)];

                var appt = new Appointment
                {
                    Symptoms        = symptom,
                    AppointmentDate = apptDate,
                    Status          = status,
                    PatientId       = pat.Id,          // ← dùng Patient.Id, không phải Account.Id
                    DoctorId        = doctor?.Id ?? 1,
                    ApprovalToken   = Guid.NewGuid().ToString(),
                    Diagnosis       = status == "Đã khám & Xuất HĐ" ? diag  : null,
                    Prescription    = status == "Đã khám & Xuất HĐ" ? presc : null,
                };
                db.Appointments.Add(appt);

                // Tạo MedicalRecord cho lịch đã khám
                if (status == "Đã khám & Xuất HĐ" && doctor != null)
                {
                    db.MedicalRecords.Add(new MedicalRecord
                    {
                        PatientId       = pat.Id,      // FK → Patients.Id
                        DoctorId        = doctor.Id,
                        ExaminationDate = apptDate,
                        Diagnosis       = diag,
                        Prescription    = presc,
                        Notes           = note,
                    });
                }
            }
            db.SaveChanges();
        }

        Console.WriteLine("✅ Đã tạo 100 bệnh nhân  (bn001–bn100 / Patient@123)");
        Console.WriteLine("   Kèm lịch hẹn & hồ sơ bệnh án ngẫu nhiên.");
    }

    // ── TOP-UP: 10 bệnh nhân demo + NHIỀU lịch hẹn (cho số liệu nhìn chân thật) ──
    if (!db.Accounts.Any(a => a.Username == "bn101"))
    {
        var topNames = new[]
        {
            "Nguyễn Hoàng Long","Trần Thị Mỹ Linh","Lê Quốc Bảo","Phạm Thu Hà","Vũ Minh Khôi",
            "Đặng Ngọc Ánh","Bùi Văn Thành","Hồ Thị Kim Ngân","Ngô Đức Huy","Dương Thanh Tú"
        };
        var topDiag = new[]
        {
            ("Tăng huyết áp giai đoạn I","Amlodipine 5mg x 1 viên/ngày; Losartan 50mg x 1 viên/ngày","HA 145/90, theo dõi tại nhà"),
            ("Viêm dạ dày mãn tính","Omeprazole 20mg x 2 lần/ngày; Domperidone 10mg x 3 lần/ngày","Nội soi: viêm hang vị, HP(+)"),
            ("Đái tháo đường type 2","Metformin 500mg x 2 lần/ngày sau ăn","HbA1c 7.2%, tư vấn dinh dưỡng"),
            ("Viêm phế quản cấp","Amoxicillin 500mg x 3 lần/ngày x 7 ngày; Bromhexine 8mg","Sốt nhẹ, ho có đờm"),
            ("Viêm khớp gối","Celecoxib 200mg x 2 lần/ngày; Glucosamine 1500mg/ngày","Đau khi vận động, X-quang thoái hoá"),
            ("Rối loạn lo âu","Escitalopram 10mg x 1 viên/sáng","Tái khám sau 4 tuần"),
        };
        var topSymptom = new[]
        {
            "Đau đầu, chóng mặt","Đau bụng thượng vị","Khát nước, tiểu nhiều",
            "Ho kéo dài, sốt nhẹ","Đau khớp gối","Hồi hộp, mất ngủ","Khó thở khi gắng sức"
        };
        var docs2   = db.Doctors.ToList();
        var statusPool2 = new[] { "Đã khám & Xuất HĐ","Đã khám & Xuất HĐ","Đã khám & Xuất HĐ","Đã xác nhận","Chờ xác nhận" };

        for (int i = 0; i < topNames.Length; i++)
        {
            string uname = $"bn{101 + i:D3}";
            var acc = new Account
            {
                Username = uname,
                Password = BCrypt.Net.BCrypt.HashPassword("Patient@123"),
                FullName = topNames[i],
                Role     = "Patient",
                Email    = $"benhnhan{101 + i:D3}@gmail.com",
            };
            db.Accounts.Add(acc);
            db.SaveChanges();

            int dobYear2 = 1955 + rng.Next(50), dobMonth2 = rng.Next(1, 13);
            var pat = new Patient
            {
                FullName    = topNames[i],
                DateOfBirth = new DateTime(dobYear2, dobMonth2, rng.Next(1, DateTime.DaysInMonth(dobYear2, dobMonth2) + 1)),
                Gender      = rng.Next(2) == 0 ? "Nam" : "Nữ",
                Address     = $"{rng.Next(1, 300)} đường {rng.Next(1, 30)}, Quận {rng.Next(1, 12)}, TP.HCM",
                PhoneNumber = $"09{rng.Next(10000000, 99999999)}",
                Username    = uname,
            };
            db.Patients.Add(pat);
            db.SaveChanges();

            // 8–15 lịch hẹn mỗi bệnh nhân
            int apptCount = rng.Next(8, 16);
            for (int j = 0; j < apptCount; j++)
            {
                var (diag, presc, note) = topDiag[rng.Next(topDiag.Length)];
                var doctor   = docs2.Count > 0 ? docs2[rng.Next(docs2.Count)] : null;
                var apptDate = DateTime.Now.AddDays(-rng.Next(1, 540));
                var status   = statusPool2[rng.Next(statusPool2.Length)];
                bool done    = status == "Đã khám & Xuất HĐ";

                db.Appointments.Add(new Appointment
                {
                    Symptoms        = topSymptom[rng.Next(topSymptom.Length)],
                    AppointmentDate = apptDate,
                    Status          = status,
                    PatientId       = pat.Id,
                    DoctorId        = doctor?.Id ?? 1,
                    ApprovalToken   = Guid.NewGuid().ToString(),
                    Diagnosis       = done ? diag  : null,
                    Prescription    = done ? presc : null,
                });

                if (done && doctor != null)
                {
                    db.MedicalRecords.Add(new MedicalRecord
                    {
                        PatientId       = pat.Id,
                        DoctorId        = doctor.Id,
                        ExaminationDate = apptDate,
                        Diagnosis       = diag,
                        Prescription    = presc,
                        Notes           = note,
                    });
                }
            }
            db.SaveChanges();
        }
        Console.WriteLine("✅ Top-up: 10 bệnh nhân demo (bn101–bn110 / Patient@123) + nhiều lịch hẹn.");
    }

    // ── Backfill khóa ngoại: gắn Patient.AccountId từ Username (dữ liệu cũ liên kết mềm) ──
    var patsNoAcc = db.Patients.Where(p => p.AccountId == null && p.Username != null).ToList();
    foreach (var p in patsNoAcc)
    {
        var acc = db.Accounts.FirstOrDefault(a => a.Username == p.Username);
        if (acc != null) p.AccountId = acc.Id;
    }
    if (patsNoAcc.Count > 0)
    {
        db.SaveChanges();
        Console.WriteLine($"✅ Backfill AccountId cho {patsNoAcc.Count} bệnh nhân.");
    }
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
    app.UseHttpsRedirection();
}

// ── Security Headers (chống clickjacking, MIME-sniffing, rò rỉ referrer) ──
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"]        = "SAMEORIGIN";
    headers["Referrer-Policy"]        = "strict-origin-when-cross-origin";
    headers["Permissions-Policy"]     = "camera=(), microphone=(), geolocation=()";
    // CSP cân bằng: chặn nguồn lạ nhưng vẫn cho phép CDN/Spline/Fonts đang dùng.
    // ('unsafe-inline'/'unsafe-eval' do trang có inline script + onclick + WebGL.
    //  Có thể siết chặt hơn sau bằng nonce.)
    headers["Content-Security-Policy"] =
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com blob:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com data:; " +
        "img-src 'self' data: blob: https:; " +        // blob: cần cho Spline (texture/ảnh WebGL)
        "media-src 'self' blob: data:; " +
        "connect-src 'self' blob: https:; " +
        "worker-src 'self' blob:; " +
        "frame-src 'self' https://www.google.com https://maps.google.com; " + // nhúng bản đồ
        "frame-ancestors 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'";
    await next();
});

app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();               // ← giới hạn tốc độ (sau Routing)
app.UseCors("AllowFrontend");       // ← CORS trước Auth
app.UseAuthentication();
app.UseAuthorization();

// ── Health check: kiểm tra app + kết nối DB (cho monitoring / load balancer / Docker) ──
app.MapGet("/health", async (ApplicationDbContext db) =>
{
    bool dbOk = await db.Database.CanConnectAsync();
    return dbOk
        ? Results.Ok(new { status = "healthy", db = "up", time = DateTime.UtcNow })
        : Results.Json(new { status = "unhealthy", db = "down" }, statusCode: 503);
});

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();

// Cho phép dự án test (WebApplicationFactory<Program>) truy cập lớp Program
// được sinh từ top-level statements.
public partial class Program { }
