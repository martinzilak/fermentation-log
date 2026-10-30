// Weighing mode for one step (SPEC §8.1 item 6, §8.2 items 2–3). A ferment
// step opens with the empty crock on the scale (crocks aren't saved, SPEC
// §15.2); then one ingredient per screen: pick a name, its kind and lot if
// needed, type the grams, Next.
// Each line is saved on Next; salt % and suggested salt update live.
// In a batch from a recipe, the lines still to weigh come first, each with
// its plan shown large and the deviation as you type (SPEC §7.3).
import { useState } from 'react';
import { bases, saltPct, suggestedSaltG, type CalcLine, type CalcStep } from '../../shared/calc.ts';
import { cleanName, fold } from '../../shared/names.ts';
import { KINDS, type Kind } from '../../shared/schemas.ts';
import { Chip, Chips } from '@/components/Chip';
import { LinkRow, RowList } from '@/components/Edit';
import { NumpadFooter, Readout } from '@/components/Numpad';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { kindLabel, stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, formatNumber, formatPct, parseDecimal } from '@/lib/numbers';
import { calcSteps as batchCalcSteps, planFor, recipeStepNote, type Plan } from '@/lib/plan';
import { invalidate, missingTitle, refresh, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import { suggest, type Pick } from '@/lib/suggest';
import type { BatchView, CatalogItem, LineView, Lot, RecentLine, RecipeView, Settings, StepView, Variety } from '@/lib/types';
import { saltWarning } from '@/lib/salt';
import { useWakeLock } from '@/lib/wakelock';

/** `line` is a planned line being weighed, rather than a new one. */
type Chosen = Pick & { kind: Kind; lot_id: string | null; line?: LineView | undefined };

type Stage =
  | { name: 'tare' }
  | { name: 'pick' }
  | { name: 'kind'; pick: Pick }
  | { name: 'lot'; pick: Chosen; lots: Lot[] }
  | { name: 'newLot'; pick: Chosen }
  | { name: 'grams'; pick: Chosen }
  | { name: 'container'; pick: Chosen };

export function Weighing({ batchId, stepId }: { batchId: string; stepId: string }) {
  const { data: batch, error } = useQuery<BatchView>(`/api/batches/${batchId}`);
  const step = batch?.steps.find((s) => s.id === stepId);
  if (!batch || !step) {
    return (
      <Screen
        title={batch ? t('app.notFound') : missingTitle(error)}
        footer={
          <Button variant="outline" onClick={() => goBack(`/b/${batchId}`)}>
            {t('common.back')}
          </Button>
        }
      />
    );
  }
  return <WeighingFlow key={step.id} batch={batch} step={step} />;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The kind under a chip's name, unless the name already says it ("Brine"). */
function kindHint(pick: Pick): string | undefined {
  if (!pick.kind) return undefined;
  const label = kindLabel(pick.kind);
  return label.toLocaleLowerCase() === pick.name.toLocaleLowerCase() ? undefined : label;
}

/** "grown from seed", "bought". */
function lotHow(lot: { origin: Lot['origin']; propagation: Lot['propagation'] }): string {
  return [t(`origin.${lot.origin}`), ...(lot.propagation ? [t(`propagation.${lot.propagation}`)] : [])].join(' ');
}

const lotLabel = (lot: Lot) => `${lot.season} · ${lotHow(lot)}`;
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

function mashHint(plan: Plan | null): string {
  return plan?.grams != null ? t('weigh.mashAbout', { g: formatGrams(plan.grams) }) : t('weigh.mashFirst');
}

function planText(plan: Plan | null): string {
  if (plan?.grams != null) return t('weigh.plan', { g: formatGrams(plan.grams) });
  if (plan?.pending) return t('weigh.planAfterMash');
  return plan?.rule ?? t('weigh.noPlan');
}

/** "+3 g · +6 %"; each sign follows its rounded number, so nothing reads "−0 %". */
function deviation(actual: number, planned: number): string {
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±');
  const diff = round2(actual - planned);
  const pct = planned > 0 ? Math.round((diff / planned) * 100) : null;
  const pctText = pct === null ? '' : ` · ${sign(pct)}${Math.abs(pct)}\u00a0%`;
  return `${sign(diff)}${formatGrams(Math.abs(diff))}${pctText}`;
}

function WeighingFlow({ batch, step }: { batch: BatchView; step: StepView }) {
  useWakeLock();
  const toast = useToast();
  const batchUrl = `/api/batches/${batch.id}`;
  const catalog = useQuery<CatalogItem[]>('/api/catalog').data ?? [];
  const varieties = useQuery<Variety[]>('/api/varieties').data ?? [];
  const lots = useQuery<Lot[]>('/api/lots').data ?? [];
  const recent = useQuery<RecentLine[]>('/api/lines/recent').data ?? [];
  const targetPct = useQuery<Settings>('/api/settings').data?.target_salt_pct ?? 3;
  const recipe = useQuery<RecipeView[]>('/api/recipes').data?.find((r) => r.id === batch.recipe_id);
  const plan = (line: LineView) => planFor(line, step, batch, recipe);
  const method = recipeStepNote(recipe, batch, step.id);

  // Lines planned from a recipe are there before anything is weighed.
  const needsTare = step.type === 'ferment' && step.params.vessel_tare_g == null && step.lines.every((l) => l.grams === null);
  const [stage, setStage] = useState<Stage>(needsTare ? { name: 'tare' } : { name: 'pick' });
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const [container, setContainer] = useState<number | null>(null);

  const go = (next: Stage) => {
    setValue('');
    // A container is for one ingredient; the next one starts without it.
    if (next.name === 'pick') setContainer(null);
    setStage(next);
  };
  const leave = () => goBack(`/b/${batch.id}`);

  /** Backing out before the crock is weighed: an untouched new batch goes, with Undo. */
  async function leaveTare() {
    const untouched = batch.steps.length === 1 && batch.events.length === 0 && step.lines.every((l) => l.grams === null);
    if (!untouched) return leave();
    const gone = await toast.run(async () => {
      await api.del(batchUrl);
      return true;
    });
    if (!gone) return;
    invalidate('/api/batches');
    navigate('/', { replace: true });
    toast.show(t('new.discarded', { n: batch.number }), async () => {
      await api.post(`${batchUrl}/restore`, {});
      invalidate('/api/batches');
      navigate(`/b/${batch.id}`);
    });
  }
  const subtitle = `#${batch.number} · ${stepTypeLabel(step.type)}`;
  const typed = parseDecimal(value);

  // --- Live numbers (SPEC §8.2 item 2) ---

  /** The batch with the line being weighed in it, in place of its planned line if it has one. */
  function calcSteps(extra?: CalcLine, replaces?: string): CalcStep[] {
    return batchCalcSteps(batch.steps, replaces).map((s, i) => ({
      ...s,
      lines: [...s.lines, ...(extra && batch.steps[i]!.id === step.id ? [extra] : [])],
    }));
  }

  function liveStats(pending?: CalcLine, compact = false, replaces?: string) {
    const steps = calcSteps(pending, replaces);
    if (step.type !== 'ferment') {
      const { mash, sauce } = bases(steps);
      return <p className="text-lg text-muted-foreground">{t(mash > 0 ? 'weigh.sauce' : 'weigh.additions', { g: formatGrams(sauce) })}</p>;
    }
    const pct = saltPct(steps);
    const suggested = suggestedSaltG(steps, targetPct);
    // Until the salt is in, its 0 % is noise; the aim says what's needed.
    const saltIn = steps.some((s) => s.type === 'ferment' && s.lines.some((l) => l.kind === 'salt' && (l.grams ?? 0) > 0));
    const salt = saltIn && pct !== null ? t('weigh.saltNow', { pct: formatPct(pct) }) : null;
    const hint =
      suggested !== null && suggested > 0
        ? t('weigh.suggested', { g: formatGrams(round2(suggested)), pct: formatPct(targetPct) })
        : null;
    if (compact) {
      const aim = suggested !== null && suggested > 0 ? t('weigh.aim', { g: formatGrams(Math.round(suggested * 10) / 10) }) : null;
      return <span className="tabular-nums">{[salt, aim].filter(Boolean).join(' · ')}</span>;
    }
    return (
      <div className="text-lg">
        {salt && <p className="text-2xl font-semibold tabular-nums">{salt}</p>}
        {hint && <p className="text-muted-foreground tabular-nums">{hint}</p>}
      </div>
    );
  }

  // --- Saving ---

  async function saveTare(grams: number) {
    const before = step.params;
    const params = { ...before, vessel_tare_g: grams };
    const saved = await toast.run(() => api.patch(`/api/steps/${step.id}`, { params }));
    if (!saved) return;
    void refresh(batchUrl);
    go({ name: 'pick' });
    toast.show(t('weigh.tareSaved', { g: formatGrams(grams) }), async () => {
      await api.patch(`/api/steps/${step.id}`, { params: before });
      await refresh(batchUrl);
      go({ name: 'tare' });
    });
  }

  /** Weighs a planned line, snapshotting its plan as it stands now. */
  async function savePlanned(pick: Chosen, line: LineView, grams: number) {
    const before = { grams: line.grams, lot_id: line.lot_id, planned_g: line.planned_g };
    const p = plan(line);
    const planned_g = p?.estimate ? line.planned_g : (p?.grams ?? line.planned_g);
    const saved = await toast.run(() => api.patch(`/api/lines/${line.id}`, { grams, lot_id: pick.lot_id, planned_g }));
    if (!saved) return;
    void refresh(batchUrl);
    invalidate('/api/lines/recent');
    go({ name: 'pick' });
    toast.show(t('weigh.added', { name: pick.name, g: formatGrams(grams) }), async () => {
      await api.patch(`/api/lines/${line.id}`, before);
      await refresh(batchUrl);
    });
  }

  async function saveLine(pick: Chosen, grams: number) {
    if (pick.line) return savePlanned(pick, pick.line, grams);
    const id = crypto.randomUUID();
    const saved = await toast.run(() =>
      api.post(`/api/steps/${step.id}/lines`, {
        id,
        name: pick.name,
        kind: pick.kind,
        grams,
        lot_id: pick.lot_id,
        catalog_id: pick.catalog_id,
        variety_id: pick.variety_id,
        note: pick.note,
      }),
    );
    if (!saved) return;
    void refresh(batchUrl);
    // A new name created a catalog item or variety.
    for (const url of ['/api/lines/recent', '/api/catalog', '/api/varieties']) invalidate(url);
    setQuery('');
    go({ name: 'pick' });
    toast.show(t('weigh.added', { name: pick.name, g: formatGrams(grams) }), async () => {
      await api.del(`/api/lines/${id}`);
      await refresh(batchUrl);
    });
  }

  // --- Choosing an ingredient ---

  function choose(pick: Pick, line?: LineView) {
    if (!pick.kind) return go({ name: 'kind', pick });
    const chosen: Chosen = { ...pick, kind: pick.kind, lot_id: null, line };
    // A new pepper name has no variety yet; the server creates it with the line.
    if (chosen.kind !== 'pepper' || !pick.variety_id) return go({ name: 'grams', pick: chosen });
    const own = lots.filter((l) => l.variety_id === pick.variety_id).sort((a, b) => b.season - a.season);
    go({ name: 'lot', pick: chosen, lots: own });
  }

  /** A lot of this season, made on the spot; its details can be filled in under More. */
  async function newLot(pick: Chosen, origin: Lot['origin'], propagation: Lot['propagation']) {
    const id = crypto.randomUUID();
    const body = { id, variety_id: pick.variety_id, season: new Date().getFullYear(), origin, propagation };
    if (!(await toast.run(() => api.post('/api/lots', body)))) return;
    for (const url of ['/api/lots', '/api/varieties']) invalidate(url);
    go({ name: 'grams', pick: { ...pick, lot_id: id } });
  }

  async function nextFromGrams(pick: Chosen) {
    if (typed === null) return;
    const net = round2(container !== null ? typed - container : typed);
    if (net < 0) return toast.error(t('weigh.lessThanContainer'));
    await saveLine(pick, net);
  }

  // --- Screens ---

  const numpadFooter = (onBack: () => void, onNext: () => void) => (
    <NumpadFooter value={value} onChange={setValue} onBack={onBack} onNext={onNext} />
  );

  switch (stage.name) {
    case 'tare': {
      const next = () => typed !== null && void saveTare(round2(typed));
      return (
        <Screen title={t('weigh.tareTitle')} subtitle={subtitle} footer={numpadFooter(() => void leaveTare(), next)}>
          <Readout value={value} unit="g" />
        </Screen>
      );
    }

    case 'pick': {
      const { options, exact } = suggest(query, { recent, catalog, varieties }, step.type);
      const q = cleanName(query);
      const added = step.lines.filter((l) => l.grams !== null).reverse();
      const toWeigh = step.lines.filter((l) => l.grams === null);
      // A planned ingredient is weighed from its row, not added a second time.
      const chips = options.filter((o) => !toWeigh.some((l) => l.kind === o.kind && fold(l.name) === fold(o.name)));
      // Said where Done is, once something besides salt is in the jar.
      const warning =
        step.type === 'ferment' && step.lines.some((l) => l.kind !== 'salt' && l.grams !== null) ? saltWarning(saltPct(calcSteps()), targetPct) : null;
      return (
        <Screen
          title={t('weigh.whatNext')}
          subtitle={subtitle}
          footer={
            <>
              {warning && <p className="text-xl font-semibold text-destructive">{warning}</p>}
              <Button size="lg" onClick={leave}>
                {t('common.done')}
              </Button>
            </>
          }
        >
          {liveStats()}
          {method && <p className="mt-3 text-base whitespace-pre-line text-muted-foreground">{method}</p>}
          {toWeigh.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-2 text-lg text-muted-foreground">{t('weigh.toWeigh')}</h2>
              <RowList>
                {toWeigh.map((l) => (
                  <LinkRow
                    key={l.id}
                    title={l.name}
                    hint={l.kind === 'mash' ? mashHint(plan(l)) : planText(plan(l))}
                    onClick={() => choose({ name: l.name, kind: l.kind, catalog_id: l.catalog_id, variety_id: l.variety_id, note: l.note }, l)}
                  />
                ))}
              </RowList>
            </section>
          )}
          <Input
            className="my-4"
            placeholder={t('weigh.search')}
            aria-label={t('weigh.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Chips>
            {q && !exact && (
              <Chip onClick={() => choose({ name: q, kind: null, catalog_id: null, variety_id: null, note: null })}>
                {t('weigh.useName', { name: q })}
              </Chip>
            )}
            {chips.map((o) => (
              <Chip key={`${o.name}|${o.kind}`} hint={kindHint(o)} onClick={() => choose(o)}>
                {o.name}
              </Chip>
            ))}
          </Chips>
          {added.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-lg text-muted-foreground">{t('weigh.addedHere')}</h2>
              <ul className="divide-y rounded-xl border">
                {added.map((l) => (
                  <li key={l.id} className="flex justify-between gap-4 px-4 py-3 text-lg">
                    <span>{l.name}</span>
                    <span className="text-right tabular-nums">
                      {formatGrams(l.grams!)}
                      {l.planned_g !== null && (
                        <span className="block text-base text-muted-foreground">{t('weigh.plan', { g: formatGrams(l.planned_g) })}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Screen>
      );
    }

    case 'kind': {
      const { pick } = stage;
      return (
        <Screen
          title={t('weigh.whatKind', { name: pick.name })}
          subtitle={subtitle}
          footer={
            <Button variant="outline" onClick={() => go({ name: 'pick' })}>
              {t('common.back')}
            </Button>
          }
        >
          <Chips>
            {KINDS.map((kind) => (
              <Chip key={kind} onClick={() => choose({ ...pick, kind })}>
                {kindLabel(kind)}
              </Chip>
            ))}
          </Chips>
        </Screen>
      );
    }

    case 'lot': {
      const { pick } = stage;
      return (
        <Screen
          title={t('weigh.whichLot', { name: pick.name })}
          subtitle={subtitle}
          footer={
            <Button variant="outline" onClick={() => go({ name: 'pick' })}>
              {t('common.back')}
            </Button>
          }
        >
          <Chips>
            {stage.lots.map((lot) => (
              <Chip key={lot.id} hint={lot.supplier ?? undefined} onClick={() => go({ name: 'grams', pick: { ...pick, lot_id: lot.id } })}>
                {lotLabel(lot)}
              </Chip>
            ))}
            <Chip onClick={() => go({ name: 'newLot', pick })}>{t('weigh.newLot')}</Chip>
            <Chip onClick={() => go({ name: 'grams', pick })}>{t('weigh.noLot')}</Chip>
          </Chips>
        </Screen>
      );
    }

    case 'newLot': {
      const { pick } = stage;
      const choices: [Lot['origin'], Lot['propagation']][] = [['grown', 'seed'], ['grown', 'sapling'], ['bought', null], ['gift', null]];
      return (
        <Screen
          title={t('weigh.newLotTitle', { name: pick.name, season: new Date().getFullYear() })}
          subtitle={subtitle}
          footer={
            <Button variant="outline" onClick={() => choose(pick, pick.line)}>
              {t('common.back')}
            </Button>
          }
        >
          <Chips>
            {choices.map(([origin, propagation]) => (
              <Chip key={`${origin}-${propagation}`} onClick={() => void newLot(pick, origin, propagation)}>
                {capitalize(lotHow({ origin, propagation }))}
              </Chip>
            ))}
          </Chips>
          <p className="mt-4 text-lg text-muted-foreground">{t('weigh.newLotHint')}</p>
        </Screen>
      );
    }

    case 'grams': {
      const { pick } = stage;
      const net = typed === null ? null : container !== null ? typed - container : typed;
      const pending = net !== null && net >= 0 ? { name: pick.name, kind: pick.kind, grams: net, shu_min: null, shu_max: null } : undefined;
      const planned = pick.line ? plan(pick.line) : null;
      // An estimate (the mash) is no target to hit, so it gets no deviation.
      const dev = planned?.grams != null && !planned.estimate && net !== null ? deviation(round2(net), planned.grams) : null;
      return (
        // The name sits in the header so the keypad can never push it off screen.
        <Screen
          title={<span className="text-[48px] leading-[1.1] break-words">{pick.name}</span>}
          subtitle={liveStats(pending, true, pick.line?.id)}
          footer={numpadFooter(() => go({ name: 'pick' }), () => void nextFromGrams(pick))}
        >
          {pick.line ? (
            <div className="flex items-start justify-between gap-4">
              <div>
                {container !== null && <span className="block text-lg text-muted-foreground">{t('weigh.onScale')}</span>}
                <Readout value={value} unit="g" />
                {/* With a container on, the net is what's compared; it gets its own line below. */}
                {container === null && dev && <p className="text-xl tabular-nums">{dev}</p>}
              </div>
              <p className="text-right">
                <span className="block text-lg text-muted-foreground">{t(planned?.estimate ? 'weigh.about' : 'weigh.planLabel')}</span>
                <span className="text-5xl font-bold tabular-nums">{planned?.grams != null ? formatNumber(planned.grams) : '—'}</span>
                {planned?.grams != null && <span className="ml-1 text-3xl font-medium text-muted-foreground">g</span>}
                {planned?.grams == null && <span className="block text-base text-muted-foreground">{planText(planned)}</span>}
              </p>
            </div>
          ) : (
            <>
              {container !== null && <span className="block text-lg text-muted-foreground">{t('weigh.onScale')}</span>}
              <Readout value={value} unit="g" />
            </>
          )}
          {container !== null && net !== null && (
            <p className="mt-2 text-4xl font-bold tabular-nums">
              {t('weigh.net', { g: formatGrams(round2(net)) })}
              {dev && <span className="ml-3 text-xl font-normal">{dev}</span>}
            </p>
          )}
          {container !== null && <p className="mt-1 text-lg text-muted-foreground">{t('weigh.containerHint', { g: formatGrams(container) })}</p>}
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => (container === null ? go({ name: 'container', pick }) : setContainer(null))}
          >
            {container === null ? t('weigh.containerOn') : t('weigh.containerOff', { g: formatGrams(container) })}
          </Button>
        </Screen>
      );
    }

    case 'container': {
      const { pick } = stage;
      const next = () => {
        if (typed === null) return;
        setContainer(round2(typed));
        go({ name: 'grams', pick });
      };
      return (
        <Screen title={t('weigh.containerTitle')} subtitle={subtitle} footer={numpadFooter(() => go({ name: 'grams', pick }), next)}>
          <Readout value={value} unit="g" />
        </Screen>
      );
    }
  }
}
