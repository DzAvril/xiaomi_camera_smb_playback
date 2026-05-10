import { describe, expect, it, vi } from "vitest";
import { createBackgroundIndexer } from "../../src/server/backgroundIndexer";
import type { ScanResult } from "../../src/server/indexer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe("background indexer", () => {
  it("runs scans in the background without overlapping periodic triggers", async () => {
    const firstScan = deferred<ScanResult>();
    const runScan = vi.fn<() => Promise<ScanResult>>().mockReturnValue(firstScan.promise);
    const log = { error: vi.fn(), info: vi.fn() };
    const indexer = createBackgroundIndexer({ runScan, log });

    expect(indexer.trigger("startup")).toBe(true);
    expect(indexer.trigger("interval")).toBe(false);
    expect(runScan).toHaveBeenCalledTimes(1);

    firstScan.resolve({ cameraCount: 1, clipCount: 2 });
    await firstScan.promise;
    await vi.waitFor(() => expect(indexer.isRunning()).toBe(false));

    expect(indexer.trigger("interval")).toBe(true);
    expect(runScan).toHaveBeenCalledTimes(2);
  });

  it("logs scan failures without rejecting readiness work", async () => {
    const scanError = new Error("scan failed");
    const runScan = vi.fn<() => Promise<ScanResult>>().mockRejectedValue(scanError);
    const log = { error: vi.fn(), info: vi.fn() };
    const indexer = createBackgroundIndexer({ runScan, log });

    expect(indexer.trigger("startup")).toBe(true);

    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        { error: scanError, reason: "startup" },
        "failed to refresh recording index",
      );
    });
    expect(indexer.isRunning()).toBe(false);
  });
});
