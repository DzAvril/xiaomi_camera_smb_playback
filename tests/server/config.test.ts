import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config";

function writeCameraConfig(lines: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xcp-config-"));
  const configPath = path.join(dir, "cameras.yaml");
  writeFileSync(configPath, lines.join("\n"));
  return configPath;
}

describe("loadConfig", () => {
  it("discovers mounted recording directories and writes an internal camera config when no config path is provided", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xcp-config-"));
    const dataDir = path.join(dir, "app-data");
    const recordingsDir = path.join(dir, "recordings");
    const singleRoot = path.join(recordingsDir, "XiaomiCamera_00_B888808A681C");
    const dualRoot = path.join(recordingsDir, "xiaomi_camera_videos", "B888809544F6");
    mkdirSync(singleRoot, { recursive: true });
    mkdirSync(dualRoot, { recursive: true });
    writeFileSync(path.join(singleRoot, "00_20260504103350_20260504104702.mp4"), Buffer.alloc(16));
    writeFileSync(path.join(dualRoot, "00_20260504103350_20260504104702.mp4"), Buffer.alloc(16));
    writeFileSync(path.join(dualRoot, "10_20260504103350_20260504104720.mp4"), Buffer.alloc(32));

    const config = loadConfig({
      APP_PASSWORD: "secret",
      DATA_DIR: dataDir,
      RECORDINGS_DIR: recordingsDir,
    });

    expect(config.cameraConfigPath).toBe(path.join(dataDir, "cameras.yaml"));
    expect(
      config.roots.map((root) => ({
        id: root.id,
        path: path.relative(recordingsDir, root.path),
        streams: root.streams.map((stream) => ({
          alias: stream.alias,
          channel: stream.channel,
          enabled: stream.enabled,
        })),
      })),
    ).toEqual([
      {
        id: "b888808a681c",
        path: "XiaomiCamera_00_B888808A681C",
        streams: [{ alias: "XiaomiCamera_00_B888808A681C 00", channel: "00", enabled: true }],
      },
      {
        id: "b888809544f6",
        path: path.join("xiaomi_camera_videos", "B888809544F6"),
        streams: [
          { alias: "B888809544F6 00", channel: "00", enabled: true },
          { alias: "B888809544F6 10", channel: "10", enabled: true },
        ],
      },
    ]);
    expect(readFileSync(config.cameraConfigPath, "utf8")).toContain("recordingRoots:");
  });

  it("keeps existing internal aliases and adds newly mounted recording roots", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xcp-config-"));
    const dataDir = path.join(dir, "app-data");
    const recordingsDir = path.join(dir, "recordings");
    const existingRoot = path.join(recordingsDir, "XiaomiCamera_00_B888808A681C");
    const newRoot = path.join(recordingsDir, "B888809544F6");
    mkdirSync(existingRoot, { recursive: true });
    mkdirSync(newRoot, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(existingRoot, "00_20260504103350_20260504104702.mp4"), Buffer.alloc(16));
    writeFileSync(path.join(newRoot, "10_20260504103350_20260504104720.mp4"), Buffer.alloc(32));
    writeFileSync(
      path.join(dataDir, "cameras.yaml"),
      [
        "recordingRoots:",
        "  - id: b888808a681c",
        `    path: ${JSON.stringify(existingRoot)}`,
        "    streams:",
        '      - channel: "00"',
        "        alias: 前院",
      ].join("\n"),
    );

    const config = loadConfig({
      APP_PASSWORD: "secret",
      DATA_DIR: dataDir,
      RECORDINGS_DIR: recordingsDir,
    });

    expect(config.roots.map((root) => [root.id, root.streams.map((stream) => stream.alias)])).toEqual([
      ["b888808a681c", ["前院"]],
      ["b888809544f6", ["B888809544F6 10"]],
    ]);
    expect(readFileSync(config.cameraConfigPath, "utf8")).toContain("B888809544F6 10");
  });

  it("loads camera roots and streams from yaml", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xcp-config-"));
    const configPath = path.join(dir, "cameras.yaml");
    writeFileSync(
      configPath,
      [
        "recordingRoots:",
        "  - id: b888809544f6",
        `    path: ${JSON.stringify(path.join(dir, "dual"))}`,
        "    streams:",
        '      - channel: "00"',
        '        alias: "双摄 A"',
        '      - channel: "10"',
        '        alias: "双摄 B"',
      ].join("\n"),
    );

    const config = loadConfig({
      APP_PASSWORD: "secret",
      CAMERA_CONFIG_PATH: configPath,
      DATA_DIR: path.join(dir, "data"),
      TZ: "Asia/Shanghai",
      SCAN_INTERVAL_SECONDS: "120",
    });

    expect(config.password).toBe("secret");
    expect(config.timezone).toBe("Asia/Shanghai");
    expect(config.scanIntervalSeconds).toBe(120);
    expect(config.roots).toHaveLength(1);
    expect(config.roots[0].streams.map((stream) => stream.alias)).toEqual([
      "双摄 A",
      "双摄 B",
    ]);
  });

  it("rejects missing password", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xcp-config-"));
    const configPath = path.join(dir, "cameras.yaml");
    writeFileSync(configPath, "recordingRoots: []\n");

    expect(() =>
      loadConfig({
        CAMERA_CONFIG_PATH: configPath,
        DATA_DIR: path.join(dir, "data"),
      }),
    ).toThrow("APP_PASSWORD is required");
  });

  it("rejects recording root ids that only differ by case", () => {
    const configPath = writeCameraConfig([
      "recordingRoots:",
      "  - id: Dual",
      "    path: /recordings/dual-a",
      "    streams:",
      '      - channel: "00"',
      "        alias: A",
      "  - id: dual",
      "    path: /recordings/dual-b",
      "    streams:",
      '      - channel: "00"',
      "        alias: B",
    ]);

    expect(() =>
      loadConfig({
        APP_PASSWORD: "secret",
        CAMERA_CONFIG_PATH: configPath,
      }),
    ).toThrow("Duplicate recording root id: dual");
  });

  it("rejects duplicate stream channels within a recording root", () => {
    const configPath = writeCameraConfig([
      "recordingRoots:",
      "  - id: dual",
      "    path: /recordings/dual",
      "    streams:",
      '      - channel: "00"',
      "        alias: A",
      '      - channel: "00"',
      "        alias: B",
    ]);

    expect(() =>
      loadConfig({
        APP_PASSWORD: "secret",
        CAMERA_CONFIG_PATH: configPath,
      }),
    ).toThrow("Duplicate stream channel for root dual: 00");
  });
});
