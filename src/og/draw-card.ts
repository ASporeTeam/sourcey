import { Worker } from "node:worker_threads";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_JOB_SLOTS } from "../core/build-jobs.js";

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
const drawing = new Map<Worker, Request>();
const idle: Worker[] = [];
const waiting: Array<(worker: Worker) => void> = [];
let workers = 0;

function release(worker: Worker): void {
  const next = waiting.shift();
  if (next) return next(worker);
  worker.unref();
  idle.push(worker);
}

function start(): Worker {
  workers++;
  const worker = new Worker(new URL("./card-worker.js", import.meta.url), {
    workerData: { fontFiles },
    // Loaders carry over; a worker refuses the process's own heap and stack sizes.
    execArgv: process.execArgv.filter((arg) => !/^--(input-type|max-old-space-size|max-semi-space-size|stack-size)\b/.test(arg)),
  });
  worker.on("message", ({ png, error }: { png?: Uint8Array; error?: string }) => {
    const request = drawing.get(worker);
    drawing.delete(worker);
    if (error) request?.reject(new Error(error));
    else request?.resolve(Buffer.from(png!.buffer, png!.byteOffset, png!.byteLength));
    release(worker);
  });
  worker.on("error", (error) => {
    workers--;
    drawing.get(worker)?.reject(error instanceof Error ? error : new Error(String(error)));
    drawing.delete(worker);
    const at = idle.indexOf(worker);
    if (at >= 0) idle.splice(at, 1);
    // A card waiting on the pool takes a fresh worker in place of the lost one.
    const next = waiting.shift();
    if (next) next(start());
  });
  return worker;
}

async function acquire(): Promise<Worker> {
  const worker = idle.pop();
  if (worker) return worker;
  if (workers < BUILD_JOB_SLOTS) return start();
  return new Promise((resolve) => waiting.push(resolve));
}

/**
 * A card drawn to PNG on a worker thread. Workers start as cards need them, up to
 * the heavy-job budget, and keep their fonts and renderer loaded between cards.
 */
export async function drawCard({ card, ground, width, height }: CardDrawing): Promise<Buffer> {
  const worker = await acquire();
  worker.ref();
  return new Promise<Buffer>((resolve, reject) => {
    drawing.set(worker, { resolve, reject });
    worker.postMessage({ card, ground, width, height });
  });
}
