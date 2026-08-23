import { expect, test, describe } from 'vitest';
import { convertUsToBr, parseUsSizes, sizeGroupsOf, sizeLabel, sizeLabelBr, standardSizes } from '../src/sizes/index.js';

describe("feminino acima de W 12 (bug: tamanho repetido no seletor)", () => {
  test("W 12.5–16 convertem para BR aproximado, sem repetir e sempre crescendo", () => {
    // Air Jordan 1 Mid SE feminino vai até W 15.5 — antes, brSize saía null e o chip mostrava "12.5 · US W 12.5"
    const seq = ["12", "12.5", "13", "13.5", "14", "14.5", "15", "15.5", "16"];
    let prev = 0;
    const seen = new Set();
    for (const us of seq) {
      const { brSize, approximate } = convertUsToBr(us, `W ${us}`, ["WOMEN"]);
      expect(brSize, `W ${us}`).not.toBeNull();
      expect(brSize, `W ${us}`).toBeGreaterThan(prev);
      expect(seen.has(brSize), `W ${us} repetiu BR ${brSize}`).toBe(false);
      seen.add(brSize);
      prev = brSize;
      expect(approximate, `W ${us}`).toBe(us !== "12"); // só o 12 é da tabela oficial
    }
  });

  test("W 4 e W 4.5 (abaixo da tabela oficial) também ganham BR aproximado", () => {
    expect(convertUsToBr("4", "W 4", ["WOMEN"])).toEqual({ brSize: 32.5, approximate: true });
    expect(convertUsToBr("4.5", "W 4.5", ["WOMEN"])).toEqual({ brSize: 33, approximate: true });
    expect(convertUsToBr("5", "W 5", ["WOMEN"])).toEqual({ brSize: 33.5, approximate: false });
  });

  test("W 16.5–19.5 (unissex listado na escala feminina, ex. Sabrina 'W 16.5 / M 15') também ganham BR — nenhum chip fica sem número", () => {
    // antes: M 15 / 17 / 18 apareciam só como "US M 15" no seletor, porque W 16.5 / 18.5 / 19.5 não tinham BR
    expect(convertUsToBr("16.5", "W 16.5 / M 15", ["MEN", "WOMEN"])).toEqual({ brSize: 48.5, approximate: true });
    expect(convertUsToBr("18.5", "W 18.5 / M 17", ["MEN", "WOMEN"])).toEqual({ brSize: 50.5, approximate: true });
    expect(convertUsToBr("19.5", "W 19.5 / M 18", ["MEN", "WOMEN"])).toEqual({ brSize: 51.5, approximate: true });
    let prev = 0;
    for (const us of ["16", "16.5", "17", "17.5", "18", "18.5", "19", "19.5"]) {
      const { brSize } = convertUsToBr(us, `W ${us}`, ["WOMEN"]);
      expect(brSize, `W ${us}`).toBeGreaterThan(prev);
      prev = brSize;
    }
  });

  test("rótulo completo para o tamanho grande feminino", () => {
    const { scale, us } = parseUsSizes("13", "W 13 / M 11.5", ["WOMEN"]);
    const { brSize } = convertUsToBr("13", "W 13 / M 11.5", ["WOMEN"]);
    expect(sizeLabel({ brLabel: String(brSize), brSize, scale, us }, "W")).toBe("BR 44 (US W 13)");
    expect(sizeLabel({ brLabel: String(brSize), brSize, scale, us }, "M")).toBe("BR 44 (US M 11.5)");
  });
});

describe('convertUsToBr', () => {
  test('converte MENS exato (prefixo M)', () => {
    expect(convertUsToBr('10.5', 'M 10.5 / W 12')).toEqual({ brSize: 42.5, approximate: false });
    expect(convertUsToBr('3.5', 'M 3.5 / W 5')).toEqual({ brSize: 34, approximate: false });
    expect(convertUsToBr('13', 'M 13')).toEqual({ brSize: 46, approximate: false });
  });

  test('converte MENS aproximado (prefixo M)', () => {
    expect(convertUsToBr('13.5', 'M 13.5 / W 15')).toEqual({ brSize: 46.5, approximate: true });
    expect(convertUsToBr('18', 'M 18')).toEqual({ brSize: 51, approximate: true });
  });

  test('converte WOMENS exato (prefixo W)', () => {
    expect(convertUsToBr('5', 'W 5')).toEqual({ brSize: 33.5, approximate: false });
    expect(convertUsToBr('10.5', 'W 10.5 / M 9')).toEqual({ brSize: 41, approximate: false });
    expect(convertUsToBr('12', 'W 12')).toEqual({ brSize: 43, approximate: false });
  });

  test('converte INFANTIL exato e aproximado (sufixo C ou Y, sem prefixo forte)', () => {
    expect(convertUsToBr('10C', null)).toEqual({ brSize: 26, approximate: false });
    expect(convertUsToBr('3.5Y', '3.5Y')).toEqual({ brSize: 34, approximate: false });
    
    // Aproximado
    expect(convertUsToBr('10.5C', null)).toEqual({ brSize: 26.5, approximate: true });
    expect(convertUsToBr('2Y', '2Y')).toEqual({ brSize: 32.5, approximate: true });
  });

  test('fallback via genders', () => {
    // Sem prefixo claro, mas genders tem MEN
    expect(convertUsToBr('10.5', '10.5', ['MEN'])).toEqual({ brSize: 42.5, approximate: false });
    
    // Sem prefixo claro, mas genders tem WOMEN
    expect(convertUsToBr('5', '5', ['WOMEN'])).toEqual({ brSize: 33.5, approximate: false });
    
    // Genders tem BOYS
    expect(convertUsToBr('6Y', '6Y', ['BOYS'])).toEqual({ brSize: 36.5, approximate: false });
  });

  test('retorna null para tamanho inexistente nas tabelas', () => {
    expect(convertUsToBr('20', 'M 20')).toEqual({ brSize: null, approximate: false });
    expect(convertUsToBr('1C', '1C')).toEqual({ brSize: null, approximate: false });
  });

  test('trata falsy safety', () => {
    expect(convertUsToBr(undefined, undefined)).toEqual({ brSize: null, approximate: false });
  });
});


