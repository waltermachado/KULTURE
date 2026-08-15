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
  // true atrás de proxy reverso (Railway, Cloudflare): usa X-Forwarded-For como IP do cliente
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase())),
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
  SIZES_CACHE_MIN: z.coerce.number().positive().default(10),
  TOP8_TERMS: z
    .string()
    .default("Kobe 10 Protro,Kobe IX Elite Low EM Protro,Kobe III Protro,Sabrina 3,LeBron XXIII,Book 2,Air Jordan 1 Low OG,G.T. Cut 3")
    .transform(csv),
  TOP8_WARM: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no"].includes(v.toLowerCase())),

  // ---- checkout / payments ----
  PAYMENT_PROVIDER: z.enum(["mock", "infinitepay"]).default("mock"),
  INFINITEPAY_HANDLE: z.string().default("kulture-br"),
  INFINITEPAY_API_BASE: z.string().url().default("https://api.checkout.infinitepay.io"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),

  // ---- notifications ----
  // ---- e-mail transacional (MailerSend via API HTTP) ----
  MAIL_PROVIDER: z.enum(["log", "mailersend"]).default("log"),
  MAILERSEND_API_TOKEN: z.string().default(""),
  MAILERSEND_API_BASE: z.string().url().default("https://api.mailersend.com/v1"),
  MAIL_FROM: z.string().default("no-reply@localhost"),
  MAIL_FROM_NAME: z.string().default("Kulture"),

  WHATSAPP_PROVIDER: z.enum(["log", "evolution"]).default("log"),
  WHATSAPP_TO: z.string().default(""), // Opcional no mock
  EVOLUTION_URL: z.string().url().default("http://localhost:8080"),
  EVOLUTION_INSTANCE: z.string().default("instance"),
  EVOLUTION_APIKEY: z.string().default(""),
});

export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}
