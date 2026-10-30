import path from 'node:path';

export interface Config {
  port: number;
  bindHost: string;
  dataDir: string;
  allowedLogins: Set<string>;
  devUser: string | null;
  production: boolean;
  /** IANA zone for dates and day counts (TZ). */
  timeZone: string;
  /** Web Push keys (SPEC §9); without them reminders are off. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const devUser = env.DEV_USER?.trim() || null;
  const allowedLogins = new Set(
    (env.ALLOWED_LOGINS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  if (production && devUser) {
    throw new Error('DEV_USER must not be set when NODE_ENV=production.');
  }
  if (production && allowedLogins.size === 0) {
    throw new Error('ALLOWED_LOGINS is required when NODE_ENV=production.');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const timeZone = env.TZ || 'Europe/Bratislava';
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error(`Invalid TZ: ${timeZone}`);
  }

  const vapidKeys = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].map((k) => k?.trim() || '');
  const vapidSet = vapidKeys.filter(Boolean).length;
  if (vapidSet > 0 && vapidSet < 3) {
    throw new Error('Set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none of them.');
  }
  const [publicKey, privateKey, subject] = vapidKeys as [string, string, string];
  if (vapidSet && !/^(mailto:|https:)/.test(subject)) {
    throw new Error('VAPID_SUBJECT must be a mailto: or https: URL.');
  }

  return {
    port,
    bindHost: env.BIND_HOST || '127.0.0.1',
    dataDir: path.resolve(env.DATA_DIR || '/data'),
    allowedLogins,
    devUser,
    production,
    timeZone,
    vapid: vapidSet ? { publicKey, privateKey, subject } : null,
  };
}
