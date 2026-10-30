// Heat in words and five pips (SPEC §15.12), from the middle of the estimated
// SHU range of the sauce. The steps are rough on purpose: the estimate is too.
const STEPS = [1_500, 5_000, 15_000, 50_000] as const;
export const HEAT_WORDS = ['mild', 'warm', 'medium', 'hot', 'veryHot'] as const;
export type HeatWord = (typeof HEAT_WORDS)[number];

/** 1–5 pips and their word, or null when nothing is known. */
export function heatLevel(low: number, high: number): { pips: number; word: HeatWord } | null {
  if (high <= 0) return null;
  const mid = (low + high) / 2;
  const pips = STEPS.filter((s) => mid >= s).length + 1;
  return { pips, word: HEAT_WORDS[pips - 1]! };
}
