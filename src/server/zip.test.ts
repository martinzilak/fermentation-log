import { describe, expect, it } from 'vitest';
import { unzip } from './test-support.ts';
import { zip, type ZipEntry } from './zip.ts';

async function bytes(entries: ZipEntry[]): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of zip(entries, new Date('2026-10-29T03:00:00Z'))) parts.push(part);
  return Buffer.concat(parts);
}

describe('zip', () => {
  it('writes deflated and stored entries that read back intact', async () => {
    const text = Buffer.from('## Notes\nPáliví chilli — ľ š č\n'.repeat(50));
    const photo = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
    const archive = await bytes([
      { name: 'batch-001.md', data: () => text },
      { name: 'media/a.jpg', data: async () => photo, store: true },
    ]);
    const files = unzip(archive);
    expect([...files.keys()]).toEqual(['batch-001.md', 'media/a.jpg']);
    expect(files.get('batch-001.md')!.equals(text)).toBe(true);
    expect(files.get('media/a.jpg')!.equals(photo)).toBe(true);
    expect(archive.length).toBeLessThan(text.length + photo.length);
  });

  it('writes an empty archive', async () => {
    expect(unzip(await bytes([])).size).toBe(0);
  });
});
