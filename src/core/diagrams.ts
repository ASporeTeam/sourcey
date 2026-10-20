import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { heavyBuildJob } from "./build-jobs.js";
import { cachedArtifacts } from "./artifact-cache.js";
/** The renderer could not read a diagram's source: a type it does not draw, or invalid syntax. */
export class DiagramSourceError extends Error {
  override name = "DiagramSourceError";
}
let worker: Worker | undefined;
let sequence = 0;
const requests = new Map<number, { resolve(value: string): void; reject(error: Error): void }>();
let diagramQueue = Promise.resolve();
function renderer(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./diagram-worker.js", import.meta.url), {
    // Loaders carry over; a worker refuses the process's own heap and stack sizes.
    execArgv: process.execArgv.filter((arg) => !/^--(input-type|max-old-space-size|max-semi-space-size|stack-size)\b/.test(arg)),
  });
  worker.on("message", ({ id, svg, error }: { id: number; svg?: string; error?: string }) => {
    const request = requests.get(id);
    requests.delete(id);
    if (request) {
      if (error) request.reject(new DiagramSourceError(error));
      else request.resolve(svg!);
    }
    if (!requests.size) worker?.unref();
  });
  worker.on("error", (error) => {
    for (const request of requests.values())
      request.reject(error instanceof Error ? error : new Error(String(error)));
    requests.clear();
    worker = undefined;
  });
  return worker;
}
export async function diagramSvg(source: string, dark: boolean): Promise<string> {
  const key = createHash("sha256")
    .update(JSON.stringify([source, dark]))
    .digest("hex");
  const files = await cachedArtifacts(
    "diagram",
    key,
    ["@speajus/mermaid-to-svg", "sanitize-html"],
    async () => {
      const job = diagramQueue.then(() =>
        heavyBuildJob(
          () =>
            new Promise<string>((resolve, reject) => {
              const instance = renderer();
              instance.ref();
              const id = ++sequence;
              requests.set(id, { resolve, reject });
              instance.postMessage({ id, source, dark, prefix: `diagram-${key.slice(0, 16)}` });
            }),
        ),
      );
      diagramQueue = job.then(
        () => undefined,
        () => undefined,
      );
      const svg = await job.then((svg) =>
        sanitizeHtml(svg, {
          allowedTags: [
            "svg",
            "g",
            "path",
            "rect",
            "circle",
            "ellipse",
            "line",
            "polyline",
            "polygon",
            "text",
            "tspan",
            "defs",
            "marker",
            "clipPath",
            "title",
            "desc",
            "a",
          ],
          allowedAttributes: {
            "*": [
              "id",
              "class",
              "xmlns",
              "width",
              "height",
              "viewBox",
              "x",
              "y",
              "x1",
              "x2",
              "y1",
              "y2",
              "cx",
              "cy",
              "r",
              "rx",
              "ry",
              "d",
              "points",
              "fill",
              "stroke",
              "stroke-width",
              "stroke-dasharray",
              "stroke-linecap",
              "stroke-linejoin",
              "opacity",
              "transform",
              "font-family",
              "font-size",
              "font-weight",
              "text-anchor",
              "dominant-baseline",
              "dy",
              "dx",
              "marker-end",
              "marker-start",
              "markerWidth",
              "markerHeight",
              "markerUnits",
              "refX",
              "refY",
              "orient",
              "clip-path",
              "href",
              "target",
              "rel",
              "style",
            ],
          },
          parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
          allowedSchemes: ["http", "https", "mailto"],
        }),
      );
      return new Map([["diagram.svg", Buffer.from(svg)]]);
    },
  );
  return files.get("diagram.svg")!.toString();
}
