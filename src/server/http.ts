import { sValidator } from '@hono/standard-validator';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type * as v from 'valibot';
import type { AppEnv } from './auth.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';

export interface AppContext {
  config: Config;
  db: DB;
  mediaDir: string;
  now: () => Date;
}

export interface Issue {
  path: string;
  message: string;
}

/** An error that becomes a JSON response with this status. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly issues: Issue[] | undefined;

  constructor(status: ContentfulStatusCode, message: string, issues?: Issue[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

type PathItem = PropertyKey | { key: unknown };

export function formatIssues(issues: readonly { message: string; path?: readonly PathItem[] | undefined }[]): Issue[] {
  return issues.map((i) => ({
    path: (i.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p)).join('.'),
    message: i.message,
  }));
}

/** Validates the JSON body against a valibot schema; invalid bodies get a 400 with the issues. */
export function jsonBody<S extends v.GenericSchema>(schema: S) {
  return sValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid request', issues: formatIssues(result.error) }, 400);
  });
}

/** Parses a value with a valibot safeParse result, or throws a 400 naming the field. */
export function check<T>(result: v.SafeParseResult<v.GenericSchema<unknown, T>>, field: string): T {
  if (result.success) return result.output;
  throw new ApiError(
    400,
    'Invalid request',
    formatIssues(result.issues).map((i) => ({ ...i, path: i.path ? `${field}.${i.path}` : field })),
  );
}

export function meta(ctx: AppContext, c: Context<AppEnv>) {
  return { now: ctx.now().toISOString(), author: c.get('user').login };
}
