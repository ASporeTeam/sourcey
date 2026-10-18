// Native release links work without JavaScript; close the jump menu after choosing one.
document.querySelectorAll('[data-changelog-jump]').forEach(function (menu) {
  menu.addEventListener('click', function (event) {
    if (event.target.closest('a[href]')) menu.open = false;
  });
});
