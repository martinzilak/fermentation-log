// Batch detail (SPEC §8.2 item 3): key stats, steps with their additions,
// and the timeline, newest first. Photo, pH, Note and More sit in the bottom bar,
// and Burped for a jar that needs burping (SPEC §15.11).
// Voice notes were dropped (SPEC §15.5); any recorded earlier still play here.
import { Ellipsis, FlaskConical, NotebookPen, Wind } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { HeatPips, PhLabel, Plate, StatusBadge } from '@/components/Labels';
import { ActionRow, Screen } from '@/components/Screen';
import { PhotoButton } from '@/components/PhotoButton';
import { Button } from '@/components/ui/button';
import { dayNumber, formatDay, formatStamp, stars } from '@/lib/format';
import { eventLabel, stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, formatMl, formatNumber, formatPct, formatShuRange } from '@/lib/numbers';
import { acceptPress } from '@/lib/press';
import { heatLevel } from '@/lib/heat';
import { saltWarning } from '@/lib/salt';
import { missingTitle, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import { recipeStepNote } from '@/lib/plan';
import type { Attachment, BatchView, BottleType, EventView, Fill, RecipeView, Settings, StepView, Vessel } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useLogEvent } from '@/screens/BatchMore';


const sectionTitle = 'mt-8 mb-2 font-mono text-sm tracking-widest text-muted-foreground uppercase';
// The batch's tools: icon over a short label, one row.
const tool = 'h-14 flex-col gap-0 px-1 text-base';

