// Draws social cards off the main thread. Satori lays each card out as SVG
// over its ground here; resvg rasterises it and sharp encodes the PNG on
// native threads, so one worker keeps many cards in flight.
import { readFile } from "node:fs/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { parentPort, workerData } from "node:worker_threads";
import satori from "satori";
import { renderAsync } from "@resvg/resvg-js";
import sharp from "sharp";

// resvg keeps each card's 3 MB of pixels in native memory until the garbage
// collector finalizes the object holding them, and the collector never counts
// that memory, so hundreds of cards' pixels pile up between collections. The
// worker collects every few cards instead, so at most a few cards' pixels wait.
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc");
const COLLECT_EVERY = 8;
let cards = 0;

const { fontFiles } = workerData;
const [regular, bold] = await Promise.all(fontFiles.map((file) => readFile(file)));
const fonts = [
  { name: "Inter", data: regular, weight: 400, style: "normal" },
  { name: "Inter", data: bold, weight: 700, style: "normal" },
];

parentPort.on("message", async ({ id, card, ground, width, height }) => {
  try {
    const svg = await satori(card, { width, height, embedFont: true, fonts });
    // The ground is drawn first, beneath everything satori laid out.
    const drawn = svg.replace(/^<svg\b[^>]*>/, (open) => open + ground);
    let image = await renderAsync(drawn, {
      fitTo: { mode: "width", value: width },
      // Satori embeds text outlines. Only SVG logos can need a font lookup;
      // keep that database deterministic instead of loading every host font.
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Inter", sansSerifFamily: "Inter" },
    });
    const png = await sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
    image = undefined;
    if (++cards % COLLECT_EVERY === 0) collect();
    parentPort.postMessage({ id, png });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
