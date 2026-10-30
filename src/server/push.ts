// Web Push (SPEC §9). The server sends to the device's push service (Apple's,
// for an iPhone), which delivers even while the phone is off the tailnet. A
// device that has unsubscribed answers 404 or 410, and its subscription goes.
import webpush from 'web-push';
import type { Config } from './config.ts';
import type { DB } from './db.ts';

export interface Notice {
  title: string;
  body: string;
  /** Opened on tap. */
  url: string;
  /** A newer notice with the same tag replaces the older one. */
  tag: string;
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = 'sent' | 'gone' | 'failed';
export type PushSender = (sub: Subscription, notice: Notice) => Promise<PushResult>;

export function webPushSender(vapid: NonNullable<Config['vapid']>): PushSender {
  return async (sub, notice) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(notice), {
        vapidDetails: vapid,
        // A reminder older than half a day is no use.
        TTL: 12 * 3600,
      });
      return 'sent';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      // The endpoint is a capability, so only its host is logged.
      console.error(`Push to ${new URL(sub.endpoint).host} failed: ${status ?? (err as Error).message}`);
      return 'failed';
    }
  };
}

/** Sends to every subscription, or to one endpoint; drops the gone ones. Returns how many were sent. */
export async function pushTo(db: DB, send: PushSender, notice: Notice, endpoint?: string): Promise<number> {
  const subs = (
    endpoint
      ? db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?').all(endpoint)
      : db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all()
  ) as Subscription[];
  let sent = 0;
  for (const sub of subs) {
    const result = await send(sub, notice);
    if (result === 'sent') sent++;
    if (result === 'gone') db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
  }
  return sent;
}
