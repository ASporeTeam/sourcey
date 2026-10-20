(function () {
  var root = document.querySelector(".sourcey-reader");
  if (!root) return;
  root.querySelectorAll("[data-reader-enhancement]").forEach(function (el) {
    el.hidden = false;
  });
  root.querySelectorAll("[data-reader-fallback]").forEach(function (el) {
    el.hidden = true;
  });
  var toggle = root.querySelector(".menu-toggle");
  var menu = root.querySelector("#reader-mobile-nav");
  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", toggle.getAttribute("data-open-label"));
  }
  toggle.addEventListener("click", function () {
    var open = toggle.getAttribute("aria-expanded") !== "true";
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", toggle.getAttribute(open ? "data-close-label" : "data-open-label"));
  });
  window.matchMedia("(min-width: 901px)").addEventListener("change", function (event) {
    if (event.matches) closeMenu();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      toggle.focus();
    }
    var search = root.querySelector("a.search-link");
    if (
      search &&
      event.key === "/" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.target.closest("input, textarea, select, [contenteditable]")
    ) {
      event.preventDefault();
      window.location.href = search.href;
    }
  });
  var chapters = root.querySelector('[data-reader-chapters]');
  var desktop = window.matchMedia('(min-width: 901px)');
  if (chapters) {
    chapters.open = desktop.matches;
    chapters.setAttribute('data-ready', '');
    desktop.addEventListener('change', function (event) { chapters.open = event.matches; });
  }
  var copy = root.querySelector("[data-copy-page]");
  if (copy)
    copy.addEventListener("click", async function () {
      var label = copy.querySelector("span");
      try {
        await navigator.clipboard.writeText(window.location.href);
        label.textContent = copy.getAttribute("data-copied-label");
      } catch {
        label.textContent = copy.getAttribute("data-failure-label");
      }
      setTimeout(function () {
        label.textContent = copy.getAttribute("data-copy-label");
      }, 2500);
    });
  var links = Array.from(root.querySelectorAll(".docs-toc nav a"));
  if ("IntersectionObserver" in window) {
    var observer = new window.IntersectionObserver(
      function (entries) {
        var active = entries.find(function (entry) {
          return entry.isIntersecting;
        });
        if (!active) return;
        links.forEach(function (link) {
          if (link.hash === "#" + active.target.id) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-100px 0px -65% 0px" },
    );
    root.querySelectorAll(".reader-prose h2, .reader-prose h3").forEach(function (heading) {
      observer.observe(heading);
    });
  }
})();
