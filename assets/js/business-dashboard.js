(function () {
  "use strict";

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function renderOffers(container, offers, company, client) {
    if (!offers.length) {
      container.hidden = true;
      return;
    }
    container.innerHTML = offers.map(function (o) {
      var img = o.image_url
        ? '<img src="' + o.image_url + '" alt="" style="width:100%;height:220px;object-fit:cover;display:block;">'
        : '<div style="width:100%;height:220px;background:var(--color-bg-soft);"></div>';
      return (
        '<div class="card offer-tile" data-offer-tile="' + o.id + '" style="cursor:pointer;padding:0;overflow:hidden;">' +
        img +
        '<div style="padding:18px;"><h3 style="margin:0;">' + escapeHtml(o.title) + "</h3></div>" +
        "</div>"
      );
    }).join("");
    Array.prototype.forEach.call(container.querySelectorAll("[data-offer-tile]"), function (tile) {
      tile.addEventListener("click", function () {
        var offer = offers.filter(function (o) { return o.id === tile.getAttribute("data-offer-tile"); })[0];
        if (offer) openOfferModal(offer, company, client);
      });
    });
  }

  function openOfferModal(offer, company, client) {
    var overlay = document.getElementById("offerModalOverlay");
    var img = document.getElementById("offerModalImage");
    if (offer.image_url) {
      img.src = offer.image_url;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
    document.getElementById("offerModalTitle").textContent = offer.title;
    document.getElementById("offerModalDescription").textContent = offer.description || "";
    var statusEl = document.getElementById("offerModalStatus");
    statusEl.textContent = "";
    statusEl.className = "form-status";

    var requestBtn = document.getElementById("offerModalRequestBtn");
    var callbackBtn = document.getElementById("offerModalCallbackBtn");
    requestBtn.disabled = false;
    requestBtn.textContent = "Unverbindlich anfragen";
    callbackBtn.disabled = false;
    callbackBtn.textContent = "Um Rückruf bitten";

    function sendRequest(type, btn, idleLabel, successLabel) {
      btn.disabled = true;
      client.from("offer_requests").insert({ offer_id: offer.id, company_id: company.id, type: type }).then(function (res) {
        if (res.error && res.error.code !== "23505") throw res.error;
        btn.textContent = res.error ? "Bereits gesendet" : successLabel;
      }).catch(function () {
        btn.textContent = idleLabel;
        btn.disabled = false;
        statusEl.textContent = "Fehler – bitte erneut versuchen.";
        statusEl.className = "form-status form-status--error";
      });
    }

    requestBtn.onclick = function () { sendRequest("interest", requestBtn, "Unverbindlich anfragen", "Anfrage gesendet ✓"); };
    callbackBtn.onclick = function () { sendRequest("callback", callbackBtn, "Um Rückruf bitten", "Rückruf-Wunsch gesendet ✓"); };

    overlay.hidden = false;
  }

  (function wireModalClose() {
    var overlay = document.getElementById("offerModalOverlay");
    if (!overlay) return;
    document.getElementById("offerModalClose").addEventListener("click", function () {
      overlay.hidden = true;
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.hidden = true;
    });
  })();

  function renderHistory(container, transactions) {
    if (!transactions.length) {
      container.innerHTML = '<p class="muted">Noch keine Punkte-Buchungen vorhanden.</p>';
      return;
    }
    var rows = transactions.map(function (t) {
      var sign = t.points > 0 ? "+" : "";
      return "<tr><td>" + formatDate(t.created_at) + "</td><td>" + sign + t.points + "</td><td>" + escapeHtml(t.reason || "-") + "</td></tr>";
    }).join("");
    container.innerHTML =
      '<table class="data-table"><thead><tr><th>Datum</th><th>Punkte</th><th>Grund</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  window.mkBusiness.requireBusinessSession(function (session, client) {
    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", window.mkBusiness.logout);

    client.from("companies").select("*").eq("auth_user_id", session.user.id).maybeSingle().then(function (res) {
      if (res.error || !res.data) {
        document.getElementById("dashboardApp").innerHTML =
          '<p class="muted">Zu diesem Login ist kein Firmenkonto hinterlegt. Bitte Mahboobs Kitchen kontaktieren.</p>';
        return;
      }
      var company = res.data;
      document.getElementById("companyName").textContent = company.company_name;
      document.getElementById("pointsBalance").textContent = company.points_balance;
      document.getElementById("cardNumber").textContent = company.card_code;
      document.getElementById("cardHolderName").textContent = company.company_name;

      client.from("offers").select("*").eq("active", true).order("created_at", { ascending: false }).then(function (offerRes) {
        renderOffers(document.getElementById("offersSection"), offerRes.data || [], company, client);
      });

      return client.from("points_transactions").select("*").eq("company_id", company.id).order("created_at", { ascending: false }).then(function (txRes) {
        renderHistory(document.getElementById("transactionHistory"), txRes.data || []);
      });
    });
  });
})();
