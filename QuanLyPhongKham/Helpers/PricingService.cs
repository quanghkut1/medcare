using System.Text.RegularExpressions;

namespace QuanLyPhongKham.Helpers
{
    /// <summary>
    /// Bảng giá tham khảo — phí khám theo chuyên khoa & giá thuốc bán lẻ.
    /// Số liệu dựa trên khung giá dịch vụ y tế (TT 21,22/2023/TT-BYT) và
    /// giá thuốc bán lẻ phổ biến tại nhà thuốc Việt Nam (2024).
    /// Logic THUẦN, không phụ thuộc DB → dễ kiểm thử.
    /// </summary>
    public static class PricingService
    {
        // ── Phí khám theo chuyên khoa (đồng/lượt tư vấn) ──
        private static readonly Dictionary<string, long> ExamFees = new(StringComparer.OrdinalIgnoreCase)
        {
            // Mã chuyên khoa
            ["TimMach"]     = 300_000,   // Nội Tim Mạch
            ["TieuHoa"]     = 250_000,   // Nội Tiêu Hóa
            ["CoXuongKhop"] = 250_000,   // Cơ Xương Khớp
            ["CXK"]         = 250_000,
            ["ThanKinh"]    = 300_000,   // Thần Kinh
            ["HoHap"]       = 250_000,   // Hô Hấp
            ["DaKhoa"]      = 150_000,   // Đa Khoa
            // Alias tên hiển thị tiếng Việt (frontend gửi tên này)
            ["Nội Tim Mạch"] = 300_000,
            ["Tim Mạch"]     = 300_000,
            ["Nội Tiêu Hóa"] = 250_000,
            ["Tiêu Hóa"]     = 250_000,
            ["Cơ Xương Khớp"]= 250_000,
            ["Thần Kinh"]    = 300_000,
            ["Hô Hấp"]       = 250_000,
            ["Đa Khoa"]      = 150_000,
        };
        private const long DefaultExamFee = 150_000;

        // ── Giá thuốc (đồng/đơn vị: viên/lọ) — khớp theo TÊN chứa từ khóa ──
        private static readonly Dictionary<string, long> DrugUnitPrices = new(StringComparer.OrdinalIgnoreCase)
        {
            ["amlodipine"]            = 800,
            ["amlodipin"]             = 800,
            ["losartan"]              = 1_500,
            ["omeprazole"]            = 500,
            ["domperidone"]           = 700,
            ["ibuprofen"]             = 1_000,
            ["myolastan"]             = 2_000,
            ["amoxicillin-clavulanate"] = 6_000,   // Augmentin (kiểm tra trước amoxicillin)
            ["amoxicillin"]           = 1_500,
            ["bromhexine"]            = 500,
            ["metformin"]             = 700,
            ["escitalopram"]          = 3_000,
            ["celecoxib"]             = 5_000,
            ["glucosamine"]           = 4_000,
            ["mebeverine"]            = 2_500,
            ["furosemide"]            = 300,
            ["carvedilol"]            = 1_500,
            ["fluticasone"]           = 90_000,     // xịt mũi/lọ
            ["pregabalin"]            = 8_000,
            ["ferrous"]               = 1_000,
            ["sulfate"]               = 1_000,
            ["vitamin c"]             = 500,
            ["methimazole"]           = 2_000,
            ["tenofovir"]             = 8_000,
            ["tamsulosin"]            = 5_000,
        };
        private const long DefaultDrugUnitPrice = 1_000; // thuốc không có trong bảng
        private const int  DefaultDosesPerDay   = 2;     // số lần uống/ngày mặc định
        private const int  DefaultDays          = 7;     // liệu trình mặc định nếu thiếu

        public class DrugLine
        {
            public string Name  { get; set; } = "";
            public int    Days  { get; set; }
            public long   UnitPrice { get; set; }
            public int    Quantity  { get; set; }
            public long   LineTotal { get; set; }
        }

        public class Invoice
        {
            public long ExamFee  { get; set; }
            public List<DrugLine> Drugs { get; set; } = new();
            public long DrugTotal { get; set; }
            public long GrandTotal => ExamFee + DrugTotal;
        }

        /// <summary>Phí khám theo chuyên khoa (fallback nếu không có).</summary>
        public static long GetExamFee(string? specialty)
            => specialty != null && ExamFees.TryGetValue(specialty, out var f) ? f : DefaultExamFee;

        /// <summary>Giá 1 đơn vị thuốc theo tên (khớp từ khóa dài nhất trước).</summary>
        public static long GetDrugUnitPrice(string? drugName)
        {
            if (string.IsNullOrWhiteSpace(drugName)) return DefaultDrugUnitPrice;
            var lower = drugName.ToLowerInvariant();
            // ưu tiên từ khóa dài hơn (vd "amoxicillin-clavulanate" trước "amoxicillin")
            foreach (var kv in DrugUnitPrices.OrderByDescending(k => k.Key.Length))
                if (lower.Contains(kv.Key)) return kv.Value;
            return DefaultDrugUnitPrice;
        }

        /// <summary>
        /// Tính hóa đơn từ chuyên khoa + danh sách thuốc (tên, số ngày).
        /// Số lượng = số ngày × số lần uống/ngày (mặc định 2).
        /// </summary>
        public static Invoice Estimate(string? specialty, IEnumerable<DrugLine> drugs)
        {
            var inv = new Invoice { ExamFee = GetExamFee(specialty) };
            foreach (var dItem in drugs)
            {
                if (string.IsNullOrWhiteSpace(dItem.Name)) continue;
                int days = dItem.Days > 0 ? dItem.Days : DefaultDays;
                long unit = GetDrugUnitPrice(dItem.Name);
                int qty   = days * DefaultDosesPerDay;
                long line = unit * qty;
                inv.Drugs.Add(new DrugLine {
                    Name = dItem.Name.Trim(), Days = days,
                    UnitPrice = unit, Quantity = qty, LineTotal = line
                });
                inv.DrugTotal += line;
            }
            return inv;
        }

        /// <summary>
        /// Ước tính từ đơn thuốc dạng VĂN BẢN tự do (chatbot/OCR).
        /// Tách theo ';' hoặc xuống dòng; mỗi dòng tìm tên thuốc + số ngày.
        /// </summary>
        public static Invoice EstimateFromText(string? specialty, string? prescription)
        {
            var lines = new List<DrugLine>();
            if (!string.IsNullOrWhiteSpace(prescription))
            {
                foreach (var raw in prescription.Split(new[] { ';', '\n', '\r' },
                                                       StringSplitOptions.RemoveEmptyEntries))
                {
                    var daysMatch = Regex.Match(raw, @"(\d+)\s*ng[àa]y", RegexOptions.IgnoreCase);
                    int days = daysMatch.Success ? int.Parse(daysMatch.Groups[1].Value) : DefaultDays;
                    lines.Add(new DrugLine { Name = raw.Trim(), Days = days });
                }
            }
            return Estimate(specialty, lines);
        }
    }
}
