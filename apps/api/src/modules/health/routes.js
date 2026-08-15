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
      cache: app.cache.stats()
    })
  );

  // checa dependências (scraper) sem derrubar o health principal
  app.get(
    "/health/deps",
    { schema: { tags: ["ops"], summary: "Status das dependências (nike-scraper)" } },
    async () => {
      const deps = {};
      try {
        deps.scraper = { ok: true, ...(await app.scraper.health()) };
      } catch (err) {
        deps.scraper = { ok: false, error: err.message };
      }
      return { ok: Object.values(deps).every((d) => d.ok), deps };
    }
  );
}
