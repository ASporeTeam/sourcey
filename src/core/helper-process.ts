import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type Pending<Reply> = { resolve(reply: Reply): void; reject(error: Error): void };

/**
 * Work whose libraries hold memory a build would otherwise keep to its end,
 * such as a diagram renderer's DOM or an image encoder's buffers, runs in a
 * process of its own. Closing it gives all of that memory back to the
 * system, which a worker thread's ending does not. Requests carry an id and
 * each reply returns it; an idle helper never keeps the build running.
 */
export class HelperProcess<Request extends object, Reply extends { error?: string }> {
  private child?: ChildProcess;
  private sequence = 0;
  private readonly pending = new Map<number, Pending<Reply>>();

  constructor(
    private readonly script: URL,
    private readonly flags: string[] = [],
  ) {}

  private start(): ChildProcess {
    if (this.child) return this.child;
    const child = fork(fileURLToPath(this.script), [], {
      serialization: "advanced",
      // Loaders carry over; the build's own heap settings and input type do not.
      execArgv: [...process.execArgv.filter((arg) => !/^--(input-type|max-old-space-size|max-semi-space-size|stack-size)\b/.test(arg)), ...this.flags],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child.on("message", (reply: Reply & { id: number }) => {
      const request = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      request?.resolve(reply);
      if (!this.pending.size) this.idle(child);
    });
    const lost = (error: Error) => {
      if (this.child === child) this.child = undefined;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    child.on("error", lost);
    child.on("exit", (code, signal) => lost(new Error(`Helper process ended (${signal ?? code})`)));
    return (this.child = child);
  }

  private idle(child: ChildProcess): void {
    child.unref();
    (child.channel as { unref?(): void } | undefined)?.unref?.();
  }

  request(message: Request): Promise<Reply> {
    const child = this.start();
    child.ref();
    (child.channel as { ref?(): void } | undefined)?.ref?.();
    return new Promise<Reply>((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      child.send({ ...message, id });
    });
  }

  /** End the process; the next request starts another. */
  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    for (const request of this.pending.values()) request.reject(new Error("Helper process closed"));
    this.pending.clear();
    if (child.exitCode !== null || child.signalCode !== null) return;
    // Held until it has gone, or an idle build could finish before the exit arrives.
    child.ref();
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await exited;
  }
}
