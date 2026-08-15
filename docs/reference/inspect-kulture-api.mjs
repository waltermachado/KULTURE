#!/usr/bin/env node
/**
 * inspect-kulture-api.mjs
 * ------------------------------------------------------------
 * Testa a Kulture-api e mostra:
 *   1. o JSON cru retornado
 *   2. um "mapa" de todos os campos encontrados
 *   3. quais campos parecem ser IMAGEM (para responder: as fotos já vêm?)
 *
 * COMO USAR (Node 18+, tem fetch nativo):
 *
 *   # 1. defina a URL base da sua API e (se houver) a chave
 *   export KULTURE_API_URL="https://sua-kulture-api.com"
 *   export KULTURE_API_KEY="sua-chave-se-tiver"     # opcional
 *
 *   # 2. rode passando o termo de busca
 *   node inspect-kulture-api.mjs "kobe 6"
 *
 * Se sua API usar outro caminho de busca (ex.: /api/v1/search),
 * ajuste SEARCH_PATH abaixo.
 * ------------------------------------------------------------
 */

const BASE = process.env.KULTURE_API_URL;
const KEY  = process.env.KULTURE_API_KEY || '';
const SEARCH_PATH = '/search';          // ajuste se a rota for diferente
const QUERY_PARAM = 'q';                // ajuste se o parâmetro não for ?q=
const termo = process.argv[2] || 'kobe 6';

// palavras que indicam que um campo é imagem
const IMG_HINTS = ['image', 'img', 'photo', 'foto', 'picture', 'thumb', 'thumbnail', 'media', 'src', 'url'];
// extensões/padrões que denunciam uma URL de imagem
const IMG_URL_RE = /\.(png|jpe?g|webp|avif|gif)(\?|$)/i;

if (!BASE) {
  console.error('❌  Defina a variável KULTURE_API_URL antes de rodar.');
  console.error('    Ex.: export KULTURE_API_URL="https://sua-kulture-api.com"');
  process.exit(1);
}

const url = `${BASE.replace(/\/$/, '')}${SEARCH_PATH}?${QUERY_PARAM}=${encodeURIComponent(termo)}`;
console.log(`\n🔎  Buscando: ${url}\n`);

const headers = { 'Accept': 'application/json' };
if (KEY) headers['Authorization'] = `Bearer ${KEY}`;   // ajuste se o header for outro (ex.: x-api-key)

const imageFindings = [];

// caminha recursivamente pelo objeto procurando campos de imagem
function walk(node, path = '') {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      const keyLooksImg = IMG_HINTS.some(h => k.toLowerCase().includes(h));
      const valLooksImg = typeof v === 'string' && (IMG_URL_RE.test(v) || (keyLooksImg && v.startsWith('http')));
      if (valLooksImg) imageFindings.push({ campo: p, valor: v });
      walk(v, p);
    }
  }
}

// lista todos os nomes de campo únicos (para ver a "cara" do produto)
function fieldMap(node, set = new Set(), path = '') {
  if (node && typeof node === 'object') {
    if (Array.isArray(node)) {
      if (node.length) fieldMap(node[0], set, `${path}[]`);
    } else {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k;
        set.add(`${p}  (${Array.isArray(v) ? 'array' : typeof v})`);
        fieldMap(v, set, p);
      }
    }
  }
  return set;
}

try {
  const res = await fetch(url, { headers });
  console.log(`📡  HTTP ${res.status} ${res.statusText}\n`);
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); }
  catch {
    console.log('⚠️  Resposta não é JSON. Conteúdo cru (primeiros 800 chars):\n');
    console.log(text.slice(0, 800));
    process.exit(0);
  }

  // pega o primeiro produto como amostra (cobre formatos comuns)
  const lista = Array.isArray(data) ? data
    : data.products || data.results || data.data || data.items || [data];
  const amostra = Array.isArray(lista) ? lista[0] : lista;

  console.log('════════ 1) AMOSTRA (primeiro produto, JSON cru) ════════\n');
  console.log(JSON.stringify(amostra, null, 2).slice(0, 2000));

  console.log('\n\n════════ 2) MAPA DE CAMPOS ════════\n');
  [...fieldMap(amostra)].sort().forEach(f => console.log('  •', f));

  walk(data);
  console.log('\n\n════════ 3) CAMPOS DE IMAGEM ENCONTRADOS ════════\n');
  if (imageFindings.length) {
    console.log('✅  AS FOTOS JÁ VÊM NO ENDPOINT! Campos:\n');
    // dedup por campo
    const vistos = new Set();
    for (const f of imageFindings) {
      const base = f.campo.replace(/\[\d+\]/g, '[]');
      if (vistos.has(base)) continue;
      vistos.add(base);
      console.log(`  📷 ${base}`);
      console.log(`     ex.: ${f.valor}\n`);
    }
    console.log('➡️  Recomendação: espelhar essas URLs no seu storage (R2/Supabase) durante o cache.');
  } else {
    console.log('❌  Nenhum campo de imagem detectado.');
    console.log('➡️  As fotos NÃO vêm no endpoint. Opções: banco de imagens por styleId');
    console.log('    (KicksDB/Sneaks), ajustar o scraper para capturar imagens, ou download manual.');
  }
  console.log('');
} catch (err) {
  console.error('❌  Erro ao chamar a API:', err.message);
  console.error('    Verifique a URL, a rota de busca (SEARCH_PATH) e a autenticação.');
  process.exit(1);
}
