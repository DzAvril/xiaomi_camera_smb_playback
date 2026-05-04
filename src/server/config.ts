import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { parseXiaomiClipName } from "./parser.js";

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

type DiscoveredRoot = z.infer<typeof RootSchema>;

const DEFAULT_RECORDINGS_DIR = "/recordings";
const XIAOMI_ID_PATTERN = /([a-f0-9]{12})$/i;
const MAX_DISCOVERY_DEPTH = 4;

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

function rootIdFromPath(rootPath: string): string {
  const basename = path.basename(rootPath);
  const match = XIAOMI_ID_PATTERN.exec(basename);
  if (match) {
    return match[1].toLowerCase();
  }

  return basename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function listDirectoryEntries(directoryPath: string) {
  try {
    return readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return null;
  }
}

function discoverRecordingRoots(recordingsDir: string): DiscoveredRoot[] {
  const roots: DiscoveredRoot[] = [];

  function visit(directoryPath: string, depth: number) {
    const entries = listDirectoryEntries(directoryPath);
    if (entries === null) {
      return;
    }

    const channels = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const parsed = parseXiaomiClipName(entry.name);
      if (parsed) {
        channels.add(parsed.channel);
      }
    }

    if (channels.size > 0) {
      const basename = path.basename(directoryPath);
      roots.push({
        id: rootIdFromPath(directoryPath),
        path: directoryPath,
        streams: [...channels].sort().map((channel) => ({
          alias: `${basename} ${channel}`,
          channel,
          enabled: true,
        })),
      });
      return;
    }

    if (depth >= MAX_DISCOVERY_DEPTH) {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        visit(path.join(directoryPath, entry.name), depth + 1);
      }
    }
  }

  visit(path.resolve(recordingsDir), 0);
  return roots.sort((a, b) => a.id.localeCompare(b.id));
}

function ensureCameraConfig(cameraConfigPath: string, recordingsDir: string): void {
  const discovered = discoverRecordingRoots(recordingsDir);

  if (!existsSync(cameraConfigPath)) {
    mkdirSync(path.dirname(cameraConfigPath), { recursive: true });
    writeFileSync(cameraConfigPath, stringify({ recordingRoots: discovered }), "utf8");
    return;
  }

  const existing = CameraConfigSchema.parse(parse(readFileSync(cameraConfigPath, "utf8")));
  const rootsById = new Map(existing.recordingRoots.map((root) => [root.id.toLowerCase(), root]));

  for (const discoveredRoot of discovered) {
    const existingRoot = rootsById.get(discoveredRoot.id.toLowerCase());
    if (!existingRoot) {
      existing.recordingRoots.push(discoveredRoot);
      rootsById.set(discoveredRoot.id.toLowerCase(), discoveredRoot);
      continue;
    }

    existingRoot.path = discoveredRoot.path;
    const channels = new Set(existingRoot.streams.map((stream) => stream.channel));
    for (const discoveredStream of discoveredRoot.streams) {
      if (!channels.has(discoveredStream.channel)) {
        existingRoot.streams.push(discoveredStream);
        channels.add(discoveredStream.channel);
      }
    }
    existingRoot.streams.sort((a, b) => a.channel.localeCompare(b.channel));
  }

  existing.recordingRoots.sort((a, b) => a.id.localeCompare(b.id));
  validateCameraConfig(existing);
  writeFileSync(cameraConfigPath, stringify(existing), "utf8");
}

export function loadConfig(env: EnvLike = process.env): AppConfig {
  const password = env.APP_PASSWORD;
  if (!password) {
    throw new Error("APP_PASSWORD is required");
  }

  const dataDir = env.DATA_DIR ?? "app-data";
  const cameraConfigPath = env.CAMERA_CONFIG_PATH ?? path.join(dataDir, "cameras.yaml");
  const timezone = env.TZ ?? "Asia/Shanghai";
  const scanIntervalSeconds = Number(env.SCAN_INTERVAL_SECONDS ?? "300");
  const recordingsDir = env.RECORDINGS_DIR ?? DEFAULT_RECORDINGS_DIR;

  if (!Number.isFinite(scanIntervalSeconds) || scanIntervalSeconds < 30) {
    throw new Error("SCAN_INTERVAL_SECONDS must be at least 30");
  }

  if (!env.CAMERA_CONFIG_PATH) {
    ensureCameraConfig(cameraConfigPath, recordingsDir);
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
