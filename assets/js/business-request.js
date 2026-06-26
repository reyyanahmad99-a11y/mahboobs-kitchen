(function () {
  "use strict";

  var form = document.getElementById("cardRequestForm");
  if (!form) return;

  var statusEl = document.getElementById("formStatus");
  var btn = document.getElementById("requestBtn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "Wird gesendet …";
    statusEl.textContent = "";
    statusEl.className = "form-status";

    fetch(form.action, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new FormData(form),
    }).then(function (response) {
      if (!response.ok) throw new Error("send failed");
      statusEl.textContent = "Danke! Wir melden uns in Kürze bei Ihnen und richten Ihren Zugang ein.";
      statusEl.className = "form-status form-status--ok";
      form.reset();
      btn.textContent = "Anfrage gesendet ✓";
    }).catch(function () {
      statusEl.textContent = "Senden hat leider nicht geklappt. Bitte versuchen Sie es erneut oder rufen Sie uns an.";
      statusEl.className = "form-status form-status--error";
      btn.disabled = false;
      btn.textContent = "Anfrage senden";
    });
  });
})();
