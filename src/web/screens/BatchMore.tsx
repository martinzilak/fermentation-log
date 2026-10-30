// The batch detail's More (SPEC §8.2 item 3): the less frequent events
// (weigh, issue, tasting), bottling, the edit screen, the export of
// this one batch and saving it as a recipe (SPEC §7.3).
import { useState } from 'react';
import { ISSUE_KINDS } from '../../shared/schemas.ts';
import { Chip, Chips } from '@/components/Chip';
import { Section } from '@/components/Edit';
import { NumpadFooter, Readout } from '@/components/Numpad';
import { ActionRow, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, QUEUED } from '@/lib/api';
import { stars } from '@/lib/format';
import { t } from '@/lib/i18n';
import { formatGrams, parseDecimal } from '@/lib/numbers';
import { invalidate, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import type { BatchView } from '@/lib/types';

/** Logs an event, returns to the batch and offers Undo. */
export function useLogEvent(batchId: string) {
  const toast = useToast();
  return async (type: string, body: { payload?: object; text?: string | null }, message: string) => {
    const id = crypto.randomUUID();
    const saved = await toast.run(() => api.post(`/api/batches/${batchId}/events`, { id, type, ...body }));
    if (!saved) return;
    invalidate('/api/batches');
    goBack(`/b/${batchId}`);
    toast.show(message, async () => {
      await api.del(`/api/events/${id}`);
      invalidate('/api/batches');
    });
  };
}

export function BatchMore({ id }: { id: string }) {
  const batch = useQuery<BatchView>(`/api/batches/${id}`).data;
  const toast = useToast();
  const bottled = batch?.status === 'bottled' || batch?.status === 'archived';
  const big = 'h-20 text-xl';

  async function saveAsRecipe() {
    const recipeId = crypto.randomUUID();
    const saved = await toast.run(() => api.post(`/api/batches/${id}/save-as-recipe`, { id: recipeId }));
    if (!saved) return;
    invalidate('/api/recipes');
    // Offline it is created once the server is back; the recipe isn't there to open yet.
    if (saved === QUEUED) return toast.show(t('recipe.savedLater'));
    navigate(`/recipes/${recipeId}`, { replace: true });
    toast.show(t('recipe.savedFromBatch'));
  }
  return (
    <Screen
      title={t('more.title')}
      subtitle={batch ? `#${batch.number}` : undefined}
      footer={
        <Button variant="outline" onClick={() => goBack(`/b/${id}`)}>
          {t('common.back')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" className={`${big} col-span-2`} onClick={() => navigate(`/b/${id}/weigh`, { replace: true })}>
          {t('event.weighAction')}
        </Button>
        <Button variant="secondary" className={big} onClick={() => navigate(`/b/${id}/issue`, { replace: true })}>
          {t('event.issueAction')}
        </Button>
        <Button variant="secondary" className={big} onClick={() => navigate(`/b/${id}/tasting`, { replace: true })}>
          {t('event.tastingAction')}
        </Button>
        {!bottled && (
          <Button variant="secondary" className={`${big} col-span-2`} onClick={() => navigate(`/b/${id}/add-step`, { replace: true })}>
            {t('detail.addStep')}
          </Button>
        )}
        {!bottled && (
          <Button className={`${big} col-span-2`} onClick={() => navigate(`/b/${id}/bottle`, { replace: true })}>
            {t('bottle.start')}
          </Button>
        )}
        <Button variant="outline" className={`${big} col-span-2`} onClick={() => navigate(`/b/${id}/edit`, { replace: true })}>
          {t('batchEdit.open')}
        </Button>
        <Button variant="outline" className={`${big} col-span-2`} onClick={() => void saveAsRecipe()}>
          {t('recipe.saveFromBatch')}
        </Button>
        <Button asChild variant="outline" className={`${big} col-span-2`}>
          <a href={`/api/batches/${id}/export.md`} download>
            {t('export.batch')}
          </a>
        </Button>
      </div>
    </Screen>
  );
}

/** A gross weight of the whole crock; the batch view shows the net from the tare. */
export function WeighEvent({ id }: { id: string }) {
  const batch = useQuery<BatchView>(`/api/batches/${id}`).data;
  const log = useLogEvent(id);
  const [value, setValue] = useState('');
  const grams = parseDecimal(value);
  const ferment = batch?.steps.find((s) => s.type === 'ferment');
  const tare = ferment?.params.vessel_tare_g ?? null;
  return (
    <Screen
      title={t('event.weighTitle')}
      subtitle={tare !== null ? t('event.weighTare', { g: formatGrams(tare) }) : undefined}
      footer={
        <NumpadFooter
          value={value}
          onChange={setValue}
          onBack={() => goBack(`/b/${id}`)}
          nextLabel={t('event.save')}
          onNext={() => grams !== null && void log('weigh', { payload: { gross_g: grams } }, t('event.weighed', { g: formatGrams(grams) }))}
        />
      }
    >
      <Readout value={value} unit="g" />
      {grams !== null && tare !== null && <p className="text-2xl font-semibold tabular-nums">{t('weigh.net', { g: formatGrams(grams - tare) })}</p>}
    </Screen>
  );
}

function ChoiceEvent<T extends string | number>(props: {
  id: string;
  title: string;
  choices: readonly T[];
  label: (choice: T) => string;
  save: (choice: T, text: string | null) => void;
}) {
  const [choice, setChoice] = useState<T | null>(null);
  const [text, setText] = useState('');
  return (
    <Screen
      title={props.title}
      footer={
        <ActionRow>
          <Button variant="outline" className="h-16" onClick={() => goBack(`/b/${props.id}`)}>
            {t('common.back')}
          </Button>
          <Button size="lg" disabled={choice === null} onClick={() => choice !== null && props.save(choice, text.trim() || null)}>
            {t('event.save')}
          </Button>
        </ActionRow>
      }
    >
      <Chips>
        {props.choices.map((c) => (
          <Chip key={c} selected={choice === c} onClick={() => setChoice(c)}>
            {props.label(c)}
          </Chip>
        ))}
      </Chips>
      <Section title={t('event.noteOptional')}>
        <Textarea placeholder={t('note.placeholder')} aria-label={t('event.noteOptional')} value={text} onChange={(e) => setText(e.target.value)} />
      </Section>
    </Screen>
  );
}

export function IssueEvent({ id }: { id: string }) {
  const log = useLogEvent(id);
  return (
    <ChoiceEvent
      id={id}
      title={t('event.issueTitle')}
      choices={ISSUE_KINDS}
      label={(k) => t(`issue.${k}`)}
      save={(kind, text) => void log('issue', { payload: { kind }, text }, t('event.issueLogged', { kind: t(`issue.${kind}`) }))}
    />
  );
}

const RATINGS = [1, 2, 3, 4, 5] as const;

export function TastingEvent({ id }: { id: string }) {
  const log = useLogEvent(id);
  return (
    <ChoiceEvent
      id={id}
      title={t('event.tastingTitle')}
      choices={RATINGS}
      label={stars}
      save={(rating, text) => void log('tasting', { payload: { rating }, text }, t('event.tasted', { stars: stars(rating) }))}
    />
  );
}
