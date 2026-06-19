// Web Push helpers: register the service worker, subscribe via the browser
// PushManager using the server's VAPID public key, and persist the subscription.
import api from "./api.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function getRegistration() {
  return navigator.serviceWorker.register("/sw.js");
}

// True when this browser already has an active push subscription.
export async function isPushEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// Request permission, subscribe, and register the subscription with the server.
export async function enablePush() {
  if (!pushSupported()) throw new Error("Notifiche non supportate da questo browser");

  const reg = await getRegistration();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permesso notifiche negato");

  const { data } = await api.get("/api/push/public-key");
  if (!data.publicKey) throw new Error("Push non configurato sul server");

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.publicKey),
  });

  await api.post("/api/push/subscribe", sub.toJSON());
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}
