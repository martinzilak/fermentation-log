import { describe, expect, it } from 'vitest';
import { appendKey, formatShuRange, parseDecimal } from './numbers.ts';
import { phLevel, phText } from './ph.ts';
import { cleanName } from '../../shared/names.ts';
import { IDLE_LIMIT, SEARCH_LIMIT, suggest, type Sources } from './suggest.ts';

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

const VINEGAR = 'Spirit vinegar 8 %';
const sources: Sources = {
  recent: [
    { name: 'Garlic', kind: 'aromatic', catalog_id: 'c-garlic', variety_id: null, step_types: ['blend'] },
    { name: 'Salt', kind: 'salt', catalog_id: 'c-salt', variety_id: null, step_types: ['ferment'] },
    { name: 'Sparkler', kind: 'pepper', catalog_id: null, variety_id: 'v-sparkler', step_types: ['ferment'] },
    { name: VINEGAR, kind: 'acid', catalog_id: 'c-vinegar', variety_id: null, step_types: ['blend'] },
  ],
  catalog: [
    { id: 'c-garlic', name: 'Garlic', kind: 'aromatic', aliases: ['Cesnak'] },
    { id: 'c-salt', name: 'Salt', kind: 'salt', aliases: ['Soľ'] },
    { id: 'c-vinegar', name: VINEGAR, kind: 'acid', aliases: ['Ocot kvasný liehový 8 %', 'ocot'] },
  ],
  varieties: [
    { id: 'v-sparkler', name: 'Sparkler', species: null, aliases: [], local_names: ['špicaté'], shu_min: null, shu_max: 160000 },
    { id: 'v-habanero', name: 'Habanero Yellow', species: null, aliases: [], local_names: [], shu_min: null, shu_max: null },
    { id: 'v-jalapeno', name: 'Jalapeño Red', species: null, aliases: ['Jalapeno červené'], local_names: [], shu_min: null, shu_max: null },
  ],
};
const names = (query: string, stepType?: 'ferment' | 'blend') => suggest(query, sources, stepType).options.map((s) => s.name);

describe('ingredient suggestions', () => {
  it('offers the entries this step type usually takes first, once each', () => {
    expect(names('', 'ferment')).toEqual(['Salt', 'Sparkler', 'Garlic', VINEGAR, 'Habanero Yellow', 'Jalapeño Red']);
    expect(names('', 'blend')).toEqual(['Garlic', VINEGAR, 'Salt', 'Sparkler', 'Habanero Yellow', 'Jalapeño Red']);
  });

  it('shows only a few chips before anything is typed', () => {
    const many: Sources = {
      ...sources,
      recent: Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}`, kind: 'other' as const, catalog_id: `c-${i}`, variety_id: null, step_types: [] })),
    };
    expect(suggest('', many).options).toHaveLength(IDLE_LIMIT);
    expect(suggest('item', many).options).toHaveLength(SEARCH_LIMIT);
  });

  it('ignores case and accents, and knows when the name already exists', () => {
    expect(names('SALT')).toEqual(['Salt']);
    expect(suggest('jalapeno red', sources).exact).toBe(true);
    expect(suggest('sa', sources).exact).toBe(false);
  });

  it('matches the kind as well as the name', () => {
    expect(names('aromatic')).toEqual(['Garlic']);
    expect(names('pepper')).toEqual(['Sparkler', 'Habanero Yellow', 'Jalapeño Red']);
  });

  it('resolves a typed alias, catalog or variety, to the entry and keeps the original in the note', () => {
    const { options, exact } = suggest('Ocot', sources);
    expect(exact).toBe(true);
    expect(options[0]).toMatchObject({ name: VINEGAR, kind: 'acid', catalog_id: 'c-vinegar', note: "recorded as 'Ocot'" });
    expect(suggest('sol', sources).options[0]).toMatchObject({ name: 'Salt', note: "recorded as 'sol'" });
    expect(suggest('jalapeno cervene', sources).options[0]).toMatchObject({ variety_id: 'v-jalapeno', note: "recorded as 'jalapeno cervene'" });
    expect(suggest('kvas', sources).options[0]).toMatchObject({ name: VINEGAR, note: null });
  });

  it('puts exact and prefix matches before matches inside a name', () => {
    expect(names('h')).toEqual(['Habanero Yellow', VINEGAR]);
  });

  it('tidies a new name: single spaces and a capital first letter', () => {
    expect(cleanName('  voda   z  vodovodu ')).toBe('Voda z vodovodu');
    expect(cleanName('ľutovka')).toBe('Ľutovka');
  });
});
