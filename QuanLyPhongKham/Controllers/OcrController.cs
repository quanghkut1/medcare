using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuanLyPhongKham.Data;
using QuanLyPhongKham.Models;
using System.Security.Claims;
using System.Text.Json;

namespace QuanLyPhongKham.Controllers
{
    [Authorize]
    [Route("api/ocr")]
    [ApiController]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("ai")]
    public class OcrController : ControllerBase
    {
        private readonly IConfiguration      _config;
        private readonly HttpClient          _http;
        private readonly ApplicationDbContext _context;
        private const string ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

        public OcrController(IConfiguration config, IHttpClientFactory httpFactory, ApplicationDbContext context)
        {
            _config  = config;
            _context = context;
            _http    = httpFactory.CreateClient();
            var apiKey = _config["AnthropicApiKey"];
            if (!string.IsNullOrWhiteSpace(apiKey))
                _http.DefaultRequestHeaders.Add("x-api-key", apiKey);
            _http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
        }

        [HttpPost("scan")]
        public async Task<IActionResult> Scan(IFormFile file, [FromForm] string type = "other")
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, message = "Vui lòng chọn file ảnh." });

            if (file.Length > 5 * 1024 * 1024)
                return BadRequest(new { success = false, message = "File không được vượt quá 5MB." });

            var allowed = new[] { "image/jpeg", "image/png", "image/gif", "image/webp" };
            if (!allowed.Contains(file.ContentType.ToLower()))
                return BadRequest(new { success = false, message = "Chỉ hỗ trợ JPG, PNG, GIF, WEBP." });

            byte[] bytes;
            using (var ms = new MemoryStream())
            {
                await file.CopyToAsync(ms);
                bytes = ms.ToArray();
            }

            string base64    = Convert.ToBase64String(bytes);
            string mediaType = file.ContentType.ToLower();
            string prompt    = BuildPrompt(type);

            var (ok, text, err) = await CallClaudeVisionAsync(base64, mediaType, prompt);
            if (!ok) return StatusCode(500, new { success = false, message = err });

            return Ok(new { success = true, type, fileName = file.FileName, content = text });
        }

        private static string BuildPrompt(string type) => type switch
        {
            "prescription" => @"Đây là ĐƠN THUỐC. Trích xuất và trình bày:

**THÔNG TIN BỆNH NHÂN**
- Họ tên: ...  |  Ngày sinh: ...  |  Chẩn đoán: ...

**DANH SÁCH THUỐC**
| STT | Tên thuốc | Hàm lượng | Số lượng | Cách dùng |
|-----|-----------|-----------|----------|-----------|

**GHI CHÚ:** ...
**Bác sĩ kê đơn:** ...  |  **Ngày:** ...

Ghi 'Không rõ' nếu không đọc được.",

            "record" => @"Đây là HỒ SƠ BỆNH ÁN. Trích xuất và trình bày:

**THÔNG TIN BỆNH NHÂN**
- Họ tên: ...  |  Ngày sinh: ...  |  Giới tính: ...  |  BHYT: ...

**THÔNG TIN KHÁM**
- Ngày khám: ...  |  Lý do: ...  |  Triệu chứng: ...

**KẾT QUẢ:** Chẩn đoán: ...
**ĐIỀU TRỊ:** ...
**Bác sĩ:** ...  |  Chuyên khoa: ...

Ghi 'Không rõ' nếu không đọc được.",

            "lab" => @"Đây là KẾT QUẢ XÉT NGHIỆM. Trích xuất và trình bày:

**THÔNG TIN:** Bệnh nhân: ...  |  Ngày XN: ...

**KẾT QUẢ**
| Chỉ số | Kết quả | Đơn vị | Bình thường | Đánh giá |
|--------|---------|--------|-------------|----------|

**KẾT LUẬN:** ...

Ghi 'Không rõ' nếu không đọc được.",

            _ => @"Đây là TÀI LIỆU Y TẾ. Hãy:
1. Xác định loại tài liệu
2. Trích xuất toàn bộ nội dung quan trọng theo từng mục **IN ĐẬM**
3. Nêu các điểm cần bác sĩ chú ý (nếu có)
Trả lời bằng tiếng Việt, rõ ràng, dễ đọc."
        };

        // ════════════════════════════════════════════════════════════════
        // POST /api/ocr/import-record
        // Quét ảnh hồ sơ → trả về JSON có cấu trúc để bác sĩ xác nhận
        // ════════════════════════════════════════════════════════════════
        [HttpPost("import-record")]
        [Authorize(Roles = "Doctor,Admin")]
        public async Task<IActionResult> ImportRecord(IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, message = "Vui lòng chọn file ảnh." });
            if (file.Length > 5 * 1024 * 1024)
                return BadRequest(new { success = false, message = "File không được vượt quá 5MB." });
            var allowed = new[] { "image/jpeg", "image/png", "image/gif", "image/webp" };
            if (!allowed.Contains(file.ContentType.ToLower()))
                return BadRequest(new { success = false, message = "Chỉ hỗ trợ JPG, PNG, GIF, WEBP." });

            byte[] bytes;
            using (var ms = new MemoryStream()) { await file.CopyToAsync(ms); bytes = ms.ToArray(); }

            string base64    = Convert.ToBase64String(bytes);
            string mediaType = file.ContentType.ToLower();

            var prompt = @"Đây là tài liệu y tế (hồ sơ bệnh án, đơn thuốc, hoặc kết quả xét nghiệm).
