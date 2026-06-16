/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║        MedCare — SMTP + Casso Webhook Server (Node.js)          ║
 * ║  smtp.gmail.com:587 · TLS · Casso · ngrok · AI slot suggest     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Cài đặt:  npm install express nodemailer cors node-fetch
 * Chạy:     node server.js
 * ngrok:    .\ngrok.exe http 3000
 */

const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// ══════════════════════════════════════════════
// ⚙️  CẤU HÌNH — chỉnh tại đây
// ══════════════════════════════════════════════
const CONFIG = {
  // SMTP Gmail
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",

  // Email bác sĩ nhận thông báo (cố định)
  doctorEmail: process.env.DOCTOR_EMAIL || process.env.SMTP_USER || "",

  // Tài khoản ngân hàng nhận thanh toán
  bankAccount: process.env.BANK_ACCOUNT || "",
  bankOwner: process.env.BANK_OWNER || "",
  bankName: process.env.BANK_NAME || "MB Bank",

  // Casso
  cassoApiKey: process.env.CASSO_API_KEY || "",

  // URL public (ngrok hoặc domain thật)
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",

  // Anthropic API (cho AI gợi ý slot)
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
};

if (!CONFIG.smtpUser || !CONFIG.smtpPass) {
  console.warn("⚠️  Chưa cấu hình SMTP_USER/SMTP_PASS. Chức năng gửi email sẽ lỗi.");
}

// ══════════════════════════════════════════════
// 📧 SMTP TRANSPORTER
// ══════════════════════════════════════════════
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: CONFIG.smtpUser, pass: CONFIG.smtpPass },
});

// ══════════════════════════════════════════════
// 🗄️  IN-MEMORY STORE
// ══════════════════════════════════════════════
// appointmentStore: token → appointment object
const appointmentStore = new Map();

// paymentStore: shortCode (6 ký tự) → token
const paymentStore = new Map();

// ══════════════════════════════════════════════
// 📂 SERVE HTML
// ══════════════════════════════════════════════
app.use(express.static(__dirname));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "phongkham_v5.html")),
);

// ══════════════════════════════════════════════
// 🕐 SLOT CỐ ĐỊNH 08:00–17:00
// ══════════════════════════════════════════════
const ALL_SLOTS = [
  "08:00–09:00",
  "09:00–10:00",
  "10:00–11:00",
  "11:00–12:00",
  "13:00–14:00",
  "14:00–15:00",
  "15:00–16:00",
  "16:00–17:00",
];

function getSuggestedSlots(excludeTime, excludeDate) {
  // Lấy 3 slot khác slot bị từ chối
  const available = ALL_SLOTS.filter((s) => s !== excludeTime);
  // Shuffle rồi lấy 3
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, 3);
}

