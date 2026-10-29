import { describe, expect, it } from 'vitest';
import { decodeHeaderName, isLoopback } from './auth.ts';
import { loadConfig } from './config.ts';
import { testApp } from './test-support.ts';

const prodEnv = { NODE_ENV: 'production', ALLOWED_LOGINS: 'owner@example.com, Friend@Example.com' };

function appWithPeer(peer: string | undefined, env: NodeJS.ProcessEnv = prodEnv) {
  return testApp(env, () => peer).app;
}

const ident = { 'Tailscale-User-Login': 'owner@example.com', 'Tailscale-User-Name': 'Owner' };

describe('isLoopback', () => {
  it.each(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])('accepts %s', (a) => {
    expect(isLoopback(a)).toBe(true);
  });
  it.each(['192.168.1.10', '172.17.0.2', '100.64.0.1', '::ffff:10.0.0.1', '', undefined])('rejects %s', (a) => {
    expect(isLoopback(a)).toBe(false);
  });
});

describe('decodeHeaderName', () => {
  it('decodes RFC 2047 Q and B encoded-words', () => {
    expect(decodeHeaderName('=?utf-8?q?Mart=C3=ADn_=C5=BDil=C3=A1k?=')).toBe('Martín Žilák');
    expect(decodeHeaderName(`=?UTF-8?B?${Buffer.from('Žilák').toString('base64')}?=`)).toBe('Žilák');
  });
  it('leaves plain values alone', () => {
    expect(decodeHeaderName('Plain Name')).toBe('Plain Name');
  });
});

describe('auth', () => {
  it('serves /healthz to any peer without headers', async () => {
    const res = await appWithPeer('192.168.1.50').request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('returns the Serve identity from a loopback peer', async () => {
    const res = await appWithPeer('127.0.0.1').request('/api/me', { headers: ident });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'owner@example.com', name: 'Owner' });
  });

  it('matches logins case-insensitively', async () => {
    const res = await appWithPeer('::1').request('/api/me', {
      headers: { 'Tailscale-User-Login': 'friend@example.com' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'friend@example.com', name: 'friend@example.com' });
  });

  it('rejects identity headers from a non-loopback peer', async () => {
    const res = await appWithPeer('172.17.0.1').request('/api/me', { headers: ident });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Tailscale Serve/);
  });

  it('rejects a missing login and mentions tagged devices', async () => {
    const res = await appWithPeer('127.0.0.1').request('/api/me');
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/tagged/);
  });

  it('rejects a login not in ALLOWED_LOGINS', async () => {
    const res = await appWithPeer('127.0.0.1').request('/api/me', {
      headers: { 'Tailscale-User-Login': 'stranger@example.com' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
  });

  it('DEV_USER acts as that user from any peer', async () => {
    const res = await appWithPeer('10.0.0.9', { DEV_USER: 'dev@example.com' }).request('/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'dev@example.com', name: 'dev@example.com' });
  });
});

describe('loadConfig', () => {
  it('refuses DEV_USER in production', () => {
    expect(() => loadConfig({ ...prodEnv, DEV_USER: 'x@example.com' })).toThrow(/DEV_USER/);
  });
  it('requires ALLOWED_LOGINS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ALLOWED_LOGINS/);
  });
  it('defaults to loopback on port 3000 and /data', () => {
    const c = loadConfig(prodEnv);
    expect([c.bindHost, c.port, c.dataDir]).toEqual(['127.0.0.1', 3000, '/data']);
  });
});
