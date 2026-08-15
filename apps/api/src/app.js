import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createRequire } from "node:module";
import { DEFAULT_PRICING_RULES } from "@kulture/shared/pricing";

import { loadEnv } from "./config/env.js";
import { errorHandler } from "./lib/errors.js";
import { getPrisma } from "./lib/prisma.js";
import { createSwrCache } from "./lib/swr-cache.js";
import { createImageMirror } from "./modules/catalog/images.js";
import { createScraperClient } from "./modules/catalog/scraper-client.js";
import { createCatalogService } from "./modules/catalog/service.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { createPaymentGateway } from "./modules/payments/gateway.js";
import { createNotifier } from "./modules/notifications/notifier.js";
import { createOrderService } from "./modules/orders/service.js";
import { orderRoutes } from "./modules/orders/routes.js";
import { startAbandonedCheckoutJob } from "./modules/jobs/abandoned-checkout.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

/**
 * Monta a aplicação. Tudo injetável para testes:
 *   buildApp({ env, scraper, persistCache: false, warmTop8: false })
 */
export async function buildApp(overrides = {}) {
  const env = overrides.env ?? loadEnv();
  const isDev = env.NODE_ENV === "development";

  const app = Fastify({
    logger: overrides.logger ?? {
      level: env.LOG_LEVEL,
      ...(isDev ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {})
    },
    requestIdHeader: "x-request-id",
    ajv: { customOptions: { coerceTypes: true, removeAdditional: false } }
  });

  app.decorate("env", env);
  app.decorate("appVersion", pkg.version);
  app.setErrorHandler(errorHandler);

  // ---- infra ----
  const persist = overrides.persistCache ?? true;
  const prisma = persist ? getPrisma() : null;
  const cache = createSwrCache({
    freshMs: env.CACHE_FRESH_MIN * 60_000,
    staleMs: env.CACHE_STALE_MIN * 60_000,
    prisma,
    log: app.log
  });
  const sizesCache = createSwrCache({
    freshMs: env.SIZES_CACHE_MIN * 60_000,
    staleMs: env.SIZES_CACHE_MIN * 60_000 * 2,
    prisma: null, // TTL curto, não vale a pena persistir no banco (sizes expira rápido)
    log: app.log
  });
  const scraper = overrides.scraper ?? createScraperClient({ baseUrl: env.SCRAPER_URL });
  const images = overrides.images ?? createImageMirror({ publicBase: env.MEDIA_BASE, log: app.log });
  const rules = overrides.pricingRules ?? DEFAULT_PRICING_RULES; // Fase 1: tabela PricingRule
  const catalog = createCatalogService({ scraper, cache, sizesCache, images, rules, top8Terms: env.TOP8_TERMS, log: app.log });

  app.decorate("prisma", prisma);
  app.decorate("cache", cache);
  app.decorate("scraper", scraper);
  app.decorate("catalog", catalog);

  const gateway = overrides.gateway ?? createPaymentGateway(env, app.log);
  const notifier = overrides.notifier ?? createNotifier(env, app.log, prisma);
  const orders = overrides.orders ?? createOrderService(env, prisma, catalog, gateway, notifier, app.log);
  app.decorate("orders", orders);

  // ---- plugins ----
  if (env.CORS_ORIGINS.length) {
    await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  }

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip
  });

  await app.register(fastifyStatic, {
    root: images.storageDir,
    prefix: `${env.MEDIA_BASE.replace(/\/$/, "")}/`,
    decorateReply: false,
    maxAge: "30d",
    immutable: true
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "Kulture API", description: "kulture-core — catálogo, preço, auth, carrinho, pedidos", version: pkg.version },
      tags: [
        { name: "catalog", description: "Busca e produtos" },
        { name: "ops", description: "Saúde e operação" }
      ]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // ---- módulos ----
  await app.register(healthRoutes);
  await app.register(catalogRoutes);
  if (prisma) {
    await app.register(authRoutes);
    await app.register(orderRoutes);
  }

  // ---- ciclo de vida ----
  const warm = overrides.warmTop8 ?? env.TOP8_WARM;
  if (warm) {
    let timer = null;
    app.addHook("onReady", async () => {
      catalog.warmTop8(); // não bloqueia a subida
      timer = setInterval(() => catalog.warmTop8(), 60 * 60 * 1000);
      timer.unref();
    });
    app.addHook("onClose", async () => {
      if (timer) clearInterval(timer);
    });
  }

  if (prisma && (overrides.startJobs ?? true)) {
    const stopAbandonedJob = startAbandonedCheckoutJob(prisma, notifier, app.log);
    app.addHook("onClose", async () => {
      stopAbandonedJob();
    });
  }

  app.addHook("onClose", async () => {
    if (prisma) await prisma.$disconnect();
  });

  return app;
}
