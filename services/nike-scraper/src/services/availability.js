const unavailable = () => Object.assign(new Error('Produto não publicado para compra na Nike US'), { status: 404, code: 'PRODUCT_UNAVAILABLE' });

/** Feed stock alone is insufficient: withdrawn colors can retain available GTINs. */
export async function verifyStorefront(product, fetchImpl = fetch) {
  const sku = String(product.styleColor || '').toUpperCase();
  if (!/^[A-Z0-9]{6}-\d{3}$/.test(sku)) throw unavailable();
  let url;
  try { url = new URL(product.url); } catch { throw unavailable(); }
  if (url.origin !== 'https://www.nike.com' || !url.pathname.startsWith('/t/')) throw unavailable();
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/[A-Z0-9]{6}-\d{3}\/?$/i, '').replace(/\/$/, '') + '/' + sku;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    redirect: 'follow', signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 404 || response.status === 410) throw unavailable();
  if (!response.ok) throw new Error(`Não foi possível verificar a página Nike (${response.status})`);
  const final = new URL(response.url);
  if (final.origin !== url.origin || !final.pathname.startsWith('/t/') || final.pathname.split('/').filter(Boolean).at(-1)?.toUpperCase() !== sku) throw unavailable();
  const html = await response.text();
  // Read the selected product, not metadata or recommendations that may mention
  // a withdrawn SKU. This is the same page payload consumed by Nike's frontend.
  let props;
  try {
    const payload = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    props = JSON.parse(payload?.[1]).props.pageProps;
  } catch { throw new Error('Página Nike sem confirmação do código solicitado'); }
  const selected = props?.selectedProduct;
  if (props.marketPlace !== 'US' || props.styleColor !== sku || selected?.styleColor !== sku) throw unavailable();
  if (selected.statusModifier !== 'BUYABLE_BUY' || selected.isRestrictedAccess === true
    || Date.parse(selected.availabilityDate) > Date.now()) throw unavailable();
  if (!Array.isArray(selected.sizes)) throw new Error('Página Nike sem confirmação dos tamanhos');
  const sizes = product.sizes.map(size => {
    const published = selected.sizes.some(s => s.status === 'ACTIVE'
      && ((size.gtin && s.gtins?.some(g => g.gtin === size.gtin)) || (size.skuId && s.merchSkuId === size.skuId)));
    return { ...size, available: size.available === true && published };
  });
  if (!sizes.some(s => s.available)) throw unavailable();
  return { ...product, sizes, url: final.href, storefrontVerifiedAt: new Date().toISOString() };
}

