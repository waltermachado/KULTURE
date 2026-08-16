/** @param {import('fastify').FastifyInstance} app */
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