// ══════════════════════════════════════════════
// API: GỬI EMAIL ĐẶT LỊCH
// POST /api/send-email
// ══════════════════════════════════════════════
app.post("/api/send-email", async (req, res) => {
  const {
    patientName,
    patientEmail,
    doctorEmail,
    date,
    time,
    doctor,
    spec,
    amount = 200000,
    symptom,
    phone,
    mode = "booking",
    diagnosis,
    apptInfo,
  } = req.body;

  const token = crypto.randomUUID();
  const appointmentId = crypto.randomInt(100000, 999999);
  const shortCode = token.slice(-6).toUpperCase();

  const appt = {
    token,
    appointmentId,
    shortCode,
    patientName,
    patientEmail,
    doctorEmail: doctorEmail || CONFIG.doctorEmail,
    date,
    time,
    doctor,
    spec,
    amount,
    symptom,
    phone,
    mode,
    diagnosis,
    apptInfo,
    status: "pending", // pending → accepted/declined → paid
    createdAt: new Date(),
  };
  appointmentStore.set(token, appt);
  paymentStore.set(shortCode, token);

  const isResult = mode === "result";
  const qrNote = `MEDCARE ${shortCode}`;
  const qrUrl = buildQrUrl(amount, qrNote);

  const confirmUrl = `${CONFIG.publicUrl}/api/confirm?token=${token}&action=accept`;
  const rejectUrl = `${CONFIG.publicUrl}/api/confirm?token=${token}&action=decline`;

  try {
    // Email bệnh nhân
    const patSubject = isResult
      ? `[MedCare] Kết quả khám bệnh & Hóa đơn — ${patientName}`
      : `[MedCare] ✅ Xác nhận lịch khám — ${patientName} — ${date}`;

    const patHtml = isResult
      ? buildPatientResultHtml(appt, qrUrl, qrNote)
      : buildPatientBookingHtml(appt, qrUrl, qrNote);

    // Email bác sĩ
    const docSubject = isResult
      ? `[MedCare] Bệnh án đã lập: ${patientName}`
      : `[MedCare] 🔔 Lịch hẹn mới: ${patientName} — ${date} ${time}`;

    const docHtml = isResult
      ? buildDoctorResultHtml(appt)
      : buildDoctorBookingHtml(appt, confirmUrl, rejectUrl);

    const [r1, r2] = await Promise.all([
      transporter.sendMail({
        from: `"MedCare Phòng Khám" <${CONFIG.smtpUser}>`,
        to: patientEmail,
        subject: patSubject,
        html: patHtml,
      }),
      transporter.sendMail({
        from: `"MedCare AI Scheduler" <${CONFIG.smtpUser}>`,
        to: appt.doctorEmail,
        subject: docSubject,
        html: docHtml,
      }),
    ]);

    log(`✅ Email gửi thành công | Lịch #${appointmentId} | ${patientName}`);
    log(`   → Bệnh nhân: ${patientEmail} (${r1.messageId})`);
    log(`   → Bác sĩ:    ${appt.doctorEmail} (${r2.messageId})`);
    log(`   → Token:     ${token} | ShortCode: ${shortCode}`);

    res.json({ success: true, token, appointmentId, shortCode });
  } catch (err) {
    log(`❌ Gửi email thất bại: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════
// API: DEEP LINK — BÁC SĨ CHẤP NHẬN / TỪ CHỐI
// GET /api/confirm?token=...&action=accept|decline
// ══════════════════════════════════════════════
app.get("/api/confirm", async (req, res) => {
  const { token, action } = req.query;

  if (!token || !appointmentStore.has(token)) {
    return res.send(
      confirmPage("error", null, "Token không hợp lệ hoặc đã hết hạn."),
    );
  }

  const appt = appointmentStore.get(token);

  // Kiểm tra hết hạn 24h
  if (Date.now() - appt.createdAt.getTime() > 24 * 3600 * 1000) {
    return res.send(
      confirmPage("error", appt, "Token đã hết hạn (quá 24 giờ)."),
    );
  }

  if (appt.status === "accepted") {
    return res.send(
      confirmPage("already", appt, "Lịch hẹn này đã được chấp nhận trước đó."),
    );
  }
  if (appt.status === "declined") {
    return res.send(
      confirmPage("already", appt, "Lịch hẹn này đã được từ chối trước đó."),
    );
  }

  // ── CHẤP NHẬN ──
  if (action === "accept") {
    appt.status = "accepted";
    appointmentStore.set(token, appt);
    log(
      `✅ Bác sĩ CHẤP NHẬN lịch #${appt.appointmentId} — ${appt.patientName}`,
    );

    // Gửi email xác nhận cho bệnh nhân
    const qrNote = `MEDCARE ${appt.shortCode}`;
    const qrUrl = buildQrUrl(appt.amount, qrNote);
    try {
      await transporter.sendMail({
        from: `"MedCare Phòng Khám" <${CONFIG.smtpUser}>`,
        to: appt.patientEmail,
        subject: `[MedCare] ✅ Lịch khám đã được bác sĩ xác nhận — ${appt.patientName}`,
        html: buildPatientConfirmedHtml(appt, qrUrl, qrNote),
      });
      log(`   → Đã gửi email xác nhận cho bệnh nhân: ${appt.patientEmail}`);
    } catch (e) {
      log(`   ⚠️  Không gửi được email bệnh nhân: ${e.message}`);
    }

    return res.send(confirmPage("accepted", appt));
  }

  // ── TỪ CHỐI → AI GỢI Ý 3 SLOT MỚI ──
  if (action === "decline") {
    appt.status = "declined";
    appointmentStore.set(token, appt);
    log(`❌ Bác sĩ TỪ CHỐI lịch #${appt.appointmentId} — ${appt.patientName}`);

    // Sinh 3 slot thay thế
    const slots = getSuggestedSlots(appt.time, appt.date);

    // Tạo token mới cho từng slot
    const slotTokens = slots.map((slot, i) => {
      const newToken = crypto.randomUUID();
      const newApptId = crypto.randomInt(100000, 999999);
      const newShortCode = newToken.slice(-6).toUpperCase();
      const newAppt = {
        ...appt,
        token: newToken,
        appointmentId: newApptId,
        shortCode: newShortCode,
        time: slot,
        status: "pending",
        createdAt: new Date(),
        parentToken: token, // liên kết với lịch gốc bị từ chối
      };
      appointmentStore.set(newToken, newAppt);
      paymentStore.set(newShortCode, newToken);
      return { token: newToken, slot, appt: newAppt };
    });

    // Gửi email bác sĩ với 3 nút chọn giờ mới
    try {
      await transporter.sendMail({
        from: `"MedCare AI Scheduler" <${CONFIG.smtpUser}>`,
        to: appt.doctorEmail,
        subject: `[MedCare] 🔄 Chọn giờ thay thế cho ${appt.patientName} — ${appt.date}`,
        html: buildDoctorRescheduleHtml(appt, slotTokens),
      });
      log(`   → Đã gửi email gợi ý 3 slot mới cho bác sĩ`);
    } catch (e) {
      log(`   ⚠️  Không gửi được email reschedule: ${e.message}`);
    }

    // Gửi email tạm thời cho bệnh nhân biết đang chờ xử lý
    try {
      await transporter.sendMail({
        from: `"MedCare Phòng Khám" <${CONFIG.smtpUser}>`,
        to: appt.patientEmail,
        subject: `[MedCare] ⏳ Lịch khám đang được sắp xếp lại — ${appt.patientName}`,
        html: buildPatientPendingRescheduleHtml(appt),
      });
    } catch (e) {}

    return res.send(confirmPage("declined", appt));
  }

  return res.send(confirmPage("error", appt, "Hành động không hợp lệ."));
});

