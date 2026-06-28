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

  function personalize(template, company) {
    return template
      .split("{{ansprechpartner}}").join(company.contact_person || company.company_name)
      .split("{{firma}}").join(company.company_name);
  }

  function buildWhatsAppLink(phone, message) {
    var digits = (phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (digits.indexOf("0") === 0) digits = "49" + digits.slice(1);
    return "https://wa.me/" + digits + "?text=" + encodeURIComponent(message);
  }

  function buildMailtoLink(email, subject, body) {
    return "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
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
    var whatsappTemplate = document.getElementById("whatsappTemplate");
    var emailTemplate = document.getElementById("emailTemplate");
    var emailSubjectTemplate = document.getElementById("emailSubjectTemplate");
    var offersList = document.getElementById("offersList");
    var offerRequestsList = document.getElementById("offerRequestsList");
    var allOffers = [];

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
        var action =
          (c.phone ? '<button type="button" class="btn btn--whatsapp" data-wa-id="' + c.id + '" style="padding:8px 16px;font-size:0.85rem;">✉ WhatsApp</button>' : "") +
          (c.email ? '<button type="button" class="btn btn--dark" data-email-id="' + c.id + '" style="padding:8px 16px;font-size:0.85rem;margin-left:6px;">✉ E-Mail</button>' : "") +
          (!c.phone && !c.email ? '<span class="muted">Keine Kontaktdaten</span>' : "");
        return (
          '<tr data-id="' + c.id + '">' +
          "<td>" + escapeHtml(c.company_name) + "</td>" +
          "<td>" + escapeHtml(c.contact_person || "-") + "</td>" +
          "<td>" + escapeHtml(c.card_code) + "</td>" +
          "<td>" + c.points_balance + "</td>" +
          "<td>" + statusPill(c.status) + "</td>" +
          "<td>" + action + "</td>" +
          "</tr>"
        );
      }).join("");
      tableContainer.innerHTML =
        '<table class="data-table"><thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Karten-Code</th><th>Punkte</th><th>Status</th><th>Aktion</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>";
      Array.prototype.forEach.call(tableContainer.querySelectorAll("tbody tr"), function (tr) {
        tr.addEventListener("click", function () {
          showHistory(tr.getAttribute("data-id"));
        });
      });
      Array.prototype.forEach.call(tableContainer.querySelectorAll("[data-wa-id]"), function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var company = allCompanies.filter(function (c) { return c.id === btn.getAttribute("data-wa-id"); })[0];
          if (!company) return;
          var message = personalize(whatsappTemplate.value.trim(), company);
          window.open(buildWhatsAppLink(company.phone, message), "_blank");
        });
      });
      Array.prototype.forEach.call(tableContainer.querySelectorAll("[data-email-id]"), function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var company = allCompanies.filter(function (c) { return c.id === btn.getAttribute("data-email-id"); })[0];
          if (!company) return;
          var subject = personalize(emailSubjectTemplate.value.trim(), company);
          var body = personalize(emailTemplate.value.trim(), company);
          window.location.href = buildMailtoLink(company.email, subject, body);
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
            : '<p class="muted">Noch keine Punkte-Buchungen.</p>') +
          '<div class="btn-row" style="margin-top:20px;"><button type="button" class="btn" id="deleteCompanyBtn" style="background:#b32a2a;color:#fff;">Kunde löschen</button></div>';

        document.getElementById("deleteCompanyBtn").addEventListener("click", function () {
          if (!window.confirm("Diese Firma inklusive Punkte-Historie wirklich unwiderruflich löschen?")) return;
          client.from("companies").delete().eq("id", companyId).then(function (delRes) {
            if (delRes.error) throw delRes.error;
            historyPanel.hidden = true;
            historyPanel.innerHTML = "";
            selectedCompanyId = null;
            loadCompanies();
          }).catch(function () {
            window.alert("Löschen fehlgeschlagen. Bitte erneut versuchen.");
          });
        });
      });
    }

    function renderOffers(offers) {
      if (!offers.length) {
        offersList.innerHTML = '<p class="muted">Noch keine Angebote vorhanden.</p>';
        return;
      }
      offersList.innerHTML = offers.map(function (o) {
        var img = o.image_url
          ? '<img src="' + o.image_url + '" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:var(--radius);margin-bottom:12px;">'
          : "";
        var pill = '<span class="status-pill status-pill--' + (o.active ? "active" : "inactive") + '">' + (o.active ? "Aktiv" : "Inaktiv") + "</span>";
        return (
          '<div class="card" style="margin-bottom:16px;">' +
          img +
          '<h4 style="margin:0 0 6px;">' + escapeHtml(o.title) + "</h4>" +
          '<p class="muted" style="margin:0 0 10px;">' + escapeHtml(o.description || "") + "</p>" +
          pill +
          '<div class="btn-row" style="margin-top:12px;">' +
          '<button type="button" class="btn btn--dark" data-toggle-offer="' + o.id + '" style="padding:8px 16px;font-size:0.85rem;">' + (o.active ? "Deaktivieren" : "Aktivieren") + "</button>" +
          '<button type="button" class="btn btn--dark" data-delete-offer="' + o.id + '" style="padding:8px 16px;font-size:0.85rem;">Löschen</button>' +
          "</div>" +
          '<div class="btn-row" style="margin-top:8px;">' +
          '<button type="button" class="btn btn--dark" data-copy-offer="' + o.id + '" style="padding:8px 16px;font-size:0.85rem;">Link kopieren</button>' +
          '<button type="button" class="btn btn--whatsapp" data-prep-whatsapp="' + o.id + '" style="padding:8px 16px;font-size:0.85rem;">Für WhatsApp vorbereiten</button>' +
          '<button type="button" class="btn btn--dark" data-prep-email="' + o.id + '" style="padding:8px 16px;font-size:0.85rem;">Für E-Mail vorbereiten</button>' +
          "</div></div>"
        );
      }).join("");
      Array.prototype.forEach.call(offersList.querySelectorAll("[data-toggle-offer]"), function (btn) {
        btn.addEventListener("click", function () {
          var offer = allOffers.filter(function (o) { return o.id === btn.getAttribute("data-toggle-offer"); })[0];
          if (!offer) return;
          client.from("offers").update({ active: !offer.active }).eq("id", offer.id).then(function () { loadOffers(); });
        });
      });
      Array.prototype.forEach.call(offersList.querySelectorAll("[data-delete-offer]"), function (btn) {
        btn.addEventListener("click", function () {
          if (!window.confirm("Dieses Angebot wirklich löschen?")) return;
          client.from("offers").delete().eq("id", btn.getAttribute("data-delete-offer")).then(function () { loadOffers(); });
        });
      });
      Array.prototype.forEach.call(offersList.querySelectorAll("[data-copy-offer]"), function (btn) {
        btn.addEventListener("click", function () {
          var link = window.location.origin + "/business/dashboard/?offer=" + btn.getAttribute("data-copy-offer");
          navigator.clipboard.writeText(link).then(function () {
            btn.textContent = "Kopiert ✓";
            setTimeout(function () { btn.textContent = "Link kopieren"; }, 2000);
          }).catch(function () {
            btn.textContent = "Kopieren fehlgeschlagen";
          });
        });
      });
      Array.prototype.forEach.call(offersList.querySelectorAll("[data-prep-whatsapp]"), function (btn) {
        btn.addEventListener("click", function () {
          var offer = allOffers.filter(function (o) { return o.id === btn.getAttribute("data-prep-whatsapp"); })[0];
          if (!offer) return;
          var link = window.location.origin + "/business/dashboard/?offer=" + offer.id;
          whatsappTemplate.value = 'Hallo {{ansprechpartner}}, schauen Sie sich unser neues Angebot an: "' + offer.title + '" – ' + link;
          whatsappTemplate.scrollIntoView({ behavior: "smooth", block: "center" });
          whatsappTemplate.focus();
        });
      });
      Array.prototype.forEach.call(offersList.querySelectorAll("[data-prep-email]"), function (btn) {
        btn.addEventListener("click", function () {
          var offer = allOffers.filter(function (o) { return o.id === btn.getAttribute("data-prep-email"); })[0];
          if (!offer) return;
          var link = window.location.origin + "/business/dashboard/?offer=" + offer.id;
          emailSubjectTemplate.value = "Neues Angebot: " + offer.title;
          emailTemplate.value = 'Hallo {{ansprechpartner}},\n\nschauen Sie sich unser neues Angebot an: "' + offer.title + '"\n' + link + "\n\nViele Grüße\nMahboobs Kitchen";
          emailTemplate.scrollIntoView({ behavior: "smooth", block: "center" });
          emailTemplate.focus();
        });
      });
    }

    function loadOffers() {
      return client.from("offers").select("*").order("created_at", { ascending: false }).then(function (res) {
        allOffers = res.data || [];
        renderOffers(allOffers);
      });
    }

    function loadOfferRequests() {
      return client.from("offer_requests")
        .select("*, company:companies(company_name), offer:offers(title)")
        .order("created_at", { ascending: false })
        .limit(50)
        .then(function (res) {
          var requests = res.data || [];
          if (!requests.length) {
            offerRequestsList.innerHTML = '<p class="muted">Noch keine Anfragen.</p>';
            return;
          }
          var typeLabels = { interest: "Anfrage", callback: "Rückruf-Wunsch" };
          var rows = requests.map(function (r) {
            return (
              "<tr><td>" + escapeHtml(r.company ? r.company.company_name : "-") + "</td>" +
              "<td>" + escapeHtml(r.offer ? r.offer.title : "-") + "</td>" +
              "<td>" + escapeHtml(typeLabels[r.type] || r.type) + "</td>" +
              "<td>" + formatDate(r.created_at) + "</td></tr>"
            );
          }).join("");
          offerRequestsList.innerHTML =
            '<table class="data-table"><thead><tr><th>Firma</th><th>Angebot</th><th>Typ</th><th>Datum</th></tr></thead><tbody>' + rows + "</tbody></table>";
        });
    }

    var addOfferForm = document.getElementById("addOfferForm");
    var addOfferStatus = document.getElementById("addOfferStatus");
    addOfferForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var file = addOfferForm.image.files[0];
      var title = addOfferForm.offerTitle.value.trim();
      var description = addOfferForm.offerDescription.value.trim();
      if (file && file.size > 5 * 1024 * 1024) {
        addOfferStatus.textContent = "Bild ist zu groß (max. 5 MB).";
        addOfferStatus.className = "form-status form-status--error";
        return;
      }
      addOfferStatus.textContent = "Wird veröffentlicht …";
      addOfferStatus.className = "form-status";

      var uploadStep = file
        ? client.storage.from("offer-images")
            .upload(Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9.\-]/g, "_"), file)
            .then(function (res) {
              if (res.error) throw res.error;
              return client.storage.from("offer-images").getPublicUrl(res.data.path).data.publicUrl;
            })
        : Promise.resolve(null);

      uploadStep.then(function (imageUrl) {
        return client.from("offers").insert({ title: title, description: description, image_url: imageUrl });
      }).then(function (res) {
        if (res.error) throw res.error;
        addOfferStatus.textContent = "Angebot veröffentlicht.";
        addOfferStatus.className = "form-status form-status--ok";
        addOfferForm.reset();
        loadOffers();
      }).catch(function () {
        addOfferStatus.textContent = "Veröffentlichen fehlgeschlagen. Bitte erneut versuchen.";
        addOfferStatus.className = "form-status form-status--error";
      });
    });

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
        showNewCompanyLink(company);
        return loadCompanies();
      }).catch(function () {
        addCompanyStatus.textContent = "Anlegen fehlgeschlagen. Bitte erneut versuchen.";
        addCompanyStatus.className = "form-status form-status--error";
      });
    });

    function showNewCompanyLink(company) {
      var link = window.location.origin + "/business/aktivieren/?code=" + encodeURIComponent(company.card_code);
      document.getElementById("newCompanyName").textContent = company.company_name;
      document.getElementById("newCompanyLink").textContent = link;

      var copyBtn = document.getElementById("copyLinkBtn");
      copyBtn.textContent = "Link kopieren";
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(link).then(function () {
          copyBtn.textContent = "Kopiert ✓";
        }).catch(function () {
          copyBtn.textContent = "Kopieren fehlgeschlagen";
        });
      };

      var waBtn = document.getElementById("sendLinkWhatsAppBtn");
      waBtn.style.display = company.phone ? "" : "none";
      waBtn.onclick = function () {
        var message =
          "Willkommen bei der MK Business Karte! Klicken Sie einfach auf diesen Link, Ihr persönlicher Code ist schon eingetragen – " +
          "Sie müssen nur noch eine E-Mail-Adresse und ein Passwort vergeben: " + link;
        window.open(buildWhatsAppLink(company.phone, message), "_blank");
      };

      document.getElementById("newCompanyLinkBox").hidden = false;
    }

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
    loadOffers();
    loadOfferRequests();
  });
})();
