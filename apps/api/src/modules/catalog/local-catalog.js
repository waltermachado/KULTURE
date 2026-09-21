import { randomUUID } from 'node:crypto';
import { convertUsToBr } from '@kulture/shared/sizes';
import { inferCategory } from './normalize.js';
import { normalizeQuery } from '../../lib/normalize-query.js';

export const SYNC_KEY = 'imported-catalog-sync';
export const TOP8_KEY = 'imported-top8';
const LOCK_KEY = 'imported-catalog-lock';
const HOUR = 60 * 60 * 1000;
const LEASE = 5 * 60 * 1000;
export function inCatalogWindow(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(date)) >= 6;
}
export function availableSizes(raw) {
  return [...new Set((raw.sizes || []).filter(s => s.available).map(s => {
    const { brSize } = convertUsToBr(s.nikeSize, s.localizedSize, raw.genders || []);
    return brSize == null ? null : String(brSize);
  }).filter(Boolean))];
}

/** Durable catalog. Reads never expire or trigger a Nike request. */
export function createLocalCatalog({ prisma, scraper, restricted, log, now = () => new Date() }) {
  let running = null;
  let stopped = false;
  const status = async () => (await prisma.setting.findUnique({ where: { key: SYNC_KEY } }))?.value || {};
  const setStatus = value => prisma.setting.upsert({ where: { key: SYNC_KEY }, create: { key: SYNC_KEY, value }, update: { value } });

  async function upsert(raw, checkedAt = now()) {
    return prisma.importedProduct.upsert({ where: { styleColor: raw.styleColor },
      create: { styleColor: raw.styleColor, raw, checkedAt, active: true }, update: { raw, checkedAt, active: true } });
  }
  async function get(styleColor) {
    const row = await prisma.importedProduct.findUnique({ where: { styleColor } });
    return row?.active ? row.raw : null;
  }
  async function list({ q = '', size = '' } = {}) {
    let products = (await prisma.importedProduct.findMany({ where: { active: true }, orderBy: { styleColor: 'asc' } })).map(r => r.raw);
    if (restricted) products = await restricted.filter(products);
    const category = { 'basketball shoes': 'basketball', 'running shoes': 'running', 'lifestyle shoes': 'lifestyle' }[q.toLowerCase()];
    const tokens = normalizeQuery(q).split(/-+/).filter(Boolean);
    products = products.filter(p => category ? inferCategory(p.subtitle) === category : tokens.every(t => normalizeQuery(`${p.name} ${p.subtitle || ''} ${p.styleColor} ${p.colorDescription || ''}`).includes(t)));
    const counts = new Map();
    for (const p of products) for (const br of availableSizes(p)) counts.set(br, (counts.get(br) || 0) + 1);
    const sizes = [...counts].sort((a, b) => Number(a[0]) - Number(b[0])).map(([br, count]) => ({ br, count }));
    return { products: size ? products.filter(p => availableSizes(p).includes(size)) : products, sizes };
  }

  async function scan() {
    if (stopped || !inCatalogWindow(now())) return;
    const previous = await status();
    if (previous.state !== 'running' && previous.lastAttemptAt && now() - new Date(previous.lastAttemptAt) < HOUR) return;
    const owner = randomUUID();
    // Database lease prevents duplicate crawls across replicas. Renewed once per page.
    try { await prisma.setting.create({ data: { key: LOCK_KEY, value: owner, updatedAt: new Date(0) } }); }
    catch (err) { if (err.code !== 'P2002') throw err; }
    const lock = await prisma.setting.updateMany({ where: { key: LOCK_KEY, updatedAt: { lt: new Date(now().getTime() - LEASE) } }, data: { value: owner, updatedAt: now() } });
    if (!lock.count) return;
    const started = now();
    const attempt = { ...previous, lastAttemptAt: started.toISOString(), state: 'running', error: null };
    const seen = new Set();
    try {
      await setStatus(attempt);
      let anchor = 0;
      for (let pages = 0; ; pages++) {
        if (stopped || !inCatalogWindow(now())) { await setStatus({ ...attempt, state: 'paused' }); return; }
        if (pages >= 10000) throw new Error('Paginação Nike excedeu o limite de segurança');
        const page = await scraper.catalogPage(anchor);
        if (!Array.isArray(page.products) || !Number.isFinite(page.total) || !Number.isInteger(page.received) || page.received < 0 || !('nextAnchor' in page)) throw new Error('Resposta incompleta do catálogo Nike');
        if (!page.received && (page.total > anchor || !seen.size)) throw new Error('Catálogo Nike vazio ou incompleto');
        if (page.nextAnchor !== null && (!Number.isInteger(page.nextAnchor) || page.nextAnchor <= anchor)) throw new Error('Paginação Nike não avançou');
        const expectedNext = anchor + page.received < page.total ? anchor + page.received : null;
        if (page.nextAnchor !== expectedNext) throw new Error('Paginação Nike incompleta');
        const lease = await prisma.setting.updateMany({ where: { key: LOCK_KEY, value: { equals: owner } }, data: { updatedAt: now() } });
        if (!lease.count) throw new Error('Outra instância assumiu a atualização');
        if (stopped || !inCatalogWindow(now())) { await setStatus({ ...attempt, state: 'paused' }); return; }
        const valid = new Map();
        for (const raw of page.products) {
          if (!raw.styleColor || !raw.name || !Number.isFinite(raw.priceUsd) || !Array.isArray(raw.sizes)) throw new Error('Produto incompleto no catálogo Nike');
          seen.add(raw.styleColor); valid.set(raw.styleColor, raw);
        }
        // Never overwrite a product refreshed by a customer's click after this scan started.
        if (valid.size) await prisma.$transaction([
          prisma.importedProduct.createMany({ data: [...valid.values()].map(raw => ({ styleColor: raw.styleColor, raw, active: true, checkedAt: started })), skipDuplicates: true }),
          ...[...valid.values()].map(raw => prisma.importedProduct.updateMany({ where: { styleColor: raw.styleColor, checkedAt: { lt: started } }, data: { raw, active: true, checkedAt: started } }))
        ]);
        if (page.nextAnchor === null) break;
        anchor = page.nextAnchor;
      }
      if (!seen.size) throw new Error('Catálogo Nike sem calçados; espelho anterior preservado');
      // Retire missing products only after a complete, successful traversal.
      const completed = { lastAttemptAt: started.toISOString(), lastSuccessAt: now().toISOString(), total: seen.size, state: 'ok', error: null };
      await prisma.$transaction([
        prisma.importedProduct.updateMany({ where: { active: true, checkedAt: { lt: started } }, data: { active: false } }),
        prisma.setting.upsert({ where: { key: SYNC_KEY }, create: { key: SYNC_KEY, value: completed }, update: { value: completed } })
      ]);
      log?.info({ total: seen.size }, 'Catálogo Nike atualizado');
    } catch (err) {
      await setStatus({ ...attempt, state: 'error', error: err.message });
      log?.warn({ err }, 'Falha na sincronização Nike; catálogo local preservado');
    } finally {
      await prisma.setting.deleteMany({ where: { key: LOCK_KEY, value: { equals: owner } } });
    }
  }
  function sync() {
    if (!running) running = scan().finally(() => { running = null; });
    return running;
  }
  function start() {
    const tick = () => sync().catch(err => log?.error({ err }, 'Falha no job do catálogo'));
    void tick();
    const timer = setInterval(tick, 30_000);
    timer.unref?.();
    return async () => { stopped = true; clearInterval(timer); await running; };
  }
  return { get, list, upsert, status, sync, start,
    retire: styleColor => prisma.importedProduct.updateMany({ where: { styleColor }, data: { active: false, checkedAt: now() } }),
    top8Refs: async () => (await prisma.setting.findUnique({ where: { key: TOP8_KEY } }))?.value ?? null,
    saveTop8: refs => prisma.setting.upsert({ where: { key: TOP8_KEY }, create: { key: TOP8_KEY, value: refs }, update: { value: refs } }) };
}
