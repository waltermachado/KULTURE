import { expect, test, describe } from 'vitest';
import { convertUsToBr } from '../src/sizes/index.js';

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
