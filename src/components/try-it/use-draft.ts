import { useEffect, useRef, useState } from "preact/hooks";
import { initialDraft, type RequestDraft } from "../../core/request.js";
import type { ConsoleData } from "../../core/try-it.js";
import { draftKey, restoreDraft, saveDraft } from "./drafts.js";

/** Optional browser persistence; credentials never enter the saved projection. */
export function useDraft(data: ConsoleData) {
  const key = draftKey(data, location.origin + location.pathname);
  const restored = useRef(false);
  const [draft, setDraft] = useState<RequestDraft>(() => {
    const defaults = initialDraft(data.operation);
    try {
      const saved = restoreDraft(localStorage, key, data, defaults);
      restored.current = !!saved;
      return saved ?? defaults;
    } catch {
      return defaults;
    }
  });
  const [saving, setSaving] = useState(restored.current ? "Draft restored" : "");
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (!edited) return;
    const timer = setTimeout(() => {
      try {
        saveDraft(localStorage, key, data, draft);
        setSaving("Fields saved in this browser");
      } catch {
        setSaving("Draft stays in this tab");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [
    draft.parameters,
    draft.body,
    draft.mediaType,
    draft.serverIndex,
    draft.serverVariables,
    edited,
  ]);
  useEffect(() => {
    if (!saving || saving === "Draft stays in this tab") return;
    const timer = setTimeout(() => setSaving(""), 2500);
    return () => clearTimeout(timer);
  }, [saving]);

  function update(next: Partial<RequestDraft>, persist = true) {
    setDraft((previous) => ({ ...previous, ...next }));
    if (persist) setEdited(true);
  }
  function clearSaved() {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Storage is optional. */
    }
    setEdited(false);
    setSaving("");
  }
  return { draft, update, saving, clearSaved };
}
