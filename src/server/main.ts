import { mkdirSync } from "node:fs";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { scanRecordings } from "./indexer";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const app = createApp(config);
try {
  scanRecordings(app.catalog, config.roots);
} catch (error) {
  app.log.error({ error }, "failed to refresh recording index");
}

const scanInterval = setInterval(() => {
  try {
    scanRecordings(app.catalog, config.roots);
  } catch (error) {
    app.log.error({ error }, "failed to refresh recording index");
  }
}, config.scanIntervalSeconds * 1000);
scanInterval.unref();

app.addHook("onClose", () => {
  clearInterval(scanInterval);
});

const port = Number(process.env.PORT ?? "8080");
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });
