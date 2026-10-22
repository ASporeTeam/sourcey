import type { SearchResult } from "../core/search-artifacts.js";
import type { SearchRequest, SearchResponse } from "./search-worker.js";

/** One worker per open document, created only when search is first requested. */
export async function loadSearch(urls: string[]) {
  const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
  let sequence = 0, stopped = false;
  type Reply = { rows: SearchResult[]; more: boolean };
  const pending = new Map<number, { resolve(reply: Reply): void; reject(error: Error): void }>();
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
    else job.resolve({ rows: reply.rows, more: reply.more === true });
  });
  worker.addEventListener("error", dispose);
  worker.addEventListener("messageerror", dispose);
  window.addEventListener("pagehide", dispose, { once: true });
  document.addEventListener("astro:before-swap", dispose, { once: true });
  type Message = Omit<Extract<SearchRequest, { kind: "load" }>, "id"> | Omit<Extract<SearchRequest, { kind: "query" }>, "id"> | Omit<Extract<SearchRequest, { kind: "more" }>, "id">;
  function request(message: Message): { id: number; reply: Promise<Reply> } {
    const id = ++sequence;
    if (stopped) return { id, reply: Promise.reject(new Error("Search closed")) };
    return { id, reply: new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id } as SearchRequest); }) };
  }
  // The query whose further results `more` reads.
  let shown = 0;
  try {
    const { rows } = await request({ kind: "load", urls: urls.map(url => new URL(url, document.baseURI).href) }).reply;
    return {
      rows,
      /** A query's first results, and whether it has more. */
      query(query: string) { const { id, reply } = request({ kind: "query", query }); shown = id; return reply; },
      /** The current query's next results. */
      more() { return request({ kind: "more", of: shown }).reply; },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
