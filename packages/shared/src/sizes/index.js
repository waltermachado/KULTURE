/**
 * Tabelas oficiais de conversão de tamanhos da Nike (US -> BR)
 * Fonte: https://static.nike.com.br/web/prd/tabela-de-medidas.html
 * 
 * Atenção: NÃO converta W->M antes de aplicar a tabela.
 * Exemplo: US M 3.5 = 34; US W 5 = 33.5.
 */

const MENS_TABLE = {
  '3.5': 34, '4': 34.5, '4.5': 35, '5': 35.5, '5.5': 36, '6': 37, '6.5': 37.5,
  '7': 38, '7.5': 39, '8': 39.5, '8.5': 40, '9': 40.5, '9.5': 41, '10': 42,
  '10.5': 42.5, '11': 43, '11.5': 43.5, '12': 44, '12.5': 45, '13': 46
};
const MENS_APPROX = {
  '13.5': 46.5, '14': 47, '15': 48, '16': 49, '17': 50, '18': 51
};

const WOMENS_TABLE = {
  '5': 33.5, '5.5': 34, '6': 35, '6.5': 35.5, '7': 36, '7.5': 37, '8': 37.5,
  '8.5': 38, '9': 39, '9.5': 39.5, '10': 40, '10.5': 41, '11': 41.5, '11.5': 42, '12': 43
};
const WOMENS_APPROX = {}; // Sem aproximações oficiais listadas

const KIDS_TABLE = {
  '2C': 16, '3C': 17.5, '4C': 18.5, '5C': 20, '6C': 21, '7C': 22.5, '8C': 24,
  '9C': 25, '10C': 26, '11C': 27, '11.5C': 28, '12.5C': 29, '13C': 30,
  '1Y': 31, '1.5Y': 32, '2.5Y': 33, '3.5Y': 34, '4.5Y': 35, '5.5Y': 36,
  '6Y': 36.5, '6.5Y': 37, '7Y': 38
};
const KIDS_APPROX = {
  '10.5C': 26.5, '12C': 28.5, '13.5C': 30.5, '2Y': 32.5, '3Y': 33.5, '4Y': 34.5, '5Y': 35.5
};

/**
 * Converte um tamanho da Nike (US) para a numeração Brasileira.
 * @param {string} nikeSize - O tamanho US (ex: "10.5", "6Y")
 * @param {string} localizedSize - O tamanho localizado (ex: "M 10.5 / W 12")
 * @param {Array<string>} genders - Gêneros do produto (ex: ["MEN", "WOMEN"])
 * @returns {{brSize: number|null, approximate: boolean}} O tamanho BR e se é aproximado.
 */
/**
 * Escala usada pela Nike para o `nikeSize` deste SKU: 'M' (masculino), 'W' (feminino) ou 'K' (infantil).
 * Mesma precedência de sempre: prefixo do localizedSize > sufixo C/Y > gênero do produto > M.
 */
export function detectScale(nikeSize, localizedSize, genders = []) {
  const size = String(nikeSize ?? '').trim().toUpperCase();
  const loc = localizedSize ? String(localizedSize).trim().toUpperCase() : '';
  if (loc.startsWith('M ')) return 'M';
  if (loc.startsWith('W ')) return 'W';
  if (size.endsWith('C') || size.endsWith('Y')) return 'K';
  if (genders.includes('MEN') && !genders.includes('WOMEN')) return 'M';
  if (genders.includes('WOMEN') && !genders.includes('MEN')) return 'W';
  if (genders.includes('BOYS') || genders.includes('GIRLS')) return 'K';
  return 'M'; // fallback (maioria dos unissex / masculinos)
}

const fmtUs = (n) => (Number.isFinite(n) ? String(Math.round(n * 2) / 2).replace(/\.0$/, '') : null);

/**
 * Números US por gênero de um tamanho da Nike, para mostrar "US M 7 / US W 8.5" em vez de um "US 7" ambíguo.
 *   localizedSize "M 7 / W 8.5" → { scale:'M', us:{ M:'7', W:'8.5' } }
 *   "W 8"                       → { scale:'W', us:{ W:'8' } }
 *   "10.5" + genders [MEN,WOMEN] → { scale:'M', us:{ M:'10.5', W:'12' } }   (unissex sem W explícito: W = M + 1,5)
 *   "5Y"                        → { scale:'K', us:{ K:'5Y' } }
 * @returns {{ scale: 'M'|'W'|'K', us: { M?: string, W?: string, K?: string } }}
 */
