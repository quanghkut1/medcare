using QuanLyPhongKham.Helpers;

namespace QuanLyPhongKham.Tests;

// ════════════════════════════════════════════════════════════
//  Unit tests cho bảng giá khám & thuốc
// ════════════════════════════════════════════════════════════
public class PricingServiceTests
{
    // ───────── Phí khám theo chuyên khoa ─────────
    [Theory]
    [InlineData("TimMach", 300_000)]
    [InlineData("DaKhoa", 150_000)]
    [InlineData("TieuHoa", 250_000)]
    public void GetExamFee_ChuyenKhoa_TraVe_DungGia(string spec, long expected)
    {
        Assert.Equal(expected, PricingService.GetExamFee(spec));
    }

    [Theory]
    [InlineData("KhongCo")]
    [InlineData(null)]
    public void GetExamFee_KhongBiet_TraVe_GiaMacDinh(string? spec)
    {
        Assert.Equal(150_000, PricingService.GetExamFee(spec));
    }

    // ───────── Giá thuốc theo tên ─────────
    [Theory]
    [InlineData("Amlodipine 5mg", 800)]
    [InlineData("Omeprazole 20mg", 500)]
    [InlineData("Pregabalin 75mg", 8_000)]
    public void GetDrugUnitPrice_KhopTen_TraVe_DungGia(string name, long expected)
    {
        Assert.Equal(expected, PricingService.GetDrugUnitPrice(name));
    }

    [Fact]
    public void GetDrugUnitPrice_Augmentin_UuTien_TruocAmoxicillin()
    {
        // "Amoxicillin-clavulanate" (6000) phải khớp trước "amoxicillin" (1500)
        Assert.Equal(6_000, PricingService.GetDrugUnitPrice("Amoxicillin-clavulanate 875mg"));
        Assert.Equal(1_500, PricingService.GetDrugUnitPrice("Amoxicillin 500mg"));
    }

    [Fact]
    public void GetDrugUnitPrice_ThuocLa_TraVe_GiaMacDinh()
    {
        Assert.Equal(1_000, PricingService.GetDrugUnitPrice("ThuocKhongCoTrongBang"));
    }

    // ───────── Tính hóa đơn ─────────
    [Fact]
    public void Estimate_TinhDung_SoLuong_VaTongTien()
    {
        var drugs = new List<PricingService.DrugLine>
        {
            new() { Name = "Amlodipine 5mg", Days = 10 },  // 800 × (10×2) = 16.000
        };
        var inv = PricingService.Estimate("TimMach", drugs);

        Assert.Equal(300_000, inv.ExamFee);
        Assert.Single(inv.Drugs);
        Assert.Equal(20, inv.Drugs[0].Quantity);       // 10 ngày × 2 lần
        Assert.Equal(16_000, inv.Drugs[0].LineTotal);  // 800 × 20
        Assert.Equal(16_000, inv.DrugTotal);
        Assert.Equal(316_000, inv.GrandTotal);          // khám + thuốc
    }

    [Fact]
    public void Estimate_BoQua_DongThuoc_Rong()
    {
        var drugs = new List<PricingService.DrugLine>
        {
            new() { Name = "", Days = 5 },
            new() { Name = "Metformin 500mg", Days = 7 },
        };
        var inv = PricingService.Estimate("DaKhoa", drugs);
        Assert.Single(inv.Drugs);   // chỉ tính dòng có tên
    }

    [Fact]
    public void EstimateFromText_TachDon_VaDocSoNgay()
    {
        // 2 thuốc, có "7 ngày" ở thuốc đầu
        var inv = PricingService.EstimateFromText(
            "DaKhoa",
            "Amoxicillin 500mg x 3 lần/ngày x 7 ngày; Bromhexine 8mg");

        Assert.Equal(2, inv.Drugs.Count);
        Assert.Equal(7, inv.Drugs[0].Days);             // đọc được "7 ngày"
        Assert.Equal(7, inv.Drugs[1].Days);             // mặc định 7 ngày
        Assert.True(inv.DrugTotal > 0);
    }
}
