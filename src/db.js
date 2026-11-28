/**
 * Persistent storage layer.
 * Uses Node.js 22 built-in SQLite (`node:sqlite`) when available, and seamlessly
 * falls back to atomic JSON storage on runtimes without `node:sqlite`.
 */

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;
let jsonState = null;
const JSON_PATH = path.join(DATA_DIR, "fiyatradar.json");

try {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(path.join(DATA_DIR, "fiyatradar.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      result_count INTEGER DEFAULT 0,
      min_price REAL,
      searched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      image TEXT DEFAULT '',
      folder TEXT DEFAULT 'Diğer',
      target_price REAL,
      initial_net_price REAL,
      previous_net_price REAL,
      last_net_price REAL,
      lowest_seen_price REAL,
      best_store TEXT DEFAULT '',
      verdict_score INTEGER,
      verdict_label TEXT DEFAULT '',
      fake_discount_status TEXT DEFAULT '',
      fake_discount_label TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      net_price REAL NOT NULL,
      best_store TEXT DEFAULT '',
      offer_count INTEGER DEFAULT 0,
      captured_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_product ON price_snapshots(product_id, captured_at);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Idempotent schema migrations for pre-existing databases
  const watchlistMigrations = [
    "ALTER TABLE watchlist ADD COLUMN folder TEXT DEFAULT 'Diğer'",
    "ALTER TABLE watchlist ADD COLUMN initial_net_price REAL",
    "ALTER TABLE watchlist ADD COLUMN previous_net_price REAL",
    "ALTER TABLE watchlist ADD COLUMN fake_discount_status TEXT DEFAULT ''",
    "ALTER TABLE watchlist ADD COLUMN fake_discount_label TEXT DEFAULT ''",
  ];
  for (const sql of watchlistMigrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  }
} catch {
  // Fallback to atomic JSON persistence
  try {
    jsonState = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
    if (!Array.isArray(jsonState.push_subscriptions)) jsonState.push_subscriptions = [];
  } catch {
    jsonState = { search_history: [], watchlist: [], price_snapshots: [], push_subscriptions: [] };
  }
}

function saveJson() {
  if (!jsonState) return;
  try {
    fs.writeFileSync(JSON_PATH, JSON.stringify(jsonState, null, 2), "utf-8");
  } catch {
    // Non-fatal on read-only FS
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalizeFolderName(raw) {
  const cleaned = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 32);
  return cleaned || "Diğer";
}

function decorateWatchRow(row) {
  const lastNet = typeof row.last_net_price === "number" && Number.isFinite(row.last_net_price) ? row.last_net_price : null;
  const initNet =
    typeof row.initial_net_price === "number" && Number.isFinite(row.initial_net_price)
      ? row.initial_net_price
      : lastNet;
  const prevNet =
    typeof row.previous_net_price === "number" && Number.isFinite(row.previous_net_price)
      ? row.previous_net_price
      : null;

  const priceChangeFromInitial =
    lastNet !== null && initNet !== null ? round2(lastNet - initNet) : 0;
  const priceChangeFromInitialPct =
    lastNet !== null && initNet !== null && initNet > 0
      ? round2(((lastNet - initNet) / initNet) * 100)
      : 0;
  const priceChangeFromPrev =
    lastNet !== null && prevNet !== null ? round2(lastNet - prevNet) : 0;

  return {
    ...row,
    folder: normalizeFolderName(row.folder),
    initial_net_price: initNet,
    previous_net_price: prevNet,
    fake_discount_status: row.fake_discount_status || "",
    fake_discount_label: row.fake_discount_label || "",
    priceChangeFromInitial,
    priceChangeFromInitialPct,
    priceChangeFromPrev,
    targetReached:
      typeof row.target_price === "number" &&
      lastNet !== null &&
      lastNet <= row.target_price,
  };
}

/**
 * Computes per-folder & overall budget totals and price-change summary for watched items.
 */
export function summarizeWatchlistBudget(items, folderFilter = "") {
  const all = Array.isArray(items) ? items : [];
  const folderMap = new Map();

  for (const raw of all) {
    const w = decorateWatchRow(raw);
    const f = w.folder;
    if (!folderMap.has(f)) {
      folderMap.set(f, {
        folder: f,
        count: 0,
        currentTotal: 0,
        targetTotal: 0,
        initialTotal: 0,
        targetHits: 0,
      });
    }
    const bucket = folderMap.get(f);
    bucket.count += 1;
    const cur = typeof w.last_net_price === "number" ? w.last_net_price : 0;
    const init = typeof w.initial_net_price === "number" ? w.initial_net_price : cur;
    const tgt = typeof w.target_price === "number" && w.target_price > 0 ? w.target_price : cur;
    bucket.currentTotal = round2(bucket.currentTotal + cur);
    bucket.initialTotal = round2(bucket.initialTotal + init);
    bucket.targetTotal = round2(bucket.targetTotal + tgt);
    if (w.targetReached) bucket.targetHits += 1;
  }

  const folders = [...folderMap.values()]
    .map((b) => ({
      ...b,
      netDelta: round2(b.currentTotal - b.initialTotal),
      netDeltaPct: b.initialTotal > 0 ? round2(((b.currentTotal - b.initialTotal) / b.initialTotal) * 100) : 0,
      gapToTarget: round2(b.currentTotal - b.targetTotal),
    }))
    .sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder, "tr"));

  const scoped = folderFilter
    ? all.filter((w) => normalizeFolderName(w.folder) === normalizeFolderName(folderFilter))
    : all;

  let currentTotal = 0;
  let targetTotal = 0;
  let initialTotal = 0;
  let targetHits = 0;
  let itemsWithTarget = 0;

  for (const raw of scoped) {
    const w = decorateWatchRow(raw);
    const cur = typeof w.last_net_price === "number" ? w.last_net_price : 0;
    const init = typeof w.initial_net_price === "number" ? w.initial_net_price : cur;
    const hasTgt = typeof w.target_price === "number" && w.target_price > 0;
    const tgt = hasTgt ? w.target_price : cur;
    currentTotal = round2(currentTotal + cur);
    initialTotal = round2(initialTotal + init);
    targetTotal = round2(targetTotal + tgt);
    if (hasTgt) itemsWithTarget += 1;
    if (w.targetReached) targetHits += 1;
  }

  const netDelta = round2(currentTotal - initialTotal);
  const netDeltaPct = initialTotal > 0 ? round2((netDelta / initialTotal) * 100) : 0;
  const gapToTarget = round2(currentTotal - targetTotal);

  return {
    activeFolder: folderFilter || "Tümü",
    count: scoped.length,
    totalCount: all.length,
    currentTotal,
    targetTotal,
    initialTotal,
    netDelta,
    netDeltaPct,
    gapToTarget,
    itemsWithTarget,
    targetHits,
    folders,
  };
}

export function recordSearch(query, resultCount, minPrice) {
  const now = new Date().toISOString();
  if (db) {
    db.prepare("DELETE FROM search_history WHERE lower(query) = lower(?)").run(query);
    db.prepare(
      "INSERT INTO search_history (query, result_count, min_price, searched_at) VALUES (?, ?, ?, ?)"
    ).run(query, resultCount || 0, minPrice ?? null, now);
    db.prepare(
      "DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY id DESC LIMIT 40)"
    ).run();
    return;
  }

  jsonState.search_history = jsonState.search_history.filter(
    (h) => h.query.toLowerCase() !== query.toLowerCase()
  );
  jsonState.search_history.unshift({
    id: Date.now(),
    query,
    result_count: resultCount || 0,
    min_price: minPrice ?? null,
    searched_at: now,
  });
  jsonState.search_history = jsonState.search_history.slice(0, 40);
  saveJson();
}

export function getSearchHistory(limit = 20) {
  if (db) {
    return db
      .prepare(
        "SELECT id, query, result_count, min_price, searched_at FROM search_history ORDER BY id DESC LIMIT ?"
      )
      .all(limit);
  }
  return jsonState.search_history.slice(0, limit);
}

export function clearSearchHistory() {
  if (db) {
    db.prepare("DELETE FROM search_history").run();
    return;
  }
  jsonState.search_history = [];
  saveJson();
}

const SNAPSHOT_THROTTLE_MS = 6 * 60 * 60 * 1000;

export function recordSnapshot(productId, netPrice, bestStore, offerCount) {
  if (!productId || !Number.isFinite(netPrice)) return;
  const key = String(productId);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  if (db) {
    const last = db
      .prepare(
        `SELECT net_price, captured_at FROM price_snapshots
         WHERE product_id = ? ORDER BY captured_at DESC LIMIT 1`
      )
      .get(key);
    if (
      last &&
      Math.abs(Number(last.net_price) - netPrice) < 0.01 &&
      nowMs - Date.parse(last.captured_at) < SNAPSHOT_THROTTLE_MS
    ) {
      return;
    }
    db.prepare(
      "INSERT INTO price_snapshots (product_id, net_price, best_store, offer_count, captured_at) VALUES (?, ?, ?, ?, ?)"
    ).run(key, netPrice, bestStore || "", offerCount || 0, now);
    return;
  }

  for (let i = jsonState.price_snapshots.length - 1; i >= 0; i--) {
    const s = jsonState.price_snapshots[i];
    if (s.product_id === key) {
      if (
        Math.abs(Number(s.net_price) - netPrice) < 0.01 &&
        nowMs - Date.parse(s.captured_at) < SNAPSHOT_THROTTLE_MS
      ) {
        return;
      }
      break;
    }
  }

  jsonState.price_snapshots.push({
    product_id: key,
    net_price: netPrice,
    best_store: bestStore || "",
    offer_count: offerCount || 0,
    captured_at: now,
  });
  if (jsonState.price_snapshots.length > 500) {
    jsonState.price_snapshots = jsonState.price_snapshots.slice(-500);
  }
  saveJson();
}

export function getPriceSnapshots(productId, limit = 90) {
  if (!productId) return [];
  const key = String(productId);
  if (db) {
    const rows = db
      .prepare(
        `SELECT net_price, best_store, offer_count, captured_at
         FROM price_snapshots WHERE product_id = ? ORDER BY captured_at DESC LIMIT ?`
      )
      .all(key, limit);
    return rows.reverse();
  }
  return jsonState.price_snapshots
    .filter((s) => s.product_id === key)
    .slice(-limit);
}

export function getWatchlistItemByUrl(url) {
  if (!url) return null;
  if (db) {
    const row = db.prepare("SELECT * FROM watchlist WHERE url = ?").get(String(url));
    return row ? decorateWatchRow(row) : null;
  }
  const row = jsonState.watchlist.find((w) => w.url === String(url));
  return row ? decorateWatchRow(row) : null;
}

export function getWatchlist() {
  if (db) {
    return db
      .prepare(
        `SELECT id, title, url, image, folder, target_price, initial_net_price, previous_net_price,
                last_net_price, lowest_seen_price, best_store, verdict_score, verdict_label,
                fake_discount_status, fake_discount_label, created_at, updated_at
         FROM watchlist ORDER BY updated_at DESC`
      )
      .all()
      .map(decorateWatchRow);
  }
  return [...jsonState.watchlist]
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .map(decorateWatchRow);
}

export function upsertWatchlistItem(item) {
  const now = new Date().toISOString();
  const id = String(item.id || Buffer.from(item.url).toString("base64url").slice(0, 16));
  const lastNet = typeof item.last_net_price === "number" && Number.isFinite(item.last_net_price) ? item.last_net_price : null;
  const targetPrice =
    typeof item.target_price === "number" && Number.isFinite(item.target_price) && item.target_price > 0
      ? item.target_price
      : null;
  const requestedFolder = item.folder ? normalizeFolderName(item.folder) : null;
  const fakeStatus = String(item.fake_discount_status || "");
  const fakeLabel = String(item.fake_discount_label || "");

  if (db) {
    const existing = db
      .prepare(
        "SELECT folder, initial_net_price, previous_net_price, last_net_price, lowest_seen_price, created_at FROM watchlist WHERE id = ? OR url = ?"
      )
      .get(id, item.url);
    const prevLow = existing?.lowest_seen_price ?? null;
    const lowestSeen =
      lastNet !== null && prevLow !== null ? Math.min(lastNet, prevLow) : lastNet ?? prevLow;
    const initialNet =
      typeof existing?.initial_net_price === "number" && existing.initial_net_price > 0
        ? existing.initial_net_price
        : typeof item.initial_net_price === "number" && item.initial_net_price > 0
          ? item.initial_net_price
          : existing?.last_net_price ?? lastNet;
    const prevNet =
      existing &&
      typeof existing.last_net_price === "number" &&
      lastNet !== null &&
      Math.abs(existing.last_net_price - lastNet) > 0.01
        ? existing.last_net_price
        : existing?.previous_net_price ?? null;
    const folder = requestedFolder || normalizeFolderName(existing?.folder || "Diğer");

    db.prepare(
      `INSERT INTO watchlist (
         id, title, url, image, folder, target_price, initial_net_price, previous_net_price,
         last_net_price, lowest_seen_price, best_store, verdict_score, verdict_label,
         fake_discount_status, fake_discount_label, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         image = COALESCE(NULLIF(excluded.image, ''), watchlist.image),
         folder = COALESCE(NULLIF(excluded.folder, ''), watchlist.folder),
         target_price = COALESCE(excluded.target_price, watchlist.target_price),
         initial_net_price = COALESCE(watchlist.initial_net_price, excluded.initial_net_price),
         previous_net_price = COALESCE(excluded.previous_net_price, watchlist.previous_net_price),
         last_net_price = COALESCE(excluded.last_net_price, watchlist.last_net_price),
         lowest_seen_price = COALESCE(excluded.lowest_seen_price, watchlist.lowest_seen_price),
         best_store = COALESCE(NULLIF(excluded.best_store, ''), watchlist.best_store),
         verdict_score = COALESCE(excluded.verdict_score, watchlist.verdict_score),
         verdict_label = COALESCE(NULLIF(excluded.verdict_label, ''), watchlist.verdict_label),
         fake_discount_status = COALESCE(NULLIF(excluded.fake_discount_status, ''), watchlist.fake_discount_status),
         fake_discount_label = COALESCE(NULLIF(excluded.fake_discount_label, ''), watchlist.fake_discount_label),
         updated_at = excluded.updated_at`
    ).run(
      id,
      item.title,
      item.url,
      item.image || "",
      folder,
      targetPrice,
      initialNet,
      prevNet,
      lastNet,
      lowestSeen,
      item.best_store || "",
      item.verdict_score ?? null,
      item.verdict_label || "",
      fakeStatus,
      fakeLabel,
      existing?.created_at || now,
      now
    );

    if (lastNet !== null) {
      recordSnapshot(id, lastNet, item.best_store || "", item.offer_count || 0);
    }
    return decorateWatchRow(db.prepare("SELECT * FROM watchlist WHERE url = ?").get(item.url));
  }

  const idx = jsonState.watchlist.findIndex((w) => w.url === item.url || w.id === id);
  const existing = idx >= 0 ? jsonState.watchlist[idx] : null;
  const prevLow = existing?.lowest_seen_price ?? null;
  const lowestSeen =
    lastNet !== null && prevLow !== null ? Math.min(lastNet, prevLow) : lastNet ?? prevLow;
  const initialNet =
    typeof existing?.initial_net_price === "number" && existing.initial_net_price > 0
      ? existing.initial_net_price
      : typeof item.initial_net_price === "number" && item.initial_net_price > 0
        ? item.initial_net_price
        : existing?.last_net_price ?? lastNet;
  const prevNet =
    existing &&
    typeof existing.last_net_price === "number" &&
    lastNet !== null &&
    Math.abs(existing.last_net_price - lastNet) > 0.01
      ? existing.last_net_price
      : existing?.previous_net_price ?? null;

  const row = {
    id: existing?.id || id,
    title: item.title,
    url: item.url,
    image: item.image || existing?.image || "",
    folder: requestedFolder || normalizeFolderName(existing?.folder || "Diğer"),
    target_price: targetPrice ?? existing?.target_price ?? null,
    initial_net_price: initialNet,
    previous_net_price: prevNet,
    last_net_price: lastNet ?? existing?.last_net_price ?? null,
    lowest_seen_price: lowestSeen,
    best_store: item.best_store || existing?.best_store || "",
    verdict_score: item.verdict_score ?? existing?.verdict_score ?? null,
    verdict_label: item.verdict_label || existing?.verdict_label || "",
    fake_discount_status: fakeStatus || existing?.fake_discount_status || "",
    fake_discount_label: fakeLabel || existing?.fake_discount_label || "",
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (idx >= 0) jsonState.watchlist[idx] = row;
  else jsonState.watchlist.unshift(row);
  saveJson();
  return decorateWatchRow(row);
}

export function updateWatchlistItem(id, updates = {}) {
  const now = new Date().toISOString();
  const hasTarget = Object.prototype.hasOwnProperty.call(updates, "target_price");
  const hasFolder = Object.prototype.hasOwnProperty.call(updates, "folder");

  const targetVal = hasTarget
    ? typeof updates.target_price === "number" && Number.isFinite(updates.target_price) && updates.target_price > 0
      ? updates.target_price
      : null
    : undefined;
  const folderVal = hasFolder ? normalizeFolderName(updates.folder) : undefined;

  if (db) {
    const existing = db.prepare("SELECT * FROM watchlist WHERE id = ?").get(String(id));
    if (!existing) return null;
    const nextTarget = hasTarget ? targetVal : existing.target_price;
    const nextFolder = hasFolder ? folderVal : normalizeFolderName(existing.folder);
    db.prepare("UPDATE watchlist SET target_price = ?, folder = ?, updated_at = ? WHERE id = ?").run(
      nextTarget,
      nextFolder,
      now,
      String(id)
    );
    return decorateWatchRow(db.prepare("SELECT * FROM watchlist WHERE id = ?").get(String(id)));
  }

  const row = jsonState.watchlist.find((w) => w.id === String(id));
  if (!row) return null;
  if (hasTarget) row.target_price = targetVal;
  if (hasFolder) row.folder = folderVal;
  row.updated_at = now;
  saveJson();
  return decorateWatchRow(row);
}

export function updateWatchlistTarget(id, targetPrice) {
  return updateWatchlistItem(id, { target_price: targetPrice });
}

export function removeWatchlistItem(id) {
  if (db) {
    const res = db.prepare("DELETE FROM watchlist WHERE id = ?").run(String(id));
    return res.changes > 0;
  }
  const before = jsonState.watchlist.length;
  jsonState.watchlist = jsonState.watchlist.filter((w) => w.id !== String(id));
  saveJson();
  return jsonState.watchlist.length < before;
}

// ============================================================================
// WEB PUSH SUBSCRIPTIONS (iOS Safari 16.4+ PWA & Desktop Push)
// ============================================================================
export function savePushSubscription(sub, userAgent = "") {
  const endpoint = String(sub?.endpoint || "").trim();
  const p256dh = String(sub?.keys?.p256dh || "").trim();
  const auth = String(sub?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Geçersiz bildirim aboneliği (endpoint veya anahtarlar eksik).");
  }
  const now = new Date().toISOString();
  const ua = String(userAgent || "").slice(0, 180);

  if (db) {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`
    ).run(endpoint, p256dh, auth, ua, now, now);
    return { endpoint, keys: { p256dh, auth }, updated_at: now };
  }

  if (!Array.isArray(jsonState.push_subscriptions)) jsonState.push_subscriptions = [];
  const idx = jsonState.push_subscriptions.findIndex((s) => s.endpoint === endpoint);
  const entry = {
    endpoint,
    p256dh,
    auth,
    user_agent: ua,
    created_at: idx >= 0 ? jsonState.push_subscriptions[idx].created_at : now,
    updated_at: now,
  };
  if (idx >= 0) jsonState.push_subscriptions[idx] = entry;
  else jsonState.push_subscriptions.push(entry);
  saveJson();
  return { endpoint, keys: { p256dh, auth }, updated_at: now };
}

export function getPushSubscriptions() {
  if (db) {
    const rows = db
      .prepare("SELECT endpoint, p256dh, auth, user_agent, created_at, updated_at FROM push_subscriptions")
      .all();
    return rows.map((r) => ({
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth },
      user_agent: r.user_agent,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }
  const list = Array.isArray(jsonState.push_subscriptions) ? jsonState.push_subscriptions : [];
  return list.map((r) => ({
    endpoint: r.endpoint,
    keys: { p256dh: r.p256dh, auth: r.auth },
    user_agent: r.user_agent,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function removePushSubscription(endpoint) {
  const clean = String(endpoint || "").trim();
  if (!clean) return false;
  if (db) {
    const res = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(clean);
    return res.changes > 0;
  }
  if (!Array.isArray(jsonState.push_subscriptions)) return false;
  const before = jsonState.push_subscriptions.length;
  jsonState.push_subscriptions = jsonState.push_subscriptions.filter((s) => s.endpoint !== clean);
  saveJson();
  return jsonState.push_subscriptions.length < before;
}
