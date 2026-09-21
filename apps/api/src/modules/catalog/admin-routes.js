import { requireAdmin } from '../../lib/guards.js';
import { AppError } from '../../lib/errors.js';

export async function importedAdminRoutes(app) {
  const options = { onRequest: requireAdmin };
  app.get('/api/admin/imported', options, async () => {
    const [refs, sync, top] = await Promise.all([app.localCatalog.top8Refs(), app.localCatalog.status(), app.catalog.top8()]);
    return { refs, sync, products: top.products, total: await app.prisma.importedProduct.count({ where: { active: true } }) };
  });
  app.put('/api/admin/imported/top8', {
    ...options,
    schema: { body: { type: 'object', required: ['refs'], additionalProperties: false, properties: {
      refs: { type: 'array', minItems: 8, maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } }
    } } }
  }, async req => {
    const refs = req.body.refs.map(ref => ref.trim().toUpperCase());
    if (new Set(refs).size !== 8) throw AppError.badRequest('Escolha oito tênis diferentes');
    for (const ref of refs) {
      const raw = await app.localCatalog.get(ref);
      if (!raw || await app.restricted.isBlocked(raw)) throw AppError.badRequest(`O tênis ${ref} não está disponível no catálogo da loja`);
    }
    await app.localCatalog.saveTop8(refs);
    return { refs };
  });
}
