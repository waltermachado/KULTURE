import { expect, test, describe } from 'vitest';
import { convertUsToBr, parseUsSizes, sizeGroupsOf, sizeLabel, standardSizes } from '../src/sizes/index.js';

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

describe('standardSizes (Nike By You)', () => {
  test('tabela masculina completa em ordem, com W = M + 1,5 até W 12', () => {
    const list = standardSizes();
    expect(list.map((s) => s.brLabel).slice(0, 5)).toEqual(['34', '34.5', '35', '35.5', '36']);
    expect(list.at(-1)).toMatchObject({ nikeSize: '18', brLabel: '51', approximate: true });
    expect(list.find((s) => s.brLabel === '38')).toMatchObject({ nikeSize: '7', us: { M: '7', W: '8.5' }, synthetic: true, available: true });
    expect(list.find((s) => s.brLabel === '43').us.W).toBeNull(); // M 11 → W 12.5 não existe na tabela feminina
  });
});
