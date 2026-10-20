import { availableParallelism } from "node:os";

// Images and diagram layout share one process-wide budget, including concurrent
// sites, of half the machine's parallelism: each job's encoder or layout runs on
// threads of its own. Cheap parsing and source reads do not occupy these slots.
const SLOTS = Math.max(2, Math.floor(availableParallelism() / 2));
let active = 0;
const waiting: Array<() => void> = [];
export async function heavyBuildJob<T>(run: () => Promise<T>): Promise<T> {
  if (active >= SLOTS) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
