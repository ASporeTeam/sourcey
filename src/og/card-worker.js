// Draws social cards off the main thread: satori lays a card out as SVG over its
// ground, and resvg rasterises it to PNG. One card at a time per worker.
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const { fontFiles } = workerData;
const [regular, bold] = await Promise.all(fontFiles.map((file) => readFile(file)));
const fonts = [
  { name: "Inter", data: regular, weight: 400, style: "normal" },
  { name: "Inter", data: bold, weight: 700, style: "normal" },
];

parentPort.on("message", async ({ card, ground, width, height }) => {
  try {
    const svg = await satori(card, { width, height, embedFont: true, fonts });
    // The ground is drawn first, beneath everything satori laid out.
    const drawn = svg.replace(/^<svg\b[^>]*>/, (open) => open + ground);
    const png = new Resvg(drawn, {
      fitTo: { mode: "width", value: width },
      // Satori embeds text outlines. Only SVG logos can need a font lookup;
      // keep that database deterministic instead of loading every host font.
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Inter", sansSerifFamily: "Inter" },
    }).render().asPng();
    parentPort.postMessage({ png });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