// ══════════════════════════════════════════════
// API: BÁC SĨ CHỌN SLOT MỚI (sau khi từ chối)
// GET /api/select-slot?token=...
// ══════════════════════════════════════════════
app.get("/api/select-slot", async (req, res) => {
  const { token } = req.query;

  if (!token || !appointmentStore.has(token)) {
    return res.send(
      confirmPage("error", null, "Link không hợp lệ hoặc đã hết hạn."),
    );
  }

  const appt = appointmentStore.get(token);
  if (appt.status === "accepted") {
    return res.send(
      confirmPage("already", appt, "Slot này đã được xác nhận trước đó."),
    );
  }

  appt.status = "accepted";
  appointmentStore.set(token, appt);
  log(
    `✅ Bác sĩ chọn slot mới: ${appt.time} | Lịch #${appt.appointmentId} — ${appt.patientName}`,
  );

  // Gửi email bệnh nhân lịch mới + QR mới
  const qrNote = `MEDCARE ${appt.shortCode}`;
  const qrUrl = buildQrUrl(appt.amount, qrNote);

  try {
    await transporter.sendMail({
      from: `"MedCare Phòng Khám" <${CONFIG.smtpUser}>`,
      to: appt.patientEmail,
      subject: `[MedCare] 🗓️ Lịch khám mới đã được xác nhận — ${appt.patientName}`,
      html: buildPatientRescheduledHtml(appt, qrUrl, qrNote),
    });
    log(`   → Đã gửi email lịch mới cho bệnh nhân: ${appt.patientEmail}`);
  } catch (e) {
    log(`   ⚠️  Không gửi được email lịch mới: ${e.message}`);
  }

  return res.send(slotSelectedPage(appt));
});

