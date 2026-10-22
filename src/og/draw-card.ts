import { Worker } from "node:worker_threads";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fontFiles = ["Inter-Regular.ttf", "Inter-Bold.ttf"].map((file) =>
  resolve(dirname(fileURLToPath(import.meta.url)), "fonts", file),
);

export interface CardDrawing {
  /** The card's layout, as satori reads it. */
  card: unknown;
  /** SVG drawn beneath the card. */
  ground: string;
  width: number;
  height: number;
}

type Request = { resolve(png: Buffer): void; reject(error: Error): void };
let worker: Worker | undefined;
let sequence = 0;
const requests = new Map<number, Request>();

function drawer(): Worker {
  if (worker) return worker;
  const started = new Worker(new URL("./card-worker.js", import.meta.url), {
    workerData: { fontFiles },
    // Loaders carry over; a worker refuses the process's own heap and stack sizes.
    execArgv: process.execArgv.filter((arg) => !/^--(input-type|max-old-space-size|max-semi-space-size|stack-size)\b/.test(arg)),
  });
  started.on("message", ({ id, png, error }: { id: number; png?: Uint8Array; error?: string }) => {
    const request = requests.get(id);
    requests.delete(id);
    if (error) request?.reject(new Error(error));
    else request?.resolve(Buffer.from(png!.buffer, png!.byteOffset, png!.byteLength));
    if (!requests.size) started.unref();
  });
  started.on("error", (error) => {
    for (const request of requests.values()) request.reject(error instanceof Error ? error : new Error(String(error)));
    requests.clear();
    if (worker === started) worker = undefined;
  });
  return (worker = started);
}

/**
 * A card drawn to PNG. One worker lays cards out, many at a time, while
 * native threads rasterise and encode them; it starts with the first card.
 */
export function drawCard({ card, ground, width, height }: CardDrawing): Promise<Buffer> {
  const instance = drawer();
  instance.ref();
  return new Promise<Buffer>((resolve, reject) => {
    const id = ++sequence;
    requests.set(id, { resolve, reject });
    instance.postMessage({ id, card, ground, width, height });
  });
}

/** Ends the worker and frees what it holds; the next card starts another. */
export async function closeCardDrawer(): Promise<void> {
  const current = worker;
  worker = undefined;
  for (const request of requests.values()) request.reject(new Error("Card drawing closed"));
  requests.clear();
  if (current) await current.terminate();
}
