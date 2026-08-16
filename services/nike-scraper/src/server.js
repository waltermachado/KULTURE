import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { searchProducts, normalizeCount, getProductSizes } from './services/nike.js';
import { getUsdBrlRate, convertPrice } from './services/currency.js';
import { cacheStats } from './cache.js';

const app = express();
const PORT = process.env.PORT || 3001;

const origins = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json());

// --- Health ---------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'kulture-api', cache: cacheStats() });
});

// --- Cotação USD-BRL --------------------------------------------------------
app.get('/rate', async (_req, res) => {
  try {
    const rate = await getUsdBrlRate();
    res.json(rate);
  } catch (err) {
    res.status(502).json({ error: 'Falha ao obter cotação', detail: err.message });
  }
});

// --- Busca de produtos ------------------------------------------------------
// GET /search?q=jordan&count=24&anchor=0&convert=true
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Parâmetro "q" é obrigatório' });

  const count = normalizeCount(req.query.count); // Nike só aceita 24 | 50 | 100
  const anchor = Number(req.query.anchor) || 0;
  const convert = req.query.convert !== 'false'; // converte por padrão

  try {
    const result = await searchProducts(q, { count, anchor });

    if (convert) {
      try {
        const rate = await getUsdBrlRate();
        result.rate = { ask: rate.ask, timestamp: rate.timestamp };
        result.products = result.products.map((p) => ({
          ...p,
          price: convertPrice(p.priceUsd, rate),
        }));
      } catch {
        // sem cotação, devolve só USD — o site decide o que fazer
        result.rateError = 'Cotação indisponível no momento; preços apenas em USD';
      }
    }

    res.json(result);
  } catch (err) {
    const status = err.status === 403 || err.status === 429 ? 503 : 502;
    res.status(status).json({
      error: 'Falha ao buscar na Nike US',
      detail: err.message,
      hint:
        err.status === 403
          ? 'A Nike pode ter bloqueado o endpoint/headers. Verifique NIKE_SEARCH_URL e NIKE_CALLER_ID no .env (veja o README).'
          : undefined,
    });
  }
});

// --- Detalhes do produto e tamanhos ------------------------------------------
app.get('/product/:styleColor', async (req, res) => {
  const { styleColor } = req.params;
  try {
    const product = await getProductSizes(styleColor);
    res.json(product);
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message, code: err.code });
    }
    const status = err.status === 403 || err.status === 429 ? 503 : 502;
    res.status(status).json({
      error: 'Falha ao buscar produto na Nike US',
      detail: err.message
    });
  }
});

// Sem host → Node escuta em todas as interfaces ("::" = IPv4 + IPv6). No Railway a rede
// privada é IPv6, então a api alcança este serviço em http://<serviço>.railway.internal:PORT.
const server = app.listen(PORT, () => {
  const addr = server.address();
  const bind = typeof addr === 'string' ? addr : `[${addr.address}]:${addr.port}`;
  const priv = process.env.RAILWAY_PRIVATE_DOMAIN;
  console.log(`nike-scraper escutando em ${bind}` + (priv ? ` · rede privada: http://${priv}:${PORT}` : ` · local: http://localhost:${PORT}`));
  console.log(`Margem configurada: ${process.env.MARGIN_PERCENT || 0}%`);
});
