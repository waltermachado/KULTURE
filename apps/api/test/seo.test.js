import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serveWeb } from '../src/plugins/serve-web.js';
import { pageSeo, seoHtml } from '@kulture/shared/seo';
const product = { name: 'Nike Dunk <Panda>', code: 'PE-123', path: '/pronta-entrega/nike-dunk-panda', section: 'stock', brand: 'Nike', images: ['/media/panda.webp'], stock: { total: 2 }, price: { brl: 899 } };
const html = '<html><head><title>Old</title><meta name="description" content="Old" /></head><body></body></html>';
const cleanup = [];
afterEach(async () => { for (const run of cleanup.splice(0)) await run(); });
async function setup(production = false, fail = false) {
  const dist = await mkdtemp(path.join(tmpdir(), 'kulture-seo-')); cleanup.push(() => rm(dist, { recursive: true, force: true }));
  await writeFile(path.join(dist, 'index.html'), html);
  const app = Fastify({ trustProxy: true }); cleanup.unshift(() => app.close());
  app.decorate('env', { NODE_ENV: production ? 'production' : 'test', PUBLIC_WEB_URL: 'https://lojakulture.com.br', PUBLIC_WEB_HOSTS: ['lojakulture.com.br'] });
  app.decorate('stock', { getProductByRef: async ref => ['PE-123', 'nike-dunk-panda'].includes(ref) ? product : null, listPublic: async ({ section }) => { if (fail) throw Error('offline'); return section === 'stock' ? [product] : []; } });
  await serveWeb(app, { dist });
  return app;
}
describe('SEO metadata and public routes', () => {
  it('escapes metadata and JSON-LD and uses canonical product facts', () => {
    const seo = pageSeo('/hypados/PE-123', 'https://lojakulture.com.br', { ...product, description: '</script><script>alert(1)</script>' });
    const output = seoHtml(html, seo);
    expect(output).toContain('Nike Dunk &lt;Panda&gt;');
    expect(output).not.toContain('</script><script>alert');
    expect(seo.schema[0].offers.price).toBe(899);
    expect(seo.canonical).toBe('https://lojakulture.com.br/pronta-entrega/nike-dunk-panda');
    expect(pageSeo('/', 'https://lojakulture.com.br').schema.some(s => s['@type'] === 'Product')).toBe(false);
  });
  it('serves homepage, metadata for collections, sitemap and robots without needing an HTML accept header', async () => {
    const app = await setup();
    const home = await app.inject('/'); expect(home.statusCode).toBe(200); expect(home.body).toContain('og:image');
    const collection = await app.inject({ url: '/hypados?cat=running', headers: { accept: 'text/html' } });
    expect(collection.body).toContain('Sneakers hypados e raros'); expect(collection.body).toContain('href="https://lojakulture.com.br/hypados"');
    const sitemap = await app.inject('/sitemap.xml'); expect(sitemap.statusCode).toBe(200); expect(sitemap.body).toContain(product.path); expect(sitemap.body).not.toContain('/checkout');
    expect((await app.inject('/robots.txt')).body).toContain('Sitemap: https://lojakulture.com.br/sitemap.xml');
  });
  it('redirects alternate product URLs, returns 404 for missing products, and keeps only one canonical', async () => {
    const app = await setup();
    const alias = await app.inject('/hypados/PE-123?utm_source=instagram'); expect(alias.statusCode).toBe(301); expect(alias.headers.location).toBe(product.path + '?utm_source=instagram');
    const page = await app.inject(product.path); expect(page.statusCode).toBe(200); expect(page.body.match(/rel="canonical"/g)).toHaveLength(1);
    expect((await app.inject('/pronta-entrega/missing')).statusCode).toBe(404);
    expect((await app.inject('/pronta-entrega/%ZZ')).statusCode).toBe(400);
  });
  it('redirects insecure requests to the configured HTTPS host and respects proxy protocol', async () => {
    const app = await setup(true);
    const redirect = await app.inject({ url: '/hypados', headers: { host: 'attacker.example' } }); expect(redirect.statusCode).toBe(308); expect(redirect.headers.location).toBe('https://lojakulture.com.br/hypados');
    const secure = await app.inject({ url: '/', headers: { 'x-forwarded-proto': 'https' } }); expect(secure.statusCode).toBe(200); expect(secure.headers['strict-transport-security']).toBe('max-age=31536000');
  });
  it('returns a retryable error rather than an incomplete sitemap when the catalog fails', async () => {
    const app = await setup(false, true); expect((await app.inject('/sitemap.xml')).statusCode).toBe(503);
  });
});
