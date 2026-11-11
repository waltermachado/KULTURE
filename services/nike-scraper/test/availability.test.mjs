import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyStorefront } from '../src/services/availability.js';
import { getProductSizes } from '../src/services/nike.js';
import { isVerifiedAvailable } from '../../../apps/api/src/modules/catalog/availability.js';
const sku = 'HV9922-001';
const product = { styleColor: sku, url: 'https://www.nike.com/t/gt-cut-4-shoes-abc', sizes: [{ available: true, gtin: '123' }] };
const payload = (code = sku, statusModifier = 'BUYABLE_BUY') => '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { marketPlace: 'US', styleColor: code, selectedProduct: { styleColor: code, statusModifier, sizes: [{ status: 'ACTIVE', gtins: [{ gtin: '123' }] }] } } } }) + '</script>';
const page = (url, html = payload()) => ({ ok: true, status: 200, url, text: async () => html });

describe('Nike publication and stock verification', () => {
  it('rejects a withdrawn color even when its feed reports stock', async () => {
    let requested;
    const fetcher = async url => { requested = String(url); return page('https://www.nike.com/t/gt-cut-4-kay-yow-abc'); };
    await assert.rejects(verifyStorefront(product, fetcher), { status: 404, code: 'PRODUCT_UNAVAILABLE' });
    assert.equal(requested, product.url + '/' + sku);
  });
  it('confirms the exact SKU, persists its purchase link and timestamp', async () => {
    const verified = await verifyStorefront(product, async () => page(product.url + '/' + sku));
    assert.equal(verified.url, product.url + '/' + sku);
    assert.equal(isVerifiedAvailable(verified), true);
    assert.equal(isVerifiedAvailable(verified, Date.parse(verified.storefrontVerifiedAt) + 91 * 60_000), false);
    assert.equal(isVerifiedAvailable(product), false);
    assert.equal(isVerifiedAvailable({ ...verified, sizes: [{ available: false }] }), false);
  });
  it('does not accept a challenge, another region or a blocked request as confirmation', async () => {
    await assert.rejects(verifyStorefront(product, async () => page(product.url + '/' + sku, 'Access denied')), /sem\ confirmação/);
    await assert.rejects(verifyStorefront(product, async () => page('https://www.nike.com/gb/t/gt/' + sku)), { status: 404 });
    await assert.rejects(verifyStorefront(product, async () => ({ ok: false, status: 403 })), /\(403\)/);
  });
  it('rejects another selected SKU even if the requested SKU appears in page metadata', async () => {
    await assert.rejects(verifyStorefront(product, async () => page(product.url + '/' + sku, sku + payload('HV9922-600'))), { status: 404 });
    await assert.rejects(verifyStorefront(product, async () => page(product.url + '/' + sku, payload(sku, 'COMING_SOON'))), { status: 404 });
  });
  it('requires the stocked GTIN to also belong to an active size on the purchase page', async () => {
    await assert.rejects(verifyStorefront({ ...product, sizes: [{ available: true, gtin: 'other' }] }, async () => page(product.url + '/' + sku)), { status: 404 });
  });
  it('never falls back to another productInfo when the requested SKU is absent', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ objects: [{ productInfo: [{ merchProduct: { styleColor: 'HV9922-700' } }] }] }) });
    try { await assert.rejects(getProductSizes(sku), { status: 404 }); }
    finally { globalThis.fetch = previous; }
  });
  it('rejects an inactive color even when its GTINs still report available stock', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ objects: [{ productInfo: [{
      merchProduct: { styleColor: sku, status: 'INACTIVE' },
      skus: [{ nikeSize: '9', gtin: '123' }], availableGtins: [{ gtin: '123', available: true }]
    }] }] }) });
    try { await assert.rejects(getProductSizes(sku), { status: 404, code: 'PRODUCT_UNAVAILABLE' }); }
    finally { globalThis.fetch = previous; }
  });
});

import { createCatalogService } from '../../../apps/api/src/modules/catalog/service.js';
import { createLocalCatalog } from '../../../apps/api/src/modules/catalog/local-catalog.js';
import { createScraperClient } from '../../../apps/api/src/modules/catalog/scraper-client.js';
import { createSwrCache } from '../../../apps/api/src/lib/swr-cache.js';
import { DEFAULT_PRICING_RULES } from '../../../packages/shared/src/pricing/index.js';
const raw = () => ({ styleColor: sku, name: 'Nike G.T. Cut 4', priceUsd: 100, genders: ['MEN'], sizes: [{ nikeSize: '9', localizedSize: 'M 9', available: true }], storefrontVerifiedAt: new Date().toISOString() });
function catalog(scraper) {
  const cache = () => createSwrCache({ freshMs: 60000, staleMs: 120000 });
  return createCatalogService({ scraper: { rate: async () => ({ ask: 5 }), ...scraper }, cache: cache(), sizesCache: cache(), images: { ensureImages: async () => [] }, rules: DEFAULT_PRICING_RULES });
}

describe('Kulture availability gates', () => {
  it('never serves previous sizes when a new verification fails, even without fresh=true', async () => {
    let fail = false, calls = 0;
    const service = catalog({ getProductDetail: async () => { calls++; if (fail) throw new Error('Nike down'); return raw(); } });
    await service.getProductSizes(sku);
    fail = true;
    await assert.rejects(service.getProductSizes(sku), /Nike down/);
    assert.equal(calls, 2);
  });
  it('does not manufacture stock for a future launch with no available sizes', async () => {
    const service = catalog({ getProductDetail: async () => ({ ...raw(), launch: { startEntryDate: '2099-01-01' }, sizes: [{ nikeSize: '9', available: false }] }) });
    const { product: p } = await service.getProductSizes(sku, { fresh: true });
    assert.equal(p.sizes.some(s => s.available), false);
    assert.equal(p.sizesSynthetic, undefined);
  });
  it('hides unverified, expired and out-of-stock snapshots from search and size counts', async () => {
    const verified = raw();
    const rows = [verified, { ...raw(), storefrontVerifiedAt: undefined }, { ...raw(), storefrontVerifiedAt: '2000-01-01' }, { ...raw(), sizes: [] }];
    const local = createLocalCatalog({ prisma: { importedProduct: { findMany: async () => rows.map(raw => ({ raw })) } }, scraper: {} });
    const result = await local.list();
    assert.deepEqual(result.products, [verified]);
    assert.equal(result.sizes[0].count, 1);
  });
  it('rejects an outdated scraper response without storefront confirmation', async () => {
    const client = createScraperClient({ baseUrl: 'https://scraper.test', fetchImpl: async () => ({ ok: true, json: async () => ({ ...raw(), storefrontVerifiedAt: undefined }) }) });
    await assert.rejects(client.getProductDetail(sku), /não confirmou/);
  });
});
