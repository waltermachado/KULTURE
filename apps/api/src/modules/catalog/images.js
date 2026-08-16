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

/**
 * Versão do espelho: entra no nome do arquivo (v2-0.webp). Mudou a forma de obter a imagem
 * (v2 = recorte transparente via nike-image.js) → nova versão, e os arquivos antigos ficam só
 * para pedidos que gravaram a URL antiga.
 */
export const IMAGE_VERSION = "v2";

export function createImageMirror({ publicBase = "/media/produtos", storageDir = STORAGE_DIR, log = null, fetchImpl = fetch } = {}) {
  // Estado de gravabilidade do storage. No Railway o volume é montado como root e o container roda
  // como `node` → EACCES. Nesse caso NÃO podemos derrubar o catálogo: servimos as URLs de origem
  // (Nike) e avisamos no log. Reavaliamos de tempos em tempos (RAILWAY_RUN_UID=0 ou volume ajustado).
  let writable = null; // null = ainda não testado
  let lastCheck = 0;
  const RECHECK_MS = 5 * 60_000;

  async function checkWritable() {
    const now = Date.now();
    if (writable !== null && now - lastCheck < RECHECK_MS) return writable;
    lastCheck = now;
    try {
      await fs.mkdir(storageDir, { recursive: true });
      const probe = path.join(storageDir, `.write-test-${process.pid}`);
      await fs.writeFile(probe, "ok");
      await fs.unlink(probe);
      if (writable === false) log?.info({ storageDir }, "img: storage voltou a ser gravável — espelho reativado");
      writable = true;
    } catch (err) {
      if (writable !== false) {
        log?.error(
          { storageDir, err: err.message, code: err.code },
          "img: storage NÃO gravável — imagens serão servidas direto da origem (Nike). No Railway: variável RAILWAY_RUN_UID=0 no serviço da api, ou monte o volume em outro caminho e aponte STORAGE_DIR para ele."
        );
      }
      writable = false;
    }
    return writable;
  }

  /**
   * Garante que as imagens do styleColor estejam salvas localmente.
   * @returns {Promise<string[]>} URLs públicas (servidas pela própria api) ou de origem no fallback
   */
  async function ensureImages(styleColor, sourceUrls = []) {
    const id = safeId(styleColor);
    const dir = path.join(storageDir, id);
    const publicUrls = [];

    if (!(await checkWritable())) return [...sourceUrls];

    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      log?.warn({ dir, err: err.message }, "img: não consegui criar a pasta do produto, usando URLs de origem");
      writable = false;
      return [...sourceUrls];
    }

    // baixa em paralelo (galeria tem até 8 fotos): o 1º acesso a um produto não pode travar o modal
    const results = await Promise.all(
      sourceUrls.map(async (src, i) => {
        const base = `${IMAGE_VERSION}-${i}`;
        const meta = path.join(dir, `${base}.json`);

        if (await fileExists(meta)) {
          try {
            const { ext = "png" } = JSON.parse(await fs.readFile(meta, "utf8"));
            if (await fileExists(path.join(dir, `${base}.${ext}`))) return `${publicBase}/${id}/${base}.${ext}`;
          } catch {
            // meta corrompido → re-baixa
          }
        }

        try {
          const res = await fetchImpl(src, {
            headers: {
              // CDN da Nike: UA de navegador + Accept com webp/avif (f_webp/f_auto respeitam o Accept)
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              Accept: "image/webp,image/avif,image/png,image/*;q=0.8,*/*;q=0.5"
            },
            signal: AbortSignal.timeout(12_000)
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          const ct = res.headers.get("content-type") || "";
          const ext = ct.includes("webp") ? "webp" : ct.includes("avif") ? "avif" : ct.includes("jpeg") ? "jpg" : "png";
          await fs.writeFile(path.join(dir, `${base}.${ext}`), buf);
          await fs.writeFile(meta, JSON.stringify({ ext, origem: src, savedAt: new Date().toISOString() }));
          return `${publicBase}/${id}/${base}.${ext}`;
        } catch (err) {
          log?.warn({ url: src, err: err.message }, "img: falha ao espelhar, usando URL de origem");
          return src;
        }
      })
    );
    publicUrls.push(...results);
    return publicUrls;
  }

  return { ensureImages, storageDir, checkWritable };
}
