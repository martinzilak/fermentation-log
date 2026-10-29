// The "More" menu from the batch list, with the small reference screens:
// bottle types (SPEC §8.2 item 8, §15.2) and settings (item 10).
import { useState } from 'react';
import { LinkRow, NumberField, RowList, Section, TextField, usePatch } from '@/components/Edit';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { formatNumber, formatPct, parseDecimal } from '@/lib/numbers';
import { invalidate, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import type { BottleType, Settings } from '@/lib/types';

const BackButton = ({ to }: { to: string }) => (
  <Button variant="outline" onClick={() => goBack(to)}>
    {t('common.back')}
  </Button>
);

export function MoreMenu() {
  const settings = useQuery<Settings>('/api/settings').data;
  return (
    <Screen title={t('more.title')} footer={<BackButton to="/" />}>
      <RowList>
        <LinkRow title={t('catalog.title')} hint={t('more.catalogHint')} onClick={() => navigate('/catalog')} />
        <LinkRow title={t('varieties.title')} hint={t('more.varietiesHint')} onClick={() => navigate('/varieties')} />
        <LinkRow title={t('bottles.title')} hint={t('more.bottlesHint')} onClick={() => navigate('/bottle-types')} />
        <LinkRow
          title={t('settings.title')}
          hint={settings ? t('settings.saltHint', { pct: formatPct(settings.target_salt_pct) }) : undefined}
          onClick={() => navigate('/settings')}
        />
      </RowList>
    </Screen>
  );
}

const volume = (ml: number) => `${formatNumber(ml)} ml`;

export function BottleTypeList() {
  const toast = useToast();
  const { data, loading } = useQuery<BottleType[]>('/api/bottle-types');
  const [name, setName] = useState('');
  const [ml, setMl] = useState('');
  const volumeMl = parseDecimal(ml);
  const ready = name.trim() !== '' && volumeMl !== null && volumeMl > 0;

  async function add() {
    if (!ready) return;
    const id = crypto.randomUUID();
    if (!(await toast.run(() => api.post('/api/bottle-types', { id, name: name.trim(), volume_ml: volumeMl })))) return;
    invalidate('/api/bottle-types');
    toast.show(t('bottles.added', { name: name.trim() }), async () => {
      await api.del(`/api/bottle-types/${id}`);
      invalidate('/api/bottle-types');
    });
    setName('');
    setMl('');
  }

  return (
    <Screen title={t('bottles.title')} footer={<BackButton to="/more" />}>
      {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {data && data.length > 0 && (
        <RowList>
          {data.map((b) => (
            <LinkRow
              key={b.id}
              title={b.name}
              hint={`${volume(b.volume_ml)} · ${t('bottles.uses', { n: b.uses ?? 0 })}`}
              onClick={() => navigate(`/bottle-types/${b.id}`)}
            />
          ))}
        </RowList>
      )}
      <Section title={t('bottles.new')}>
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Input placeholder={t('edit.name')} aria-label={t('edit.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="ml"
            aria-label={t('bottles.volume')}
            inputMode="decimal"
            value={ml}
            onChange={(e) => setMl(e.target.value)}
          />
        </div>
        <Button variant="secondary" className="mt-3 w-full" disabled={!ready} onClick={() => void add()}>
          {t('bottles.add')}
        </Button>
      </Section>
    </Screen>
  );
}

export function BottleTypeEditor({ id }: { id: string }) {
  const toast = useToast();
  const { data } = useQuery<BottleType[]>('/api/bottle-types');
  const bottle = data?.find((b) => b.id === id);
  const save = usePatch(`/api/bottle-types/${id}`, ['/api/bottle-types', '/api/batches']);
  if (!bottle) return <Screen title={data ? t('app.notFound') : t('common.loading')} footer={<BackButton to="/bottle-types" />} />;
  const b = bottle;

  async function remove() {
    if (!(await toast.run(() => api.del(`/api/bottle-types/${b.id}`).then(() => true)))) return;
    invalidate('/api/bottle-types');
    goBack('/bottle-types');
    const { uses: _uses, ...restore } = b;
    toast.show(t('edit.deleted', { name: b.name }), async () => {
      await api.post('/api/bottle-types', restore);
      invalidate('/api/bottle-types');
    });
  }

  return (
    <Screen title={b.name} subtitle={volume(b.volume_ml)} footer={<BackButton to="/bottle-types" />}>
      <Section>
        <TextField label={t('edit.name')} value={b.name} required onSave={(name) => save({ name }, { name: b.name })} />
      </Section>
      <Section>
        <NumberField
          label={t('bottles.volume')}
          value={b.volume_ml}
          min={1}
          max={100_000}
          required
          onSave={(volume_ml) => save({ volume_ml }, { volume_ml: b.volume_ml })}
        />
      </Section>
      <Section>
        <TextField label={t('edit.notes')} value={b.notes ?? null} multiline onSave={(notes) => save({ notes }, { notes: b.notes ?? null })} />
      </Section>
      <Section title={t('edit.delete')}>
        {(b.uses ?? 0) > 0 ? (
          <p className="text-base text-muted-foreground">{t('bottles.inUse')}</p>
        ) : (
          <Button variant="destructive" className="w-full" onClick={() => void remove()}>
            {t('edit.deleteName', { name: b.name })}
          </Button>
        )}
      </Section>
    </Screen>
  );
}

export function SettingsScreen() {
  const { data } = useQuery<Settings>('/api/settings');
  const save = usePatch('/api/settings', ['/api/settings', '/api/batches']);
  return (
    <Screen title={t('settings.title')} footer={<BackButton to="/more" />}>
      {data && (
        <NumberField
          label={t('settings.targetSalt')}
          value={data.target_salt_pct}
          max={30}
          required
          onSave={(target_salt_pct) => save({ target_salt_pct }, { target_salt_pct: data.target_salt_pct })}
        />
      )}
      <p className="mt-2 text-base text-muted-foreground">{t('settings.targetSaltHint')}</p>
    </Screen>
  );
}
