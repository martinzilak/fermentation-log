import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { keepUnits } from './caps.tsx';

/** The parts of a string after keepUnits, units marked with brackets. */
function parts(text: string): string {
  const out = keepUnits(text) as unknown[];
  return out
    .flat()
    .map((p) => (isValidElement(p) ? `[${(p as ReactElement<{ children: string }>).props.children}]` : String(p)))
    .join('');
}

describe('keepUnits', () => {
  it('keeps units after a number in their case', () => {
    expect(parts('plan 600 g')).toBe('plan 600 [g]');
    expect(parts('−148 g · −25 %')).toBe('−148 [g] · −25 %');
    expect(parts('1.5 kg and 250 ml')).toBe('1.5 [kg] and 250 [ml]');
    expect(parts('Save pH')).toBe('Save [pH]');
  });

  it('leaves words that only start like a unit', () => {
    expect(parts('Weigh the rest (7 left)')).toBe('Weigh the rest (7 left)');
    expect(parts('3 green jars')).toBe('3 green jars');
  });
});
