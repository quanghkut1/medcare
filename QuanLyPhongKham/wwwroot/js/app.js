// ============================================================
// MedCare — Logic ứng dụng chính
// (auth, đặt lịch, dashboard, EMR, news, lịch hẹn)
// ============================================================

      // ════════════════════════════════════
      // BẢO MẬT: escape HTML chống XSS
      // Dùng cho MỌI dữ liệu động đưa vào innerHTML
      // (tên bệnh nhân, triệu chứng, tiêu đề tin tức...)
      // ════════════════════════════════════
      function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      // ════════════════════════════════════
      // GLOBAL STATE
      // ════════════════════════════════════
      let currentRole = null; // 'patient' | 'doctor' | 'admin'
      let currentUser = null;
      let selectedRoleTab = "patient";
      let drugRowCount = 2;
      let selectedSchedSlot = 0;

      // ── Header scroll ──
      window.addEventListener("scroll", () => {
        document
          .getElementById("site-header")
          .classList.toggle("solid", scrollY > 20);
      });

      // ── Reveal on scroll ──
      // (Đã chuyển sang GSAP ScrollTrigger trong js/animations.js
      //  để tránh xung đột 2 hệ animation cùng điều khiển .reveal)

      // ── Slider ──
      let cur = 0,
        total = 3,
        autoTimer;
      function moveSlide(dir) {
        cur = (cur + dir + total) % total;
        renderSlide();
      }
      function goSlide(i) {
        cur = i;
        renderSlide();
      }
      function renderSlide() {
        document.getElementById("slider-track").style.transform =
          `translateX(-${cur * 100}%)`;
        document
          .querySelectorAll(".sl-dot")
          .forEach((d, i) => d.classList.toggle("active", i === cur));
      }
      function startAuto() {
        autoTimer = setInterval(() => moveSlide(1), 4200);
      }
      function stopAuto() {
        clearInterval(autoTimer);
      }
      document
        .querySelector(".slider-wrap")
        .addEventListener("mouseenter", stopAuto);
      document
        .querySelector(".slider-wrap")
        .addEventListener("mouseleave", startAuto);
      startAuto();

      // ── Hero search ──
      function updateHeroCount() {
        const v = document.getElementById("hero-search-input").value;
        document.getElementById("hs-input-chars").textContent =
          v.length + "/500";
      }

      function heroSearch() {
        const v = document.getElementById("hero-search-input").value.trim();
        if (!v) {
          showToast(
            "Vui lòng nhập!",
            "Nhập triệu chứng hoặc tên bác sĩ.",
            "⚠️",
          );
          return;
        }
        // Pre-fill symptom field and open multi-step modal
        const symEl = document.getElementById("af-symptom");
        if (symEl) symEl.value = v;
        const msSymEl = document.getElementById("ms-symptom");
        if (msSymEl) msSymEl.value = v;
        // Also run AI triage in background
        document.getElementById("af-symptom").value = v;
        aiSuggest();
        document
          .getElementById("ai-form")
          .scrollIntoView({ behavior: "smooth" });
      }

      // ════════════════════════════════════
      // RBAC — Role-Based Access Control
      // ════════════════════════════════════
      function selectRole(role) {
        selectedRoleTab = role;
        ["patient", "doctor", "admin"].forEach((r) => {
          const el = document.getElementById("rt-" + r);
          if (el) el.classList.toggle("active", r === role);
        });
      }

      // ════════════════════════════════════
      // LOGIN THẬT — Gọi .NET API /api/login
      // ════════════════════════════════════
      async function doLogin() {
        const username = document.getElementById("login-email").value.trim();
        const pw = document.getElementById("login-pw").value;
        const err = document.getElementById("modal-error");

        if (!username || !pw) {
          err.style.display = "block";
          err.textContent = "Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.";
          return;
        }

        // Map role tab → .NET Role string
        const roleMap = {
          patient: "Patient",
          doctor: "Doctor",
          admin: "Admin",
        };
        const role = roleMap[selectedRoleTab] || "Patient";

        err.style.display = "none";
        const loginBtn = document.querySelector(".btn-modal-login");
        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.textContent = "Đang đăng nhập…";
        }

        try {
          const res = await fetch(`${SMTP_SERVER}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include", // Gửi kèm cookie
            body: JSON.stringify({ username, password: pw, role }),
          });

          const json = await res.json();

          if (!res.ok || !json.success) {
            err.style.display = "block";
            err.textContent = json.error || "Đăng nhập thất bại!";
            return;
          }

          // Lưu user state
          currentRole = selectedRoleTab;
          currentUser = {
            email: json.email || username,
            name: json.fullName || username,
            username: json.username,
            id: json.id,
            role: json.role,
          };

          closeLoginModal();
          applyRBAC();
          showToast(
            "Đăng nhập thành công! 🎉",
            `Xin chào ${currentUser.name} · ${roleLabel(currentRole)}`,
            "✅",
          );
        } catch (e) {
          err.style.display = "block";
          err.textContent =
            "⚠️ Không kết nối được server. Hãy chạy: dotnet run";
        } finally {
          if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = "Đăng nhập";
          }
        }
      }

      // ════════════════════════════════════
      // ĐĂNG KÝ TÀI KHOẢN
      // ════════════════════════════════════
      function openRegisterModal() {
        closeLoginModal();
        document.getElementById("register-modal").classList.add("open");
        document.body.style.overflow = "hidden";
        document.getElementById("register-error").style.display = "none";
        setTimeout(() => document.getElementById("reg-fullname").focus(), 350);
      }
      function closeRegisterModal() {
        document.getElementById("register-modal").classList.remove("open");
        document.body.style.overflow = "";
      }
      function toggleRegPw() {
        const inp = document.getElementById("reg-pw");
        const eye = document.getElementById("reg-pw-eye");
        inp.type = inp.type === "password" ? "text" : "password";
        eye.textContent = inp.type === "password" ? "👁" : "🙈";
      }
      // ── QUÊN MẬT KHẨU ──
      function openForgotModal() {
        document.getElementById("login-modal")?.classList.remove("open");
        const e = document.getElementById("forgot-error"); if (e) e.style.display = "none";
        document.getElementById("forgot-modal").classList.add("open");
        document.body.style.overflow = "hidden";
      }
      function closeForgotModal() {
        document.getElementById("forgot-modal").classList.remove("open");
        document.body.style.overflow = "";
      }
      async function doForgot() {
        const err = document.getElementById("forgot-error");
        const show = (m, ok) => { err.style.display = "block"; err.style.color = ok ? "#16a34a" : ""; err.textContent = m; };
        const username = document.getElementById("fg-username").value.trim();
        const email = document.getElementById("fg-email").value.trim();
        if (!username || !email) return show("Vui lòng nhập tên đăng nhập và email.");
        try {
          const res = await fetch(`${SMTP_SERVER}/api/forgot-password`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email }),
          });
          const j = await res.json();
          show(j.success ? (j.message || "Đã gửi mật khẩu mới tới email.") : (j.error || "Không gửi được. Thử lại."), j.success);
        } catch (_) { show("Lỗi kết nối máy chủ."); }
      }

      // ── HỒ SƠ CÁ NHÂN ──
      function openProfileModal() {
        const err = document.getElementById("profile-error"); if (err) err.style.display = "none";
        document.getElementById("profile-modal").classList.add("open");
        document.body.style.overflow = "hidden";
        fetch(`${SMTP_SERVER}/api/profile`, { credentials: "include" })
          .then((r) => r.json()).then((d) => {
            if (!d.success) return;
            document.getElementById("pf-fullname").value = d.fullName || "";
            document.getElementById("pf-email").value = d.email || "";
            document.getElementById("pf-phone").value = d.phone || "";
            document.getElementById("pf-dob").value = d.dateOfBirth || "";
            document.getElementById("pf-gender").value = d.gender || "";
          }).catch(() => {});
      }
      function closeProfileModal() {
        document.getElementById("profile-modal").classList.remove("open");
        document.body.style.overflow = "";
      }
      async function saveProfile() {
        const err = document.getElementById("profile-error");
        const show = (m, ok) => { err.style.display = "block"; err.style.color = ok ? "#16a34a" : ""; err.textContent = m; };
        const body = {
          fullName: document.getElementById("pf-fullname").value.trim(),
          email: document.getElementById("pf-email").value.trim(),
          phone: document.getElementById("pf-phone").value.trim(),
          dateOfBirth: document.getElementById("pf-dob").value,
          gender: document.getElementById("pf-gender").value,
        };
        try {
          const res = await fetch(`${SMTP_SERVER}/api/profile`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "include", body: JSON.stringify(body),
          });
          const j = await res.json();
          if (j.success) {
            show("Đã lưu thông tin ✓", true);
            if (currentUser) { currentUser.name = j.fullName; currentUser.email = j.email; }
          } else show(j.error || "Lưu thất bại.");
        } catch (_) { show("Lỗi kết nối máy chủ."); }
      }
      async function doChangePassword() {
        const err = document.getElementById("profile-error");
        const show = (m, ok) => { err.style.display = "block"; err.style.color = ok ? "#16a34a" : ""; err.textContent = m; };
        const cur = document.getElementById("pf-curpw").value;
        const np = document.getElementById("pf-newpw").value;
        if (!cur || !np) return show("Nhập mật khẩu hiện tại và mật khẩu mới.");
        try {
          const res = await fetch(`${SMTP_SERVER}/api/change-password`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "include", body: JSON.stringify({ currentPassword: cur, newPassword: np }),
          });
          const j = await res.json();
          if (j.success) {
            show("Đổi mật khẩu thành công ✓", true);
            document.getElementById("pf-curpw").value = "";
            document.getElementById("pf-newpw").value = "";
          } else show(j.error || "Đổi mật khẩu thất bại.");
        } catch (_) { show("Lỗi kết nối máy chủ."); }
      }

      async function doRegister() {
        const err = document.getElementById("register-error");
        const fullName = document.getElementById("reg-fullname").value.trim();
        const username = document.getElementById("reg-username").value.trim();
        const email    = document.getElementById("reg-email").value.trim();
        const phone    = document.getElementById("reg-phone").value.trim();
        const dob      = document.getElementById("reg-dob")?.value || "";     // yyyy-mm-dd
        const gender   = document.getElementById("reg-gender")?.value || "";
        const pw       = document.getElementById("reg-pw").value;
        const pw2      = document.getElementById("reg-pw2")?.value || "";

        function fail(msg) { err.style.display = "block"; err.textContent = msg; }

        if (!fullName)            return fail("Vui lòng nhập họ và tên.");
        if (username.length < 4)  return fail("Tên đăng nhập tối thiểu 4 ký tự.");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                                  return fail("Email không đúng định dạng.");
        if (pw.length < 6)        return fail("Mật khẩu tối thiểu 6 ký tự.");
        if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
                                  return fail("Mật khẩu phải gồm cả chữ và số.");
        if (pw !== pw2)           return fail("Xác nhận mật khẩu không khớp.");

        err.style.display = "none";
        const btn = document.querySelector("#register-modal .btn-modal-login");
        if (btn) { btn.disabled = true; btn.textContent = "Đang tạo tài khoản…"; }

        try {
          const res = await fetch(`${SMTP_SERVER}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ fullName, username, password: pw, email, phone, dateOfBirth: dob, gender }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) return fail(json.error || "Đăng ký thất bại!");

          // Đăng ký xong = đã đăng nhập luôn (Bệnh nhân)
          currentRole = "patient";
          currentUser = {
            email: json.email || email,
            name: json.fullName || fullName,
            username: json.username,
            id: json.id,
            role: json.role,
          };
          closeRegisterModal();
          applyRBAC();
          showToast(
            "Đăng ký thành công! 🎉",
            `Chào mừng ${currentUser.name} đến với MedCare!`,
            "✅",
          );
        } catch (e) {
          fail("⚠️ Không kết nối được server. Hãy chạy: dotnet run");
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Đăng ký"; }
        }
      }

      function roleLabel(r) {
        return (
          { patient: "Bệnh nhân", doctor: "Bác sĩ", admin: "Quản trị viên" }[
            r
          ] || r
        );
      }
      function roleIcon(r) {
        return { patient: "🙋", doctor: "👨‍⚕️", admin: "🛡️" }[r] || "👤";
      }

      function applyRBAC() {
        if (!currentRole) return;
        document.body.classList.remove(
          "role-patient",
          "role-doctor",
          "role-admin",
          "no-role",
        );
        document.body.classList.add("role-" + currentRole);
        // Show banner
        const banner = document.getElementById("role-banner");
        banner.className = "role-banner show role-" + currentRole;
        banner.classList.add("show");
        document.getElementById("rb-icon").textContent = roleIcon(currentRole);
        document.getElementById("rb-role-badge").textContent =
          roleLabel(currentRole);
        document.getElementById("rb-username").textContent =
          currentUser?.name || "Người dùng";
        if (currentRole === "doctor") {
          document.getElementById("rb-extra").textContent =
            "🩺 Có quyền lập bệnh án · Xem toàn bộ lịch hẹn";
        } else if (currentRole === "admin") {
          // Admin: hiện 2 link dẫn thẳng tới trang quản trị (MVC)
          const ex = document.getElementById("rb-extra");
          ex.style.opacity = "1";
          ex.innerHTML =
            '🛡️ ' +
            '<a href="/Home/AdminDashboard" ' +
            'style="color:#fff;font-weight:700;text-decoration:underline;margin:0 6px">' +
            '📊 Dashboard thống kê</a>' +
            '<a href="/Home/QuanLyTaiKhoan" ' +
            'style="color:#fff;font-weight:700;text-decoration:underline;margin:0 6px">' +
            '👥 Quản lý tài khoản</a>';
        } else {
          document.getElementById("rb-extra").textContent =
            "📋 Chỉ xem lịch khám của bạn";
        }
        // Shift nav
        document.getElementById("site-nav").classList.add("with-banner");
        // Show/hide doctor dashboard
        const dd = document.getElementById("doctor-dashboard");
        if (dd)
          dd.style.display =
            currentRole === "doctor" || currentRole === "admin"
              ? "block"
              : "none";
        // Show/hide patient dashboard
        const pd = document.getElementById("patient-dashboard");
        if (pd) {
          pd.style.display = currentRole === "patient" ? "block" : "none";
          const pdName = document.getElementById("pd-name-display");
          if (pdName)
            pdName.textContent = `${currentUser?.name || "Bệnh nhân"} · ${currentUser?.email || ""}`;
        }
        // Update login button
        const btnLogin = document.querySelector(".btn-login");
        if (btnLogin) {
          btnLogin.textContent =
            currentUser?.name?.split(" ")[0] || "Tài khoản";
          btnLogin.onclick = () =>
            showToast("Tài khoản", `Đang đăng nhập: ${currentUser?.email}`);
        }
        // Show EMR buttons for doctor
        document.querySelectorAll(".btn-emr,.btn-confirm-row").forEach((b) => {
          b.style.display =
            currentRole === "doctor" || currentRole === "admin"
              ? "inline-flex"
              : "none";
        });

        // ── MỞ KHÓA FORM ĐẶT LỊCH ──
        const lock = document.getElementById("form-lock-overlay");
        if (lock) lock.classList.add("hidden");

        // ── TẢI LỊCH SỬ CHAT ──
        loadChatHistory();
        // Nếu chatbot đang mở thì cập nhật banner
        if (chatOpen) {
          const hb = document.getElementById("cb-history-banner");
          if (chatHistory.length > 0) {
            hb.style.display = "flex";
            document.getElementById("cb-history-label").textContent =
              `${chatHistory.length} tin nhắn đã lưu · Bấm để xem`;
          }
        }

        // Pre-fill tên bệnh nhân trong form
        const afName = document.getElementById("af-name");
        if (afName && !afName.value && currentUser?.name)
          afName.value = currentUser.name;
        // Chrome đôi khi tự điền username (vd "bsnguyenvana") vào ô SĐT →
        // xoá nếu giá trị chứa chữ cái (số điện thoại chỉ gồm số).
        const afPhone = document.getElementById("af-phone");
        if (afPhone && /[a-zA-Z]/.test(afPhone.value)) afPhone.value = "";
      }

      function doLogout() {
        // Lưu lịch sử chat trước khi logout
        saveChatHistory();
        chatHistory = [];

        currentRole = null;
        currentUser = null;
        document.body.classList.remove(
          "role-patient",
          "role-doctor",
          "role-admin",
        );
        document.body.classList.add("no-role");
        document.getElementById("role-banner").classList.remove("show");
        document.getElementById("site-nav").classList.remove("with-banner");
        const dd = document.getElementById("doctor-dashboard");
        if (dd) dd.style.display = "none";
        const pdLogout = document.getElementById("patient-dashboard");
        if (pdLogout) pdLogout.style.display = "none";
        const btnLogin = document.querySelector(".btn-login");
        if (btnLogin) {
          btnLogin.textContent = "Đăng nhập";
          btnLogin.onclick = openLoginModal;
        }

        // ── KHÓA LẠI FORM ĐẶT LỊCH ──
        const lock = document.getElementById("form-lock-overlay");
        if (lock) lock.classList.remove("hidden");

        // ── RESET CHATBOT ──
        const msgs = document.getElementById("cb-messages");
        if (msgs) msgs.innerHTML = "";
        document.getElementById("cb-suggestions").innerHTML = "";
        const hb = document.getElementById("cb-history-banner");
        if (hb) hb.style.display = "none";
        if (chatOpen) {
          chatOpen = false;
          document.getElementById("chatbot-panel").classList.remove("open");
        }

        showToast(
          "Đã đăng xuất",
          "Lịch sử chat đã được lưu lại. Hẹn gặp lại! 👋",
          "👋",
        );
      }

      // ── Login Modal ──
      function openLoginModal() {
        document.getElementById("login-modal").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("login-email").focus(), 350);
      }
      function closeLoginModal() {
        document.getElementById("login-modal").classList.remove("open");
        document.body.style.overflow = "";
        document.getElementById("modal-error").style.display = "none";
      }
      function handleModalOverlayClick(e) {
        if (e.target === document.getElementById("login-modal"))
          closeLoginModal();
      }
      function togglePw() {
        const inp = document.getElementById("login-pw");
        const eye = document.getElementById("pw-eye");
        inp.type = inp.type === "password" ? "text" : "password";
        eye.textContent = inp.type === "password" ? "👁" : "🙈";
      }
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          closeLoginModal();
          closeSchedModal();
          closeEmailModal();
          closeEmrModal();
          closeQrModal();
        }
      });

      // ════════════════════════════════════
      // AI TRIAGE — THẬT (Anthropic API)
      // ════════════════════════════════════
      let lastTriageResult = null;

      async function aiSuggest() {
        const btn = document.getElementById("ai-btn");
        const sym = document.getElementById("af-symptom").value.trim();
        const res = document.getElementById("ai-result");
        if (!sym) {
          showToast(
            "Chưa nhập triệu chứng",
            "Vui lòng mô tả triệu chứng để AI phân tích.",
            "⚠️",
          );
          return;
        }
        const orig = btn.innerHTML;
        btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;display:inline-block"></span> AI đang phân tích…</span>`;
        btn.disabled = true;
        res.style.display = "none";

        try {
          const response = await fetch(
            `${SMTP_SERVER}/api/chat/proxy`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1000,
                system: `Bạn là AI y tế của phòng khám MedCare. Phân tích triệu chứng bệnh nhân và trả về JSON THUẦN TÚY (không markdown, không backtick).
Format bắt buộc:
{
  "urgency": "EMERGENCY" | "HIGH" | "MEDIUM" | "LOW",
  "urgencyVi": "Nguy hiểm - Cấp cứu ngay" | "Khẩn cấp - Ưu tiên cao" | "Trung bình - Cần khám sớm" | "Thông thường - Đặt lịch bình thường",
  "specialty": "TimMach" | "TieuHoa" | "CXK" | "ThanKinh" | "HoHap" | "DaKhoa",
  "specialtyName": "tên chuyên khoa tiếng Việt",
  "specialtyEmoji": "emoji phù hợp",
  "doctorId": "1" | "2" | "3",
  "doctorName": "tên bác sĩ",
  "analysis": "phân tích ngắn gọn 1-2 câu bằng tiếng Việt",
  "warning": "cảnh báo nếu có, để trống nếu không",
  "emergencyAlert": true | false,
  "waitTime": "ước tính thời gian chờ: Ưu tiên ngay | 15-30 phút | 30-60 phút | 1-2 giờ"
}
Chuyên khoa map: TimMach→BS. TimMach (id:3), TieuHoa→BS. TieuHoa (id:2), CXK/ThanKinh/HoHap/DaKhoa→BS. Mặc Định (id:1)
EMERGENCY khi: khó thở dữ dội, đau ngực lan vai/tay, ngất, xuất huyết nặng, tai biến, đột quỵ.`,
                messages: [{ role: "user", content: `Triệu chứng: "${sym}"` }],
              }),
            },
          );
          const data = await response.json();
          const text = data.content?.map((i) => i.text || "").join("") || "";
          let parsed;
          try {
            parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          } catch (e) {
            throw new Error("Không parse được JSON từ AI");
          }
          lastTriageResult = parsed;

          // Apply results to form
          if (document.getElementById("af-specialty")) {
            document.getElementById("af-specialty").value =
              parsed.specialty || "DaKhoa";
          }
          if (document.getElementById("af-doctor")) {
            document.getElementById("af-doctor").value = parsed.doctorId || "1";
          }

          // Show emergency alert if needed
          if (parsed.emergencyAlert || parsed.urgency === "EMERGENCY") {
            showEmergencyAlert(parsed);
          }

          // Show triage result card
          const urgencyColors = {
            EMERGENCY: {
              bg: "#fef2f2",
              border: "#fca5a5",
              color: "#991b1b",
              badge: "#ef4444",
            },
            HIGH: {
              bg: "#fff7ed",
              border: "#fed7aa",
              color: "#92400e",
              badge: "#f97316",
            },
            MEDIUM: {
              bg: "#fffbeb",
              border: "#fde68a",
              color: "#78350f",
              badge: "#f59e0b",
            },
            LOW: {
              bg: "#f0fdf4",
              border: "#a7f3d0",
              color: "#065f46",
              badge: "#10b981",
            },
          };
          const uc = urgencyColors[parsed.urgency] || urgencyColors.LOW;

          res.innerHTML = `
            <div style="background:${uc.bg};border:1.5px solid ${uc.border};border-radius:12px;padding:14px 16px;margin-top:0">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                <div style="background:${uc.badge};color:white;padding:3px 10px;border-radius:100px;font-size:11.5px;font-weight:700;letter-spacing:.3px">${parsed.urgencyVi}</div>
                <div style="font-size:13px;font-weight:700;color:${uc.color}">${parsed.specialtyEmoji} ${parsed.specialtyName}</div>
              </div>
              <div style="font-size:13px;color:#374151;line-height:1.55;margin-bottom:8px">🤖 <b>AI phân tích:</b> ${parsed.analysis}</div>
              ${parsed.warning ? `<div style="font-size:12.5px;color:${uc.color};font-weight:600;margin-bottom:8px">⚠️ ${parsed.warning}</div>` : ""}
              <div style="display:flex;align-items:center;gap:16px;font-size:12px;color:var(--muted)">
                <span>👨‍⚕️ ${parsed.doctorName}</span>
                <span>⏱ ${parsed.waitTime}</span>
                <button onclick="openMultiStepBooking()" style="margin-left:auto;padding:5px 14px;background:var(--blue);color:white;border:none;border-radius:7px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:'Be Vietnam Pro',sans-serif">Đặt lịch ngay →</button>
              </div>
            </div>`;
          res.style.display = "block";
          btn.innerHTML = orig;
          btn.disabled = false;

          const doctorBusy = parsed.doctorId === "3";
          if (doctorBusy && parsed.urgency !== "EMERGENCY") {
            setTimeout(() => openSchedModal(), 800);
          } else if (parsed.urgency !== "EMERGENCY") {
            showToast(
              "✨ AI Triage hoàn tất!",
              `Đề xuất: ${parsed.specialtyName} · ${parsed.waitTime}`,
              "🤖",
            );
          }
        } catch (err) {
          btn.innerHTML = orig;
          btn.disabled = false;
          // Fallback to keyword matching
          aiFallback(sym, res);
        }
      }

      function aiFallback(sym, res) {
        const lower = sym.toLowerCase();
        let spec = "DaKhoa",
          specName = "Đa Khoa",
          docId = "1",
          ico = "🏥",
          warn = "Chưa rõ chuyên khoa, đề nghị khám tổng quát";
        if (/(ngực|tim|thở|huyết áp|khó thở|hồi hộp|nhịp tim)/.test(lower)) {
          spec = "TimMach";
          specName = "Nội Tim Mạch";
          docId = "3";
          ico = "❤️";
          warn = "Triệu chứng liên quan tim mạch";
        } else if (
          /(bụng|dạ dày|tiêu hóa|buồn nôn|tiêu chảy|táo bón)/.test(lower)
        ) {
          spec = "TieuHoa";
          specName = "Nội Tiêu Hóa";
          docId = "2";
          ico = "🫁";
          warn = "Có dấu hiệu rối loạn tiêu hóa";
        } else if (/(xương|khớp|lưng|cổ|vai|tê|nhức)/.test(lower)) {
          spec = "CXK";
          specName = "Cơ Xương Khớp";
          docId = "1";
          ico = "🦴";
          warn = "Liên quan hệ cơ xương khớp";
        }
        if (document.getElementById("af-specialty"))
          document.getElementById("af-specialty").value = spec;
        if (document.getElementById("af-doctor"))
          document.getElementById("af-doctor").value = docId;
        res.innerHTML = `<div style="background:#f0fdf4;border:1.5px solid #a7f3d0;border-radius:10px;padding:12px;font-size:13px">${ico} <b>Gợi ý:</b> ${warn} → Chuyên khoa <b>${specName}</b></div>`;
        res.style.display = "block";
        showToast(
          "Phân tích hoàn tất",
          `Đề xuất chuyên khoa: ${specName}`,
          ico,
        );
      }

      // ════════════════════════════════════
      // EMERGENCY ALERT MODAL
      // ════════════════════════════════════
      function showEmergencyAlert(parsed) {
        const modal = document.getElementById("emergency-alert-modal");
        if (!modal) return;
        modal.classList.add("open");
        document.getElementById("em-analysis").textContent =
          parsed?.analysis || "";
      }
      function closeEmergencyAlert() {
        document
          .getElementById("emergency-alert-modal")
          ?.classList.remove("open");
      }

      // ════════════════════════════════════
      // MULTI-STEP BOOKING MODAL
      // ════════════════════════════════════
      let bookStep = 1;
      const TOTAL_BOOK_STEPS = 5;

      function openMultiStepBooking() {
        bookStep = 1;
        // Reset form
        const nameEl = document.getElementById("ms-patient-name");
        if (nameEl && !nameEl.value && currentUser?.name)
          nameEl.value = currentUser.name;
        // Reset specialty selection visual
        document.querySelectorAll("[name=ms-spec-r]").forEach((r) => {
          r.checked = false;
          r.closest("label").style.borderColor = "var(--border)";
          r.closest("label").style.background = "";
        });
        document.querySelectorAll("[name=ms-doc-r]").forEach((r) => {
          r.checked = false;
          r.closest("label").style.borderColor = "var(--border)";
          r.closest("label").style.background = "";
        });
        const specValEl = document.getElementById("ms-specialty-value");
        if (specValEl) specValEl.value = "";
        const triageEl = document.getElementById("ms-triage-result");
        if (triageEl) {
          triageEl.style.display = "none";
          triageEl.innerHTML = "";
        }
        renderBookStep();
        document.getElementById("multistep-modal")?.classList.add("open");
        document.body.style.overflow = "hidden";
        // Pre-fill symptom from hero search if any
        const heroVal = document.getElementById("hero-search-input")?.value;
        if (heroVal) {
          const msSymEl = document.getElementById("ms-symptom");
          if (msSymEl && !msSymEl.value) msSymEl.value = heroVal;
        }
      }
      function closeMultiStepBooking() {
        document.getElementById("multistep-modal")?.classList.remove("open");
        document.body.style.overflow = "";
      }
      function renderBookStep() {
        document.querySelectorAll(".ms-step-panel").forEach((p, i) => {
          p.style.display = i + 1 === bookStep ? "block" : "none";
        });
        document.querySelectorAll(".ms-step-dot").forEach((d, i) => {
          d.classList.toggle("active", i + 1 <= bookStep);
          d.classList.toggle("current", i + 1 === bookStep);
        });
        document.getElementById("ms-progress-bar").style.width =
          ((bookStep - 1) / (TOTAL_BOOK_STEPS - 1)) * 100 + "%";
        document.getElementById("ms-step-label").textContent =
          `Bước ${bookStep}/${TOTAL_BOOK_STEPS}`;
        document.getElementById("ms-btn-prev").style.visibility =
          bookStep > 1 ? "visible" : "hidden";
        const nextBtn = document.getElementById("ms-btn-next");
        if (bookStep === TOTAL_BOOK_STEPS) {
          nextBtn.textContent = "✓ Xác nhận đặt lịch";
          nextBtn.style.background = "var(--teal)";
        } else {
          nextBtn.textContent = "Tiếp theo →";
          nextBtn.style.background = "var(--blue)";
        }
      }
      async function msNext() {
        if (bookStep === 1) {
          // Validate step 1
          const name = document.getElementById("ms-patient-name")?.value.trim();
          const symptom = document.getElementById("ms-symptom")?.value.trim();
          if (!name) {
            showToast("Thiếu thông tin", "Vui lòng nhập họ và tên.", "⚠️");
            return;
          }
          if (!symptom) {
            showToast(
              "Thiếu triệu chứng",
              "Vui lòng mô tả triệu chứng của bạn.",
              "⚠️",
            );
            return;
          }
          // Pre-fill name in booking form if exists
          const afName = document.getElementById("af-name");
          if (afName && !afName.value) afName.value = name;
          bookStep++;
          renderBookStep();
          // Run AI triage for step 2
          await runMsAiTriage(symptom);
        } else if (bookStep === 2) {
          const specVal = document.getElementById("ms-specialty-value")?.value;
          if (!specVal) {
            showToast(
              "Chưa chọn chuyên khoa",
              "Vui lòng chọn chuyên khoa.",
              "⚠️",
            );
            return;
          }
          bookStep++;
          renderBookStep();
        } else if (bookStep === 3) {
          const docSelected = document.querySelector("[name=ms-doc-r]:checked");
          if (!docSelected) {
            showToast("Chưa chọn bác sĩ", "Vui lòng chọn bác sĩ khám.", "⚠️");
            return;
          }
          bookStep++;
          renderBookStep();
          buildTimeslots();
        } else if (bookStep === 4) {
          const date = document.getElementById("ms-date")?.value;
          const time =
            document.querySelector(".ts-slot.selected")?.dataset.time;
          if (!date) {
            showToast("Chưa chọn ngày", "Vui lòng chọn ngày khám.", "⚠️");
            return;
          }
          if (!time) {
            showToast("Chưa chọn giờ", "Vui lòng chọn khung giờ khám.", "⚠️");
            return;
          }
          bookStep++;
          renderBookStep();
          buildBookingSummary();
        } else if (bookStep < TOTAL_BOOK_STEPS) {
          bookStep++;
          renderBookStep();
        } else {
          // Final confirm
          closeMultiStepBooking();
          const name =
            document.getElementById("ms-patient-name")?.value ||
            currentUser?.name ||
            "Bệnh nhân";
          const specVal =
            document.getElementById("ms-specialty-value")?.value || "DaKhoa";
          const specNames = {
            TimMach: "Nội Tim Mạch",
            TieuHoa: "Nội Tiêu Hóa",
            CXK: "Cơ Xương Khớp",
            ThanKinh: "Thần Kinh",
            HoHap: "Hô Hấp",
            DaKhoa: "Đa Khoa",
          };
          const spec = specNames[specVal] || "Đa Khoa";
          const date =
            document.getElementById("ms-date")?.value ||
            new Date().toLocaleDateString("vi-VN");
          const time =
            document.querySelector(".ts-slot.selected")?.dataset.time ||
            "09:00";
          showToast(
            "✅ Đặt lịch thành công!",
            `${name} · ${spec} · ${date} ${time}`,
            "📅",
          );
          setTimeout(
            () =>
              openEmailInputModal({
                patientName: name,
                date,
                time,
                doctor: lastTriageResult?.doctorName || "BS. MedCare",
                spec,
                amount: 200000,
              }),
            1200,
          );
        }
      }

      async function runMsAiTriage(symptom) {
        const triageEl = document.getElementById("ms-triage-result");
        if (!triageEl) return;
        triageEl.style.display = "block";
        triageEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;display:inline-block"></span> AI đang phân tích triệu chứng…</span>`;
        try {
          const response = await fetch(
            `${SMTP_SERVER}/api/chat/proxy`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 500,
                system: `Phân tích triệu chứng và trả JSON thuần (không markdown): {"urgency":"LOW"|"MEDIUM"|"HIGH"|"EMERGENCY","specialty":"TimMach"|"TieuHoa"|"CXK"|"ThanKinh"|"HoHap"|"DaKhoa","specialtyName":"tên tiếng Việt","advice":"1 câu ngắn","emergencyAlert":true|false}`,
                messages: [
                  { role: "user", content: `Triệu chứng: ${symptom}` },
                ],
              }),
            },
          );
          const data = await response.json();
          const text = data.content?.map((i) => i.text || "").join("") || "";
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          lastTriageResult = { ...lastTriageResult, ...parsed };
          // Auto-select recommended specialty
          if (parsed.specialty) {
            const radio = document.getElementById(
              `ms-spec-${parsed.specialty}`,
            );
            if (radio) {
              radio.click();
              document.getElementById("ms-specialty-value").value =
                parsed.specialty;
              const opt = document.querySelector(
                `#ms-specialty option[value="${parsed.specialty}"]`,
              );
              if (opt) opt.selected = true;
            }
          }
          if (parsed.emergencyAlert || parsed.urgency === "EMERGENCY") {
            showEmergencyAlert(parsed);
          }
          const urgColors = {
            EMERGENCY: "#ef4444",
            HIGH: "#f97316",
            MEDIUM: "#f59e0b",
            LOW: "#10b981",
          };
          const badge = {
            EMERGENCY: "🚨 Cấp cứu ngay",
            HIGH: "⚠️ Ưu tiên cao",
            MEDIUM: "📋 Khám sớm",
            LOW: "✅ Bình thường",
          };
          triageEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="background:${urgColors[parsed.urgency] || "#10b981"};color:white;padding:2px 9px;border-radius:100px;font-size:11px;font-weight:700">${badge[parsed.urgency] || "✅"}</span><b style="font-size:13px">AI đề xuất: ${parsed.specialtyName}</b></div><div style="font-size:12.5px;color:#374151">${parsed.advice}</div>`;
        } catch (e) {
          triageEl.innerHTML = `<span style="font-size:13px">✨ Chọn chuyên khoa phù hợp với triệu chứng của bạn bên dưới.</span>`;
        }
      }
      function msPrev() {
        if (bookStep > 1) {
          bookStep--;
          renderBookStep();
        }
      }
      function buildTimeslots() {
        const container = document.getElementById("ms-timeslots");
        if (!container) return;
        const slots = [
          "07:30",
          "08:00",
          "08:30",
          "09:00",
          "09:30",
          "10:00",
          "10:30",
          "11:00",
          "14:00",
          "14:30",
          "15:00",
          "15:30",
          "16:00",
          "16:30",
          "17:00",
        ];
        const busy = ["08:00", "10:30", "14:00", "15:30"];
        container.innerHTML = slots
          .map((t) => {
            const isBusy = busy.includes(t);
            return `<div class="ts-slot ${isBusy ? "busy" : ""}" data-time="${t}" onclick="${isBusy ? "" : "selectSlotMs(this)"}">${t}${isBusy ? "<span>Hết</span>" : ""}</div>`;
          })
          .join("");
      }
      function selectSlotMs(el) {
        document
          .querySelectorAll(".ts-slot")
          .forEach((s) => s.classList.remove("selected"));
        el.classList.add("selected");
      }
      function buildBookingSummary() {
        const el = document.getElementById("ms-summary");
        if (!el) return;
        const name =
          document.getElementById("ms-patient-name")?.value ||
          currentUser?.name ||
          "—";
        const phone = document.getElementById("ms-phone")?.value || "—";
        const specVal =
          document.getElementById("ms-specialty-value")?.value || "";
        const specNames = {
          TimMach: "Nội Tim Mạch",
          TieuHoa: "Nội Tiêu Hóa",
          CXK: "Cơ Xương Khớp",
          ThanKinh: "Thần Kinh",
          HoHap: "Hô Hấp",
          DaKhoa: "Đa Khoa",
        };
        const spec = specNames[specVal] || "Đa Khoa";
        const date = document.getElementById("ms-date")?.value || "—";
        const time =
          document.querySelector(".ts-slot.selected")?.dataset.time || "—";
        // Get selected doctor name
        const selectedDocRadio = document.querySelector(
          "[name=ms-doc-r]:checked",
        );
        const docLabels = {
          "doc-1": "BS. Nguyễn Thanh Tùng",
          "doc-2": "BS. Lê Thị Hương",
          "doc-3": "BS. Phạm Văn Dũng",
        };
        const doctor =
          (selectedDocRadio ? docLabels[selectedDocRadio.value] : null) ||
          lastTriageResult?.doctorName ||
          "BS. MedCare";
        const symptom = document.getElementById("ms-symptom")?.value || "";
        el.innerHTML = `
          <div style="background:var(--blue-l);border-radius:12px;padding:16px;border:1px solid var(--border)">
            <div style="font-size:14px;font-weight:800;color:var(--txt);margin-bottom:12px">📋 Xác nhận thông tin</div>
            <div style="display:grid;gap:8px;font-size:13.5px">
              <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Bệnh nhân</span><b>${name}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Điện thoại</span><b>${phone}</b></div>
              ${symptom ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Triệu chứng</span><b style="max-width:200px;text-align:right;font-size:12.5px">${symptom.slice(0, 60)}${symptom.length > 60 ? "…" : ""}</b></div>` : ""}
              <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Chuyên khoa</span><b>${spec}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Bác sĩ</span><b>${doctor}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Ngày khám</span><b>${date}</b></div>
              <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Giờ khám</span><b>${time}</b></div>
              <div style="border-top:1px solid var(--border);padding-top:8px;display:flex;justify-content:space-between"><span style="color:var(--muted)">Phí khám</span><b style="color:var(--blue)">200.000đ</b></div>
            </div>
          </div>`;
      }

      // ════════════════════════════════════
      // AI SCHEDULING AGENT
      // ════════════════════════════════════
      function openSchedModal() {
        document.getElementById("sched-modal").classList.add("open");
        document.getElementById("sched-scanning").style.display = "block";
        document.getElementById("sched-results").style.display = "none";
        // Simulate AI scanning
        setTimeout(() => {
          document.getElementById("sched-scanning").style.display = "none";
          document.getElementById("sched-results").style.display = "block";
        }, 2200);
      }
      function closeSchedModal() {
        document.getElementById("sched-modal").classList.remove("open");
      }
      function selectSlot(el, idx) {
        selectedSchedSlot = idx;
        document
          .querySelectorAll(".sched-slot")
          .forEach((s) => s.classList.remove("selected"));
        el.classList.add("selected");
      }
      function confirmSchedule() {
        const slots = [
          "16/05/2026 · 09:00–10:00",
          "17/05/2026 · 14:00–15:00",
          "19/05/2026 · 08:00–09:00",
        ];
        const docs = ["BS. Mặc Định", "BS. TimMach", "BS. TieuHoa"];
        closeSchedModal();
        // Update form
        const slot = slots[selectedSchedSlot].split(" · ");
        showToast(
          "Lịch đã được cập nhật!",
          `AI Agent đã chọn: ${slots[selectedSchedSlot]}`,
          "🤖",
        );
        // Trigger email notification
        setTimeout(
          () =>
            openEmailInputModal({
              patientName:
                document.getElementById("af-name").value || "Bệnh nhân",
              date: slots[selectedSchedSlot].split(" · ")[0],
              time: slots[selectedSchedSlot].split(" · ")[1],
              doctor: docs[selectedSchedSlot],
              spec: document.getElementById("af-specialty").value || "Đa Khoa",
              amount: 200000,
            }),
          1200,
        );
      }

      // ════════════════════════════════════
      // EMAIL NOTIFICATION (Deep Link)
      // ════════════════════════════════════
      function generateToken() {
        return (
          "MC-2026-" + Math.random().toString(36).substr(2, 8).toUpperCase()
        );
      }
      function openEmailModal(data) {
        data = data || {
          patientName:
            document.getElementById("af-name")?.value || "Nguyễn Văn A",
          date: document.getElementById("af-date")?.value || "16/05/2026",
          time: document.getElementById("af-time")?.value || "09:00 – 10:00",
          doctor: "BS. Mặc Định",
          spec: "Đa Khoa",
          amount: 200000,
        };
        document.getElementById("email-subject").textContent =
          "✅ Xác nhận lịch khám · MedCare";
        document.getElementById("email-patient-name").textContent =
          data.patientName;
        document.getElementById("email-date-val").textContent = data.date;
        document.getElementById("email-time-val").textContent = data.time;
        document.getElementById("email-doctor-val").textContent = data.doctor;
        document.getElementById("email-spec-val").textContent = data.spec;
        document.getElementById("email-timestamp").textContent =
          new Date().toLocaleString("vi-VN");
        document.getElementById("email-token-val").textContent =
          generateToken();
        // VietQR
        const amount = data.amount || 200000;
        const addInfo = `MEDCARE KHAM ${Math.floor(Math.random() * 999 + 1)
          .toString()
          .padStart(3, "0")}`;
        document.getElementById("qr-content").textContent = addInfo;
        const qrUrl = buildVietQrUrl(amount, addInfo);
        document.getElementById("email-qr").src = qrUrl;
        document.getElementById("email-modal").classList.add("open");
      }
      function closeEmailModal() {
        document.getElementById("email-modal").classList.remove("open");
      }
      function handleEmailConfirm(action) {
        closeEmailModal();
        if (action === "accept") {
          showToast(
            "✅ Lịch hẹn đã xác nhận!",
            "Hệ thống cập nhật Database. Bệnh nhân sẽ nhận SMS xác nhận.",
            "✅",
          );
        } else {
          showToast(
            "❌ Từ chối lịch hẹn",
            "AI Agent đang tìm khung giờ thay thế…",
            "🤖",
          );
          setTimeout(() => openSchedModal(), 1500);
        }
      }

      // ════════════════════════════════════
      // VietQR
      // ════════════════════════════════════
      function openQrModal(amount, note) {
        amount = amount || 200000;
        note =
          note ||
          "MEDCARE KHAM " +
            Math.floor(Math.random() * 999 + 1)
              .toString()
              .padStart(3, "0");
        document.getElementById("qr-amount").textContent =
          amount.toLocaleString("vi-VN") + "đ";
        document.getElementById("qr-content").textContent = note;
        const url = buildVietQrUrl(amount, note);
        document.getElementById("qr-img").src = url;
        document.getElementById("qr-modal").classList.add("open");
      }
      function closeQrModal() {
        document.getElementById("qr-modal").classList.remove("open");
      }
      function copyQrInfo() {
        const txt = `MB Bank · ${BANK_ACC} · ${BANK_OWNER} · ${document.getElementById("qr-content").textContent} · ${document.getElementById("qr-amount").textContent}`;
        navigator.clipboard
          .writeText(txt)
          .then(() =>
            showToast(
              "Đã sao chép!",
              "Thông tin chuyển khoản đã vào clipboard.",
              "📋",
            ),
          );
      }

      // ════════════════════════════════════
      // EMR (Electronic Medical Records)
      // ════════════════════════════════════
      async function openEmrModal(apptId, patientName, apptInfo, patientId) {
        document.getElementById("emr-patient-name").textContent = patientName || "Bệnh nhân";
        document.getElementById("emr-appt-info").textContent    = apptInfo   || "";
        document.getElementById("emr-modal").classList.add("open");
        document.body.style.overflow = "hidden";

        // Tự tính giá thật ngay khi mở (thay cho con số 200k mặc định)
        setTimeout(() => { try { emrAutoPrice(); } catch (_) {} }, 200);

        // Reset brief panel
        document.getElementById("emr-brief-loading").style.display = "";
        document.getElementById("emr-brief-text").style.display    = "none";
        document.getElementById("emr-brief-warn").style.display    = "none";
        document.getElementById("emr-ai-brief").style.display      = "";

        if (!patientId) {
          document.getElementById("emr-brief-loading").style.display = "none";
          document.getElementById("emr-brief-warn").style.display    = "";
          document.getElementById("emr-brief-warn-msg").textContent  = "Không có mã bệnh nhân — không thể tải tóm tắt.";
          return;
        }

        try {
          const res  = await fetch(`${SMTP_SERVER}/api/ai-brief/${patientId}`, { credentials: "include" });
          const data = await res.json();
          document.getElementById("emr-brief-loading").style.display = "none";

          if (data.success && data.brief) {
            const el = document.getElementById("emr-brief-text");
            el.textContent    = data.brief;
            el.style.display  = "";
          } else {
            document.getElementById("emr-brief-warn").style.display   = "";
            document.getElementById("emr-brief-warn-msg").textContent = data.warning || "Không thể tải tóm tắt.";
          }
        } catch {
          document.getElementById("emr-brief-loading").style.display = "none";
          document.getElementById("emr-brief-warn").style.display    = "";
          document.getElementById("emr-brief-warn-msg").textContent  = "Lỗi kết nối — không thể tải tóm tắt AI.";
        }
      }
      function closeEmrModal() {
        document.getElementById("emr-modal").classList.remove("open");
        document.body.style.overflow = "";
      }
      function addDrugRow() {
        drugRowCount++;
        const tbody = document.getElementById("drug-tbody");
        const tr = document.createElement("tr");
        tr.innerHTML = `<td style="color:var(--muted);font-weight:600">${drugRowCount}</td>
    <td><input class="emr-drug-input" placeholder="Tên thuốc…"></td>
    <td><input class="emr-drug-input" placeholder="Liều…"></td>
    <td><input class="emr-drug-input" placeholder="Cách dùng…"></td>
    <td><input class="emr-drug-input" type="number" placeholder="7" style="width:60px"></td>`;
        tbody.appendChild(tr);
      }
      function calcTotal() {
        const f1 = parseInt(document.getElementById("emr-fee1").value) || 0;
        const f2 = parseInt(document.getElementById("emr-fee2").value) || 0;
        const f3 = parseInt(document.getElementById("emr-fee3").value) || 0;
        document.getElementById("emr-total").textContent =
          (f1 + f2 + f3).toLocaleString("vi-VN") + "đ";
      }

      // ── Tính giá tự động: phí khám theo chuyên khoa + tiền thuốc theo đơn ──
      async function emrAutoPrice() {
        // Đọc các dòng thuốc từ bảng EMR (cột 1 = tên, cột 5 = số ngày)
        const rows = document.querySelectorAll("#drug-tbody tr");
        const drugs = [];
        rows.forEach((tr) => {
          const inputs = tr.querySelectorAll(".emr-drug-input");
          if (inputs.length >= 4) {
            const name = inputs[0].value.trim();
            const days = parseInt(inputs[3].value) || 0;
            if (name) drugs.push({ name, days });
          }
        });

        const specialty = document.getElementById("emr-spec").value;
        try {
          const res = await fetch(`${SMTP_SERVER}/api/pricing/estimate`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ specialty, drugs }),
          });
          const data = await res.json();
          if (!data.success) throw new Error("lỗi");

          // Điền phí khám + tiền thuốc, tính lại tổng
          document.getElementById("emr-fee1").value = data.examFee;
          document.getElementById("emr-fee2").value = data.drugTotal;
          calcTotal();

          // Hiển thị chi tiết từng khoản thuốc
          const bd = document.getElementById("emr-drug-breakdown");
          if (data.drugs.length) {
            bd.innerHTML =
              `<div style="font-weight:700;margin-bottom:6px">📋 Chi tiết tiền thuốc</div>` +
              data.drugs
                .map(
                  (d) =>
                    `<div style="display:flex;justify-content:space-between;padding:2px 0">
                       <span>${escapeHtml(d.name)} · ${d.unitPrice.toLocaleString("vi-VN")}đ × ${d.quantity}</span>
                       <b>${d.lineTotal.toLocaleString("vi-VN")}đ</b>
                     </div>`
                )
                .join("") +
              `<div style="border-top:1px solid rgba(16,87,164,.2);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between">
                 <span>Phí khám (${specialty})</span><b>${data.examFee.toLocaleString("vi-VN")}đ</b>
               </div>`;
            bd.style.display = "block";
          } else {
            bd.innerHTML = `Chưa có thuốc trong đơn — chỉ tính phí khám ${data.examFee.toLocaleString("vi-VN")}đ.`;
            bd.style.display = "block";
          }
        } catch {
          showToast?.("Lỗi tính giá", "Không thể tính giá tự động. Vui lòng thử lại.", "⚠️");
        }
      }
      function generatePdfAndQr() {
        const total =
          (parseInt(document.getElementById("emr-fee1").value) || 0) +
          (parseInt(document.getElementById("emr-fee2").value) || 0) +
          (parseInt(document.getElementById("emr-fee3").value) || 0);
        showToast(
          "📄 PDF đang tạo…",
          "QuestPDF đang vẽ bệnh án. Tự động tải về trong 3 giây.",
          "📄",
        );
        setTimeout(() => {
          closeEmrModal();
          openQrModal(
            total,
            "MEDCARE KHAM " +
              Math.floor(Math.random() * 999 + 1)
                .toString()
                .padStart(3, "0"),
          );
        }, 1800);
      }
      function saveEmr() {
        const diagnosis = document.getElementById("emr-diagnosis").value;
        if (!diagnosis) {
          showToast(
            "Chưa nhập chẩn đoán",
            "Vui lòng điền chẩn đoán trước khi lưu.",
            "⚠️",
          );
          return;
        }
        const total =
          (parseInt(document.getElementById("emr-fee1").value) || 0) +
          (parseInt(document.getElementById("emr-fee2").value) || 0) +
          (parseInt(document.getElementById("emr-fee3").value) || 0);
        closeEmrModal();
        showToast(
          "💾 Đã lưu bệnh án!",
          "Email + VietQR đang gửi đến bệnh nhân…",
          "✅",
        );
        setTimeout(
          () =>
            openEmailInputModal({
              patientName:
                document.getElementById("emr-patient-name")?.textContent ||
                "Bệnh nhân",
              date: "16/05/2026",
              time: "09:00 – 10:00",
              doctor: "BS. Mặc Định",
              spec: "Đa Khoa",
              amount: total,
            }),
          1500,
        );
      }

      // ════════════════════════════════════
      // CHATBOT AI WIDGET
      // ════════════════════════════════════
      let chatOpen = false;
      const cbKnowledge = {
        greet: ["xin chào", "hello", "hi", "chào", "helo"],
        emergency: [
          "cấp cứu",
          "khẩn cấp",
          "nguy kịch",
          "không thở",
          "bất tỉnh",
          "tai nạn",
        ],
        heart: [
          "đau ngực",
          "tức ngực",
          "khó thở",
          "hồi hộp",
          "đau tim",
          "nhịp tim",
          "tăng huyết áp",
        ],
        digestion: [
          "đau bụng",
          "buồn nôn",
          "tiêu chảy",
          "dạ dày",
          "nôn",
          "táo bón",
        ],
        bone: [
          "đau lưng",
          "đau khớp",
          "tê tay",
          "nhức xương",
          "đau cổ",
          "đau vai",
        ],
        booking: [
          "đặt lịch",
          "lịch khám",
          "hẹn khám",
          "book",
          "đặt hẹn",
          "muốn khám",
        ],
        hours: [
          "giờ làm",
          "mấy giờ",
          "lịch làm việc",
          "khi nào mở",
          "giờ khám",
        ],
        price: ["giá", "phí", "tiền", "bao nhiêu", "chi phí"],
        followup: [
          "tái khám",
          "khám lại",
          "theo dõi",
          "kiểm tra lại",
          "hẹn lại",
        ],
      };
      const cbResponses = {
        greet: {
          text: "Xin chào! Mình là MedBot AI 🤖, trợ lý ảo của MedCare. Bạn đang có triệu chứng gì hoặc cần hỗ trợ gì ạ?",
          suggestions: [
            "Đau ngực",
            "Đau bụng",
            "Đặt lịch khám",
            "Giờ làm việc",
          ],
        },
        emergency: {
          text: "🚨 **KHẨN CẤP!** Vui lòng gọi ngay **1900-1234** hoặc đến phòng cấp cứu. Phòng khám hoạt động 24/7!",
          alert: true,
          suggestions: ["Gọi cấp cứu", "Vị trí phòng khám"],
        },
        heart: {
          text: "💔 Triệu chứng tim mạch cần được thăm khám sớm! Tôi gợi ý bạn đến **Khoa Nội Tim Mạch** — BS. TimMach là chuyên gia hàng đầu. Muốn đặt lịch không?",
          specialty: "TimMach",
          suggestions: [
            "Đặt lịch ngay",
            "Triệu chứng nặng hơn",
            "Thêm thông tin",
          ],
        },
        digestion: {
          text: "🫁 Có vẻ liên quan tiêu hóa. Khoa **Nội Tiêu Hóa** — BS. TieuHoa sẽ giúp bạn. Bạn bị bao lâu rồi ạ?",
          specialty: "TieuHoa",
          suggestions: ["Đặt lịch khám", "1–2 ngày", "Lâu hơn 1 tuần"],
        },
        bone: {
          text: "🦴 Triệu chứng cơ xương khớp. Khoa **Cơ Xương Khớp** sẽ phù hợp. Bạn có muốn mình hỗ trợ đặt lịch?",
          specialty: "CXK",
          suggestions: ["Đặt lịch khám", "Hỏi thêm"],
        },
        booking: {
          text: "📅 Để đặt lịch, bạn cần **đăng nhập** vào hệ thống trước nhé!",
          needLogin: true,
          suggestions: ["Đăng nhập ngay", "Xem giờ làm việc"],
        },
        hours: {
          text: "🕐 Giờ làm việc:\n• Thứ 2–7: 07:00 – 20:00\n• Chủ nhật: 08:00 – 12:00\n• Cấp cứu: 24/7",
          suggestions: ["Đặt lịch khám", "Số điện thoại"],
        },
        price: {
          text: "💰 Phí khám tham khảo:\n• Khám thông thường: 100,000đ\n• Khám chuyên khoa: 150,000đ\n• Xét nghiệm: Tùy gói (từ 50,000đ)\n\nThanh toán qua VietQR tiện lợi!",
          suggestions: ["Đặt lịch", "Thanh toán VietQR"],
        },
        followup: {
          text: "📋 Tái khám đúng lịch rất quan trọng để theo dõi sức khỏe! Bạn muốn đặt lịch tái khám ngay không?",
          specialty: null,
          suggestions: ["Đặt lịch tái khám", "Xem hồ sơ bệnh án"],
        },
        default: {
          text: "Mình chưa hiểu rõ câu hỏi của bạn. Bạn có thể mô tả triệu chứng cụ thể hơn hoặc chọn một trong các gợi ý bên dưới nhé!",
          suggestions: ["Đau ngực", "Đau bụng", "Đặt lịch", "Giờ làm việc"],
        },
      };

      // ── Chat History (localStorage per user) ──
      const CHAT_HISTORY_KEY = "medcare_chat_";
      let chatHistory = []; // [{role:'bot'|'user', text, time}]

      function getChatKey() {
        return CHAT_HISTORY_KEY + (currentUser?.email || "guest");
      }
      function saveChatHistory() {
        try {
          // Keep last 60 messages
          const toSave = chatHistory.slice(-60);
          localStorage.setItem(getChatKey(), JSON.stringify(toSave));
        } catch (e) {}
      }
      function loadChatHistory() {
        try {
          const raw = localStorage.getItem(getChatKey());
          if (raw) chatHistory = JSON.parse(raw);
          else chatHistory = [];
        } catch (e) {
          chatHistory = [];
        }
      }
      function showChatHistory() {
        const msgs = document.getElementById("cb-messages");
        msgs.innerHTML = "";
        if (!chatHistory.length) {
          msgs.innerHTML =
            '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">Chưa có lịch sử trò chuyện.</div>';
          return;
        }
        chatHistory.forEach((m) => {
          const div = document.createElement("div");
          div.className = "cb-msg " + (m.role === "user" ? "user" : "bot");
          if (m.role === "user") {
            div.innerHTML = `<div class="cb-bubble">${m.text}</div>`;
          } else {
            div.innerHTML = `<div class="cb-msg-avatar">🤖</div><div><div class="cb-bubble">${m.text}</div><div style="font-size:10.5px;color:var(--hint);margin-top:3px;padding-left:2px">${m.time || ""}</div></div>`;
          }
          msgs.appendChild(div);
        });
        msgs.scrollTop = msgs.scrollHeight;
      }
      function getFollowupMsg() {
        // Phân tích lịch sử để tìm triệu chứng cũ → gợi ý tái khám
        if (!chatHistory.length) return null;
        const lastBot = [...chatHistory]
          .reverse()
          .find((m) => m.role === "bot");
        const daysSince = chatHistory[chatHistory.length - 1]
          ? Math.round(
              (Date.now() -
                new Date(
                  chatHistory[chatHistory.length - 1].ts || Date.now(),
                )) /
                (1000 * 60 * 60 * 24),
            )
          : 0;
        // Tìm specialty từ lịch sử
        const histText = chatHistory
          .map((m) => m.text)
          .join(" ")
          .toLowerCase();
        let spec = "",
          specName = "";
        if (histText.includes("tim mạch") || histText.includes("ngực")) {
          spec = "TimMach";
          specName = "Tim Mạch";
        } else if (histText.includes("tiêu hóa") || histText.includes("bụng")) {
          spec = "TieuHoa";
          specName = "Tiêu Hóa";
        } else if (
          histText.includes("xương khớp") ||
          histText.includes("lưng")
        ) {
          spec = "CXK";
          specName = "Cơ Xương Khớp";
        }
        if (daysSince >= 3 && spec) {
          return {
            text: `👋 Chào mừng ${currentUser?.name || "bạn"} quay lại! Lần trước bạn hỏi về triệu chứng **${specName}**. Sức khỏe của bạn dạo này thế nào? Bạn có muốn đặt lịch **tái khám** không?`,
            specialty: spec,
            suggestions: [
              "Tôi đỡ hơn rồi",
              "Vẫn còn triệu chứng",
              "Đặt lịch tái khám",
            ],
          };
        }
        if (chatHistory.length > 0) {
          return {
            text: `👋 Chào mừng ${currentUser?.name || "bạn"} trở lại! Mình vẫn còn nhớ cuộc trò chuyện trước. Hôm nay bạn cần hỗ trợ gì ạ?`,
            suggestions: [
              "Xem lịch sử chat",
              "Đặt lịch khám",
              "Triệu chứng mới",
            ],
          };
        }
        return null;
      }

      function toggleChatbot() {
        chatOpen = !chatOpen;
        document
          .getElementById("chatbot-panel")
          .classList.toggle("open", chatOpen);
        document.getElementById("fab-ping").style.display = "none";

        if (chatOpen) {
          const msgs = document.getElementById("cb-messages");
          const isEmpty = msgs.children.length === 0;

          // Update history banner
          const banner = document.getElementById("cb-history-banner");
          if (currentUser && chatHistory.length > 0) {
            banner.style.display = "flex";
            document.getElementById("cb-history-label").textContent =
              `${chatHistory.length} tin nhắn đã lưu · Bấm để xem`;
          } else {
            banner.style.display = "none";
          }

          if (isEmpty) {
            if (currentUser) {
              loadChatHistory();
              const followup = getFollowupMsg();
              if (followup && chatHistory.length > 0) {
                setTimeout(() => addBotMsg(followup), 400);
              } else {
                setTimeout(() => addBotMsg(cbResponses.greet), 400);
              }
            } else {
              setTimeout(
                () =>
                  addBotMsg({
                    text: "Xin chào! Mình là **MedBot AI** 🤖. Bạn có thể hỏi mình về triệu chứng, giờ khám, giá dịch vụ…\n\n💡 **Đăng nhập** để đặt lịch khám và lưu lịch sử trò chuyện!",
                    suggestions: [
                      "Đau ngực",
                      "Đau bụng",
                      "Giờ làm việc",
                      "Đăng nhập",
                    ],
                  }),
                400,
              );
            }
          }
        }
      }

      function addBotMsg(resp) {
        const msgs = document.getElementById("cb-messages");
        const typing = document.createElement("div");
        typing.className = "cb-msg bot";
        typing.innerHTML = `<div class="cb-msg-avatar">🤖</div><div class="cb-typing"><span></span><span></span><span></span></div>`;
        msgs.appendChild(typing);
        msgs.scrollTop = msgs.scrollHeight;
        setTimeout(() => {
          typing.remove();
          const div = document.createElement("div");
          div.className = "cb-msg bot";
          const txt = resp.text
            .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
            .replace(/\n/g, "<br>");
          const timeStr = new Date().toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          });

          // Build extra buttons
          let extra = "";
          if (resp.alert) {
            extra += `<div class="cb-alert-card"><b>☎️ Hotline cấp cứu: 1900-1234</b><br>Phòng cấp cứu 24/7 luôn sẵn sàng.<button class="cb-specialty-btn" onclick="window.location='tel:19001234'">📞 Gọi ngay</button></div>`;
          }
          if (resp.needLogin) {
            // Nếu đã đăng nhập rồi thì show nút đặt lịch, nếu chưa thì show nút login
            if (currentUser) {
              extra += `<button class="cb-specialty-btn" style="background:var(--teal);margin-top:6px" onclick="document.getElementById('ai-form').scrollIntoView({behavior:'smooth'});toggleChatbot()">📋 Đến form đặt lịch</button>`;
            } else {
              extra += `<div class="cb-login-nudge"><div style="font-size:13px;color:var(--blue);font-weight:600">🔒 Tính năng chỉ dành cho thành viên</div><div style="font-size:12px;color:var(--muted);margin-top:3px">Đăng nhập để đặt lịch, xem hồ sơ và nhận thông báo tự động.</div><button class="btn-cb-login" onclick="toggleChatbot();openLoginModal()">Đăng nhập ngay →</button></div>`;
            }
          } else if (resp.specialty) {
            const label =
              resp.text.match(/\*\*(.*?)\*\*/)?.[1] || resp.specialty;
            extra += `<button class="cb-specialty-btn" style="background:var(--blue);margin-top:6px" onclick="cbGoBook('${resp.specialty}')">📅 Đặt lịch ${label}</button>`;
          }
          if (resp.action === "scroll") {
            extra += `<button class="cb-specialty-btn" style="background:var(--teal);margin-top:6px" onclick="document.getElementById('ai-form').scrollIntoView({behavior:'smooth'});toggleChatbot()">📋 Đến form đặt lịch</button>`;
          }

          div.innerHTML = `<div class="cb-msg-avatar">🤖</div><div><div class="cb-bubble">${txt}</div>${extra}<div style="font-size:10.5px;color:var(--hint);margin-top:3px;padding-left:2px">${timeStr}</div></div>`;
          msgs.appendChild(div);

          // Save to history
          chatHistory.push({
            role: "bot",
            text: txt,
            time: timeStr,
            ts: Date.now(),
          });
          if (currentUser) saveChatHistory();

          // Update history banner count
          if (currentUser) {
            const banner = document.getElementById("cb-history-banner");
            banner.style.display = "flex";
            document.getElementById("cb-history-label").textContent =
              `${chatHistory.length} tin nhắn đã lưu · Bấm để xem`;
          }

          // Suggestions
          const sug = document.getElementById("cb-suggestions");
          sug.innerHTML = "";
          (resp.suggestions || []).forEach((s) => {
            const btn = document.createElement("button");
            btn.className = "cb-sug";
            btn.textContent = s;
            btn.onclick = () => cbSend(s);
            sug.appendChild(btn);
          });
          msgs.scrollTop = msgs.scrollHeight;
        }, 900);
      }

      function addUserMsg(text) {
        const msgs = document.getElementById("cb-messages");
        const div = document.createElement("div");
        div.className = "cb-msg user";
        div.innerHTML = `<div class="cb-bubble">${text}</div>`;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
        document.getElementById("cb-suggestions").innerHTML = "";

        // Save user message to history
        const timeStr = new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        chatHistory.push({ role: "user", text, time: timeStr, ts: Date.now() });
        if (currentUser) saveChatHistory();
      }

      function cbSend(text) {
        const inp = document.getElementById("cb-input");
        const msg = (text || inp.value).trim();
        if (!msg) return;
        inp.value = "";

        // Special commands
        if (msg === "Xem lịch sử chat") {
          showChatHistory();
          return;
        }
        if (msg === "Đăng nhập") {
          toggleChatbot();
          openLoginModal();
          return;
        }
        if (msg === "Đăng nhập ngay") {
          toggleChatbot();
          openLoginModal();
          return;
        }

        addUserMsg(msg);

        // Lưu message user vào history
        const timeStr = new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        chatHistory.push({
          role: "user",
          text: msg,
          time: timeStr,
          ts: Date.now(),
        });

        // Nếu hỏi đặt lịch mà chưa login → nudge
        const lower = msg.toLowerCase();
        if (
          /(đặt lịch|book|appointment|hẹn khám)/.test(lower) &&
          !currentUser
        ) {
          setTimeout(
            () =>
              addBotMsg({
                text: "🔒 Bạn cần **đăng nhập** để đặt lịch khám và lưu hồ sơ!",
                needLogin: true,
              }),
            300,
          );
          return;
        }

        // Dùng AI thật
        sendChatMessage(msg);
      }

      function cbGoBook(specialty) {
        if (!currentUser) {
          // Chưa đăng nhập → hiện login nudge trong chat
          toggleChatbot();
          openLoginModal();
          return;
        }
        toggleChatbot();
        document.getElementById("af-specialty").value = specialty;
        document
          .getElementById("ai-form")
          .scrollIntoView({ behavior: "smooth" });
        showToast(
          "AI Chatbot",
          "Đã chọn chuyên khoa phù hợp. Hoàn thành form để đặt lịch!",
          "🤖",
        );
      }

      // ════════════════════════════════════
      // FORM ACTIONS (Enhanced)
      // ════════════════════════════════════
      function resetForm() {
        ["af-name", "af-phone", "af-date", "af-symptom"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        ["af-specialty", "af-doctor", "af-time"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.selectedIndex = 0;
        });
        document.getElementById("ai-result").style.display = "none";
      }

      function submitAppt() {
        // ── Gate: phải đăng nhập mới được đặt lịch ──
        if (!currentUser) {
          showToast(
            "Cần đăng nhập",
            "Vui lòng đăng nhập để đặt lịch khám.",
            "🔒",
          );
          openLoginModal();
          return;
        }
        const name = (document.getElementById("af-name").value || "").trim();
        const date = document.getElementById("af-date").value || "";
        const phone = (document.getElementById("af-phone").value || "").trim();
        const spec = document.getElementById("af-specialty").value || "";
        const symptom = (
          document.getElementById("af-symptom").value || ""
        ).trim();
        const timeEl = document.getElementById("af-time");
        const time = timeEl ? timeEl.value : "09:00 – 10:00";
        const docEl = document.getElementById("af-doctor");
        const doctorName =
          docEl && docEl.selectedIndex > 0
            ? docEl.options[docEl.selectedIndex].text
            : "BS. Mặc Định";

        if (!name) {
          showToast("Thiếu thông tin", "Vui lòng nhập họ tên bệnh nhân.", "⚠️");
          return;
        }
        if (!date) {
          showToast("Thiếu ngày hẹn", "Vui lòng chọn ngày khám.", "⚠️");
          return;
        }
        if (!spec) {
          showToast(
            "Chưa chọn chuyên khoa",
            "Hãy chọn hoặc dùng AI gợi ý.",
            "⚠️",
          );
          return;
        }

        openEmailInputModal({
          patientName: name,
          date,
          time,
          doctor: doctorName,
          spec,
          symptom,
          phone,
          amount: 200000,
        });
      }

      function saveEmr() {
        const diagnosis = (
          document.getElementById("emr-diagnosis").value || ""
        ).trim();
        if (!diagnosis) {
          showToast(
            "Chưa nhập chẩn đoán",
            "Vui lòng điền chẩn đoán trước khi lưu.",
            "⚠️",
          );
          return;
        }
        const total =
          (parseInt(document.getElementById("emr-fee1").value) || 0) +
          (parseInt(document.getElementById("emr-fee2").value) || 0) +
          (parseInt(document.getElementById("emr-fee3").value) || 0);
        const patientName =
          document.getElementById("emr-patient-name")?.textContent ||
          "Bệnh nhân";
        const apptInfo =
          document.getElementById("emr-appt-info")?.textContent || "";
        closeEmrModal();
        openEmailInputModal({
          mode: "result",
          patientName,
          date: "16/05/2026",
          time: "09:00–10:00",
          doctor: "BS. Mặc Định",
          spec: "Đa Khoa",
          amount: total,
          diagnosis,
          apptInfo,
        });
      }

      // ════════════════════════════════════
      // EMAIL INPUT MODAL (Thu thập địa chỉ email trước khi gửi)
      // ════════════════════════════════════
      let _pendingEmailData = null;
      function openEmailInputModal(data) {
        _pendingEmailData = data;
        document.getElementById("ei-modal").classList.add("open");
        document.body.style.overflow = "hidden";
        document.getElementById("ei-patient-name").textContent =
          data.patientName || "Bệnh nhân";
        // Pre-fill email bệnh nhân nếu đã có từ tài khoản đăng nhập
        const patientEmailEl = document.getElementById("ei-patient-email");
        if (patientEmailEl) {
          patientEmailEl.value = currentUser?.email || "quangthosan@gmail.com";
        }
      }
      function closeEmailInputModal() {
        document.getElementById("ei-modal").classList.remove("open");
        document.body.style.overflow = "";
      }
      async function confirmAndSend() {
        const patientEmail = (
          document.getElementById("ei-patient-email").value || ""
        ).trim();
        if (!patientEmail || !isValidEmail(patientEmail)) {
          showToast(
            "Email không hợp lệ",
            "Vui lòng nhập email bệnh nhân đúng định dạng.",
            "⚠️",
          );
          return;
        }
        closeEmailInputModal();
        const data = {
          ..._pendingEmailData,
          patientEmail,
          doctorEmail: DOCTOR_EMAIL,
        };
        await sendGmailNotifications(data);
      }
      function isValidEmail(e) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
      }

      // ════════════════════════════════════
      // GMAIL — GỬI QUA GMAIL COMPOSE URL
      // (Mở tab Gmail với nội dung soạn sẵn)
      // ════════════════════════════════════
      const DOCTOR_EMAIL = "quanglcf123@gmail.com"; // Cố định

      // ════════════════════════════════════
      // SMTP THẬT — Gửi qua Node.js server
      // POST http://localhost:8080/api/send-email
      // dotnet run --urls "http://localhost:8080"
      // ════════════════════════════════════
      const SMTP_SERVER = ""; // same-origin: truy cập qua http://localhost:8080

      // ── Thông tin tài khoản nhận thanh toán (VietQR) ──
      const BANK_CODE  = "MB";              // mã ngân hàng VietQR
      const BANK_ACC   = "0123456789";     // số tài khoản
      const BANK_OWNER = "PHONG KHAM MEDCARE"; // chủ tài khoản (không dấu)
      // Sinh URL ảnh VietQR động theo số tiền + nội dung
      function buildVietQrUrl(amount, addInfo) {
        return `https://img.vietqr.io/image/${BANK_CODE}-${BANK_ACC}-compact2.jpg`
             + `?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}`
             + `&accountName=${encodeURIComponent(BANK_OWNER)}`;
      }

      async function sendGmailNotifications(data) {
        showEmailSendingStatus("sending");
        const isResult = data.mode === "result";

        try {
          const res = await fetch(`${SMTP_SERVER}/api/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patientName: data.patientName,
              patientEmail: data.patientEmail,
              doctorEmail: DOCTOR_EMAIL,
              date: data.date,
              time: data.time,
              doctor: data.doctor,
              spec: data.spec,
              amount: data.amount || 200000,
              symptom: data.symptom || "",
              phone: data.phone || "",
              mode: data.mode || "booking",
              diagnosis: data.diagnosis || "",
              apptInfo: data.apptInfo || "",
            }),
          });

          const json = await res.json();

          if (json.success) {
            const patientSubject = isResult
              ? `[MedCare] Kết quả khám bệnh — ${data.patientName}`
              : `[MedCare] ✅ Xác nhận lịch khám — ${data.patientName} — ${data.date}`;
            const doctorSubject = isResult
              ? `[MedCare] Bệnh án đã lập: ${data.patientName}`
              : `[MedCare] 🔔 Lịch hẹn mới: ${data.patientName} — ${data.date} ${data.time}`;

            showEmailSendingStatus("success", {
              patientEmail: data.patientEmail,
              doctorEmail: DOCTOR_EMAIL,
              patientName: data.patientName,
              mode: data.mode,
              token: json.token,
              appointmentId: json.appointmentId,
            });
            addEmailLog({
              time: new Date().toLocaleTimeString("vi-VN"),
              to: data.patientEmail,
              subject: patientSubject,
              status: "sent",
            });
            addEmailLog({
              time: new Date().toLocaleTimeString("vi-VN"),
              to: DOCTOR_EMAIL,
              subject: doctorSubject,
              status: "sent",
            });
            if (!isResult) resetForm();
          } else {
            throw new Error(json.error || "Server trả về lỗi không xác định.");
          }
        } catch (err) {
          // Nếu không kết nối được server → hướng dẫn rõ
          const isOffline =
            err.message.includes("fetch") || err.message.includes("Failed");
          showEmailSendingStatus("error", {
            error: isOffline
              ? "⚠️ Không kết nối được SMTP server. Hãy chạy <b>node server.js</b> trước, sau đó thử lại."
              : `Lỗi: ${err.message}`,
          });
        }
      }

      function delay(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }

      // ── Plain text email builders ──
      function buildPatientBookingText(d, token, qrUrl) {
        return `Kính gửi ${d.patientName || "Bệnh nhân"},

Lịch khám của bạn đã được XÁC NHẬN THÀNH CÔNG tại MedCare Phòng Khám.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CHI TIẾT LỊCH HẸN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📅 Ngày khám  : ${d.date}
  ⏰ Giờ khám   : ${d.time}
  👨‍⚕️ Bác sĩ    : ${d.doctor || "BS. Mặc Định"}
  🏥 Chuyên khoa: ${d.spec || "Đa Khoa"}
  📍 Địa chỉ    : 123 Đường Sức Khỏe, Q.1, TP.HCM
${d.symptom ? `  🩺 Triệu chứng: ${d.symptom}` : ""}
${d.phone ? `  📞 SĐT        : ${d.phone}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  THANH TOÁN QUA VIETQR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💰 Số tiền    : ${(d.amount || 200000).toLocaleString("vi-VN")}đ
  🏦 Ngân hàng  : MB Bank
  🔢 Số TK      : 0123456789
  👤 Chủ TK     : PHONG KHAM MEDCARE
  📝 Nội dung CK: MEDCARE ${token.slice(-6)}

  🔗 Mã QR: ${qrUrl}
  (Dán link vào trình duyệt để xem mã QR thanh toán)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mã lịch hẹn: ${token}
Hotline hỗ trợ: 1900-1234 (24/7)

Trân trọng,
MedCare Phòng Khám Đa Khoa
🌐 medcare.vn | 📧 info@medcare.vn`;
      }

      function buildDoctorBookingText(d, token) {
        const acceptUrl = `https://medcare.vn/confirm?token=${token}&action=accept`;
        const declineUrl = `https://medcare.vn/confirm?token=${token}&action=decline`;
        return `Kính gửi Bác sĩ,

Có LỊCH HẸN MỚI cần bạn xác nhận:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  THÔNG TIN BỆNH NHÂN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  👤 Họ tên    : ${d.patientName || "—"}
${d.phone ? `  📞 SĐT       : ${d.phone}` : ""}
  🗓️  Ngày hẹn  : ${d.date}
  ⏰ Giờ hẹn   : ${d.time}
  🏥 Chuyên khoa: ${d.spec || "Đa Khoa"}
${d.symptom ? `  🩺 Triệu chứng: ${d.symptom}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  XÁC NHẬN 1 CHẠM (ZERO-TOUCH)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ CHẤP NHẬN lịch hẹn:
  ${acceptUrl}

  ❌ TỪ CHỐI / đổi lịch:
  ${declineUrl}

  (Bấm link để cập nhật thẳng vào hệ thống — không cần đăng nhập)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 Secure Token: ${token} (hết hạn sau 24h)

Trân trọng,
Hệ thống MedCare AI Scheduler`;
      }

      function buildPatientResultText(d, token, qrUrl) {
        return `Kính gửi ${d.patientName},

Bệnh án và hóa đơn sau buổi khám đã được lập thành công.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  KẾT QUẢ KHÁM BỆNH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  👨‍⚕️ Bác sĩ     : ${d.doctor}
  🏥 Chuyên khoa : ${d.spec}
  🩺 Chẩn đoán  : ${d.diagnosis || "Đã ghi nhận trong hệ thống"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HÓA ĐƠN THANH TOÁN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💰 Tổng phí   : ${(d.amount || 200000).toLocaleString("vi-VN")}đ
  🏦 Ngân hàng  : MB Bank
  🔢 Số TK      : 0123456789
  👤 Chủ TK     : PHONG KHAM MEDCARE
  📝 Nội dung CK: MEDCARE ${token.slice(-6)}

  🔗 Mã QR: ${qrUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hotline: 1900-1234 | medcare.vn

Trân trọng,
MedCare Phòng Khám Đa Khoa`;
      }

      function buildDoctorResultText(d, token) {
        return `Thông báo nội bộ — MedCare EMR

Bệnh án đã được lập thành công:

  👤 Bệnh nhân : ${d.patientName}
  📋 Lịch      : ${d.apptInfo || ""}
  🩺 Chẩn đoán : ${d.diagnosis}
  💰 Tổng phí  : ${d.amount.toLocaleString("vi-VN")}đ

🔑 Token: ${token}

— MedCare EMR System`;
      }

      // ── Email Sending Status Modal ──
      function showEmailSendingStatus(state, data) {
        const modal = document.getElementById("email-status-modal");
        const inner = document.getElementById("email-status-inner");
        modal.classList.add("open");
        if (state === "sending") {
          inner.innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div style="width:56px;height:56px;border-radius:50%;border:3px solid #EAF2FF;border-top-color:#1057A4;animation:spin 1s linear infinite;margin:0 auto 16px"></div>
        <div style="font-size:16px;font-weight:700;color:var(--txt);margin-bottom:6px">📧 Đang gửi email qua SMTP…</div>
        <div style="font-size:13px;color:var(--muted)">smtp.gmail.com:587 · TLS · App Password</div>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px" id="send-steps">
          <div class="send-step active">⏳ Kết nối smtp.gmail.com:587…</div>
          <div class="send-step">📨 Soạn email bệnh nhân (HTML)…</div>
          <div class="send-step">📨 Soạn email bác sĩ + deep link…</div>
          <div class="send-step">🚀 Gửi qua SMTP · TLS mã hóa…</div>
        </div>
      </div>`;
          // Animate steps
          let step = 0;
          const steps = document.querySelectorAll(".send-step");
          const iv = setInterval(() => {
            if (step < steps.length - 1) {
              step++;
              steps[step].classList.add("active");
            } else clearInterval(iv);
          }, 700);
        } else if (state === "success") {
          inner.innerHTML = `
      <div style="text-align:center;padding:8px 0 16px">
        <div style="font-size:52px;margin-bottom:12px">${data && data.emailSent === false ? "⚠️" : "📬"}</div>
        <div style="font-size:17px;font-weight:800;color:var(--txt);margin-bottom:6px">${data && data.emailSent === false ? "Đặt lịch thành công (email chưa gửi được)" : "Đặt lịch & gửi email thành công!"}</div>
        ${
          data && data.emailSent === false
            ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px;text-align:left;font-size:12px;color:#9a3412;margin-bottom:14px">Lịch đã lưu (mã #${(data && data.appointmentId) || ""}) nhưng <b>email xác nhận chưa gửi được</b>:<br><span style="font-family:monospace;font-size:11px">${(data && data.emailError) || "không rõ lý do"}</span></div>`
            : `<div style="font-size:13px;color:var(--muted);margin-bottom:18px">Gửi qua <b>smtp.gmail.com:587</b> · TLS<br>2 email đã được gửi vào hộp thư.</div>`
        }
        <div style="background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:14px;text-align:left;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:18px">🙋</span>
            <div>
              <div style="font-size:11px;color:#065F46;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Email 1 — Bệnh nhân</div>
              <div style="font-size:13px;font-weight:600">${(data && data.patientEmail) || "—"}</div>
              <div style="font-size:11.5px;color:var(--muted)">Xác nhận lịch hẹn + VietQR thanh toán</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:18px">👨‍⚕️</span>
            <div>
              <div style="font-size:11px;color:#065F46;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Email 2 — Bác sĩ 🔒</div>
              <div style="font-size:13px;font-weight:600">quanglcf123@gmail.com</div>
              <div style="font-size:11.5px;color:var(--muted)">Lịch mới + nút <b>✅ Chấp nhận / ❌ Từ chối 1 chạm</b></div>
            </div>
          </div>
        </div>
        ${
          data && data.appointmentId
            ? `
        <div style="background:#eaf2ff;border-radius:8px;padding:10px 14px;font-size:12px;color:#1057a4;margin-bottom:14px;text-align:left">
          🔑 <b>Mã lịch hẹn:</b> #${data.appointmentId}<br>
          📌 <b>Token xác nhận:</b> <span style="font-family:monospace;font-size:11px">${(data.token || "").slice(0, 18)}…</span>
        </div>`
            : ""
        }
        <button onclick="document.getElementById('email-status-modal').classList.remove('open')" style="width:100%;padding:11px;background:var(--blue);color:white;border:none;border-radius:10px;font-family:'Be Vietnam Pro',sans-serif;font-size:14px;font-weight:700;cursor:pointer">Hoàn tất ✓</button>
      </div>`;
        } else {
          inner.innerHTML = `
      <div style="text-align:center;padding:8px 0 16px">
        <div style="font-size:52px;margin-bottom:12px">❌</div>
        <div style="font-size:17px;font-weight:800;color:var(--txt);margin-bottom:6px">Đặt lịch thất bại</div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;text-align:left;font-size:12.5px;color:#991b1b;margin:12px 0">${(data && data.error) || "Không thể đặt lịch. Vui lòng thử lại."}</div>
        <div style="display:flex;gap:8px">
          <button onclick="closeEmailInputModal();document.getElementById('email-status-modal').classList.remove('open')" style="flex:1;padding:11px;background:var(--bg);color:var(--muted);border:1px solid var(--border);border-radius:10px;font-family:'Be Vietnam Pro',sans-serif;font-size:13px;font-weight:600;cursor:pointer">Đóng</button>
          <button onclick="document.getElementById('email-status-modal').classList.remove('open');openEmailInputModal(_pendingEmailData)" style="flex:1;padding:11px;background:var(--blue);color:white;border:none;border-radius:10px;font-family:'Be Vietnam Pro',sans-serif;font-size:13px;font-weight:700;cursor:pointer">Thử lại</button>
        </div>
      </div>`;
        }
      }

      // ── Email Log (audit trail) ──
      const emailLog = [];
      function addEmailLog(entry) {
        emailLog.unshift(entry);
        const badge = document.getElementById("email-log-count");
        if (badge) {
          badge.textContent = emailLog.length;
          badge.style.display = "inline-flex";
        }
        renderEmailLog();
      }
      function renderEmailLog() {
        const el = document.getElementById("email-log-list");
        if (!el) return;
        el.innerHTML = emailLog
          .slice(0, 10)
          .map(
            (e) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="color:#065F46;font-size:18px">📨</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.subject}</div>
        <div style="font-size:11.5px;color:var(--muted)">${e.to} · ${e.time}</div>
      </div>
      <span style="background:#ecfdf5;color:#065F46;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700">Đã gửi</span>
    </div>`,
          )
          .join("");
      }

      function toggleQueue() {
        const p = document.getElementById("queue-panel");
        p.style.display = p.style.display === "none" ? "block" : "none";
      }

      // ════════════════════════════════════
      // AI CHATBOT — THẬT (Anthropic API)
      // ════════════════════════════════════
      async function sendChatMessage(userText) {
        const msgs = document.getElementById("cb-messages");
        // Show typing
        const typing = document.createElement("div");
        typing.className = "cb-msg bot";
        typing.innerHTML = `<div class="cb-msg-avatar">🤖</div><div class="cb-typing"><span></span><span></span><span></span></div>`;
        msgs.appendChild(typing);
        msgs.scrollTop = msgs.scrollHeight;

        try {
          const histMessages = chatHistory.slice(-10).map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.text.replace(/<[^>]+>/g, ""),
          }));
          histMessages.push({ role: "user", content: userText });

          // Gọi CHATBOT QUA SERVER (/api/chat/send) — server giữ API key an toàn
          // và TỰ BÁM lịch sử khám bệnh thật khi người dùng đã đăng nhập (grounding).
          const response = await fetch(`${SMTP_SERVER}/api/chat/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ message: userText }),
          });
          const data = await response.json();
          const fullText =
            data.reply || "Xin lỗi, có lỗi xảy ra. Vui lòng thử lại!";

          // Parse suggestions
          const suggMatch = fullText.match(/\[GỢI Ý:(.*?)\]/);
          const suggestions = suggMatch
            ? suggMatch[1]
                .split("|")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          const cleanText = fullText.replace(/\[GỢI Ý:.*?\]/g, "").trim();

          const isEmergency =
            /(nguy hiểm|cấp cứu|khẩn cấp|gọi 115|đột quỵ)/i.test(cleanText);

          typing.remove();
          addBotMsg({ text: cleanText, alert: isEmergency, suggestions });

          const timeStr = new Date().toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          });
          chatHistory.push({
            role: "bot",
            text: cleanText,
            time: timeStr,
            ts: Date.now(),
          });
          if (currentUser) saveChatHistory();
        } catch (err) {
          typing.remove();
          // Fallback to old rule-based
          const fallbackResp = cbProcess(userText);
          addBotMsg(fallbackResp);
        }
      }

      function cbProcess(msg) {
        const lower = msg.toLowerCase();
        if (/(ngực|tim|khó thở)/.test(lower))
          return {
            text: "❤️ Triệu chứng tim mạch. Nếu đau dữ dội, gọi **115 ngay**!",
            specialty: "TimMach",
            alert: true,
            suggestions: ["Đặt lịch Tim Mạch", "Triệu chứng khác"],
          };
        if (/(bụng|dạ dày|tiêu hóa)/.test(lower))
          return {
            text: "🫁 Có thể liên quan **Tiêu Hóa**. Bạn muốn đặt lịch không?",
            specialty: "TieuHoa",
            suggestions: ["Đặt lịch Tiêu Hóa"],
          };
        if (/(đầu|mất ngủ|chóng mặt)/.test(lower))
          return {
            text: "🧠 Triệu chứng thần kinh. Cần khám **Thần Kinh**.",
            specialty: "ThanKinh",
            suggestions: ["Đặt lịch Thần Kinh"],
          };
        if (/(giờ|mở cửa|làm việc)/.test(lower))
          return {
            text: "🕐 Giờ làm việc: **T2-T7: 7:00-20:00**, CN: 8:00-12:00. Hotline: **1900-1234**",
            suggestions: ["Đặt lịch khám"],
          };
        if (/(giá|phí|bao nhiêu|chi phí)/.test(lower))
          return {
            text: "💰 Phí khám từ **150.000đ** tùy chuyên khoa. Nhận bảo hiểm Bảo Việt, PVI.",
            suggestions: ["Đặt lịch"],
          };
        return {
          text: "Tôi có thể giúp bạn về triệu chứng, đặt lịch khám, giá dịch vụ. Hãy mô tả cụ thể hơn nhé!",
          suggestions: ["Đau ngực", "Đau bụng", "Đặt lịch khám"],
        };
      }

      function showToast(title, msg, ico = "✅") {
        document.getElementById("toast-title").textContent = title || "";
        document.getElementById("toast-msg").textContent = msg || "";
        document.getElementById("toast-ico").textContent = ico;
        const t = document.getElementById("toast");
        t.classList.add("show");
        clearTimeout(t._timer);
        t._timer = setTimeout(hideToast, 5000);
      }
      function hideToast() {
        document.getElementById("toast").classList.remove("show");
      }

      // ── Ngày mặc định: quá giờ làm việc trong ngày → tự chuyển sang HÔM SAU ──
      // Giờ làm: T2–T7 đến 20:00, CN đến 12:00.
      (function setDefaultBookingDate() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        const closeHour = now.getDay() === 0 ? 12 : 20; // CN đóng 12h
        const def = new Date(now);
        if (now.getHours() >= closeHour) def.setDate(def.getDate() + 1); // hết giờ → mai

        const todayStr = ymd(now);
        const defStr = ymd(def);
        ["af-date", "sb-date", "ms-date"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            el.min = todayStr;     // không cho chọn ngày quá khứ
            el.value = defStr;     // mặc định hôm nay (hoặc mai nếu đã hết giờ)
          }
        });
      })();

      // ════════════════════════════════════
      // INIT — Khôi phục session từ .NET cookie
      // ════════════════════════════════════
      document.body.classList.add("no-role");
      document
        .querySelectorAll(".btn-emr,.btn-confirm-row")
        .forEach((b) => (b.style.display = "none"));

      // Kiểm tra session cookie .NET khi load trang
      (async () => {
        try {
          const res = await fetch(`${SMTP_SERVER}/api/me`, {
            credentials: "include",
          });
          if (res.ok) {
            const json = await res.json();
            if (json.loggedIn) {
              const roleMap = {
                Patient: "patient",
                Doctor: "doctor",
                Admin: "admin",
              };
              currentRole = roleMap[json.role] || "patient";
              currentUser = {
                email: json.email || json.username,
                name: json.fullName || json.username,
                username: json.username,
                id: json.id,
                role: json.role,
              };
              selectedRoleTab = currentRole;
              applyRBAC();
              console.log(
                `[Session] Khôi phục: ${json.fullName} (${json.role})`,
              );
            }
          }
        } catch (e) {
          // Server chưa chạy — bình thường, không cần xử lý
        }
      })();

      // ════════════════════════════════════
      // TẤT CẢ LỊCH HẸN — MODAL QUẢN LÝ
      // ════════════════════════════════════
      let ALL_APPOINTMENTS = [];

      let _apptFilter = "all";
      let _apptSearch = "";

      // Ánh xạ status tiếng Việt → key filter
      function mapStatus(s) {
        if (!s) return "pending";
        s = s.toLowerCase();
        if (s.includes("xác nhận")) return "confirmed";
        if (s.includes("chờ"))      return "pending";
        if (s.includes("hủy") || s.includes("từ chối")) return "cancelled";
        if (s.includes("khám"))     return "confirmed";
        return "pending";
      }

      // Màu avatar bác sĩ theo tên
      const _docColors = ["#1057a4","#00b896","#e53935","#6f42c1","#f59e0b","#0891b2"];
      function docColor(name) {
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
        return _docColors[h % _docColors.length];
      }
      function docInit(name) {
        // "BS. Nguyễn Văn An" → "NA"
        const words = name.replace(/^bs\.\s*/i,"").trim().split(/\s+/);
        return words.length >= 2
          ? (words[words.length-2][0] + words[words.length-1][0]).toUpperCase()
          : name.slice(0,2).toUpperCase();
      }

      async function openAllAppointmentsModal() {
        _apptFilter = "all";
        _apptSearch = "";
        document.getElementById("all-appt-modal").classList.add("open");
        document.body.style.overflow = "hidden";
        document.getElementById("appt-search-input") && (document.getElementById("appt-search-input").value = "");
        document.querySelectorAll(".appt-filter-btn").forEach(b => b.classList.toggle("active", b.dataset.filter === "all"));

        // Hiện loading
        document.getElementById("all-appt-tbody").innerHTML =
          `<tr><td colspan="7" style="text-align:center;padding:30px;color:#64748b">
             <div style="display:inline-flex;align-items:center;gap:8px">
               <div style="width:16px;height:16px;border-radius:50%;border:2px solid #e2e8f0;border-top-color:#1057a4;animation:spin .8s linear infinite"></div>
               Đang tải dữ liệu từ server…
             </div>
           </td></tr>`;

        try {
          const res = await fetch(`${SMTP_SERVER}/api/appointments`, { credentials: "include" });

          if (res.status === 401) {
            document.getElementById("all-appt-tbody").innerHTML =
              `<tr><td colspan="7" style="text-align:center;padding:30px;color:#dc2626">
                 ⚠️ Phiên đăng nhập hết hạn. Vui lòng <a href="#" onclick="closeAllAppointmentsModal();openLoginModal()" style="color:#1057a4">đăng nhập lại</a>.
               </td></tr>`;
            return;
          }

          const data = await res.json();
          if (!Array.isArray(data)) throw new Error("Không phải array: " + JSON.stringify(data).slice(0,120));

          // Debug: hiện số lượng trả về
          document.getElementById("all-appt-tbody").innerHTML =
            `<tr><td colspan="7" style="text-align:center;padding:10px;color:#1057a4;font-size:12px">
               ✅ API trả về ${data.length} lịch hẹn — đang render…
             </td></tr>`;

          ALL_APPOINTMENTS = data.map(a => ({
            id:        a.id,
            patientId: a.patientId || 0,
            patient:   a.patient   || "—",
            symptom:   a.symptom   || "—",
            doctor:    a.doctor    || "—",
            docInit:   docInit(a.doctor || "?"),
            docColor:  docColor(a.doctor || ""),
            date:      a.date      || "—",
            time:      a.time      || "—",
            spec:      "—",
            status:    mapStatus(a.status),
            rawStatus: a.status,
          }));
        } catch(err) {
          document.getElementById("all-appt-tbody").innerHTML =
            `<tr><td colspan="7" style="text-align:center;padding:30px;color:#dc2626">
               ⚠️ Lỗi tải dữ liệu: ${err.message}
             </td></tr>`;
          return;
        }
        renderAllApptTable();
      }

      function closeAllAppointmentsModal() {
        document.getElementById("all-appt-modal").classList.remove("open");
        document.body.style.overflow = "";
      }

      function setApptFilter(f) {
        _apptFilter = f;
        document
          .querySelectorAll(".appt-filter-btn")
          .forEach((b) => b.classList.toggle("active", b.dataset.filter === f));
        renderAllApptTable();
      }

      function onApptSearch(val) {
        _apptSearch = val.toLowerCase();
        renderAllApptTable();
      }

      function renderAllApptTable() {
        const statusLabel = {
          confirmed: "Đã xác nhận",
          pending: "Chờ duyệt",
          cancelled: "Đã hủy",
        };
        const statusClass = {
          confirmed: "status-confirmed",
          pending: "status-pending",
          cancelled: "status-cancelled",
        };

        const filtered = ALL_APPOINTMENTS.filter((a) => {
          const matchFilter = _apptFilter === "all" || a.status === _apptFilter;
          const matchSearch =
            !_apptSearch ||
            a.patient.toLowerCase().includes(_apptSearch) ||
            a.symptom.toLowerCase().includes(_apptSearch) ||
            a.doctor.toLowerCase().includes(_apptSearch) ||
            a.spec.toLowerCase().includes(_apptSearch) ||
            a.date.includes(_apptSearch);
          return matchFilter && matchSearch;
        });

        const isDoctor = document.body.classList.contains("role-doctor");
        const tbody = document.getElementById("all-appt-tbody");
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--hint)">Không tìm thấy lịch hẹn nào</td></tr>`;
          return;
        }
        // Mọi dữ liệu động đều qua escapeHtml; nút dùng data-* + event
        // delegation (không nhúng dữ liệu vào chuỗi onclick → chống XSS).
        tbody.innerHTML = filtered
          .map((a) => {
            const patient = escapeHtml(a.patient);
            const symptom = escapeHtml(a.symptom);
            const doctor  = escapeHtml(a.doctor);
            const date    = escapeHtml(a.date);
            const time    = escapeHtml(a.time);
            const actions = isDoctor
              ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
                   <button class="btn-emr" style="font-size:11px;padding:5px 10px"
                     data-action="emr" data-id="${a.id}" data-patient="${patient}"
                     data-info="Lịch #${a.id} · ${date} · ${doctor}" data-patient-id="${a.patientId || 0}">📋 Bệnh án</button>
                   ${a.status !== "cancelled"
                     ? `<button class="btn-confirm-row" style="font-size:11px;padding:5px 10px"
                          data-action="email" data-patient="${patient}" data-date="${date}"
                          data-time="${time}" data-doctor="${doctor}" data-spec="${escapeHtml(a.spec)}">📧 Email</button>`
                     : ""}
                 </div>`
              : `<span style="color:var(--hint);font-size:12px">—</span>`;
            return `
          <tr>
            <td style="color:var(--hint);font-weight:700">#${a.id}</td>
            <td style="font-weight:600">${patient}</td>
            <td style="color:var(--muted)">${symptom}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:28px;height:28px;border-radius:50%;background:${a.docColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${escapeHtml(a.docInit)}</div>
                <span style="font-size:13px">${doctor}</span>
              </div>
            </td>
            <td style="color:var(--muted);white-space:nowrap">${date}<br><span style="font-size:11px">${time}</span></td>
            <td><span class="status-badge ${statusClass[a.status]}">${statusLabel[a.status]}</span></td>
            <td>${actions}</td>
          </tr>`;
          })
          .join("");

        // Event delegation cho nút (gắn 1 lần)
        if (!tbody.dataset.bound) {
          tbody.dataset.bound = "1";
          tbody.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-action]");
            if (!btn) return;
            if (btn.dataset.action === "emr") {
              openEmrModal(
                parseInt(btn.dataset.id),
                btn.dataset.patient,
                btn.dataset.info,
                parseInt(btn.dataset.patientId) || 0
              );
            } else if (btn.dataset.action === "email") {
              openEmailInputModal({
                patientName: btn.dataset.patient,
                date: btn.dataset.date,
                time: btn.dataset.time,
                doctor: btn.dataset.doctor,
                spec: btn.dataset.spec,
                amount: 200000,
              });
            }
          });
        }
      }

      // ════════════════════════════════════════════
      // TIN TỨC SỨC KHỎE — VnExpress RSS qua rss2json
      // ════════════════════════════════════════════
      async function loadHealthNews() {
        const grid = document.getElementById("news-grid");
        if (!grid) return;
        try {
          const res  = await fetch(`${SMTP_SERVER}/api/news?count=3`);
          const data = await res.json();
          if (!data.success || !data.items?.length) throw new Error("no items");

          grid.innerHTML = data.items.map(item => {
            const date = item.pubDate
              ? new Date(item.pubDate).toLocaleDateString("vi-VN", { day:"2-digit", month:"2-digit", year:"numeric" })
              : "";
            // Escape mọi dữ liệu từ RSS bên ngoài (chống XSS)
            const link  = encodeURI(item.link || "#");
            const thumb = item.thumbnail ? encodeURI(item.thumbnail) : "";
            const title = escapeHtml(item.title);
            const desc  = escapeHtml((item.description || "").slice(0, 160));
            const imgHtml = thumb
              ? `<img class="news-card-img" src="${thumb}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
              : "";
            const placeholderHtml = `<div class="news-card-img-placeholder" style="${thumb ? "display:none" : ""}">🏥</div>`;
            return `
              <a class="news-card" href="${link}" target="_blank" rel="noopener">
                ${imgHtml}${placeholderHtml}
                <div class="news-card-body">
                  <span class="news-card-tag">Sức khỏe</span>
                  <div class="news-card-title">${title}</div>
                  <div class="news-card-desc">${desc}</div>
                  <div class="news-card-footer">
                    <span>${date}</span>
                    <a href="${link}" target="_blank" rel="noopener">
                      Đọc tiếp
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </a>
                  </div>
                </div>
              </a>`;
          }).join("");
        } catch {
          grid.innerHTML = `<div class="news-error">⚠️ Không thể tải tin tức lúc này. <a href="https://vnexpress.net/suc-khoe" target="_blank" style="color:var(--primary)">Xem trực tiếp tại VnExpress →</a></div>`;
        }
      }

      // ════════════════════════════════════
      // SỐ LIỆU THẬT — lấy từ /api/stats
      // ════════════════════════════════════
      // Hiệu ứng đếm số từ 0 → giá trị thật
      function countUp(el, target, suffix = "", ms = 1400) {
        if (!el) return;
        const start = performance.now();
        function frame(now) {
          const p = Math.min((now - start) / ms, 1);
          const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
          el.textContent = Math.round(target * eased).toLocaleString("vi-VN") + suffix;
          if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }

      async function loadStats() {
        try {
          const res  = await fetch(`${SMTP_SERVER}/api/stats`);
          const s    = await res.json();

          // Hero — đếm số động
          countUp(document.getElementById("stat-doctors"),      s.totalDoctors,      "+");
          countUp(document.getElementById("stat-appointments"), s.totalAppointments, "+");
          countUp(document.getElementById("stat-patients"),     s.totalPatients,     "+");

          // Dashboard bác sĩ — set giá trị thật (GSAP đếm khi cuộn tới)
          const setNum = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
          setNum("dd-total",    s.totalAppointments);
          setNum("dd-pending",  s.pending);
          setNum("dd-records",  s.medicalRecords);
          setNum("dd-patients", s.totalPatients);
        } catch {
          /* giữ số mặc định trong HTML nếu lỗi mạng */
        }
      }

      // Gọi khi trang load
      loadHealthNews();
      loadStats();

      // ── Card "Hồ sơ bệnh án" ──
      function handleHoSoCard(e) {
        e.preventDefault();
        if (!currentUser) {
          openLoginModal();
          return;
        }
        if (currentRole === "doctor" || currentRole === "admin") {
          // Gọi đúng hàm để fetch data từ API
          openAllAppointmentsModal();
        } else {
          // Bệnh nhân → cuộn xuống dashboard cá nhân
          const pd = document.getElementById("patient-dashboard");
          if (pd && pd.style.display !== "none") {
            pd.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            // Dashboard chưa hiện (chưa load xong) → thử scroll sau 300ms
            setTimeout(() => {
              document.getElementById("patient-dashboard")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 300);
          }
        }
      }

      // ════════════════════════════════════════════════════════
      // ACCESSIBILITY — tự gán id + aria-label cho field thiếu nhãn.
      // Sửa cảnh báo "form field should have id/name" & "No label
      // associated" trên TOÀN trang (kể cả modal sinh động) ở 1 nơi.
      // ════════════════════════════════════════════════════════
      (function () {
        let _a11yId = 0;

        function labelFor(el) {
          // Ưu tiên: placeholder → title → text của <label> bao ngoài → option đầu (select)
          if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
          if (el.title && el.title.trim()) return el.title.trim();
          const wrapLabel = el.closest("label");
          if (wrapLabel && wrapLabel.textContent.trim())
            return wrapLabel.textContent.trim().slice(0, 80);
          // Nhãn đứng ngay trước field (anh em liền kề)
          const prev = el.previousElementSibling;
          if (prev && /label|span|div/i.test(prev.tagName) && prev.textContent.trim())
            return prev.textContent.trim().slice(0, 80);
          if (el.tagName === "SELECT" && el.options.length)
            return (el.options[0].textContent || "Lựa chọn").trim();
          const map = { date: "Chọn ngày", time: "Chọn giờ", email: "Email",
            tel: "Số điện thoại", password: "Mật khẩu", file: "Chọn tệp",
            number: "Nhập số", search: "Tìm kiếm" };
          return map[el.type] || "Trường nhập liệu";
        }

        // Đoán nhãn cho nút chỉ-có-icon dựa trên tên icon Lucide
        const ICON_LABEL = {
          send: "Gửi", "send-horizontal": "Gửi", search: "Tìm kiếm",
          x: "Đóng", "x-circle": "Đóng", close: "Đóng",
          phone: "Gọi điện", "phone-call": "Gọi cấp cứu", calendar: "Đặt lịch",
          "calendar-plus": "Đặt lịch", "calendar-check": "Đặt lịch",
          mic: "Nhập bằng giọng nói", menu: "Mở menu",
          "chevron-down": "Mở rộng", "chevron-up": "Thu gọn",
          "chevron-right": "Tiếp", "chevron-left": "Quay lại",
          "arrow-right": "Tiếp tục", "arrow-left": "Quay lại",
          user: "Tài khoản", "log-out": "Đăng xuất", "log-in": "Đăng nhập",
          bot: "Trợ lý AI", "message-circle": "Mở chat", plus: "Thêm",
          trash: "Xóa", "trash-2": "Xóa", pencil: "Sửa", edit: "Sửa",
          eye: "Hiện/ẩn", upload: "Tải lên", download: "Tải xuống",
          "file-text": "Hồ sơ", stethoscope: "Khám", "heart-pulse": "Tim mạch",
        };

        function btnLabel(el) {
          if (el.title && el.title.trim()) return el.title.trim();
          const icon = el.querySelector("[data-lucide], svg.lucide, i.lucide, svg");
          const name = icon && (icon.getAttribute("data-lucide") ||
            (icon.className && String(icon.className.baseVal || icon.className).replace(/lucide-?/g, "").trim()));
          if (name && ICON_LABEL[name]) return ICON_LABEL[name];
          if (name) return name.replace(/-/g, " ");
          return "Nút";
        }

        function fixForms(root) {
          const scope = root || document;

          // (A) Trường nhập liệu — id + aria-label
          scope.querySelectorAll("input:not([type=hidden]), select, textarea").forEach((el) => {
            if (!el.id && !el.name) el.id = "f_a11y_" + ++_a11yId;
            const hasLabel =
              el.getAttribute("aria-label") ||
              el.getAttribute("aria-labelledby") ||
              (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) ||
              el.closest("label");
            if (!hasLabel) el.setAttribute("aria-label", labelFor(el));
          });

          // (B) Nút/liên kết chỉ có icon — gán aria-label để có "tên truy cập"
          scope.querySelectorAll('button, a[role="button"], [role="button"]').forEach((el) => {
            const hasName =
              el.getAttribute("aria-label") ||
              el.getAttribute("aria-labelledby") ||
              el.getAttribute("title") ||
              (el.textContent && el.textContent.replace(/\s+/g, "").length > 0);
            if (!hasName) el.setAttribute("aria-label", btnLabel(el));
          });
        }

        function run() { try { fixForms(document); } catch (e) {} }

        // Chạy khi DOM sẵn sàng + sau khi tải xong toàn bộ
        if (document.readyState !== "loading") run();
        else document.addEventListener("DOMContentLoaded", run);
        window.addEventListener("load", run);

        // Modal/bảng sinh động (innerHTML) → vá lại, gộp nhịp để nhẹ
        let _t;
        new MutationObserver(() => {
          clearTimeout(_t);
          _t = setTimeout(run, 250);
        }).observe(document.body, { childList: true, subtree: true });

        // Cho phép gọi thủ công nếu cần
        window.a11yFixForms = run;
      })();

      // ════════════════════════════════════════════════════════
      // HIỆU NĂNG — tạm DỪNG cảnh 3D (Spline/WebGL) trong lúc đang CUỘN.
      // WebGL render 60fps liên tục là nguyên nhân chính gây giật khi cuộn.
      // .hero-3d là position:absolute → ẩn đi KHÔNG gây xô lệch layout;
      // Spline tự dừng vòng lặp render khi không hiển thị → cuộn mượt.
      // Hiện lại ngay khi ngừng cuộn (sau 200ms).
      // ════════════════════════════════════════════════════════
      (function () {
        const hero3d = document.querySelector(".hero-3d");
        const hero = document.getElementById("hero");
        if (!hero3d) return;

        let heroVisible = true;   // hero còn trong màn hình?
        let scrolling = false;    // đang cuộn?
        let timer = null;

        // 3D chỉ render khi: hero ĐANG hiển thị VÀ KHÔNG đang cuộn.
        function apply() {
          hero3d.style.display = heroVisible && !scrolling ? "" : "none";
        }

        // Tắt hẳn 3D khi hero rời khỏi viewport (cuộn xuống đọc nội dung)
        if (hero && "IntersectionObserver" in window) {
          new IntersectionObserver(
            function (entries) {
              heroVisible = entries[0].isIntersecting;
              apply();
            },
            { threshold: 0.05 }
          ).observe(hero);
        }

        // Tạm tắt 3D trong lúc cuộn → cuộn mượt; bật lại khi ngừng (nếu hero còn hiện)
        window.addEventListener(
          "scroll",
          function () {
            if (!scrolling) { scrolling = true; apply(); }
            clearTimeout(timer);
            timer = setTimeout(function () {
              scrolling = false;
              apply();
            }, 200);
          },
          { passive: true }
        );
      })();
