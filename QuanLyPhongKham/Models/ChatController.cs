using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuanLyPhongKham.Data;
using QuanLyPhongKham.Models;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

// ════════════════════════════════════════════════════════════════
//  ChatController.cs — Đặt vào: Controllers/ChatController.cs
//
//  Thêm vào appsettings.json:
//    "AnthropicApiKey": "your-anthropic-api-key"
//
//  Thêm vào Program.cs:
//    builder.Services.AddHttpClient();
// ════════════════════════════════════════════════════════════════

namespace QuanLyPhongKham.Controllers
{
    [Authorize]
    [Route("api/chat")]
    [ApiController]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("ai")]
    public class ChatController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        private readonly IConfiguration       _config;
        private readonly HttpClient            _http;

        private const string ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

        public ChatController(
            ApplicationDbContext context,
            IConfiguration       config,
            IHttpClientFactory   httpFactory)
        {
            _context = context;
            _config  = config;
            _http    = httpFactory.CreateClient();

            var apiKey = _config["AnthropicApiKey"];
            if (!string.IsNullOrWhiteSpace(apiKey))
                _http.DefaultRequestHeaders.Add("x-api-key", apiKey);
            _http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
        }

        // ════════════════════════════════════════
        // GET /api/chat/history
        // ════════════════════════════════════════
        [HttpGet("history")]
        public IActionResult GetHistory()
        {
            int patientId = GetCurrentPatientId(); // accountId — ChatMessages dùng accountId
            if (patientId <= 0) return Ok(new List<object>());

            var msgs = _context.ChatMessages
                .Where(m => m.PatientId == patientId)
                .OrderByDescending(m => m.CreatedAt)
                .Take(20)
                .OrderBy(m => m.CreatedAt)
                .Select(m => new
                {
                    content      = m.Content,
                    isAiResponse = m.IsAiResponse,
                    time         = m.CreatedAt.ToString("HH:mm dd/MM"),
                })
                .ToList();

            return Ok(msgs);
        }

        // ════════════════════════════════════════
        // POST /api/chat/send
        // ════════════════════════════════════════
        [HttpPost("send")]
        [AllowAnonymous]   // Khách chưa đăng nhập vẫn chat được; có đăng nhập thì bám hồ sơ
        public async Task<IActionResult> Send([FromBody] ChatRequest req)
        {
            string userText = req.Message?.Trim() ?? "";
            if (string.IsNullOrEmpty(userText))
                return BadRequest(new { reply = "Tin nhắn không được để trống." });

            var (accountId, patientTableId) = await GetPatientIds();
            bool authed = accountId > 0;   // có đăng nhập?

            // Mặc định (khách): không có dữ liệu bệnh án để bám
            var completedAppts = new List<Appointment>();
            var medRecords     = new List<MedicalRecord>();
            Appointment? pendingAppt = null;
            var recentHistory  = new List<ChatMessage>();
            string patName     = "bạn";

            if (authed)
            {
                // 1. Lưu tin nhắn bệnh nhân (ChatMessages dùng accountId)
                var userMsg = new ChatMessage
                {
                    PatientId    = accountId,
                    Content      = userText,
                    IsAiResponse = false,
                    CreatedAt    = DateTime.Now,
                };
                _context.ChatMessages.Add(userMsg);
                await _context.SaveChangesAsync();

                // 2. Lịch sử khám đã hoàn tất
                completedAppts = await _context.Appointments
                    .Where(a => a.PatientId == patientTableId && a.Status == "Đã khám & Xuất HĐ")
                    .Include(a => a.Doctor)
                    .OrderBy(a => a.AppointmentDate)
                    .ToListAsync();

                // 3. Lịch hẹn sắp tới
                pendingAppt = await _context.Appointments
                    .Where(a => a.PatientId == patientTableId
                             && (a.Status == "Đã xác nhận" || a.Status == "Đã xác nhận (AI)"))
                    .OrderBy(a => a.AppointmentDate)
                    .FirstOrDefaultAsync();

                // 4. Hồ sơ bệnh án
                medRecords = await _context.MedicalRecords
                    .Where(r => r.PatientId == patientTableId)
                    .Include(r => r.Doctor)
                    .OrderBy(r => r.ExaminationDate)
                    .ToListAsync();

                // 5. Tên bệnh nhân
                var account = await _context.Accounts.FindAsync(accountId);
                patName = account?.FullName ?? "bạn";

                // 6. Lịch sử chat — loại trừ tin vừa lưu theo ID
                recentHistory = await _context.ChatMessages
                    .Where(m => m.PatientId == accountId && m.Id != userMsg.Id)
                    .OrderByDescending(m => m.CreatedAt)
                    .Take(10)
                    .OrderBy(m => m.CreatedAt)
                    .ToListAsync();
            }

            string systemPrompt = BuildSystemPrompt(patName, completedAppts, medRecords, pendingAppt);
            string aiReply      = await CallAnthropicAsync(systemPrompt, recentHistory, userText);

            // Lưu câu trả lời AI (chỉ khi đã đăng nhập)
            if (authed)
            {
                _context.ChatMessages.Add(new ChatMessage
                {
                    PatientId    = accountId,
                    Content      = aiReply,
                    IsAiResponse = true,
                    CreatedAt    = DateTime.Now,
                });
                await _context.SaveChangesAsync();
            }

            return Ok(new { reply = aiReply });
        }

        // ════════════════════════════════════════
        // POST /api/chat/proxy
        // Proxy AI MỘT LẦN cho "gợi ý chuyên khoa" & "phân tích triệu chứng".
        // Nhận đúng body Anthropic từ client → chuyển tiếp KÈM API key (giữ ở server)
        // → trả nguyên response để frontend parse như cũ. KEY KHÔNG bao giờ lộ ra client.
        // ════════════════════════════════════════
        [HttpPost("proxy")]
        [AllowAnonymous]
        public async Task<IActionResult> Proxy([FromBody] JsonElement body)
        {
            if (string.IsNullOrWhiteSpace(_config["AnthropicApiKey"]))
                return StatusCode(503, new { error = "Chưa cấu hình AnthropicApiKey." });

            var res = await _http.PostAsJsonAsync(ANTHROPIC_URL, body);
            var raw = await res.Content.ReadAsStringAsync();
            return Content(raw, "application/json");
        }

        // ════════════════════════════════════════
        // DELETE /api/chat/clear
        // ════════════════════════════════════════
        [HttpDelete("clear")]
        public async Task<IActionResult> ClearHistory()
        {
            int patientId = GetCurrentPatientId();
            var msgs = _context.ChatMessages.Where(m => m.PatientId == patientId);
            _context.ChatMessages.RemoveRange(msgs);
            await _context.SaveChangesAsync();
            return Ok(new { success = true });
        }

        // ════════════════════════════════════════
        // HELPER: System prompt
        // ════════════════════════════════════════
        private static string BuildSystemPrompt(
            string              patientName,
            List<Appointment>   completedAppts,
            List<MedicalRecord> medRecords,
            Appointment?        pending)
        {
            var sb = new StringBuilder();

            sb.AppendLine("Bạn là MedBot AI — trợ lý y tế của phòng khám MedCare Việt Nam.");
            sb.AppendLine("Luôn trả lời bằng tiếng Việt, thân thiện, rõ ràng.");
            sb.AppendLine();
            sb.AppendLine("QUY TẮC TƯ VẤN:");
            sb.AppendLine("1. Trước khi trả lời, hãy ĐỐI CHIẾU câu hỏi với lịch sử khám bệnh của bệnh nhân bên dưới.");
            sb.AppendLine("   - Nếu triệu chứng GIỐNG hoặc LIÊN QUAN đến bệnh đã chẩn đoán → suy luận từ hồ sơ đó, nhắc đơn thuốc cũ nếu còn hiệu lực.");
            sb.AppendLine("   - Nếu triệu chứng MỚI hoàn toàn → tư vấn chuyên khoa phù hợp, gợi ý đặt lịch.");
            sb.AppendLine("   - Nếu bệnh nhân có tiền sử bệnh mãn tính (tim mạch, huyết áp, tiểu đường...) → luôn lưu ý khi tư vấn.");
            sb.AppendLine("2. CHỈ đề cập hotline 1900-1234 khi bệnh nhân mô tả đau dữ dội, đột ngột, hoặc triệu chứng cấp cứu.");
            sb.AppendLine("   Với câu hỏi thông thường → KHÔNG nhắc hotline, chỉ gợi ý đặt lịch khám bình thường.");
            sb.AppendLine("3. Không chẩn đoán bệnh mới. Không kê đơn thuốc mới ngoài đơn bác sĩ đã kê.");
            sb.AppendLine("4. Giờ làm việc: T2-T7 7:00-20:00 | CN 8:00-12:00.");
            sb.AppendLine("   Chuyên khoa: Tim Mạch, Tiêu Hóa, Cơ Xương Khớp, Thần Kinh, Hô Hấp, Đa Khoa.");
            sb.AppendLine();
            sb.AppendLine($"Bệnh nhân: {patientName}");
            sb.AppendLine("═════════════════════════════════");

            // --- Lịch sử khám từ bảng Appointments ---
            if (completedAppts.Count > 0)
            {
                sb.AppendLine($"LỊCH SỬ KHÁM BỆNH ({completedAppts.Count} lần):");
                foreach (var appt in completedAppts)
                {
                    string doctorInfo = appt.Doctor != null
                        ? $"BS. {appt.Doctor.FullName} ({appt.Doctor.Specialty})"
                        : "Bác sĩ không xác định";
                    sb.AppendLine($"  [{appt.AppointmentDate:dd/MM/yyyy}] {doctorInfo}");
                    sb.AppendLine($"    Triệu chứng : {appt.Symptoms}");
                    if (!string.IsNullOrEmpty(appt.Diagnosis))
                        sb.AppendLine($"    Chẩn đoán  : {appt.Diagnosis}");
                    if (!string.IsNullOrEmpty(appt.Prescription))
                        sb.AppendLine($"    Đơn thuốc  : {appt.Prescription}");
                }
                sb.AppendLine("─────────────────────────────────");
            }

            // --- Hồ sơ bệnh án chi tiết ---
            if (medRecords.Count > 0)
            {
                sb.AppendLine($"HỒ SƠ BỆNH ÁN CHI TIẾT ({medRecords.Count} hồ sơ):");
                foreach (var rec in medRecords)
                {
                    string doctorInfo = rec.Doctor != null
                        ? $"BS. {rec.Doctor.FullName} ({rec.Doctor.Specialty})"
                        : "Bác sĩ không xác định";
                    sb.AppendLine($"  [{rec.ExaminationDate:dd/MM/yyyy}] {doctorInfo}");
                    sb.AppendLine($"    Chẩn đoán  : {rec.Diagnosis}");
                    sb.AppendLine($"    Đơn thuốc  : {rec.Prescription}");
                    if (!string.IsNullOrEmpty(rec.Notes))
                        sb.AppendLine($"    Ghi chú    : {rec.Notes}");
                }
                sb.AppendLine("─────────────────────────────────");
            }

            if (completedAppts.Count == 0 && medRecords.Count == 0)
            {
                sb.AppendLine("TRẠNG THÁI: Bệnh nhân chưa có lịch sử khám tại MedCare.");
                sb.AppendLine("→ Hỏi thăm triệu chứng, tư vấn chung, gợi ý đặt lịch khám lần đầu.");
                sb.AppendLine("─────────────────────────────────");
            }
            else
            {
                var lastAppt = completedAppts.LastOrDefault();
                var lastRecord = medRecords.LastOrDefault();
                // Ưu tiên hồ sơ bệnh án nếu có (dữ liệu đầy đủ hơn)
                var refDate     = lastRecord?.ExaminationDate ?? lastAppt?.AppointmentDate;
                var refDiag     = lastRecord?.Diagnosis       ?? lastAppt?.Diagnosis;
                var refPrescr   = lastRecord?.Prescription    ?? lastAppt?.Prescription;
                var refNotes    = lastRecord?.Notes;

                if (refDate.HasValue)
                {
                    int days = (DateTime.Now - refDate.Value).Days;
                    sb.AppendLine("HƯỚNG DẪN SUY LUẬN TỪ HỒ SƠ:");
                    sb.AppendLine($"  Lần khám gần nhất: {refDate.Value:dd/MM/yyyy} ({days} ngày trước)");
                    if (!string.IsNullOrEmpty(refDiag))
                        sb.AppendLine($"  Chẩn đoán cuối   : {refDiag}");
                    if (!string.IsNullOrEmpty(refPrescr))
                        sb.AppendLine($"  Đơn thuốc cuối   : {refPrescr}");
                    sb.AppendLine();

                    if (days < 7 && !string.IsNullOrEmpty(refPrescr))
                    {
                        sb.AppendLine("  → Bệnh nhân đang trong liệu trình điều trị.");
                        sb.AppendLine("    * Nếu câu hỏi liên quan đến chẩn đoán cũ: nhắc dùng đúng thuốc đã kê, hỏi xem có cải thiện không.");
                        sb.AppendLine("    * Nếu thuốc chưa đỡ sau đủ ngày điều trị: gợi ý tái khám để bác sĩ điều chỉnh.");
                        sb.AppendLine("    * Nếu triệu chứng hoàn toàn mới: phân biệt rõ và tư vấn riêng.");
                    }
                    else if (days < 30)
                    {
                        sb.AppendLine($"  → Khám lần cuối cách {days} ngày — có thể còn ảnh hưởng từ bệnh cũ.");
                        sb.AppendLine("    * Triệu chứng giống cũ: đối chiếu chẩn đoán trước, gợi ý theo dõi hoặc tái khám.");
                        sb.AppendLine("    * Triệu chứng mới: phân tích xem có liên quan đến bệnh đã điều trị không, rồi tư vấn.");
                    }
                    else
                    {
                        sb.AppendLine($"  → Đã {days} ngày kể từ lần khám cuối — tình trạng có thể đã thay đổi.");
                        sb.AppendLine("    * Nếu có bệnh mãn tính trong hồ sơ: nhắc theo dõi định kỳ.");
                        sb.AppendLine("    * Với triệu chứng mới: tư vấn dựa trên tiền sử, gợi ý đặt lịch khám mới.");
                    }

                    if (!string.IsNullOrEmpty(refNotes))
                        sb.AppendLine($"  → Lưu ý từ bác sĩ lần trước: {refNotes}");

                    sb.AppendLine();
                    sb.AppendLine("  QUY TẮC HOTLINE: Chỉ đề xuất gọi 1900-1234 nếu bệnh nhân dùng từ như");
                    sb.AppendLine("  'đau dữ dội', 'đau không chịu được', 'đột ngột', 'khó thở nặng', 'ngất xỉu'.");
                    sb.AppendLine("  Với các câu hỏi bình thường → KHÔNG nhắc hotline, chỉ gợi ý đặt lịch.");
                    sb.AppendLine("─────────────────────────────────");
                }
            }

            if (pending != null)
            {
                sb.AppendLine($"LỊCH HẸN SẮP TỚI: {pending.AppointmentDate:dd/MM/yyyy HH:mm}");
                sb.AppendLine("→ Nhắc lịch này nếu bệnh nhân hỏi hoặc nếu triệu chứng liên quan đến lần hẹn đó.");
                sb.AppendLine("─────────────────────────────────");
            }

            sb.AppendLine("QUAN TRỌNG: Trả lời NGẮN GỌN, tối đa khoảng 100-120 từ, đi thẳng vào trọng tâm. Không lan man, không nhắc lại toàn bộ hồ sơ trừ khi được hỏi.");
            sb.AppendLine("Cuối mỗi câu trả lời, thêm 2-3 gợi ý ngắn phù hợp với ngữ cảnh trong dấu [GỢI Ý: câu1 | câu2 | câu3]");

            return sb.ToString();
        }

        // ════════════════════════════════════════
        // HELPER: Gọi Claude API
        // ════════════════════════════════════════
        private async Task<string> CallAnthropicAsync(
            string            systemPrompt,
            List<ChatMessage> history,
            string            userText)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_config["AnthropicApiKey"]))
                    return "Chưa cấu hình AnthropicApiKey nên trợ lý AI chưa thể hoạt động.";

                // Xây messages, đảm bảo xen kẽ user/assistant
                var messages  = new List<object>();
                string? lastRole = null;

                foreach (var m in history.Where(m => !string.IsNullOrEmpty(m.Content)))
                {
                    string role = m.IsAiResponse ? "assistant" : "user";
                    if (role == lastRole) continue; // bỏ qua nếu trùng role liên tiếp
                    messages.Add(new { role, content = m.Content });
                    lastRole = role;
                }

                // Đảm bảo tin nhắn cuối cùng trong lịch sử là "assistant" trước khi thêm "user"
                // Nếu lịch sử kết thúc bằng "user" → bỏ tin cuối để tránh trùng role
                if (lastRole == "user" && messages.Count > 0)
                    messages.RemoveAt(messages.Count - 1);

                // Luôn thêm tin nhắn hiện tại của bệnh nhân
                messages.Add(new { role = "user", content = userText });

                var payload = new
                {
                    model      = "claude-sonnet-4-5",
                    // 350 là đủ cho 1 câu tư vấn ngắn gọn + gợi ý.
                    // Thời gian sinh ~ tỉ lệ độ dài output → giảm trần = phản hồi nhanh hơn hẳn.
                    max_tokens = 350,
                    system     = systemPrompt,
                    messages,
                };

                var res     = await _http.PostAsJsonAsync(ANTHROPIC_URL, payload);
                var rawBody = await res.Content.ReadAsStringAsync();
                Console.WriteLine($"[Claude] Status: {res.StatusCode}");

                if (!res.IsSuccessStatusCode)
                {
                    Console.WriteLine($"[Claude] Error body: {rawBody}");
                    return "Xin lỗi, hệ thống AI đang bận. Vui lòng thử lại sau hoặc gọi 1900-1234!";
                }

                var json = JsonSerializer.Deserialize<JsonElement>(rawBody);
                return json
                    .GetProperty("content")[0]
                    .GetProperty("text")
                    .GetString()
                    ?? "Xin lỗi, tôi chưa hiểu. Bạn có thể nói rõ hơn không?";
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Claude] Exception: {ex.Message}");
                return "Xin lỗi, hệ thống AI đang bận. Vui lòng thử lại sau hoặc gọi 1900-1234!";
            }
        }

        // ════════════════════════════════════════
        // HELPER: Lấy PatientId
        // ════════════════════════════════════════
        private int GetCurrentPatientId()
        {
            var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return int.TryParse(idClaim, out int id) ? id : 0;
        }

        // Trả (accountId, patientTableId)
        // accountId  → dùng cho ChatMessages
        // patientTableId → dùng cho Appointments & MedicalRecords (FK → Patients)
        private async Task<(int accountId, int patientTableId)> GetPatientIds()
        {
            int accountId = GetCurrentPatientId();
            var username  = User.FindFirst("Username")?.Value ?? "";
            var pat = await _context.Patients.FirstOrDefaultAsync(p => p.Username == username);
            return (accountId, pat?.Id ?? accountId);
        }
    }

    public class ChatRequest
    {
        public string? Message { get; set; }
    }
}
