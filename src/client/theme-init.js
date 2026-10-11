// Applies the reader's saved theme before first paint. It loads as an external
// script in <head>, so a site's Content-Security-Policy needs no 'unsafe-inline'.
(function () {
  if (localStorage.getItem('sourcey-theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
})();
