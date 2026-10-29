import { describe, expect, it } from 'vitest';
import { appendKey, formatShuRange, parseDecimal } from './numbers.ts';
import { phLevel, phText } from './ph.ts';
import { suggest, varietyFor, type Sources } from './suggest.ts';

const type = (keys: string, opts?: { decimals?: number; maxInt?: number }) =>
  [...keys].reduce((value, key) => appendKey(value, key === '<' ? 'back' : key, opts), '');

describe('numpad input', () => {
  it('builds numbers key by key, with one decimal point and limited decimals', () => {
    expect(type('1669')).toBe('1669');
    expect(type('83.75')).toBe('83.75');
    expect(type('83.759')).toBe('83.75');
    expect(type('8..3')).toBe('8.3');
    expect(type('.5')).toBe('0.5');
    expect(type('007')).toBe('7');
    expect(type('12<3')).toBe('13');
  });

  it('accepts a comma as the decimal key and respects decimals and length limits', () => {
    expect(type('3,9')).toBe('3.9');
    expect(type('3.9', { decimals: 0 })).toBe('39');
    expect(type('1234567')).toBe('123456');
    expect(type('145', { maxInt: 2 })).toBe('14');
  });

  it('parses comma or dot, and nothing typed as null', () => {
    expect(parseDecimal('83,7')).toBe(83.7);
    expect(parseDecimal('83.7')).toBe(83.7);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('0.')).toBe(0);
  });
});

describe('pH display rule (SPEC §7.4)', () => {
  it('splits at 4.6 and 4.0 and always has a text label', () => {
    expect([4.6, 5, 4.59, 4.0, 3.99].map(phLevel)).toEqual(['danger', 'danger', 'warn', 'warn', 'ok']);
    expect(phText(4.6)).toBe('Above 4.6 safety threshold');
    expect(phText(4.2)).toBe('Below 4.6, above common 4.0 target');
    expect(phText(3.5)).toBe('Below 4.0');
  });
});

describe('heat range text', () => {
  it('rounds to two significant digits', () => {
    expect(formatShuRange(17278.5, 50045)).toBe('≈ 17,000–50,000 SHU');
    expect(formatShuRange(30000, 30000)).toBe('≈ 30,000 SHU');
  });
});

const VINEGAR = 'Ocot kvasný liehový 8 %';
const sources: Sources = {
  recent: [
    { name: 'Cesnak', kind: 'aromatic', local_name: null, catalog_id: null, variety_id: null },
    { name: 'Sparkler', kind: 'pepper', local_name: 'špicaté', catalog_id: null, variety_id: 'v-sparkler' },
  ],
  catalog: [{ id: 'c-vinegar', name: VINEGAR, kind: 'acid', aliases: ['ocot'] }],
  varieties: [
    { id: 'v-sparkler', name: 'Sparkler', species: null, local_names: ['špicaté'], shu_min: null, shu_max: 160000 },
    { id: 'v-habanero', name: 'Habanero Yellow', species: null, local_names: [], shu_min: null, shu_max: null },
  ],
};

describe('ingredient suggestions', () => {
  it('lists recent names first, then catalog items and varieties, without duplicates', () => {
    expect(suggest('', sources).map((s) => s.name)).toEqual(['Cesnak', 'Sparkler', VINEGAR, 'Habanero Yellow']);
  });

  it('resolves a typed alias to the canonical name and keeps the original in the note', () => {
    const [hit] = suggest('Ocot', sources);
    expect(hit).toMatchObject({ name: VINEGAR, kind: 'acid', catalog_id: 'c-vinegar', note: "recorded as 'Ocot'" });
    expect(suggest('kvas', sources)[0]).toMatchObject({ name: VINEGAR, note: null });
  });

  it('matches variety local names and records the one typed', () => {
    expect(suggest('špicaté', sources)[0]).toMatchObject({ name: 'Sparkler', local_name: 'špicaté', variety_id: 'v-sparkler' });
    expect(varietyFor('ŠPICATÉ', sources.varieties)?.id).toBe('v-sparkler');
    expect(varietyFor('Carolina Reaper', sources.varieties)).toBeUndefined();
  });

  it('puts prefix matches before matches inside the name', () => {
    expect(suggest('ha', sources).map((s) => s.name)).toEqual(['Habanero Yellow']);
    expect(suggest('h', sources).map((s) => s.name)).toEqual(['Habanero Yellow', VINEGAR]);
  });
});
