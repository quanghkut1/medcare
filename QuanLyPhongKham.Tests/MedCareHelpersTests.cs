using QuanLyPhongKham.Helpers;
using static QuanLyPhongKham.Helpers.MedCareHelpers;

namespace QuanLyPhongKham.Tests;

// ════════════════════════════════════════════════════════════
//  Unit tests cho logic nghiệp vụ thuần của MedCare
//  Chạy: dotnet test
// ════════════════════════════════════════════════════════════
public class MedCareHelpersTests
{
    // ───────── 1. Kịch bản tư vấn chatbot ─────────
    [Fact]
    public void GetChatScenario_ChuaKham_TraVe_NewPatient()
    {
        Assert.Equal(ChatScenario.NewPatient, GetChatScenario(-1, false));
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(3, true)]
    [InlineData(6, true)]
    public void GetChatScenario_DuoiBayNgay_CoDonThuoc_TraVe_OnMedication(int days, bool hasPrescription)
    {
        Assert.Equal(ChatScenario.OnMedication, GetChatScenario(days, hasPrescription));
    }

    [Fact]
    public void GetChatScenario_DuoiBayNgay_KhongCoDonThuoc_TraVe_FollowUp()
    {
        // < 7 ngày nhưng KHÔNG có đơn thuốc → không phải OnMedication
        Assert.Equal(ChatScenario.FollowUp, GetChatScenario(3, false));
    }

    [Theory]
    [InlineData(7)]
    [InlineData(15)]
    [InlineData(30)]
    public void GetChatScenario_TuBayDenBaMuoiNgay_TraVe_FollowUp(int days)
    {
        Assert.Equal(ChatScenario.FollowUp, GetChatScenario(days, true));
    }

    [Theory]
    [InlineData(31)]
    [InlineData(100)]
    [InlineData(365)]
    public void GetChatScenario_TrenBaMuoiNgay_TraVe_PeriodicCheck(int days)
    {
        Assert.Equal(ChatScenario.PeriodicCheck, GetChatScenario(days, true));
    }

    // ───────── 2. Trích mã lịch hẹn từ nội dung CK ─────────
    [Theory]
    [InlineData("MEDCARE 000123 thanh toan", 123)]
    [InlineData("medcare000045", 45)]
    [InlineData("CK MEDCARE   000999 kham benh", 999)]
    public void ExtractAppointmentId_HopLe_TraVe_DungSo(string desc, int expected)
    {
        Assert.Equal(expected, ExtractAppointmentId(desc));
    }

    [Theory]
    [InlineData("chuyen tien an trua")]
    [InlineData("MEDCARE 123")]      // chỉ 3 chữ số → không khớp (cần 6)
    [InlineData("")]
    [InlineData(null)]
    public void ExtractAppointmentId_KhongHopLe_TraVe_Null(string? desc)
    {
        Assert.Null(ExtractAppointmentId(desc));
    }

    // ───────── 3. So khớp token webhook (constant-time) ─────────
    [Fact]
    public void TokensMatch_GiongNhau_TraVe_True()
    {
        Assert.True(TokensMatch("secret-abc-123", "secret-abc-123"));
    }

    [Theory]
    [InlineData("secret-abc", "secret-xyz")]   // khác nội dung
    [InlineData("short", "longer-token")]       // khác độ dài
    [InlineData("token", "")]                   // một bên rỗng
    public void TokensMatch_KhacNhau_TraVe_False(string a, string b)
    {
        Assert.False(TokensMatch(a, b));
    }

    [Fact]
    public void TokensMatch_CaHaiNull_TraVe_True()
    {
        Assert.True(TokensMatch(null, null));
    }

    // ───────── 4. Escape HTML chống XSS ─────────
    [Fact]
    public void EscapeHtml_ChanScriptTag()
    {
        var payload = "<img src=x onerror=alert(1)>";
        var result = EscapeHtml(payload);
        Assert.DoesNotContain("<img", result);
        Assert.Contains("&lt;img", result);
    }

    [Fact]
    public void EscapeHtml_ThoatDayDu_CacKyTuDacBiet()
    {
        Assert.Equal("&lt;a&gt;&amp;&quot;&#39;", EscapeHtml("<a>&\"'"));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void EscapeHtml_RongHoacNull_TraVe_ChuoiRong(string? input)
    {
        Assert.Equal("", EscapeHtml(input));
    }

    [Fact]
    public void EscapeHtml_VanBanThuong_GiuNguyen()
    {
        Assert.Equal("Đau bụng vùng thượng vị", EscapeHtml("Đau bụng vùng thượng vị"));
    }
}
