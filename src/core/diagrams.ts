import { HelperProcess } from "./helper-process.js";
import { createHash } from "node:crypto";
import { heavyBuildJob } from "./build-jobs.js";
import { cachedArtifacts } from "./artifact-cache.js";
/** The renderer could not read a diagram's source: a type it does not draw, or invalid syntax. */
export class DiagramSourceError extends Error {
  override name = "DiagramSourceError";
}
/** Mermaid draws in a process of its own: it loads a DOM and the whole Mermaid library to parse a diagram. */
const renderer = new HelperProcess<{ source: string; dark: boolean; prefix: string }, { svg?: string; error?: string }>(
  new URL("./diagram-worker.js", import.meta.url),
);
let diagramQueue = Promise.resolve();
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
        heavyBuildJob(async () => {
          const reply = await renderer.request({ source, dark, prefix: `diagram-${key.slice(0, 16)}` });
          if (reply.error !== undefined) throw new DiagramSourceError(reply.error);
          return reply.svg!;
        }),
      );
      diagramQueue = job.then(
        () => undefined,
        () => undefined,
      );
      const { default: sanitizeHtml } = await import("sanitize-html");
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

/** Ends the renderer and gives back what it held; the next diagram starts another. */
export async function closeDiagramRenderer(): Promise<void> {
  await renderer.close();
}