// ══════════════════════════════════════════════
// 🏦 WEBHOOK CASSO — NHẬN THANH TOÁN TỰ ĐỘNG
// POST /api/payment-webhook
// ══════════════════════════════════════════════
app.post("/api/payment-webhook", async (req, res) => {
  // Xác thực API key Casso
  const authHeader =
    req.headers["x-api-key"] ||
    req.headers["authorization"] ||
    req.headers["apikey"] ||
    "";
  if (CONFIG.cassoApiKey && !authHeader.includes(CONFIG.cassoApiKey)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body;
  log(`📥 Casso webhook nhận được:`);
  log(JSON.stringify(body, null, 2));

  // Casso gửi array "data" hoặc object đơn
  const transactions = Array.isArray(body.data) ? body.data : [body];

  for (const tx of transactions) {
    const description = (
      tx.description ||
      tx.content ||
      tx.addInfo ||
      ""
    ).toUpperCase();
    const amount = tx.amount || tx.value || 0;

    log(`   💰 Giao dịch: ${amount}đ | Nội dung: "${description}"`);

    // Tìm shortCode trong nội dung chuyển khoản
    // Nội dung dạng: "MEDCARE ABC123" hoặc "CHUYEN KHOAN MEDCARE ABC123"
    const match = description.match(/MEDCARE\s+([A-Z0-9]{6})/);
    if (!match) {
      log(`   ⏭️  Không tìm thấy mã MEDCARE — bỏ qua`);
      continue;
    }

    const shortCode = match[1];
    const token = paymentStore.get(shortCode);

    if (!token || !appointmentStore.has(token)) {
      log(`   ⚠️  Mã ${shortCode} không khớp lịch hẹn nào`);
      continue;
    }

    const appt = appointmentStore.get(token);

    if (appt.paidAt) {
      log(`   ⏭️  Lịch #${appt.appointmentId} đã thanh toán trước đó`);
      continue;
    }

    // Đánh dấu đã thanh toán
    appt.paidAt = new Date();
    appt.paidAmount = amount;
    appt.txId = tx.id || tx.tid || shortCode;
    appointmentStore.set(token, appt);

    log(
      `✅ THANH TOÁN XÁC NHẬN: Lịch #${appt.appointmentId} | ${appt.patientName} | ${amount.toLocaleString("vi-VN")}đ`,
    );

    // Gửi 2 email song song
    try {
      await Promise.all([
        // Email bệnh nhân — xác nhận đã thanh toán
        transporter.sendMail({
          from: `"MedCare Phòng Khám" <${CONFIG.smtpUser}>`,
          to: appt.patientEmail,
          subject: `[MedCare] 💳 Xác nhận thanh toán thành công — ${appt.patientName}`,
          html: buildPatientPaymentHtml(appt),
        }),
        // Email bác sĩ — thông báo bệnh nhân đã thanh toán
        transporter.sendMail({
          from: `"MedCare Billing" <${CONFIG.smtpUser}>`,
          to: appt.doctorEmail,
          subject: `[MedCare] 💰 Bệnh nhân ĐÃ THANH TOÁN — ${appt.patientName} — ${amount.toLocaleString("vi-VN")}đ`,
          html: buildDoctorPaymentHtml(appt),
        }),
      ]);
      log(`   → Đã gửi email xác nhận thanh toán cho 2 bên`);
    } catch (e) {
      log(`   ⚠️  Lỗi gửi email thanh toán: ${e.message}`);
    }
  }

  res.json({ success: true });
});

// ══════════════════════════════════════════════
// API: HEALTH CHECK
// ══════════════════════════════════════════════
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    appointments: appointmentStore.size,
    payments: paymentStore.size,
    publicUrl: CONFIG.publicUrl,
  });
});

// ══════════════════════════════════════════════
// 🛠️  HELPERS
// ══════════════════════════════════════════════
function buildQrUrl(amount, note) {
  return `https://img.vietqr.io/image/MB-${CONFIG.bankAccount}-compact2.jpg?amount=${amount}&addInfo=${encodeURIComponent(note)}&accountName=${encodeURIComponent(CONFIG.bankOwner)}`;
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString("vi-VN")}] ${msg}`);
}

// ══════════════════════════════════════════════
// 📧 EMAIL HTML BUILDERS
// ══════════════════════════════════════════════
function emailWrap(accentColor, bodyContent) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f8fc;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fc;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(16,87,164,.10)">
<tr><td style="background:linear-gradient(135deg,${accentColor} 0%,#005f8a 100%);padding:28px 36px;text-align:center">
  <div style="font-size:28px;font-weight:800;color:#fff">🏥 MedCare</div>
  <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">Phòng Khám Đa Khoa · medcare.vn</div>
</td></tr>
<tr><td style="padding:32px 36px">${bodyContent}</td></tr>
<tr><td style="background:#f5f8fc;padding:20px 36px;text-align:center;font-size:12px;color:#9badbf;border-top:1px solid #e8f0fb">
  MedCare · 123 Đường Sức Khỏe, Q.1, TP.HCM · Hotline: <b>1900-1234</b>
</td></tr>
</table></td></tr></table></body></html>`;
}

function infoRow(icon, label, value) {
  if (!value || value === "—") return "";
  return `<tr>
    <td style="padding:7px 0;color:#52677f;font-size:13px;white-space:nowrap">${icon} ${label}</td>
    <td style="padding:7px 0 7px 16px;font-size:13px;font-weight:600;color:#111827">${value}</td>
  </tr>`;
}

