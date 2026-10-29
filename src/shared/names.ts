// Ingredient and variety names (SPEC §15.3). Names compare without case or
// accents, so "sol" is "Soľ" and an existing name is never entered twice.

/** Case- and accent-insensitive form of a name: "Soľ" and "sol" are the same. */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** A typed new name, tidied: single spaces and a capital first letter ("voda" → "Voda"). */
export function cleanName(s: string): string {
  const name = s.replace(/\s+/g, ' ').trim();
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}
