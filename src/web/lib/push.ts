// Reminders on this device (SPEC §9). Enabling needs a tap (iOS asks for
// permission only then), the server reachable once, and on an iPhone the app
// installed to the Home Screen: Safari in a tab has no Web Push.
import { api } from './api.ts';
import { t } from './i18n.ts';

export type PushState = 'unsupported' | 'not-installed' | 'no-server-keys' | 'denied' | 'off' | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const register = (sub: PushSubscription) => {
  const { keys } = sub.toJSON();
  return api.post('/api/push/subscribe', { id: crypto.randomUUID(), endpoint: sub.endpoint, keys });
};

export async function pushState(publicKey: string | null): Promise<PushState> {
  if (!supported()) return isIos() && !installed() ? 'not-installed' : 'unsupported';
  if (!publicKey) return 'no-server-keys';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await current();
  // Tells the server again, in case it lost the subscription (a restored backup).
  if (sub) await register(sub).catch(() => undefined);
  return sub ? 'on' : 'off';
}

/** Call from a tap. Resolves to the state afterwards. */
export async function enablePush(publicKey: string): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey) });
  } catch (err) {
    // Permission was granted, so this is the phone's push service (the iOS Simulator has none).
    throw new Error(t('reminders.subscribeFailed', { error: err instanceof Error ? err.message : String(err) }));
  }
  try {
    await register(sub);
  } catch (err) {
    await sub.unsubscribe();
    throw err;
  }
  return 'on';
}

export async function disablePush(): Promise<void> {
  const sub = await current();
  if (!sub) return;
  await api.del('/api/push/subscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Whether the server could send this device a test reminder. */
export async function testPush(): Promise<boolean> {
  const sub = await current();
  if (!sub) return false;
  return (await api.post<{ sent: boolean }>('/api/push/test', { endpoint: sub.endpoint })).sent;
}

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
