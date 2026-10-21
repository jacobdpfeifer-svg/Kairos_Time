// Kairos landing page: no build step, no framework, no backend.
(function () {
  "use strict";

  // Margin notes and the marker swipe draw in once, when they scroll into view.
  // Without JS (or with reduced motion) they are simply shown.
  function initReveal() {
    var targets = document.querySelectorAll(".note, .mark");
    if (!("IntersectionObserver" in window)) return;
    document.documentElement.classList.add("js");
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.6 }
    );
    targets.forEach(function (el) {
      io.observe(el);
    });
  }

  // Email capture: there is no backend yet, and the copy says so. Submitting opens
  // the visitor's own mail client addressed to the maintainer with the address in
  // the body, so nothing is silently dropped and nothing pretends to be saved.
  function initEmailForm() {
    var form = document.getElementById("waitlist-form");
    if (!form) return;
    var input = document.getElementById("waitlist-email");
    var status = document.getElementById("waitlist-status");
    form.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var email = (input.value || "").trim();
      var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!valid) {
        status.textContent = "That doesn't look like a full email address. Try again?";
        status.className = "form-status err";
        input.focus();
        return;
      }
      var subject = encodeURIComponent("Kairos beta: early access");
      var body = encodeURIComponent(
        "Please let me know when there's a spot in the Kairos Mac beta." +
        "\n\nMy email: " + email + "\n"
      );
      var to = (window.KAIROS_CONFIG && window.KAIROS_CONFIG.contactEmail) || "jacobdpfeifer@gmail.com";
      var mailto = "mailto:" + to + "?subject=" + subject + "&body=" + body;
      status.textContent = "Opening your email app so you can send this. Nothing was sent yet.";
      status.className = "form-status ok";
      window.location.href = mailto;
    });
  }

  // The download button stays disabled until config.js names a real release.
  function initDownload() {
    var config = window.KAIROS_CONFIG || {};
    var slot = document.getElementById("dmg-status");
    if (!config.downloadUrl || !slot) return;
    var btn = document.createElement("a");
    btn.className = "btn";
    btn.id = "dmg-status";
    btn.href = config.downloadUrl;
    btn.textContent = "Download for Mac";
    slot.parentNode.replaceChild(btn, slot);
    var copy = document.getElementById("dmg-copy");
    if (copy) copy.textContent = "A signed .dmg that installs like a normal Mac app. No git checkout needed.";
    var note = document.getElementById("dmg-note");
    if (note) note.textContent = config.downloadNote || "";
    var lede = document.getElementById("access-lede");
    if (lede) lede.textContent = "Kairos is in a small Mac beta. Download it below, or read the source on GitHub.";
  }

  // Source links follow config.js so the public repo URL lives in one place.
  function initSourceLinks() {
    var config = window.KAIROS_CONFIG || {};
    if (!config.sourceUrl) return;
    document.querySelectorAll("[data-source-link]").forEach(function (link) {
      link.href = config.sourceUrl;
    });
  }

  // Phones and tablets can't install a Mac app, so point them at the hand-off page.
  function initPhoneHandoff() {
    var F = window.KairosFunnel;
    var banner = document.getElementById("phone-handoff");
    if (!F || !banner) return;
    if (F.isHandheld(F.currentDevice(window))) banner.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    initReveal();
    initEmailForm();
    initDownload();
    initSourceLinks();
    initPhoneHandoff();
    var yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  });
})();
