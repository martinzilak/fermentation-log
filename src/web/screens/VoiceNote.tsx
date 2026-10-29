// Voice note (SPEC §8.1 item 9, §8.4): one big button starts recording and
// the same button stops it, up to 3 minutes. Safari records MP4/AAC; other
// browsers WebM, which the server also accepts. The microphone permission is
// asked on the first tap, after a short explanation on screen.
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Screen } from '@/components/Screen';
import { useToast, errorMessage } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { invalidate } from '@/lib/query';
import { goBack } from '@/lib/router';
import { useWakeLock } from '@/lib/wakelock';

const MAX_S = 180;
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type State = 'idle' | 'starting' | 'recording' | 'saving';

export function VoiceNote({ batchId }: { batchId: string }) {
  useWakeLock();
  const toast = useToast();
  const detail = `/b/${batchId}`;
  const [state, setState] = useState<State>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);

  // Leaving the screen mid-recording stops the microphone without saving.
  useEffect(
    () => () => {
      const r = recorder.current;
      if (r && r.state !== 'inactive') {
        r.ondataavailable = null;
        r.onstop = null;
        r.stop();
      }
      r?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (state !== 'recording') return;
    const timer = window.setInterval(() => {
      const s = (performance.now() - started.current) / 1000;
      setElapsed(s);
      if (s >= MAX_S) recorder.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [state]);

  async function start() {
    setState('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('idle');
      return toast.error(t('voice.noMic'));
    }
    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const r = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      void upload(new Blob(chunks, { type: r.mimeType }), (performance.now() - started.current) / 1000);
    };
    recorder.current = r;
    started.current = performance.now();
    setElapsed(0);
    r.start(1000);
    setState('recording');
  }

  async function upload(blob: Blob, seconds: number) {
    setState('saving');
    const eventId = crypto.randomUUID();
    try {
      await api.post(`/api/batches/${batchId}/events`, { id: eventId, type: 'voice' });
      const form = new FormData();
      form.set('id', crypto.randomUUID());
      form.set('duration_s', String(Math.round(seconds * 10) / 10));
      form.set('file', blob, blob.type.includes('webm') ? 'voice.webm' : 'voice.m4a');
      try {
        await api.post(`/api/events/${eventId}/attachments`, form);
      } catch (err) {
        await api.del(`/api/events/${eventId}`).catch(() => {});
        throw err;
      }
    } catch (err) {
      setState('idle');
      return toast.error(errorMessage(err));
    }
    invalidate('/api/batches');
    goBack(detail);
    toast.show(t('voice.saved', { time: clock(seconds) }), async () => {
      await api.del(`/api/events/${eventId}`);
      invalidate('/api/batches');
    });
  }

  const recording = state === 'recording';
  return (
    <Screen
      title={t('voice.title')}
      subtitle={recording ? t('voice.limit', { time: clock(MAX_S - elapsed) }) : t('voice.hint')}
      footer={
        <>
          <Button
            size="lg"
            variant={recording ? 'destructive' : 'default'}
            className="h-32 w-full flex-col text-2xl"
            disabled={state === 'starting' || state === 'saving'}
            onClick={() => (recording ? recorder.current?.stop() : void start())}
          >
            {recording ? <Square className="size-10" /> : <Mic className="size-10" />}
            {state === 'saving' ? t('detail.uploading') : recording ? t('voice.stop') : t('voice.start')}
          </Button>
          <Button variant="outline" disabled={recording || state === 'saving'} onClick={() => goBack(detail)}>
            {t('common.back')}
          </Button>
        </>
      }
    >
      <p className="py-8 text-center text-7xl font-bold tabular-nums" aria-live="polite">
        {clock(elapsed)}
      </p>
      {state === 'idle' && <p className="text-lg text-muted-foreground">{t('voice.permission')}</p>}
    </Screen>
  );
}
