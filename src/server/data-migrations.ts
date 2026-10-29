// The code half of migrations whose data changes SQL can't express, keyed by
// the version of their .sql file. Each runs right after that file's SQL, in
// the same transaction.
import type { DataMigrations } from './db.ts';
import { linkLines } from './entries.ts';

export const DATA_MIGRATIONS: DataMigrations = {
  4: linkLines,
};
