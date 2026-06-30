(function () {
  "use strict";

  var DAILY_GOAL = 10;

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function generateCardCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    var code = "";
    for (var i = 0; i < bytes.length; i++) code += chars[bytes[i] % chars.length];
    return "MK-" + code;
  }

  function buildWhatsAppLink(phone, message) {
    var digits = (phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (digits.indexOf("0") === 0) digits = "49" + digits.slice(1);
    return "https://wa.me/" + digits + "?text=" + encodeURIComponent(message);
  }

  function buildTelLink(phone) {
    var digits = (phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (digits.indexOf("0") === 0) digits = "49" + digits.slice(1);
    return "tel:+" + digits;
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

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysISO(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function formatSimpleDate(iso) {
    var parts = iso.split("-");
    return parts[2] + "." + parts[1] + "." + parts[0];
  }

  function dateOnly(value) {
    return value ? value.slice(0, 10) : null;
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  var statusLabels = { lead: "Lead", contacted: "Kontaktiert", customer: "Kunde", lost: "Kein Interesse" };

  window.mkBusiness.requireAdminSession(function (session, client) {
    var allProspects = [];
    var currentPeople = [];
    var selectedProspectId = null;
    var showArchive = false;

    var dailyCounterEl = document.getElementById("dailyCounter");

    var addProspectBtn = document.getElementById("addProspectBtn");
    var addProspectOverlay = document.getElementById("addProspectOverlay");
    var addProspectClose = document.getElementById("addProspectClose");
    var addProspectForm = document.getElementById("addProspectForm");
    var addProspectStatus = document.getElementById("addProspectStatus");

    var pipelineLeads = document.getElementById("pipelineLeads");
    var pipelineToday = document.getElementById("pipelineToday");
    var pipelineTomorrow = document.getElementById("pipelineTomorrow");
    var pipelineLater = document.getElementById("pipelineLater");
    var pipelineArchive = document.getElementById("pipelineArchive");
    var toggleArchiveBtn = document.getElementById("toggleArchiveBtn");

    var detailOverlay = document.getElementById("prospectDetailOverlay");
    var detailClose = document.getElementById("prospectDetailClose");
    var detailStatus = document.getElementById("prospectDetailStatus");
    var statusSelect = document.getElementById("prospectStatusSelect");
    var detailName = document.getElementById("prospectDetailName");
    var detailCategory = document.getElementById("prospectDetailCategory");
    var detailNotes = document.getElementById("prospectDetailNotes");
    var saveNotesBtn = document.getElementById("prospectDetailSaveNotes");
    var peopleListEl = document.getElementById("prospectDetailPeople");
    var newPersonName = document.getElementById("newPersonName");
    var newPersonPhone = document.getElementById("newPersonPhone");
    var newPersonEmail = document.getElementById("newPersonEmail");
    var addPersonBtn = document.getElementById("addPersonBtn");
    var detailWebsite = document.getElementById("prospectDetailWebsite");
    var detailAddress = document.getElementById("prospectDetailAddress");
    var nextContactDate = document.getElementById("nextContactDate");
    var nextContactNotes = document.getElementById("nextContactNotes");
    var logContactBtn = document.getElementById("logContactBtn");
    var logStatus = document.getElementById("logStatus");
    var historyEl = document.getElementById("prospectDetailHistory");
    var markCustomerBtn = document.getElementById("markCustomerBtn");
    var markLostBtn = document.getElementById("markLostBtn");
    var conversionLinkBox = document.getElementById("conversionLinkBox");
    var conversionCompanyName = document.getElementById("conversionCompanyName");
    var conversionLink = document.getElementById("conversionLink");
    var conversionCopyBtn = document.getElementById("conversionCopyBtn");
    var conversionWhatsAppBtn = document.getElementById("conversionWhatsAppBtn");

    function loadDailyCounter() {
      client.from("prospect_contacts").select("id", { count: "exact", head: true }).eq("contact_date", todayISO()).then(function (res) {
        dailyCounterEl.textContent = (res.count || 0) + " von " + DAILY_GOAL + " heute kontaktiert";
      });
    }

    function renderProspectCard(p, index, total) {
      var moveBtnStyle = "background:none;border:1px solid var(--color-border);border-radius:6px;cursor:pointer;padding:2px 8px;font-size:0.8rem;color:var(--color-text-soft);";
      var upBtn = index > 0 ? '<button type="button" data-move="up" style="' + moveBtnStyle + '">▲</button>' : "";
      var downBtn = index < total - 1 ? '<button type="button" data-move="down" style="' + moveBtnStyle + '">▼</button>' : "";
      return (
        '<div class="card prospect-card" data-prospect-id="' + p.id + '" style="cursor:pointer;margin-bottom:10px;padding:16px 20px;">' +
        '<div class="btn-row" style="justify-content:space-between;align-items:center;">' +
        "<div><strong>" + escapeHtml(p.name) + '</strong> <span class="muted">(' + escapeHtml(p.category) + ")</span></div>" +
        '<div style="display:flex;align-items:center;gap:8px;">' + upBtn + downBtn +
        '<span class="status-pill status-pill--' + p.status + '">' + statusLabels[p.status] + "</span></div>" +
        "</div>" +
        (p.next_contact_date ? '<p class="muted" style="margin:6px 0 0;font-size:0.8rem;">Termin: ' + formatDateTime(p.next_contact_date) + "</p>" : "") +
        (p.notes ? '<p class="muted" style="margin:8px 0 0;font-size:0.85rem;">' + escapeHtml(p.notes.slice(0, 120)) + "</p>" : "") +
        "</div>"
      );
    }

    function moveProspect(bucket, id, dir) {
      var idx = bucket.findIndex(function (p) { return p.id === id; });
      var swapIdx = dir === "up" ? idx - 1 : idx + 1;
      if (idx === -1 || swapIdx < 0 || swapIdx >= bucket.length) return;
      var reordered = bucket.slice();
      var tmp = reordered[idx];
      reordered[idx] = reordered[swapIdx];
      reordered[swapIdx] = tmp;
      Promise.all(reordered.map(function (p, i) {
        return client.from("prospects").update({ sort_order: i }).eq("id", p.id);
      })).then(function () { loadProspects(); });
    }

    function renderBucket(container, title, prospects) {
      if (!prospects.length) {
        container.innerHTML = "";
        return;
      }
      container.innerHTML = '<h3 style="margin-bottom:12px;">' + title + " (" + prospects.length + ")</h3>" +
        prospects.map(function (p, i) { return renderProspectCard(p, i, prospects.length); }).join("");
      Array.prototype.forEach.call(container.querySelectorAll("[data-prospect-id]"), function (card) {
        card.addEventListener("click", function (e) {
          if (e.target.closest("[data-move]")) return;
          openDetail(card.getAttribute("data-prospect-id"));
        });
      });
      Array.prototype.forEach.call(container.querySelectorAll("[data-move]"), function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var card = btn.closest("[data-prospect-id]");
          moveProspect(prospects, card.getAttribute("data-prospect-id"), btn.getAttribute("data-move"));
        });
      });
    }

    function renderPipeline() {
      var today = todayISO();
      var tomorrow = addDaysISO(1);
      var active = allProspects.filter(function (p) { return p.status === "lead" || p.status === "contacted"; });
      var archived = allProspects.filter(function (p) { return p.status === "customer" || p.status === "lost"; });

      var leads = active.filter(function (p) { return !p.next_contact_date; });
      var dueToday = active.filter(function (p) { return p.next_contact_date && dateOnly(p.next_contact_date) <= today; });
      var dueTomorrow = active.filter(function (p) { return dateOnly(p.next_contact_date) === tomorrow; });
      var later = active.filter(function (p) { return p.next_contact_date && dateOnly(p.next_contact_date) > tomorrow; });

      renderBucket(pipelineLeads, "Neue Leads", leads);
      renderBucket(pipelineToday, "Heute", dueToday);
      renderBucket(pipelineTomorrow, "Morgen", dueTomorrow);
      renderBucket(pipelineLater, "Später", later);
      renderBucket(pipelineArchive, "Archiv", archived);
    }

    function loadProspects() {
      return client.from("prospects").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false }).then(function (res) {
        allProspects = res.data || [];
        renderPipeline();
      });
    }

    function renderPeople(people) {
      currentPeople = people;
      if (!people.length) {
        peopleListEl.innerHTML = '<p class="muted">Noch keine Ansprechpartner.</p>';
        return;
      }
      peopleListEl.innerHTML = people.map(function (person) {
        var tel = person.phone ? buildTelLink(person.phone) : "";
        var meta = [person.phone, person.email].filter(Boolean).map(escapeHtml).join(" · ");
        return (
          '<div style="padding:8px 0;border-bottom:1px solid var(--color-border);">' +
          '<div class="btn-row" style="justify-content:space-between;align-items:center;">' +
          "<div><strong>" + escapeHtml(person.name) + "</strong>" + (meta ? ' <span class="muted" style="font-size:0.85rem;">' + meta + "</span>" : "") + "</div>" +
          (tel ? '<a href="' + tel + '" class="btn btn--dark" style="padding:6px 14px;font-size:0.8rem;">📞 Anrufen</a>' : "") +
          "</div>" +
          (person.email ? '<a href="mailto:' + escapeHtml(person.email) + '" style="font-size:0.8rem;color:var(--color-primary);">' + escapeHtml(person.email) + "</a>" : "") +
          "</div>"
        );
      }).join("");
    }

    function loadPeople(prospectId) {
      return client.from("prospect_people").select("*").eq("prospect_id", prospectId).order("created_at", { ascending: true }).then(function (res) {
        renderPeople(res.data || []);
      });
    }

    function renderHistory(contacts) {
      if (!contacts.length) {
        historyEl.innerHTML = '<p class="muted">Noch keine Einträge.</p>';
        return;
      }
      historyEl.innerHTML = contacts.map(function (c) {
        var when = formatDateTime(c.created_at || c.contact_date);
        var nextBlock = c.next_contact_date
          ? '<div style="margin-top:6px;padding:6px 10px;background:var(--color-bg-soft);border-left:3px solid var(--color-primary);border-radius:0 6px 6px 0;font-size:0.83rem;">📅 Nächster Kontakt: <strong>' + formatDateTime(c.next_contact_date) + "</strong></div>"
          : "";
        return (
          '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--color-border);">' +
          '<span class="muted" style="font-size:0.8rem;">' + when + "</span>" +
          '<p style="margin:4px 0 0;">' + escapeHtml(c.notes || "—") + "</p>" +
          nextBlock +
          "</div>"
        );
      }).join("");
    }

    function loadHistory(prospectId) {
      return client.from("prospect_contacts").select("*").eq("prospect_id", prospectId).order("created_at", { ascending: false }).then(function (res) {
        renderHistory(res.data || []);
      });
    }

    function refreshDetailStatus() {
      var p = allProspects.filter(function (x) { return x.id === selectedProspectId; })[0];
      if (!p) return;
      detailStatus.className = "status-pill status-pill--" + p.status;
      detailStatus.textContent = statusLabels[p.status];
      statusSelect.value = p.status;
    }

    function openDetail(id) {
      selectedProspectId = id;
      var p = allProspects.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      detailStatus.className = "status-pill status-pill--" + p.status;
      detailStatus.textContent = statusLabels[p.status];
      detailName.textContent = p.name;
      detailCategory.textContent = p.category;
      detailWebsite.value = p.website || "";
      detailAddress.value = p.address || "";
      detailNotes.value = p.notes || "";
      statusSelect.value = p.status;
      nextContactDate.value = toDatetimeLocalValue(p.next_contact_date);
      nextContactNotes.value = "";
      conversionLinkBox.hidden = true;
      detailOverlay.hidden = false;
      loadPeople(id);
      loadHistory(id);
    }

    addProspectBtn.addEventListener("click", function () { addProspectOverlay.hidden = false; });
    addProspectClose.addEventListener("click", function () { addProspectOverlay.hidden = true; });
    detailClose.addEventListener("click", function () {
      detailOverlay.hidden = true;
      selectedProspectId = null;
    });

    toggleArchiveBtn.addEventListener("click", function () {
      showArchive = !showArchive;
      pipelineArchive.hidden = !showArchive;
      toggleArchiveBtn.textContent = showArchive ? "Archiv ausblenden" : "Archiv anzeigen";
    });

    addProspectForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("prospectName").value.trim();
      var category = document.getElementById("prospectCategory").value.trim() || "Firma";
      var website = document.getElementById("prospectWebsite").value.trim() || null;
      var address = document.getElementById("prospectAddress").value.trim() || null;
      var people = [
        { name: document.getElementById("prospectPersonName").value.trim(), phone: document.getElementById("prospectPersonPhone").value.trim(), email: document.getElementById("prospectPersonEmail").value.trim() },
        { name: document.getElementById("prospectPersonName2").value.trim(), phone: document.getElementById("prospectPersonPhone2").value.trim(), email: document.getElementById("prospectPersonEmail2").value.trim() }
      ].filter(function (person) { return person.name; });
      if (!name) return;
      addProspectStatus.textContent = "Wird angelegt …";
      addProspectStatus.className = "form-status";
      client.from("prospects").insert({ name: name, category: category, website: website, address: address }).select().single().then(function (res) {
        if (res.error) throw res.error;
        var prospect = res.data;
        if (people.length) {
          return Promise.all(people.map(function (person) {
            return client.from("prospect_people").insert({ prospect_id: prospect.id, name: person.name, phone: person.phone || null, email: person.email || null });
          })).then(function () { return prospect; });
        }
        return prospect;
      }).then(function () {
        addProspectStatus.textContent = "Angelegt.";
        addProspectStatus.className = "form-status form-status--ok";
        addProspectForm.reset();
        addProspectOverlay.hidden = true;
        loadProspects();
      }).catch(function () {
        addProspectStatus.textContent = "Anlegen fehlgeschlagen. Bitte erneut versuchen.";
        addProspectStatus.className = "form-status form-status--error";
      });
    });

    saveNotesBtn.addEventListener("click", function () {
      if (!selectedProspectId) return;
      client.from("prospects").update({
        notes: detailNotes.value.trim(),
        website: detailWebsite.value.trim() || null,
        address: detailAddress.value.trim() || null
      }).eq("id", selectedProspectId).then(function () {
        loadProspects();
      });
    });

    statusSelect.addEventListener("change", function () {
      if (!selectedProspectId) return;
      client.from("prospects").update({ status: statusSelect.value }).eq("id", selectedProspectId).then(function () {
        refreshDetailStatus();
        loadProspects();
      });
    });

    addPersonBtn.addEventListener("click", function () {
      var name = newPersonName.value.trim();
      if (!name || !selectedProspectId) return;
      client.from("prospect_people").insert({
        prospect_id: selectedProspectId,
        name: name,
        phone: newPersonPhone.value.trim() || null,
        email: newPersonEmail.value.trim() || null
      }).then(function () {
        newPersonName.value = "";
        newPersonPhone.value = "";
        newPersonEmail.value = "";
        loadPeople(selectedProspectId);
      });
    });

    logContactBtn.addEventListener("click", function () {
      if (!selectedProspectId) return;
      var date = nextContactDate.value;
      var notes = nextContactNotes.value.trim();
      var prospectId = selectedProspectId;
      logStatus.textContent = "Wird gespeichert …";
      logStatus.className = "form-status";
      client.from("prospect_contacts").insert({
        prospect_id: prospectId,
        contact_date: todayISO(),
        notes: notes || null,
        next_contact_date: date || null
      }).then(function (res) {
        if (res && res.error) throw res.error;
        var p = allProspects.filter(function (x) { return x.id === prospectId; })[0];
        var updates = { next_contact_date: date || null };
        if (p && p.status === "lead") updates.status = "contacted";
        return client.from("prospects").update(updates).eq("id", prospectId);
      }).then(function () {
        nextContactNotes.value = "";
        nextContactDate.value = "";
        logStatus.textContent = "Gespeichert ✓";
        logStatus.className = "form-status form-status--ok";
        loadDailyCounter();
        loadHistory(prospectId);
        return loadProspects();
      }).then(function () {
        refreshDetailStatus();
      }).catch(function (err) {
        logStatus.textContent = "Fehler: " + (err && err.message ? err.message : "Speichern fehlgeschlagen");
        logStatus.className = "form-status form-status--error";
      });
    });

    markLostBtn.addEventListener("click", function () {
      if (!selectedProspectId) return;
      if (!window.confirm("Diesen Interessenten als 'Kein Interesse' markieren?")) return;
      client.from("prospects").update({ status: "lost" }).eq("id", selectedProspectId).then(function () {
        detailOverlay.hidden = true;
        loadProspects();
      });
    });

    markCustomerBtn.addEventListener("click", function () {
      if (!selectedProspectId) return;
      var p = allProspects.filter(function (x) { return x.id === selectedProspectId; })[0];
      if (!p) return;
      if (!window.confirm('"' + p.name + '" als Business-Karten-Kunde anlegen?')) return;
      var firstPerson = currentPeople[0] || {};
      insertCompanyWithRetry(client, {
        company_name: p.name,
        contact_person: firstPerson.name || "",
        phone: firstPerson.phone || "",
        email: "",
        notes: p.notes || ""
      }, 3).then(function (company) {
        return client.from("prospects").update({ status: "customer", company_id: company.id }).eq("id", selectedProspectId).then(function () {
          return company;
        });
      }).then(function (company) {
        var link = window.location.origin + "/business/aktivieren/?code=" + encodeURIComponent(company.card_code);
        conversionCompanyName.textContent = company.company_name;
        conversionLink.textContent = link;
        conversionLinkBox.hidden = false;
        conversionCopyBtn.textContent = "Link kopieren";
        conversionCopyBtn.onclick = function () {
          navigator.clipboard.writeText(link).then(function () {
            conversionCopyBtn.textContent = "Kopiert ✓";
          }).catch(function () {
            conversionCopyBtn.textContent = "Kopieren fehlgeschlagen";
          });
        };
        conversionWhatsAppBtn.style.display = firstPerson.phone ? "" : "none";
        conversionWhatsAppBtn.onclick = function () {
          var message =
            "Willkommen bei der MK Business Karte! Klicken Sie einfach auf diesen Link, Ihr persönlicher Code ist schon eingetragen – " +
            "Sie müssen nur noch eine E-Mail-Adresse und ein Passwort vergeben: " + link;
          window.open(buildWhatsAppLink(firstPerson.phone, message), "_blank");
        };
        refreshDetailStatus();
        loadProspects();
      }).catch(function () {
        window.alert("Anlegen fehlgeschlagen. Bitte erneut versuchen.");
      });
    });

    loadDailyCounter();
    loadProspects();
  });
})();
