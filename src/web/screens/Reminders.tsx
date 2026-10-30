// The reminders part of Settings (SPEC §9, §15.11): turning them on for this
// phone, and the list of reminders, which is the same for every phone. Each is
// an action on a ferment day (the start date is Day 1), repeating or not, from
// an hour. Every change saves the whole list, with Undo. An own reminder
// without its text yet stays on this screen until it has some.
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Chip, Chips } from '@/components/Chip';
import { NumberField, Section, TextField } from '@/components/Edit';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { disablePush, enablePush, pushState, testPush, type PushState } from '@/lib/push';
import { invalidate, useQuery } from '@/lib/query';
import type { ReminderAction, ReminderRule } from '@/lib/types';

const ACTIONS: ReminderAction[] = ['photo', 'burp', 'ph', 'custom'];
const URL = '/api/reminders';

const complete = (r: ReminderRule) => r.action !== 'custom' || !!r.text;

export function Reminders() {
  const toast = useToast();
  const publicKey = useQuery<{ public_key: string | null }>('/api/push').data?.public_key;
  const saved = useQuery<ReminderRule[]>(URL).data;
  const [rules, setRules] = useState<ReminderRule[] | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (publicKey === undefined) return;
    void pushState(publicKey).then(setState);
  }, [publicKey]);

  useEffect(() => {
    if (saved && rules === null) setRules(saved);
  }, [saved, rules]);

  async function act(action: () => Promise<PushState | void>) {
    setBusy(true);
    const next = await toast.run(action);
    if (next) setState(next);
    setBusy(false);
  }

  async function save(next: ReminderRule[]): Promise<boolean> {
    const before = rules ?? [];
    setRules(next);
    const put = (list: ReminderRule[]) => api.put<ReminderRule[]>(URL, list.filter(complete));
    const done = await toast.run(() => put(next));
    invalidate(URL);
    if (done === undefined) {
      setRules(before);
      return false;
    }
    toast.show(t('edit.saved'), async () => {
      setRules(before);
      await put(before);
      invalidate(URL);
    });
    return true;
  }

  const change = (id: string, patch: Partial<ReminderRule>) => save((rules ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <Section title={t('reminders.title')}>
      <div className="rounded-xl border bg-card p-4">
        {state && <p className="text-lg">{t(`reminders.state.${state}`)}</p>}
        {state === 'off' && publicKey && (
          <Button size="lg" className="mt-3 w-full" disabled={busy} onClick={() => void act(() => enablePush(publicKey))}>
            {t('reminders.enable')}
          </Button>
        )}
        {state === 'on' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  toast.show((await testPush()) ? t('reminders.testSent') : t('reminders.testFailed'));
                })
              }
            >
              {t('reminders.test')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await disablePush();
                  return 'off';
                })
              }
            >
              {t('reminders.disable')}
            </Button>
          </div>
        )}
      </div>

      {rules && (
        <div className="mt-5 flex flex-col gap-4">
          {rules.map((r, i) => (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-lg font-medium">{t('reminders.rule', { n: i + 1 })}</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('reminders.remove')}
                  onClick={() => void save(rules.filter((x) => x.id !== r.id))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Chips>
                {ACTIONS.map((a) => (
                  <Chip key={a} selected={r.action === a} onClick={() => void change(r.id, { action: a })}>
                    {t(`reminders.action.${a}`)}
                  </Chip>
                ))}
              </Chips>
              <div className="mt-4 grid gap-4">
                {r.action === 'custom' && (
                  <TextField label={t('reminders.text')} value={r.text ?? null} onSave={(text) => change(r.id, { text })} />
                )}
                {r.action === 'burp' && <p className="text-base text-muted-foreground">{t('reminders.burpHint')}</p>}
                <div className="grid grid-cols-3 gap-3">
                  <NumberField
                    label={t('reminders.day')}
                    value={r.first_day}
                    min={1}
                    max={365}
                    integer
                    required
                    onSave={(n) => change(r.id, { first_day: n! })}
                  />
                  <NumberField
                    label={t('reminders.every')}
                    value={r.every_days}
                    max={365}
                    integer
                    required
                    onSave={(n) => change(r.id, { every_days: n! })}
                  />
                  <NumberField
                    label={t('reminders.hour')}
                    value={r.hour}
                    min={8}
                    max={21}
                    integer
                    required
                    onSave={(n) => change(r.id, { hour: n! })}
                  />
                </div>
                <p className="text-base text-muted-foreground">{describe(r)}</p>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="lg"
            disabled={rules.length >= 30}
            onClick={() =>
              void save([...rules, { id: crypto.randomUUID(), action: 'photo', text: null, first_day: 1, every_days: 0, hour: rules.at(-1)?.hour ?? 18 }])
            }
          >
            <Plus /> {t('reminders.add')}
          </Button>
        </div>
      )}
      <p className="mt-2 text-base text-muted-foreground">{t('reminders.hint')}</p>
    </Section>
  );
}

function describe(r: ReminderRule): string {
  const from = String(r.hour).padStart(2, '0');
  if (r.every_days === 0) return t('reminders.once', { day: r.first_day, hour: from });
  if (r.every_days === 1) return t('reminders.daily', { day: r.first_day, hour: from });
  return t('reminders.repeat', { day: r.first_day, every: r.every_days, hour: from });
}
