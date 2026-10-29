// Routes from SPEC §11 that arrive in later milestones.
import { Hono } from 'hono';
import type { AppEnv } from '../auth.ts';

export function stubRoutes() {
  const r = new Hono<AppEnv>();
  const later = (milestone: string) => () => Response.json({ error: `Not implemented until ${milestone}` }, { status: 501 });

  r.get('/recipes', later('M5'));
  r.post('/recipes', later('M5'));
  r.get('/recipes/:id', later('M5'));
  r.patch('/recipes/:id', later('M5'));
  r.post('/recipes/:id/evaluate', later('M5'));
  r.post('/batches/:id/save-as-recipe', later('M5'));
  r.get('/export.zip', later('M3'));
  r.get('/batches/:id/export.md', later('M3'));

  return r;
}
