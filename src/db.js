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
      target_price REAL,
      last_net_price REAL,
      lowest_seen_price REAL,
      best_store TEXT DEFAULT '',
      verdict_score INTEGER,
      verdict_label TEXT DEFAULT '',
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
  `);
} catch {
  // Fallback to atomic JSON persistence
  try {
    jsonState = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  } catch {
    jsonState = { search_history: [], watchlist: [], price_snapshots: [] };
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

function decorateWatchRow(row) {
  return {
    ...row,
    targetReached:
      typeof row.target_price === "number" &&
      typeof row.last_net_price === "number" &&
      row.last_net_price <= row.target_price,
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

export function recordSnapshot(productId, netPrice, bestStore, offerCount) {
  if (!productId || !Number.isFinite(netPrice)) return;
  const now = new Date().toISOString();
  if (db) {
    db.prepare(
      "INSERT INTO price_snapshots (product_id, net_price, best_store, offer_count, captured_at) VALUES (?, ?, ?, ?, ?)"
    ).run(String(productId), netPrice, bestStore || "", offerCount || 0, now);
    return;
  }
  jsonState.price_snapshots.push({
    product_id: String(productId),
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
    return db
      .prepare(
        `SELECT net_price, best_store, offer_count, captured_at
         FROM price_snapshots WHERE product_id = ? ORDER BY captured_at ASC LIMIT ?`
      )
      .all(key, limit);
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
        `SELECT id, title, url, image, target_price, last_net_price, lowest_seen_price,
                best_store, verdict_score, verdict_label, created_at, updated_at
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
  const lastNet = typeof item.last_net_price === "number" ? item.last_net_price : null;
  const targetPrice =
    typeof item.target_price === "number" && Number.isFinite(item.target_price) && item.target_price > 0
      ? item.target_price
      : null;

  if (db) {
    const existing = db
      .prepare("SELECT lowest_seen_price, created_at FROM watchlist WHERE id = ? OR url = ?")
      .get(id, item.url);
    const prevLow = existing?.lowest_seen_price ?? null;
    const lowestSeen =
      lastNet !== null && prevLow !== null ? Math.min(lastNet, prevLow) : lastNet ?? prevLow;

    db.prepare(
      `INSERT INTO watchlist (
         id, title, url, image, target_price, last_net_price, lowest_seen_price,
         best_store, verdict_score, verdict_label, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         image = COALESCE(NULLIF(excluded.image, ''), watchlist.image),
         target_price = COALESCE(excluded.target_price, watchlist.target_price),
         last_net_price = COALESCE(excluded.last_net_price, watchlist.last_net_price),
         lowest_seen_price = COALESCE(excluded.lowest_seen_price, watchlist.lowest_seen_price),
         best_store = COALESCE(NULLIF(excluded.best_store, ''), watchlist.best_store),
         verdict_score = COALESCE(excluded.verdict_score, watchlist.verdict_score),
         verdict_label = COALESCE(NULLIF(excluded.verdict_label, ''), watchlist.verdict_label),
         updated_at = excluded.updated_at`
    ).run(
      id,
      item.title,
      item.url,
      item.image || "",
      targetPrice,
      lastNet,
      lowestSeen,
      item.best_store || "",
      item.verdict_score ?? null,
      item.verdict_label || "",
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

  const row = {
    id: existing?.id || id,
    title: item.title,
    url: item.url,
    image: item.image || existing?.image || "",
    target_price: targetPrice ?? existing?.target_price ?? null,
    last_net_price: lastNet ?? existing?.last_net_price ?? null,
    lowest_seen_price: lowestSeen,
    best_store: item.best_store || existing?.best_store || "",
    verdict_score: item.verdict_score ?? existing?.verdict_score ?? null,
    verdict_label: item.verdict_label || existing?.verdict_label || "",
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (idx >= 0) jsonState.watchlist[idx] = row;
  else jsonState.watchlist.unshift(row);
  saveJson();
  return decorateWatchRow(row);
}

export function updateWatchlistTarget(id, targetPrice) {
  const now = new Date().toISOString();
  const val =
    typeof targetPrice === "number" && Number.isFinite(targetPrice) && targetPrice > 0
      ? targetPrice
      : null;

  if (db) {
    const res = db
      .prepare("UPDATE watchlist SET target_price = ?, updated_at = ? WHERE id = ?")
      .run(val, now, String(id));
    if (!res.changes) return null;
    return decorateWatchRow(db.prepare("SELECT * FROM watchlist WHERE id = ?").get(String(id)));
  }

  const row = jsonState.watchlist.find((w) => w.id === String(id));
  if (!row) return null;
  row.target_price = val;
  row.updated_at = now;
  saveJson();
  return decorateWatchRow(row);
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
