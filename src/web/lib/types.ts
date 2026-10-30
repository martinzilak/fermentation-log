// Shapes of API responses (SPEC §11), as the server's batch view returns them.
import type { Derived } from '../../shared/calc.ts';
import type { RecipeLine, RecipeStep } from '../../shared/recipe.ts';
import type { BatchStatus, EventType, Kind, StepType } from '../../shared/schemas.ts';

export interface BatchSummary {
  id: string;
  number: number;
  name: string | null;
  color: string | null;
  status: BatchStatus;
  ferment_date: string | null;
  ferment_day: number | null;
}

export interface LineView {
  id: string;
  step_id: string;
  position: number;
  name: string;
  local_name: string | null;
  kind: Kind;
  grams: number | null;
  planned_g: number | null;
  lot_id: string | null;
  catalog_id: string | null;
  note: string | null;
  variety_id: string | null;
  variety_name: string | null;
  /** The line's own SHU override; `shu` below is what applies. */
  shu_min: number | null;
  shu_max: number | null;
  shu_source: string | null;
  shu: { min: number | null; max: number | null; source: string | null } | null;
}

export interface StepView {
  id: string;
  type: StepType;
  position: number;
  date: string | null;
  params: { vessel_id?: string | null; vessel_tare_g?: number | null; needs_burping?: boolean } & Record<string, unknown>;
  note: string | null;
  lines: LineView[];
}

export interface Attachment {
  id: string;
  event_id: string;
  type: 'photo' | 'audio';
  file: string;
  thumb: string | null;
  taken_at: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
}

export interface EventView {
  id: string;
  step_id: string | null;
  type: EventType;
  occurred_at: string;
  text: string | null;
  payload: Record<string, unknown>;
  author: string;
  attachments: Attachment[];
  net_g?: number | null;
}

export interface BatchView extends Omit<BatchSummary, 'ferment_date' | 'ferment_day'> {
  status_manual: boolean;
  recipe_id: string | null;
  notes_md: string;
  steps: StepView[];
  events: EventView[];
  derived: Derived;
}

export interface Variety {
  id: string;
  name: string;
  species: string | null;
  aliases: string[];
  local_names: string[];
  shu_min: number | null;
  shu_max: number | null;
  shu_source?: string | null;
  notes?: string | null;
  uses?: number;
}

export interface Lot {
  id: string;
  variety_id: string;
  season: number;
  origin: 'grown' | 'bought' | 'gift';
  propagation: 'seed' | 'sapling' | null;
  supplier: string | null;
  acquired_on: string | null;
  notes?: string | null;
  uses?: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  kind: Kind;
  aliases: string[];
  notes?: string | null;
  uses?: number;
}

export interface Vessel {
  id: string;
  name: string;
}

export interface BottleType {
  id: string;
  name: string;
  volume_ml: number;
  notes?: string | null;
  uses?: number;
}

export type Fill = { bottle_type_id: string; count: number } | { volume_ml: number; count: number; label?: string | null };

export interface RecentLine {
  name: string;
  kind: Kind;
  catalog_id: string | null;
  variety_id: string | null;
  step_types: StepType[];
}

export interface Settings {
  target_salt_pct: number;
}

export type { ReminderAction, ReminderRule } from '../../shared/schemas.ts';

export interface ExportStatus {
  last_export_at: string | null;
  last_backup_on: string | null;
}

export interface RecipeLineView extends RecipeLine {
  recipe_id: string;
  variety_id: string | null;
  catalog_id: string | null;
}

export interface RecipeView {
  id: string;
  name: string;
  notes_md: string;
  heat_target_shu: number | null;
  created_from_batch_id: string | null;
  created_at: string;
  updated_at: string;
  author: string;
  steps: RecipeStep[];
  lines: RecipeLineView[];
}
