import type { Context, MiddlewareHandler } from 'hono';
import type { Config } from './config.ts';

export interface User {
  login: string;
  name: string;
}

export type AppEnv = { Variables: { user: User } };

export type PeerResolver = (c: Context) => string | undefined;

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

// Serve sends non-ASCII names as RFC 2047 encoded-words, e.g. "=?utf-8?q?Mart=C3=ADn?=".
export function decodeHeaderName(value: string): string {
  return value.replace(/=\?([^?]+)\?([qQbB])\?([^?]*)\?=/g, (whole, charset: string, enc: string, text: string) => {
    try {
      const bytes =
        enc.toLowerCase() === 'b'
          ? Buffer.from(text, 'base64')
          : Buffer.from(
              text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
              'latin1',
            );
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return whole;
    }
  });
}

function forbid(c: Context, message: string) {
  return c.text(`${message}\n`, 403);
}

export function tailscaleAuth(config: Config, getPeer: PeerResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (config.devUser) {
      c.set('user', { login: config.devUser, name: config.devUser });
      return next();
    }

    const peer = getPeer(c);
    if (!isLoopback(peer)) {
      console.warn(`403 non-loopback peer ${peer ?? 'unknown'} ${c.req.method} ${c.req.path}`);
      return forbid(c, 'Forbidden: this app is only reachable through Tailscale Serve.');
    }

    const login = c.req.header('Tailscale-User-Login')?.trim();
    if (!login) {
      console.warn(`403 no identity header ${c.req.method} ${c.req.path}`);
      return forbid(
        c,
        'Forbidden: no Tailscale identity. Tagged devices do not get identity headers; check that this device is not tagged in the Tailscale admin console.',
      );
    }
    if (!config.allowedLogins.has(login.toLowerCase())) {
      console.warn(`403 login not allowed: ${login}`);
      return forbid(c, `Forbidden: ${login} is not in ALLOWED_LOGINS.`);
    }

    const name = decodeHeaderName(c.req.header('Tailscale-User-Name')?.trim() || login);
    c.set('user', { login, name });
    return next();
  };
}
