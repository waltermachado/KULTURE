import { DEFAULT_PRICING_RULES } from "@kulture/shared/pricing";
import { describe, it, expect, vi } from 'vitest';
import { createLocalCatalog, inCatalogWindow, availableSizes, SYNC_KEY } from '../src/modules/catalog/local-catalog.js';
import { createCatalogService } from '../src/modules/catalog/service.js';
import { createSwrCache } from '../src/lib/swr-cache.js';
import { createRestrictedFilter } from '../src/modules/restricted/routes.js';
import { normalizeDetail, getCatalogPage } from '../../../services/nike-scraper/src/services/nike.js';

const raw = (styleColor = 'AA0001-100', extra = {}) => ({ styleColor, name: 'Nike Air Test', subtitle: "Men's Basketball Shoes", priceUsd: 100, genders: ['MEN'], productType: 'FOOTWEAR', sizes: [{ nikeSize: '9', localizedSize: 'M 9', available: true }], ...extra });
const at = time => new Date(`2026-09-21T${time}-03:00`);
function database() {
  const products = new Map(), settings = new Map();
  const match = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('lt' in value) return row[key] < value.lt;
      if ('equals' in value) return row[key] === value.equals;
    }
    return row[key] === value;
  });
  const table = (rows, pk) => ({
    findUnique: vi.fn(async ({ where }) => rows.get(where[pk]) || null),
    findMany: vi.fn(async ({ where = {} } = {}) => [...rows.values()].filter(r => match(r, where))),
    create: vi.fn(async ({ data }) => { if (rows.has(data[pk])) throw Object.assign(new Error('duplicate'), { code: 'P2002' }); rows.set(data[pk], data); return data; }),
    upsert: vi.fn(async ({ where, create, update }) => { const row = rows.get(where[pk]); const next = row ? { ...row, ...update } : create; rows.set(where[pk], next); return next; }),
    createMany: vi.fn(async ({ data }) => { for (const row of data) if (!rows.has(row[pk])) rows.set(row[pk], row); }),
    updateMany: vi.fn(async ({ where, data }) => { let count = 0; for (const [key, row] of rows) if (match(row, where)) { rows.set(key, { ...row, ...data }); count++; } return { count }; }),
    deleteMany: vi.fn(async ({ where }) => { for (const [key, row] of rows) if (match(row, where)) rows.delete(key); })
  });
  return { products, settings, importedProduct: table(products, 'styleColor'), setting: table(settings, 'key'), $transaction: xs => Promise.all(xs) };
}
const page = (products, nextAnchor = null, total = products.length) => ({ products, received: products.length, nextAnchor, total });

describe('permanent Nike mirror', () => {
  it('uses Brasília boundaries, independent of server timezone', () => {
    expect(inCatalogWindow(at('05:59:59'))).toBe(false);
    expect(inCatalogWindow(at('06:00:00'))).toBe(true);
    expect(inCatalogWindow(at('23:59:59'))).toBe(true);
    expect(inCatalogWindow(at('00:00:00'))).toBe(false);
  });
  it('visits all pages, keeps rows across instances, retires missing shoes only on success', async () => {
    const prisma = database();
    prisma.products.set('old', { styleColor: 'old', raw: raw('old'), checkedAt: at('05:00:00'), active: true });
    const scraper = { catalogPage: vi.fn().mockResolvedValueOnce(page([raw()], 1, 2)).mockResolvedValueOnce(page([raw('BB0002-100')])) };
    const local = createLocalCatalog({ prisma, scraper, now: () => at('06:00:00') });
    await Promise.all([local.sync(), local.sync()]);
    expect(scraper.catalogPage.mock.calls).toEqual([[0], [1]]);
    expect(prisma.products.get('old').active).toBe(false);
    expect((await local.status()).total).toBe(2);
    const afterRestart = createLocalCatalog({ prisma, scraper, now: () => at('06:30:00') });
    expect((await afterRestart.list()).products).toHaveLength(2);
    await afterRestart.sync();
    expect(scraper.catalogPage).toHaveBeenCalledTimes(2);
  });
  it('does not crawl overnight; resumes at 06h and repeats hourly', async () => {
    let time = at('05:59:59');
    const scraper = { catalogPage: vi.fn(async () => page([raw()])) };
    const local = createLocalCatalog({ prisma: database(), scraper, now: () => time });
    await local.sync(); expect(scraper.catalogPage).not.toHaveBeenCalled();
    time = at('06:00:00'); await local.sync();
    time = at('06:59:59'); await local.sync(); expect(scraper.catalogPage).toHaveBeenCalledTimes(1);
    time = at('07:00:00'); await local.sync(); expect(scraper.catalogPage).toHaveBeenCalledTimes(2);
  });
  it('preserves old records on upstream failure, empty response, or stalled pagination', async () => {
    for (const response of [new Error('Nike down'), page([], null, 10), page([raw()], 0, 2)]) {
      const prisma = database();
      prisma.products.set('old', { styleColor: 'old', raw: raw('old'), checkedAt: at('05:00:00'), active: true });
      const scraper = { catalogPage: vi.fn(async () => { if (response instanceof Error) throw response; return response; }) };
      const local = createLocalCatalog({ prisma, scraper, now: () => at('06:00:00') });
      await local.sync();
      expect(prisma.products.get('old').active).toBe(true);
      expect((await local.status()).state).toBe('error');
    }
  });
  it('stops a traversal at midnight without retiring the previous catalog', async () => {
    let time = at('23:59:59');
    const prisma = database();
    const scraper = { catalogPage: vi.fn(async () => { time = at('00:00:00'); return page([raw()], 1, 2); }) };
    const local = createLocalCatalog({ prisma, scraper, now: () => time });
    await local.sync();
    expect(scraper.catalogPage).toHaveBeenCalledTimes(1);
    expect((await local.status()).state).toBe('paused');
    expect(prisma.importedProduct.updateMany).not.toHaveBeenCalled();
  });
  it('a scan cannot overwrite newer stock observed on a customer click', async () => {
    const prisma = database();
    prisma.products.set('AA0001-100', { styleColor: 'AA0001-100', raw: raw(undefined, { sizes: [] }), checkedAt: at('06:00:01'), active: true });
    const local = createLocalCatalog({ prisma, scraper: { catalogPage: async () => page([raw()]) }, now: () => at('06:00:00') });
    await local.sync();
    expect((await local.get('AA0001-100')).sizes).toEqual([]);
  });
  it('filters the full catalog before pagination and exposes only available BR sizes', async () => {
    const prisma = database();
    const restricted = createRestrictedFilter();
    const local = createLocalCatalog({ prisma, scraper: {}, restricted });
    await local.upsert(raw());
    await local.upsert(raw('BB0002-100', { sizes: [{ nikeSize: '10', localizedSize: 'M 10', available: false }] }));
    const br = availableSizes(raw())[0];
    const result = await local.list({ q: 'test nike', size: br });
    expect(result.products.map(p => p.styleColor)).toEqual(['AA0001-100']);
    expect(result.sizes).toEqual([{ br, count: 1 }]);
    expect((await local.list({ size: '99' })).products).toEqual([]);
  });
  it('database lease excludes another replica', async () => {
    const prisma = database();
    prisma.settings.set('imported-catalog-lock', { key: 'imported-catalog-lock', value: 'another', updatedAt: at('06:00:00') });
    const scraper = { catalogPage: vi.fn() };
    await createLocalCatalog({ prisma, scraper, now: () => at('06:00:01') }).sync();
    expect(scraper.catalogPage).not.toHaveBeenCalled();
  });
});

