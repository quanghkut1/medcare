// ============================================================
// MedCare — Tự ẩn thanh header/nav khi cuộn XUỐNG, hiện khi cuộn LÊN.
// Dùng chung cho trang chủ và mọi trang con (#site-header, #site-nav).
// ============================================================
(function () {
  const header = document.getElementById("site-header");
  const nav = document.getElementById("site-nav");
  const roleBanner = document.getElementById("role-banner"); // thanh vai trò (khi đăng nhập)
  if (!header && !nav) return;

  let lastY = window.scrollY || 0;
  let ticking = false;
  const DELTA = 6;        // ngưỡng nhỏ → tránh rung khi cuộn nhẹ
  const SHOW_NEAR_TOP = 130; // gần đỉnh trang thì LUÔN hiện

  function setHidden(hidden) {
    if (header) header.classList.toggle("nav-hidden", hidden);
    if (nav) nav.classList.toggle("nav-hidden", hidden);
    if (roleBanner) roleBanner.classList.toggle("nav-hidden", hidden);
  }

  function update() {
    const y = window.scrollY || 0;

    if (y < SHOW_NEAR_TOP) {
      setHidden(false);                 // gần đỉnh → hiện
    } else if (y > lastY + DELTA) {
      setHidden(true);                  // cuộn xuống → ẩn
    } else if (y < lastY - DELTA) {
      setHidden(false);                 // cuộn lên → hiện
    }

    if (Math.abs(y - lastY) > DELTA) lastY = y;
    ticking = false;
  }

  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true }
  );
})();
