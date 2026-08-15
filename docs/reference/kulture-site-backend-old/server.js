/**
 * server.js — BFF do Kulture-site (camada 2)
 * ------------------------------------------------------------
 * Fica ENTRE o navegador e a kulture-api. A kulture-api já faz
 * busca na Nike, cache e conversão de preço; este BFF adiciona
 * só o que ela NÃO faz:
 *   - espelha as imagens no nosso storage (permanente, nunca expira)
 *   - monta o "top 8" da home (a API só tem /search)
 *   - pré-aquece o top 8 de hora em hora
 *   - stale-while-revalidate + single-flight
 *
 * Rotas para o navegador:
 *   GET /api/products/top8
 *   GET /api/search?q=
 *   GET /api/product/:termo
 *   GET /media/produtos/...   (imagens espelhadas)
 * ------------------------------------------------------------
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrFetch, normalizeQuery, stats } from './cache.js';
import { ensureImages, STORAGE_DIR } from './images.js';
import { searchLive, productLive, TOP8_SLUGS } from './kultureApi.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// imagens espelhadas (permanentes)
app.use('/media/produtos', express.static(STORAGE_DIR));

// serve o site na MESMA origem (sem CORS). Aponta para ../Kulture-site
const SITE_DIR = process.env.SITE_DIR || path.resolve(__dirname, '..', 'Kulture-site');
app.use(express.static(SITE_DIR));

/**
 * Converte um produto da kulture-api para o contrato do site,
 * espelhando a imagem no nosso storage (permanente).
 * NÃO reconverte preço — usamos o que a API já calculou.
 */
async function toSiteProduct(raw){
  // a kulture-api devolve UMA imagem por produto (campo `image`)
  const origem = raw.image ? [raw.image] : [];
  const imagens = await ensureImages(raw.styleColor || raw.id || 'sem-id', origem);
  return {
    slug: normalizeQuery(raw.name || raw.styleColor || ''),
    nome: raw.name,
    subtitulo: raw.subtitle,
    marca: (raw.name || '').toLowerCase().includes('jordan') ? 'Jordan' : 'Nike Basketball',
    styleColor: raw.styleColor,
    cor: raw.colorDescription,
    precoUSD: raw.priceUsd,
    precoBRL: raw.price?.brlWithMargin ?? raw.price?.brl ?? null,  // já vem pronto da API
    precoCheioBRL: raw.onSale && raw.fullPriceUsd && raw.price?.rateUsed
      ? Math.round(raw.fullPriceUsd * raw.price.rateUsed * (1 + (raw.price.marginPercent||0)/100) * 100)/100
      : null,
    emPromocao: Boolean(raw.onSale),
    imagens,                    // apontam para o nosso storage (permanente)
    imagemOrigem: origem,
    urlNike: raw.url,
    cachedAt: new Date().toISOString(),
  };
}

/* ---------- ROTAS ---------- */

app.get('/api/search', async (req, res) => {
  const termo = normalizeQuery(req.query.q);
  if (!termo) return res.status(400).json({ erro: 'informe ?q=' });
  try {
    const { value, cached, stale } = await getOrFetch(`search:${termo}`, async () => {
      const brutos = await searchLive(req.query.q);
      return Promise.all(brutos.map(toSiteProduct));
    });
    res.json({ termo, cached, stale, total: value.length, produtos: value });
  } catch (err) {
    res.status(502).json({ erro: 'kulture-api indisponível', detalhe: err.message });
  }
});

app.get('/api/product/:termo', async (req, res) => {
  const termo = normalizeQuery(req.params.termo);
  try {
    const { value, cached, stale } = await getOrFetch(`product:${termo}`, async () => {
      const bruto = await productLive(req.params.termo.replace(/-/g,' '));
      return bruto ? toSiteProduct(bruto) : null;
    });
    if (!value) return res.status(404).json({ erro: 'produto não encontrado' });
    res.json({ cached, stale, produto: value });
  } catch (err) {
    res.status(502).json({ erro: 'kulture-api indisponível', detalhe: err.message });
  }
});

app.get('/api/products/top8', async (req, res) => {
  try {
    const { value, cached } = await getOrFetch('top8', montarTop8);
    res.json({ cached, total: value.length, produtos: value });
  } catch (err) {
    res.status(502).json({ erro: 'kulture-api indisponível', detalhe: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, cache: stats() }));

/* ---------- top 8: busca cada modelo pelo nome ---------- */
async function montarTop8(){
  const resultados = await Promise.all(TOP8_SLUGS.map(async termo => {
    try {
      const p = await productLive(termo);
      return p ? await toSiteProduct(p) : null;
    } catch { return null; }
  }));
  return resultados.filter(Boolean);
}

async function preaquecerTop8(){
  try {
    const produtos = await montarTop8();
    await getOrFetch('top8', async () => produtos);
    console.log(`[cron] top8 pré-aquecido (${produtos.length} produtos)`);
  } catch (err) {
    console.warn('[cron] falha ao pré-aquecer top8:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`Kulture-site backend em http://localhost:${PORT}`);
  console.log(`Consumindo kulture-api em ${process.env.KULTURE_API_URL || 'http://localhost:3001'}`);
  preaquecerTop8();
  setInterval(preaquecerTop8, 60 * 60 * 1000);
});
