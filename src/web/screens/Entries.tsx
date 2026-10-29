// Catalog and peppers (SPEC §8.2 items 7–8, §15.3): the entries ingredient
// lines refer to. Rename, change the kind, edit aliases, merge two entries
// and delete unused ones; a pepper also has its SHU and its lots.
import { X } from 'lucide-react';
import { useState } from 'react';
import { fold } from '../../shared/names.ts';
import { KINDS, ORIGINS, PROPAGATIONS } from '../../shared/schemas.ts';
import { Chip, Chips } from '@/components/Chip';
import { DateField, LinkRow, NumberField, RowList, Section, TextField, usePatch } from '@/components/Edit';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { kindLabel, t } from '@/lib/i18n';
import { formatShuRange } from '@/lib/numbers';
import { invalidate, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import type { CatalogItem, Lot, Variety } from '@/lib/types';

export type EntryPath = 'catalog' | 'varieties';
type Entry = (CatalogItem | Variety) & { notes?: string | null };

const listUrl = (path: EntryPath) => `/api/${path}`;
const title = (path: EntryPath) => (path === 'catalog' ? t('catalog.title') : t('varieties.title'));
const ITEM_KINDS = KINDS.filter((k) => k !== 'pepper');

function shuText(v: Variety): string {
  if (v.shu_min === null && v.shu_max === null) return t('varieties.noShu');
  return formatShuRange(v.shu_min ?? v.shu_max!, v.shu_max ?? v.shu_min!);
}

function hint(path: EntryPath, e: Entry): string {
  const what = path === 'catalog' ? kindLabel((e as CatalogItem).kind) : shuText(e as Variety);
  return `${what} · ${t('edit.uses', { n: e.uses ?? 0 })}`;
}

const matches = (e: Entry, q: string) => [e.name, ...e.aliases].some((n) => fold(n).includes(q));

export function EntryList({ path }: { path: EntryPath }) {
  const toast = useToast();
  const { data, loading } = useQuery<Entry[]>(listUrl(path));
  const [query, setQuery] = useState('');
  const q = fold(query);
  const shown = (data ?? []).filter((e) => !q || matches(e, q));
  const exact = (data ?? []).some((e) => [e.name, ...e.aliases].some((n) => fold(n) === q));

  async function add() {
    const id = crypto.randomUUID();
    const name = query.trim();
    // A new catalog item starts as "Other"; its kind is the first thing on the next screen.
    const body = path === 'catalog' ? { id, name, kind: 'other' } : { id, name };
    if (!(await toast.run(() => api.post(listUrl(path), body)))) return;
    invalidate(listUrl(path));
    setQuery('');
    navigate(`/${path}/${id}`);
  }

  return (
    <Screen
      title={title(path)}
      footer={
        <Button variant="outline" onClick={() => goBack('/more')}>
          {t('common.back')}
        </Button>
      }
    >
      <Input placeholder={t('edit.searchOrAdd')} aria-label={t('edit.searchOrAdd')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {q && !exact && (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => void add()}>
          {t('edit.add', { name: query.trim() })}
        </Button>
      )}
      <div className="mt-4">
        {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
        {shown.length > 0 && (
          <RowList>
            {shown.map((e) => (
              <LinkRow key={e.id} title={e.name} hint={hint(path, e)} onClick={() => navigate(`/${path}/${e.id}`)} />
            ))}
          </RowList>
        )}
      </div>
    </Screen>
  );
}

export function EntryEditor({ path, id }: { path: EntryPath; id: string }) {
  const toast = useToast();
  const { data } = useQuery<Entry[]>(listUrl(path));
  const entry = data?.find((e) => e.id === id);
  const save = usePatch(`${listUrl(path)}/${id}`, [listUrl(path), '/api/batches', '/api/lines/recent']);
  const [alias, setAlias] = useState('');
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeInto, setMergeInto] = useState<Entry | null>(null);
  const back = () => goBack(`/${path}`);

  if (!entry) {
    return <Screen title={data ? t('app.notFound') : t('common.loading')} footer={<Button variant="outline" onClick={back}>{t('common.back')}</Button>} />;
  }
  const e = entry;

  async function addAlias() {
    const name = alias.trim();
    if (!name) return;
    if ([e.name, ...e.aliases].some((n) => fold(n) === fold(name))) return toast.error(t('edit.aliasExists', { name }));
    if (await save({ aliases: [...e.aliases, name] }, { aliases: e.aliases }, t('edit.aliasAdded', { name }))) setAlias('');
  }

  async function merge(into: Entry) {
    const done = await toast.run(() => api.post(`${listUrl(path)}/${e.id}/merge`, { into: into.id }));
    for (const url of [listUrl(path), '/api/lots', '/api/batches', '/api/lines/recent']) invalidate(url);
    if (!done) return;
    // A merge can't be undone with one tap; the merged name stays as an alias of the kept entry.
    toast.show(t('edit.merged', { name: e.name, into: into.name }));
    navigate(`/${path}/${into.id}`, { replace: true });
  }

  async function remove() {
    if (!(await toast.run(() => api.del(`${listUrl(path)}/${e.id}`).then(() => true)))) return;
    invalidate(listUrl(path));
    back();
    const { uses: _uses, ...restore } = e as Entry & Record<string, unknown>;
    toast.show(t('edit.deleted', { name: e.name }), async () => {
      await api.post(listUrl(path), restore);
      invalidate(listUrl(path));
    });
  }

  const q = fold(mergeQuery);
  const candidates = q ? (data ?? []).filter((o) => o.id !== e.id && matches(o, q)).slice(0, 8) : [];

  return (
    <Screen
      title={e.name}
      subtitle={t('edit.uses', { n: e.uses ?? 0 })}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.back')}
        </Button>
      }
    >
      {path === 'catalog' && (
        <Section title={t('edit.kind')}>
          <Chips>
            {ITEM_KINDS.map((k) => (
              <Chip key={k} selected={(e as CatalogItem).kind === k} onClick={() => void save({ kind: k }, { kind: (e as CatalogItem).kind })}>
                {kindLabel(k)}
              </Chip>
            ))}
          </Chips>
        </Section>
      )}

      <Section>
        <TextField label={t('edit.name')} value={e.name} required onSave={(name) => save({ name }, { name: e.name })} />
      </Section>

      <Section title={t('edit.aliases')}>
        {e.aliases.length > 0 && (
          <Chips>
            {e.aliases.map((a) => (
              <Chip
                key={a}
                hint={t('edit.tapToRemove')}
                onClick={() => void save({ aliases: e.aliases.filter((x) => x !== a) }, { aliases: e.aliases }, t('edit.aliasRemoved', { name: a }))}
              >
                <span className="flex items-center gap-2">
                  {a} <X className="size-5" />
                </span>
              </Chip>
            ))}
          </Chips>
        )}
        <div className="mt-3 flex gap-3">
          <Input
            placeholder={t('edit.newAlias')}
            aria-label={t('edit.newAlias')}
            value={alias}
            enterKeyHint="done"
            onChange={(ev) => setAlias(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && void addAlias()}
          />
          <Button variant="secondary" disabled={!alias.trim()} onClick={() => void addAlias()}>
            {t('edit.addAlias')}
          </Button>
        </div>
      </Section>

      {path === 'varieties' && <VarietyFields variety={e as Variety} save={save} />}

      <Section>
        <TextField label={t('edit.notes')} value={e.notes ?? null} multiline onSave={(notes) => save({ notes }, { notes: e.notes ?? null })} />
      </Section>

      <Section title={t('edit.mergeTitle')}>
        <p className="mb-3 text-base text-muted-foreground">{t('edit.mergeHint', { name: e.name })}</p>
        <Input
          placeholder={t('edit.mergeSearch')}
          aria-label={t('edit.mergeSearch')}
          value={mergeQuery}
          onChange={(ev) => {
            setMergeQuery(ev.target.value);
            setMergeInto(null);
          }}
        />
        {candidates.length > 0 && (
          <div className="mt-3">
            <Chips>
              {candidates.map((o) => (
                <Chip key={o.id} selected={mergeInto?.id === o.id} onClick={() => setMergeInto(o)}>
                  {o.name}
                </Chip>
              ))}
            </Chips>
          </div>
        )}
        {mergeInto && (
          <Button variant="destructive" className="mt-3 w-full" onClick={() => void merge(mergeInto)}>
            {t('edit.mergeInto', { name: mergeInto.name })}
          </Button>
        )}
      </Section>

      <Section title={t('edit.delete')}>
        {(e.uses ?? 0) > 0 ? (
          <p className="text-base text-muted-foreground">{t('edit.inUse')}</p>
        ) : (
          <Button variant="destructive" className="w-full" onClick={() => void remove()}>
            {t('edit.deleteName', { name: e.name })}
          </Button>
        )}
      </Section>
    </Screen>
  );
}

type Save = ReturnType<typeof usePatch>;

function VarietyFields({ variety: v, save }: { variety: Variety; save: Save }) {
  const toast = useToast();
  const lots = (useQuery<Lot[]>('/api/lots').data ?? []).filter((l) => l.variety_id === v.id);

  async function addLot() {
    const id = crypto.randomUUID();
    const body = { id, variety_id: v.id, season: new Date().getFullYear(), origin: 'grown' };
    if (!(await toast.run(() => api.post('/api/lots', body)))) return;
    for (const url of ['/api/lots', '/api/varieties']) invalidate(url);
    navigate(`/lots/${id}`);
  }

  return (
    <>
      <Section title={t('varieties.shu')}>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t('varieties.shuMin')} value={v.shu_min} max={5_000_000} onSave={(shu_min) => save({ shu_min }, { shu_min: v.shu_min })} />
          <NumberField label={t('varieties.shuMax')} value={v.shu_max} max={5_000_000} onSave={(shu_max) => save({ shu_max }, { shu_max: v.shu_max })} />
        </div>
        <div className="mt-3">
          <TextField
            label={t('varieties.shuSource')}
            value={v.shu_source ?? null}
            placeholder={t('varieties.shuSourceHint')}
            onSave={(shu_source) => save({ shu_source }, { shu_source: v.shu_source ?? null })}
          />
        </div>
      </Section>

      <Section title={t('varieties.lots')}>
        {lots.length > 0 && (
          <div className="mb-3">
            <RowList>
              {lots.map((l) => (
                <LinkRow key={l.id} title={lotTitle(l)} hint={l.supplier ?? undefined} onClick={() => navigate(`/lots/${l.id}`)} />
              ))}
            </RowList>
          </div>
        )}
        <Button variant="secondary" className="w-full" onClick={() => void addLot()}>
          {t('varieties.addLot')}
        </Button>
      </Section>
    </>
  );
}

