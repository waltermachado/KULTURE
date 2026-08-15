// Cotação USD-BRL via AwesomeAPI (gratuita, sem chave) com cache e margem.
import { cacheGet, cacheSet } from '../cache.js';

const RATE_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
const RATE_TTL = Number(process.env.RATE_CACHE_TTL_MIN || 60);
const MARGIN = Number(process.env.MARGIN_PERCENT || 0);

export async function getUsdBrlRate() {
  const cached = cacheGet('rate:USD-BRL');
  if (cached) return { ...cached, cached: true };

  const res = await fetch(RATE_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`AwesomeAPI respondeu ${res.status}`);
  const data = await res.json();
  const quote = data.USDBRL;

  const rate = {
    pair: 'USD-BRL',
    bid: Number(quote.bid),
    ask: Number(quote.ask),
    high: Number(quote.high),
    low: Number(quote.low),
    timestamp: quote.create_date,
    source: 'economia.awesomeapi.com.br',
  };
  cacheSet('rate:USD-BRL', rate, RATE_TTL);
  return { ...rate, cached: false };
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
