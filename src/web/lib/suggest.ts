// Ingredient chips (SPEC §8.1 item 12): recent names first, then catalog
// items and varieties. Catalog aliases resolve to the canonical name and keep
// what was typed in the note (SPEC §6.2); variety local names fill local_name.
import type { Kind } from '../../shared/schemas.ts';
import type { CatalogItem, RecentLine, Variety } from './types.ts';

export interface Pick {
  name: string;
  kind: Kind | null;
  catalog_id: string | null;
  variety_id: string | null;
  local_name: string | null;
  note: string | null;
}

export interface Sources {
  recent: RecentLine[];
  catalog: CatalogItem[];
  varieties: Variety[];
}

interface Candidate extends Pick {
  terms: string[];
  aliases: string[];
}

const lower = (s: string) => s.toLocaleLowerCase();

export function suggest(query: string, { recent, catalog, varieties }: Sources, limit = 15): Pick[] {
  const q = lower(query.trim());
  const candidates: Candidate[] = [
    ...recent.map((r) => ({
      name: r.name,
      kind: r.kind,
      catalog_id: r.catalog_id,
      variety_id: r.variety_id,
      local_name: r.local_name,
      note: null,
      terms: [r.name, ...(r.local_name ? [r.local_name] : [])],
      aliases: [],
    })),
    ...catalog.map((c) => ({
      name: c.name,
      kind: c.kind,
      catalog_id: c.id,
      variety_id: null,
      local_name: null,
      note: null,
      terms: [c.name, ...c.aliases],
      aliases: c.aliases,
    })),
    ...varieties.map((v) => ({
      name: v.name,
      kind: 'pepper' as const,
      catalog_id: null,
      variety_id: v.id,
      local_name: null,
      note: null,
      terms: [v.name, ...v.local_names],
      aliases: [],
    })),
  ];

  const seen = new Set<string>();
  const starts: Pick[] = [];
  const contains: Pick[] = [];
  for (const { terms, aliases, ...pick } of candidates) {
    const key = `${lower(pick.name)}|${pick.kind}`;
    if (seen.has(key)) continue;
    // The term that matched: exact beats prefix beats anywhere in the name.
    const hit = q
      ? (terms.find((term) => lower(term) === q) ??
        terms.find((term) => lower(term).startsWith(q)) ??
        terms.find((term) => lower(term).includes(q)))
      : pick.name;
    if (hit === undefined) continue;
    seen.add(key);
    const exact = q !== '' && lower(hit) === q && lower(hit) !== lower(pick.name);
    const resolved: Pick = {
      ...pick,
      ...(exact && aliases.some((a) => lower(a) === q) ? { note: `recorded as '${query.trim()}'` } : {}),
      ...(exact && pick.variety_id ? { local_name: hit } : {}),
    };
    (q && lower(hit).startsWith(q) ? starts : contains).push(resolved);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The variety a pepper name refers to, by name or local name. */
export function varietyFor(name: string, varieties: Variety[]): Variety | undefined {
  const n = lower(name.trim());
  return varieties.find((v) => lower(v.name) === n || v.local_names.some((l) => lower(l) === n));
}