export function parseUsSizes(nikeSize, localizedSize, genders = []) {
  const scale = detectScale(nikeSize, localizedSize, genders);
  const us = {};
  const loc = localizedSize ? String(localizedSize).trim().toUpperCase() : '';
  for (const part of loc.split('/')) {
    const p = part.trim();
    let m;
    if ((m = /^M\s*([\d.]+)$/.exec(p))) us.M = m[1];
    else if ((m = /^W\s*([\d.]+)$/.exec(p))) us.W = m[1];
    else if ((m = /^([\d.]+[CY])$/.exec(p))) us.K = m[1];
  }
  const size = String(nikeSize ?? '').trim().toUpperCase();
  if (size && !us[scale]) us[scale] = size;
  const unisex = genders.includes('MEN') && genders.includes('WOMEN');
  if (unisex && scale === 'M' && us.M && !us.W) us.W = fmtUs(Number(us.M) + 1.5);
  if (unisex && scale === 'W' && us.W && !us.M) us.M = fmtUs(Number(us.W) - 1.5);
  return { scale, us };
}

/** Grupos (abas do seletor) presentes numa lista de tamanhos, na ordem M, W, K. */
export function sizeGroupsOf(sizes = []) {
  const set = new Set();
  for (const s of sizes) for (const k of Object.keys(s?.us || {})) if (s.us[k]) set.add(k);
  if (!set.size) for (const s of sizes) if (s?.scale) set.add(s.scale);
  return ['M', 'W', 'K'].filter((k) => set.has(k));
}

export const SIZE_GROUP_LABELS = { M: 'Masculino', W: 'Feminino', K: 'Infantil' };

/** "BR 38 (US M 7)" · "BR 37,5 (US W 8)" · "BR 36 (US 5Y)" · "BR 41" — rótulo completo de um tamanho escolhido. */
export function sizeLabel(size, group = null) {
  if (!size) return '';
  const br = size.brLabel ?? size.brSize ?? '?';
  const g = group && size.us?.[group] ? group : (size.scale && size.us?.[size.scale] ? size.scale : null);
  const usNum = g ? size.us[g] : null;
  if (!usNum) return `BR ${br}`;
  return g === 'K' ? `BR ${br} (US ${usNum})` : `BR ${br} (US ${g} ${usNum})`;
}

export function convertUsToBr(nikeSize, localizedSize, genders = []) {
  if (!nikeSize) return { brSize: null, approximate: false };

  const scale = detectScale(nikeSize, localizedSize, genders);

  let table = {};
  let approxTable = {};

  if (scale === 'W') {
    table = WOMENS_TABLE;
    approxTable = WOMENS_APPROX;
  } else if (scale === 'K') {
    table = KIDS_TABLE;
    approxTable = KIDS_APPROX;
  } else {
    table = MENS_TABLE;
    approxTable = MENS_APPROX;
  }

  if (table[nikeSize] !== undefined) {
    return { brSize: table[nikeSize], approximate: false };
  } else if (approxTable[nikeSize] !== undefined) {
    return { brSize: approxTable[nikeSize], approximate: true };
  }

  return { brSize: null, approximate: false };
}

/**
 * Lista "padrão" de tamanhos para produtos sem SKU na Nike (Nike By You / customizados): toda a tabela masculina,
 * com o US feminino equivalente (M + 1,5, até W 12) para o seletor mostrar as duas modelagens. `synthetic: true`
 * avisa que a disponibilidade não foi consultada — o dono confirma na Nike By You antes de comprar.
 */
export function standardSizes() {
  const rows = [...Object.entries(MENS_TABLE).map(([us, br]) => [us, br, false]), ...Object.entries(MENS_APPROX).map(([us, br]) => [us, br, true])]
    .sort((a, b) => Number(a[0]) - Number(b[0])); // chaves inteiras de objeto vêm antes das decimais → ordena pelo US
  return rows.map(([us, br, approximate]) => {
    const w = Number(us) + 1.5;
    const usW = w <= 12 ? fmtUs(w) : null;
    return {
      nikeSize: us,
      localizedSize: usW ? `M ${us} / W ${usW}` : `M ${us}`,
      brSize: br,
      brLabel: String(br),
      available: true,
      level: 'UNKNOWN',
      approximate,
      scale: 'M',
      us: { M: us, W: usW },
      synthetic: true
    };
  });
}
