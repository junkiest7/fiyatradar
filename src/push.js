/**
 * FiyatRadar — Native iOS 16.4+ & Desktop Web Push Engine (VAPID / RFC 8291)
 * Sends real lock-screen notifications when watched products hit target price
 * or drop by >= 10% — zero Telegram or third-party app required.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import * as webPush from "web-push";
import { getPushSubscriptions, removePushSubscription } from "./db.js";
import { formatTrNumber } from "./parsers.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const VAPID_FILE = path.join(DATA_DIR, "vapid.json");

let vapidKeys = null;
let configuredViaEnv = false;

// In-memory alert deduplication map: `${itemId}:${price}` -> timestamp
const recentAlertSent = new Map();
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

function loadOrCreateVapidKeys() {
  if (vapidKeys) return vapidKeys;

  const envPub = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const envPriv = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(process.env.VAPID_SUBJECT || "mailto:alerts@fiyatradar.app").trim();

  if (envPub && envPriv) {
    vapidKeys = { publicKey: envPub, privateKey: envPriv, subject };
    configuredViaEnv = true;
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      const stored = JSON.parse(fs.readFileSync(VAPID_FILE, "utf-8"));
      if (stored?.publicKey && stored?.privateKey) {
        vapidKeys = {
          publicKey: stored.publicKey,
          privateKey: stored.privateKey,
          subject: stored.subject || subject,
        };
      }
    } catch {
      // Generate fresh keys below
    }

    if (!vapidKeys) {
      const generated = webPush.generateVAPIDKeys();
      vapidKeys = {
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
        subject,
      };
      try {
        fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), { mode: 0o600 });
      } catch {
        // Non-fatal on read-only FS
      }
    }
  }

  webPush.setVapidDetails(vapidKeys.subject, vapidKeys.publicKey, vapidKeys.privateKey);
  return vapidKeys;
}

export function getPushConfig() {
  const keys = loadOrCreateVapidKeys();
  const subs = getPushSubscriptions();
  return {
    supported: true,
    publicKey: keys.publicKey,
    configuredViaEnv,
    subscriberCount: subs.length,
  };
}

/**
 * Validates that a PushSubscription endpoint is a safe public HTTPS push service URL.
 */
export function isValidPushEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint || "").trim());
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }
    if (net.isIP(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends a single encrypted Web Push notification and cleans up expired (404/410) endpoints.
 */
export async function sendPushToSubscription(subscription, payload) {
  loadOrCreateVapidKeys();
  if (!isValidPushEndpoint(subscription?.endpoint)) {
    throw new Error("Geçersiz push servisi adresi.");
  }

  const body = JSON.stringify({
    title: payload.title || "FiyatRadar Bildirimi",
    body: payload.body || "",
    url: payload.url || "/?view=watchlist",
    tag: payload.tag || "fiyatradar-alert",
    badgeCount: payload.badgeCount ?? 1,
    timestamp: Date.now(),
  });

  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      body,
      {
        TTL: 60 * 60 * 12, // 12 hours
        urgency: "high",
      }
    );
    return { ok: true };
  } catch (err) {
    const status = err?.statusCode || 0;
    if (status === 404 || status === 410) {
      removePushSubscription(subscription.endpoint);
      return { ok: false, expired: true, status };
    }
    return { ok: false, status, error: err?.message || "Push gönderilemedi." };
  }
}

/**
 * Broadcasts a push notification payload to all subscribed devices.
 */
export async function broadcastPush(payload) {
  const subs = getPushSubscriptions();
  if (!subs.length) return { sent: 0, failed: 0, expired: 0 };

  let sent = 0;
  let failed = 0;
  let expired = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const res = await sendPushToSubscription(sub, payload);
      if (res.ok) sent += 1;
      else if (res.expired) expired += 1;
      else failed += 1;
    })
  );

  return { sent, failed, expired };
}

/**
 * Pure detector comparing watchlist snapshots before & after a refresh to decide
 * which items deserve a real lock-screen push alert.
 */
export function detectWatchlistPushAlerts(beforeItems, afterItems) {
  const beforeMap = new Map((beforeItems || []).map((it) => [it.id, it]));
  const alerts = [];

  for (const after of afterItems || []) {
    const cur = typeof after.last_net_price === "number" && Number.isFinite(after.last_net_price) ? after.last_net_price : null;
    if (cur === null || cur <= 0) continue;

    const before = beforeMap.get(after.id);
    const prev =
      typeof before?.last_net_price === "number" && Number.isFinite(before.last_net_price) && before.last_net_price > 0
        ? before.last_net_price
        : null;

    const shortTitle = String(after.title || "Takip Ürünü").slice(0, 62);
    const storeSuffix = after.best_store ? ` (${after.best_store})` : "";
    const deepUrl = `/?product=${encodeURIComponent(after.url)}&title=${encodeURIComponent(after.title || "")}`;

    // Condition 1: Target price reached (newly reached or dropped even lower while below target)
    const targetHitNow = Boolean(after.targetReached && typeof after.target_price === "number" && cur <= after.target_price);
    const wasAlreadyHitAtSameOrLower = Boolean(before?.targetReached && prev !== null && cur >= prev);

    if (targetHitNow && !wasAlreadyHitAtSameOrLower) {
      alerts.push({
        type: "target_hit",
        itemId: after.id,
        price: cur,
        title: `🎯 Hedef Fiyat Yakalandı!`,
        body: `${shortTitle} → ${formatTrNumber(cur)} TL${storeSuffix} (Hedef: ${formatTrNumber(after.target_price)} TL)`,
        url: deepUrl,
        tag: `fr-target-${after.id}`,
      });
      continue;
    }

    // Condition 2: Significant price drop (>= 10% OR >= 5% and >= 100 TL)
    if (prev !== null && cur < prev) {
      const dropTl = Math.round((prev - cur) * 100) / 100;
      const dropPct = Math.round(((prev - cur) / prev) * 1000) / 10;
      if (dropPct >= 10 || (dropPct >= 5 && dropTl >= 100)) {
        alerts.push({
          type: "price_drop",
          itemId: after.id,
          price: cur,
          dropTl,
          dropPct,
          title: `📉 %${dropPct} Fiyat Düştü!`,
          body: `${shortTitle}: ${formatTrNumber(prev)} TL → ${formatTrNumber(cur)} TL (-${formatTrNumber(dropTl)} TL)${storeSuffix}`,
          url: deepUrl,
          tag: `fr-drop-${after.id}`,
        });
      }
    }
  }

  return alerts;
}

/**
 * Evaluates price changes and dispatches deduplicated iOS/Desktop lock-screen push alerts.
 */
export async function notifyWatchlistPriceDrops(beforeItems, afterItems) {
  const alerts = detectWatchlistPushAlerts(beforeItems, afterItems);
  if (!alerts.length) return { alerts: [], pushSentCount: 0 };

  const now = Date.now();
  let pushSentCount = 0;

  for (const alert of alerts) {
    const dedupKey = `${alert.itemId}:${alert.price}`;
    const lastSent = recentAlertSent.get(dedupKey) || 0;
    if (now - lastSent < DEDUP_WINDOW_MS) continue;

    const res = await broadcastPush(alert);
    if (res.sent > 0) {
      recentAlertSent.set(dedupKey, now);
      pushSentCount += res.sent;
    }
  }

  return { alerts, pushSentCount };
}
