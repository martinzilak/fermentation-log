import { describe, expect, it } from 'vitest';
import { heatLevel } from './heat.ts';

describe('heat level', () => {
  it('takes the middle of the range', () => {
    expect(heatLevel(0, 0)).toBeNull();
    expect(heatLevel(500, 1_000)).toEqual({ pips: 1, word: 'mild' });
    expect(heatLevel(4_000, 7_000)).toEqual({ pips: 3, word: 'medium' });
    expect(heatLevel(12_000, 12_000)).toEqual({ pips: 3, word: 'medium' });
    expect(heatLevel(40_000, 60_000)).toEqual({ pips: 5, word: 'veryHot' });
  });
});
