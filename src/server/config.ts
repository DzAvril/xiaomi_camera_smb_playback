import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const StreamSchema = z.object({
  channel: z.string().regex(/^\d{2}$/),
  alias: z.string().min(1),
  enabled: z.boolean().default(true),
});

const RootSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  streams: z.array(StreamSchema).min(1),
});

const CameraConfigSchema = z.object({
  recordingRoots: z.array(RootSchema),
});

export type AppConfig = {
  password: string;
  timezone: string;
  dataDir: string;
  databasePath: string;
  cameraConfigPath: string;
  scanIntervalSeconds: number;
  roots: Array<{
    id: string;
    path: string;
    streams: Array<{
      channel: string;
      alias: string;
      enabled: boolean;
    }>;
  }>;
};

export type EnvLike = Record<string, string | undefined>;

function validateCameraConfig(parsed: z.infer<typeof CameraConfigSchema>): void {
  const rootIds = new Set<string>();

  for (const root of parsed.recordingRoots) {
    const normalizedRootId = root.id.toLowerCase();
    if (rootIds.has(normalizedRootId)) {
      throw new Error(`Duplicate recording root id: ${normalizedRootId}`);
    }
    rootIds.add(normalizedRootId);

    const channels = new Set<string>();
    for (const stream of root.streams) {
      if (channels.has(stream.channel)) {
        throw new Error(`Duplicate stream channel for root ${root.id}: ${stream.channel}`);
      }
      channels.add(stream.channel);
    }
  }
}

export function loadConfig(env: EnvLike = process.env): AppConfig {
  const password = env.APP_PASSWORD;
  if (!password) {
    throw new Error("APP_PASSWORD is required");
  }

  const cameraConfigPath = env.CAMERA_CONFIG_PATH ?? "config/cameras.yaml";
  const dataDir = env.DATA_DIR ?? "app-data";
  const timezone = env.TZ ?? "Asia/Shanghai";
  const scanIntervalSeconds = Number(env.SCAN_INTERVAL_SECONDS ?? "300");

  if (!Number.isFinite(scanIntervalSeconds) || scanIntervalSeconds < 30) {
    throw new Error("SCAN_INTERVAL_SECONDS must be at least 30");
  }

  const yaml = readFileSync(cameraConfigPath, "utf8");
  const parsed = CameraConfigSchema.parse(parse(yaml));
  validateCameraConfig(parsed);

  return {
    password,
    timezone,
    dataDir,
    databasePath: env.DATABASE_PATH ?? path.join(dataDir, "catalog.sqlite"),
    cameraConfigPath,
    scanIntervalSeconds,
    roots: parsed.recordingRoots.map((root) => ({
      ...root,
      path: path.resolve(root.path),
    })),
  };
}
