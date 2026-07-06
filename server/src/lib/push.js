// Web Push (VAPID) delivery. No-op (with a warning) when VAPID keys are unset.
import webpush from "web-push";
import { prisma } from "./prisma.js";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:admin@casawallet.local",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

export function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send a push notification to the given subscriptions. Stale subscriptions
 * (404/410) are pruned automatically.
 * @param {Array} subs rows from PushSubscription
 * @param {{ title: string, body: string, url?: string }} msg
 */
async function sendToSubscriptions(subs, { title, body, url = "/" }) {
  if (!ensureConfigured()) {
    console.warn(`[push] VAPID non configurato — push saltata: "${title}"`);
    return { skipped: true };
  }

  const payload = JSON.stringify({ title, body, url });
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error("[push] invio fallito:", err.statusCode, err.body || err.message);
        }
      }
    })
  );

  return { sent, total: subs.length };
}

/**
 * Push a tutti i device di un singolo utente (es. promemoria tasse personale).
 * @param {string} userId
 * @param {{ title: string, body: string, url?: string }} msg
 */
export async function sendPushToUser(userId, msg) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  return sendToSubscriptions(subs, msg);
}

/**
 * Push a tutti i device di tutti i membri di una famiglia.
 * @param {string} householdId
 * @param {{ title: string, body: string, url?: string }} msg
 */
export async function sendPushToHousehold(householdId, msg) {
  const subs = await prisma.pushSubscription.findMany({
    where: { user: { householdId } },
  });
  return sendToSubscriptions(subs, msg);
}
