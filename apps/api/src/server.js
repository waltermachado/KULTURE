import { buildApp } from "./app.js";
import { serveWeb } from "./plugins/serve-web.js";

const app = await buildApp();

// Em produção (Docker/Railway) o front buildado é servido pela própria api (mesma origem).
// Em dev não faz nada — o Vite serve o front e faz proxy de /api e /media.
await serveWeb(app);

const close = async (signal) => {
  app.log.info({ signal }, "encerrando");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => close("SIGINT"));
process.on("SIGTERM", () => close("SIGTERM"));

try {
  await app.listen({ port: app.env.PORT, host: app.env.HOST });
  app.log.info(`docs em http://${app.env.HOST}:${app.env.PORT}/docs · scraper em ${app.env.SCRAPER_URL}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
