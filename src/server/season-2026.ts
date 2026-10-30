// The recipes planned for the 2026 season (migration 0006). Amounts are the
// plan's grams for its harvest, turned into a recipe the way "save batch as
// recipe" does: peppers keep their grams, the rest of the ferment is a
// percentage of the peppers, water of the solids and salt 3 % of everything in
// the jar. After the ferment, additions are a percentage of the mash, taken to
// weigh about what the ferment's solids do, and xanthan 0.15 % of the sauce.
// Where the plan gives a range, the recipe takes its middle.
import { randomUUID } from 'node:crypto';
import type { Base } from '../shared/calc.ts';
import type { Kind, StepType } from '../shared/schemas.ts';
import type { DB } from './db.ts';
import { resolveLine } from './entries.ts';
import { insert } from './store.ts';

type Line = { name: string; kind: Kind; g: number | null };
type Step = { type: StepType; note: string; lines: Line[] };
type Plan = { id: string; name: string; notes: string; steps: Step[] };

const g = (name: string, kind: Kind, grams: number | null): Line => ({ name, kind, g: grams });

const FERMENT =
  'Thaw the pods and count the thaw liquid as part of the water. Salt is 3\u00a0% of everything in the jar. Keep everything submerged; about 3 weeks.';
const DRAIN = 'Drain the mash and keep the brine. Blend the mash with the vinegar, then add brine to the consistency you want.';
const COOK = 'Heat gently to a simmer, never a rolling boil, for a few minutes.';
const PH = 'Check the pH of a cooled sample: 4.0 or lower; add vinegar if it is higher.';
const XANTHAN = 'Shear in the xanthan last (1–2 g per kg of sauce); it thickens further as it rests.';
const FINISH = `Cool fully, then blend in the rest. ${XANTHAN} ${PH}`;
const STRAIN = 'Strain, then fill the cold sauce into StarSan-sanitised bottles. Refrigerate, opened or not.';
const STARTER = 'Use a starter: 2–3 tbsp of sauerkraut juice or brine from an old ferment, as for every jar with jolokia.';

const ferment = (lines: Line[], note = FERMENT): Step => ({ type: 'ferment', note, lines });
const blend = (lines: Line[], note = DRAIN): Step => ({ type: 'blend', note, lines });
const cook = (lines: Line[] = []): Step => ({ type: 'cook', note: COOK, lines });
const finish = (lines: Line[], note = FINISH): Step => ({ type: 'blend', note, lines: [...lines, g('Xanthan gum', 'thickener', null)] });
const strain: Step = { type: 'strain', note: STRAIN, lines: [] };

const water = (grams: number) => g('Water', 'water', grams);
const salt = g('Salt', 'salt', null);
const vinegar = (grams: number) => g('Spirit vinegar 8 %', 'acid', grams);
const brine = (grams: number | null) => g('Brine', 'brine', grams);
const sugar = (grams: number) => g('Cane sugar', 'sweetener', grams);

