/**
 * FiyatRadar — Browser / iOS 16.4+ PWA Web Push Client Controller
 * Handles VAPID subscription, automatic re-sync after server restarts,
 * iOS Home-Screen prerequisite detection, and instant test notifications.
 */

const VAPID_STORAGE_KEY = "fiyatradar_vapid_pub";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export function getPushEnvironment() {
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;
  const supported = hasServiceWorker && hasPushManager && hasNotification;
  const needsHomeScreenInstall = isIos && !isStandalone;
  const permission = hasNotification ? Notification.permission : "unsupported";

  return {
    isIos,
    isStandalone,
    supported,
    needsHomeScreenInstall,
    permission,
  };
}

export async function getCurrentPushSubscription() {
  const env = getPushEnvironment();
  if (!env.supported) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeToPush(apiFetch) {
  const env = getPushEnvironment();
  if (env.needsHomeScreenInstall) {
    throw new Error(
      "iPhone'da kilit ekranı bildirimi için önce Safari'den Paylaş (↑) → Ana Ekrana Ekle yapıp uygulamayı ana ekrandan açmalısınız."
    );
  }
  if (!env.supported) {
    throw new Error("Bu tarayıcı Web Push bildirimlerini desteklemiyor.");
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error("Bildirim izni verilmedi. iPhone Ayarlar > Bildirimler > FiyatRadar kısmından açabilirsiniz.");
  }

  const cfg = await apiFetch("/api/push/config");
  if (!cfg?.publicKey) {
    throw new Error("Sunucu bildirim anahtarı alınamadı.");
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  // If server's VAPID public key changed (e.g., cloud restart), renew subscription cleanly
  const prevKey = localStorage.getItem(VAPID_STORAGE_KEY) || "";
  if (sub && prevKey && prevKey !== cfg.publicKey) {
    try {
      await sub.unsubscribe();
    } catch {
      // Ignore
    }
    sub = null;
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
    });
  }

  try {
    localStorage.setItem(VAPID_STORAGE_KEY, cfg.publicKey);
  } catch {
    // Ignore storage quota
  }

  await apiFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });

  return { subscription: sub, config: cfg };
}

export async function unsubscribeFromPush(apiFetch) {
  const sub = await getCurrentPushSubscription();
  if (!sub) return false;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    // Ignore
  }
  try {
    await apiFetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // Non-fatal
  }
  return true;
}

export async function sendTestPush(apiFetch) {
  const sub = await getCurrentPushSubscription();
  if (!sub) {
    throw new Error("Önce kilit ekranı bildirimlerini aktifleştirmelisiniz.");
  }
  return apiFetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
}

/**
 * Silent boot sync: keeps server subscription alive across Render restarts.
 */
export async function syncExistingPushSubscription(apiFetch) {
  const env = getPushEnvironment();
  if (!env.supported || env.permission !== "granted") return null;
  try {
    const cfg = await apiFetch("/api/push/config");
    if (!cfg?.publicKey) return null;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const prevKey = localStorage.getItem(VAPID_STORAGE_KEY) || "";

    if (sub && prevKey && prevKey !== cfg.publicKey) {
      await sub.unsubscribe().catch(() => {});
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
      });
    }

    if (sub) {
      try {
        localStorage.setItem(VAPID_STORAGE_KEY, cfg.publicKey);
      } catch {
        // Ignore
      }
      await apiFetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
    }
    return sub;
  } catch {
    return null;
  }
}