function catalogFixture() {
  const scraper = { rate: async () => ({ ask: 5 }), getProductDetail: vi.fn(async () => raw()), findOne: async () => raw() };
  const local = createLocalCatalog({ prisma: database(), scraper });
  const cache = () => createSwrCache({ freshMs: 60000, staleMs: 120000 });
  const catalog = createCatalogService({ scraper, local, cache: cache(), sizesCache: cache(), images: { ensureImages: async (_, urls) => urls }, rules: DEFAULT_PRICING_RULES });
  return { scraper, local, catalog };
}
describe('live refresh and curation', () => {
  it('bypasses a fresh cache on each click, persists fresh sizes, and propagates failures', async () => {
    const { scraper, local, catalog } = catalogFixture();
    await catalog.getProductSizes('AA0001-100', { fresh: true });
    scraper.getProductDetail.mockResolvedValueOnce(raw(undefined, { sizes: [] }));
    expect((await catalog.getProductSizes('AA0001-100', { fresh: true })).product.sizes).toEqual([]);
    expect((await local.list({ size: availableSizes(raw())[0] })).products).toEqual([]);
    scraper.getProductDetail.mockRejectedValueOnce(new Error('Nike down'));
    await expect(catalog.getProductSizes('AA0001-100', { fresh: true })).rejects.toThrow('Nike down');
    expect(scraper.getProductDetail).toHaveBeenCalledTimes(3);
  });
  it('saved top8 order takes effect immediately without Nike requests', async () => {
    const { scraper, local, catalog } = catalogFixture();
    await local.upsert(raw('AA0001-100')); await local.upsert(raw('BB0002-100'));
    await local.saveTop8(['BB0002-100', 'AA0001-100']);
    expect((await catalog.top8()).products.map(p => p.styleColor)).toEqual(['BB0002-100', 'AA0001-100']);
    await local.saveTop8(['AA0001-100', 'BB0002-100']);
    expect((await catalog.top8()).products[0].styleColor).toBe('AA0001-100');
    expect(scraper.getProductDetail).not.toHaveBeenCalled();
  });
});

it('scraper normalizes live GTIN availability and every footwear colorway', async () => {
  const info = sku => ({ merchProduct: { styleColor: sku, productType: 'FOOTWEAR', genders: ['MEN'] }, productContent: { title: 'Nike Test' }, merchPrice: { currentPrice: 99 }, skus: [{ nikeSize: '9', gtin: '123', countrySpecifications: [{ localizedSize: 'M 9' }] }], availableGtins: [{ gtin: '123', available: true, level: 'HIGH' }] });
  expect(normalizeDetail({}, info('AA0001-100')).sizes[0].available).toBe(true);
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ pages: { totalResources: 2 }, objects: [{ productInfo: [info('AA0001-100'), info('AA0001-200')] }] }) }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const p = await getCatalogPage();
    expect(p.products.map(x => x.styleColor)).toEqual(['AA0001-100', 'AA0001-200']);
    expect(p.nextAnchor).toBe(1);
  } finally { vi.unstubAllGlobals(); }
});
