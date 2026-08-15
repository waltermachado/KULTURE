/**
 * Cache stale-while-revalidate com single-flight.
 *
 *  L1: Map em memória (rápido).
 *  L2: tabela cache_entries no SQLite (opcional; sobrevive a restart).
 *
 *  - fresco  (< freshMs)  → responde direto, sem tocar na origem
 *  - vencido + origem ok  → busca ao vivo, atualiza L1/L2
 *  - vencido + origem off → serve cópia stale (< staleMs) com flag `stale: true`
 *  - single-flight: N chamadas simultâneas da mesma chave viram 1 fetch
 */
export function createSwrCache({ freshMs, staleMs, prisma = null, log = null }) {
  const mem = new Map(); // key -> { value, savedAt }
  const inflight = new Map(); // key -> Promise<value>

  async function readEntry(key) {
    const hit = mem.get(key);
    if (hit) return hit;
    if (!prisma) return null;
    try {
      const row = await prisma.cacheEntry.findUnique({ where: { key } });
      if (!row) return null;
      const entry = { value: JSON.parse(row.value), savedAt: row.savedAt.getTime() };
      mem.set(key, entry);
      return entry;
    } catch (err) {
      log?.warn({ err, key }, "swr-cache: falha ao ler L2");
      return null;
    }
  }

  async function writeEntry(key, value) {
    const entry = { value, savedAt: Date.now() };
    mem.set(key, entry);
    if (!prisma) return;
    try {
      const json = JSON.stringify(value);
      await prisma.cacheEntry.upsert({
        where: { key },
        create: { key, value: json, savedAt: new Date(entry.savedAt) },
        update: { value: json, savedAt: new Date(entry.savedAt) }
      });
    } catch (err) {
      log?.warn({ err, key }, "swr-cache: falha ao gravar L2");
    }
  }

  /** @returns {Promise<{value:any, cached:boolean, stale:boolean}>} */
  async function getOrFetch(key, fetcher) {
    const hit = await readEntry(key);
    const age = hit ? Date.now() - hit.savedAt : Infinity;

    if (hit && age < freshMs) return { value: hit.value, cached: true, stale: false };

    if (inflight.has(key)) {
      const value = await inflight.get(key);
      return { value, cached: false, stale: false };
    }

    const p = (async () => {
      const fresh = await fetcher();
      await writeEntry(key, fresh);
      return fresh;
    })();
    inflight.set(key, p);

    try {
      const value = await p;
      return { value, cached: false, stale: false };
    } catch (err) {
      if (hit && age < staleMs) {
        log?.warn({ err, key }, "swr-cache: origem falhou, servindo stale");
        return { value: hit.value, cached: true, stale: true };
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  }

  async function set(key, value) {
    await writeEntry(key, value);
  }

  function peek(key) {
    return mem.get(key)?.value ?? null;
  }

  function stats() {
    return { memoryKeys: mem.size, inflight: inflight.size, persistent: Boolean(prisma) };
  }

  return { getOrFetch, set, peek, stats };
}
