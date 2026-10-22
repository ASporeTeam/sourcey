import { HelperProcess } from "../core/helper-process.js";

export interface CardDrawing {
  /** The card's layout, as satori reads it. */
  card: unknown;
  /** SVG drawn beneath the card. */
  ground: string;
  width: number;
  height: number;
}

/**
 * Cards draw in a process of their own, which lays many out at a time while
 * native threads rasterise and encode them; it collects its own garbage, as
 * the pixels it holds are memory the collector does not count.
 */
const drawer = new HelperProcess<CardDrawing, { png?: Uint8Array; error?: string }>(
  new URL("./card-worker.js", import.meta.url),
  ["--expose-gc"],
);

/** A card drawn to PNG; the drawer starts with the first card. */
export async function drawCard(drawing: CardDrawing): Promise<Buffer> {
  const reply = await drawer.request(drawing);
  if (reply.error !== undefined) throw new Error(reply.error);
  return Buffer.from(reply.png!.buffer, reply.png!.byteOffset, reply.png!.byteLength);
}

/** Ends the drawer and gives back what it held; the next card starts another. */
export async function closeCardDrawer(): Promise<void> {
  await drawer.close();
}
