// Numpad input and number formatting (SPEC §8.1 item 5).

/** Applies one numpad key ("0"–"9", "." or ",", "back") to the typed text. */
export function appendKey(value: string, key: string, { decimals = 2, maxInt = 6 } = {}): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === '.' || key === ',') {
    if (decimals === 0 || value.includes('.')) return value;
    return `${value || '0'}.`;
  }
  if (!/^\d$/.test(key)) return value;
  const [int = '', frac] = value.split('.');
  if (frac !== undefined) return frac.length >= decimals ? value : value + key;
  if (int === '0') return key;
  return int.length >= maxInt ? value : value + key;
}

/** Parses typed text, accepting a comma or a dot; null when there is no number yet. */
export function parseDecimal(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (s === '' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const grams = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const shu = new Intl.NumberFormat('en', { maximumSignificantDigits: 2 });

export const formatNumber = (n: number) => grams.format(n);
export const formatGrams = (g: number) => `${grams.format(g)} g`;
export const formatPct = (p: number, digits = 2) => `${p.toFixed(digits)} %`;

/** "≈ 17,000–50,000 SHU"; a single value when both ends round the same. */
export function formatShuRange(low: number, high: number): string {
  const a = shu.format(low);
  const b = shu.format(high);
  return `≈ ${a === b ? a : `${a}–${b}`} SHU`;
}
