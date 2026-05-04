import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config";

describe("loadConfig", () => {
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
});
