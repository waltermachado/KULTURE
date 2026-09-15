import { it, expect } from 'vitest';
import sharp from 'sharp';
import { optimizeImage } from '../src/lib/optimize-image.js';
it('compresses and bounds large images while preserving transparency', async () => {
  const source = await sharp({ create: { width: 2400, height: 1600, channels: 4, background: '#ffcc0080' } }).png().toBuffer();
  const result = await optimizeImage(source, 'image/png');
  const meta = await sharp(result.data).metadata();
  expect(result.bytes).toBeLessThan(source.length); expect(meta.width).toBeLessThanOrEqual(1200); expect(meta.hasAlpha).toBe(true);
});
it('rejects corrupt uploads', async () => { await expect(optimizeImage(Buffer.from('not an image'), 'image/png')).rejects.toThrow(); });
