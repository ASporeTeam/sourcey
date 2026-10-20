import type { SearchEntry } from "../core/search-indexer.js";
import type { SearchRequest, SearchResponse } from "./search-worker.js";

/** One worker per open document, created only when search is first requested. */
export async function loadSearch(urls: string[]) {
  const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
  let sequence = 0, stopped = false;
  const pending = new Map<number, { resolve(rows: SearchEntry[]): void; reject(error: Error): void }>();
  function dispose() {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    for (const job of pending.values()) job.reject(new Error("Search closed"));
    pending.clear();
    window.removeEventListener("pagehide", dispose);
    document.removeEventListener("astro:before-swap", dispose);
  }
  worker.addEventListener("message", (event: MessageEvent<SearchResponse>) => {
    const reply = event.data, job = pending.get(reply.id);
    if (!job) return;
    pending.delete(reply.id);
    if (reply.error !== undefined) job.reject(new Error(reply.error));
    else job.resolve(reply.rows);
  });
  worker.addEventListener("error", dispose);
  worker.addEventListener("messageerror", dispose);
  window.addEventListener("pagehide", dispose, { once: true });
  document.addEventListener("astro:before-swap", dispose, { once: true });
  function request(message: Omit<Extract<SearchRequest, { kind: "load" }>, "id"> | Omit<Extract<SearchRequest, { kind: "query" }>, "id">): Promise<SearchEntry[]> {
    if (stopped) return Promise.reject(new Error("Search closed"));
    return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id } satisfies SearchRequest); });
  }
  try {
    const rows = await request({ kind: "load", urls: urls.map(url => new URL(url, document.baseURI).href) });
    return { rows, query: (query: string) => request({ kind: "query", query }), dispose };
  } catch (error) { dispose(); throw error; }
}
