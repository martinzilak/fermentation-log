// How recipe lines read (SPEC §7.3): "500 g", "5 % of peppers".
import type { Base } from '../../shared/calc.ts';
import { t } from './i18n.ts';
import { formatGrams, formatNumber } from './numbers.ts';
import type { RecipeLineView } from './types.ts';

export const baseLabel = (base: Base) => t(`base.${base}`);

export function recipeLineText(l: Pick<RecipeLineView, 'mode' | 'grams' | 'percent' | 'base' | 'solve_for_heat'>): string {
  if (l.solve_for_heat) return t('recipe.solved');
  if (l.mode === 'percent' && l.percent !== null && l.base) return t('recipe.percentOf', { pct: formatNumber(l.percent), base: baseLabel(l.base) });
  return l.grams === null ? '—' : formatGrams(l.grams);
}
