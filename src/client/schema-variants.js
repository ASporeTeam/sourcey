// Schema alternatives keep their complete server-rendered content without JS.
// Enhancement selects a branch for inspection; a field link reveals its branch.
(function () {
  function owned(group, selector) {
    return Array.from(group.querySelectorAll(selector)).filter(function (element) {
      return element.closest('[data-schema-variants]') === group;
    });
  }

  function select(group, value) {
    owned(group, '[data-schema-variant]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-schema-variant') !== value;
    });
    owned(group, '[data-schema-picker]')[0].value = value;
  }

  function fragmentTarget(hash) {
    try { return document.getElementById(decodeURIComponent(hash.slice(1))); }
    catch { return null; }
  }

  function reveal(target) {
    var changed = false;
    for (var parent = target; parent; parent = parent.parentElement) {
      if (parent.hasAttribute('data-schema-variant') && parent.hidden) {
        select(parent.closest('[data-schema-variants]'), parent.getAttribute('data-schema-variant'));
        changed = true;
      }
      if (parent.tagName === 'DETAILS' && !parent.open) {
        parent.open = true;
        changed = true;
      }
    }
    return changed;
  }

  function revealLocation() {
    var target = fragmentTarget(location.hash);
    if (target && reveal(target)) requestAnimationFrame(function () {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }

  function init() {
    document.querySelectorAll('[data-schema-variants]').forEach(function (group) {
      select(group, '0');
      owned(group, '.schema-variant-control')[0].hidden = false;
      owned(group, '[data-schema-fallback]')[0].hidden = true;
      group.setAttribute('data-schema-enhanced', '');
    });
    document.addEventListener('change', function (event) {
      if (event.target.matches('[data-schema-picker]')) select(event.target.closest('[data-schema-variants]'), event.target.value);
    });
    // Reveal synchronously before native scrolling or the navigation tracker.
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) reveal(fragmentTarget(url.hash));
    }, true);
    window.addEventListener('hashchange', revealLocation);
    revealLocation();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
