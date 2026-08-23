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
import { createPricingService } from "./modules/pricing/service.js";
import { pricingRoutes } from "./modules/pricing/routes.js";
import { createCouponService } from "./modules/coupons/service.js";
import { couponRoutes } from "./modules/coupons/routes.js";
import { createBlingService } from "./modules/bling/service.js";
import { blingRoutes } from "./modules/bling/routes.js";

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
import { createAuthService } from "./modules/auth/service.js";
import { createResetMailer } from "./modules/auth/reset-mail.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { createPaymentGateway } from "./modules/payments/gateway.js";
import { createNotifier } from "./modules/notifications/notifier.js";
import { createMailer } from "./modules/mail/mailer.js";
import { createOrderService } from "./modules/orders/service.js";
import { orderRoutes } from "./modules/orders/routes.js";
import { featuredRoutes } from "./modules/featured/routes.js";
import { marketingRoutes } from "./modules/marketing/routes.js";
import { canonicalWebUrl, publicWebUrlMisconfigured } from "./lib/site-url.js";
import { createMarketingService } from "./modules/marketing/service.js";
import { invoiceRoutes } from "./modules/invoices/routes.js";
import { createInvoiceService } from "./modules/invoices/service.js";
import { startAbandonedCheckoutJob } from "./modules/jobs/abandoned-checkout.js";
import { createStockService } from "./modules/stock/service.js";
import { stockRoutes } from "./modules/stock/routes.js";
import { stockAdminRoutes } from "./modules/stock/admin-routes.js";
import { configRoutes } from "./modules/config/routes.js";

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
    // atrás do proxy do Railway/Cloudflare, req.ip vem do X-Forwarded-For (rate limit por cliente real)
    trustProxy: env.TRUST_PROXY,
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
  const images =
    overrides.images ??
    createImageMirror({ publicBase: env.MEDIA_BASE, ...(env.STORAGE_DIR ? { storageDir: env.STORAGE_DIR } : {}), log: app.log });
  // preço: regra global do shared + acréscimos por tipo de tênis editáveis em /admin/precos (settings); sem Postgres → lista fixa
  const pricing = prisma ? createPricingService({ prisma, log: app.log }) : null;
  const rules = overrides.pricingRules ?? pricing ?? DEFAULT_PRICING_RULES;
  // pronta entrega (estoque próprio no banco) — só existe com Postgres
  const stock = prisma ? createStockService({ prisma, log: app.log }) : null;
  const catalog = createCatalogService({ scraper, cache, sizesCache, images, rules, top8Terms: env.TOP8_TERMS, testProduct: env.TEST_PRODUCT_ENABLED, stock, log: app.log });

  app.decorate("prisma", prisma);
  app.decorate("cache", cache);
  app.decorate("scraper", scraper);
  app.decorate("images", images);
  app.decorate("catalog", catalog);
  app.decorate("pricing", pricing);
  app.decorate("stock", stock);

  const gateway = overrides.gateway ?? createPaymentGateway(env, app.log);
  const notifier = overrides.notifier ?? createNotifier(env, app.log, prisma);
  const mailer = overrides.mailer ?? createMailer(env, app.log);
  const coupons = prisma ? createCouponService({ prisma, log: app.log }) : null;
  app.decorate("coupons", coupons);
  const orders = overrides.orders ?? createOrderService(env, prisma, catalog, gateway, notifier, app.log, mailer, stock, coupons);
  app.decorate("mailer", mailer);
  // marketing por e-mail (campanhas do backoffice + descadastro) — só com Postgres
  app.decorate("marketing", prisma ? createMarketingService({ prisma, env, mailer, log: app.log }) : null);
  // nota fiscal do pedido (manual hoje; gancho para o Bling)
  app.decorate("invoices", prisma ? createInvoiceService({ prisma, env, mailer, log: app.log }) : null);
  // conexão OAuth com o Bling (emissão de NF-e usa isto)
  app.decorate("bling", prisma ? createBlingService({ prisma, env, log: app.log }) : null);
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

  // auth service no contexto raiz: auth routes e módulo admin compartilham a mesma instância
  if (prisma) {
    const auth = createAuthService({
      prisma,
      jwtSign: (payload, opts) => app.jwt.sign(payload, opts),
      jwtExpiresIn: env.JWT_EXPIRES_IN,
      refreshExpiresDays: env.REFRESH_EXPIRES_DAYS,
      adminEmails: env.ADMIN_EMAILS,
      resetTtlMin: env.PASSWORD_RESET_TTL_MIN,
      log: app.log
    });
    app.decorate("auth", auth);
    app.decorate("sendPasswordResetEmail", createResetMailer({ env, mailer, log: app.log }));
  }

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
        { name: "auth", description: "Conta do cliente" },
        { name: "admin", description: "Backoffice (role=admin)" },
        { name: "ops", description: "Saúde e operação" }
      ]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // ---- módulos ----
  await app.register(healthRoutes);
  await app.register(configRoutes);
  await app.register(catalogRoutes);
  if (prisma) {
    await app.register(authRoutes);
    await app.register(orderRoutes);
    await app.register(adminRoutes);
    await app.register(stockRoutes);
    await app.register(stockAdminRoutes);
    await app.register(featuredRoutes);
    await app.register(marketingRoutes);
    await app.register(invoiceRoutes);
    await app.register(pricingRoutes);
    await app.register(couponRoutes);
    await app.register(blingRoutes);
  }

  if (publicWebUrlMisconfigured(env)) {
    app.log.warn({ PUBLIC_WEB_URL: env.PUBLIC_WEB_URL, usando: canonicalWebUrl(env) }, "PUBLIC_WEB_URL aponta para o domínio do Railway/localhost — links de e-mail e redirects usam o domínio próprio; corrija a variável");
  }

  // ---- ciclo de vida ----
  // avisa já na subida se o storage de imagens não for gravável (volume do Railway como root, etc.)
  if (typeof images.checkWritable === "function") {
    app.addHook("onReady", async () => {
      images.checkWritable().catch(() => {});
    });
  }

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
    const stopAbandonedJob = startAbandonedCheckoutJob(prisma, notifier, app.log, stock);
    app.addHook("onClose", async () => {
      stopAbandonedJob();
    });
  }

  app.addHook("onClose", async () => {
    mailer.close?.(); // fecha o pool SMTP
    if (prisma) await prisma.$disconnect();
  });

  return app;
}
