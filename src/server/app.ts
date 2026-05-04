import { createReadStream, statSync } from "node:fs";
import { dirname } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  constantTimePasswordEquals,
  createSessionStore,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "./auth.js";
import type { AppConfig } from "./config.js";
import { openCatalog } from "./db.js";
import { registerRoutes } from "./routes.js";

type SessionBody = {
  password?: unknown;
};

type CreateAppOptions = Pick<FastifyServerOptions, "logger"> & {
  webRoot?: string | false;
};

const PUBLIC_API_ROUTES = new Set(["GET /api/health", "POST /api/session"]);
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_ROOT = path.resolve(APP_DIR, "..", "..", "dist-web");

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

  app.post("/api/session", async (request, reply) => {
    const body = request.body as SessionBody | undefined;
    const password = body?.password;

    if (typeof password !== "string" || !constantTimePasswordEquals(password, config.password)) {
      return reply.code(401).send(unauthorized());
    }

    const session = sessions.create();

    return reply
      .setCookie(SESSION_COOKIE_NAME, session.token, {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
        path: "/",
        sameSite: "strict",
      })
      .code(204)
      .send();
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
