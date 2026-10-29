import { describe, expect, it } from 'vitest';
import { autoStatus } from './status.ts';

const ferment = (date: string | null) => ({ type: 'ferment' as const, position: 0, date });
const blend = (date: string | null, position = 1) => ({ type: 'blend' as const, position, date });

describe('autoStatus', () => {
  it('is planned until the ferment step has a date', () => {
    expect(autoStatus([], [])).toBe('planned');
    expect(autoStatus([ferment(null)], [])).toBe('planned');
  });
  it('is fermenting once the ferment step has a date', () => {
    expect(autoStatus([ferment('2026-10-01'), blend(null)], [])).toBe('fermenting');
  });
  it('is processing once a later step has a date', () => {
    expect(autoStatus([ferment('2026-10-01'), blend('2026-10-20')], [])).toBe('processing');
  });
  it('ignores dated steps before the ferment step', () => {
    const steps = [{ type: 'other' as const, position: 0, date: '2026-09-30' }, { ...ferment('2026-10-01'), position: 1 }];
    expect(autoStatus(steps, [])).toBe('fermenting');
  });
  it('is bottled after a bottled event', () => {
    expect(autoStatus([ferment('2026-10-01'), blend(null)], [{ type: 'bottled' }])).toBe('bottled');
  });
});
