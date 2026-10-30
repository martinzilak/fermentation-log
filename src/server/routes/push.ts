// Push subscriptions (SPEC §9, §11). Subscribing needs the server, once per
// device; the endpoint identifies the device, so subscribing again updates it.
import { Hono } from 'hono';
import * as v from 'valibot';
import { Id } from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import { ApiError, jsonBody, meta, type AppContext } from '../http.ts';
import { pushTo } from '../push.ts';

const Endpoint = v.pipe(v.string(), v.url(), v.startsWith('https://'), v.maxLength(2000));
const Key = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+=*$/), v.maxLength(200));

const Subscribe = v.object({ id: Id, endpoint: Endpoint, keys: v.object({ p256dh: Key, auth: Key }) });
const Device = v.object({ endpoint: Endpoint });

export function pushRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();
  const sender = () => {
    if (!ctx.push) throw new ApiError(409, 'Reminders are not set up on the server (VAPID keys)');
    return ctx.push;
  };

  r.get('/push', (c) => c.json({ public_key: ctx.config.vapid?.publicKey ?? null }));

  r.post('/push/subscribe', jsonBody(Subscribe), (c) => {
    sender();
    const body = c.req.valid('json');
    const audit = meta(ctx, c);
    const existed = db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(body.endpoint);
    db.prepare(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at, updated_at, author) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at, author = excluded.author`,
    ).run(body.id, body.endpoint, body.keys.p256dh, body.keys.auth, audit.now, audit.now, audit.author);
    return c.json({ endpoint: body.endpoint }, existed ? 200 : 201);
  });

  r.delete('/push/subscribe', jsonBody(Device), (c) => {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(c.req.valid('json').endpoint);
    return c.body(null, 204);
  });

  r.post('/push/test', jsonBody(Device), async (c) => {
    const { endpoint } = c.req.valid('json');
    const sent = await pushTo(db, sender(), { title: 'Fermentation Log', body: 'Reminders work on this device.', url: '/', tag: 'test' }, endpoint);
    return c.json({ sent: sent > 0 });
  });

  return r;
}
