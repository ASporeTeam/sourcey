import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import type { MigrationReport } from "../migration/types.js";

const sha256 = (body: Buffer) => createHash("sha256").update(body).digest("hex");
function utf8(body: Buffer | null): string | undefined {
  if (body === null) return "";
  if (body.includes(0)) return undefined;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { return undefined; }
}

/** Show the exact verified change set without requiring a Git checkout or executable. */
export async function formatMigrationDiff(report: MigrationReport): Promise<string> {
  const patches: string[] = [];
  for (const change of report.changes) {
    const before = change.expectedSha256 === null ? null : await readFile(resolve(report.root, change.path));
    if (before && sha256(before) !== change.expectedSha256) throw new Error(`File changed while preparing migration preview: ${change.path}`);
    const oldText = utf8(before), newText = utf8(change.bytes);
    if (oldText === undefined || newText === undefined) {
      patches.push(`Binary file ${change.path}: ${before ? sha256(before) : "absent"} → ${change.bytes ? sha256(change.bytes) : "removed"}\n`);
    } else patches.push(createTwoFilesPatch(before === null ? "/dev/null" : `a/${change.path}`, change.bytes === null ? "/dev/null" : `b/${change.path}`, oldText, newText));
  }
  return patches.join("\n");
}