export const PLANS: Plan[] = [
  {
    id: '69af6d37-8adf-4fe6-b46c-4bad9eeff945',
    name: 'Red jalapeño sriracha (medium-mild)',
    notes:
      'Starting points for about 980 g of mash: vinegar 110–130 g (white or rice), brine 100–200 g, sugar or agave 30–50 g (start at 30 g).\n\nOptional: 3 g of smoked paprika in the first blend.',
    steps: [
      ferment([g('Jalapeño Red', 'pepper', 800), g('Habanero Red', 'pepper', 80), g('Garlic', 'aromatic', 100), water(980), salt]),
      blend([vinegar(120), brine(150), sugar(30)], `${DRAIN} Keep it thicker than usual.`),
      cook(),
      finish([], `Cool fully. ${XANTHAN} ${PH}`),
      strain,
    ],
  },
  {
    id: '319185f7-f183-4643-91bb-68736c556eb1',
    name: 'Red habanero and Boliviano (hot)',
    notes:
      'Thyme is 4 sprigs (about 2 g), allspice 6 berries (about 1 g), orange zest the zest of 1 orange (about 6 g).\n\nStarting points for about 1,050 g of mash: vinegar 130–160 g, brine 300–400 g, sweetener 20–30 g; freeze-dried raspberry 20–30 g at the cook. The strain takes out the raspberry seeds.',
    steps: [
      ferment([
        g('Habanero Red', 'pepper', 530),
        g('Aji Boliviano Red', 'pepper', 330),
        g('Red onion', 'vegetable', 150),
        g('Garlic', 'aromatic', 35),
        g('Thyme', 'herb', 2),
        g('Allspice', 'aromatic', 1),
        water(1000),
        salt,
      ]),
      blend([vinegar(145), brine(350), sugar(25)], `Remove the thyme stems and allspice. ${DRAIN}`),
      cook([g('Freeze-dried raspberry', 'fruit', 25), g('Orange zest', 'aromatic', 6)]),
      finish([], `Cool fully. ${XANTHAN} ${PH}`),
      strain,
    ],
  },
  {
    id: '8576c6d4-ad6c-4cac-875d-c4b34473f528',
    name: 'Aji Guyana yellow (medium)',
    notes: `${STARTER}\n\nShallot or white onion. Lime zest is the zest of 1 lime (about 2 g).\n\nStarting points for about 570 g of mash: vinegar 70–90 g (white wine), brine 150–250 g, sweetener 10–15 g.\n\nOptional: 15 g of fresh coriander leaf after cooling.`,
    steps: [
      ferment([
        g('Aji Guyana Yellow', 'pepper', 434),
        g('Jolokia Yellow', 'pepper', 28),
        g('Shallot', 'vegetable', 50),
        g('Garlic', 'aromatic', 15),
        g('Ginger', 'aromatic', 20),
        g('Fresh turmeric', 'aromatic', 10),
        g('Freeze-dried pineapple', 'fruit', 9),
        water(600),
        salt,
      ]),
      blend([g('White wine vinegar', 'acid', 80), brine(200), sugar(12.5)]),
      cook([g('Freeze-dried pineapple', 'fruit', 20)]),
      finish([g('Lime zest', 'aromatic', 2)]),
      strain,
    ],
  },
  {
    id: '78020f7d-beac-47e8-9d2b-de9a6d6ccd86',
    name: 'Big Peach Mama (superhot novelty)',
    notes:
      'From the orange pods. Wear gloves, and ventilate well while it cooks.\n\nStarting points for about 580 g of mash: vinegar 80–100 g, brine to consistency, sweetener 15–25 g; at the cook thawed frozen peach 150–270 g and freeze-dried peach 10–15 g.\n\nOptional: lemon thyme at the cook.',
    steps: [
      ferment([
        g('Big Peach Mama Orange', 'pepper', 256),
        g('Carrot', 'vegetable', 160),
        g('Bell Pepper Orange', 'pepper', 110),
        g('Shallot', 'vegetable', 25),
        g('Garlic', 'aromatic', 7),
        g('Ginger', 'aromatic', 10),
        g('Freeze-dried peach', 'fruit', 10),
        water(630),
        salt,
      ]),
      blend([vinegar(90), brine(null), sugar(20)]),
      cook([g('Peach', 'fruit', 210), g('Freeze-dried peach', 'fruit', 12.5)]),
      finish([], `Cool fully. ${XANTHAN} ${PH}`),
      strain,
    ],
  },
  {
    id: 'cf561fd3-fb1a-4f97-940b-5d3d1f68b48a',
    name: 'Mild green (family)',
    notes:
      'Weigh the jalapeño after deseeding. Lime zest is the zest of 2 limes (about 4 g).\n\nStarting points for about 1,050 g of mash: vinegar 130–150 g, brine 300–400 g, sweetener 10–20 g.',
    steps: [
      ferment([
        g('Jalapeño Green', 'pepper', 600),
        g('Aji Boliviano Green', 'pepper', 330),
        g('White onion', 'vegetable', 90),
        g('Garlic', 'aromatic', 30),
        g('Coriander seed', 'aromatic', 4),
        water(1050),
        salt,
      ]),
      blend([vinegar(140), brine(350), sugar(15)]),
      cook(),
      finish(
        [g('Freeze-dried kiwi', 'fruit', 20), g('Coriander', 'herb', 25), g('Parsley', 'herb', 20), g('Spinach', 'vegetable', 40), g('Lime zest', 'aromatic', 4)],
        `Cool fully, then blend in the greens. ${XANTHAN} ${PH}`,
      ),
      strain,
    ],
  },
  {
    id: '4c106e53-1426-4e5c-a3ba-750ec7b28674',
    name: 'Medium green',
    notes: `${STARTER}\n\nJalapeño with the seeds in. Lime zest is the zest of 1 lime (about 2 g).\n\nStarting points for about 930 g of mash: vinegar 110–130 g, brine 250–350 g, sweetener 10–15 g.`,
    steps: [
      ferment([
        g('Jalapeño Green', 'pepper', 600),
        g('Aji Guyana Green', 'pepper', 186),
        g('Big Peach Mama Green', 'pepper', 14),
        g('Jolokia Yellow', 'pepper', 20),
        g('White onion', 'vegetable', 80),
        g('Garlic', 'aromatic', 30),
        g('Cumin', 'aromatic', 3),
        water(900),
        salt,
      ]),
      blend([vinegar(120), brine(300), sugar(12.5)]),
      cook(),
      finish([g('Freeze-dried kiwi', 'fruit', 15), g('Coriander', 'herb', 25), g('Lime zest', 'aromatic', 2)]),
      strain,
    ],
  },
];

