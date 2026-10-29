// Photo capture (SPEC §8.3): read the EXIF capture time first, then resize
// on the device to a ~2048 px JPEG plus a ~400 px thumbnail. Decoding goes
// through <img>, which applies EXIF orientation and lets Safari decode HEIC.
import exifr from 'exifr/dist/mini.esm.mjs';
import { api } from './api.ts';

const FULL_EDGE = 2048;
const THUMB_EDGE = 400;

async function exifTakenAt(file: File): Promise<string | null> {
  try {
    const tags = (await exifr.parse(file, ['DateTimeOriginal'])) as { DateTimeOriginal?: unknown } | undefined;
    const taken = tags?.DateTimeOriginal;
    return taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null;
  } catch {
    return null;
  }
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(img: HTMLImageElement, longEdge: number, quality: number) {
  const scale = Math.min(1, longEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return new Promise<{ blob: Blob; width: number; height: number }>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve({ blob, width, height }) : reject(new Error('Could not encode JPEG'))), 'image/jpeg', quality);
  });
}

/** Resizes `file` and uploads it as attachment `id` of event `eventId`. */
export async function uploadPhoto(eventId: string, id: string, file: File): Promise<void> {
  const takenAt = await exifTakenAt(file);
  const img = await decode(file);
  const full = await toJpeg(img, FULL_EDGE, 0.85);
  const thumb = await toJpeg(img, THUMB_EDGE, 0.8);

  const form = new FormData();
  form.set('id', id);
  if (takenAt) form.set('taken_at', takenAt);
  form.set('width', String(full.width));
  form.set('height', String(full.height));
  form.set('file', full.blob, 'photo.jpg');
  form.set('thumb', thumb.blob, 'thumb.jpg');
  await api.post(`/api/events/${eventId}/attachments`, form);
}
