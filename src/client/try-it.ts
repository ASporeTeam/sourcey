import { h, render } from "preact";
import { Console } from "../components/try-it/Console.js";
import type { ConsoleData } from "../core/try-it.js";

export function activate(mount: HTMLElement, data: ConsoleData, onClose: () => void): void {
  const headingLevel = mount.dataset.tryItHeading === "2" ? 2 : 3;
  render(h(Console, { data, id: mount.id, onClose, headingLevel }), mount);
  window.addEventListener(
    "pagehide",
    () => {
      onClose();
      render(null, mount);
    },
    { once: true },
  );
}