function buildPatientBookingHtml(a, qrUrl, qrNote) {
  return emailWrap(
    "#1057a4",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>${a.patientName}</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">Lịch khám đã được ghi nhận và đang chờ bác sĩ xác nhận.</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#1057a4;text-transform:uppercase;margin-bottom:12px">📋 Chi tiết lịch hẹn</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("📅", "Ngày khám", a.date)}
        ${infoRow("⏰", "Giờ khám", a.time)}
        ${infoRow("👨‍⚕️", "Bác sĩ", a.doctor)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("🩺", "Triệu chứng", a.symptom)}
        ${infoRow("📞", "Điện thoại", a.phone)}
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#065F46;text-transform:uppercase;margin-bottom:12px">💳 Thanh toán qua VietQR</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("💰", "Số tiền", `<span style="color:#1057a4;font-size:15px;font-weight:800">${(a.amount || 200000).toLocaleString("vi-VN")}đ</span>`)}
        ${infoRow("🏦", "Ngân hàng", CONFIG.bankName)}
        ${infoRow("🔢", "Số tài khoản", CONFIG.bankAccount)}
        ${infoRow("👤", "Chủ tài khoản", CONFIG.bankOwner)}
        ${infoRow("📝", "Nội dung CK", `<b style="color:#dc2626">${qrNote}</b> (bắt buộc)`)}
      </table>
      <div style="text-align:center;margin-top:16px">
        <img src="${qrUrl}" alt="VietQR" width="180" style="border-radius:10px;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.12)">
        <div style="font-size:11px;color:#6b7280;margin-top:8px">Quét mã để chuyển khoản nhanh</div>
      </div>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;font-size:12.5px;color:#92400e">
      ⚠️ <b>Lưu ý:</b> Vui lòng ghi đúng nội dung chuyển khoản <b>"${qrNote}"</b> để hệ thống tự động xác nhận thanh toán.<br>
      🔑 Mã lịch hẹn: <b>${a.appointmentId}</b>
    </div>`,
  );
}

function buildDoctorBookingHtml(a, confirmUrl, rejectUrl) {
  return emailWrap(
    "#065F46",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>Bác sĩ</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">Có <b style="color:#1057a4">lịch hẹn mới</b> cần xác nhận:</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:#1057a4;text-transform:uppercase;margin-bottom:12px">👤 Thông tin bệnh nhân</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("👤", "Họ tên", a.patientName)}
        ${infoRow("📞", "SĐT", a.phone)}
        ${infoRow("🩺", "Triệu chứng", a.symptom)}
        ${infoRow("📅", "Ngày hẹn", a.date)}
        ${infoRow("⏰", "Giờ hẹn", a.time)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("🔢", "Mã lịch", `#${a.appointmentId}`)}
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:24px;margin-bottom:20px;text-align:center">
      <div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#065F46;text-transform:uppercase;margin-bottom:16px">⚡ XÁC NHẬN 1 CHẠM — KHÔNG CẦN ĐĂNG NHẬP</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="padding:0 8px"><a href="${confirmUrl}" style="display:block;background:#00b896;color:#fff;text-decoration:none;padding:16px;border-radius:10px;font-size:16px;font-weight:800;text-align:center">✅ CHẤP NHẬN</a></td>
        <td style="padding:0 8px"><a href="${rejectUrl}" style="display:block;background:#e53935;color:#fff;text-decoration:none;padding:16px;border-radius:10px;font-size:16px;font-weight:800;text-align:center">❌ TỪ CHỐI</a></td>
      </tr></table>
      <p style="font-size:11.5px;color:#6b7280;margin:14px 0 0">Nếu từ chối, AI sẽ tự động gợi ý 3 khung giờ thay thế để bạn chọn lại.</p>
    </div>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;font-size:12px;color:#92400e">
      🔑 Token: <code style="font-size:11px">${a.token}</code><br>
      Link hết hạn sau <b>24 giờ</b>
    </div>`,
  );
}

function buildPatientConfirmedHtml(a, qrUrl, qrNote) {
  return emailWrap(
    "#00b896",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>${a.patientName}</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 4px">🎉 Bác sĩ đã <b style="color:#00b896">CHẤP NHẬN</b> lịch khám của bạn!</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">Vui lòng hoàn tất thanh toán để giữ chỗ.</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("📅", "Ngày khám", a.date)}
        ${infoRow("⏰", "Giờ khám", a.time)}
        ${infoRow("👨‍⚕️", "Bác sĩ", a.doctor)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("🔢", "Mã lịch", `#${a.appointmentId}`)}
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:#065F46;text-transform:uppercase;margin-bottom:12px">💳 Thanh toán để xác nhận chỗ</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("💰", "Số tiền", `<b style="color:#1057a4;font-size:15px">${(a.amount || 200000).toLocaleString("vi-VN")}đ</b>`)}
        ${infoRow("🏦", "Ngân hàng", `${CONFIG.bankName} · ${CONFIG.bankAccount}`)}
        ${infoRow("👤", "Chủ TK", CONFIG.bankOwner)}
        ${infoRow("📝", "Nội dung CK", `<b style="color:#dc2626">${qrNote}</b>`)}
      </table>
      <div style="text-align:center;margin-top:16px">
        <img src="${qrUrl}" alt="VietQR" width="180" style="border-radius:10px">
      </div>
    </div>`,
  );
}

function buildDoctorRescheduleHtml(a, slotTokens) {
  const slotButtons = slotTokens
    .map(({ token, slot }) => {
      const selectUrl = `${CONFIG.publicUrl}/api/select-slot?token=${token}`;
      return `<td style="padding:0 6px"><a href="${selectUrl}" style="display:block;background:#1057a4;color:#fff;text-decoration:none;padding:14px 10px;border-radius:10px;font-size:14px;font-weight:700;text-align:center">🕐 ${slot}</a></td>`;
    })
    .join("");

  return emailWrap(
    "#1057a4",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>Bác sĩ</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">Bạn đã từ chối lịch hẹn <b>${a.time}</b> của bệnh nhân <b>${a.patientName}</b>.</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("👤", "Bệnh nhân", a.patientName)}
        ${infoRow("📅", "Ngày hẹn", a.date)}
        ${infoRow("⏰", "Giờ cũ (đã từ chối)", `<s style="color:#9badbf">${a.time}</s>`)}
        ${infoRow("🩺", "Triệu chứng", a.symptom)}
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:24px;text-align:center">
      <div style="font-size:12px;font-weight:700;letter-spacing:.8px;color:#065F46;text-transform:uppercase;margin-bottom:16px">🤖 AI GỢI Ý 3 KHUNG GIỜ THAY THẾ — NGÀY ${a.date}</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>${slotButtons}</tr></table>
      <p style="font-size:11.5px;color:#6b7280;margin:14px 0 0">Bấm vào khung giờ phù hợp để xác nhận. Hệ thống sẽ tự động gửi lịch mới đến bệnh nhân.</p>
    </div>`,
  );
}