export function lotTitle(lot: Lot): string {
  const how = [t(`origin.${lot.origin}`), ...(lot.propagation ? [t(`propagation.${lot.propagation}`)] : [])];
  return `${lot.season} · ${how.join(' ')}`;
}

export function LotEditor({ id }: { id: string }) {
  const toast = useToast();
  const { data } = useQuery<Lot[]>('/api/lots');
  const varieties = useQuery<Variety[]>('/api/varieties').data ?? [];
  const lot = data?.find((l) => l.id === id);
  const save = usePatch(`/api/lots/${id}`, ['/api/lots', '/api/varieties']);

  const back = () => goBack(lot ? `/varieties/${lot.variety_id}` : '/varieties');
  if (!lot) {
    return <Screen title={data ? t('app.notFound') : t('common.loading')} footer={<Button variant="outline" onClick={back}>{t('common.back')}</Button>} />;
  }
  const l = lot;
  const variety = varieties.find((v) => v.id === l.variety_id);

  async function remove() {
    if (!(await toast.run(() => api.del(`/api/lots/${l.id}`).then(() => true)))) return;
    for (const url of ['/api/lots', '/api/varieties']) invalidate(url);
    back();
    const { uses: _uses, ...restore } = l;
    toast.show(t('lot.deleted'), async () => {
      await api.post('/api/lots', restore);
      for (const url of ['/api/lots', '/api/varieties']) invalidate(url);
    });
  }

  return (
    <Screen
      title={variety ? t('lot.title', { name: variety.name }) : t('lot.titlePlain')}
      subtitle={lotTitle(l)}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.back')}
        </Button>
      }
    >
      <Section>
        <NumberField label={t('lot.season')} value={l.season} integer min={1900} max={2200} required onSave={(season) => save({ season }, { season: l.season })} />
      </Section>
      <Section title={t('lot.origin')}>
        <Chips>
          {ORIGINS.map((o) => (
            <Chip
              key={o}
              selected={l.origin === o}
              // Only a grown lot has a propagation (SPEC §6.2).
              onClick={() => void save({ origin: o, ...(o === 'grown' ? {} : { propagation: null }) }, { origin: l.origin, propagation: l.propagation })}
            >
              {t(`origin.${o}`)}
            </Chip>
          ))}
        </Chips>
      </Section>
      {l.origin === 'grown' && (
        <Section title={t('lot.propagation')}>
          <Chips>
            {[null, ...PROPAGATIONS].map((p) => (
              <Chip key={p ?? 'none'} selected={l.propagation === p} onClick={() => void save({ propagation: p }, { propagation: l.propagation })}>
                {p ? t(`propagation.${p}`) : t('lot.notRecorded')}
              </Chip>
            ))}
          </Chips>
        </Section>
      )}
      <Section>
        <TextField label={t('lot.supplier')} value={l.supplier} onSave={(supplier) => save({ supplier }, { supplier: l.supplier })} />
      </Section>
      <Section>
        <DateField label={t('lot.acquired')} value={l.acquired_on} onSave={(acquired_on) => save({ acquired_on }, { acquired_on: l.acquired_on })} />
      </Section>
      <Section>
        <TextField label={t('edit.notes')} value={l.notes ?? null} multiline onSave={(notes) => save({ notes }, { notes: l.notes ?? null })} />
      </Section>
      <Section title={t('edit.delete')}>
        {(l.uses ?? 0) > 0 ? (
          <p className="text-base text-muted-foreground">{t('lot.inUse', { n: l.uses ?? 0 })}</p>
        ) : (
          <Button variant="destructive" className="w-full" onClick={() => void remove()}>
            {t('lot.delete')}
          </Button>
        )}
      </Section>
    </Screen>
  );
}
