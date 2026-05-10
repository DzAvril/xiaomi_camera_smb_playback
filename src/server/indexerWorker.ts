import { parentPort, workerData } from "node:worker_threads";
import type { AppConfig } from "./config.js";
import { openCatalog } from "./db.js";
import { scanRecordings } from "./indexer.js";

type WorkerData = {
  databasePath: string;
  roots: AppConfig["roots"];
};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

const { databasePath, roots } = workerData as WorkerData;
const catalog = openCatalog(databasePath);

try {
  const result = scanRecordings(catalog, roots);
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: serializeError(error) });
} finally {
  catalog.close();
}
