// Cotação USD-BRL com cache, várias fontes e "último câmbio conhecido".
//
// Por que várias fontes: a AwesomeAPI (gratuita) limita por IP e o IP de saída do Railway é
// compartilhado → 429 frequente. Sem câmbio o site inteiro fica sem preço, então:
//   1) cache fresco (RATE_CACHE_TTL_MIN, padrão 60 min)
//   2) fontes em ordem: AwesomeAPI → Frankfurter (BCE, sem chave) → open.er-api (sem chave)
//   3) último câmbio conhecido (persistido em data/cache.json), mesmo vencido, até RATE_STALE_MAX_HOURS
//   4) RATE_FALLBACK_USD_BRL (opcional, só se configurado) — último recurso, marcado como source "fallback-env"
// Falha de uma fonte é "cacheada" por RATE_FAIL_BACKOFF_SEC para não martelar quem já respondeu 429.
import { cacheGet, cacheSet } from '../cache.js';

const RATE_TTL = Number(process.env.RATE_CACHE_TTL_MIN || 60);
const STALE_MAX_MS = Number(process.env.RATE_STALE_MAX_HOURS || 72) * 3_600_000;
const FAIL_BACKOFF_MS = Number(process.env.RATE_FAIL_BACKOFF_SEC || 90) * 1000;
const MARGIN = Number(process.env.MARGIN_PERCENT || 0);
const FALLBACK = Number(process.env.RATE_FALLBACK_USD_BRL || 0);
// dólar TURISMO (usado na precificação): AwesomeAPI USD-BRLT; se não vier, comercial + spread fixo em R$
const TOURISM_SPREAD_BRL = Number(process.env.RATE_TOURISM_SPREAD_BRL ?? 0.25);

const KEY = 'rate:USD-BRL';
const LAST_KEY = 'rate:USD-BRL:last'; // sem TTL curto: guarda o último válido por muito tempo
const failUntil = new Map(); // source → timestamp até quando pular

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const SOURCES = [
  {
    name: 'economia.awesomeapi.com.br',
    // comercial + turismo numa chamada só
    url: 'https://economia.awesomeapi.com.br/json/last/USD-BRL,USD-BRLT',
    parse(data) {
      const q = data?.USDBRL;
      const ask = num(q?.ask);
      if (!ask) return null;
      const t = data?.USDBRLT;
      const tourismAsk = num(t?.ask);
      return {
        bid: num(q.bid) ?? ask,
        ask,
        high: num(q.high),
        low: num(q.low),
        timestamp: q.create_date || new Date().toISOString(),
        tourism: tourismAsk ? { bid: num(t.bid) ?? tourismAsk, ask: tourismAsk, timestamp: t.create_date || null, source: 'economia.awesomeapi.com.br (USD-BRLT)' } : null
      };
    }
  },
  {
    name: 'frankfurter.dev (BCE)',
    url: 'https://api.frankfurter.dev/v1/latest?from=USD&to=BRL',
    parse(data) {
      const ask = num(data?.rates?.BRL);
      if (!ask) return null;
      return { bid: ask, ask, high: null, low: null, timestamp: data.date ? `${data.date} 00:00:00` : new Date().toISOString() };
    }
  },
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse(data) {
      const ask = num(data?.rates?.BRL);
      if (!ask) return null;
      return { bid: ask, ask, high: null, low: null, timestamp: data.time_last_update_utc || new Date().toISOString() };
    }
  }
];

async function fetchFrom(src) {
  const until = failUntil.get(src.name) || 0;
  if (until > Date.now()) throw new Error(`${src.name}: em backoff após falha recente`);
  try {
    const res = await fetch(src.url, { headers: { Accept: 'application/json', 'User-Agent': 'kulture-scraper/0.2' }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`${src.name} respondeu ${res.status}`);
    const parsed = src.parse(await res.json());
    if (!parsed) throw new Error(`${src.name}: resposta sem cotação`);
    failUntil.delete(src.name);
    return { pair: 'USD-BRL', ...parsed, source: src.name };
  } catch (err) {
    failUntil.set(src.name, Date.now() + FAIL_BACKOFF_MS);
    throw err;
  }
}

/** Garante `tourism` (dólar turismo): vem da AwesomeAPI (USD-BRLT) ou = comercial + TOURISM_SPREAD_BRL. */
function withTourism(rate) {
  if (rate?.tourism?.ask) return rate;
  const ask = Number(rate.ask);
  const round4 = (v) => Math.round(v * 10000) / 10000;
  return {
    ...rate,
    tourism: {
      bid: round4((Number(rate.bid) || ask) + TOURISM_SPREAD_BRL),
      ask: round4(ask + TOURISM_SPREAD_BRL),
      timestamp: rate.timestamp || null,
      source: `fallback: comercial + R$ ${TOURISM_SPREAD_BRL.toFixed(2)}`
    }
  };
}

export async function getUsdBrlRate() {
  const cached = cacheGet(KEY);
  if (cached) return { ...withTourism(cached), cached: true };

  const errors = [];
  for (const src of SOURCES) {
    try {
      const rate = withTourism(await fetchFrom(src));
      cacheSet(KEY, rate, RATE_TTL);
      cacheSet(LAST_KEY, { ...rate, fetchedAt: Date.now() }, 24 * 60 * 365); // 1 ano: é o "último conhecido"
      return { ...rate, cached: false };
    } catch (err) {
      errors.push(err.message);
    }
  }

  // todas as fontes falharam → último câmbio conhecido (stale), se não for velho demais
  const last = cacheGet(LAST_KEY);
  if (last && Date.now() - (last.fetchedAt || 0) < STALE_MAX_MS) {
    const { fetchedAt, ...rate } = last;
    return { ...withTourism(rate), cached: true, stale: true, staleSince: new Date(fetchedAt).toISOString(), errors };
  }

  if (FALLBACK) {
    return withTourism({ pair: 'USD-BRL', bid: FALLBACK, ask: FALLBACK, high: null, low: null, timestamp: new Date().toISOString(), source: 'fallback-env', cached: false, stale: true, errors });
  }

  const err = new Error(`Cotação indisponível: ${errors.join(' | ')}`);
  err.status = 502;
  throw err;
}

/** Converte um preço USD para BRL aplicando a margem configurada. */
export function convertPrice(usd, rate) {
  if (usd == null || Number.isNaN(Number(usd))) return null;
  const base = Number(usd) * rate.ask;
  const final = base * (1 + MARGIN / 100);
  return {
    usd: Number(usd),
    brl: Math.round(base * 100) / 100,
    brlWithMargin: Math.round(final * 100) / 100,
    marginPercent: MARGIN,
    rateUsed: rate.ask,
  };
}
