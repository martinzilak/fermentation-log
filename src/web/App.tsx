import { useEffect } from 'react';
import { Screen } from '@/components/Screen';
import { ToastProvider } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api, useReachable } from '@/lib/api';
import { t } from '@/lib/i18n';
import { invalidate } from '@/lib/query';
import { matchPath, navigate, usePath } from '@/lib/router';
import { AddStep } from '@/screens/AddStep';
import { BatchDetail } from '@/screens/BatchDetail';
import { BatchList } from '@/screens/BatchList';
import { BatchMore, IssueEvent, TastingEvent, WeighEvent } from '@/screens/BatchMore';
import { Bottling } from '@/screens/Bottling';
import { BatchEdit, LineEdit, StepEdit } from '@/screens/EditBatch';
import { EntryEditor, EntryList, LotEditor } from '@/screens/Entries';
import { BottleTypeEditor, BottleTypeList, MoreMenu, SettingsScreen } from '@/screens/Kitchen';
import { NewBatch } from '@/screens/NewBatch';
import { NoteEvent } from '@/screens/NoteEvent';
import { PhEvent } from '@/screens/PhEvent';
import { PhInfo } from '@/screens/PhInfo';
import { VoiceNote } from '@/screens/VoiceNote';
import { Weighing } from '@/screens/Weighing';
import type { ReactNode } from 'react';

const ROUTES: [string, (p: Record<string, string>) => ReactNode][] = [
  ['/', () => <BatchList />],
  ['/new', () => <NewBatch />],
  ['/b/:id', (p) => <BatchDetail id={p.id!} />],
  ['/b/:id/s/:stepId', (p) => <Weighing batchId={p.id!} stepId={p.stepId!} />],
  ['/b/:id/add-step', (p) => <AddStep batchId={p.id!} />],
  ['/b/:id/note', (p) => <NoteEvent batchId={p.id!} />],
  ['/b/:id/ph', (p) => <PhEvent batchId={p.id!} />],
  ['/b/:id/voice', (p) => <VoiceNote batchId={p.id!} />],
  ['/b/:id/more', (p) => <BatchMore id={p.id!} />],
  ['/b/:id/weigh', (p) => <WeighEvent id={p.id!} />],
  ['/b/:id/issue', (p) => <IssueEvent id={p.id!} />],
  ['/b/:id/tasting', (p) => <TastingEvent id={p.id!} />],
  ['/b/:id/bottle', (p) => <Bottling id={p.id!} />],
  ['/b/:id/edit', (p) => <BatchEdit id={p.id!} />],
  ['/b/:id/s/:stepId/edit', (p) => <StepEdit batchId={p.id!} stepId={p.stepId!} />],
  ['/b/:id/l/:lineId', (p) => <LineEdit key={p.lineId} batchId={p.id!} lineId={p.lineId!} />],
  ['/more', () => <MoreMenu />],
  ['/catalog', () => <EntryList path="catalog" />],
  ['/catalog/:id', (p) => <EntryEditor key={p.id} path="catalog" id={p.id!} />],
  ['/varieties', () => <EntryList path="varieties" />],
  ['/varieties/:id', (p) => <EntryEditor key={p.id} path="varieties" id={p.id!} />],
  ['/lots/:id', (p) => <LotEditor id={p.id!} />],
  ['/bottle-types', () => <BottleTypeList />],
  ['/bottle-types/:id', (p) => <BottleTypeEditor id={p.id!} />],
  ['/settings', () => <SettingsScreen />],
  ['/ph-info', () => <PhInfo />],
];

function route(path: string): ReactNode {
  for (const [pattern, render] of ROUTES) {
    const params = matchPath(pattern, path);
    if (params) return render(params);
  }
  return (
    <Screen title={t('app.notFound')} footer={<Button onClick={() => navigate('/', { replace: true })}>{t('detail.batches')}</Button>} />
  );
}

const ping = () => api.get('/api/me').then(() => invalidate('/api/'), () => {});

/** SPEC §8.5: a large banner when the server can't be reached. */
function OfflineBanner() {
  const reachable = useReachable();
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void ping();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  if (reachable) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-40 flex items-center gap-3 bg-warn px-4 pb-3 text-lg font-semibold text-black"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <p className="flex-1">{t('app.offline')}</p>
      <Button variant="outline" className="border-black/40 bg-transparent text-black" onClick={() => void ping()}>
        {t('app.retry')}
      </Button>
    </div>
  );
}

export function App() {
  const path = usePath();
  return (
    <ToastProvider>
      <OfflineBanner />
      {route(path)}
    </ToastProvider>
  );
}
