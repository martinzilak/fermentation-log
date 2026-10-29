// pH reading: method chips and the numpad, with the §7.4 label shown live.
import { useState } from 'react';
import { PH_METHODS } from '../../shared/schemas.ts';
import { Chip, Chips } from '@/components/Chip';
import { PhLabel } from '@/components/Labels';
import { NumpadFooter, Readout } from '@/components/Numpad';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { parseDecimal } from '@/lib/numbers';
import { invalidate } from '@/lib/query';
import { goBack } from '@/lib/router';
import { readLocal, writeLocal } from '@/lib/storage';

type Method = (typeof PH_METHODS)[number];

export function PhEvent({ batchId }: { batchId: string }) {
  const toast = useToast();
  const detail = `/b/${batchId}`;
  const [method, setMethod] = useState<Method>(() => (readLocal('ph-method') === 'strip' ? 'strip' : 'meter'));
  const [value, setValue] = useState('');
  const ph = parseDecimal(value);

  function pick(m: Method) {
    setMethod(m);
    writeLocal('ph-method', m);
  }

  async function save() {
    if (ph === null) return;
    if (ph > 14) return toast.error(t('ph.outOfRange'));
    const id = crypto.randomUUID();
    const saved = await toast.run(() =>
      api.post(`/api/batches/${batchId}/events`, { id, type: 'ph', payload: { value: ph, method } }),
    );
    if (!saved) return;
    invalidate(`/api/batches/${batchId}`);
    goBack(detail);
    toast.show(t('ph.added', { value: ph }), async () => {
      await api.del(`/api/events/${id}`);
      invalidate(`/api/batches/${batchId}`);
    });
  }

  return (
    <Screen
      title={t('ph.title')}
      footer={
        <NumpadFooter
          value={value}
          onChange={setValue}
          decimals={2}
          maxInt={2}
          onBack={() => goBack(detail)}
          onNext={() => void save()}
          nextLabel={t('ph.save')}
        />
      }
    >
      <h2 className="mb-2 text-lg text-muted-foreground">{t('ph.method')}</h2>
      <Chips>
        {PH_METHODS.map((m) => (
          <Chip key={m} selected={method === m} onClick={() => pick(m)}>
            {t(`ph.${m}`)}
          </Chip>
        ))}
      </Chips>
      <div className="mt-4">
        <Readout value={value} />
        {ph !== null && ph <= 14 && <PhLabel value={ph} className="text-2xl" />}
      </div>
    </Screen>
  );
}
