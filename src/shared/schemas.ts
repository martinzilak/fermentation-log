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

export const Fill = v.object({
  bottle_type_id: Id,
  count: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

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
