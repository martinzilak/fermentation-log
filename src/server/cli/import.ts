// Usage: import [--force] [--author <login>] <file.md | directory>...
// Imports batch files into DATA_DIR/ferment.db (SPEC §10.3). Existing batch
// numbers are skipped unless --force replaces them. A snapshot is taken first.
import fs from 'node:fs';
import path from 'node:path';
import { snapshot } from '../backup.ts';
import { migrate, openDb } from '../db.ts';
import { ImportError, importBatchFile } from '../import.ts';

const args = process.argv.slice(2);
let force = false;
let author = 'import';
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--force') force = true;
  else if (arg === '--author') author = args[++i] ?? author;
  else inputs.push(arg);
}

const files = inputs.flatMap((p) =>
  fs.statSync(p).isDirectory()
    ? fs
        .readdirSync(p)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => path.join(p, f))
    : [p],
);
if (files.length === 0) {
  console.error('Usage: import [--force] [--author <login>] <file.md | directory>...');
  process.exit(2);
}

const dataDir = path.resolve(process.env.DATA_DIR || '/data');
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, 'ferment.db');
const existed = fs.existsSync(dbFile);
const db = openDb(dbFile);
if (existed) {
  const file = snapshot(db, path.join(dataDir, 'backups'), 'ferment-preimport', 5);
  console.log(`Backup: ${path.basename(file)}`);
}
migrate(db);

let failed = false;
for (const file of files) {
  try {
    const { number, result } = importBatchFile(db, fs.readFileSync(file, 'utf8'), {
      force,
      author,
      now: new Date().toISOString(),
    });
    console.log(`${path.basename(file)}: batch #${number} ${result}`);
  } catch (err) {
    failed = true;
    console.error(`${path.basename(file)}: ${err instanceof ImportError ? err.message : String(err)}`);
  }
}
db.close();
process.exit(failed ? 1 : 0);
