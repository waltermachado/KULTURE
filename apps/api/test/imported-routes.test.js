import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { describe, it, expect } from 'vitest';
import { importedAdminRoutes } from '../src/modules/catalog/admin-routes.js';
import { catalogRoutes } from '../src/modules/catalog/routes.js';
import { errorHandler } from '../src/lib/errors.js';

async function fixture(role = 'admin') {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(jwt, { secret: 'local-test-only-imported-catalog-secret' });
  let saved = null;
  const products = Array.from({ length: 8 }, (_, i) => ({ styleColor: `AA000${i}-100`, name: `Nike ${i}` }));
  app.decorate('prisma', { user: { findUnique: async () => ({ role }) }, importedProduct: { count: async () => 8 } });
  app.decorate('localCatalog', {
    top8Refs: async () => saved, status: async () => ({ state: 'ok' }),
    get: async ref => products.find(p => p.styleColor === ref), saveTop8: async refs => { saved = refs; }
  });
  app.decorate('restricted', { isBlocked: async p => p.name === 'blocked' });
  app.decorate('catalog', {
    top8: async () => ({ products, total: 8 }),
    browse: async query => ({ ...query, products: [{ ...products[0], price: { brl: 999, breakdown: { cost: 10 }, rulesApplied: ['private'] } }], sizes: [{ br: '41', count: 1 }], total: 1 }),
    getProductSizes: async (_ref, options) => ({ cached: !options.fresh, stale: false, product: { ...products[0], sizes: [], price: { brl: 999, breakdown: { cost: 10 } } } })
  });
  await app.register(importedAdminRoutes); await app.register(catalogRoutes); await app.ready();
  return { app, products, headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'test' })}` } };
}

describe('imported admin authorization and validation', () => {
  it('rejects guests and customers, accepts only eight distinct existing shoes', async () => {
    const { app, headers, products } = await fixture();
    try {
      const url = '/api/admin/imported/top8';
      const refs = products.map(p => p.styleColor).reverse();
      expect((await app.inject({ url: '/api/admin/imported' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PUT', url, payload: { refs } })).statusCode).toBe(401);
      for (const invalid of [refs.slice(0, 7), [...refs.slice(0, 7), refs[0]], [...refs.slice(0, 7), 'missing']]) {
        expect((await app.inject({ method: 'PUT', url, headers, payload: { refs: invalid } })).statusCode).toBe(400);
      }
      expect((await app.inject({ method: 'PUT', url, headers, payload: { refs } })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/admin/imported', headers })).json().refs).toEqual(refs);
    } finally { await app.close(); }
    const customer = await fixture('customer');
    try { expect((await customer.app.inject({ url: '/api/admin/imported', headers: customer.headers })).statusCode).toBe(403); }
    finally { await customer.app.close(); }
  });
  it('public catalog strips internal prices, validates pages and forces live product refresh', async () => {
    const { app } = await fixture();
    try {
      const result = await app.inject({ url: '/api/imported?size=41&offset=48&limit=24' });
      expect(result.json()).toMatchObject({ size: '41', offset: 48, limit: 24, sizes: [{ br: '41', count: 1 }] });
      expect(result.json().products[0].price).toEqual({ brl: 999 });
      expect(result.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ url: '/api/imported?limit=999' })).statusCode).toBe(400);
      const detail = await app.inject({ url: '/api/product/AA0000-100' });
      expect(detail.json().cached).toBe(false);
      expect(detail.json().product.price).toEqual({ brl: 999 });
    } finally { await app.close(); }
  });
});
