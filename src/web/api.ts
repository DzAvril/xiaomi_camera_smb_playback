import type { CameraStream, PlaybackPlan, RecordingDay, TimelineSpan } from "../shared/types";

type JsonBody = Record<string, unknown> | unknown[];
type CameraUpdate = {
  alias?: string;
  enabled?: boolean;
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function requestVoid(path: string, init: RequestInit = {}): Promise<void> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new Error(message);
  }
}

function toJson(body: JsonBody): string {
  return JSON.stringify(body);
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value);
}

export const api = {
  createSession(password: string): Promise<void> {
    return requestVoid("/api/session", {
      method: "POST",
      body: toJson({ password }),
    });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return requestVoid("/api/settings/password", {
      method: "POST",
      body: toJson({ currentPassword, newPassword }),
    });
  },

  listCameras(): Promise<CameraStream[]> {
    return requestJson<CameraStream[]>("/api/cameras");
  },

  updateCamera(cameraId: string, update: CameraUpdate): Promise<Pick<CameraStream, "id" | "alias" | "enabled">> {
    return requestJson<Pick<CameraStream, "id" | "alias" | "enabled">>(`/api/cameras/${encodePathPart(cameraId)}`, {
      method: "PATCH",
      body: toJson(update),
    });
  },

  getTimeline(cameraId: string, date: string): Promise<TimelineSpan[]> {
    return requestJson<TimelineSpan[]>(`/api/cameras/${encodePathPart(cameraId)}/timeline?date=${encodeQuery(date)}`);
  },

  getRecordedDays(cameraId: string): Promise<RecordingDay[]> {
    return requestJson<RecordingDay[]>(`/api/cameras/${encodePathPart(cameraId)}/days`);
  },

  getPlaybackPlan(cameraId: string, start: string, end: string): Promise<PlaybackPlan> {
    return requestJson<PlaybackPlan>(
      `/api/cameras/${encodePathPart(cameraId)}/plan?start=${encodeQuery(start)}&end=${encodeQuery(end)}`,
    );
  },

  refreshIndex(): Promise<unknown> {
    return requestJson<unknown>("/api/index/refresh", {
      method: "POST",
      body: toJson({}),
    });
  },
};
