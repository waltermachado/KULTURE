import { z } from "zod";

// Valida o ambiente na subida: erro claro em vez de comportamento estranho depois.
const csv = (value) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const cleanUrl = (v) =>
  String(v ?? "")
    .trim()
    .replace(/^[A-Z_]+=/, "") // "SCRAPER_URL=http://…" colado inteiro no campo de valor
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .replace(/\/+$/, "");
const isUrl = (s) => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};
const publicUrl = (fallback) =>
  z.preprocess((v) => {
    let cleaned = cleanUrl(v);
    if (/[<>]/.test(cleaned)) cleaned = ""; // placeholder tipo https://<<dominio>> não é valor
    if (cleaned) return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const railway = cleanUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
    return railway ? `https://${railway}` : fallback;
  }, z.string().url());

/**
 * URL de serviço interno (scraper): tolera aspas/espaços/prefixo "VAR=" e esquema ausente.
 * Se mesmo assim não for uma URL, cai no fallback em vez de DERRUBAR a api na subida —
 * um scraper mal configurado degrada o catálogo, nunca a loja inteira. O /health/deps mostra o alvo.
 */
const internalUrl = (fallback) =>
  z.preprocess((v) => {
    let cleaned = cleanUrl(v);
    if (!cleaned || /[<>\s]/.test(cleaned)) return fallback;
    if (!/^https?:\/\//i.test(cleaned)) cleaned = `http://${cleaned}`;
    return isUrl(cleaned) ? cleaned : fallback;
  }, z.string().url());

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
  // e-mails que viram admin automaticamente ao logar/cadastrar (bootstrap do backoffice sem SQL)
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) => csv(v).map((e) => e.toLowerCase())),
  PASSWORD_RESET_TTL_MIN: z.coerce.number().int().positive().default(60),

  SCRAPER_URL: internalUrl("http://localhost:3001"),
  CORS_ORIGINS: z.string().default("").transform(csv),

  MEDIA_BASE: z.string().default("/media/produtos"),
  // pasta onde as imagens espelhadas são gravadas (padrão apps/api/storage/produtos; no Railway = mount do volume)
  STORAGE_DIR: z.string().default(""),
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
  // texto "em até Nx no cartão" mostrado ao lado do preço Pix (o juro/parcelas reais são configurados na conta InfinitePay)
  MAX_INSTALLMENTS: z.coerce.number().int().positive().default(12),
  // dólar turismo: vem do scraper (AwesomeAPI USD-BRLT); se faltar, comercial + este spread (R$ por dólar)
  RATE_TOURISM_SPREAD_BRL: z.coerce.number().nonnegative().default(0.25),
  // produto virtual "test123test" (R$ 1,00) para testar o pagamento real; desligue após validar
  TEST_PRODUCT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no"].includes(v.toLowerCase())),

  // ---- checkout / payments ----
  PAYMENT_PROVIDER: z.enum(["mock", "infinitepay"]).default("mock"),
  INFINITEPAY_HANDLE: z.string().default("kulture-br"),
  INFINITEPAY_API_BASE: z.string().url().default("https://api.checkout.infinitepay.io"),
  // URLs públicas: tolera aspas/espaços/barra final; se vazias, usa o domínio que o Railway injeta
  // (RAILWAY_PUBLIC_DOMAIN) e, por último, localhost.
  PUBLIC_WEB_URL: publicUrl("http://localhost:5173"),
  PUBLIC_API_URL: publicUrl("http://localhost:3000"),
  // hosts extras aceitos como URL de retorno do pagamento (além dos dois acima e do domínio do Railway)
  PUBLIC_WEB_HOSTS: z.string().default("lojakulture.com.br,www.lojakulture.com.br").transform(csv),

  // ---- notifications ----
  // ---- e-mail transacional (MailerSend via API HTTP) ----
  // log = só registra · mailersend = API HTTP (token) · smtp = SMTP da MailerSend (ou outro), via nodemailer
  MAIL_PROVIDER: z.enum(["log", "mailersend", "smtp"]).default("log"),
  MAILERSEND_API_TOKEN: z.string().default(""),
  MAILERSEND_API_BASE: z.string().url().default("https://api.mailersend.com/v1"),
  SMTP_HOST: z.string().default("smtp.mailersend.net"),
  SMTP_PORT: z.coerce.number().int().positive().default(587), // 587 = STARTTLS · 465 = TLS direto (SMTP_SECURE=true)
  SMTP_SECURE: z.preprocess((v) => (v === undefined || v === "" ? undefined : String(v).toLowerCase() === "true"), z.boolean().default(false)),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z.string().default("no-reply@localhost"), // precisa ser do domínio verificado na MailerSend (em trial: @test-….mlsender.net)
  MAIL_FROM_NAME: z.string().default("Kulture"),
  MAIL_REPLY_TO: z.string().default(""), // opcional: e-mail de resposta (ex. atendimento)
  // Bling (emissão automática de NF-e) — vazio = nota manual no painel. OAuth: o app no Bling precisa ter o
  // "link de redirecionamento" IGUAL a `${PUBLIC_WEB_URL}/api/bling/callback`.
  BLING_CLIENT_ID: z.string().default(""),
  BLING_CLIENT_SECRET: z.string().default(""),
  BLING_AUTH_BASE: z.string().url().default("https://www.bling.com.br/Api/v3"),
  BLING_API_BASE: z.string().url().default("https://api.bling.com.br/Api/v3"),

  WHATSAPP_PROVIDER: z.enum(["log", "evolution"]).default("log"),
  WHATSAPP_TO: z.string().default(""), // Opcional no mock
  // WhatsApp de ATENDIMENTO mostrado no site ("não achou o tênis? chama a gente"): DDI+DDD+número, só dígitos.
  // Vazio = o botão não aparece. Independe do WHATSAPP_PROVIDER (que é o envio de notificações).
  WHATSAPP_CONTACT_PHONE: z
    .string()
    .default("")
    .transform((v) => String(v).replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 15), { message: "WHATSAPP_CONTACT_PHONE: use DDI+DDD+número, só dígitos (ex.: 5511999998888)" }),
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
