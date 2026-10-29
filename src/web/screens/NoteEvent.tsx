// A text note (SPEC §8.1 item 9): iOS dictation works in the text box. The
// draft is kept on the device until saved, so leaving the screen loses nothing.
import { useEffect, useState } from 'react';
import { ActionRow, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { invalidate } from '@/lib/query';
import { goBack } from '@/lib/router';
import { readLocal, writeLocal } from '@/lib/storage';

export function NoteEvent({ batchId }: { batchId: string }) {
  const toast = useToast();
  const draftKey = `note-draft:${batchId}`;
  const [text, setText] = useState(() => readLocal(draftKey) ?? '');
  const detail = `/b/${batchId}`;

  useEffect(() => writeLocal(draftKey, text || null), [draftKey, text]);

  async function save() {
    const body = text.trim();
    if (!body) return;
    const id = crypto.randomUUID();
    const saved = await toast.run(() => api.post(`/api/batches/${batchId}/events`, { id, type: 'note', text: body }));
    if (!saved) return;
    writeLocal(draftKey, null);
    invalidate(`/api/batches/${batchId}`);
    goBack(detail);
    toast.show(t('note.added'), async () => {
      await api.del(`/api/events/${id}`);
      writeLocal(draftKey, body);
      invalidate(`/api/batches/${batchId}`);
    });
  }

  return (
    <Screen
      title={t('note.title')}
      fixed
      footer={
        <ActionRow>
          <Button variant="outline" className="h-16" onClick={() => goBack(detail)}>
            {t('common.back')}
          </Button>
          <Button size="lg" disabled={!text.trim()} onClick={() => void save()}>
            {t('note.save')}
          </Button>
        </ActionRow>
      }
    >
      <Textarea
        autoFocus
        placeholder={t('note.placeholder')}
        aria-label={t('note.title')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Screen>
  );
}