const SALT_PCT = 3;
const XANTHAN_PCT = 0.15;

const sum = (lines: Line[]) => lines.reduce((total, l) => total + (l.g ?? 0), 0);
const pct = (grams: number, base: number) => Math.round((grams / base) * 10_000) / 100;

type Amount = { mode: 'grams' | 'percent'; grams: number | null; percent: number | null; base: Base | null };
const grams = (n: number | null): Amount => ({ mode: 'grams', grams: n, percent: null, base: null });
const percent = (n: number, base: Base): Amount => ({ mode: 'percent', grams: null, percent: n, base });

function amount(line: Line, inFerment: boolean, peppers: number, solids: number): Amount {
  if (line.kind === 'salt') return percent(SALT_PCT, 'ferment_total');
  if (line.kind === 'thickener') return percent(XANTHAN_PCT, 'sauce');
  if (line.g === null || (inFerment && line.kind === 'pepper')) return grams(line.g);
  if (!inFerment) return percent(pct(line.g, solids), 'mash');
  return line.kind === 'water' ? percent(pct(line.g, solids), 'solids') : percent(pct(line.g, peppers), 'peppers');
}

/** Adds the planned recipes that aren't there yet, by id or by name. */
export function addPlannedRecipes(db: DB): void {
  const audit = { now: new Date().toISOString(), author: 'system' };
  const exists = db.prepare('SELECT 1 FROM recipes WHERE id = ? OR name = ? COLLATE NOCASE');
  const addStep = db.prepare(
    'INSERT INTO recipe_steps (recipe_id, step_index, type, note, created_at, updated_at, author) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const plan of PLANS) {
    if (exists.get(plan.id, plan.name)) continue;
    insert(db, 'recipes', { id: plan.id, name: plan.name, notes_md: plan.notes, created_at: audit.now, updated_at: audit.now, author: audit.author });
    const fermentLines = plan.steps[0]!.lines;
    const peppers = sum(fermentLines.filter((l) => l.kind === 'pepper'));
    const solids = sum(fermentLines.filter((l) => l.kind !== 'water' && l.kind !== 'salt'));
    plan.steps.forEach((step, step_index) => {
      addStep.run(plan.id, step_index, step.type, step.note, audit.now, audit.now, audit.author);
      step.lines.forEach((line, position) => {
        const entry = resolveLine(db, { name: line.name, kind: line.kind }, audit);
        insert(db, 'recipe_lines', {
          id: randomUUID(),
          recipe_id: plan.id,
          step_index,
          step_type: step.type,
          position,
          name: entry.name,
          kind: entry.kind,
          variety_id: entry.variety_id,
          catalog_id: entry.catalog_id,
          ...amount(line, step.type === 'ferment', peppers, solids),
          solve_for_heat: false,
          created_at: audit.now,
          updated_at: audit.now,
          author: audit.author,
        });
      });
    });
  }
}
