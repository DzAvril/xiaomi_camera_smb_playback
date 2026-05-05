import { createReadStream, statSync } from "node:fs";
import { dirname } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import {
  constantTimePasswordEquals,
  createSessionStore,
  hashPassword,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  verifyPasswordHash,
} from "./auth.js";
import type { AppConfig } from "./config.js";
import { openCatalog } from "./db.js";
import { registerRoutes } from "./routes.js";

type SessionBody = {
  password?: unknown;
};

type PasswordChangeBody = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

type CreateAppOptions = Pick<FastifyServerOptions, "logger"> & {
  webRoot?: string | false;
};

const PUBLIC_API_ROUTES = new Set(["GET /api/health", "POST /api/session"]);
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_ROOT = path.resolve(APP_DIR, "..", "..", "dist-web");
const PASSWORD_HASH_SETTING_KEY = "password_hash";
const PASSWORD_MIN_LENGTH = 8;

function unauthorized() {
  return { error: "Unauthorized" };
}

function notFound() {
  return { error: "Not found" };
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveWebRoot(webRoot: string | false | undefined): string | null {
  if (webRoot === false) {
    return null;
  }

  return webRoot ?? DEFAULT_WEB_ROOT;
}

function apiPath(url: string): boolean {
  return url.split("?")[0].startsWith("/api/");
}

function servesSpaMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function isInvalidJsonBodyError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const parserError = error as Error & { code?: string; statusCode?: number };
  return (
    parserError.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
    (parserError.statusCode === 400 && parserError.message.includes("JSON"))
  );
}

function isPasswordChangeBody(value: unknown): value is PasswordChangeBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registerStaticFrontend(app: FastifyInstance, webRootOption: string | false | undefined): string | null {
  const webRoot = resolveWebRoot(webRootOption);
  if (webRoot === null || !isDirectory(webRoot)) {
    return null;
  }

  app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
    wildcard: false,
  });

  return path.join(webRoot, "index.html");
}

export function createApp(config: AppConfig, options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const catalog = openCatalog(config.databasePath);
  const sessions = createSessionStore();

  app.decorate("catalog", catalog);
  app.register(cookie);

  app.setErrorHandler((requestError, _request, reply) => {
    if (isInvalidJsonBodyError(requestError)) {
      return reply.code(400).send({ error: "Invalid request body" });
    }

    return reply.send(requestError);
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestPath = request.url.split("?")[0];
    const routeKey = `${request.method} ${requestPath}`;
    if (
      !requestPath.startsWith("/api/") ||
      request.routeOptions.url === undefined ||
      PUBLIC_API_ROUTES.has(routeKey)
    ) {
      return;
    }

    if (!sessions.isValid(request.cookies[SESSION_COOKIE_NAME])) {
      await reply.code(401).send(unauthorized());
      return reply;
    }
  });

  app.addHook("onClose", () => {
    catalog.close();
  });

  app.get("/api/health", async () => ({ ok: true }));

  function isActivePassword(password: string): boolean {
    const storedPasswordHash = catalog.getSetting(PASSWORD_HASH_SETTING_KEY);
    if (storedPasswordHash) {
      return verifyPasswordHash(password, storedPasswordHash);
    }

    return constantTimePasswordEquals(password, config.password);
  }

  function issueSessionCookie(reply: FastifyReply) {
    const session = sessions.create();

    return reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
      sameSite: "strict",
    });
  }

  app.post("/api/session", async (request, reply) => {
    const body = request.body as SessionBody | undefined;
    const password = body?.password;

    if (typeof password !== "string" || !isActivePassword(password)) {
      return reply.code(401).send(unauthorized());
    }

    return issueSessionCookie(reply).code(204).send();
  });

  app.post("/api/settings/password", async (request, reply) => {
    if (!isPasswordChangeBody(request.body)) {
      return reply.code(400).send({ error: "Invalid password update" });
    }

    const { currentPassword, newPassword } = request.body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return reply.code(400).send({ error: "Invalid password update" });
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return reply.code(400).send({ error: "New password must be at least 8 characters" });
    }

    if (!isActivePassword(currentPassword)) {
      return reply.code(401).send(unauthorized());
    }

    catalog.setSetting(PASSWORD_HASH_SETTING_KEY, hashPassword(newPassword));
    sessions.clear();

    return issueSessionCookie(reply).code(204).send();
  });

  registerRoutes(app, config);

  const indexPath = registerStaticFrontend(app, options.webRoot);

  app.setNotFoundHandler((request, reply) => {
    if (apiPath(request.url)) {
      return reply.code(404).send(notFound());
    }

    if (indexPath !== null && servesSpaMethod(request.method) && isFile(indexPath)) {
      return reply.type("text/html; charset=utf-8").send(createReadStream(indexPath));
    }

    return reply.code(404).send(notFound());
  });

  return app;
}
