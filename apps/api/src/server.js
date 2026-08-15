import { buildApp } from "./app.js";

const app = await buildApp();

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
