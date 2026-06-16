using System.Text;
using System.Text.RegularExpressions;

namespace QuanLyPhongKham.Helpers
{
    /// <summary>
    /// Các hàm logic THUẦN (không phụ thuộc DB/HTTP) — dễ kiểm thử bằng unit test.
    /// Controller gọi lại các hàm này để test bao phủ đúng code thật.
    /// </summary>
    public static class MedCareHelpers
    {
        // ── Phân loại kịch bản tư vấn của chatbot theo số ngày kể từ lần khám ──
        public enum ChatScenario
        {
            NewPatient,        // chưa có lịch sử khám
            OnMedication,      // < 7 ngày & đang có đơn thuốc
            FollowUp,          // 7–30 ngày
            PeriodicCheck      // > 30 ngày
        }

        /// <summary>
        /// Xác định kịch bản tư vấn dựa trên số ngày kể từ lần khám gần nhất.
        /// daysSinceLastVisit &lt; 0 nghĩa là chưa từng khám.
        /// </summary>
        public static ChatScenario GetChatScenario(int daysSinceLastVisit, bool hasPrescription)
        {
            if (daysSinceLastVisit < 0) return ChatScenario.NewPatient;
            if (daysSinceLastVisit < 7 && hasPrescription) return ChatScenario.OnMedication;
            if (daysSinceLastVisit <= 30) return ChatScenario.FollowUp;
            return ChatScenario.PeriodicCheck;
        }

        /// <summary>
        /// Trích mã lịch hẹn 6 chữ số từ nội dung chuyển khoản, ví dụ:
        /// "MEDCARE 000123 thanh toan" → 123. Trả null nếu không khớp.
        /// </summary>
        public static int? ExtractAppointmentId(string? description)
        {
            if (string.IsNullOrWhiteSpace(description)) return null;
            var match = Regex.Match(description.ToUpperInvariant(), @"MEDCARE\s*(\d{6})");
            if (!match.Success) return null;
            return int.TryParse(match.Groups[1].Value, out int id) ? id : (int?)null;
        }

        /// <summary>
        /// So khớp token theo thời gian hằng số (chống timing attack).
        /// </summary>
        public static bool TokensMatch(string? a, string? b)
        {
            var ba = Encoding.UTF8.GetBytes(a ?? "");
            var bb = Encoding.UTF8.GetBytes(b ?? "");
            if (ba.Length != bb.Length) return false;
            return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(ba, bb);
        }

        /// <summary>
        /// Escape HTML chống XSS (dùng phía server nếu cần render dữ liệu người dùng).
        /// </summary>
        public static string EscapeHtml(string? input)
        {
            if (string.IsNullOrEmpty(input)) return "";
            return input
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;")
                .Replace("'", "&#39;");
        }
    }
}
