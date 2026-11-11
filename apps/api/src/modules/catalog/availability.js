export function isVerifiedAvailable(product, now = Date.now()) {
  const checked = Date.parse(product?.storefrontVerifiedAt);
  return Number.isFinite(checked) && now - checked >= 0 && now - checked < 90 * 60_000
    && product.sizes?.some(s => s.available === true);
}
