// ============================================================
// MedCare — Lucide icons + GSAP animations
// Phụ thuộc: gsap, ScrollTrigger, lucide (CDN trong <head>)
// ============================================================

/* ----- Khởi tạo Lucide icons ----- */
    // Hàm vẽ icon — gọi lại được khi inject HTML động (news, lịch hẹn...)
    window.refreshIcons = function () {
      if (typeof lucide !== "undefined" && lucide.createIcons) {
        lucide.createIcons();
      }
    };

    // File này nằm cuối <body> nên DOM đã sẵn sàng → vẽ ngay.
    // Nếu CDN Lucide chưa kịp tải (mạng chậm), thử lại tối đa 10 lần.
    (function initLucide(retry) {
      if (typeof lucide !== "undefined" && lucide.createIcons) {
        lucide.createIcons();
      } else if (retry < 10) {
        setTimeout(() => initLucide(retry + 1), 200);
      }
    })(0);

    // Vẽ lại lần nữa sau khi toàn bộ tài nguyên (kể cả CDN) load xong
    window.addEventListener("load", () => window.refreshIcons());

/* ----- GSAP animations ----- */
  (function() {
    // An toàn: nếu GSAP/ScrollTrigger chưa tải được (CDN lỗi),
    // hiện toàn bộ .reveal ngay để không bị mất nội dung.
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
      document.querySelectorAll(".reveal").forEach(el => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return;
    }

    // Đăng ký ScrollTrigger plugin (bắt buộc)
    gsap.registerPlugin(ScrollTrigger);

    // Giảm tần suất gọi callback khi cuộn → ít việc hơn mỗi frame → đỡ giật.
    ScrollTrigger.config({ limitCallbacks: true });

    // ── Accessibility: tôn trọng prefers-reduced-motion ──
    const mm = gsap.matchMedia();

    mm.add({
      // Người dùng bình thường — full animations
      "(prefers-reduced-motion: no-preference)": () => {
        initAnimations();
      },
      // Người dùng yêu cầu giảm chuyển động
      "(prefers-reduced-motion: reduce)": () => {
        // Chỉ reveal các phần tử (không có chuyển động)
        gsap.utils.toArray(".reveal").forEach(el => gsap.set(el, { autoAlpha: 1 }));
      }
    });

    function initAnimations() {

      // ══════════════════════════════════════
      // 1. NAVBAR — slide down từ trên
      // ══════════════════════════════════════
      gsap.from("#site-header", {
        yPercent: -100,
        duration: 0.7,
        ease: "power3.out",
        clearProps: "all"
      });

      // ══════════════════════════════════════
      // 2. HERO — [ĐÃ BỎ animation GSAP]
      //    Hero entrance đã do CSS (animation: fade-up) đảm nhiệm — chạy NGAY
      //    khi tải, không chờ JS. Trước đây GSAP autoAlpha:0 ẩn lại chữ hero
      //    cho tới khi JS (defer) chạy → đẩy LCP của h1.hero-title lên ~3.7s.
      //    Bỏ đoạn này → chữ hiện tức thì → LCP giảm mạnh.
      // ══════════════════════════════════════

      // ══════════════════════════════════════
      // 3. COUNTER ANIMATION — hero stats
      // ══════════════════════════════════════
      document.querySelectorAll(".hstat-num[data-count]").forEach(el => {
        const target = parseInt(el.dataset.count) || 0;
        const suffix = el.textContent.replace(/[0-9]/g, "");
        gsap.fromTo({ val: 0 },
          { val: 0 },
          {
            val: target,
            duration: 1.8,
            delay: 1.0,
            ease: "power1.inOut",
            onUpdate: function() {
              el.textContent = Math.round(this.targets()[0].val) + suffix;
            }
          }
        );
      });

      // ══════════════════════════════════════
      // 4. SCROLL REVEAL — AN TOÀN
      //    Dùng gsap.from() qua ScrollTrigger.batch:
      //    chỉ ẩn phần tử KHI nó vào viewport rồi reveal ngay.
      //    Nếu trigger không kích hoạt, phần tử giữ trạng thái
      //    hiển thị mặc định của CSS → KHÔNG BAO GIỜ kẹt trắng.
      // ══════════════════════════════════════

      // Service cards — stagger
      ScrollTrigger.batch(".svc-card", {
        onEnter: batch => gsap.from(batch,
          { opacity: 0, y: 40, duration: 0.6, stagger: 0.1, ease: "power2.out", overwrite: true }
        ),
        start: "top 92%"
      });

      // News cards — fade + slide
      ScrollTrigger.batch(".news-card", {
        onEnter: batch => gsap.from(batch,
          { opacity: 0, y: 30, duration: 0.55, stagger: 0.1, ease: "power2.out", overwrite: true }
        ),
        start: "top 92%"
      });

      // Các section/card chung (sidebar card, slider, appt, ai-form...)
      // Bỏ qua: news-section & section chứa svc-card (đã tự animate),
      // và phần tử đang ẩn (dashboard chờ đăng nhập).
      const revealEls = gsap.utils.toArray(".reveal").filter(el =>
        !el.classList.contains("news-section") &&
        !el.querySelector(".svc-card") &&
        !el.querySelector(".news-card") &&
        getComputedStyle(el).display !== "none"
      );
      ScrollTrigger.batch(revealEls, {
        onEnter: batch => gsap.from(batch,
          { opacity: 0, y: 36, duration: 0.7, stagger: 0.12, ease: "power2.out", overwrite: true }
        ),
        start: "top 90%"
      });

      // ══════════════════════════════════════
      // 5. DOCTOR DASHBOARD — counter cho metrics
      // ══════════════════════════════════════
      function animateDashboardCounters() {
        document.querySelectorAll(".dd-metric-num").forEach(el => {
          const raw = el.textContent.trim();
          const num = parseInt(raw.replace(/[^0-9]/g, "")) || 0;
          const suffix = raw.replace(/[0-9]/g, "");
          if (num === 0) return;
          gsap.fromTo({ val: 0 },
            { val: 0 },
            {
              val: num,
              duration: 1.4,
              ease: "power2.out",
              onUpdate: function() {
                el.textContent = Math.round(this.targets()[0].val) + suffix;
              }
            }
          );
        });
      }
      // Animate khi dashboard xuất hiện
      const dd = document.getElementById("doctor-dashboard");
      if (dd) {
        ScrollTrigger.create({
          trigger: dd,
          start: "top 80%",
          once: true,
          onEnter: animateDashboardCounters
        });
      }

      // ══════════════════════════════════════
      // 6. CHATBOT FAB — pulse breathe animation
      // ══════════════════════════════════════
      gsap.to("#chatbot-fab", {
        scale: 1.08,
        duration: 1.4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
      });

      // Fab ping badge
      gsap.to("#fab-ping", {
        scale: 1.3,
        autoAlpha: 0.5,
        duration: 1.0,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
      });

      // ══════════════════════════════════════
      // 7. THẺ DỊCH VỤ — nhấc nhẹ khi hover (chỉ 1 tween vào/ra, không
      //    tính toán theo từng frame → rất nhẹ, mượt trên cả máy yếu).
      // ══════════════════════════════════════
      document.querySelectorAll(".svc-card").forEach(card => {
        const icon = card.querySelector(".svc-icon");
        card.addEventListener("mouseenter", () => {
          gsap.to(card, { y: -6, duration: 0.28, ease: "power2.out" });
          if (icon) gsap.to(icon, { scale: 1.08, duration: 0.28, ease: "power2.out" });
        });
        card.addEventListener("mouseleave", () => {
          gsap.to(card, { y: 0, duration: 0.35, ease: "power2.out" });
          if (icon) gsap.to(icon, { scale: 1, duration: 0.35, ease: "power2.out" });
        });
      });

      // (Mục 8 cũ — slider — đã gộp vào batch reveal an toàn ở mục 4)

      // (Mục 9 — header shadow đã được xử lý qua class .solid trong app.js,
      //  không cần GSAP onUpdate riêng — xoá để tránh tween mới mỗi frame gây giật)

      // Re-run ScrollTrigger khi news cards được inject động
      // Dùng rAF để tránh layout-jump: refresh chạy sau khi browser đã paint frame đó xong.
      const newsObserver = new MutationObserver(() => {
        requestAnimationFrame(() => ScrollTrigger.refresh());
        newsObserver.disconnect();
      });
      const newsGrid = document.getElementById("news-grid");
      if (newsGrid) newsObserver.observe(newsGrid, { childList: true });

      // ══════════════════════════════════════
      // 10. GSAP NÂNG CAO — scroll-driven (gsap-skills)
      // ══════════════════════════════════════

      // (a) Thanh tiến trình cuộn ở đỉnh trang
      const bar = document.createElement("div");
      bar.style.cssText =
        "position:fixed;top:0;left:0;height:3px;width:100%;transform:scaleX(0);" +
        "transform-origin:left;z-index:9999;pointer-events:none;" +
        "background:linear-gradient(90deg,#1057a4,#00b896)";
      document.body.appendChild(bar);
      gsap.to(bar, {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      });

      // (b) [ĐÃ BỎ] Parallax tiêu đề — gây nhiều tween scrub chạy mỗi frame
      //     khi cuộn → giật. Hiệu ứng gạch chân (mục 11) đã đủ điểm nhấn.

      // (c) Nội dung hero trôi lên & mờ dần khi cuộn xuống (parallax)
      const heroContent = document.querySelector(".hero-content");
      if (heroContent) {
        gsap.to(heroContent, {
          y: 90,
          autoAlpha: 0.25,
          ease: "none",
          scrollTrigger: {
            trigger: "#hero",
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
      }

      // (d) Nút CTA "từ trường" — hơi hút theo con trỏ (micro-interaction)
      gsap.utils.toArray(".btn-appt, .hs-submit, .cb-send").forEach((btn) => {
        btn.addEventListener("mousemove", (e) => {
          const r = btn.getBoundingClientRect();
          gsap.to(btn, {
            x: (e.clientX - r.left - r.width / 2) * 0.55,
            y: (e.clientY - r.top - r.height / 2) * 0.7,
            scale: 1.06,
            duration: 0.3,
            ease: "power2.out",
          });
        });
        btn.addEventListener("mouseleave", () => {
          gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1,0.4)" });
        });
      });

      // ══════════════════════════════════════
      // 11. ĐIỂM NHẤN NHẸ — chỉ giữ thứ "rẻ" về hiệu năng.
      //     (Đã GỠ đèn rọi hero + film-grain vì gây repaint nặng/giật.)
      // ══════════════════════════════════════

      // Gạch chân gradient dưới tiêu đề mục "tự vẽ" khi cuộn tới — rất nhẹ.
      gsap.utils.toArray(".sec-title").forEach((title) => {
        if (title.offsetParent === null) return;
        gsap.to(title, {
          "--line": 1,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: { trigger: title, start: "top 85%", once: true },
        });
      });

    } // end initAnimations
  })();
