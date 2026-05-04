import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { endOfLocalDay, startOfLocalDay } from "../shared/time";
import type { AppConfig } from "./config";
import { scanRecordings } from "./indexer";
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

function error(message: string) {
  return { error: message };
}

function findCamera(app: FastifyInstance, cameraId: string) {
  return app.catalog.listCameras().find((camera) => camera.id === cameraId) ?? null;
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

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function listAllCameraClips(app: FastifyInstance, cameraId: string) {
  return app.catalog.listClipsForCamera(cameraId, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
}

export function registerRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post("/api/index/refresh", async () => scanRecordings(app.catalog, config.roots));

  app.get("/api/cameras", async () => app.catalog.listCameras());

  app.patch(
    "/api/cameras/:cameraId",
    async (request: FastifyRequest<{ Params: CameraParams; Body: CameraPatchBody }>, reply: FastifyReply) => {
      const camera = findCamera(app, request.params.cameraId);
      if (!camera) {
        return reply.code(404).send(error("Camera not found"));
      }

      const body = request.body ?? {};
      if (
        (body.alias !== undefined && typeof body.alias !== "string") ||
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
