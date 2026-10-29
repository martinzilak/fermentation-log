import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { tailscaleAuth, type AppEnv, type PeerResolver } from './auth.ts';
import type { Config } from './config.ts';

const defaultPeer: PeerResolver = (c) => getConnInfo(c).remote.address;

const helloPage = (login: string, name: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fermentation Log</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 20px/1.5 system-ui, sans-serif; margin: 0; padding: max(24px, env(safe-area-inset-top)) 16px 24px; }
  code { font-size: 18px; }
</style>
</head>
<body>
<h1>Fermentation Log</h1>
<p>Deployment check: signed in as <strong>${escapeHtml(name)}</strong> (<code>${escapeHtml(login)}</code>).</p>
</body>
</html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function createApp(config: Config, getPeer: PeerResolver = defaultPeer) {
  const app = new Hono<AppEnv>();

  app.get('/healthz', (c) => c.text('ok'));

  app.use('*', tailscaleAuth(config, getPeer));

  app.get('/api/me', (c) => c.json(c.get('user')));

  app.get('/', (c) => {
    const { login, name } = c.get('user');
    return c.html(helloPage(login, name));
  });

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed:`, err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
