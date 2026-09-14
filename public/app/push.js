import { apiPost } from "./sync.js";

export const pushEvents = new EventTarget();

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

export const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function toBytes(base64url) {
  const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission);
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await apiPost("/api/push/key", {});
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toBytes(publicKey)
    });
  }
  const raw = subscription.toJSON();
  await apiPost("/api/push/subscribe", { endpoint: raw.endpoint, keys: raw.keys });
  pushEvents.dispatchEvent(new CustomEvent("changed"));
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (subscription) {
    try {
      await apiPost("/api/push/unsubscribe", { endpoint: subscription.endpoint });
    } catch {}
    await subscription.unsubscribe();
  }
  pushEvents.dispatchEvent(new CustomEvent("changed"));
}

export function sendTestPush() {
  return apiPost("/api/push/test", {});
}
