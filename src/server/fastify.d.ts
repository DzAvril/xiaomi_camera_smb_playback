import type { Catalog } from "./db.js";

declare module "fastify" {
  interface FastifyInstance {
    catalog: Catalog;
  }
}

export {};
