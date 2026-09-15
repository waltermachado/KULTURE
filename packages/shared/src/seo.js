/** Shared metadata for the initial HTML and client-side navigation. */
export const PUBLIC_PAGES = {
  '/': ['Tênis importados originais dos EUA | Kulture BR', 'Encontre sneakers originais de basquete, corrida e casual. Importados dos EUA, com numeração BR, preço final fechado e frete grátis.'],
  '/pronta-entrega': ['Tênis originais à pronta entrega no Brasil | Kulture BR', 'Compre tênis originais em estoque no Brasil, com envio imediato após o pagamento, numeração brasileira e frete grátis. Confira os pares disponíveis.'],
  '/hypados': ['Sneakers hypados e raros importados | Kulture BR', 'Descubra sneakers originais difíceis de encontrar, garimpados nos EUA e importados para você. Numeração BR, preço final fechado e frete grátis.']
};
const PRIVATE_PAGES = {
  '/checkout': ['Finalizar compra | Kulture BR', 'Confira sua sacola e finalize sua compra na Kulture BR.'],
  '/conta': ['Minha conta | Kulture BR', 'Acompanhe seus pedidos e gerencie seu cadastro na Kulture BR.'],
  '/redefinir-senha': ['Redefinir senha | Kulture BR', 'Redefina sua senha de acesso à Kulture BR.']
};
export function pageSeo(pathname, base, product) {
  const origin = new URL(base).origin;
  const path = pathname.replace(/\/+$/, '') || '/';
  const canonical = new URL(product?.path || path, origin).href;
  let [title, description] = PUBLIC_PAGES[path] || PRIVATE_PAGES[path] ||
    (path.startsWith('/pedido/') ? ['Acompanhar pedido | Kulture BR', 'Consulte o andamento do seu pedido na Kulture BR.'] : ['Kulture BR — Sneakers originais', 'Sneakers originais, importados dos EUA e pronta entrega no Brasil.']);
  let image = new URL('/og-image.png', origin).href;
  const schema = [];
  if (PUBLIC_PAGES[path]) {
    schema.push({ '@context': 'https://schema.org', '@type': 'Organization', '@id': `${origin}/#organization`, name: 'Kulture BR', url: `${origin}/`, logo: `${origin}/favicon-512.png`, sameAs: ['https://instagram.com/kulturebr'] });
    schema.push({ '@context': 'https://schema.org', '@type': path === '/' ? 'WebSite' : 'CollectionPage', name: title, description, url: canonical, inLanguage: 'pt-BR' });
  }
  if (product) {
    title = `${product.name} | Kulture BR`;
    description = `${product.name} original. ${product.section === 'hypados' ? 'Garimpado nos EUA e importado para você' : 'Pronta entrega no Brasil'}. ${product.stock?.total > 0 ? 'Confira os tamanhos disponíveis' : 'Esgotado no momento'}. Frete grátis e numeração BR.`;
    const images = (product.images || []).map(src => new URL(src, origin).href);
    image = images[0] || image;
    const item = { '@context': 'https://schema.org', '@type': 'Product', name: product.name, description: product.description || description, image: images, sku: product.code, url: canonical };
    if (product.brand) item.brand = { '@type': 'Brand', name: product.brand };
    if (Number.isFinite(product.price?.brl) && product.price.brl > 0) item.offers = { '@type': 'Offer', url: canonical, priceCurrency: 'BRL', price: product.price.brl, availability: `https://schema.org/${product.stock?.total > 0 ? 'InStock' : 'OutOfStock'}`, itemCondition: 'https://schema.org/NewCondition', seller: { '@type': 'Organization', name: 'Kulture BR' } };
    schema.push(item);
    const section = product.section === 'hypados' ? '/hypados' : '/pronta-entrega';
    schema.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: product.section === 'hypados' ? 'Hypados' : 'Pronta entrega', item: origin + section },
      { '@type': 'ListItem', position: 3, name: product.name, item: canonical }
    ] });
  }
  return { title, description, canonical, image, schema, type: product ? 'product' : 'website' };
}
export const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const jsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');
export function seoHtml(html, seo, verification = '') {
  const metas = [['name', 'description', seo.description], ['property', 'og:type', seo.type], ['property', 'og:site_name', 'Kulture BR'], ['property', 'og:locale', 'pt_BR'], ['property', 'og:title', seo.title], ['property', 'og:description', seo.description], ['property', 'og:url', seo.canonical], ['property', 'og:image', seo.image], ['property', 'og:image:alt', seo.title], ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', seo.title], ['name', 'twitter:description', seo.description], ['name', 'twitter:image', seo.image]];
  if (verification) metas.push(['name', 'google-site-verification', verification]);
  const tags = metas.map(([key, name, content]) => `<meta ${key}="${name}" content="${escapeHtml(content)}" data-seo />`).join('\n');
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, '')
    .replace('</head>', `${tags}\n<link rel="canonical" href="${escapeHtml(seo.canonical)}" data-seo />\n<script type="application/ld+json" data-seo>${jsonLd(seo.schema)}</script>\n</head>`);
}
