import type { ConfigValue } from "./config-writer.js";

/**
 * Native edit-link options from a repository URL that names a branch and a
 * path (`.../edit/main/docs/`, `.../tree/main`, GitLab's `.../-/edit/...`).
 * `prefix` is the part of that path the native source path does not already
 * carry, which becomes `editBasePath`.
 */
export function editLinkOptions(url: string, prefix?: (path: string) => string): Record<string, ConfigValue> {
  const match = url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+?)(?:\.git)?\/(?:-\/)?(?:edit|tree|blob)\/([^/]+)\/?(.*)$/);
  if (!match) return { repo: url.replace(/\/+$/, "") };
  const path = match[3].replace(/\/+$/, "");
  const base = prefix ? prefix(path) : path;
  return { repo: match[1], editBranch: match[2], ...(base ? { editBasePath: base } : {}) };
}