describe('parseUsSizes / sizeGroupsOf / sizeLabel (masculino × feminino × infantil)', () => {
  test('unissex com localizedSize completo', () => {
    expect(parseUsSizes('7', 'M 7 / W 8.5', ['MEN', 'WOMEN'])).toEqual({ scale: 'M', us: { M: '7', W: '8.5' } });
  });
  test('unissex sem W explícito → W = M + 1,5', () => {
    expect(parseUsSizes('10.5', '10.5', ['MEN', 'WOMEN'])).toEqual({ scale: 'M', us: { M: '10.5', W: '12' } });
  });
  test('só masculino / só feminino / infantil', () => {
    expect(parseUsSizes('10', 'M 10', ['MEN'])).toEqual({ scale: 'M', us: { M: '10' } });
    expect(parseUsSizes('8', 'W 8', ['WOMEN'])).toEqual({ scale: 'W', us: { W: '8' } });
    expect(parseUsSizes('5', '5', ['WOMEN'])).toEqual({ scale: 'W', us: { W: '5' } });
    expect(parseUsSizes('5Y', '5Y', ['BOYS'])).toEqual({ scale: 'K', us: { K: '5Y' } });
  });
  test('grupos e rótulo', () => {
    const sizes = [
      { nikeSize: '7', brLabel: '38', scale: 'M', us: { M: '7', W: '8.5' } },
      { nikeSize: '8', brLabel: '39.5', scale: 'M', us: { M: '8', W: '9.5' } }
    ];
    expect(sizeGroupsOf(sizes)).toEqual(['M', 'W']);
    expect(sizeGroupsOf([{ scale: 'W', us: { W: '8' } }])).toEqual(['W']);
    expect(sizeLabel(sizes[0])).toBe('BR 38 (US M 7)');
    expect(sizeLabel(sizes[0], 'W')).toBe('BR 38 (US W 8.5)');
    expect(sizeLabel({ brLabel: '36', scale: 'K', us: { K: '5Y' } })).toBe('BR 36 (US 5Y)');
    expect(sizeLabel({ brLabel: '41', scale: 'M', us: { M: null } })).toBe('BR 41');
  });
});

describe('sizeLabelBr (o que o cliente vê: só o BR)', () => {
  test('tamanho do catálogo → "BR 38"; item de pedido salvo com US → tira o "(US …)"; pronta entrega sem US → "BR 41"', () => {
    expect(sizeLabelBr({ brLabel: '38', scale: 'M', us: { M: '7', W: '8.5' } })).toBe('BR 38');
    expect(sizeLabelBr({ brLabel: '48.5', approximate: true, us: { W: '16.5', M: '15' } })).toBe('BR 48.5');
    expect(sizeLabelBr({ sizeLabel: 'BR 38 (US M 7)' })).toBe('BR 38');
    expect(sizeLabelBr({ sizeLabel: 'BR 36 (US 5Y)', nikeSize: '5Y' })).toBe('BR 36');
    expect(sizeLabelBr({ sizeLabel: 'BR 41 (US 8.5)', nikeSize: '8.5', brLabel: null })).toBe('BR 41'); // pedido antigo
    expect(sizeLabelBr({ brLabel: '41', nikeSize: '41' })).toBe('BR 41');
    expect(sizeLabelBr({ sizeLabel: 'BR M', brLabel: 'M' })).toBe('BR M'); // venda externa com tamanho livre
    expect(sizeLabelBr(null)).toBe('');
    for (const s of standardSizes()) expect(sizeLabelBr(s)).not.toMatch(/US/);
  });
});

describe('standardSizes (Nike By You)', () => {
  test('tabela masculina completa em ordem, com W = M + 1,5 até W 12', () => {
    const list = standardSizes();
    expect(list.map((s) => s.brLabel).slice(0, 5)).toEqual(['34', '34.5', '35', '35.5', '36']);
    expect(list.at(-1)).toMatchObject({ nikeSize: '18', brLabel: '51', approximate: true });
    expect(list.find((s) => s.brLabel === '38')).toMatchObject({ nikeSize: '7', us: { M: '7', W: '8.5' }, synthetic: true, available: true });
    expect(list.find((s) => s.brLabel === '43').us.W).toBeNull(); // M 11 → W 12.5 não existe na tabela feminina
    // acima de 14 a Nike só faz inteiros: nada de 14.5 / 15.5 / 16.5 / 17.5 na lista do By You
    expect(list.map((s) => s.nikeSize).filter((us) => Number(us) > 14)).toEqual(['15', '16', '17', '18']);
  });
});
