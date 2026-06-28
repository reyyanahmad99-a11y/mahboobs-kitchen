(function () {
  "use strict";

  var galleryTrack = document.getElementById("mkGalleryTrack");
  var galleryPrev = document.getElementById("mkGalleryPrev");
  var galleryNext = document.getElementById("mkGalleryNext");
  if (galleryTrack && galleryPrev && galleryNext) {
    galleryPrev.addEventListener("click", function () { galleryTrack.scrollBy({ left: -336, behavior: "smooth" }); });
    galleryNext.addEventListener("click", function () { galleryTrack.scrollBy({ left: 336, behavior: "smooth" }); });
  }

  var els = document.querySelectorAll(".reveal");
  if (!els.length) return;

  if (!("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  els.forEach(function (el) { observer.observe(el); });
})();
