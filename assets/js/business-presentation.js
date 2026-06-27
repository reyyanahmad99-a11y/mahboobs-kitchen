(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var presenterParam = params.get("presenter");
  var viewerParam = params.get("viewer");
  if (!presenterParam && !viewerParam) return;

  var client = window.mkBusiness.client;

  function randomCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    var code = "";
    for (var i = 0; i < bytes.length; i++) code += chars[bytes[i] % chars.length];
    return code;
  }

  function currentPercent() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return max <= 0 ? 0 : window.scrollY / max;
  }

  if (presenterParam) {
    client.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      if (!session) {
        window.location.href = "/business/login/?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
        return;
      }
      window.mkBusiness.getProfile(session.user.id).then(function (profile) {
        if (!profile || profile.role !== "admin") {
          window.location.href = "/business/login/";
          return;
        }
        startPresenting();
      });
    });
  }

  function startPresenting() {
    var code = presenterParam === "new" ? randomCode() : presenterParam;
    if (presenterParam === "new") {
      var url = new URL(window.location.href);
      url.searchParams.set("presenter", code);
      window.history.replaceState({}, "", url.toString());
    }
    var instanceId = randomCode();

    var viewerUrl = window.location.origin + "/business/?viewer=" + code;
    var bar = document.getElementById("presenterBar");
    document.getElementById("presenterLink").textContent = viewerUrl;
    bar.hidden = false;

    var channel = client.channel("presentation-" + code);

    function sendPosition() {
      channel.send({ type: "broadcast", event: "scroll", payload: { percent: currentPercent(), instanceId: instanceId } });
    }

    channel.subscribe(function (status) {
      if (status === "SUBSCRIBED") sendPosition();
    });

    var scrollThrottled = false;
    window.addEventListener("scroll", function () {
      if (scrollThrottled) return;
      scrollThrottled = true;
      setTimeout(function () {
        sendPosition();
        scrollThrottled = false;
      }, 150);
    });

    var heartbeat = setInterval(sendPosition, 2000);

    document.getElementById("presenterCopyBtn").addEventListener("click", function () {
      var btn = this;
      navigator.clipboard.writeText(viewerUrl).then(function () {
        btn.textContent = "Kopiert ✓";
        setTimeout(function () { btn.textContent = "Link kopieren"; }, 2000);
      }).catch(function () {
        btn.textContent = "Kopieren fehlgeschlagen";
      });
    });

    document.getElementById("presenterWhatsAppBtn").addEventListener("click", function () {
      var message = "Schauen Sie sich live mit mir die MK Business Karte an: " + viewerUrl;
      window.open("https://wa.me/?text=" + encodeURIComponent(message), "_blank");
    });

    document.getElementById("presenterEndBtn").addEventListener("click", function () {
      channel.send({ type: "broadcast", event: "end", payload: { instanceId: instanceId } });
      clearInterval(heartbeat);
      channel.unsubscribe();
      bar.hidden = true;
    });
  }

  if (viewerParam) {
    var banner = document.getElementById("viewerBanner");
    banner.hidden = false;

    var lockedInstanceId = null;

    var viewChannel = client.channel("presentation-" + viewerParam);
    viewChannel.on("broadcast", { event: "scroll" }, function (msg) {
      if (!lockedInstanceId) lockedInstanceId = msg.payload.instanceId;
      if (msg.payload.instanceId !== lockedInstanceId) return;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, (msg.payload.percent || 0) * max);
    });
    viewChannel.on("broadcast", { event: "end" }, function (msg) {
      if (lockedInstanceId && msg.payload.instanceId !== lockedInstanceId) return;
      banner.hidden = true;
      viewChannel.unsubscribe();
    });
    viewChannel.subscribe();
  }
})();
