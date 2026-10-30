// Edit batch (SPEC §8.2 item 5): every field, the manual status override,
// and steps and lines with their own edit screens. Destructive edits live
// only here (SPEC §8.1 item 4), and each one offers Undo. Weights open the
// numpad; nothing else in a flow needs it.
import { useState } from 'react';
import { BATCH_STATUSES, STEP_TYPES } from '../../shared/schemas.ts';
import { cleanName } from '../../shared/names.ts';
import { Chip, Chips } from '@/components/Chip';
import { ColorChips } from '@/components/ColorChips';
import { DatePick } from '@/components/DatePick';
import { LinkRow, NumberField, RowList, Section, TextField, usePatch } from '@/components/Edit';
import { NumpadFooter, Readout } from '@/components/Numpad';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatDay } from '@/lib/format';
import { kindLabel, statusLabel, stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, parseDecimal } from '@/lib/numbers';
import { invalidate, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import { suggest, type Pick } from '@/lib/suggest';
import type { BatchView, CatalogItem, LineView, Lot, RecentLine, StepView, Variety } from '@/lib/types';
import { lotTitle } from '@/screens/Entries';

const REFRESH = ['/api/batches', '/api/lines/recent'];

function Missing({ loading, back }: { loading: boolean; back: () => void }) {
  return (
    <Screen
      title={loading ? t('common.loading') : t('app.notFound')}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.back')}
        </Button>
      }
    />
  );
}

/** A weight typed on the numpad, as its own screen. */
function GramsStage(props: { title: string; subtitle?: string; initial: number | null; onBack: () => void; onDone: (g: number) => void }) {
  const [value, setValue] = useState(props.initial === null ? '' : String(props.initial));
  const grams = parseDecimal(value);
  return (
    <Screen
      title={<span className="text-[48px] leading-[1.1] break-words">{props.title}</span>}
      subtitle={props.subtitle}
      footer={<NumpadFooter value={value} onChange={setValue} onBack={props.onBack} onNext={() => grams !== null && props.onDone(grams)} />}
    >
      <Readout value={value} unit="g" />
    </Screen>
  );
}

function useBatch(id: string) {
  const query = useQuery<BatchView>(`/api/batches/${id}`);
  return { batch: query.data, loading: query.data === undefined && query.error === undefined };
}

export function BatchEdit({ id }: { id: string }) {
  const toast = useToast();
  const url = `/api/batches/${id}`;
  const { batch, loading } = useBatch(id);
  const save = usePatch(url, REFRESH);
  const back = () => goBack(`/b/${id}`);
  if (!batch) return <Missing loading={loading} back={back} />;
  const b = batch;
  const statusBefore = { status: b.status_manual ? b.status : null };
  const finished = b.status === 'bottled' || b.status === 'archived';

  async function remove() {
    if (!(await toast.run(() => api.del(url).then(() => true)))) return;
    invalidate('/api/batches');
    navigate('/', { replace: true });
    toast.show(t('batchEdit.deleted', { n: b.number }), async () => {
      await api.post(`${url}/restore`, {});
      invalidate('/api/batches');
      navigate(`/b/${id}`);
    });
  }

  return (
    <Screen
      title={t('batchEdit.title', { n: b.number })}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.done')}
        </Button>
      }
    >
      <Section>
        <NumberField
          label={t('new.number')}
          value={b.number}
          integer
          min={1}
          max={1_000_000}
          required
          onSave={(number) => save({ number }, { number: b.number })}
        />
      </Section>
      <Section>
        <TextField label={t('batchEdit.name')} value={b.name} onSave={(name) => save({ name }, { name: b.name })} />
      </Section>
      <Section title={t('new.color')}>
        <ColorChips value={b.color} onChange={(color) => void save({ color }, { color: b.color })} />
      </Section>

      <Section title={t('batchEdit.status')}>
        <Chips>
          <Chip selected={!b.status_manual} hint={b.status_manual ? undefined : statusLabel(b.status)} onClick={() => void save({ status: null }, statusBefore)}>
            {t('batchEdit.statusAuto')}
          </Chip>
          {BATCH_STATUSES.map((s) => (
            <Chip key={s} selected={b.status_manual && b.status === s} onClick={() => void save({ status: s }, statusBefore)}>
              {statusLabel(s)}
            </Chip>
          ))}
        </Chips>
      </Section>

      <Section title={t('detail.steps')}>
        <RowList>
          {b.steps.map((s) => (
            <LinkRow
              key={s.id}
              title={stepTypeLabel(s.type)}
              hint={[s.date ? formatDay(s.date) : t('stepEdit.noDate'), t('stepEdit.lines', { n: s.lines.length })].join(' · ')}
              onClick={() => navigate(`/b/${id}/s/${s.id}/edit`)}
            />
          ))}
        </RowList>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => navigate(`/b/${id}/add-step`)}>
          {t('detail.addStep')}
        </Button>
      </Section>

      <Section>
        <TextField label={t('batchEdit.notes')} value={b.notes_md || null} multiline onSave={(notes) => save({ notes_md: notes ?? '' }, { notes_md: b.notes_md })} />
      </Section>

      <Section title={t('edit.delete')}>
        {finished ? (
          <p className="text-base text-muted-foreground">{t('batchEdit.cantDelete')}</p>
        ) : (
          <Button variant="destructive" className="w-full" onClick={() => void remove()}>
            {t('batchEdit.delete', { n: b.number })}
          </Button>
        )}
      </Section>
    </Screen>
  );
}

