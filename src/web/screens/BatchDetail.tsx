// Batch detail (SPEC §8.2 item 3): key stats, steps with their additions,
// and the timeline, newest first. Photo, Note and pH sit in the bottom bar.
import { Camera, FlaskConical, NotebookPen } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ColorDot, PhLabel, StatusBadge } from '@/components/Labels';
import { ActionRow, Screen } from '@/components/Screen';
import { errorMessage, useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api, HttpError, OfflineError } from '@/lib/api';
import { formatDay, formatStamp } from '@/lib/format';
import { eventLabel, stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, formatNumber, formatPct, formatShuRange } from '@/lib/numbers';
import { uploadPhoto } from '@/lib/photo';
import { acceptPress } from '@/lib/press';
import { invalidate, refresh, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import type { Attachment, BatchView, BottleType, EventView, StepView, Vessel } from '@/lib/types';

export function BatchDetail({ id }: { id: string }) {
  const url = `/api/batches/${id}`;
  const toast = useToast();
  const { data: batch, error } = useQuery<BatchView>(url);
  const vessels = useQuery<Vessel[]>('/api/vessels').data ?? [];
  const bottleTypes = useQuery<BottleType[]>('/api/bottle-types').data ?? [];
  const camera = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  if (!batch) {
    return (
      <Screen
        title={error ? t('app.notFound') : t('common.loading')}
        footer={
          <Button variant="outline" onClick={() => goBack('/')}>
            {t('detail.batches')}
          </Button>
        }
      />
    );
  }

  async function addPhoto(file: File) {
    setUploading(true);
    const eventId = crypto.randomUUID();
    try {
      await api.post(`/api/batches/${id}/events`, { id: eventId, type: 'photo' });
      try {
        await uploadPhoto(eventId, crypto.randomUUID(), file);
      } catch (err) {
        await api.del(`/api/events/${eventId}`).catch(() => {});
        throw err;
      }
      await refresh(url);
      toast.show(t('detail.photoAdded'), async () => {
        await api.del(`/api/events/${eventId}`);
        await refresh(url);
      });
    } catch (err) {
      const network = err instanceof HttpError || err instanceof OfflineError;
      toast.error(network ? errorMessage(err) : t('detail.photoFailed', { error: (err as Error).message }));
    } finally {
      setUploading(false);
      invalidate('/api/batches');
    }
  }

  const d = batch.derived;
  const fermenting = batch.status === 'fermenting';

  return (
    <Screen
      title={
        <span className="flex items-center gap-3">
          <span className="text-4xl tabular-nums">#{batch.number}</span>
          <ColorDot color={batch.color} />
          {batch.name && <span className="truncate">{batch.name}</span>}
        </span>
      }
      subtitle={<StatusBadge status={batch.status} />}
      footer={
        <>
          <ActionRow>
            <Button size="lg" variant="secondary" className="flex-col gap-0 text-base" disabled={uploading} onClick={() => camera.current?.click()}>
              <Camera />
              {uploading ? t('detail.uploading') : t('detail.photo')}
            </Button>
            <Button size="lg" variant="secondary" className="flex-col gap-0 text-base" onClick={() => navigate(`/b/${id}/note`)}>
              <NotebookPen />
              {t('detail.note')}
            </Button>
            <Button size="lg" variant="secondary" className="flex-col gap-0 text-base" onClick={() => navigate(`/b/${id}/ph`)}>
              <FlaskConical />
              {t('detail.ph')}
            </Button>
          </ActionRow>
          <ActionRow>
            <Button variant="outline" onClick={() => goBack('/')}>
              {t('detail.batches')}
            </Button>
            <Button onClick={() => navigate(`/b/${id}/add-step`)}>{t('detail.addStep')}</Button>
          </ActionRow>
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void addPhoto(file);
            }}
          />
        </>
      }
    >
      <section className="grid grid-cols-2 gap-3">
        <Stat label={t('detail.salt')}>{d.salt_pct === null ? '—' : formatPct(d.salt_pct)}</Stat>
        {fermenting && d.ferment_day !== null ? (
          <Stat label={t('detail.day')}>{d.ferment_day}</Stat>
        ) : (
          d.ferment_days !== null && <Stat label={t('detail.fermentDays')}>{t('detail.days', { n: d.ferment_days })}</Stat>
        )}
        {d.heat && d.heat.high > 0 && (
          <Stat
            label={t('detail.heat')}
            wide
            note={d.heat.unknown.length > 0 ? t('detail.heatUnknown', { names: d.heat.unknown.join(', ') }) : undefined}
          >
            {formatShuRange(d.heat.low, d.heat.high)}
          </Stat>
        )}
        {d.sauce_additions_g > 0 && <Stat label={t('detail.additions')}>{formatGrams(d.measured_total_g ?? d.sauce_additions_g)}</Stat>}
        {d.xanthan_pct !== null && <Stat label={t('detail.xanthan')}>{formatPct(d.xanthan_pct, 3)}</Stat>}
        {d.bottled_volume_ml !== null && d.bottled_volume_ml > 0 && (
          <Stat label={t('detail.bottledVolume')}>{`${formatNumber(d.bottled_volume_ml)} ml`}</Stat>
        )}
      </section>

      <h2 className="mt-8 mb-3 text-xl font-bold">{t('detail.steps')}</h2>
      {batch.steps.length === 0 && <p className="text-muted-foreground">{t('detail.noSteps')}</p>}
      <div className="flex flex-col gap-4">
        {batch.steps.map((s) => (
          <StepCard key={s.id} step={s} vessels={vessels} onAdd={() => navigate(`/b/${id}/s/${s.id}`)} />
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-xl font-bold">{t('detail.timeline')}</h2>
      {batch.events.length === 0 && <p className="text-muted-foreground">{t('detail.noEvents')}</p>}
      <ol className="flex flex-col gap-3">
        {batch.events.map((e) => (
          <li key={e.id} className="rounded-xl border bg-card px-4 py-3">
            <EventItem event={e} bottleTypes={bottleTypes} onOpen={setViewing} />
          </li>
        ))}
      </ol>

      {viewing && <PhotoViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </Screen>
  );
}

function Stat({ label, children, note, wide = false }: { label: string; children: ReactNode; note?: string | undefined; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 rounded-xl border bg-card p-3' : 'rounded-xl border bg-card p-3'}>
      <p className="text-base text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{children}</p>
      {note && <p className="mt-1 text-base text-muted-foreground">{note}</p>}
    </div>
  );
}

function StepCard({ step, vessels, onAdd }: { step: StepView; vessels: Vessel[]; onAdd: () => void }) {
  const vessel = vessels.find((v) => v.id === step.params.vessel_id);
  const tare = step.params.vessel_tare_g;
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 pt-3">
        <h3 className="text-xl font-semibold">{stepTypeLabel(step.type)}</h3>
        {step.date && <span className="text-lg text-muted-foreground">{formatDay(step.date)}</span>}
      </header>
      {(vessel || tare != null) && (
        <p className="px-4 text-lg text-muted-foreground">
          {[vessel?.name, tare != null ? t('detail.tare', { g: formatGrams(tare) }) : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {step.lines.length > 0 && (
        <ul className="mt-2 divide-y border-t">
          {step.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-4 px-4 py-2 text-lg">
              <span>
                {l.name}
                {l.local_name && <span className="text-muted-foreground"> ({l.local_name})</span>}
              </span>
              <span className="shrink-0 tabular-nums">{l.grams === null ? '—' : formatGrams(l.grams)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="p-3">
        <Button variant="outline" className="w-full" onClick={onAdd}>
          {t('detail.addIngredients')}
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
        <span>{formatStamp(e.occurred_at)}</span>
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
      {e.type === 'bottled' && Array.isArray(p.fills) && (
        <ul className="mt-1 text-lg">
          {(p.fills as { bottle_type_id: string; count: number }[]).map((f) => (
            <li key={f.bottle_type_id}>
              {t('detail.fills', { count: f.count, bottle: bottleTypes.find((b) => b.id === f.bottle_type_id)?.name ?? '?' })}
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
            <button key={a.id} type="button" onClick={() => acceptPress() && onOpen(a)} className="overflow-hidden rounded-lg">
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
