import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { endOfLocalDay, startOfLocalDay } from "../shared/time";
import type { AppConfig } from "./config";
import { scanRecordings, type ScanResult } from "./indexer";
import { buildPlaybackPlan } from "./playbackPlan";
import { streamClipFile } from "./streaming";
import { buildDayTimeline, listRecordedDays } from "./timeline";

type CameraParams = {
  cameraId: string;
};

type ClipParams = {
  clipId: string;
};

type TimelineQuery = {
  date?: unknown;
};

type PlanQuery = {
  start?: unknown;
  end?: unknown;
};

type CameraPatchBody = {
  alias?: unknown;
  enabled?: unknown;
};

type RouteDependencies = {
  scanRecordings: typeof scanRecordings;
};

const EXPLICIT_TIME_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
const EXPLICIT_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const SHANGHAI_LOCAL_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const SHANGHAI_OFFSET_HOURS = 8;

function error(message: string) {
  return { error: message };
}

function findCamera(app: FastifyInstance, cameraId: string) {
  return app.catalog.getCameraById(cameraId);
}

function parseDateQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    startOfLocalDay(value);
    return value;
  } catch {
    return null;
  }
}

function parseTimestampQuery(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  if (EXPLICIT_TIME_ZONE.test(value)) {
    return parseExplicitTimestamp(value);
  }

  const match = SHANGHAI_LOCAL_DATETIME.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(millisecondText.padEnd(3, "0"));

  const timestampMs = Date.UTC(year, month - 1, day, hour - SHANGHAI_OFFSET_HOURS, minute, second, millisecond);
  const roundTrip = new Date(timestampMs + SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);

  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second ||
    roundTrip.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  return timestampMs;
}

function parseExplicitTimestamp(value: string): number | null {
  const match = EXPLICIT_DATETIME.exec(value);
  if (!match) {
    return null;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText = "0",
    millisecondText = "0",
    offsetText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(millisecondText.padEnd(3, "0"));
  const offsetMs = parseOffsetMs(offsetText);
  if (offsetMs === null) {
    return null;
  }

  const timestampMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMs;
  const roundTrip = new Date(timestampMs + offsetMs);

  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second ||
    roundTrip.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  return timestampMs;
}

function parseOffsetMs(offsetText: string): number | null {
  if (offsetText === "Z") {
    return 0;
  }

  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offsetText);
  if (!match) {
    return null;
  }

  const [, sign, hoursText, minutesText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  const direction = sign === "+" ? 1 : -1;
  return direction * (hours * 60 + minutes) * 60 * 1000;
}

function listAllCameraClips(app: FastifyInstance, cameraId: string) {
  return app.catalog.listClipsForCamera(cameraId, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
}

function isCameraPatchBody(value: unknown): value is CameraPatchBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  dependencies: RouteDependencies = { scanRecordings },
): void {
  app.post("/api/index/refresh", async (_request, reply): Promise<ScanResult | FastifyReply> => {
    try {
      return dependencies.scanRecordings(app.catalog, config.roots);
    } catch (scanError) {
      app.log.error({ error: scanError }, "failed to refresh recording index");
      return reply.code(500).send(error("Failed to refresh index"));
    }
  });

  app.get("/api/cameras", async () => app.catalog.listCameras());

  app.patch(
    "/api/cameras/:cameraId",
    async (request: FastifyRequest<{ Params: CameraParams; Body: CameraPatchBody }>, reply: FastifyReply) => {
      const camera = findCamera(app, request.params.cameraId);
      if (!camera) {
        return reply.code(404).send(error("Camera not found"));
      }

      if (!isCameraPatchBody(request.body)) {
        return reply.code(400).send(error("Invalid camera update"));
      }

      const body = request.body;
      if (
        (body.alias !== undefined && (typeof body.alias !== "string" || body.alias.length === 0)) ||
        (body.enabled !== undefined && typeof body.enabled !== "boolean")
      ) {
        return reply.code(400).send(error("Invalid camera update"));
      }

      const alias = body.alias ?? camera.alias;
      const enabled = body.enabled ?? camera.enabled;
      app.catalog.updateCameraAlias(camera.id, alias, enabled);

      return findCamera(app, camera.id);
    },
  );

  app.get(
    "/api/cameras/:cameraId/days",
    async (request: FastifyRequest<{ Params: CameraParams }>, reply: FastifyReply) => {
      const camera = findCamera(app, request.params.cameraId);
      if (!camera) {
        return reply.code(404).send(error("Camera not found"));
      }

      return listRecordedDays(listAllCameraClips(app, camera.id));
    },
  );

  app.get(
    "/api/cameras/:cameraId/timeline",
    async (request: FastifyRequest<{ Params: CameraParams; Querystring: TimelineQuery }>, reply: FastifyReply) => {
      const camera = findCamera(app, request.params.cameraId);
      if (!camera) {
        return reply.code(404).send(error("Camera not found"));
      }

      const date = parseDateQuery(request.query.date);
      if (date === null) {
        return reply.code(400).send(error("Invalid date"));
      }

      const clips = app.catalog.listClipsForCamera(camera.id, startOfLocalDay(date), endOfLocalDay(date));
      return buildDayTimeline(clips, date);
    },
  );

  app.get(
    "/api/cameras/:cameraId/plan",
    async (request: FastifyRequest<{ Params: CameraParams; Querystring: PlanQuery }>, reply: FastifyReply) => {
      const camera = findCamera(app, request.params.cameraId);
      if (!camera) {
        return reply.code(404).send(error("Camera not found"));
      }

      const startAtMs = parseTimestampQuery(request.query.start);
      const endAtMs = parseTimestampQuery(request.query.end);
      if (startAtMs === null || endAtMs === null || endAtMs <= startAtMs) {
        return reply.code(400).send(error("Invalid plan range"));
      }

      const clips = app.catalog.listClipsForCamera(camera.id, startAtMs, endAtMs);
      return buildPlaybackPlan(camera.id, clips, startAtMs, endAtMs);
    },
  );

  app.get(
    "/api/clips/:clipId/file",
    async (request: FastifyRequest<{ Params: ClipParams }>, reply: FastifyReply) => {
      const clip = app.catalog.getClipById(request.params.clipId);
      if (!clip) {
        return reply.code(404).send(error("Clip not found"));
      }

      return streamClipFile(request, reply, clip);
    },
  );
}
