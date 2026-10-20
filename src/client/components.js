// Native client components enhance meaningful server-rendered content.
(function () {
  var cleanups = [];
  var base = document.querySelector('meta[name="sourcey-assets"]');
  var assetBase = new URL(base && base.content || './', location.href);
  var active = true;
  document.querySelectorAll('[data-sourcey-component]').forEach(function (root) {
    var path = root.getAttribute('data-sourcey-module');
    import(/* @vite-ignore */ new URL(path, assetBase).href).then(function (module) {
      if (!active) return;
      if (typeof module.default !== 'function') throw new Error('Native component must export a default mount function');
      var cleanup = module.default(root, JSON.parse(root.getAttribute('data-sourcey-props') || 'null'));
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    }).catch(function (error) {
      console.error('Sourcey component:', error);
      root.dispatchEvent(new CustomEvent('sourcey:componenterror', { bubbles: true, detail: { error: error } }));
    });
  });
  function dispose() { active = false; cleanups.splice(0).forEach(function (cleanup) { cleanup(); }); }
  window.addEventListener('pagehide', dispose, { once: true });
  document.addEventListener('astro:before-swap', dispose, { once: true });
})();
