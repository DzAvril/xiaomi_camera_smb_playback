import { mkdirSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { createBackgroundIndexer, type BackgroundIndexer } from "./backgroundIndexer.js";
import { registerShutdownHandlers } from "./shutdown.js";

type StartServerOptions = {
  createBackgroundIndexer?: (app: FastifyInstance, config: AppConfig) => BackgroundIndexer;
  host?: string;
  logger?: boolean;
  onListening?: () => void;
  port?: number;
  registerSignals?: boolean;
};

export type StartedServer = {
  app: FastifyInstance;
  indexer: BackgroundIndexer;
};

export async function startServer(config: AppConfig, options: StartServerOptions = {}): Promise<StartedServer> {
  mkdirSync(config.dataDir, { recursive: true });

  const app = createApp(config, { logger: options.logger ?? true });
  const indexer =
    options.createBackgroundIndexer?.(app, config) ??
    createBackgroundIndexer({
      databasePath: config.databasePath,
      roots: config.roots,
      log: app.log,
    });

  app.addHook("onClose", async () => {
    await indexer.close();
  });

  if (options.registerSignals ?? true) {
    registerShutdownHandlers(app);
  }

  await app.listen({
    port: options.port ?? Number(process.env.PORT ?? "8080"),
    host: options.host ?? process.env.HOST ?? "0.0.0.0",
  });
  options.onListening?.();

  indexer.start(config.scanIntervalSeconds * 1000);
  indexer.trigger("startup");

  return { app, indexer };
}
