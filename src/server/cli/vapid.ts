// Usage: vapid
// Prints a new VAPID key pair for Web Push (SPEC §9), as the env lines to set.
// Keep the private key secret; changing the keys means every device has to
// enable reminders again.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