Hãy đọc kỹ và trả về DUY NHẤT một JSON hợp lệ theo mẫu sau (không thêm markdown, không giải thích):
{
  ""patientName"": ""..."",
  ""dateOfBirth"": ""dd/MM/yyyy hoặc rỗng"",
  ""gender"": ""Nam hoặc Nữ hoặc rỗng"",
  ""examinationDate"": ""dd/MM/yyyy hoặc hôm nay nếu không rõ"",
  ""diagnosis"": ""chẩn đoán chính..."",
  ""prescription"": ""đơn thuốc, mỗi thuốc một dòng..."",
  ""notes"": ""ghi chú, lưu ý bác sĩ, kết quả xét nghiệm quan trọng..."",
  ""doctorName"": ""tên bác sĩ hoặc rỗng"",
  ""documentType"": ""record|prescription|lab|other""
}
Dùng tiếng Việt. Nếu không đọc được một trường, để chuỗi rỗng.";

            var (ok, text, err) = await CallClaudeVisionAsync(base64, mediaType, prompt);
            if (!ok) return StatusCode(500, new { success = false, message = err });

            // Parse JSON từ Claude
            try
            {
                // Claude đôi khi bọc trong ```json ... ``` — strip ra
                var cleaned = text.Trim();
                if (cleaned.StartsWith("```")) cleaned = System.Text.RegularExpressions.Regex.Replace(cleaned, @"```[a-z]*\n?|\n?```", "").Trim();
                var parsed = JsonSerializer.Deserialize<JsonElement>(cleaned);
                return Ok(new { success = true, data = parsed, rawText = text });
            }
            catch
            {
                // Nếu không parse được JSON, vẫn trả về text thô
                return Ok(new { success = true, data = (object?)null, rawText = text });
            }
        }

        // ════════════════════════════════════════════════════════════════
        // POST /api/ocr/save-record
        // Lưu dữ liệu đã xác nhận vào bảng MedicalRecords
        // ════════════════════════════════════════════════════════════════
        [HttpPost("save-record")]
        [Authorize(Roles = "Doctor,Admin")]
        public async Task<IActionResult> SaveRecord([FromBody] SaveRecordRequest req)
        {
            if (req.PatientId <= 0)
                return BadRequest(new { success = false, message = "Thiếu PatientId." });
            if (string.IsNullOrWhiteSpace(req.Diagnosis))
                return BadRequest(new { success = false, message = "Chẩn đoán không được để trống." });

            // Lấy DoctorId từ session (nếu là Doctor) hoặc dùng req.DoctorId
            int doctorId = req.DoctorId;
            if (doctorId <= 0)
            {
                var username = User.FindFirst("Username")?.Value;
                var doctor = await _context.Doctors.FirstOrDefaultAsync(d => d.FullName != null);
                // Tìm bác sĩ khớp với account đang đăng nhập
                var accountId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");
                var account   = await _context.Accounts.FindAsync(accountId);
                if (account != null)
                    doctor = await _context.Doctors.FirstOrDefaultAsync(d => d.FullName == account.FullName);
                doctorId = doctor?.Id ?? 1;
            }

            var record = new MedicalRecord
            {
                PatientId       = req.PatientId,
                DoctorId        = doctorId,
                ExaminationDate = req.ExaminationDate != default ? req.ExaminationDate : DateTime.Now,
                Diagnosis       = req.Diagnosis.Trim(),
                Prescription    = req.Prescription?.Trim() ?? "",
                Notes           = req.Notes?.Trim() ?? "",
            };

            _context.MedicalRecords.Add(record);
            await _context.SaveChangesAsync();

            return Ok(new { success = true, recordId = record.Id, message = "Đã lưu hồ sơ bệnh án thành công." });
        }

        // ════════════════════════════════════════════════════════════════
        // GET /api/ocr/patient-history/{patientId}
        // Trả toàn bộ tiền sử bệnh của bệnh nhân (cho bác sĩ xem trước khi khám)
        // ════════════════════════════════════════════════════════════════
        [HttpGet("patient-history/{patientId:int}")]
        [Authorize(Roles = "Doctor,Admin")]
        public async Task<IActionResult> GetPatientHistory(int patientId)
        {
            // patientId ở đây là Patient.Id (từ patients-list)
            var patient = await _context.Patients.FindAsync(patientId);
            if (patient == null)
                return NotFound(new { success = false, message = "Không tìm thấy bệnh nhân." });

            var records = await _context.MedicalRecords
                .Where(r => r.PatientId == patientId)
                .Include(r => r.Doctor)
                .OrderByDescending(r => r.ExaminationDate)
                .Select(r => new {
                    r.Id, r.ExaminationDate,
                    r.Diagnosis, r.Prescription, r.Notes,
                    doctorName = r.Doctor != null ? r.Doctor.FullName : "Không rõ",
                    specialty  = r.Doctor != null ? r.Doctor.Specialty : "",
                })
                .ToListAsync();

            var appointments = await _context.Appointments
                .Where(a => a.PatientId == patientId && a.Status == "Đã khám & Xuất HĐ")
                .Include(a => a.Doctor)
                .OrderByDescending(a => a.AppointmentDate)
                .Select(a => new {
                    a.Id, a.AppointmentDate,
                    a.Symptoms, a.Diagnosis, a.Prescription,
                    doctorName = a.Doctor != null ? a.Doctor.FullName : "Không rõ",
                    specialty  = a.Doctor != null ? a.Doctor.Specialty : "",
                })
                .ToListAsync();

            return Ok(new {
                success     = true,
                patientId,
                patientName = patient.FullName,
                records,
                appointments,
            });
        }

        // ════════════════════════════════════════════════════════════════
        // GET /api/ocr/patients-list
        // Danh sách bệnh nhân để bác sĩ chọn khi nhập hồ sơ OCR
        // ════════════════════════════════════════════════════════════════
        [HttpGet("patients-list")]
        [Authorize(Roles = "Doctor,Admin")]
        public IActionResult GetPatientsList()
        {
            // Join Accounts ↔ Patients để lấy Patient.Id (dùng làm FK cho MedicalRecords)
            var list = (from acc in _context.Accounts
                        join pat in _context.Patients on acc.Username equals pat.Username
                        where acc.Role == "Patient"
                        orderby pat.FullName
                        select new { id = pat.Id, fullName = pat.FullName, email = acc.Email })
                       .ToList();
            return Ok(list);
        }

        private async Task<(bool, string, string)> CallClaudeVisionAsync(
            string base64, string mediaType, string prompt)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_config["AnthropicApiKey"]))
                    return (false, "", "Chưa cấu hình AnthropicApiKey.");

                var payload = new
                {
                    model      = "claude-sonnet-4-5",
                    max_tokens = 2000,
                    messages   = new[]
                    {
                        new
                        {
                            role    = "user",
                            content = new object[]
                            {
                                new { type = "image", source = new { type = "base64", media_type = mediaType, data = base64 } },
                                new { type = "text",  text   = prompt }
                            }
                        }
                    }
                };

                var res     = await _http.PostAsJsonAsync(ANTHROPIC_URL, payload);
                var rawBody = await res.Content.ReadAsStringAsync();
                Console.WriteLine($"[OCR] Status: {res.StatusCode}");

                if (!res.IsSuccessStatusCode)
                {
                    Console.WriteLine($"[OCR] Error: {rawBody}");
                    return (false, "", "Không thể đọc tài liệu. Vui lòng thử lại.");
                }

                var json = JsonSerializer.Deserialize<JsonElement>(rawBody);
                string text = json.GetProperty("content")[0].GetProperty("text").GetString() ?? "";
                return (true, text, "");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[OCR] Exception: {ex.Message}");
                return (false, "", "Lỗi hệ thống khi xử lý ảnh.");
            }
        }
    }

    public class SaveRecordRequest
    {
        public int      PatientId       { get; set; }
        public int      DoctorId        { get; set; }
        public DateTime ExaminationDate { get; set; }
        public string   Diagnosis       { get; set; } = "";
        public string?  Prescription    { get; set; }
        public string?  Notes           { get; set; }
    }
}
