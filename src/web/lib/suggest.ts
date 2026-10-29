// Ingredient chips (SPEC §8.1 item 12). Names compare without case or
// accents, so "sol" finds "Soľ" and typing an existing name never creates a
// second spelling of it. A search also matches the kind ("salt") and catalog
// aliases; an alias resolves to the canonical name and keeps what was typed
// in the note (SPEC §6.2). Before anything is typed, only a few chips show:
// the names this kind of step usually takes, most recent first.
import { fold } from '../../shared/names.ts';
import type { Kind, StepType } from '../../shared/schemas.ts';
import { kindLabel } from './i18n.ts';
import type { CatalogItem, RecentLine, Variety } from './types.ts';

export interface Pick {
  name: string;
  kind: Kind | null;
  catalog_id: string | null;
  variety_id: string | null;
  note: string | null;
}

export interface Sources {
  recent: RecentLine[];
  catalog: CatalogItem[];
  varieties: Variety[];
}

export const IDLE_LIMIT = 8;
export const SEARCH_LIMIT = 12;

interface Candidate {
  pick: Pick;
  aliases: string[];
}

function candidates({ recent, catalog, varieties }: Sources, stepType: StepType | undefined): Candidate[] {
  const aliasesOf = new Map(catalog.map((c) => [c.id, c.aliases]));
  const usual = stepType ? recent.filter((r) => r.step_types.includes(stepType)) : recent;
  const other = stepType ? recent.filter((r) => !r.step_types.includes(stepType)) : [];
  return [
    ...[...usual, ...other].map((r) => ({
      pick: { name: r.name, kind: r.kind, catalog_id: r.catalog_id, variety_id: r.variety_id, note: null },
      aliases: (r.catalog_id && aliasesOf.get(r.catalog_id)) || [],
    })),
    ...catalog.map((c) => ({
      pick: { name: c.name, kind: c.kind, catalog_id: c.id, variety_id: null, note: null },
      aliases: c.aliases,
    })),
    ...varieties.map((v) => ({
      pick: { name: v.name, kind: 'pepper' as const, catalog_id: null, variety_id: v.id, note: null },
      aliases: [],
    })),
  ];
}

export interface Suggestions {
  options: Pick[];
  /** The query already names an ingredient (by name or alias), so no new one is offered. */
  exact: boolean;
}

export function suggest(query: string, sources: Sources, stepType?: StepType): Suggestions {
  const q = fold(query);
  const seen = new Set<string>();
  // Ranked buckets: exact name or alias, then prefix, then anywhere.
  const ranked: [Pick[], Pick[], Pick[]] = [[], [], []];
  for (const { pick, aliases } of candidates(sources, stepType)) {
    const key = `${fold(pick.name)}|${pick.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!q) {
      ranked[2].push(pick);
      continue;
    }
    const name = fold(pick.name);
    const alias = aliases.find((a) => fold(a) === q);
    if (name === q || alias) {
      ranked[0].push(alias ? { ...pick, note: `recorded as '${query.trim()}'` } : pick);
      continue;
    }
    const terms = [name, ...aliases.map(fold), ...(pick.kind ? [fold(kindLabel(pick.kind))] : [])];
    if (terms.some((term) => term.startsWith(q))) ranked[1].push(pick);
    else if (terms.some((term) => term.includes(q))) ranked[2].push(pick);
  }
  return {
    options: ranked.flat().slice(0, q ? SEARCH_LIMIT : IDLE_LIMIT),
    exact: ranked[0].length > 0,
  };
}

/** The variety a pepper name refers to, ignoring case and accents. */
export function varietyFor(name: string, varieties: Variety[]): Variety | undefined {
  const n = fold(name);
  return varieties.find((v) => fold(v.name) === n);
}
