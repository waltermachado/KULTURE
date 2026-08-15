import { z } from "zod";

// Valida o ambiente na subida: erro claro em vez de comportamento estranho depois.
const csv = (value) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  // ---- auth ----
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),

  SCRAPER_URL: z.string().url().default("http://localhost:3001"),
  CORS_ORIGINS: z.string().default("").transform(csv),

  MEDIA_BASE: z.string().default("/media/produtos"),
  CACHE_FRESH_MIN: z.coerce.number().positive().default(60),
  CACHE_STALE_MIN: z.coerce.number().positive().default(1440),
  TOP8_TERMS: z
    .string()
    .default("Kobe 10 Protro,Kobe IX Elite Low EM Protro,Kobe III Protro,Sabrina 3,LeBron XXIII,Book 2,Air Jordan 1 Low OG,G.T. Cut 3")
    .transform(csv),
  TOP8_WARM: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no"].includes(v.toLowerCase()))
});

export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}
