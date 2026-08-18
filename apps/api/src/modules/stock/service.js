/**
 * Pronta entrega — estoque próprio (no Brasil), cadastrado no backoffice. Não consulta a Nike.
 *
 * Como se encaixa no resto:
 *  - cada produto tem um `code` PE-XXXXXX que faz o papel de `styleColor` no carrinho/pedido;
 *  - `catalog.getProductSizes(code)` intercepta o prefixo PE- e devolve `getProductByCode()` daqui — assim o
 *    seletor de tamanho, o checkout (validação de preço/tamanho) e o snapshot do pedido funcionam sem mudanças;
 *  - estoque por tamanho (tabela stock_sizes): a quantidade é RESERVADA na criação do pedido (decremento
 *    condicional dentro da transação → nunca vende o mesmo par duas vezes), volta quando o pedido é
 *    cancelado/abandonado (`releaseOrder`) e é reservada de novo se um pedido abandonado acabar pago
 *    (`ensureReservedForPaid` — se já não houver, gera evento `stock_oversold` para o dono conferir);
 *  - fotos enviadas pelo painel ficam no banco (stock_images) e são servidas em /media/estoque/:id — não
 *    dependem do volume ser gravável. Também aceita URLs externas.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { installmentsInfo } from "../catalog/normalize.js";

export const STOCK_CODE_RE = /^PE-[A-Z0-9]{4,12}$/i;
export const isStockCode = (v) => STOCK_CODE_RE.test(String(v ?? "").trim());
export const STOCK_MEDIA_BASE = "/media/estoque";

/** Categorias = as 3 abas da loja. Chave interna igual à do catálogo Nike (inferCategory), rótulo em PT para o site. */
export const STOCK_CATEGORIES = { basketball: "Basquete", lifestyle: "Casual", running: "Corrida" };
/** Modelagem do par: US da caixa é lido nessa escala. U = unissex (caixa em M; W = M + 1,5). K = infantil (GS: "5Y"). */
export const STOCK_GENDERS = { M: "Masculino", W: "Feminino", U: "Unissex", K: "Infantil (GS)" };

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB decodificados (o painel já redimensiona antes de enviar)
const MAX_IMAGES = 12;

// ---- helpers ----
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
function randomCode(len = 6) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `PE-${out}`;
}

export function slugify(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "produto";
}

const num = (v) => (v == null ? null : Number(v));
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const emptyToNull = (v) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
const optMoney = (max = 1_000_000) => z.preprocess(emptyToNull, z.coerce.number().nonnegative().max(max).nullable().optional());

const sizeSchema = z.object({
  br: z.coerce.string().trim().min(1).max(8),
  us: optText(8),
  qty: z.coerce.number().int().min(0).max(999).default(0)
});

export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subtitle: optText(120),
  category: z.preprocess(emptyToNull, z.enum(Object.keys(STOCK_CATEGORIES)).nullable().optional()),
  gender: z.preprocess(emptyToNull, z.enum(Object.keys(STOCK_GENDERS)).optional()),
  brand: z.preprocess(emptyToNull, z.string().trim().max(60).nullable().optional()),
  colorDescription: optText(160),
  styleColor: optText(40),
  description: optText(4000),
  priceBrl: z.coerce.number().positive().max(1_000_000),
  fullPriceBrl: optMoney(),
  costBrl: optMoney(),
  badge: optText(24),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(-9999).max(9999).optional(),
  images: z.array(z.string().trim().min(1).max(2000)).max(MAX_IMAGES).optional(),
  sizes: z.array(sizeSchema).max(60).optional()
});

