import { describe, expect, it } from 'vitest';
import {
  bases,
  bottledVolumeMl,
  derive,
  fermentDays,
  heatEstimate,
  localDate,
  netWeight,
  saltPct,
  suggestedSaltG,
  xanthanPct,
  type CalcLine,
  type CalcStep,
} from './calc.ts';
import type { Kind } from './schemas.ts';

const TZ = 'Europe/Bratislava';

function line(name: string, kind: Kind, grams: number | null, shu?: number | [number | null, number | null]): CalcLine {
  const [shu_min, shu_max] = shu === undefined ? [null, null] : Array.isArray(shu) ? shu : [shu, shu];
  return { name, kind, grams, shu_min, shu_max };
}

// seed/batch-004.md
const batch4: CalcStep[] = [
  {
    type: 'ferment',
    position: 0,
    date: '2025-12-18',
    lines: [
      line('Cherry Bomb', 'pepper', 40, [2500, 5000]),
      line('Sparkler', 'pepper', 29, [null, 160000]),
      line('Habanero Yellow', 'pepper', 163, [100000, 350000]),
      line('Jalapeño Maylon', 'pepper', 308, [4000, 8500]),
      line('Cesnak', 'aromatic', 28),
      line('Mrkva', 'vegetable', 217),
      line('Červená cibuľa', 'vegetable', 281),
      line('Jablko Gala', 'fruit', 223),
      line('Voda', 'water', 1502),
      line('Soľ', 'salt', 83),
    ],
  },
  {
    type: 'blend',
    position: 1,
    date: null,
    lines: [
      line('Mash', 'mash', 1340),
      line('Brine', 'brine', 507),
      line('Jablčný ocot', 'acid', 125),
      line('Ocot kvasný liehový 8 %', 'acid', 60),
      line('Med', 'sweetener', 19),
      line('Xantanová guma', 'thickener', 0.86),
    ],
  },
];
const bottled4 = [{ type: 'bottled' as const, occurred_at: '2026-01-06T12:00:00.000Z', payload: { fills: [] } }];

describe('bases', () => {
  it('splits ferment-step lines into peppers, solids and ferment_total', () => {
    expect(bases(batch4)).toEqual({
      peppers: 540,
      solids: 1289,
      ferment_total: 2791,
      mash: 1340,
      sauce: 2051.86,
    });
  });
});

describe('salt', () => {
  it('is salt / ferment_total', () => {
    expect(saltPct(batch4)!.toFixed(2)).toBe('2.97');
  });
  it('suggests salt for the target percentage', () => {
    expect(suggestedSaltG(batch4, 3)).toBeCloseTo(83.73, 2);
  });
  it('is null without a ferment step or ferment additions', () => {
    expect(saltPct([batch4[1]!])).toBeNull();
    expect(saltPct([{ type: 'ferment', position: 0, date: null, lines: [line('Soľ', 'salt', 10)] }])).toBeNull();
  });
});

describe('fermentDays', () => {
  it('falls back to the bottled event date', () => {
    expect(fermentDays(batch4, bottled4, TZ)).toBe(19);
  });
  it('prefers the first later step that has a date', () => {
    const steps = [batch4[0]!, { ...batch4[1]!, date: '2026-01-01' }];
    expect(fermentDays(steps, bottled4, TZ)).toBe(14);
  });
  it('is null while nothing ends the ferment', () => {
    expect(fermentDays(batch4, [], TZ)).toBeNull();
  });
  it('uses the local date of the bottled timestamp', () => {
    // 23:30 UTC on Jan 5 is already Jan 6 in Bratislava.
    expect(localDate('2026-01-05T23:30:00Z', TZ)).toBe('2026-01-06');
  });
});

describe('xanthan', () => {
  it('is thickener / sauce additions, batch 4 ≈ 0.042 %', () => {
    expect(xanthanPct(batch4)!.toFixed(3)).toBe('0.042');
  });
  it('is only shown when the sauce includes mash', () => {
    const noMash = [batch4[0]!, { ...batch4[1]!, lines: batch4[1]!.lines.filter((l) => l.kind !== 'mash') }];
    expect(xanthanPct(noMash)).toBeNull();
  });
});

describe('heatEstimate', () => {
  it('uses minimums for the low end, maximums for the high end, one bound for both', () => {
    const heat = heatEstimate(batch4)!;
    // low: 40·2500 + 29·160000 + 163·100000 + 308·4000 = 22 272 000
    // high: 40·5000 + 29·160000 + 163·350000 + 308·8500 = 64 508 000
    expect(heat.low).toBeCloseTo(22_272_000 / 1289, 6);
    expect(heat.high).toBeCloseTo(64_508_000 / 1289, 6);
    expect(heat.unknown).toEqual([]);
  });
  it('lists peppers without SHU and counts them as 0', () => {
    const steps: CalcStep[] = [
      {
        type: 'ferment',
        position: 0,
        date: null,
        lines: [line('Kozí roh', 'pepper', 100, 15000), line('Kápia', 'pepper', 100), line('Voda', 'water', 500)],
      },
    ];
    expect(heatEstimate(steps)).toEqual({ low: 7500, high: 7500, unknown: ['Kápia'] });
  });
});

describe('small helpers', () => {
  it('computes net weight from the step tare', () => {
    expect(netWeight(4200, 1669)).toBe(2531);
    expect(netWeight(4200, null)).toBeNull();
  });
  it('sums bottled volume over the fills', () => {
    const volumes: Record<string, number> = { a: 150, b: 250 };
    const payload = { fills: [{ bottle_type_id: 'a', count: 6 }, { bottle_type_id: 'b', count: 2 }] };
    expect(bottledVolumeMl(payload, (id) => volumes[id])).toBe(1400);
  });
});

describe('derive', () => {
  it('counts ferment days so far only while fermenting', () => {
    const opts = { timeZone: TZ, today: '2025-12-25', targetSaltPct: 3, volumeMl: () => undefined };
    expect(derive(batch4, [], 'fermenting', opts).ferment_day).toBe(7);
    expect(derive(batch4, bottled4, 'bottled', opts).ferment_day).toBeNull();
  });
});
