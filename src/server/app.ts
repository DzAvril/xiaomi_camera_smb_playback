import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  constantTimePasswordEquals,
  createSessionStore,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "./auth";
import type { AppConfig } from "./config";
import { openCatalog } from "./db";
import { registerRoutes } from "./routes";

type SessionBody = {
  password?: unknown;
};

type CreateAppOptions = Pick<FastifyServerOptions, "logger">;

const PUBLIC_API_ROUTES = new Set(["GET /api/health", "POST /api/session"]);

function unauthorized() {
  return { error: "Unauthorized" };
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
    const routeKey = `${request.method} ${request.url.split("?")[0]}`;
    if (!request.url.startsWith("/api/") || PUBLIC_API_ROUTES.has(routeKey)) {
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

  return app;
}
