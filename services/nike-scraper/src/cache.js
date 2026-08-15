// Cache em memória com TTL + persistência em disco (JSON).
// Zero dependências: sobrevive a restarts sem precisar de Redis.
import fs from 'node:fs';
import path from 'node:path';

const CACHE_FILE = path.resolve('data/cache.json');
const store = new Map();

// Carrega cache persistido (se existir)
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry.expiresAt > now) store.set(key, entry);
    }
  }
} catch {
  // cache corrompido — ignora e começa limpo
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(store)));
    } catch {
      // falha ao persistir não deve derrubar a API
    }
  }, 2000);
}

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMinutes) {
  store.set(key, { value, expiresAt: Date.now() + ttlMinutes * 60_000 });
  schedulePersist();
}

export function cacheStats() {
  return { entries: store.size };
}