function isInternalImage(url) {
  return typeof url === "string" && url.startsWith(`${STOCK_MEDIA_BASE}/`);
}
function imageIdOf(url) {
  return isInternalImage(url) ? url.slice(STOCK_MEDIA_BASE.length + 1).split(/[?#]/)[0] : null;
}
function validImageUrl(url) {
  return isInternalImage(url) || /^https?:\/\/\S+$/i.test(url) || url.startsWith("/");
}

/** Chave de tamanho usada no carrinho/pedido (`nikeSize`): US da caixa se houver, senão o BR. */
export const sizeKeyOf = (s) => String(s.us || s.br).trim();

export function createStockService({ prisma, log = null }) {
  if (!prisma) throw new Error("stock: prisma obrigatório");

  const withSizes = { sizes: { orderBy: [{ sortOrder: "asc" }, { br: "asc" }] } };

  /** US por gênero a partir da modelagem do produto e do US da caixa (mesmo formato dos tamanhos da Nike). */
  function usMapOf(gender, us) {
    const v = us ? String(us).trim() : null;
    if (gender === "W") return { W: v };
    if (gender === "K") return { K: v };
    if (gender === "U") {
      const n = Number(v);
      const w = Number.isFinite(n) ? String(Math.round((n + 1.5) * 2) / 2).replace(/\.0$/, "") : null;
      return { M: v, W: v ? w : null };
    }
    return { M: v };
  }
  const scaleOf = (gender) => (gender === "W" ? "W" : gender === "K" ? "K" : "M");
  const groupsOf = (gender) => (gender === "U" ? ["M", "W"] : [scaleOf(gender)]);

  // ---- formato público (mesmo contrato do toProduct do catálogo, + sizes) ----
  function toPublic(row) {
    const gender = row.gender || "M";
    const sizes = (row.sizes || []).map((s) => {
      const brNum = Number(String(s.br).replace(",", "."));
      return {
        nikeSize: sizeKeyOf(s),
        localizedSize: `BR ${s.br}`,
        brSize: Number.isFinite(brNum) ? brNum : null,
        brLabel: String(s.br),
        usSize: s.us || null,
        scale: scaleOf(gender),
        us: usMapOf(gender, s.us),
        available: s.qty > 0,
        level: s.qty <= 0 ? "OOS" : s.qty === 1 ? "LOW" : "HIGH",
        approximate: false,
        qty: s.qty,
        stockSizeId: s.id // interno: o catálogo remove antes de responder ao público
      };
    });
    const price = round2(row.priceBrl);
    const full = row.fullPriceBrl != null ? round2(row.fullPriceBrl) : null;
    const images = Array.isArray(row.images) ? row.images.filter((u) => typeof u === "string" && u) : [];
    return {
      id: row.code,
      styleColor: row.code,
      code: row.code,
      slug: row.slug,
      name: row.name,
      // subtítulo = rótulo da categoria (Basquete/Casual/Corrida) — texto livre só se tiver sido preenchido (legado)
      subtitle: row.subtitle || STOCK_CATEGORIES[row.category] || null,
      brand: row.brand || "Nike",
      category: row.category || null,
      categoryLabel: STOCK_CATEGORIES[row.category] || null,
      colorDescription: row.colorDescription || null,
      sku: row.styleColor || null,
      description: row.description || null,
      priceUsd: 0,
      fullPriceUsd: null,
      onSale: full != null && full > price,
      price: {
        brl: price,
        fullBrl: full != null && full > price ? full : null,
        breakdown: { source: "stock", subtotalBrl: row.costBrl != null ? round2(row.costBrl) : undefined },
        rulesApplied: { stock: true },
        exchange: null,
        pix: true,
        installments: installmentsInfo()
      },
      images,
      imageSource: images,
      launch: null,
      nikeUrl: null,
      badge: row.badge || null,
      source: "stock",
      readyToShip: true,
      gender,
      genderLabel: STOCK_GENDERS[gender] || null,
      sizeGroups: groupsOf(gender),
      stock: { total: sizes.reduce((a, s) => a + s.qty, 0), sizes: sizes.length },
      // internos (o catálogo/orders usam; nunca saem na API pública)
      stockProductId: row.id,
      cachedAt: row.updatedAt?.toISOString?.() ?? null,
      sizes
    };
  }

  function toAdmin(row) {
    return {
      id: row.id,
      code: row.code,
      slug: row.slug,
      name: row.name,
      subtitle: row.subtitle,
      category: row.category,
      categoryLabel: STOCK_CATEGORIES[row.category] || null,
      gender: row.gender || "M",
      genderLabel: STOCK_GENDERS[row.gender || "M"] || null,
      brand: row.brand,
      colorDescription: row.colorDescription,
      styleColor: row.styleColor,
      description: row.description,
      priceBrl: num(row.priceBrl),
      fullPriceBrl: num(row.fullPriceBrl),
      costBrl: num(row.costBrl),
      badge: row.badge,
      active: row.active,
      sortOrder: row.sortOrder,
      images: Array.isArray(row.images) ? row.images : [],
      sizes: (row.sizes || []).map((s) => ({ id: s.id, br: s.br, us: s.us, qty: s.qty, sortOrder: s.sortOrder })),
      totalQty: (row.sizes || []).reduce((a, s) => a + s.qty, 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  // ---- público ----
  async function listPublic() {
    const rows = await prisma.stockProduct.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: withSizes
    });
    return rows.map(toPublic);
  }

  /** Produto pelo code (PE-…), com todos os tamanhos (inclusive esgotados). null se não existir/inativo. */
  async function getProductByCode(code) {
    if (!isStockCode(code)) return null;
    const row = await prisma.stockProduct.findFirst({
      where: { code: String(code).trim().toUpperCase(), active: true },
      include: withSizes
    });
    return row ? toPublic(row) : null;
  }

  // ---- admin ----
  async function list({ q = "", includeInactive = true } = {}) {
    const where = {};
    if (!includeInactive) where.active = true;
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { styleColor: { contains: q, mode: "insensitive" } }, { colorDescription: { contains: q, mode: "insensitive" } }];
    const rows = await prisma.stockProduct.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], include: withSizes });
    return rows.map(toAdmin);
  }

  async function get(id) {
    const row = await prisma.stockProduct.findUnique({ where: { id }, include: withSizes });
    if (!row) throw AppError.notFound("Produto não encontrado");
    return toAdmin(row);
  }

  function parseInput(body, { partial = false } = {}) {
    const schema = partial ? productInputSchema.partial() : productInputSchema;
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      throw AppError.badRequest("Dados do produto inválidos", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const d = parsed.data;
    if (d.images) {
      const bad = d.images.find((u) => !validImageUrl(u));
      if (bad) throw AppError.badRequest(`Imagem inválida: ${bad.slice(0, 80)}`);
    }
    if (d.sizes) {
      // dedupe por BR (o último ganha), normaliza vírgula decimal
      const map = new Map();
      d.sizes.forEach((s, i) => {
        const br = String(s.br).replace(",", ".").trim();
        map.set(br, { br, us: s.us ? String(s.us).replace(",", ".").trim() : null, qty: s.qty ?? 0, sortOrder: i });
      });
      d.sizes = [...map.values()];
    }
    if (d.fullPriceBrl != null && d.priceBrl != null && d.fullPriceBrl <= d.priceBrl) d.fullPriceBrl = null;
    return d;
  }

  async function uniqueSlug(base, excludeId = null) {
    let slug = slugify(base);
    for (let i = 2; i < 200; i++) {
      const hit = await prisma.stockProduct.findUnique({ where: { slug }, select: { id: true } });
      if (!hit || hit.id === excludeId) return slug;
      slug = `${slugify(base)}-${i}`;
    }
    return `${slugify(base)}-${Date.now().toString(36)}`;
  }

  async function uniqueCode() {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      const hit = await prisma.stockProduct.findUnique({ where: { code }, select: { id: true } });
      if (!hit) return code;
    }
    throw new Error("stock: não foi possível gerar um código único");
  }

  async function create(body) {
    const d = parseInput(body);
    const code = await uniqueCode();
    const slug = await uniqueSlug(d.name);
    const { sizes = [], images = [], ...fields } = d;
    const row = await prisma.stockProduct.create({
      data: {
        ...fields,
        brand: fields.brand || "Nike",
        code,
        slug,
        images,
        sizes: { create: sizes.map((s) => ({ br: s.br, us: s.us, qty: s.qty, sortOrder: s.sortOrder })) }
      },
      include: withSizes
    });
    log?.info({ id: row.id, code: row.code, name: row.name }, "stock: produto criado");
    return toAdmin(row);
  }

  async function update(id, body) {
    const current = await prisma.stockProduct.findUnique({ where: { id }, include: withSizes });
    if (!current) throw AppError.notFound("Produto não encontrado");
    const d = parseInput(body, { partial: true });
    const { sizes, images, ...fields } = d;
    if (fields.brand === null) fields.brand = "Nike";
    const data = { ...fields };
    if (fields.name && fields.name !== current.name) data.slug = await uniqueSlug(fields.name, id);

    // fotos: array novo substitui; blobs internos que saíram do array são apagados
    let removedBlobIds = [];
    if (images) {
      data.images = images;
      const keep = new Set(images.map(imageIdOf).filter(Boolean));
      removedBlobIds = (current.images || []).map(imageIdOf).filter((x) => x && !keep.has(x));
    }

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.stockProduct.update({ where: { id }, data });
      if (sizes) {
        // diff por BR: mantém a linha (e o id — reservas em pedidos apontam para ele), remove as que saíram
        const nextBr = new Set(sizes.map((s) => s.br));
        await tx.stockSize.deleteMany({ where: { productId: id, br: { notIn: [...nextBr] } } });
        for (const s of sizes) {
          await tx.stockSize.upsert({
            where: { productId_br: { productId: id, br: s.br } },
            create: { productId: id, br: s.br, us: s.us, qty: s.qty, sortOrder: s.sortOrder },
            update: { us: s.us, qty: s.qty, sortOrder: s.sortOrder }
          });
        }
      }
      if (removedBlobIds.length) await tx.stockImage.deleteMany({ where: { id: { in: removedBlobIds }, productId: id } });
      return tx.stockProduct.findUnique({ where: { id: updated.id }, include: withSizes });
    });
    log?.info({ id, changes: Object.keys(d) }, "stock: produto atualizado");
    return toAdmin(row);
  }

  async function remove(id) {
    const row = await prisma.stockProduct.findUnique({ where: { id }, select: { id: true, code: true } });
    if (!row) throw AppError.notFound("Produto não encontrado");
    await prisma.stockProduct.delete({ where: { id } }); // cascade: sizes + images
    log?.info({ id, code: row.code }, "stock: produto removido");
    return { ok: true };
  }

  /** Recebe { dataUrl } ou { data (base64), mime }; grava no banco e anexa ao fim das fotos do produto. */
  async function addImage(id, { dataUrl, data, mime } = {}) {
    const product = await prisma.stockProduct.findUnique({ where: { id }, select: { id: true, images: true } });
    if (!product) throw AppError.notFound("Produto não encontrado");
    let b64 = data;
    let type = mime;
    if (dataUrl) {
      const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/is.exec(String(dataUrl));
      if (!m) throw AppError.badRequest("Imagem inválida (esperado data URL base64)");
      type = m[1].toLowerCase();
      b64 = m[2];
    }
    if (!IMAGE_MIMES.has(String(type || "").toLowerCase())) throw AppError.badRequest("Formato de imagem não suportado (use JPEG, PNG ou WebP)");
    let buf;
    try {
      buf = Buffer.from(String(b64 || "").replace(/\s+/g, ""), "base64");
    } catch {
      throw AppError.badRequest("Imagem inválida");
    }
    if (!buf.length) throw AppError.badRequest("Imagem vazia");
    if (buf.length > MAX_IMAGE_BYTES) throw AppError.badRequest(`Imagem muito grande (${(buf.length / 1024 / 1024).toFixed(1)} MB; máx. 4 MB)`);
    const images = Array.isArray(product.images) ? product.images : [];
    if (images.length >= MAX_IMAGES) throw AppError.badRequest(`Máximo de ${MAX_IMAGES} fotos por produto`);

    const blob = await prisma.stockImage.create({
      data: { productId: id, mime: String(type).toLowerCase(), bytes: buf.length, data: buf },
      select: { id: true }
    });
    const url = `${STOCK_MEDIA_BASE}/${blob.id}`;
    const next = [...images, url];
    await prisma.stockProduct.update({ where: { id }, data: { images: next } });
    return { id: blob.id, url, images: next };
  }

  async function getImage(imageId) {
    const row = await prisma.stockImage.findUnique({ where: { id: imageId }, select: { mime: true, data: true, bytes: true } });
    return row;
  }

  // ---- reserva de estoque (pedidos) ----
  /** Decremento condicional (qty >= n) — dentro da transação do pedido. Lança se algum tamanho esgotou. */
  async function reserve(tx, reservations) {
    for (const r of reservations) {
      const res = await tx.stockSize.updateMany({ where: { id: r.stockSizeId, qty: { gte: r.qty } }, data: { qty: { decrement: r.qty } } });
      if (res.count !== 1) {
        throw AppError.conflict(`${r.label} esgotou enquanto você finalizava a compra — escolha outro tamanho`, { code: "STOCK_OUT", stockSizeId: r.stockSizeId });
      }
    }
  }

  const stockItemsOf = (order) =>
    (order.items || [])
      .map((i) => ({ item: i, b: i.breakdown && typeof i.breakdown === "object" ? i.breakdown : {} }))
      .filter(({ b }) => b.source === "stock" && b.stockSizeId)
      .map(({ item, b }) => ({ stockSizeId: b.stockSizeId, qty: Number(item.quantity) || 1, label: `${item.name} (BR ${item.brLabel || item.nikeSize})` }));

  /** Pedido cancelado/abandonado: devolve as unidades reservadas (uma vez só — stockReleasedAt marca). */
  async function releaseOrder(order, reason = "cancelled") {
    if (!order || order.stockReleasedAt) return { released: 0 };
    const items = stockItemsOf(order);
    if (!items.length) return { released: 0 };
    await prisma.$transaction(async (tx) => {
      for (const r of items) {
        // tamanho pode ter sido removido no painel nesse meio-tempo → ignora silenciosamente
        await tx.stockSize.updateMany({ where: { id: r.stockSizeId }, data: { qty: { increment: r.qty } } });
      }
      await tx.order.update({ where: { id: order.id }, data: { stockReleasedAt: new Date(), events: { create: { type: "stock_released", payload: { reason, items } } } } });
    });
    log?.info({ order: order.number, reason, count: items.length }, "stock: reserva devolvida ao estoque");
    return { released: items.length };
  }

  /** Pedido que já tinha devolvido o estoque (abandonado) e acabou pago: reserva de novo; se não houver, avisa. */
  async function ensureReservedForPaid(order) {
    if (!order || !order.stockReleasedAt) return { reserved: 0, oversold: [] };
    const items = stockItemsOf(order);
    if (!items.length) return { reserved: 0, oversold: [] };
    const oversold = [];
    await prisma.$transaction(async (tx) => {
      for (const r of items) {
        const res = await tx.stockSize.updateMany({ where: { id: r.stockSizeId, qty: { gte: r.qty } }, data: { qty: { decrement: r.qty } } });
        if (res.count !== 1) oversold.push(r);
      }
      const note = oversold.length
        ? `⚠️ ESTOQUE: pedido pago depois de abandonado e o(s) tamanho(s) já não estava(m) disponível(is): ${oversold.map((o) => o.label).join(", ")}. Conferir antes de enviar.`
        : null;
      await tx.order.update({
        where: { id: order.id },
        data: {
          stockReleasedAt: null,
          ...(note ? { internalNotes: [order.internalNotes, note].filter(Boolean).join("\n") } : {}),
          events: { create: { type: oversold.length ? "stock_oversold" : "stock_reserved_again", payload: { items, oversold } } }
        }
      });
    });
    if (oversold.length) log?.warn({ order: order.number, oversold }, "stock: pedido pago sem estoque disponível (oversold)");
    return { reserved: items.length - oversold.length, oversold };
  }

  return {
    isStockCode,
    listPublic,
    getProductByCode,
    list,
    get,
    create,
    update,
    remove,
    addImage,
    getImage,
    reserve,
    releaseOrder,
    ensureReservedForPaid,
    stockItemsOf,
    MAX_IMAGES,
    MAX_IMAGE_BYTES
  };
}

/** Remove o que é interno antes de responder ao público (custo no breakdown, ids de estoque). */
export function stripStockInternal(product) {
  if (!product) return product;
  const { stockProductId, ...rest } = product;
  const out = { ...rest };
  if (out.price) {
    const { breakdown, rulesApplied, ...publicPrice } = out.price;
    out.price = publicPrice;
  }
  if (Array.isArray(out.sizes)) out.sizes = out.sizes.map(({ stockSizeId, ...s }) => s);
  return out;
}
