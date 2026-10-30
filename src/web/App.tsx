import { useEffect } from 'react';
import { usePingOnVisible } from '@/components/ConnectionBanner';
import { Screen } from '@/components/Screen';
import { ToastProvider, useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { onRefused } from '@/lib/sync';
import { matchPath, navigate, usePath } from '@/lib/router';
import { AddStep } from '@/screens/AddStep';
import { BatchDetail } from '@/screens/BatchDetail';
import { BatchList } from '@/screens/BatchList';
import { BatchMore, IssueEvent, TastingEvent, WeighEvent } from '@/screens/BatchMore';
import { Bottling } from '@/screens/Bottling';
import { BatchEdit, LineEdit, StepEdit } from '@/screens/EditBatch';
import { EntryEditor, EntryList, LotEditor } from '@/screens/Entries';
import { BottleTypeEditor, BottleTypeList, ExportScreen, MoreMenu, SettingsScreen } from '@/screens/Kitchen';
import { NewBatch } from '@/screens/NewBatch';
import { NoteEvent } from '@/screens/NoteEvent';
import { PhEvent } from '@/screens/PhEvent';
import { PhInfo } from '@/screens/PhInfo';
import { RecipeEditor, RecipeList } from '@/screens/Recipes';
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
  ['/recipes', () => <RecipeList />],
  ['/recipes/:id', (p) => <RecipeEditor key={p.id} id={p.id!} />],
  ['/export', () => <ExportScreen />],
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

/** A queued write the server turned down once it was back, e.g. a batch number taken meanwhile. */
function RefusedWrites() {
  const toast = useToast();
  useEffect(() => onRefused((_op, error) => toast.error(t('sync.refused', { error: error.message }))), [toast]);
  return null;
}

export function App() {
  const path = usePath();
  usePingOnVisible();
  return (
    <ToastProvider>
      <RefusedWrites />
      {route(path)}
    </ToastProvider>
  );
}
