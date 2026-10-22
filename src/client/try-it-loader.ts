/** Delegated bootstrap only. Console code, Preact and operation data load on activation. */
import { showRequestUrl } from "../components/try-it/request-url.js";
import { parseShared } from "../core/shared-json.js";

const originalUrls = new WeakMap<Element, Node[]>();

async function loadConsole(button: HTMLElement) {
  const [module, response] = await Promise.all([
    import(/* @vite-ignore */ new URL(button.dataset.tryItModule!, document.baseURI).href),
    fetch(new URL(button.dataset.tryItData!, document.baseURI)),
  ]);
  if (!response.ok) throw new Error("Could not load this operation.");
  return [module, parseShared(await response.text())] as const;
}

/** The console's asset names as the page carries them now. */
async function currentConsoleNames(controls: string) {
  const response = await fetch(location.href, { cache: "no-store" });
  if (!response.ok) return undefined;
  const page = new DOMParser().parseFromString(await response.text(), "text/html");
  const current = page.querySelector<HTMLElement>(`[data-try-it-trigger][aria-controls="${CSS.escape(controls)}"]`)?.dataset;
  return current?.tryItModule && current.tryItData ? { tryItModule: current.tryItModule, tryItData: current.tryItData } : undefined;
}
document.querySelectorAll<HTMLButtonElement>("[data-try-it-trigger]").forEach((button) => {
  button.hidden = false;
});
document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("[data-try-it-trigger]");
  if (!button || button.disabled) return;
  const operation = button.closest<HTMLElement>("[data-sourcey-operation]");
  const mount = document.getElementById(button.getAttribute("aria-controls") ?? "");
  const examples = operation?.querySelector<HTMLElement>("[data-try-it-examples]");
  if (!operation || !mount || !examples) return;
  const url = operation.querySelector<HTMLElement>("[data-endpoint-url]");
  if (url && !originalUrls.has(url))
    originalUrls.set(
      url,
      Array.from(url.childNodes, (node) => node.cloneNode(true)),
    );
  const opened = button.getAttribute("aria-expanded") === "true";
  function toggle(open: boolean) {
    mount!.hidden = !open;
    examples!.hidden = open;
    operation!.toggleAttribute("data-console-open", open);
    button!.setAttribute("aria-expanded", String(open));
    button!.textContent = open ? "Done" : "Try it";
    if (url) {
      if (open && mount!.dataset.tryItUrl) showRequestUrl(url, mount!.dataset.tryItUrl);
      else if (!open)
        url.replaceChildren(...(originalUrls.get(url) ?? []).map((node) => node.cloneNode(true)));
    }
    if (!open) {
      mount!.dispatchEvent(new Event("sourcey:try-it-close"));
      button!.focus({ preventScroll: true });
    }
  }
  function focusConsole() {
    requestAnimationFrame(() => {
      if (matchMedia("(max-width: 1279px)").matches)
        operation!
          .querySelector(".sourcey-endpoint")
          ?.scrollIntoView({ block: "start", behavior: "instant" });
      const fields = Array.from(mount!.querySelectorAll<HTMLElement>("input, select, textarea"));
      const target =
        fields.find((field) => field.getClientRects().length > 0) ??
        mount!.querySelector<HTMLElement>('button[type="submit"]');
      target?.focus({ preventScroll: true });
    });
  }
  if (opened) {
    toggle(false);
    return;
  }
  if (mount.childElementCount) {
    toggle(true);
    focusConsole();
    return;
  }
  button.disabled = true;
  button.textContent = "Opening…";
  button.setAttribute("aria-busy", "true");
  try {
    const [module, data] = await loadConsole(button).catch(async () => {
      // A page left open across a deploy names console assets the new build replaced.
      const current = await currentConsoleNames(button.getAttribute("aria-controls") ?? "");
      if (!current) throw new Error("This page no longer has this console.");
      Object.assign(button.dataset, current);
      return loadConsole(button);
    });
    toggle(true);
    module.activate(mount, data, () => toggle(false));
    focusConsole();
  } catch {
    toggle(false);
    button.textContent = "Retry opening";
    let error = operation.querySelector<HTMLElement>("[data-try-it-load-error]");
    if (!error) {
      error = document.createElement("p");
      error.dataset.tryItLoadError = "";
      error.className = "sourcey-error";
      error.setAttribute("role", "alert");
      button.parentElement?.after(error);
    }
    error.textContent =
      "The console could not load. Your reference and examples are still available.";
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.getAttribute("aria-expanded") === "true")
      operation.querySelector("[data-try-it-load-error]")?.remove();
  }
});
