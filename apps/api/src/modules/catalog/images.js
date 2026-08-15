/**
 * Espelhamento de imagens com cache PERMANENTE (portado do BFF antigo).
 *
 * Regra: a imagem nunca expira. Depois de salva em storage/produtos/<styleColor>/<n>.<ext>,
 * é reaproveitada para sempre, mesmo quando os dados do produto (preço) são re-buscados.
 * Se o download falhar, devolve a URL de origem como fallback (não quebra o card).
 *
 * Em produção, trocar a gravação em disco por um object storage é só mexer aqui.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_DIR = path.resolve(__dirname, "../../../storage/produtos");

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function safeId(id) {
  return String(id || "sem-id").replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function createImageMirror({ publicBase = "/media/produtos", storageDir = STORAGE_DIR, log = null, fetchImpl = fetch } = {}) {
  /**
   * Garante que as imagens do styleColor estejam salvas localmente.
   * @returns {Promise<string[]>} URLs públicas (servidas pela própria api) ou de origem no fallback
   */
  async function ensureImages(styleColor, sourceUrls = []) {
    const id = safeId(styleColor);
    const dir = path.join(storageDir, id);
    const publicUrls = [];

    await fs.mkdir(dir, { recursive: true });

    for (let i = 0; i < sourceUrls.length; i++) {
      const meta = path.join(dir, `${i}.json`);

      if (await fileExists(meta)) {
        try {
          const { ext = "png" } = JSON.parse(await fs.readFile(meta, "utf8"));
          if (await fileExists(path.join(dir, `${i}.${ext}`))) {
            publicUrls.push(`${publicBase}/${id}/${i}.${ext}`);
            continue;
          }
        } catch {
          // meta corrompido → re-baixa
        }
      }

      try {
        const res = await fetchImpl(sourceUrls[i], { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "";
        const ext = ct.includes("webp") ? "webp" : ct.includes("jpeg") ? "jpg" : "png";
        await fs.writeFile(path.join(dir, `${i}.${ext}`), buf);
        await fs.writeFile(meta, JSON.stringify({ ext, origem: sourceUrls[i], savedAt: new Date().toISOString() }));
        publicUrls.push(`${publicBase}/${id}/${i}.${ext}`);
      } catch (err) {
        log?.warn({ url: sourceUrls[i], err: err.message }, "img: falha ao espelhar, usando URL de origem");
        publicUrls.push(sourceUrls[i]);
      }
    }
    return publicUrls;
  }

  return { ensureImages, storageDir };
}
