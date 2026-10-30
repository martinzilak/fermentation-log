// The reminders part of Settings (SPEC §9, §8.2 item 10): turning them on for
// this phone, and the schedule, which is the same for every phone.
import { useEffect, useState } from 'react';
import { NumberField, Section, usePatch } from '@/components/Edit';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { disablePush, enablePush, pushState, testPush, type PushState } from '@/lib/push';
import { useQuery } from '@/lib/query';
import type { Settings } from '@/lib/types';

type Flag = 'nudge_day0_photo' | 'nudge_checks' | 'nudge_burp';
const FLAGS: Flag[] = ['nudge_day0_photo', 'nudge_checks', 'nudge_burp'];

export function Reminders({ settings }: { settings: Settings }) {
  const toast = useToast();
  const publicKey = useQuery<{ public_key: string | null }>('/api/push').data?.public_key;
  const save = usePatch('/api/settings', ['/api/settings']);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (publicKey === undefined) return;
    void pushState(publicKey).then(setState);
  }, [publicKey]);

  async function act(action: () => Promise<PushState | void>) {
    setBusy(true);
    const next = await toast.run(action);
    if (next) setState(next);
    setBusy(false);
  }

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

      <h3 className="mt-5 mb-2 text-lg text-muted-foreground">{t('reminders.schedule')}</h3>
      <div className="grid gap-4">
        <NumberField
          label={t('reminders.hour')}
          value={settings.nudge_hour}
          min={8}
          max={21}
          integer
          required
          onSave={(nudge_hour) => save({ nudge_hour }, { nudge_hour: settings.nudge_hour })}
        />
        {FLAGS.map((key) => (
          <label key={key} className="flex items-center gap-3 text-lg">
            <input
              type="checkbox"
              className="size-6"
              checked={settings[key] === 1}
              onChange={(e) => void save({ [key]: e.target.checked ? 1 : 0 }, { [key]: settings[key] })}
            />
            {t(`reminders.${key}`)}
          </label>
        ))}
        <NumberField
          label={t('reminders.readyDays')}
          value={settings.nudge_ready_days}
          max={365}
          integer
          required
          onSave={(nudge_ready_days) => save({ nudge_ready_days }, { nudge_ready_days: settings.nudge_ready_days })}
        />
      </div>
      <p className="mt-2 text-base text-muted-foreground">{t('reminders.hint')}</p>
    </Section>
  );
}