function buildPatientPendingRescheduleHtml(a) {
  return emailWrap(
    "#f59e0b",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>${a.patientName}</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 16px">Bác sĩ chưa thể nhận lịch vào <b>${a.time}</b> ngày <b>${a.date}</b>.</p>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">⏳</div>
      <div style="font-size:15px;font-weight:700;color:#92400e;margin-bottom:8px">Đang sắp xếp lại lịch</div>
      <p style="font-size:13px;color:#78350f;margin:0">Hệ thống đang đề xuất khung giờ phù hợp cho bác sĩ. Bạn sẽ nhận email xác nhận lịch mới trong thời gian sớm nhất.</p>
    </div>
    <p style="font-size:12px;color:#9badbf;margin:16px 0 0;text-align:center">Hotline hỗ trợ: <b>1900-1234</b></p>`,
  );
}

function buildPatientRescheduledHtml(a, qrUrl, qrNote) {
  return emailWrap(
    "#1057a4",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>${a.patientName}</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 4px">🗓️ Lịch khám của bạn đã được <b style="color:#1057a4">SẮP XẾP LẠI</b> thành công!</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">Bác sĩ đã xác nhận khung giờ mới:</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("📅", "Ngày khám", a.date)}
        ${infoRow("⏰", "Giờ khám MỚI", `<b style="color:#00b896;font-size:15px">${a.time}</b>`)}
        ${infoRow("👨‍⚕️", "Bác sĩ", a.doctor)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("🔢", "Mã lịch", `#${a.appointmentId}`)}
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:#065F46;text-transform:uppercase;margin-bottom:12px">💳 Thanh toán để xác nhận</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("💰", "Số tiền", `<b style="color:#1057a4">${(a.amount || 200000).toLocaleString("vi-VN")}đ</b>`)}
        ${infoRow("📝", "Nội dung CK", `<b style="color:#dc2626">${qrNote}</b>`)}
      </table>
      <div style="text-align:center;margin-top:16px">
        <img src="${qrUrl}" alt="VietQR" width="180" style="border-radius:10px">
      </div>
    </div>`,
  );
}

function buildPatientPaymentHtml(a) {
  return emailWrap(
    "#00b896",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>${a.patientName}</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">💳 Hệ thống đã ghi nhận thanh toán của bạn!</p>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:24px;margin-bottom:20px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">✅</div>
      <div style="font-size:20px;font-weight:800;color:#065F46;margin-bottom:8px">THANH TOÁN THÀNH CÔNG</div>
      <div style="font-size:28px;font-weight:800;color:#1057a4;margin-bottom:4px">${(a.paidAmount || a.amount || 200000).toLocaleString("vi-VN")}đ</div>
      <div style="font-size:12px;color:#6b7280">Mã giao dịch: ${a.txId || a.shortCode}</div>
    </div>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#1057a4;text-transform:uppercase;margin-bottom:12px">📋 Thông tin lịch khám</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("📅", "Ngày khám", a.date)}
        ${infoRow("⏰", "Giờ khám", a.time)}
        ${infoRow("👨‍⚕️", "Bác sĩ", a.doctor)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("🔢", "Mã lịch", `#${a.appointmentId}`)}
      </table>
    </div>
    <p style="font-size:13px;color:#52677f;text-align:center">Vui lòng đến đúng giờ. Hotline: <b>1900-1234</b></p>`,
  );
}

function buildDoctorPaymentHtml(a) {
  return emailWrap(
    "#1057a4",
    `
    <p style="font-size:14px;color:#52677f;margin:0 0 20px">Thông báo từ hệ thống MedCare Billing</p>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:24px;margin-bottom:20px;text-align:center">
      <div style="font-size:40px;margin-bottom:8px">💰</div>
      <div style="font-size:17px;font-weight:800;color:#065F46;margin-bottom:6px">BỆNH NHÂN ĐÃ THANH TOÁN</div>
      <div style="font-size:26px;font-weight:800;color:#1057a4">${(a.paidAmount || a.amount || 200000).toLocaleString("vi-VN")}đ</div>
    </div>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("👤", "Bệnh nhân", a.patientName)}
        ${infoRow("📅", "Ngày khám", a.date)}
        ${infoRow("⏰", "Giờ khám", a.time)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("🔢", "Mã lịch", `#${a.appointmentId}`)}
        ${infoRow("🧾", "Mã GD", a.txId || a.shortCode)}
        ${infoRow("🕐", "Thời điểm TT", a.paidAt ? new Date(a.paidAt).toLocaleString("vi-VN") : "—")}
      </table>
    </div>`,
  );
}

function buildPatientResultHtml(a, qrUrl, qrNote) {
  return emailWrap(
    "#1057a4",
    `
    <p style="font-size:15px;color:#111827;margin:0 0 8px">Kính gửi <b>${a.patientName}</b>,</p>
    <p style="font-size:13px;color:#52677f;margin:0 0 20px">Bệnh án sau buổi khám đã được lập thành công.</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("👨‍⚕️", "Bác sĩ", a.doctor)}
        ${infoRow("🏥", "Chuyên khoa", a.spec)}
        ${infoRow("📋", "Chẩn đoán", a.diagnosis || "Đã ghi nhận")}
      </table>
    </div>
    <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px;padding:20px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("💰", "Tổng phí", `${(a.amount || 0).toLocaleString("vi-VN")}đ`)}
        ${infoRow("📝", "Nội dung CK", `<b>${qrNote}</b>`)}
      </table>
      <div style="text-align:center;margin-top:16px">
        <img src="${qrUrl}" alt="VietQR" width="160" style="border-radius:10px">
      </div>
    </div>`,
  );
}

function buildDoctorResultHtml(a) {
  return emailWrap(
    "#1057a4",
    `
    <p style="font-size:14px;color:#52677f;margin:0 0 16px">Thông báo nội bộ — MedCare EMR</p>
    <div style="background:#eaf2ff;border-radius:12px;padding:20px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow("👤", "Bệnh nhân", a.patientName)}
        ${infoRow("📋", "Lịch", a.apptInfo)}
        ${infoRow("🩺", "Chẩn đoán", a.diagnosis)}
        ${infoRow("💰", "Tổng phí", `${(a.amount || 0).toLocaleString("vi-VN")}đ`)}
      </table>
    </div>`,
  );
}

// ══════════════════════════════════════════════
// 🖥️  TRANG XÁC NHẬN (DEEP LINK RESPONSE)
// ══════════════════════════════════════════════
function confirmPage(state, appt, msg) {
  const cfg = {
    accepted: {
      icon: "✅",
      color: "#00b896",
      title: "Đã chấp nhận lịch hẹn!",
      sub: "Hệ thống đã gửi email xác nhận đến bệnh nhân.",
    },
    declined: {
      icon: "❌",
      color: "#e53935",
      title: "Đã từ chối lịch hẹn",
      sub: "AI đang gợi ý 3 khung giờ thay thế — kiểm tra email của bạn!",
    },
    already: {
      icon: "ℹ️",
      color: "#1057a4",
      title: "Đã xử lý trước đó",
      sub: msg,
    },
    error: { icon: "⚠️", color: "#f59e0b", title: "Không thể xử lý", sub: msg },
  };
  const c = cfg[state] || cfg.error;
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${c.title}</title>
<style>body{margin:0;font-family:'Segoe UI',sans-serif;background:#f5f8fc;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head><body>
<div style="background:#fff;border-radius:20px;padding:48px 40px;max-width:460px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(16,87,164,.12)">
  <div style="font-size:64px;margin-bottom:16px">${c.icon}</div>
  <div style="font-size:22px;font-weight:800;color:${c.color};margin-bottom:10px">${c.title}</div>
  <p style="font-size:14px;color:#52677f;margin:0 0 24px">${c.sub}</p>
  ${
    appt
      ? `<div style="background:#f5f8fc;border-radius:12px;padding:16px;text-align:left;font-size:13px;margin-bottom:24px;line-height:1.8">
    <b>Lịch #${appt.appointmentId}</b><br>
    👤 ${appt.patientName}<br>
    📅 ${appt.date} · ⏰ ${appt.time}<br>
    👨‍⚕️ ${appt.doctor} · 🏥 ${appt.spec}
  </div>`
      : ""
  }
  <a href="/" style="display:inline-block;background:#1057a4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px">← Về trang MedCare</a>
</div></body></html>`;
}

