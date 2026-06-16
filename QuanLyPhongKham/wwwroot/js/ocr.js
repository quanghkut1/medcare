// ============================================================
// MedCare — OCR nhập hồ sơ bệnh án
// Phụ thuộc: app.js (SMTP_SERVER, currentUser...)
// ============================================================

    // ═══════════════════════════════════════════
    // OCR MODAL LOGIC
    // ═══════════════════════════════════════════
    let _ocrFile      = null;
    let _ocrPatientId = 0;
    let _ocrScanDotTimer = null;

    async function openOcrModal() {
      document.getElementById("ocr-overlay").classList.add("open");
      document.body.style.overflow = "hidden";
      ocrGoStep(1);
      try {
        const res  = await fetch(`${SMTP_SERVER}/api/ocr/patients-list`, { credentials:"include" });
        const list = await res.json();
        const sel  = document.getElementById("ocr-patient-select");
        sel.innerHTML = '<option value="">-- Chọn bệnh nhân --</option>' +
          list.map(p => `<option value="${p.id}">${p.fullName}${p.email ? " · " + p.email : ""}</option>`).join("");
        document.getElementById("ocr-status-txt").textContent =
          `${list.length} bệnh nhân · Chọn bệnh nhân và tải ảnh lên`;
      } catch {
        document.getElementById("ocr-patient-select").innerHTML = '<option value="">Không tải được danh sách</option>';
      }
    }

    function closeOcrModal() {
      document.getElementById("ocr-overlay").classList.remove("open");
      document.body.style.overflow = "";
      clearInterval(_ocrScanDotTimer);
    }

    function ocrGoStep(n) {
      // Panels
      [1,2,3].forEach(i => {
        document.getElementById(`ocr-panel-${i}`).style.display = i === n ? "" : "none";
        const s = document.getElementById(`ocr-step-${i}`);
        s.className = "ocr-step-item" + (i === n ? " active" : i < n ? " done" : "");
        // circle icon: done = ✓
        s.querySelector(".ocr-step-circle").textContent = i < n ? "✓" : i;
      });
      // Lines
      [1,2].forEach(i => {
        const l = document.getElementById(`ocr-line-${i}`);
        if (l) l.className = "ocr-step-line" + (i < n ? " done" : "");
      });
      // Footers
      document.getElementById("ocr-footer-1").style.display = n === 1 ? ""       : "none";
      document.getElementById("ocr-footer-2").style.display = n === 2 ? ""       : "none";
      // Step 3 has no footer (buttons inside panel)
    }

    function ocrHandleFile(file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { alert("File quá 5MB, vui lòng chọn ảnh nhỏ hơn."); return; }
      _ocrFile = file;
      const reader = new FileReader();
      reader.onload = e => {
        const src = e.target.result;
        document.getElementById("ocr-preview-img").src    = src;
        document.getElementById("ocr-preview-name").textContent = file.name;
        document.getElementById("ocr-preview-wrap").style.display = "";
        document.getElementById("ocr-drop-zone").style.display    = "none";
        document.getElementById("ocr-status-txt").textContent     = `✅ ${file.name} — Nhấn "Quét tài liệu" để tiếp tục`;
      };
      reader.readAsDataURL(file);
    }

    function ocrHandleDrop(e) {
      e.preventDefault();
      document.getElementById("ocr-drop-zone").classList.remove("drag");
      ocrHandleFile(e.dataTransfer.files[0]);
    }

    function ocrStartScanDots() {
      const dots = document.querySelectorAll(".ocr-scan-step-dot");
      let idx = 0;
      dots.forEach(d => d.classList.remove("active"));
      dots[0].classList.add("active");
      _ocrScanDotTimer = setInterval(() => {
        dots.forEach(d => d.classList.remove("active"));
        idx = (idx + 1) % dots.length;
        dots[idx].classList.add("active");
      }, 900);
    }

    async function ocrStartScan() {
      _ocrPatientId = parseInt(document.getElementById("ocr-patient-select").value) || 0;
      if (!_ocrPatientId) { alert("Vui lòng chọn bệnh nhân trước khi quét."); return; }
      if (!_ocrFile)      { alert("Vui lòng chọn ảnh tài liệu cần quét."); return; }

      const btn = document.getElementById("ocr-scan-btn");
      btn.disabled = true;
      document.getElementById("ocr-scanning").style.display    = "";
      document.getElementById("ocr-preview-wrap").style.display = "none";
      document.getElementById("ocr-drop-zone").style.display    = "none";
      ocrStartScanDots();

      try {
        const form = new FormData();
        form.append("file", _ocrFile);
        const res  = await fetch(`${SMTP_SERVER}/api/ocr/import-record`, {
          method:"POST", credentials:"include", body: form
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Lỗi OCR");

        // Điền form
        const d = json.data || {};
        const today = new Date().toISOString().split("T")[0];
        document.getElementById("ocr-date").value         = ocrParseDate(d.examinationDate) || today;
        document.getElementById("ocr-doctor-name").value  = d.doctorName    || "";
        document.getElementById("ocr-diagnosis").value    = d.diagnosis     || "";
        document.getElementById("ocr-prescription").value = d.prescription  || "";
        document.getElementById("ocr-notes").value        = d.notes         || "";

        // Hiện ảnh tài liệu ở sidebar step 2
        document.getElementById("ocr-preview-img-2").src = document.getElementById("ocr-preview-img").src;

        // Tải tiền sử
        await ocrLoadHistory(_ocrPatientId);
        ocrGoStep(2);
      } catch(e) {
        alert("Không thể đọc tài liệu: " + e.message);
        document.getElementById("ocr-preview-wrap").style.display = "";
      } finally {
        clearInterval(_ocrScanDotTimer);
        btn.disabled = false;
        document.getElementById("ocr-scanning").style.display = "none";
      }
    }

    async function ocrLoadHistory(patientId) {
      try {
        const res  = await fetch(`${SMTP_SERVER}/api/ocr/patient-history/${patientId}`, { credentials:"include" });
        const data = await res.json();
        const panel = document.getElementById("ocr-history-panel");
        const list  = document.getElementById("ocr-history-list");

        const all = [
          ...(data.records      || []).map(r => ({ date:r.examinationDate, diag:r.diagnosis, presc:r.prescription, doctor:r.doctorName, spec:r.specialty })),
          ...(data.appointments || []).map(a => ({ date:a.appointmentDate, diag:a.diagnosis||a.symptoms, presc:a.prescription, doctor:a.doctorName, spec:a.specialty }))
        ].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,6);

        if (!all.length) { panel.style.display = "none"; return; }
        list.innerHTML = all.map(r => `
          <div class="ocr-history-item">
            <div class="ocr-history-item-date">
              📅 ${new Date(r.date).toLocaleDateString("vi-VN")}${r.doctor ? " · " + r.doctor : ""}${r.spec ? " (" + r.spec + ")" : ""}
            </div>
            <div class="ocr-history-item-diag">
              🔹 ${r.diag || "—"}
              ${r.presc ? `<br>💊 <span style="opacity:.8">${r.presc.slice(0,90)}${r.presc.length>90?"…":""}</span>` : ""}
            </div>
          </div>`).join("");
        panel.style.display = "";
      } catch { /* im lặng */ }
    }

    async function ocrSaveRecord() {
      const diagnosis = document.getElementById("ocr-diagnosis").value.trim();
      if (!diagnosis) { alert("Vui lòng nhập chẩn đoán trước khi lưu."); return; }

      const saveBtn = document.querySelector("#ocr-footer-2 .ocr-btn-primary");
      saveBtn.disabled = true;
      saveBtn.innerHTML = "⏳ Đang lưu…";

      try {
        const dateVal = document.getElementById("ocr-date").value;
        const res  = await fetch(`${SMTP_SERVER}/api/ocr/save-record`, {
          method:"POST", credentials:"include",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            patientId:       _ocrPatientId,
            doctorId:        0,
            examinationDate: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
            diagnosis,
            prescription: document.getElementById("ocr-prescription").value.trim(),
            notes:        document.getElementById("ocr-notes").value.trim(),
          })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        const patName = document.getElementById("ocr-patient-select").selectedOptions[0]?.text?.split(" · ")[0] || "";
        document.getElementById("ocr-success-msg").innerHTML =
          `Hồ sơ của <strong>${patName}</strong> đã được lưu thành công (Mã hồ sơ: <strong>#${json.recordId}</strong>).<br>
           Chatbot AI sẽ sử dụng thông tin này trong các lần tư vấn tiếp theo.`;
        ocrGoStep(3);
      } catch(e) {
        alert("Lưu thất bại: " + e.message);
        saveBtn.disabled = false;
        saveBtn.innerHTML = "<span>💾</span> Lưu vào hồ sơ bệnh nhân";
      }
    }

    function ocrReset() {
      _ocrFile = null; _ocrPatientId = 0;
      document.getElementById("ocr-file-input").value           = "";
      document.getElementById("ocr-preview-img").src            = "";
      document.getElementById("ocr-preview-img-2").src          = "";
      document.getElementById("ocr-preview-wrap").style.display = "none";
      document.getElementById("ocr-drop-zone").style.display    = "";
      document.getElementById("ocr-history-panel").style.display = "none";
      document.getElementById("ocr-status-txt").textContent     = "Chọn bệnh nhân và tải ảnh lên để bắt đầu";
      ocrGoStep(1);
    }

    function ocrParseDate(str) {
      if (!str) return "";
      const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
      const d = new Date(str);
      return isNaN(d) ? "" : d.toISOString().split("T")[0];
    }
