// A minimal zip writer for the export download (SPEC §10.2), on node:zlib
// alone. Each entry is read whole, one at a time, so sizes and CRCs are known
// before its header is written. No zip64: an archive past 4 GiB or 65 535
// entries is refused rather than written broken.
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: () => Uint8Array | Promise<Uint8Array>;
  /** Already-compressed data (photos, audio) is stored as is. */
  store?: boolean;
}

const LIMIT = 0xffffffff;
const UTF8_NAMES = 0x0800;

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** Yields the bytes of a zip archive holding `entries`, dated `modified` (UTC). */
export async function* zip(entries: Iterable<ZipEntry>, modified = new Date()): AsyncGenerator<Uint8Array> {
  const { time, date } = dosTime(modified);
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;

  for (const entry of entries) {
    const raw = await entry.data();
    const method = entry.store ? 0 : 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(raw);
    if (raw.length > LIMIT || offset + 30 + name.length + body.length > LIMIT || ++count > 0xffff) {
      throw new Error('Export too large for a zip without zip64');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    yield Buffer.concat([local, name]);
    yield body;
    offset += 30 + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  if (offset + directory.length > LIMIT) throw new Error('Export too large for a zip without zip64');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield directory;
  yield end;
}
