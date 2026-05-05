import Database from "better-sqlite3";
import type { CameraStream, ClipRecord } from "../shared/types.js";

export type CameraMetadata = {
  id: string;
  rootId: string;
  rootPath: string;
  channel: string;
  alias: string;
  enabled: boolean;
};

type CameraRow = {
  id: string;
  root_id: string;
  root_path: string;
  channel: string;
  alias: string;
  enabled: number;
};

type CameraInput = {
  id: string;
  rootId: string;
  rootPath: string;
  channel: string;
  alias: string;
  enabled: boolean;
};

type ClipRow = {
  id: string;
  source_file_id: string | null;
  camera_id: string;
  root_path: string;
  relative_path: string;
  channel: string;
  start_at_ms: number;
  end_at_ms: number;
  duration_seconds: number;
  size_bytes: number;
  mtime_ms: number;
  media_start_seconds: number | null;
};

type SettingRow = {
  value: string;
};

export type Catalog = ReturnType<typeof openCatalog>;

export function openCatalog(databasePath: string) {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS camera_streams (
      id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL,
      root_path TEXT NOT NULL,
      channel TEXT NOT NULL,
      alias TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      source_file_id TEXT,
      camera_id TEXT NOT NULL REFERENCES camera_streams(id) ON DELETE CASCADE,
      root_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      channel TEXT NOT NULL,
      start_at_ms INTEGER NOT NULL,
      end_at_ms INTEGER NOT NULL,
      duration_seconds REAL NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      media_start_seconds REAL NOT NULL DEFAULT 0,
      indexed_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clips_camera_start ON clips(camera_id, start_at_ms);
    CREATE INDEX IF NOT EXISTS idx_clips_camera_end ON clips(camera_id, end_at_ms);
    CREATE INDEX IF NOT EXISTS idx_clips_camera_end_start ON clips(camera_id, end_at_ms, start_at_ms);
  `);
  const clipColumns = new Set(
    db
      .prepare("PRAGMA table_info(clips)")
      .all()
      .map((row) => (row as { name: string }).name),
  );
  if (!clipColumns.has("source_file_id")) {
    db.exec("ALTER TABLE clips ADD COLUMN source_file_id TEXT");
  }
  if (!clipColumns.has("media_start_seconds")) {
    db.exec("ALTER TABLE clips ADD COLUMN media_start_seconds REAL NOT NULL DEFAULT 0");
  }
  db.exec("CREATE TEMP TABLE IF NOT EXISTS seen_clip_ids (id TEXT PRIMARY KEY)");

  const upsertCameraStmt = db.prepare(`
    INSERT INTO camera_streams (id, root_id, root_path, channel, alias, enabled, created_at_ms, updated_at_ms)
    VALUES (@id, @rootId, @rootPath, @channel, @alias, @enabled, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      root_id = excluded.root_id,
      root_path = excluded.root_path,
      channel = excluded.channel,
      updated_at_ms = excluded.updated_at_ms
  `);

  const upsertClipStmt = db.prepare(`
    INSERT INTO clips (
      id,
      source_file_id,
      camera_id,
      root_path,
      relative_path,
      channel,
      start_at_ms,
      end_at_ms,
      duration_seconds,
      size_bytes,
      mtime_ms,
      media_start_seconds,
      indexed_at_ms
    )
    VALUES (
      @id,
      @sourceFileId,
      @cameraId,
      @rootPath,
      @relativePath,
      @channel,
      @startAtMs,
      @endAtMs,
      @durationSeconds,
      @sizeBytes,
      @mtimeMs,
      @mediaStartSeconds,
      @indexedAtMs
    )
    ON CONFLICT(id) DO UPDATE SET
      source_file_id = excluded.source_file_id,
      camera_id = excluded.camera_id,
      root_path = excluded.root_path,
      relative_path = excluded.relative_path,
      channel = excluded.channel,
      start_at_ms = excluded.start_at_ms,
      end_at_ms = excluded.end_at_ms,
      duration_seconds = excluded.duration_seconds,
      size_bytes = excluded.size_bytes,
      mtime_ms = excluded.mtime_ms,
      media_start_seconds = excluded.media_start_seconds,
      indexed_at_ms = excluded.indexed_at_ms
  `);
  const clearSeenClipIdsStmt = db.prepare("DELETE FROM seen_clip_ids");
  const insertSeenClipIdStmt = db.prepare("INSERT OR IGNORE INTO seen_clip_ids (id) VALUES (?)");
  const deleteClipsNotInSeenTableStmt = db.prepare(`
    DELETE FROM clips
    WHERE camera_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM seen_clip_ids
        WHERE seen_clip_ids.id = clips.id
      )
  `);
  const removeClipsNotInSeenTable = db.transaction((cameraId: string, seenIds: string[]) => {
    clearSeenClipIdsStmt.run();
    for (const seenId of seenIds) {
      insertSeenClipIdStmt.run(seenId);
    }
    deleteClipsNotInSeenTableStmt.run(cameraId);
    clearSeenClipIdsStmt.run();
  });

  function toClip(row: ClipRow): ClipRecord {
    return {
      id: row.id,
      sourceFileId: row.source_file_id ?? row.id,
      cameraId: row.camera_id,
      rootPath: row.root_path,
      relativePath: row.relative_path,
      channel: row.channel,
      startAtMs: row.start_at_ms,
      endAtMs: row.end_at_ms,
      durationSeconds: row.duration_seconds,
      sizeBytes: row.size_bytes,
      mtimeMs: row.mtime_ms,
      mediaStartSeconds: row.media_start_seconds ?? 0,
    };
  }

  function toCameraMetadata(row: CameraRow): CameraMetadata {
    return {
      id: row.id,
      rootId: row.root_id,
      rootPath: row.root_path,
      channel: row.channel,
      alias: row.alias,
      enabled: row.enabled === 1,
    };
  }

  return {
    db,
    upsertCamera(input: CameraInput) {
      upsertCameraStmt.run({ ...input, enabled: input.enabled ? 1 : 0, now: Date.now() });
    },
    upsertClip(input: ClipRecord) {
      upsertClipStmt.run({
        ...input,
        indexedAtMs: Date.now(),
        mediaStartSeconds: input.mediaStartSeconds ?? 0,
        sourceFileId: input.sourceFileId ?? input.id,
      });
    },
    removeClipsNotSeen(cameraId: string, seenIds: string[]) {
      if (seenIds.length === 0) {
        db.prepare("DELETE FROM clips WHERE camera_id = ?").run(cameraId);
        return;
      }

      removeClipsNotInSeenTable(cameraId, seenIds);
    },
    listCameras(): CameraStream[] {
      const rows = db
        .prepare(
          `
          SELECT
            cs.*,
            COUNT(c.id) AS clip_count,
            COALESCE(SUM(c.duration_seconds), 0) AS total_seconds,
            COALESCE(bytes.total_bytes, 0) AS total_bytes,
            MAX(c.end_at_ms) AS latest_end_at_ms,
            COUNT(DISTINCT strftime('%Y-%m-%d', c.start_at_ms / 1000 + 8 * 60 * 60, 'unixepoch')) AS recorded_days,
            GROUP_CONCAT(DISTINCT strftime('%Y-%m-%d', c.start_at_ms / 1000 + 8 * 60 * 60, 'unixepoch')) AS recorded_dates
          FROM camera_streams cs
          LEFT JOIN clips c ON c.camera_id = cs.id
          LEFT JOIN (
            SELECT camera_id, SUM(size_bytes) AS total_bytes
            FROM (
              SELECT camera_id, COALESCE(source_file_id, id) AS source_file_key, MAX(size_bytes) AS size_bytes
              FROM clips
              GROUP BY camera_id, source_file_key
            ) physical_files
            GROUP BY camera_id
          ) bytes ON bytes.camera_id = cs.id
          GROUP BY cs.id
          ORDER BY latest_end_at_ms DESC NULLS LAST, cs.alias ASC
        `,
        )
        .all() as Array<
        CameraRow & {
          clip_count: number;
          total_seconds: number;
          total_bytes: number;
          latest_end_at_ms: number | null;
          recorded_days: number;
          recorded_dates: string | null;
        }
      >;

      return rows.map((row) => ({
        ...toCameraMetadata(row),
        clipCount: row.clip_count,
        recordedDays: row.recorded_days,
        recordedDates: row.recorded_dates ? row.recorded_dates.split(",").sort() : [],
        totalSeconds: row.total_seconds,
        totalBytes: row.total_bytes,
        latestEndAtMs: row.latest_end_at_ms,
      }));
    },
    getCameraById(cameraId: string): CameraMetadata | null {
      const row = db.prepare("SELECT * FROM camera_streams WHERE id = ?").get(cameraId) as CameraRow | undefined;
      return row ? toCameraMetadata(row) : null;
    },
    listClipsForCamera(cameraId: string, startAtMs: number, endAtMs: number): ClipRecord[] {
      const rows = db
        .prepare(
          `
          SELECT * FROM clips INDEXED BY idx_clips_camera_end_start
          WHERE camera_id = ?
            AND end_at_ms > ?
            AND start_at_ms < ?
          ORDER BY start_at_ms ASC
        `,
        )
        .all(cameraId, startAtMs, endAtMs) as ClipRow[];

      return rows.map(toClip);
    },
    getClipById(clipId: string): ClipRecord | null {
      const row = db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId) as ClipRow | undefined;
      return row ? toClip(row) : null;
    },
    updateCameraAlias(cameraId: string, alias: string, enabled: boolean) {
      db.prepare("UPDATE camera_streams SET alias = ?, enabled = ?, updated_at_ms = ? WHERE id = ?").run(
        alias,
        enabled ? 1 : 0,
        Date.now(),
        cameraId,
      );
    },
    getSetting(key: string): string | null {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as SettingRow | undefined;
      return row?.value ?? null;
    },
    setSetting(key: string, value: string) {
      db.prepare(
        `
          INSERT INTO app_settings (key, value, updated_at_ms)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at_ms = excluded.updated_at_ms
        `,
      ).run(key, value, Date.now());
    },
    close() {
      db.close();
    },
  };
}
