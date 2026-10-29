// Photo and voice-note uploads, and serving them back (SPEC §8.3, §8.4, §11).
import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as v from 'valibot';
import { Id, Timestamp } from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import { ApiError, check, meta, type AppContext } from '../http.ts';
import { getRow, insert, requireRow } from '../store.ts';

const MB = 1024 * 1024;
const LIMITS = { photo: 15 * MB, thumb: 2 * MB, audio: 25 * MB };

interface Sniffed {
  type: 'photo' | 'audio';
  ext: string;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
};

// <attachment id>[.thumb].<ext>; anything else (including "..") never matches.
const MEDIA_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.(jpg|png|webp|m4a|webm|mp3)$/;

const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));

/**
 * Identifies the file from its first bytes rather than the client-declared
 * MIME type. HEIC is refused: the client converts photos to JPEG first.
 */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'photo', ext: 'jpg' };
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return { type: 'photo', ext: 'png' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { type: 'photo', ext: 'webp' };
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    return ['heic', 'heix', 'mif1', 'msf1', 'avif'].includes(brand) ? null : { type: 'audio', ext: 'm4a' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'audio', ext: 'webm' };
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0)) {
    return { type: 'audio', ext: 'mp3' };
  }
  return null;
}

const Fields = v.object({
  id: Id,
  taken_at: v.optional(Timestamp),
  width: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1))),
  height: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1))),
  duration_s: v.optional(v.pipe(v.string(), v.toNumber(), v.finite(), v.minValue(0))),
});

async function writeAtomically(file: string, bytes: Uint8Array) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, file);
}

export function mediaRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();
  const view = (id: string) => getRow(db, 'attachments', id)!;

  r.post(
    '/api/events/:id/attachments',
    bodyLimit({
      maxSize: LIMITS.audio + LIMITS.thumb + MB,
      onError: (c) => c.json({ error: 'Upload too large' }, 413),
    }),
    async (c) => {
      const event = requireRow(db, 'events', c.req.param('id'), 'Event');
      const form = await c.req.parseBody();
      const fields = check(
        v.safeParse(Fields, Object.fromEntries(Object.entries(form).filter(([, value]) => typeof value === 'string'))),
        'form',
      );
      if (getRow(db, 'attachments', fields.id)) return c.json(view(fields.id), 200);

      const file = form.file;
      if (!(file instanceof File)) throw new ApiError(400, 'Missing file');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniff(bytes);
      if (!kind) throw new ApiError(415, 'Unsupported file type; send JPEG/PNG/WebP photos or MP4/WebM/MP3 audio');
      if (bytes.length > LIMITS[kind.type]) throw new ApiError(413, 'File too large');

      let thumbBytes: Uint8Array | null = null;
      let thumbKind: Sniffed | null = null;
      if (form.thumb instanceof File) {
        thumbBytes = new Uint8Array(await form.thumb.arrayBuffer());
        thumbKind = sniff(thumbBytes);
        if (thumbKind?.type !== 'photo') throw new ApiError(415, 'Thumbnail must be a JPEG, PNG or WebP image');
        if (thumbBytes.length > LIMITS.thumb) throw new ApiError(413, 'Thumbnail too large');
      }

      await fs.mkdir(ctx.mediaDir, { recursive: true });
      const fileName = `${fields.id}.${kind.ext}`;
      const thumbName = thumbKind ? `${fields.id}.thumb.${thumbKind.ext}` : null;
      await writeAtomically(path.join(ctx.mediaDir, fileName), bytes);
      if (thumbName && thumbBytes) await writeAtomically(path.join(ctx.mediaDir, thumbName), thumbBytes);

      const { now, author } = meta(ctx, c);
      insert(db, 'attachments', {
        id: fields.id,
        event_id: event.id,
        type: kind.type,
        file: fileName,
        thumb: thumbName,
        // EXIF time from the client when it has one, else the capture time.
        taken_at: fields.taken_at ?? (kind.type === 'photo' ? now : null),
        duration_s: fields.duration_s,
        width: fields.width,
        height: fields.height,
        created_at: now,
        author,
      });
      return c.json(view(fields.id), 201);
    },
  );

  r.get('/media/:file', async (c) => {
    const name = c.req.param('file');
    if (!MEDIA_FILE.test(name)) throw new ApiError(404, 'Not found');
    let data: Buffer;
    try {
      data = await fs.readFile(path.join(ctx.mediaDir, name));
    } catch {
      throw new ApiError(404, 'Not found');
    }
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': MIME_BY_EXT[name.split('.').pop()!]!,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });

  return r;
}
