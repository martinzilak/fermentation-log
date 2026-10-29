// The one big photo button (SPEC §8.1 item 10): opens the camera directly,
// saves a photo event with the resized image, and offers Undo.
import { Camera } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { errorMessage, useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api, HttpError, OfflineError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { uploadPhoto } from '@/lib/photo';
import { invalidate } from '@/lib/query';

interface Props {
  batchId: string;
  className?: string;
  size?: 'default' | 'lg';
  variant?: 'default' | 'secondary';
  children?: ReactNode;
  /** Called with the new photo event's id once the upload is done. */
  onAdded?: (eventId: string) => void;
  onUndone?: (eventId: string) => void;
}

export function PhotoButton({ batchId, className, size = 'lg', variant = 'secondary', children, onAdded, onUndone }: Props) {
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function add(file: File) {
    setUploading(true);
    const eventId = crypto.randomUUID();
    try {
      await api.post(`/api/batches/${batchId}/events`, { id: eventId, type: 'photo' });
      try {
        await uploadPhoto(eventId, crypto.randomUUID(), file);
      } catch (err) {
        await api.del(`/api/events/${eventId}`).catch(() => {});
        throw err;
      }
      onAdded?.(eventId);
      toast.show(t('detail.photoAdded'), async () => {
        await api.del(`/api/events/${eventId}`);
        onUndone?.(eventId);
        invalidate('/api/batches');
      });
    } catch (err) {
      const network = err instanceof HttpError || err instanceof OfflineError;
      toast.error(network ? errorMessage(err) : t('detail.photoFailed', { error: (err as Error).message }));
    } finally {
      setUploading(false);
      invalidate('/api/batches');
    }
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} disabled={uploading} onClick={() => camera.current?.click()}>
        <Camera />
        {uploading ? t('detail.uploading') : (children ?? t('detail.photo'))}
      </Button>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void add(file);
        }}
      />
    </>
  );
}
