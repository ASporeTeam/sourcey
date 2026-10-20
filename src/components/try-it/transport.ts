import type { RequestDescription } from "../../core/request.js";
import { normalizeRequestHeaders } from "../../core/request.js";

const MAX_RESPONSE = 10 * 1024 * 1024;
export interface ConsoleResponse {
  status: number;
  statusText: string;
  url: string;
  duration: number;
  headers: [string, string][];
  blob: Blob;
  truncated: boolean;
}

/** Capture a bounded response; a slow or large body remains cancellable. */
export async function sendRequest(
  request: RequestDescription,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ConsoleResponse> {
  const started = performance.now();
  const response = await fetcher(request.url, { ...requestInit(request), signal });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  let truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const remaining = MAX_RESPONSE - length;
        if (value.length > remaining) {
          chunks.push(value.slice(0, remaining));
          length += remaining;
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(new Uint8Array(value));
        length += value.length;
      }
    } finally {
      reader.releaseLock();
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url || request.url,
    duration: Math.round(performance.now() - started),
    headers: [...response.headers],
    blob: new Blob(chunks, { type: response.headers.get("content-type") ?? "" }),
    truncated,
  };
}

export function requestInit(request: RequestDescription): RequestInit {
  const headers = new Headers(normalizeRequestHeaders(request.headers));
  let body: BodyInit | undefined;
  if (request.body?.kind === "text") body = request.body.text;
  else if (request.body?.kind === "multipart") {
    const form = new FormData();
    for (const [name, value] of request.body.parts) form.append(name, value);
    body = form;
    headers.delete("Content-Type");
  }
  return { method: request.method, headers, body, credentials: request.credentials };
}
