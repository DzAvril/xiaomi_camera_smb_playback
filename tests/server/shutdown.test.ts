import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerShutdownHandlers } from "../../src/server/shutdown";

type Signal = "SIGINT" | "SIGTERM";

class ProcessLike extends EventEmitter {
  on(event: Signal, listener: () => void): this {
    return super.on(event, listener);
  }
}

function createApp(close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)) {
  return {
    close,
    log: {
      error: vi.fn(),
    },
  };
}

describe("registerShutdownHandlers", () => {
  it("closes the app and exits 0 on SIGTERM", async () => {
    const app = createApp();
    const processLike = new ProcessLike();
    const exit = vi.fn();

    registerShutdownHandlers(app, { processLike, exit });
    processLike.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("closes the app only once for repeated signals", async () => {
    const app = createApp();
    const processLike = new ProcessLike();
    const exit = vi.fn();

    registerShutdownHandlers(app, { processLike, exit });
    processLike.emit("SIGTERM");
    processLike.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("logs and exits 1 when app close rejects", async () => {
    const closeError = new Error("close failed");
    const app = createApp(vi.fn<() => Promise<void>>().mockRejectedValue(closeError));
    const processLike = new ProcessLike();
    const exit = vi.fn();

    registerShutdownHandlers(app, { processLike, exit });
    processLike.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(app.log.error).toHaveBeenCalledWith({ error: closeError }, "failed to close app during shutdown");
  });
});
