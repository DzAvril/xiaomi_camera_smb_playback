import type { Catalog } from "./db";

declare module "fastify" {
  interface FastifyInstance {
    catalog: Catalog;
  }
}

export {};
