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
export function convertUsToBr(nikeSize, localizedSize, genders = []) {
  if (!nikeSize) return { brSize: null, approximate: false };

  let scale = null; // 'M', 'W', 'K'
  const loc = localizedSize ? localizedSize.trim().toUpperCase() : '';

  if (loc.startsWith('M ')) scale = 'M';
  else if (loc.startsWith('W ')) scale = 'W';
  else if (nikeSize.endsWith('C') || nikeSize.endsWith('Y')) scale = 'K';
  else if (genders.includes('MEN') && !genders.includes('WOMEN')) scale = 'M';
  else if (genders.includes('WOMEN') && !genders.includes('MEN')) scale = 'W';
  else if (genders.includes('BOYS') || genders.includes('GIRLS')) scale = 'K';
  else scale = 'M'; // Fallback final (maioria dos unisex / mens)

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
