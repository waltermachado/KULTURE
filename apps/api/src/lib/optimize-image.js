import sharp from 'sharp';
/** Bound decoded pixels and output size; retain originals when conversion would increase bytes. */
export async function optimizeImage(data, mime) {
  const original = Buffer.from(data);
  const webp = await sharp(original, { limitInputPixels: 40_000_000, animated: false })
    .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 }).toBuffer();
  return webp.length < original.length ? { data: webp, mime: 'image/webp', bytes: webp.length } : { data: original, mime, bytes: original.length };
}