/** The POST body that recreates a line exactly, for Undo of a delete. */
function lineBody(l: LineView) {
  return {
    id: l.id,
    position: l.position,
    name: l.name,
    kind: l.kind,
    grams: l.grams,
    planned_g: l.planned_g,
    lot_id: l.lot_id,
    catalog_id: l.catalog_id,
    variety_id: l.variety_id,
    note: l.note,
    shu_min: l.shu_min,
    shu_max: l.shu_max,
    shu_source: l.shu_source,
  };
}

export function StepEdit({ batchId, stepId }: { batchId: string; stepId: string }) {
  const toast = useToast();
  const { batch, loading } = useBatch(batchId);
  const save = usePatch(`/api/steps/${stepId}`, REFRESH);
  const [weighing, setWeighing] = useState<'vessel_tare_g' | 'removed_g' | null>(null);
  const editUrl = `/b/${batchId}/edit`;
  const back = () => goBack(editUrl);
  const step = batch?.steps.find((s) => s.id === stepId);
  if (!batch || !step) return <Missing loading={loading} back={back} />;
  const s: StepView = step;
  const params = s.params as Record<string, unknown>;
  const setParam = (key: string, value: unknown) => save({ params: { ...params, [key]: value } }, { params });

  if (weighing) {
    return (
      <GramsStage
        title={t(weighing === 'vessel_tare_g' ? 'stepEdit.tareTitle' : 'stepEdit.removedTitle')}
        subtitle={`#${batch.number} · ${stepTypeLabel(s.type)}`}
        initial={(params[weighing] as number | null | undefined) ?? null}
        onBack={() => setWeighing(null)}
        onDone={(g) => {
          setWeighing(null);
          void setParam(weighing, g);
        }}
      />
    );
  }

  async function remove() {
    if (!(await toast.run(() => api.del(`/api/steps/${s.id}`).then(() => true)))) return;
    invalidate('/api/batches');
    back();
    // Undo recreates the step and its lines under the same ids.
    toast.show(t('stepEdit.deleted', { type: stepTypeLabel(s.type) }), async () => {
      await api.post(`/api/batches/${batchId}/steps`, { id: s.id, type: s.type, position: s.position, date: s.date, params, note: s.note });
      for (const l of s.lines) await api.post(`/api/steps/${s.id}/lines`, lineBody(l));
      invalidate('/api/batches');
    });
  }

  const grams = (key: string) => {
    const g = params[key];
    return typeof g === 'number' ? formatGrams(g) : null;
  };

  return (
    <Screen
      title={stepTypeLabel(s.type)}
      subtitle={`#${batch.number}`}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.done')}
        </Button>
      }
    >
      {s.type !== 'ferment' && (
        <Section title={t('stepEdit.type')}>
          <Chips>
            {STEP_TYPES.filter((type) => type !== 'ferment').map((type) => (
              <Chip key={type} selected={s.type === type} onClick={() => void save({ type }, { type: s.type, params })}>
                {stepTypeLabel(type)}
              </Chip>
            ))}
          </Chips>
        </Section>
      )}
      <Section title={t('step.date')}>
        <DatePick value={s.date} onChange={(date) => void save({ date }, { date: s.date })} />
      </Section>

      {s.type === 'ferment' && (
        <Section title={t('stepEdit.tare')}>
          <Button variant="outline" className="w-full" onClick={() => setWeighing('vessel_tare_g')}>
            {grams('vessel_tare_g') ?? t('stepEdit.noTare')}
          </Button>
        </Section>
      )}
      {s.type === 'ferment' && (
        <Section title={t('new.container')}>
          <Chips>
            <Chip selected={params.needs_burping !== true} hint={t('new.selfVentingHint')} onClick={() => void setParam('needs_burping', false)}>
              {t('new.selfVenting')}
            </Chip>
            <Chip selected={params.needs_burping === true} hint={t('new.needsBurpingHint')} onClick={() => void setParam('needs_burping', true)}>
              {t('new.needsBurping')}
            </Chip>
          </Chips>
        </Section>
      )}
      {s.type === 'cook' && (
        <Section>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t('stepEdit.temp')} value={(params.temp_c as number | undefined) ?? null} min={-50} max={500} onSave={(v) => setParam('temp_c', v)} />
            <NumberField label={t('stepEdit.minutes')} value={(params.minutes as number | undefined) ?? null} max={100_000} onSave={(v) => setParam('minutes', v)} />
          </div>
        </Section>
      )}
      {s.type === 'strain' && (
        <Section title={t('stepEdit.removed')}>
          <Button variant="outline" className="w-full" onClick={() => setWeighing('removed_g')}>
            {grams('removed_g') ?? t('stepEdit.notWeighed')}
          </Button>
        </Section>
      )}

      <Section title={t('stepEdit.ingredients')}>
        {s.lines.length > 0 && (
          <div className="mb-3">
            <RowList>
              {s.lines.map((l) => (
                <LinkRow
                  key={l.id}
                  title={l.name}
                  hint={l.grams === null ? t('lineEdit.notWeighed') : formatGrams(l.grams)}
                  onClick={() => navigate(`/b/${batchId}/l/${l.id}`)}
                />
              ))}
            </RowList>
          </div>
        )}
        <Button variant="secondary" className="w-full" onClick={() => navigate(`/b/${batchId}/s/${s.id}`)}>
          {t('detail.addIngredients')}
        </Button>
      </Section>

      <Section>
        <TextField label={t('edit.notes')} value={s.note} multiline onSave={(note) => save({ note }, { note: s.note })} />
      </Section>

      <Section title={t('edit.delete')}>
        <Button variant="destructive" className="w-full" onClick={() => void remove()}>
          {t('stepEdit.delete', { type: stepTypeLabel(s.type) })}
        </Button>
      </Section>
    </Screen>
  );
}

