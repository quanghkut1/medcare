using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace QuanLyPhongKham.Tests;

// Factory dựng app thật trong bộ nhớ, dùng DB SQLite tạm (cách ly khỏi phongkham.db).
public class TestAppFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"medcare_test_{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development"); // tắt HTTPS redirect khi test
        builder.ConfigureAppConfiguration((_, cfg) =>
        {
            cfg.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DatabaseProvider"] = "Sqlite",
                ["ConnectionStrings:DefaultConnection"] = $"Data Source={_dbPath}",
                ["AnthropicApiKey"] = "",                       // tắt AI trong test
                ["EmailSettings:FromEmail"] = "test@local.test", // SMTP sẽ fail nhưng fire-and-forget
                ["EmailSettings:AppPassword"] = "x",
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { if (File.Exists(_dbPath)) File.Delete(_dbPath); } catch { /* ignore */ }
    }
}

public class IntegrationTests : IClassFixture<TestAppFactory>
{
    private readonly TestAppFactory _factory;
    public IntegrationTests(TestAppFactory factory) => _factory = factory;

    [Fact]
    public async Task Health_TraVe_Healthy()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("healthy", json.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Login_AdminDungMatKhau_ThanhCong()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/login",
            new { username = "admin", password = "Admin@123", role = "Admin" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(json.GetProperty("success").GetBoolean());
    }

    [Fact]
    public async Task Login_SaiMatKhau_TraVe_401()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/login",
            new { username = "admin", password = "sai-mat-khau", role = "Admin" });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task DangKy_EmailSai_TraVe_400()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/register", new
        {
            fullName = "Người Dùng Test",
            username = "test_email_invalid",
            password = "matkhau1",   // hợp lệ (có chữ + số)
            email    = "khong-phai-email"
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task DangKy_MatKhauYeu_KhongCoSo_TraVe_400()
    {
        var client = _factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/register", new
        {
            fullName = "Người Dùng Test",
            username = "test_weak_pw",
            password = "matkhauchucai"  // chỉ chữ, không số → phải bị từ chối
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Doctors_TraVe_DanhSach()
    {
        var client = _factory.CreateClient();
        var res = await client.GetAsync("/api/doctors");
        res.EnsureSuccessStatusCode();
        var docs = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(docs.GetArrayLength() > 0); // có bác sĩ seed sẵn
    }

    [Fact]
    public async Task DatLich_TrungGio_TraVe_409()
    {
        // Client giữ cookie để duy trì phiên đăng nhập.
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        // Đăng nhập bằng bệnh nhân seed sẵn.
        var login = await client.PostAsJsonAsync("/api/login",
            new { username = "bn101", password = "Patient@123", role = "Patient" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var booking = new
        {
            patientName  = "Trùng Giờ Test",
            patientEmail = "tg@local.test",
            doctorEmail  = "bs@local.test",
            date         = "2031-01-15",
            time         = "09:00",
            spec         = "TimMach",   // khớp chuyên khoa bác sĩ seed
            symptom      = "Đau ngực",
            phone        = "0900000000"
        };

        // Lần 1: đặt thành công.
        var first = await client.PostAsJsonAsync("/api/send-email", booking);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // Lần 2: cùng bác sĩ + cùng khung giờ → phải bị từ chối 409.
        var second = await client.PostAsJsonAsync("/api/send-email", booking);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }
}
