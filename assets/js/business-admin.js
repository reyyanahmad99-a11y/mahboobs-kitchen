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

  function generateCardCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    var code = "";
    for (var i = 0; i < bytes.length; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return "MK-" + code;
  }

  function insertCompanyWithRetry(client, payload, attemptsLeft) {
    var row = Object.assign({}, payload, { card_code: generateCardCode() });
    return client.from("companies").insert(row).select().single().then(function (res) {
      if (res.error) {
        if (res.error.code === "23505" && attemptsLeft > 0) {
          return insertCompanyWithRetry(client, payload, attemptsLeft - 1);
        }
        throw res.error;
      }
      return res.data;
    });
  }

  window.mkBusiness.requireAdminSession(function (session, client) {
    var allCompanies = [];
    var selectedCompanyId = null;

    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", window.mkBusiness.logout);

    var tableContainer = document.getElementById("companiesTable");
    var searchInput = document.getElementById("searchInput");
    var companySelect = document.getElementById("companySelect");
    var historyPanel = document.getElementById("companyHistoryPanel");

    function statusPill(status) {
      var label = { active: "Aktiv", pending: "Ausstehend", inactive: "Inaktiv" }[status] || status;
      return '<span class="status-pill status-pill--' + status + '">' + label + "</span>";
    }

    function renderTable(companies) {
      if (!companies.length) {
        tableContainer.innerHTML = '<p class="muted">Keine Firmenkunden gefunden.</p>';
        return;
      }
      var rows = companies.map(function (c) {
        return (
          '<tr data-id="' + c.id + '">' +
          "<td>" + escapeHtml(c.company_name) + "</td>" +
          "<td>" + escapeHtml(c.contact_person || "-") + "</td>" +
          "<td>" + escapeHtml(c.card_code) + "</td>" +
          "<td>" + c.points_balance + "</td>" +
          "<td>" + statusPill(c.status) + "</td>" +
          "</tr>"
        );
      }).join("");
      tableContainer.innerHTML =
        '<table class="data-table"><thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Karten-Code</th><th>Punkte</th><th>Status</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>";
      Array.prototype.forEach.call(tableContainer.querySelectorAll("tbody tr"), function (tr) {
        tr.addEventListener("click", function () {
          showHistory(tr.getAttribute("data-id"));
        });
      });
    }

    function renderCompanySelect(companies) {
      companySelect.innerHTML = companies.map(function (c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.company_name) + " (" + c.card_code + ")</option>";
      }).join("");
      if (selectedCompanyId) companySelect.value = selectedCompanyId;
    }

    function applyFilter() {
      var term = searchInput.value.trim().toLowerCase();
      if (!term) {
        renderTable(allCompanies);
        return;
      }
      var filtered = allCompanies.filter(function (c) {
        return [c.company_name, c.contact_person, c.email, c.card_code].some(function (v) {
          return v && v.toLowerCase().indexOf(term) !== -1;
        });
      });
      renderTable(filtered);
    }

    function loadCompanies() {
      return client.from("companies").select("*").order("created_at", { ascending: false }).then(function (res) {
        allCompanies = res.data || [];
        applyFilter();
        renderCompanySelect(allCompanies);
      });
    }

    function showHistory(companyId) {
      selectedCompanyId = companyId;
      companySelect.value = companyId;
      var company = allCompanies.filter(function (c) { return c.id === companyId; })[0];
      if (!company) return;

      client.from("points_transactions").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).then(function (res) {
        var rows = (res.data || []).map(function (t) {
          var sign = t.points > 0 ? "+" : "";
          return "<tr><td>" + formatDate(t.created_at) + "</td><td>" + sign + t.points + "</td><td>" + escapeHtml(t.reason || "-") + "</td></tr>";
        }).join("");
        historyPanel.hidden = false;
        historyPanel.innerHTML =
          "<h3>" + escapeHtml(company.company_name) + " — Karten-Code: " + escapeHtml(company.card_code) + "</h3>" +
          "<p><strong>Ansprechpartner:</strong> " + escapeHtml(company.contact_person || "-") + "<br>" +
          "<strong>E-Mail:</strong> " + escapeHtml(company.email || "-") + "<br>" +
          "<strong>Telefon:</strong> " + escapeHtml(company.phone || "-") + "<br>" +
          "<strong>Notizen:</strong> " + escapeHtml(company.notes || "-") + "</p>" +
          "<p><strong>Punktestand:</strong> " + company.points_balance + "</p>" +
          (rows
            ? '<table class="data-table"><thead><tr><th>Datum</th><th>Punkte</th><th>Grund</th></tr></thead><tbody>' + rows + "</tbody></table>"
            : '<p class="muted">Noch keine Punkte-Buchungen.</p>');
      });
    }

    searchInput.addEventListener("input", applyFilter);

    var addCompanyForm = document.getElementById("addCompanyForm");
    var addCompanyStatus = document.getElementById("addCompanyStatus");
    addCompanyForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var payload = {
        company_name: addCompanyForm.companyName.value.trim(),
        contact_person: addCompanyForm.contactPerson.value.trim(),
        email: addCompanyForm.email.value.trim(),
        phone: addCompanyForm.phone.value.trim(),
        notes: addCompanyForm.notes.value.trim()
      };
      addCompanyStatus.textContent = "Wird angelegt …";
      addCompanyStatus.className = "form-status";
      insertCompanyWithRetry(client, payload, 2).then(function (company) {
        addCompanyStatus.textContent = "Angelegt. Karten-Code: " + company.card_code;
        addCompanyStatus.className = "form-status form-status--ok";
        addCompanyForm.reset();
        return loadCompanies();
      }).catch(function () {
        addCompanyStatus.textContent = "Anlegen fehlgeschlagen. Bitte erneut versuchen.";
        addCompanyStatus.className = "form-status form-status--error";
      });
    });

    var addPointsForm = document.getElementById("addPointsForm");
    var addPointsStatus = document.getElementById("addPointsStatus");
    addPointsForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var companyId = companySelect.value;
      var points = parseInt(addPointsForm.points.value, 10);
      var reason = addPointsForm.reason.value.trim();
      if (!companyId || !points) {
        addPointsStatus.textContent = "Bitte Firma und Punktzahl angeben.";
        addPointsStatus.className = "form-status form-status--error";
        return;
      }
      addPointsStatus.textContent = "Wird gespeichert …";
      addPointsStatus.className = "form-status";
      client.from("points_transactions").insert({
        company_id: companyId,
        points: points,
        reason: reason,
        created_by: session.user.id
      }).then(function (res) {
        if (res.error) throw res.error;
        addPointsStatus.textContent = "Punkte gutgeschrieben.";
        addPointsStatus.className = "form-status form-status--ok";
        addPointsForm.reset();
        selectedCompanyId = companyId;
        return loadCompanies().then(function () {
          showHistory(companyId);
        });
      }).catch(function () {
        addPointsStatus.textContent = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
        addPointsStatus.className = "form-status form-status--error";
      });
    });

    loadCompanies();
  });
})();
