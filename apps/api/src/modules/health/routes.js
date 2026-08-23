/** @param {import('fastify').FastifyInstance} app */
import { canonicalWebUrl, publicWebUrlMisconfigured } from "../../lib/site-url.js";
export async function healthRoutes(app) {
  app.get(
    "/health",
    { schema: { tags: ["ops"], summary: "Status da api e do cache" } },
    async () => ({
      ok: true,
      service: "kulture-api",
      version: app.appVersion,
      uptimeSec: Math.round(process.uptime()),
      cache: app.cache.stats(),
      // qual gateway está ativo (mock | infinitepay) e qual e-mail (log | mailersend) — para conferir a config em prod
      paymentProvider: app.env.PAYMENT_PROVIDER,
      mailProvider: app.env.MAIL_PROVIDER,
      // URL que vai nos links de e-mail/redirect; `publicWebUrlMisconfigured` = PUBLIC_WEB_URL aponta para *.railway.app
      siteUrl: canonicalWebUrl(app.env),
      publicWebUrlMisconfigured: publicWebUrlMisconfigured(app.env),
      // false = imagens sendo servidas da origem (Nike) porque o storage não é gravável
      storageWritable: typeof app.images?.checkWritable === "function" ? await app.images.checkWritable() : null
    })
  );

  // checa dependências (scraper) sem derrubar o health principal
  app.get(
    "/health/deps",
    { schema: { tags: ["ops"], summary: "Status das dependências (nike-scraper)" } },
    async () => {
      const deps = {};
      // url é interna (railway.internal / localhost) — não é segredo e evita adivinhar a config em prod
      const url = app.scraper.baseUrl ?? null;
      try {
        deps.scraper = { ok: true, url, ...(await app.scraper.health()) };
      } catch (err) {
        deps.scraper = { ok: false, url, error: err.message, cause: err.details?.cause ?? null };
      }
      return { ok: Object.values(deps).every((d) => d.ok), deps };
    }
  );
}
