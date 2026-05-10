import { Worker as NodeWorker } from "node:worker_threads";
import type { AppConfig } from "./config.js";
import type { ScanResult } from "./indexer.js";

type RootConfig = AppConfig["roots"][number];

type LogLike = {
  error(payload: unknown, message?: string): void;
  info?(payload: unknown, message?: string): void;
};

type WorkerMessage =
  | {
      ok: true;
      result: ScanResult;
    }
  | {
      ok: false;
      error: {
        message: string;
        name?: string;
        stack?: string;
      };
    };

export type BackgroundIndexer = {
  close(): Promise<void>;
  isRunning(): boolean;
  start(intervalMs: number): void;
  trigger(reason: string): boolean;
};

type BackgroundIndexerOptions = {
  databasePath?: string;
  roots?: RootConfig[];
  log: LogLike;
  runScan?: () => Promise<ScanResult>;
};

function deserializeWorkerError(error: WorkerMessage & { ok: false }): Error {
  const scanError = new Error(error.error.message);
  scanError.name = error.error.name ?? scanError.name;
  scanError.stack = error.error.stack ?? scanError.stack;
  return scanError;
}

function workerExecArgv(): string[] {
  const execArgv: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const arg = process.execArgv[index];
    if (arg === "--input-type") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--input-type=")) {
      continue;
    }
    execArgv.push(arg);
  }

  return execArgv;
}

export function runScanInWorker(databasePath: string, roots: RootConfig[]): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const workerScript = new URL(
      import.meta.url.endsWith(".ts") ? "./indexerWorker.ts" : "./indexerWorker.js",
      import.meta.url,
    );
    const worker = new NodeWorker(workerScript, {
      execArgv: workerExecArgv(),
      workerData: { databasePath, roots },
    });

    worker.once("message", (message: WorkerMessage) => {
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(deserializeWorkerError(message));
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`index worker stopped with exit code ${code}`));
      }
    });
  });
}

export function createBackgroundIndexer(options: BackgroundIndexerOptions): BackgroundIndexer {
  const runScan =
    options.runScan ??
    (() => {
      if (!options.databasePath || !options.roots) {
        throw new Error("databasePath and roots are required for worker-backed indexing");
      }
      return runScanInWorker(options.databasePath, options.roots);
    });

  let running = false;
  let closed = false;
  let interval: NodeJS.Timeout | null = null;

  function trigger(reason: string): boolean {
    if (closed || running) {
      return false;
    }

    running = true;
    void runScan()
      .then((result) => {
        options.log.info?.({ ...result, reason }, "refreshed recording index");
      })
      .catch((error: unknown) => {
        options.log.error({ error, reason }, "failed to refresh recording index");
      })
      .finally(() => {
        running = false;
      });

    return true;
  }

  return {
    close: async () => {
      closed = true;
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    },
    isRunning: () => running,
    start: (intervalMs: number) => {
      if (interval !== null) {
        clearInterval(interval);
      }
      interval = setInterval(() => {
        trigger("interval");
      }, intervalMs);
      interval.unref();
    },
    trigger,
  };
}
