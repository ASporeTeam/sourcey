import { h, render } from "preact";
import { Console } from "../components/try-it/Console.js";
import type { ConsoleData } from "../core/try-it.js";

export function activate(mount: HTMLElement, data: ConsoleData, onClose: () => void): void {
  render(h(Console, { data, id: mount.id, onClose }), mount);
  window.addEventListener(
    "pagehide",
    () => {
      onClose();
      render(null, mount);
    },
    { once: true },
  );
}
