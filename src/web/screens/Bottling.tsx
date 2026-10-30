// Bottling checklist (SPEC §8.2 item 4, §15.2), one thing per screen:
// confirm the additions are all in, the fills (saved bottle types or one-off
// bottles), the batch colour (of the caps or labels, SPEC §15.5), pH or why
// it wasn't measured, at least one photo, then the optional leftover and
// measured total. Saving creates the `bottled` event and sets the colour.
// The answers are kept on the device as they are given, so leaving half-way
// loses nothing (SPEC §8.1 item 13).
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bottledVolumeMl } from '../../shared/calc.ts';
import { Chip, Chips } from '@/components/Chip';
import { ColorChips, colorName } from '@/components/ColorChips';
import { ColorDot, PhLabel } from '@/components/Labels';
import { NumpadFooter, Readout } from '@/components/Numpad';
import { PhotoButton } from '@/components/PhotoButton';
import { ActionRow, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, formatMl, formatNumber, parseDecimal } from '@/lib/numbers';
import { invalidate, missingTitle, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import { readLocal, writeLocal } from '@/lib/storage';
import type { BatchView, BottleType, Fill } from '@/lib/types';
import { useWakeLock } from '@/lib/wakelock';
import { fillName } from '@/screens/BatchDetail';

interface Draft {
  confirmed: boolean;
  fills: Fill[];
  /** The batch colour chosen here; undefined until that screen is passed. */
  color?: string | null;
  ph: number | null;
  phReason: string | null;
  /** Photo events taken in this flow. */
  photos: string[];
  leftover_g: number | null;
  total_g: number | null;
}

const EMPTY: Draft = { confirmed: false, fills: [], ph: null, phReason: null, photos: [], leftover_g: null, total_g: null };

type NewFill = { bottle_type_id: string } | { volume_ml: number };

type Stage =
  | { name: 'check' }
  | { name: 'fills' }
  | { name: 'count'; fill: NewFill; title: string }
  | { name: 'oneOffVolume' }
  | { name: 'label'; index: number }
  | { name: 'newTypeName' }
  | { name: 'newTypeVolume'; typeName: string }
  | { name: 'color' }
  | { name: 'ph' }
  | { name: 'phReason' }
  | { name: 'photo' }
  | { name: 'extras' }
  | { name: 'leftover' }
  | { name: 'total' }
  | { name: 'review' };

function readDraft(key: string): Draft {
  try {
    return { ...EMPTY, ...(JSON.parse(readLocal(key) ?? 'null') as Partial<Draft> | null) };
  } catch {
    return EMPTY;
  }
}

/** Where to pick up a half-done checklist: the first answer still missing. */
function resume(d: Draft): Stage {
  if (!d.confirmed) return { name: 'check' };
  if (d.fills.length === 0) return { name: 'fills' };
  if (d.color === undefined) return { name: 'color' };
  if (d.ph === null && !d.phReason) return { name: 'ph' };
  if (d.photos.length === 0) return { name: 'photo' };
  return { name: 'review' };
}

export function Bottling({ id }: { id: string }) {
  const { data: batch, error } = useQuery<BatchView>(`/api/batches/${id}`);
  if (!batch) {
    return (
      <Screen
        title={missingTitle(error)}
        footer={
          <Button variant="outline" onClick={() => goBack(`/b/${id}`)}>
            {t('common.back')}
          </Button>
        }
      />
    );
  }
  return <BottlingFlow batch={batch} />;
}

function BottlingFlow({ batch }: { batch: BatchView }) {
  useWakeLock();
  const toast = useToast();
  const bottleTypes = useQuery<BottleType[]>('/api/bottle-types').data ?? [];
  const key = `bottle-draft:${batch.id}`;
  const detail = `/b/${batch.id}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key));
  const [stage, setStage] = useState<Stage>(() => resume(readDraft(key)));
  const [value, setValue] = useState('');
  const [text, setText] = useState('');
  useEffect(() => writeLocal(key, JSON.stringify(draft)), [key, draft]);

  // A photo deleted since (Undo, or on the detail screen) no longer counts.
  const photoIds = new Set(batch.events.filter((e) => e.type === 'photo').map((e) => e.id));
  const photos = draft.photos.filter((p) => photoIds.has(p));
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const go = (next: Stage) => {
    setValue('');
    setText('');
    setStage(next);
  };
  const typed = parseDecimal(value);
  const volume = bottledVolumeMl({ fills: draft.fills }, (typeId) => bottleTypes.find((b) => b.id === typeId)?.volume_ml);
  const subtitle = `#${batch.number} · ${t('bottle.title')}`;
  const back = (onBack: () => void) => (
    <Button variant="outline" className="h-16" onClick={onBack}>
      {t('common.back')}
    </Button>
  );
  const numpad = (onBack: () => void, onNext: () => void, opts: { decimals?: number; maxInt?: number; nextLabel?: string } = {}) => (
    <NumpadFooter value={value} onChange={setValue} onBack={onBack} onNext={onNext} {...opts} />
  );

  async function createType(name: string, volumeMl: number) {
    const typeId = crypto.randomUUID();
    if (!(await toast.run(() => api.post('/api/bottle-types', { id: typeId, name, volume_ml: volumeMl })))) return;
    invalidate('/api/bottle-types');
    go({ name: 'count', fill: { bottle_type_id: typeId }, title: name });
  }

  async function save() {
    const eventId = crypto.randomUUID();
    const payload = {
      fills: draft.fills,
      ph: draft.ph,
      ph_not_measured_reason: draft.ph === null ? draft.phReason : null,
      leftover_g: draft.leftover_g,
      total_g: draft.total_g,
    };
    const color = draft.color === undefined ? batch.color : draft.color;
    const colorBefore = batch.color;
    const saved = await toast.run(async () => {
      if (color !== colorBefore) await api.patch(`/api/batches/${batch.id}`, { color });
      return api.post(`/api/batches/${batch.id}/events`, { id: eventId, type: 'bottled', payload });
    });
    if (!saved) return;
    writeLocal(key, null);
    invalidate('/api/batches');
    goBack(detail);
    toast.show(t('bottle.saved', { n: batch.number }), async () => {
      await api.del(`/api/events/${eventId}`);
      if (color !== colorBefore) await api.patch(`/api/batches/${batch.id}`, { color: colorBefore });
      writeLocal(key, JSON.stringify(draft));
      invalidate('/api/batches');
    });
  }

  switch (stage.name) {
    case 'check':
      return (
        <Screen
          title={t('bottle.checkTitle')}
          subtitle={subtitle}
          footer={
            <ActionRow>
              {back(() => goBack(detail))}
              <Button
                size="lg"
                onClick={() => {
                  update({ confirmed: true });
                  go(resume({ ...draft, confirmed: true }));
                }}
              >
                {t('bottle.allIn')}
              </Button>
            </ActionRow>
          }
        >
          <p className="mb-4 text-lg text-muted-foreground">{t('bottle.checkHint')}</p>
          {batch.steps.map((s) => (
            <section key={s.id} className="mb-3 rounded-xl border bg-card px-4 py-3">
              <h2 className="text-xl font-semibold">{stepTypeLabel(s.type)}</h2>
              <p className="text-lg text-muted-foreground">
                {s.lines.map((l) => `${l.name} ${l.grams === null ? t('bottle.notWeighed') : formatGrams(l.grams)}`).join(' · ') || t('bottle.noLines')}
              </p>
            </section>
          ))}
        </Screen>
      );

    case 'fills':
      return (
        <Screen
          title={t('bottle.fillsTitle')}
          subtitle={draft.fills.length > 0 ? t('bottle.volume', { ml: formatNumber(volume) }) : subtitle}
          footer={
            <ActionRow>
              {back(() => go({ name: 'check' }))}
              <Button size="lg" disabled={draft.fills.length === 0} onClick={() => go({ name: 'color' })}>
                {t('common.next')}
              </Button>
            </ActionRow>
          }
        >
          {draft.fills.length > 0 && (
            <ul className="mb-4 flex flex-col gap-3">
              {draft.fills.map((f, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border bg-card py-1 pr-1 pl-4 text-lg">
                  <span className="flex-1">{t('detail.fills', { count: f.count, bottle: fillName(f, bottleTypes) })}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('bottle.removeFill')}
                    onClick={() => {
                      const before = draft.fills;
                      update({ fills: before.filter((_, j) => j !== i) });
                      toast.show(t('bottle.fillRemoved'), () => update({ fills: before }));
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <h2 className="mb-2 text-lg text-muted-foreground">{t('bottle.addFill')}</h2>
          <Chips>
            {bottleTypes.map((b) => (
              <Chip key={b.id} hint={formatMl(b.volume_ml)} onClick={() => go({ name: 'count', fill: { bottle_type_id: b.id }, title: b.name })}>
                {b.name}
              </Chip>
            ))}
            <Chip onClick={() => go({ name: 'oneOffVolume' })}>{t('bottle.oneOff')}</Chip>
            <Chip onClick={() => go({ name: 'newTypeName' })}>{t('bottle.newType')}</Chip>
          </Chips>
        </Screen>
      );

    case 'count': {
      const { fill } = stage;
      const next = () => {
        if (typed === null || typed < 1) return;
        const fills = [...draft.fills, { ...fill, count: typed } as Fill];
        update({ fills });
        go('volume_ml' in fill ? { name: 'label', index: fills.length - 1 } : { name: 'fills' });
      };
      return (
        <Screen title={t('bottle.howMany', { name: stage.title })} subtitle={subtitle} footer={numpad(() => go({ name: 'fills' }), next, { decimals: 0, maxInt: 3 })}>
          <Readout value={value} />
        </Screen>
      );
    }

    case 'oneOffVolume': {
      const next = () => typed !== null && typed > 0 && go({ name: 'count', fill: { volume_ml: typed }, title: t('bottle.oneOffOf', { ml: formatNumber(typed) }) });
      return (
        <Screen title={t('bottle.oneOffVolume')} subtitle={subtitle} footer={numpad(() => go({ name: 'fills' }), next, { decimals: 0, maxInt: 5 })}>
          <Readout value={value} unit="ml" />
        </Screen>
      );
    }

    case 'label': {
      const { index } = stage;
      const finish = (label: string | null) => {
        if (label) update({ fills: draft.fills.map((f, i) => (i === index ? { ...f, label } : f)) });
        go({ name: 'fills' });
      };
      return (
        <Screen
          title={t('bottle.labelTitle')}
          subtitle={subtitle}
          footer={
            <ActionRow>
              <Button variant="outline" className="h-16" onClick={() => finish(null)}>
                {t('bottle.skip')}
              </Button>
              <Button size="lg" disabled={!text.trim()} onClick={() => finish(text.trim())}>
                {t('common.next')}
              </Button>
            </ActionRow>
          }
        >
          <Input autoFocus placeholder={t('bottle.labelHint')} aria-label={t('bottle.labelTitle')} value={text} onChange={(e) => setText(e.target.value)} />
        </Screen>
      );
    }

    case 'newTypeName':
      return (
        <Screen
          title={t('bottle.newTypeName')}
          subtitle={subtitle}
          footer={
            <ActionRow>
              {back(() => go({ name: 'fills' }))}
              <Button size="lg" disabled={!text.trim()} onClick={() => go({ name: 'newTypeVolume', typeName: text.trim() })}>
                {t('common.next')}
              </Button>
            </ActionRow>
          }
        >
          <Input autoFocus placeholder={t('edit.name')} aria-label={t('bottle.newTypeName')} value={text} onChange={(e) => setText(e.target.value)} />
        </Screen>
      );

    case 'newTypeVolume': {
      const next = () => typed !== null && typed > 0 && void createType(stage.typeName, typed);
      return (
        <Screen title={t('bottle.typeVolume', { name: stage.typeName })} subtitle={subtitle} footer={numpad(() => go({ name: 'newTypeName' }), next, { decimals: 0, maxInt: 5 })}>
          <Readout value={value} unit="ml" />
        </Screen>
      );
    }

    case 'color': {
      const color = draft.color === undefined ? batch.color : draft.color;
      return (
        <Screen
          title={t('bottle.colorTitle')}
          subtitle={t('bottle.colorHint')}
          footer={
            <ActionRow>
              {back(() => go({ name: 'fills' }))}
              <Button
                size="lg"
                onClick={() => {
                  const d = { ...draft, color };
                  update(d);
                  go(d.ph === null && !d.phReason ? { name: 'ph' } : resume(d));
                }}
              >
                {t('common.next')}
              </Button>
            </ActionRow>
          }
        >
          <ColorChips value={color} onChange={(c) => update({ color: c })} />
        </Screen>
      );
    }

    case 'ph': {
      const next = () => {
        if (typed === null) return;
        if (typed > 14) return toast.error(t('ph.outOfRange'));
        const d = { ...draft, ph: typed, phReason: null };
        update(d);
        go(d.photos.length === 0 ? { name: 'photo' } : resume(d));
      };
      return (
        <Screen title={t('bottle.phTitle')} subtitle={subtitle} footer={numpad(() => go({ name: 'color' }), next, { maxInt: 2 })}>
          <Chips>
            <Chip onClick={() => go({ name: 'phReason' })}>{t('bottle.notMeasured')}</Chip>
            <Chip onClick={() => navigate('/ph-info')}>{t('ph.whatMeans')}</Chip>
          </Chips>
          <div className="mt-3">
        <Readout value={value} label="pH" below={typed !== null && typed <= 14 && <PhLabel value={typed} className="text-lg tracking-normal text-lcd-foreground normal-case" />} />
          </div>
        </Screen>
      );
    }

    case 'phReason':
      return (
        <Screen
          title={t('bottle.whyNot')}
          subtitle={subtitle}
          footer={
            <ActionRow>
              {back(() => go({ name: 'ph' }))}
              <Button
                size="lg"
                disabled={!text.trim()}
                onClick={() => {
                  const d = { ...draft, ph: null, phReason: text.trim() };
                  update(d);
                  go(d.photos.length === 0 ? { name: 'photo' } : resume(d));
                }}
              >
                {t('common.next')}
              </Button>
            </ActionRow>
          }
        >
          <Input autoFocus placeholder={t('bottle.whyNotHint')} aria-label={t('bottle.whyNot')} value={text} onChange={(e) => setText(e.target.value)} />
        </Screen>
      );

    case 'photo':
      return (
        <Screen
          title={t('bottle.photoTitle')}
          subtitle={t('bottle.photos', { n: photos.length })}
          footer={
            <>
              <PhotoButton
                batchId={batch.id}
                className="h-24 w-full text-2xl"
                onAdded={(photoId) => setDraft((d) => ({ ...d, photos: [...d.photos, photoId] }))}
                onUndone={(photoId) => setDraft((d) => ({ ...d, photos: d.photos.filter((p) => p !== photoId) }))}
              >
                {t('bottle.takePhoto')}
              </PhotoButton>
              <ActionRow>
                {back(() => go({ name: 'ph' }))}
                <Button size="lg" disabled={photos.length === 0} onClick={() => go({ name: 'extras' })}>
                  {t('common.next')}
                </Button>
              </ActionRow>
            </>
          }
        >
          <div className="flex flex-wrap gap-3">
            {batch.events
              .filter((e) => photos.includes(e.id))
              .flatMap((e) => e.attachments)
              .map((a) => (
                <img key={a.id} src={`/media/${a.thumb ?? a.file}`} alt="" className="size-28 rounded-lg object-cover" />
              ))}
          </div>
        </Screen>
      );

    case 'extras':
      return (
        <Screen
          title={t('bottle.extrasTitle')}
          subtitle={t('bottle.optional')}
          footer={
            <ActionRow>
              {back(() => go({ name: 'photo' }))}
              <Button size="lg" onClick={() => go({ name: 'review' })}>
                {t('common.next')}
              </Button>
            </ActionRow>
          }
        >
          <div className="flex flex-col gap-3">
            <Button variant="outline" className="h-20 text-xl" onClick={() => go({ name: 'leftover' })}>
              {draft.leftover_g === null ? t('bottle.leftover') : t('bottle.leftoverG', { g: formatGrams(draft.leftover_g) })}
            </Button>
            <Button variant="outline" className="h-20 text-xl" onClick={() => go({ name: 'total' })}>
              {draft.total_g === null ? t('bottle.total') : t('bottle.totalG', { g: formatGrams(draft.total_g) })}
            </Button>
          </div>
        </Screen>
      );

    case 'leftover':
    case 'total': {
      const field = stage.name === 'leftover' ? 'leftover_g' : 'total_g';
      const next = () => {
        update({ [field]: typed });
        go({ name: 'extras' });
      };
      return (
        <Screen title={t(stage.name === 'leftover' ? 'bottle.leftover' : 'bottle.total')} subtitle={subtitle} footer={numpad(() => go({ name: 'extras' }), next)}>
          <Readout value={value} unit="g" />
        </Screen>
      );
    }

    case 'review': {
      const missing = [
        !draft.confirmed && t('bottle.missingCheck'),
        draft.fills.length === 0 && t('bottle.missingFills'),
        draft.ph === null && !draft.phReason && t('bottle.missingPh'),
        photos.length === 0 && t('bottle.missingPhoto'),
      ].filter((m): m is string => Boolean(m));
      return (
        <Screen
          title={t('bottle.reviewTitle')}
          subtitle={subtitle}
          footer={
            <ActionRow>
              {back(() => go({ name: 'extras' }))}
              <Button size="lg" disabled={missing.length > 0} onClick={() => void save()}>
                {t('bottle.save')}
              </Button>
            </ActionRow>
          }
        >
          <p className="text-5xl font-bold tabular-nums">{t('bottle.volume', { ml: formatNumber(volume) })}</p>
          <ul className="mt-3 text-xl">
            {draft.fills.map((f, i) => (
              <li key={i}>{t('detail.fills', { count: f.count, bottle: fillName(f, bottleTypes) })}</li>
            ))}
          </ul>
          <div className="mt-4 text-xl">
            {draft.ph !== null ? (
              <p>
                pH {draft.ph} · <PhLabel value={draft.ph} />
              </p>
            ) : (
              draft.phReason && <p>{t('bottle.phNotMeasured', { reason: draft.phReason })}</p>
            )}
            {draft.color && (
              <p className="flex items-center gap-2">
                <ColorDot color={draft.color} /> {colorName(draft.color)}
              </p>
            )}
            <p>{t('bottle.photos', { n: photos.length })}</p>
            {draft.leftover_g !== null && <p>{t('bottle.leftoverG', { g: formatGrams(draft.leftover_g) })}</p>}
            {draft.total_g !== null && <p>{t('bottle.totalG', { g: formatGrams(draft.total_g) })}</p>}
          </div>
          {missing.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {missing.map((m) => (
                <p key={m} className="text-lg font-semibold text-danger">
                  {m}
                </p>
              ))}
              <Button variant="outline" onClick={() => go(resume(draft))}>
                {t('bottle.fixMissing')}
              </Button>
            </div>
          )}
        </Screen>
      );
    }
  }
}