export function LineEdit({ batchId, lineId }: { batchId: string; lineId: string }) {
  const toast = useToast();
  const { batch, loading } = useBatch(batchId);
  const catalog = useQuery<CatalogItem[]>('/api/catalog').data ?? [];
  const varieties = useQuery<Variety[]>('/api/varieties').data ?? [];
  const lots = useQuery<Lot[]>('/api/lots').data ?? [];
  const recent = useQuery<RecentLine[]>('/api/lines/recent').data ?? [];
  const save = usePatch(`/api/lines/${lineId}`, [...REFRESH, '/api/catalog', '/api/varieties']);
  const [weighing, setWeighing] = useState(false);
  const [query, setQuery] = useState('');
  const step = batch?.steps.find((s) => s.lines.some((l) => l.id === lineId));
  const line = step?.lines.find((l) => l.id === lineId);
  const back = () => goBack(step ? `/b/${batchId}/s/${step.id}/edit` : `/b/${batchId}/edit`);
  if (!batch || !step || !line) return <Missing loading={loading} back={back} />;
  const l = line;
  const subtitle = `#${batch.number} · ${stepTypeLabel(step.type)} · ${kindLabel(l.kind)}`;

  if (weighing) {
    return (
      <GramsStage
        title={l.name}
        subtitle={subtitle}
        initial={l.grams}
        onBack={() => setWeighing(false)}
        onDone={(grams) => {
          setWeighing(false);
          void save({ grams }, { grams: l.grams });
        }}
      />
    );
  }

  const identity = { name: l.name, kind: l.kind, catalog_id: l.catalog_id, variety_id: l.variety_id, lot_id: l.lot_id };
  async function change(pick: Pick) {
    const note = pick.note ? [l.note, pick.note].filter(Boolean).join('; ') : l.note;
    const body = { name: pick.name, kind: pick.kind ?? l.kind, catalog_id: pick.catalog_id, variety_id: pick.variety_id, lot_id: null, note };
    if (await save(body, { ...identity, note: l.note }, t('lineEdit.changed', { name: pick.name }))) setQuery('');
  }

  async function remove() {
    if (!(await toast.run(() => api.del(`/api/lines/${l.id}`).then(() => true)))) return;
    invalidate('/api/batches');
    back();
    toast.show(t('lineEdit.deleted', { name: l.name }), async () => {
      await api.post(`/api/steps/${step!.id}/lines`, lineBody(l));
      invalidate('/api/batches');
    });
  }

  const { options, exact } = suggest(query, { recent, catalog, varieties }, step.type);
  const typed = cleanName(query);
  const ownLots = lots.filter((lot) => lot.variety_id === l.variety_id).sort((a, b) => b.season - a.season);

  return (
    <Screen
      title={l.name}
      subtitle={subtitle}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.done')}
        </Button>
      }
    >
      <Section title={t('lineEdit.grams')}>
        <Button variant="outline" className="h-20 w-full text-4xl font-bold tabular-nums" onClick={() => setWeighing(true)}>
          {l.grams === null ? t('lineEdit.notWeighed') : formatGrams(l.grams)}
        </Button>
      </Section>

      {l.kind === 'pepper' && (
        <>
          <Section title={t('lineEdit.lot')}>
            <Chips>
              {ownLots.map((lot) => (
                <Chip key={lot.id} selected={l.lot_id === lot.id} hint={lot.supplier ?? undefined} onClick={() => void save({ lot_id: lot.id }, { lot_id: l.lot_id })}>
                  {lotTitle(lot)}
                </Chip>
              ))}
              <Chip selected={l.lot_id === null} onClick={() => void save({ lot_id: null }, { lot_id: l.lot_id })}>
                {t('weigh.noLot')}
              </Chip>
            </Chips>
          </Section>
          <Section title={t('lineEdit.shuOverride')}>
            <p className="mb-2 text-base text-muted-foreground">{t('lineEdit.shuOverrideHint')}</p>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={t('varieties.shuMin')} value={l.shu_min} max={5_000_000} onSave={(shu_min) => save({ shu_min }, { shu_min: l.shu_min })} />
              <NumberField label={t('varieties.shuMax')} value={l.shu_max} max={5_000_000} onSave={(shu_max) => save({ shu_max }, { shu_max: l.shu_max })} />
            </div>
          </Section>
        </>
      )}

      <Section>
        <TextField label={t('edit.notes')} value={l.note} multiline onSave={(note) => save({ note }, { note: l.note })} />
      </Section>

      <Section title={t('lineEdit.change')}>
        <Input placeholder={t('weigh.search')} aria-label={t('lineEdit.change')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query.trim() && (
          <div className="mt-3">
            <Chips>
              {options
                .filter((o) => (o.catalog_id ?? o.variety_id) !== (l.catalog_id ?? l.variety_id))
                .map((o) => (
                  <Chip key={o.catalog_id ?? o.variety_id ?? o.name} hint={o.kind ? kindLabel(o.kind) : undefined} onClick={() => void change(o)}>
                    {o.name}
                  </Chip>
                ))}
              {/* Last, so a typo meets the entry it meant before a new spelling of it. */}
              {typed && !exact && (
                <Chip onClick={() => void change({ name: typed, kind: l.kind, catalog_id: null, variety_id: null, note: null })}>
                  {t('weigh.useName', { name: typed })}
                </Chip>
              )}
            </Chips>
          </div>
        )}
      </Section>

      <Section title={t('edit.delete')}>
        <Button variant="destructive" className="w-full" onClick={() => void remove()}>
          {t('edit.deleteName', { name: l.name })}
        </Button>
      </Section>
    </Screen>
  );
}
