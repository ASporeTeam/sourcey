import { createHash } from "node:crypto";
import type { SearchEntry } from "./search-indexer.js";
import { createSearch, type SearchManifest, type SearchPostings } from "./search-query.js";

const SINGLE_INDEX_BYTES = 256 * 1024;
const POSTING_CHUNK_BYTES = 32 * 1024;
const contentPath = (body: string) => `_search/${createHash("sha256").update(body).digest("hex").slice(0, 20)}.json`;

/** Serialize once at the artifact boundary; the browser uses the very same index. */
export function buildSearchArtifacts(rows: SearchEntry[]): { path: string; files: Map<string, string> } {
  const files = new Map<string, string>();
  const manifest: SearchManifest<SearchEntry> = {
    rows: rows.map(row => { const metadata = { ...row }; delete metadata.searchText; return metadata; }),
    index: createSearch(rows).toJSON(),
    shards: [],
  };
  let body = JSON.stringify(manifest);
  if (Buffer.byteLength(body) > SINGLE_INDEX_BYTES) {
    const postings = manifest.index.index;
    manifest.index.index = [];
    let chunk: SearchPostings = [], bytes = 2;
    const flush = () => {
      if (!chunk.length) return;
      const body = JSON.stringify(chunk), path = contentPath(body);
      files.set(path, body);
      manifest.shards.push({ file: path.slice("_search/".length), terms: chunk.map(([term]) => term) });
      chunk = []; bytes = 2;
    };
    for (const posting of postings) {
      const size = Buffer.byteLength(JSON.stringify(posting)) + 1;
      if (bytes + size > POSTING_CHUNK_BYTES) flush();
      chunk.push(posting); bytes += size;
    }
    flush();
    body = JSON.stringify(manifest);
  }
  const path = contentPath(body);
  files.set(path, body);
  return { path, files };
}
