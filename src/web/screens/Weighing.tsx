// Weighing mode for one step (SPEC §8.1 item 6, §8.2 items 2–3). A ferment
// step opens with the empty crock on the scale (crocks aren't saved, SPEC
// §15.2); then one ingredient per screen: pick a name, its kind and lot if
// needed, type the grams, Next.
// Each line is saved on Next; salt % and suggested salt update live.
import { useState } from 'react';
import { bases, saltPct, suggestedSaltG, type CalcLine, type CalcStep } from '../../shared/calc.ts';
import { cleanName } from '../../shared/names.ts';
import { KINDS, type Kind } from '../../shared/schemas.ts';
import { Chip, Chips } from '@/components/Chip';
import { NumpadFooter, Readout } from '@/components/Numpad';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { kindLabel, stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, formatPct, parseDecimal } from '@/lib/numbers';
import { invalidate, refresh, useQuery } from '@/lib/query';
import { goBack } from '@/lib/router';
import { suggest, type Pick } from '@/lib/suggest';
import type { BatchView, CatalogItem, Lot, RecentLine, Settings, StepView, Variety } from '@/lib/types';

type Chosen = Pick & { kind: Kind; lot_id: string | null };

type Stage =
  | { name: 'tare' }
  | { name: 'pick' }
  | { name: 'kind'; pick: Pick }
  | { name: 'lot'; pick: Chosen; lots: Lot[] }
  | { name: 'grams'; pick: Chosen }
  | { name: 'container'; pick: Chosen };

export function Weighing({ batchId, stepId }: { batchId: string; stepId: string }) {
  const { data: batch, error } = useQuery<BatchView>(`/api/batches/${batchId}`);
  const step = batch?.steps.find((s) => s.id === stepId);
  if (!batch || !step) {
    return (
      <Screen
        title={error || batch ? t('app.notFound') : t('common.loading')}
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

function lotLabel(lot: Lot): string {
  const how = [t(`origin.${lot.origin}`), ...(lot.propagation ? [t(`propagation.${lot.propagation}`)] : [])];
  return `${lot.season} · ${how.join(' ')}`;
}

function WeighingFlow({ batch, step }: { batch: BatchView; step: StepView }) {
  const toast = useToast();
  const batchUrl = `/api/batches/${batch.id}`;
  const catalog = useQuery<CatalogItem[]>('/api/catalog').data ?? [];
  const varieties = useQuery<Variety[]>('/api/varieties').data ?? [];
  const lots = useQuery<Lot[]>('/api/lots').data ?? [];
  const recent = useQuery<RecentLine[]>('/api/lines/recent').data ?? [];
  const targetPct = useQuery<Settings>('/api/settings').data?.target_salt_pct ?? 3;

  const needsTare = step.type === 'ferment' && step.params.vessel_tare_g == null && step.lines.length === 0;
  const [stage, setStage] = useState<Stage>(needsTare ? { name: 'tare' } : { name: 'pick' });
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const [container, setContainer] = useState<number | null>(null);

  const go = (next: Stage) => {
    setValue('');
    setStage(next);
  };
  const leave = () => goBack(`/b/${batch.id}`);
  const subtitle = `#${batch.number} · ${stepTypeLabel(step.type)}`;
  const typed = parseDecimal(value);

  // --- Live numbers (SPEC §8.2 item 2) ---

  function calcSteps(extra?: CalcLine): CalcStep[] {
    return batch.steps.map((s) => ({
      type: s.type,
      position: s.position,
      date: s.date,
      lines: [
        ...s.lines.map((l) => ({ name: l.name, kind: l.kind, grams: l.grams, shu_min: l.shu?.min ?? null, shu_max: l.shu?.max ?? null })),
        ...(extra && s.id === step.id ? [extra] : []),
      ],
    }));
  }

  function liveStats(pending?: CalcLine, compact = false) {
    const steps = calcSteps(pending);
    if (step.type !== 'ferment') {
      return <p className="text-lg text-muted-foreground">{t('weigh.additions', { g: formatGrams(bases(steps).sauce) })}</p>;
    }
    const pct = saltPct(steps);
    const suggested = suggestedSaltG(steps, targetPct);
    const salt = pct === null ? t('weigh.saltNone') : t('weigh.saltNow', { pct: formatPct(pct) });
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
        <p className="text-2xl font-semibold tabular-nums">{salt}</p>
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

  async function saveLine(pick: Chosen, grams: number) {
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

  function choose(pick: Pick) {
    if (!pick.kind) return go({ name: 'kind', pick });
    const chosen: Chosen = { ...pick, kind: pick.kind, lot_id: null };
    if (chosen.kind !== 'pepper') return go({ name: 'grams', pick: chosen });
    // A new pepper name has no variety or lots yet; the server creates the variety.
    const own = lots.filter((l) => l.variety_id === pick.variety_id).sort((a, b) => b.season - a.season);
    if (own.length === 0) return go({ name: 'grams', pick: chosen });
    go({ name: 'lot', pick: chosen, lots: own });
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
        <Screen title={t('weigh.tareTitle')} subtitle={subtitle} footer={numpadFooter(leave, next)}>
          <Readout value={value} unit="g" />
        </Screen>
      );
    }

    case 'pick': {
      const { options, exact } = suggest(query, { recent, catalog, varieties }, step.type);
      const q = cleanName(query);
      const added = [...step.lines].reverse();
      return (
        <Screen
          title={t('weigh.whatNext')}
          subtitle={subtitle}
          footer={
            <Button size="lg" onClick={leave}>
              {t('common.done')}
            </Button>
          }
        >
          {liveStats()}
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
            {options.map((o) => (
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
                    <span className="tabular-nums">{l.grams === null ? '—' : formatGrams(l.grams)}</span>
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
            <Chip onClick={() => go({ name: 'grams', pick })}>{t('weigh.noLot')}</Chip>
          </Chips>
        </Screen>
      );
    }

    case 'grams': {
      const { pick } = stage;
      const net = typed === null ? null : container !== null ? typed - container : typed;
      const pending = net !== null && net >= 0 ? { name: pick.name, kind: pick.kind, grams: net, shu_min: null, shu_max: null } : undefined;
      return (
        // The name sits in the header so the keypad can never push it off screen.
        <Screen
          title={<span className="text-[48px] leading-[1.1] break-words">{pick.name}</span>}
          subtitle={liveStats(pending, true)}
          footer={numpadFooter(() => go({ name: 'pick' }), () => void nextFromGrams(pick))}
        >
          <Readout value={value} unit="g" />
          {container !== null && net !== null && (
            <p className="text-2xl font-semibold tabular-nums">{t('weigh.net', { g: formatGrams(round2(net)) })}</p>
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
