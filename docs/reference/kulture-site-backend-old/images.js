/**
 * images.js
 * ------------------------------------------------------------
 * Espelhamento de imagens com CACHE PERMANENTE.
 *
 * Regra do projeto: a imagem NUNCA expira. Depois de salva uma vez,
 * é reaproveitada para sempre — mesmo que os dados do produto
 * (preço) sejam re-buscados após 1h.
 *
 * Fluxo:
 *   ensureImages(styleId, urlsNike)
 *     - se já existe pasta storage/produtos/<styleId>/ → reusa (não baixa)
 *     - senão → baixa cada imagem uma vez e salva
 *   retorna as URLs públicas do NOSSO domínio (/media/...)
 *
 * Em produção troque a gravação em disco por Cloudflare R2 / Supabase.
 * ------------------------------------------------------------
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'produtos');
const PUBLIC_BASE = process.env.MEDIA_BASE || '/media/produtos';

async function fileExists(p){
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Garante que as imagens do styleId estejam salvas localmente.
 * Retorna array de URLs públicas (servidas pelo próprio backend).
 * NÃO re-baixa se já existirem.
 */
export async function ensureImages(styleId, urlsNike = []){
  const dir = path.join(STORAGE_DIR, styleId);
  const publicUrls = [];

  await fs.mkdir(dir, { recursive: true });

  for (let i = 0; i < urlsNike.length; i++){
    const filename = `${i}.img`;               // extensão real definida no download
    const dest = path.join(dir, filename);
    const meta = path.join(dir, `${i}.json`);

    if (await fileExists(dest)){
      // já espelhada — reusa, cache permanente
      const ext = JSON.parse(await fs.readFile(meta,'utf8')).ext || 'png';
      publicUrls.push(`${PUBLIC_BASE}/${styleId}/${i}.${ext}`);
      continue;
    }

    try {
      const res = await fetch(urlsNike[i]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      const ext = ct.includes('webp') ? 'webp' : ct.includes('jpeg') ? 'jpg' : 'png';
      const finalDest = path.join(dir, `${i}.${ext}`);
      await fs.writeFile(finalDest, buf);
      await fs.writeFile(meta, JSON.stringify({ ext, origem: urlsNike[i], savedAt: new Date().toISOString() }));
      publicUrls.push(`${PUBLIC_BASE}/${styleId}/${i}.${ext}`);
    } catch (err){
      // se não conseguiu baixar, mantém a URL original como fallback
      console.warn(`[img] falha ao espelhar ${urlsNike[i]}: ${err.message} — usando URL de origem`);
      publicUrls.push(urlsNike[i]);
    }
  }
  return publicUrls;
}

export { STORAGE_DIR };
