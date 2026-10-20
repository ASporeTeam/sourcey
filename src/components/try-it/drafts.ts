import { isRecord } from "../../core/schema.js";
import type { RequestDraft } from "../../core/request.js";
import type { ConsoleData } from "../../core/try-it.js";
import { filterDraft } from "./values.js";

const MAX_BYTES = 100_000;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export function draftKey(data: ConsoleData, page: string): string {
  return (
    "sourcey:try-it:v1:" +
    encodeURIComponent(
      page +
        "|" +
        data.specKey +
        "|" +
        data.version +
        "|" +
        data.operation.method +
        "|" +
        data.operation.path,
    )
  );
}
export function storedDraft(data: ConsoleData, draft: RequestDraft) {
  const safe = filterDraft(draft, data, "storage");
  return {
    at: Date.now(),
    parameters: safe.parameters,
    mediaType: safe.mediaType,
    body: safe.body,
    serverIndex: safe.serverIndex,
    serverVariables: safe.serverVariables,
  };
}
export function restoreDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
  data: ConsoleData,
  defaults: RequestDraft,
): RequestDraft | undefined {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_BYTES) return undefined;
    const saved = JSON.parse(raw);
    if (!isRecord(saved) || typeof saved.at !== "number" || Date.now() - saved.at > MAX_AGE) {
      storage.removeItem(key);
      return undefined;
    }
    const candidate = {
      ...defaults,
      parameters: isRecord(saved.parameters) ? saved.parameters : {},
      serverVariables: isRecord(saved.serverVariables)
        ? (Object.fromEntries(
            Object.entries(saved.serverVariables).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>)
        : {},
      serverIndex:
        typeof saved.serverIndex === "number" &&
        saved.serverIndex >= 0 &&
        saved.serverIndex < Math.max(data.servers.length, 1)
          ? saved.serverIndex
          : 0,
      mediaType:
        typeof saved.mediaType === "string" && data.operation.requestBody?.content[saved.mediaType]
          ? saved.mediaType
          : defaults.mediaType,
      body: Object.prototype.hasOwnProperty.call(saved, "body") ? saved.body : defaults.body,
      auth: {},
      securityIndex: defaults.securityIndex,
    };
    // Reapply the allowlist even to browser data; a changed spec cannot restore removed/sensitive fields.
    const safe = storedDraft(data, candidate);
    // Remove older unsafe bytes as well as filtering the in-memory result.
    if (JSON.stringify(saved) !== JSON.stringify({ ...safe, at: saved.at }))
      storage.removeItem(key);
    return { ...candidate, ...safe, parameters: safe.parameters };
  } catch {
    return undefined;
  }
}
export function saveDraft(
  storage: Pick<Storage, "setItem">,
  key: string,
  data: ConsoleData,
  draft: RequestDraft,
): void {
  const value = JSON.stringify(storedDraft(data, draft));
  if (value.length > MAX_BYTES) throw new Error("Draft exceeds the local cache limit.");
  storage.setItem(key, value);
}
