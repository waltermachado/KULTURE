/**
 * cache.js
 * ------------------------------------------------------------
 * Cache de 2 níveis, em memória (MVP). Migra para Redis depois.
 *
 *  - DADOS (preço, disponibilidade): TTL 1h. Também guarda uma
 *    cópia "stale" por 24h para servir se a API cair.
 *  - single-flight: buscas simultâneas da mesma chave viram 1 só.
 *
 * A IMAGEM não fica aqui — ela é permanente e é tratada em
 * images.js (salva em disco/storage, nunca expira).
 * ------------------------------------------------------------
 */

const FRESH_MS = 60 * 60 * 1000;       // 1h
const STALE_MS = 24 * 60 * 60 * 1000;  // 24h

const store = new Map();   // chave -> { value, savedAt }
const inflight = new Map(); // chave -> Promise (single-flight)

export function normalizeQuery(q){
  return (q||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // tira acento
    .trim().replace(/\s+/g,'-');
}

/**
 * getOrFetch(chave, fetcher)
 * Devolve { value, cached, stale }.
 *  - cached=true  → veio do cache (não bateu na API)
 *  - stale=true   → cache vencido mas API falhou; servindo cópia velha
 */
export async function getOrFetch(key, fetcher){
  const hit = store.get(key);
  const age = hit ? Date.now() - hit.savedAt : Infinity;

  if (hit && age < FRESH_MS) {
    return { value: hit.value, cached: true, stale: false };
  }

  // single-flight: se já há uma busca em andamento p/ esta chave, espera ela
  if (inflight.has(key)) {
    const value = await inflight.get(key);
    return { value, cached: false, stale: false };
  }

  const p = (async () => {
    const fresh = await fetcher();
    store.set(key, { value: fresh, savedAt: Date.now() });
    return fresh;
  })();
  inflight.set(key, p);

  try {
    const value = await p;
    return { value, cached: false, stale: false };
  } catch (err) {
    // API falhou → serve stale se existir e não estiver velho demais
    if (hit && age < STALE_MS) {
      return { value: hit.value, cached: true, stale: true };
    }
    throw err;
  } finally {
    inflight.delete(key);
  }
}

export function peek(key){
  return store.get(key)?.value ?? null;
}

export function stats(){
  return { chaves: store.size, inflight: inflight.size };
}
