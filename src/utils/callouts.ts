/**
 * Callouts: the one renderer for native callout components (`<Note>`, `:::tip`)
 * and GitHub alerts (`> [!WARNING]`), in guides and in reference descriptions.
 */
import type { IconSet } from "../config.js";
import type { UiMessages } from "../core/messages.js";
import { iconSvg, nativeIcon, type NativeIcon } from "./icons.js";

export type CalloutKind = "Note" | "Warning" | "Tip" | "Info" | "Caution" | "Danger";

/** Each callout's default title (a locale message) and icon. */
export const CALLOUTS: Record<CalloutKind, { label: keyof UiMessages; icon: NativeIcon }> = {
  Note: { label: "note", icon: "note" },
  Warning: { label: "warning", icon: "warning" },
  Tip: { label: "tip", icon: "tip" },
  Info: { label: "info", icon: "note" },
  Caution: { label: "caution", icon: "warning" },
  Danger: { label: "danger", icon: "danger" },
};

export function isCallout(name: string): name is CalloutKind {
  return Object.hasOwn(CALLOUTS, name);
}

/**
 * A GitHub alert: the exact `> [!TYPE]` marker line, then the blockquote's
 * remaining lines. Group 1 is the type, group 2 the quoted body.
 */
export const ALERT = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)((?:>[^\n]*(?:\n|$))*)/;

/** The callout an alert type renders as; `IMPORTANT` is an info callout titled "Important". */
export function alertCallout(type: string, messages: UiMessages): { kind: CalloutKind; title?: string } {
  const kind = ({ NOTE: "Note", TIP: "Tip", IMPORTANT: "Info", WARNING: "Warning", CAUTION: "Caution" } as const)[type as "NOTE"];
  return type === "IMPORTANT" ? { kind, title: messages.important } : { kind };
}

/** The alert type each callout reads as in Markdown; GitHub's five have no Info or Danger. */
export const ALERT_TYPE: Record<CalloutKind, string> = { Note: "NOTE", Tip: "TIP", Info: "IMPORTANT", Warning: "WARNING", Caution: "CAUTION", Danger: "CAUTION" };

/** An alert's body without its quote markers. */
export function alertBody(quoted: string): string {
  return quoted.replace(/^> ?/gm, "");
}

/** A callout's HTML from its rendered title and content. */
export function renderCallout(kind: CalloutKind, { title, content, icons }: { title: string; content: string; icons: IconSet }): string {
  const icon = iconSvg(nativeIcon(icons, CALLOUTS[kind].icon), { class: "callout-icon", size: 20 });
  return `<aside class="callout callout-${kind.toLowerCase()} not-prose">${icon}<div class="callout-body"><div class="callout-title">${title}</div><div class="callout-content">${content}</div></div></aside>`;
}
