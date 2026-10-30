// Domain schemas shared by the client and the server (SPEC §6, §11).
import * as v from 'valibot';

export const BATCH_STATUSES = ['planned', 'fermenting', 'processing', 'bottled', 'archived'] as const;
export const STEP_TYPES = ['ferment', 'blend', 'cook', 'strain', 'rest', 'other'] as const;
export const KINDS = [
  'pepper', 'vegetable', 'fruit', 'aromatic', 'herb', 'water', 'salt',
  'mash', 'brine', 'acid', 'sweetener', 'thickener', 'other',
] as const;
export const EVENT_TYPES = ['note', 'photo', 'voice', 'ph', 'burp', 'weigh', 'issue', 'tasting', 'bottled'] as const;
export const ORIGINS = ['grown', 'bought', 'gift'] as const;
export const PROPAGATIONS = ['seed', 'sapling'] as const;
export const ISSUE_KINDS = ['kahm', 'mold', 'leak', 'other'] as const;
export const PH_METHODS = ['meter', 'strip'] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type StepType = (typeof STEP_TYPES)[number];
export type Kind = (typeof KINDS)[number];
export type EventType = (typeof EVENT_TYPES)[number];

export const Id = v.pipe(v.string(), v.uuid());
export const IsoDate = v.pipe(v.string(), v.isoDate());
export const Timestamp = v.pipe(v.string(), v.isoTimestamp());
export const Grams = v.pipe(v.number(), v.finite(), v.minValue(0));
export const Shu = v.pipe(v.number(), v.finite(), v.minValue(0));
export const Name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));
export const Text = v.pipe(v.string(), v.maxLength(20_000));
const Position = v.pipe(v.number(), v.integer(), v.minValue(0));

/**
 * Builds the POST and PATCH schemas of a resource. POST takes the
 * client-generated id plus the fields; PATCH takes any subset of the fields.
 * Fields in `optional` that are wrapped in v.nullable can be cleared with null.
 */
function resource<R extends v.ObjectEntries, O extends v.ObjectEntries>(required: R, optional: O) {
  return {
    create: v.object({ id: Id, ...required, ...v.partial(v.object(optional)).entries }),
    patch: v.partial(v.object({ ...required, ...optional })),
  };
}

// --- Step params, typed per step type (SPEC §6.2) ---

export const StepParams = {
  ferment: v.object({
    vessel_id: v.optional(v.nullable(Id)),
    // Required by the new-batch flow; optional so imported batches can omit it.
    vessel_tare_g: v.optional(v.nullable(Grams)),
    // A sealed jar has to be burped by hand; a crock with a water seal or an airlock doesn't.
    needs_burping: v.optional(v.boolean()),
  }),
  cook: v.object({
    temp_c: v.optional(v.nullable(v.pipe(v.number(), v.finite()))),
    minutes: v.optional(v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0)))),
  }),
  strain: v.object({ removed_g: v.optional(v.nullable(Grams)) }),
  blend: v.object({}),
  rest: v.object({}),
  other: v.object({}),
} satisfies Record<StepType, v.GenericSchema>;

export type FermentParams = v.InferOutput<typeof StepParams.ferment>;

// --- Event payloads, typed per event type (SPEC §6.2) ---

const Count = v.pipe(v.number(), v.integer(), v.minValue(1));

// A fill is a saved bottle type, or a one-off bottle that creates no type (SPEC §15.2).
export const Fill = v.union([
  v.strictObject({ bottle_type_id: Id, count: Count }),
  v.strictObject({
    volume_ml: v.pipe(v.number(), v.finite(), v.gtValue(0)),
    count: Count,
    label: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
  }),
]);
export type Fill = v.InferOutput<typeof Fill>;

export const EventPayload = {
  ph: v.object({
    value: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(14)),
    method: v.picklist(PH_METHODS),
  }),
  weigh: v.object({ gross_g: Grams }),
  issue: v.object({ kind: v.picklist(ISSUE_KINDS) }),
  tasting: v.object({ rating: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)) }),
  // The bottling checklist (SPEC §8.2) enforces fills, pH and a photo in the
  // UI; imported batches may lack them, so the payload itself does not.
  bottled: v.object({
    fills: v.array(Fill),
    leftover_g: v.optional(v.nullable(Grams)),
    total_g: v.optional(v.nullable(Grams)),
    ph: v.optional(v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(14)))),
    ph_not_measured_reason: v.optional(v.nullable(Text)),
  }),
  note: v.object({}),
  photo: v.object({}),
  voice: v.object({}),
  burp: v.object({}),
} satisfies Record<EventType, v.GenericSchema>;

export type BottledPayload = v.InferOutput<typeof EventPayload.bottled>;

// --- Request bodies ---

export const Batch = resource(
  {},
  {
    number: v.pipe(v.number(), v.integer(), v.minValue(1)),
    name: v.nullable(Name),
    color: v.nullable(Name),
    notes_md: Text,
    recipe_id: v.nullable(Id),
  },
);
// PATCH may also override the status by hand; null returns it to automatic.
export const BatchPatch = v.object({
  ...Batch.patch.entries,
  status: v.optional(v.nullable(v.picklist(BATCH_STATUSES))),
});

export const Step = resource(
  { type: v.picklist(STEP_TYPES) },
  {
    position: Position,
    date: v.nullable(IsoDate),
    params: v.unknown(), // validated against StepParams[type]
    note: v.nullable(Text),
  },
);

