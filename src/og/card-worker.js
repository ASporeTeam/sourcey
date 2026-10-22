// Draws social cards in a process of its own. Satori lays each card out as
// SVG over its ground here; resvg rasterises it and sharp encodes the PNG on
// native threads, so one process keeps many cards in flight.
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import satori from "satori";
import { renderAsync } from "@resvg/resvg-js";
import sharp from "sharp";

// resvg keeps each card's 3 MB of pixels in native memory until the garbage
// collector finalizes the object holding them, and the collector never counts
// that memory, so hundreds of cards' pixels pile up between collections. The
// process collects every few cards instead, so at most a few cards' pixels wait.
const COLLECT_EVERY = 8;
let cards = 0;
// Each card is one small image: the process holds no image cache, and each
// encode takes one thread, as cards already draw several at a time.
sharp.cache(false);
sharp.concurrency(1);

const fontFiles = ["Inter-Regular.ttf", "Inter-Bold.ttf"].map((file) => fileURLToPath(new URL(`./fonts/${file}`, import.meta.url)));
const [regular, bold] = await Promise.all(fontFiles.map((file) => readFile(file)));
const fonts = [
  { name: "Inter", data: regular, weight: 400, style: "normal" },
  { name: "Inter", data: bold, weight: 700, style: "normal" },
];

process.on("message", async ({ id, card, ground, width, height }) => {
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
    if (++cards % COLLECT_EVERY === 0) globalThis.gc?.();
    process.send({ id, png });
  } catch (error) {
    process.send({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
