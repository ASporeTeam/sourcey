// Native links remain useful without JavaScript. Retain the current section
// only when the compiled destination declares that exact fragment.
function retainSection(event) {
  const link = event.target instanceof Element && event.target.closest("[data-sourcey-context-anchors]");
  if (!link) return;
  let fragment;
  try { fragment = decodeURIComponent(location.hash.slice(1)); }
  catch { fragment = ""; }
  link.hash = JSON.parse(link.getAttribute("data-sourcey-context-anchors")).includes(fragment) ? location.hash : "";
}
document.addEventListener("click", retainSection);
document.addEventListener("auxclick", retainSection);

document.addEventListener("pointerdown", event => {
  for (const menu of document.querySelectorAll(".sourcey-context-menu[open]")) {
    if (event.target instanceof Element && !menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const menu = document.querySelector(".sourcey-context-menu[open]");
  if (!menu) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
  event.preventDefault();
});