export const Line = resource(
  { name: Name, kind: v.picklist(KINDS) },
  {
    position: Position,
    local_name: v.nullable(Name),
    grams: v.nullable(Grams),
    planned_g: v.nullable(Grams),
    lot_id: v.nullable(Id),
    catalog_id: v.nullable(Id),
    variety_id: v.nullable(Id),
    shu_min: v.nullable(Shu),
    shu_max: v.nullable(Shu),
    shu_source: v.nullable(Text),
    note: v.nullable(Text),
  },
);

export const Event = resource(
  { type: v.picklist(EVENT_TYPES) },
  {
    occurred_at: Timestamp,
    step_id: v.nullable(Id),
    text: v.nullable(Text),
    payload: v.unknown(), // validated against EventPayload[type]
  },
);
// The type of an event never changes; its payload is checked against it.
export const EventPatch = v.omit(Event.patch, ['type']);

export const Variety = resource(
  { name: Name },
  {
    species: v.nullable(Name),
    aliases: v.array(Name),
    local_names: v.array(Name),
    shu_min: v.nullable(Shu),
    shu_max: v.nullable(Shu),
    shu_source: v.nullable(Text),
    notes: v.nullable(Text),
  },
);

const lotFields = {
  season: v.pipe(v.number(), v.integer(), v.minValue(1900), v.maxValue(2200)),
  origin: v.picklist(ORIGINS),
};
export const Lot = resource(
  { variety_id: Id, ...lotFields },
  {
    propagation: v.nullable(v.picklist(PROPAGATIONS)),
    supplier: v.nullable(Text),
    acquired_on: v.nullable(IsoDate),
    notes: v.nullable(Text),
  },
);

// Peppers are varieties, not catalog items (SPEC §15.3).
export const CatalogItem = resource(
  { name: Name, kind: v.picklist(KINDS.filter((k) => k !== 'pepper')) },
  { aliases: v.array(Name), notes: v.nullable(Text) },
);

export const BottleType = resource(
  { name: Name, volume_ml: v.pipe(v.number(), v.finite(), v.gtValue(0)) },
  { notes: v.nullable(Text) },
);

export const Vessel = resource({ name: Name }, { notes: v.nullable(Text) });

/** Validates step params for a step type; returns the parsed params or the issues. */
export function parseStepParams(type: StepType, params: unknown) {
  return v.safeParse(StepParams[type], params ?? {});
}

/** Validates an event payload for an event type; returns the parsed payload or the issues. */
export function parseEventPayload(type: EventType, payload: unknown) {
  return v.safeParse(EventPayload[type], payload ?? {});
}

// --- Recipes (SPEC §7.3) ---

export const BASES = ['peppers', 'solids', 'ferment_total', 'mash', 'sauce'] as const;

const Percent = v.pipe(v.number(), v.finite(), v.minValue(0));

// `remainder` is reserved and not offered in v1.
export const RecipeLine = v.pipe(
  v.object({
    id: Id,
    step_index: Position,
    step_type: v.picklist(STEP_TYPES),
    position: v.optional(Position),
    name: Name,
    kind: v.picklist(KINDS),
    mode: v.picklist(['grams', 'percent']),
    grams: v.optional(v.nullable(Grams)),
    percent: v.optional(v.nullable(Percent)),
    base: v.optional(v.nullable(v.picklist(BASES))),
    solve_for_heat: v.optional(v.boolean()),
    variety_id: v.optional(v.nullable(Id)),
    catalog_id: v.optional(v.nullable(Id)),
  }),
  v.check((l) => l.mode !== 'percent' || (l.percent != null && l.base != null), 'A percent line needs a percent and a base'),
  v.check((l) => !l.solve_for_heat || l.mode === 'grams', 'Only a grams line can be solved for heat'),
);

export const RecipeStep = v.object({
  step_index: Position,
  type: v.picklist(STEP_TYPES),
  note: v.optional(v.nullable(Text)),
});

const RecipeSteps = v.pipe(
  v.array(RecipeStep),
  v.check((steps) => new Set(steps.map((s) => s.step_index)).size === steps.length, 'Two steps share an index'),
);

const RecipeLines = v.pipe(
  v.array(RecipeLine),
  v.check((lines) => lines.filter((l) => l.solve_for_heat).length <= 1, 'At most one line can be solved for heat'),
);

export const Recipe = resource(
  { name: Name },
  { notes_md: Text, heat_target_shu: v.nullable(Shu), steps: RecipeSteps, lines: RecipeLines },
);

export const RecipeEvaluate = v.object({
  grams: v.optional(v.record(Id, Grams)),
  mash_g: v.optional(v.nullable(Grams)),
});

export const SaveAsRecipe = v.object({ id: Id, name: v.optional(Name) });

// --- Reminder rules (SPEC §15.11) ---

export const REMINDER_ACTIONS = ['photo', 'burp', 'ph', 'custom'] as const;
export type ReminderAction = (typeof REMINDER_ACTIONS)[number];

const Day = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365));

/** On ferment day first_day (the start date is Day 1), then every every_days days (0: once), from the hour. */
export const ReminderRule = v.pipe(
  v.object({
    id: Id,
    action: v.picklist(REMINDER_ACTIONS),
    text: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200)))),
    first_day: Day,
    every_days: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365)),
    // Outside the quiet hours, 22:00–08:00.
    hour: v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(21)),
  }),
  v.check((r) => r.action !== 'custom' || !!r.text, 'An own reminder needs its text'),
);
export type ReminderRule = v.InferOutput<typeof ReminderRule>;

export const ReminderRules = v.pipe(
  v.array(ReminderRule),
  v.maxLength(30),
  v.check((rules) => new Set(rules.map((r) => r.id)).size === rules.length, 'Two reminders share an id'),
);