export function BatchDetail({ id }: { id: string }) {
  const url = `/api/batches/${id}`;
  const { data: batch, error } = useQuery<BatchView>(url);
  const vessels = useQuery<Vessel[]>('/api/vessels').data ?? [];
  const bottleTypes = useQuery<BottleType[]>('/api/bottle-types').data ?? [];
  const targetPct = useQuery<Settings>('/api/settings').data?.target_salt_pct ?? 3;
  const log = useLogEvent(id);
  const recipe = useQuery<RecipeView[]>('/api/recipes').data?.find((r) => r.id === batch?.recipe_id);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  if (!batch) {
    return (
      <Screen
        title={missingTitle(error)}
        footer={
          <Button variant="outline" onClick={() => goBack('/')}>
            {t('detail.batches')}
          </Button>
        }
      />
    );
  }

  const d = batch.derived;
  const fermenting = batch.status === 'fermenting';
  const bottled = batch.status === 'bottled' || batch.status === 'archived';
  const level = d.heat ? heatLevel(d.heat.low, d.heat.high) : null;
  const hasMash = batch.steps.some((s) => s.lines.some((l) => l.kind === 'mash' && l.grams));
  // A jar that doesn't burp itself gets Burped next to the photo while it ferments.
  const needsBurping = fermenting && batch.steps.some((s) => s.type === 'ferment' && s.params.needs_burping === true);
  // Only once something besides salt is in the ferment.
  const fermentIn = batch.steps.some((s) => s.type === 'ferment' && s.lines.some((l) => l.kind !== 'salt' && l.grams !== null));
  // The first step with lines still to weigh; Add step moves to More meanwhile.
  const pending = bottled
    ? undefined
    : batch.steps.map((step) => ({ step, left: step.lines.filter((l) => l.grams === null).length })).find((p) => p.left > 0);
  const saltNote = fermentIn ? saltWarning(d.salt_pct, targetPct) : null;

  const stepsSection = (
    <section key="steps">
      <h2 className={sectionTitle}>{t('detail.steps')}</h2>
      {batch.steps.length === 0 && <p className="text-muted-foreground">{t('detail.noSteps')}</p>}
      <div className="flex flex-col gap-4">
        {batch.steps.map((s) => (
          <StepCard
            key={s.id}
            step={s}
            vessels={vessels}
            method={recipeStepNote(recipe, batch, s.id)}
            onAdd={() => navigate(`/b/${id}/s/${s.id}`)}
            onLine={(lineId) => navigate(`/b/${id}/l/${lineId}`)}
          />
        ))}
      </div>
    </section>
  );
  const timelineSection = (
    <section key="timeline">
      <h2 className={sectionTitle}>{t('detail.timeline')}</h2>
      {batch.events.length === 0 && <p className="text-muted-foreground">{t('detail.noEvents')}</p>}
      <ol className="divide-y rounded-xl border bg-card">
        {batch.events.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <EventItem event={e} bottleTypes={bottleTypes} onOpen={setViewing} />
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <Screen
      title={
        <span className="flex items-center gap-3">
          <Plate number={batch.number} color={batch.color} large />
          {batch.name && <span className="min-w-0 break-words">{batch.name}</span>}
        </span>
      }
      subtitle={<StatusBadge status={batch.status} />}
      footer={
        <>
          <ActionRow>
            <PhotoButton batchId={id} size="default" className={tool} />
            {needsBurping && (
              <Button variant="secondary" className={tool} onClick={() => void log('burp', {}, t('event.burped'))}>
                <Wind />
                {t('event.burpAction')}
              </Button>
            )}
            <Button variant="secondary" className={tool} onClick={() => navigate(`/b/${id}/ph`)}>
              <FlaskConical />
              {t('detail.ph')}
            </Button>
            <Button variant="secondary" className={tool} onClick={() => navigate(`/b/${id}/note`)}>
              <NotebookPen />
              {t('detail.note')}
            </Button>
            <Button variant="secondary" className={tool} onClick={() => navigate(`/b/${id}/more`)}>
              <Ellipsis />
              {t('more.title')}
            </Button>
          </ActionRow>
          <ActionRow>
            <Button variant="outline" onClick={() => goBack('/')}>
              {t('detail.batches')}
            </Button>
            {/* The filled button is what comes next (SPEC §15.13): the rest of the
                additions, a tasting once bottled, else the next step, which
                waits as a quiet button while the ferment runs. */}
            {bottled ? (
              <Button onClick={() => navigate(`/b/${id}/tasting`)}>{t('event.tastingAction')}</Button>
            ) : pending ? (
              <Button onClick={() => navigate(`/b/${id}/s/${pending.step.id}`)}>{t('detail.weighMore', { n: pending.left })}</Button>
            ) : (
              <Button variant={fermenting ? 'secondary' : 'default'} onClick={() => navigate(`/b/${id}/add-step`)}>
                {t('detail.addStep')}
              </Button>
            )}
          </ActionRow>
        </>
      }
    >
      {/* Two to a row; an odd one out takes the whole last row. */}
      <section className="grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2">
        <Stat label={t('detail.salt')} note={saltNote ?? undefined} warn={saltNote !== null}>
          {d.salt_pct === null ? '—' : formatPct(d.salt_pct)}
        </Stat>
        {fermenting && d.ferment_day !== null ? (
          <Stat label={t('detail.day')}>{dayNumber(d.ferment_day)}</Stat>
        ) : (
          d.ferment_days !== null && <Stat label={t('detail.fermentDays')}>{t('detail.days', { n: d.ferment_days })}</Stat>
        )}
        {d.heat && level && (
          <Stat
            label={t('detail.heat')}
            note={[formatShuRange(d.heat.low, d.heat.high), d.heat.unknown.length > 0 ? t('detail.heatUnknown', { names: d.heat.unknown.join(', ') }) : null]
              .filter(Boolean)
              .join('. ')}
          >
            <HeatPips {...level} />
          </Stat>
        )}
        {d.sauce_additions_g > 0 && (
          // With the mash weighed (or the total measured) it is the whole sauce, not just what was added.
          <Stat label={t(hasMash || d.measured_total_g !== null ? 'detail.sauce' : 'detail.additions')}>
            {formatGrams(d.measured_total_g ?? d.sauce_additions_g)}
          </Stat>
        )}
        {d.xanthan_pct !== null && <Stat label={t('detail.xanthan')}>{formatPct(d.xanthan_pct, 3)}</Stat>}
        {d.bottled_volume_ml !== null && d.bottled_volume_ml > 0 && (
          <Stat label={t('detail.bottledVolume')}>{formatMl(d.bottled_volume_ml)}</Stat>
        )}
      </section>

      {/* While it ferments, the day-to-day log comes first; afterwards, the batch as made. */}
      {fermenting ? [timelineSection, stepsSection] : [stepsSection, timelineSection]}

      {viewing && <PhotoViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </Screen>
  );
}

interface StatProps {
  label: string;
  children: ReactNode;
  note?: string | undefined;
  wide?: boolean;
  warn?: boolean;
}

function Stat({ label, children, note, wide = false, warn = false }: StatProps) {
  return (
    <div className={cn('rounded-xl border bg-card p-3', wide && 'col-span-2', warn && 'border-destructive')}>
      <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{label}</p>
      <div className={cn('font-display text-4xl leading-tight font-bold tabular-nums', warn && 'text-destructive')}>{children}</div>
      {note && <p className={cn('mt-1 text-base', warn ? 'text-destructive' : 'text-muted-foreground')}>{note}</p>}
    </div>
  );
}

interface StepCardProps {
  step: StepView;
  vessels: Vessel[];
  /** The recipe step's method. */
  method: string | null;
  onAdd: () => void;
  onLine: (lineId: string) => void;
}

function StepCard({ step, vessels, method, onAdd, onLine }: StepCardProps) {
  const vessel = vessels.find((v) => v.id === step.params.vessel_id);
  const tare = step.params.vessel_tare_g;
  const left = step.lines.filter((l) => l.grams === null).length;
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 pt-3">
        <h3 className="font-display text-2xl font-extrabold tracking-wide uppercase">{stepTypeLabel(step.type)}</h3>
        {step.date && <span className="font-mono text-sm text-muted-foreground">{formatDay(step.date)}</span>}
      </header>
      {(vessel || tare != null) && (
        <p className="px-4 text-lg text-muted-foreground">
          {[vessel?.name, tare != null ? t('detail.tare', { g: formatGrams(tare) }) : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {method && <p className="px-4 pt-1 text-base whitespace-pre-line text-muted-foreground">{method}</p>}
      {step.lines.length > 0 && (
        <ul className="mt-2 divide-y border-t">
          {step.lines.map((l) => (
            <li key={l.id}>
              {/* Tapping a line opens it for correcting. */}
              <button
                type="button"
                onClick={(e) => acceptPress(e) && onLine(l.id)}
                className="flex w-full justify-between gap-4 px-4 py-2 text-left text-lg active:bg-accent"
              >
                <span>{l.name}</span>
                <span className="shrink-0 text-right font-mono text-base tabular-nums">
                  {l.grams === null ? (l.planned_g === null ? '—' : '') : formatGrams(l.grams)}
                  {l.planned_g !== null && (
                    <span className="block text-sm text-muted-foreground">{t('weigh.plan', { g: formatGrams(l.planned_g) })}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="p-3">
        <Button variant="outline" className="w-full" onClick={onAdd}>
          {left > 0 ? t('detail.weighRest', { n: left }) : t('detail.addIngredients')}
        </Button>
      </div>
    </section>
  );
}

function EventItem({ event: e, bottleTypes, onOpen }: { event: EventView; bottleTypes: BottleType[]; onOpen: (a: Attachment) => void }) {
  const p = e.payload;
  const photos = e.attachments.filter((a) => a.type === 'photo');
  const audio = e.attachments.filter((a) => a.type === 'audio');
  return (
    <>
      <p className="flex justify-between gap-4 text-base text-muted-foreground">
        <span className="font-semibold text-foreground">{eventLabel(e.type)}</span>
        <span className="font-mono text-sm">{formatStamp(e.occurred_at)}</span>
      </p>
      {e.type === 'ph' && typeof p.value === 'number' && (
        <div className="mt-1">
          <p className="text-3xl font-bold tabular-nums">pH {p.value}</p>
          <PhLabel value={p.value} className="text-lg" />
          {typeof p.method === 'string' && <p className="text-base text-muted-foreground">{t(p.method === 'strip' ? 'ph.strip' : 'ph.meter')}</p>}
        </div>
      )}
      {e.type === 'weigh' && typeof p.gross_g === 'number' && (
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatGrams(p.gross_g)}
          {e.net_g != null && <span className="ml-2 text-lg text-muted-foreground">{t('detail.net', { g: formatGrams(e.net_g) })}</span>}
        </p>
      )}
      {e.type === 'issue' && typeof p.kind === 'string' && <p className="mt-1 text-xl font-semibold">{t(`issue.${p.kind as 'kahm'}`)}</p>}
      {e.type === 'tasting' && typeof p.rating === 'number' && (
        <p className="mt-1 text-2xl" aria-label={t('event.rating', { n: p.rating })}>
          {stars(p.rating)}
        </p>
      )}
      {e.type === 'bottled' && Array.isArray(p.fills) && (
        <ul className="mt-1 text-lg">
          {(p.fills as Fill[]).map((f, i) => (
            <li key={i}>
              {t('detail.fills', { count: f.count, bottle: fillName(f, bottleTypes) })}
            </li>
          ))}
          {typeof p.ph === 'number' && (
            <li>
              pH {p.ph} · <PhLabel value={p.ph} />
            </li>
          )}
        </ul>
      )}
      {e.text && <p className="mt-1 text-lg whitespace-pre-wrap">{e.text}</p>}
      {photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {photos.map((a) => (
            <button key={a.id} type="button" onClick={(e) => acceptPress(e) && onOpen(a)} className="overflow-hidden rounded-lg">
              <img src={`/media/${a.thumb ?? a.file}`} alt="" loading="lazy" className="size-28 object-cover" />
            </button>
          ))}
        </div>
      )}
      {audio.map((a) => (
        <audio key={a.id} controls preload="none" src={`/media/${a.file}`} className="mt-2 w-full" />
      ))}
    </>
  );
}

export function fillName(f: Fill, bottleTypes: BottleType[]): string {
  if ('volume_ml' in f) return [f.label, formatMl(f.volume_ml)].filter(Boolean).join(' · ');
  const type = bottleTypes.find((b) => b.id === f.bottle_type_id);
  return type ? `${type.name} · ${formatMl(type.volume_ml)}` : '?';
}

function PhotoViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <button type="button" aria-label={t('detail.closePhoto')} onClick={onClose} className="min-h-0 flex-1">
        <img src={`/media/${attachment.file}`} alt="" className="h-full w-full object-contain" />
      </button>
      <div className="px-4 pt-3">
        <Button size="lg" variant="secondary" onClick={onClose}>
          {t('detail.closePhoto')}
        </Button>
      </div>
    </div>
  );
}