function slotSelectedPage(appt) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đã chọn khung giờ mới</title>
<style>body{margin:0;font-family:'Segoe UI',sans-serif;background:#f5f8fc;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head><body>
<div style="background:#fff;border-radius:20px;padding:48px 40px;max-width:460px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(16,87,164,.12)">
  <div style="font-size:64px;margin-bottom:16px">🗓️</div>
  <div style="font-size:22px;font-weight:800;color:#00b896;margin-bottom:10px">Đã xác nhận khung giờ mới!</div>
  <p style="font-size:14px;color:#52677f;margin:0 0 20px">Hệ thống đã gửi lịch mới đến bệnh nhân.</p>
  <div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:left;font-size:13px;margin-bottom:24px;line-height:1.8">
    <b>Lịch #${appt.appointmentId}</b><br>
    👤 ${appt.patientName}<br>
    📅 ${appt.date} · ⏰ <b style="color:#00b896">${appt.time}</b> (giờ mới)<br>
    👨‍⚕️ ${appt.doctor}
  </div>
  <a href="/" style="display:inline-block;background:#1057a4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px">← Về trang MedCare</a>
</div></body></html>`;
}

// ══════════════════════════════════════════════
// 🚀 KHỞI ĐỘNG
// ══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          MedCare SMTP + Casso Server — READY             ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(
    `║  🌐 Local:    http://localhost:${PORT}                       ║`,
  );
  console.log(`║  🌍 Public:   ${CONFIG.publicUrl}  ║`);
  console.log(`║  📧 SMTP:     smtp.gmail.com:587 (TLS)                   ║`);
  console.log(`║  🏦 VietQR:   MB Bank · ${CONFIG.bankAccount}              ║`);
  console.log(`║  💳 Casso:    Webhook đang lắng nghe                     ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  📬 POST  /api/send-email                                ║");
  console.log("║  ✅ GET   /api/confirm?token=&action=accept|decline      ║");
  console.log("║  🔄 GET   /api/select-slot?token=                        ║");
  console.log("║  💳 POST  /api/payment-webhook   ← Casso gọi vào đây    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  👉 Điền webhook này vào Casso:`);
  console.log(`     ${CONFIG.publicUrl}/api/payment-webhook\n`);
});
