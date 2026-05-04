type ShutdownSignal = "SIGINT" | "SIGTERM";

type ProcessLike = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
};

type ShutdownApp = {
  close(): Promise<unknown>;
  log: {
    error: (bindings: { error: unknown }, message: string) => void;
  };
};

type ShutdownOptions = {
  processLike?: ProcessLike;
  exit?: (code: 0 | 1) => void;
};

export function registerShutdownHandlers(
  app: ShutdownApp,
  { processLike = process, exit = (code) => process.exit(code) }: ShutdownOptions = {},
): void {
  let isShuttingDown = false;

  async function shutdown() {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    try {
      await app.close();
      exit(0);
    } catch (error) {
      app.log.error({ error }, "failed to close app during shutdown");
      exit(1);
    }
  }

  processLike.on("SIGINT", () => {
    void shutdown();
  });
  processLike.on("SIGTERM", () => {
    void shutdown();
  });
}
