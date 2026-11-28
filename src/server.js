/**
 * FiyatRadar — Detaylı Fiyat Araştırma Botu Sunucusu
 * Express REST API + Statik Web Arayüzü
 */

import express from "express";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProductDetail,
  getSuggestions,
  normalizeProductUrl,
  searchProducts,
} from "./scraper.js";
import {
  clearSearchHistory,
  getPriceSnapshots,
  getPushSubscriptions,
  getSearchHistory,
  getWatchlist,
  recordSearch,
  recordSnapshot,
  removePushSubscription,
  removeWatchlistItem,
  savePushSubscription,
  summarizeWatchlistBudget,
  updateWatchlistItem,
  upsertWatchlistItem,
} from "./db.js";
import { resolveBarcode, searchSecondHandTurkey, testSerperKey } from "./providers.js";
import { optimizeCart } from "./optimizer.js";
import { annotateSearchPricePositions } from "./analyzer.js";
import {
  analyzeOfferAuthenticity,
  extractVariantAttributes,
  formatTrNumber,
  suggestWatchlistFolder,
  WATCHLIST_FOLDERS,
} from "./parsers.js";
import {
  broadcastPush,
  getPushConfig,
  isValidPushEndpoint,
  notifyWatchlistPriceDrops,
  sendPushToSubscription,
} from "./push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3456;

app.use(express.json({ limit: "1mb" }));
app.get("/sw.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.sendFile(path.join(PUBLIC_DIR, "sw.js"));
});
app.get("/manifest.webmanifest", (_req, res) => {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.sendFile(path.join(PUBLIC_DIR, "manifest.webmanifest"));
});
app.use(express.static(PUBLIC_DIR));

// SSRF-safe IP check for same-origin product image proxy (used by Canvas PNG Share Cards)
export function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map((n) => Number.parseInt(n, 10));
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80:") || low.startsWith("::ffff:127.") || low.startsWith("::ffff:10.") || low.startsWith("::ffff:192.168.") || low.startsWith("::ffff:169.254.")) {
      return true;
    }
    return false;
  }
  return true;
}

const MAX_IMAGE_PROXY_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 3;

async function validatePublicHttpsUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (net.isIP(host) && isPrivateOrReservedIp(host)) return null;
  const resolved = await dns.lookup(host, { all: true }).catch(() => []);
  if (!resolved.length || resolved.some((r) => isPrivateOrReservedIp(r.address))) return null;
  return parsed;
}

async function readStreamWithLimit(body, maxBytes) {
  if (!body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

// Lightweight in-memory IP rate limiter (no external dependency)
function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "local").split(",")[0].trim();
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      if (hits.size > 2000) hits.clear();
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Çok fazla istek gönderildi. Lütfen birkaç saniye sonra tekrar deneyin." });
    }
    return next();
  };
}

const searchRateLimit = createRateLimiter({ windowMs: 60_000, max: 35 });
const refreshRateLimit = createRateLimiter({ windowMs: 60_000, max: 8 });

app.get("/api/image-proxy", async (req, res) => {
  try {
    const raw = String(req.query.url || "").trim();
    if (!raw) return res.status(400).end();

    let currentUrl = await validatePublicHttpsUrl(raw);
    if (!currentUrl) return res.status(403).end();

    let upstream = null;
    for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop++) {
      upstream = await fetch(currentUrl.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get("location");
        if (!loc || hop === MAX_IMAGE_REDIRECTS) return res.status(403).end();
        const nextHref = new URL(loc, currentUrl).toString();
        currentUrl = await validatePublicHttpsUrl(nextHref);
        if (!currentUrl) return res.status(403).end();
        continue;
      }
      break;
    }

    if (!upstream || !upstream.ok) return res.status(404).end();

    const contentType = String(upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      return res.status(415).end();
    }

    const declaredLen = Number.parseInt(upstream.headers.get("content-length") || "0", 10);
    if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_PROXY_BYTES) {
      return res.status(413).end();
    }

    const buf = await readStreamWithLimit(upstream.body, MAX_IMAGE_PROXY_BYTES);
    if (!buf) return res.status(413).end();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.send(buf);
  } catch {
    res.status(404).end();
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "FiyatRadar",
    time: new Date().toISOString(),
  });
});

// Active provider configuration status (never leaks key values)
app.get("/api/providers", (req, res) => {
  const serverKeys = [
    ...String(process.env.SERPER_API_KEYS || "").split(/[\s,;]+/),
    String(process.env.SERPER_API_KEY || ""),
  ].filter(Boolean);
  const hasServerSerper = serverKeys.length > 0;
  const hasServerSerpApi = Boolean((process.env.SERPAPI_KEY || "").trim());
  res.json({
    googleShoppingReady: hasServerSerper || hasServerSerpApi,
    serverSerper: hasServerSerper,
    serverSerperKeyCount: serverKeys.length,
    serverSerpApi: hasServerSerpApi,
  });
});

// Live Turkish autocomplete suggestions
app.get("/api/suggest", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ suggestions: [] });
    const suggestions = await getSuggestions(q);
    res.json({ suggestions });
  } catch (err) {
    res.json({ suggestions: [], error: err.message });
  }
});

// Live product search with sorting and price filtering
app.get("/api/search", searchRateLimit, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({ error: "Lütfen aramak istediğiniz ürün adını veya bağlantısını yazın." });
    }

    const page = Number.parseInt(req.query.page, 10) || 1;
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const sort = String(req.query.sort || "relevance");
    const minPrice = req.query.minPrice ? Number.parseFloat(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number.parseFloat(req.query.maxPrice) : null;
    const serperKey = String(req.headers["x-serper-key"] || "").trim();
    const serpApiKey = String(req.headers["x-serpapi-key"] || "").trim();

    const result = await searchProducts(q, { page, refresh, serperKey, serpApiKey });
    let list = [...result.products];

    if (Number.isFinite(minPrice)) {
      list = list.filter((p) => typeof p.lowestPrice === "number" && p.lowestPrice >= minPrice);
    }
    if (Number.isFinite(maxPrice)) {
      list = list.filter((p) => typeof p.lowestPrice === "number" && p.lowestPrice <= maxPrice);
    }

    if (sort === "price_asc") {
      list.sort((a, b) => (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity));
    } else if (sort === "price_desc") {
      list.sort((a, b) => (b.lowestPrice ?? -1) - (a.lowestPrice ?? -1));
    } else if (sort === "offers_desc") {
      list.sort((a, b) => (b.offerCount ?? 0) - (a.offerCount ?? 0));
    } else if (sort === "unit_asc") {
      list.sort((a, b) => {
        const ua = a.unitInfo?.unitPrice ?? Infinity;
        const ub = b.unitInfo?.unitPrice ?? Infinity;
        if (ua !== ub) return ua - ub;
        return (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity);
      });
    }

    const validPrices = result.products.map((p) => p.lowestPrice).filter((v) => typeof v === "number" && v > 0);
    const globalMin = validPrices.length ? Math.min(...validPrices) : null;

    if (page === 1 && !result.directProduct) {
      try {
        recordSearch(q, result.totalFound, globalMin);
      } catch {
        // Non-fatal DB write error
      }
    }

    const enrichedProducts = list.map((p) => {
      const isSummary = p.badge === "Tüm Mağazalar";
      const isAggregatorCard = String(p.source || "").toLowerCase() === "akakçe";
      const shield = isSummary
        ? null
        : analyzeOfferAuthenticity(
            {
              offerTitle: p.title,
              store: {
                platform: isAggregatorCard ? "" : p.source || p.badge || "",
                seller: "",
                displayName: isAggregatorCard ? "" : p.source || p.badge || "",
                isOfficialSeller: isAggregatorCard ? false : Boolean(p.isOfficialStore),
              },
              url: p.externalUrl || "",
            },
            q
          );
      return {
        ...p,
        variantAttrs: isSummary
          ? { capacity: null, color: null, size: null, volume: null }
          : p.variantAttrs || extractVariantAttributes(p.title, p.isListingPage ? "" : p.externalUrl || ""),
        trustShield: shield,
      };
    });

    const annotatedProducts = annotateSearchPricePositions(enrichedProducts);

    res.json({
      ...result,
      filteredCount: annotatedProducts.length,
      products: annotatedProducts,
    });
  } catch (err) {
    res.status(502).json({
      error: err.message || "Ürün araması sırasında bir hata oluştu.",
    });
  }
});

// Dedicated Second-Hand & Tagged Resale Search (Dolap, Gardrops, sahibinden)
app.get("/api/search/secondhand", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return res.status(400).json({ error: "Arama terimi gereklidir." });
    }
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const keys = extractReqKeys(req);
    const data = await searchSecondHandTurkey(q, { refresh, ...keys });
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: err.message || "2. El / Etiketli araması sırasında bir hata oluştu.",
    });
  }
});

function extractReqKeys(req) {
  return {
    serperKey: String(req.headers["x-serper-key"] || "").trim(),
    serpApiKey: String(req.headers["x-serpapi-key"] || "").trim(),
  };
}

// Barcode lookup (EAN-8 / EAN-13 / UPC-A / GTIN-14)
app.get("/api/barcode/:code", async (req, res) => {
  try {
    const keys = extractReqKeys(req);
    const resolved = await resolveBarcode(req.params.code, keys);
    res.json(resolved);
  } catch (err) {
    res.status(400).json({ error: err.message || "Barkod çözümlenemedi." });
  }
});

// Deep single-product price analysis
app.get("/api/product", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) {
      return res.status(400).json({ error: "Ürün bağlantısı (url) gereklidir." });
    }
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const fallbackQuery = String(req.query.title || "").trim();
    const keys = extractReqKeys(req);
    const detail = await getProductDetail(rawUrl, { refresh, fallbackQuery, ...keys });

    if (detail.id && detail.stats?.minNet) {
      try {
        recordSnapshot(
          detail.id,
          detail.stats.minNet,
          detail.picks?.cheapestNet?.store || "",
          detail.totalOfferCount
        );
      } catch {
        // Non-fatal
      }
    }

    res.json(detail);
  } catch (err) {
    res.status(502).json({
      error: err.message || "Ürün detayları alınırken bir hata oluştu.",
    });
  }
});

// Recorded personal price history snapshots for a product
app.get("/api/snapshots/:id", (req, res) => {
  res.json({ items: getPriceSnapshots(req.params.id, 90) });
});

// Side-by-side comparison of up to 4 products
app.post("/api/compare", async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 4) : [];
    const titles = Array.isArray(req.body?.titles) ? req.body.titles : [];
    if (urls.length < 2) {
      return res.status(400).json({ error: "Karşılaştırma için en az 2 ürün seçmelisiniz." });
    }

    const keys = extractReqKeys(req);
    const entries = urls
      .map((u, idx) => ({ url: normalizeProductUrl(u), title: String(titles[idx] || "") }))
      .filter((e) => Boolean(e.url));

    if (entries.length < 2) {
      return res.status(400).json({ error: "Geçerli en az 2 ürün bağlantısı gereklidir." });
    }

    const results = await Promise.all(
      entries.map(async (entry) => {
        try {
          return await getProductDetail(entry.url, { fallbackQuery: entry.title, ...keys });
        } catch (err) {
          return { url: entry.url, error: err.message };
        }
      })
    );

    const items = results.filter((r) => !r.error);
    if (!items.length) {
      return res.status(502).json({ error: "Seçilen ürünlerin verileri alınamadı." });
    }

    // Collect common / frequent spec names across compared items
    const specCounts = new Map();
    for (const item of items) {
      for (const s of item.specs || []) {
        specCounts.set(s.name, (specCounts.get(s.name) || 0) + 1);
      }
    }
    const specKeys = [...specCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
      .slice(0, 20)
      .map(([k]) => k);

    res.json({
      comparedAt: new Date().toISOString(),
      items,
      specKeys,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Karşılaştırma başarısız oldu." });
  }
});

// Shopping Cart Cost Optimizer (Split-Store vs Single-Store consolidation)
app.post("/api/cart/optimize", async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 12) : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: "Optimizasyon için sepetinizde en az 1 ürün olmalıdır." });
    }

    const keys = extractReqKeys(req);
    const hydrated = await Promise.all(
      rawItems.map(async (it) => {
        const normUrl = normalizeProductUrl(it.url);
        if (!normUrl) return null;
        try {
          const detail = await getProductDetail(normUrl, {
            fallbackQuery: it.title || "",
            ...keys,
          });
          return {
            id: detail.id || it.id,
            title: detail.title || it.title,
            image: detail.image || it.image || "",
            quantity: Math.max(1, Number.parseInt(it.quantity, 10) || 1),
            offers: detail.offers || [],
          };
        } catch {
          return null;
        }
      })
    );

    const plan = optimizeCart(hydrated.filter(Boolean));
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message || "Sepet optimizasyonu hesaplanamadı." });
  }
});

// CSV export (UTF-8 BOM + semicolon delimiter for seamless Turkish Excel import)
app.get("/api/export/csv", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    const keys = extractReqKeys(req);
    const detail = await getProductDetail(rawUrl, { fallbackQuery: String(req.query.title || ""), ...keys });

    const escapeCsv = (val) => {
      const s = String(val ?? "").replace(/"/g, '""');
      return `"${s}"`;
    };

    const headers = [
      "Sıra",
      "Platform",
      "Satıcı",
      "Ürün Fiyatı (TL)",
      "Kargo (TL)",
      "Kargo Durumu",
      "Kargo Dahil Net Fiyat (TL)",
      "En Ucuza Göre Fark (%)",
      "Birim Fiyat",
      "Fırsat Skoru (0-100)",
      "Stok",
      "Teslimat",
      "Son Güncelleme",
      "Bağlantı",
    ];

    const rows = (detail.offers || []).map((o) => [
      o.rankByNet,
      o.store?.platform || "",
      o.store?.seller || o.store?.platform || "",
      formatTrNumber(o.basePrice),
      formatTrNumber(o.shippingCost),
      o.shipping?.label || "",
      formatTrNumber(o.netPrice),
      `%${formatTrNumber(o.diffFromMinPct)}`,
      o.unitPrice !== null && detail.unitInfo
        ? `${formatTrNumber(o.unitPrice)} TL / ${detail.unitInfo.unitLabel}`
        : "-",
      o.dealScore,
      o.stockText || "",
      o.delivery?.label || "",
      o.lastUpdated || "",
      o.url || "",
    ]);

    const csvLines = [
      headers.map(escapeCsv).join(";"),
      ...rows.map((r) => r.map(escapeCsv).join(";")),
    ];

    const trMap = { ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c", İ: "i", Ğ: "g", Ü: "u", Ş: "s", Ö: "o", Ç: "c" };
    const safeSlug = (detail.title || "fiyat-raporu")
      .replace(/[ğüşıöçİĞÜŞÖÇ]/g, (ch) => trMap[ch] || ch)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="fiyatradar-${safeSlug || "rapor"}.csv"`);
    res.send(`\uFEFF${csvLines.join("\r\n")}`);
  } catch (err) {
    res.status(502).json({ error: err.message || "CSV dışa aktarma başarısız." });
  }
});

// Search History endpoints
app.get("/api/history", (_req, res) => {
  res.json({ items: getSearchHistory(24) });
});

app.delete("/api/history", (_req, res) => {
  clearSearchHistory();
  res.json({ ok: true });
});

// Watchlist endpoints (with folders, budget summary, and fake-discount status)
app.get("/api/watchlist", (req, res) => {
  const items = getWatchlist();
  const folder = String(req.query.folder || "").trim();
  res.json({
    items,
    folders: WATCHLIST_FOLDERS,
    budget: summarizeWatchlistBudget(items, folder),
  });
});

app.post("/api/watchlist", (req, res) => {
  try {
    const body = req.body || {};
    const url = normalizeProductUrl(body.url);
    if (!url || !body.title) {
      return res.status(400).json({ error: "Geçerli ürün adı ve bağlantısı gereklidir." });
    }
    const cleanTitle = String(body.title).trim();
    const folder = String(body.folder || "").trim() || suggestWatchlistFolder(cleanTitle);
    const saved = upsertWatchlistItem({
      id: body.id,
      title: cleanTitle,
      url,
      image: body.image || "",
      folder,
      target_price: body.target_price ? Number.parseFloat(body.target_price) : null,
      initial_net_price: body.initial_net_price ? Number.parseFloat(body.initial_net_price) : null,
      last_net_price: body.last_net_price ? Number.parseFloat(body.last_net_price) : null,
      best_store: body.best_store || "",
      verdict_score: body.verdict_score ?? null,
      verdict_label: body.verdict_label || "",
      fake_discount_status: body.fake_discount_status || "",
      fake_discount_label: body.fake_discount_label || "",
      offer_count: body.offer_count || 0,
    });
    const items = getWatchlist();
    res.status(201).json({
      item: saved,
      items,
      budget: summarizeWatchlistBudget(items),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/watchlist/:id", (req, res) => {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "target_price")) {
    updates.target_price =
      req.body?.target_price !== null && req.body?.target_price !== undefined && req.body?.target_price !== ""
        ? Number.parseFloat(req.body.target_price)
        : null;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "folder")) {
    updates.folder = String(req.body?.folder || "").trim() || "Diğer";
  }

  const updated = updateWatchlistItem(req.params.id, updates);
  if (!updated) {
    return res.status(404).json({ error: "Takip edilen ürün bulunamadı." });
  }
  const items = getWatchlist();
  res.json({
    item: updated,
    items,
    budget: summarizeWatchlistBudget(items),
  });
});

app.delete("/api/watchlist/:id", (req, res) => {
  const removed = removeWatchlistItem(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "Takip edilen ürün bulunamadı." });
  }
  const items = getWatchlist();
  res.json({ ok: true, items, budget: summarizeWatchlistBudget(items) });
});

async function refreshAllWatchlistAndNotify(keys = {}) {
  const before = getWatchlist();
  const results = [];
  const detailByUrl = new Map();

  // Deduplicate canonical URLs & run with bounded concurrency (3) to avoid Render 30s timeouts
  const uniqueUrls = [...new Set(before.map((it) => it.url).filter(Boolean))];
  const fallbackByUrl = new Map();
  for (const it of before) {
    if (it.url && !fallbackByUrl.has(it.url)) fallbackByUrl.set(it.url, it.title);
  }

  let cursor = 0;
  const workerCount = Math.min(3, Math.max(1, uniqueUrls.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < uniqueUrls.length) {
        const url = uniqueUrls[cursor++];
        try {
          const detail = await getProductDetail(url, {
            refresh: true,
            fallbackQuery: fallbackByUrl.get(url) || "",
            ...keys,
          });
          detailByUrl.set(url, { ok: true, detail });
        } catch (err) {
          detailByUrl.set(url, { ok: false, error: err.message });
        }
      }
    })
  );

  for (const item of before) {
    const outcome = detailByUrl.get(item.url);
    if (outcome?.ok && outcome.detail) {
      const detail = outcome.detail;
      upsertWatchlistItem({
        id: item.id,
        title: detail.title,
        url: item.url,
        image: detail.image,
        folder: item.folder,
        target_price: item.target_price,
        last_net_price: detail.stats?.minNet ?? detail.lowPrice,
        best_store: detail.picks?.cheapestNet?.store || "",
        verdict_score: detail.verdict?.score ?? null,
        verdict_label: detail.verdict?.label || "",
        fake_discount_status: detail.fakeDiscount?.status || "",
        fake_discount_label: detail.fakeDiscount?.label || "",
        offer_count: detail.totalOfferCount,
      });
      results.push({ id: item.id, ok: true });
    } else {
      results.push({ id: item.id, ok: false, error: outcome?.error || "Güncellenemedi" });
    }
  }

  const items = getWatchlist();
  let pushSummary = { alerts: [], pushSentCount: 0 };
  try {
    pushSummary = await notifyWatchlistPriceDrops(before, items);
  } catch {
    // Non-fatal push error
  }
  return {
    refreshed: results,
    items,
    budget: summarizeWatchlistBudget(items),
    pushSentCount: pushSummary.pushSentCount,
    alertsTriggered: pushSummary.alerts.length,
  };
}

function isAuthorizedCronRequest(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
  if (!secret) {
    // Fail closed in production when CRON_SECRET is not configured
    return !isProd;
  }
  const provided = String(req.headers["x-cron-secret"] || req.query.secret || "").trim();
  return provided === secret;
}

// Live batch refresh of all watched items (parallelized, URL-deduplicated & rate-limited)
app.post("/api/watchlist/refresh", refreshRateLimit, async (req, res) => {
  try {
    const keys = extractReqKeys(req);
    const out = await refreshAllWatchlistAndNotify(keys);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// iOS 16.4+ & DESKTOP WEB PUSH NOTIFICATIONS (NO TELEGRAM REQUIRED)
// ============================================================================
app.get("/api/push/config", (_req, res) => {
  try {
    res.json(getPushConfig());
  } catch (err) {
    res.status(500).json({ supported: false, error: err.message });
  }
});

app.post("/api/push/subscribe", (req, res) => {
  try {
    const sub = req.body?.subscription || req.body;
    if (!isValidPushEndpoint(sub?.endpoint)) {
      return res.status(400).json({ error: "Geçersiz bildirim servisi bağlantısı." });
    }
    savePushSubscription(sub, req.headers["user-agent"] || "");
    res.status(201).json({
      ok: true,
      subscriberCount: getPushSubscriptions().length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Bildirim aboneliği kaydedilemedi." });
  }
});

app.post("/api/push/unsubscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint || "").trim();
  if (!endpoint) {
    return res.status(400).json({ error: "Abonelik adresi gereklidir." });
  }
  removePushSubscription(endpoint);
  res.json({ ok: true, subscriberCount: getPushSubscriptions().length });
});

// Cron / Background Watchlist Check & Lock-Screen Push Trigger (fail-closed in production)
app.post("/api/push/check-watchlist", refreshRateLimit, async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Yetkisiz istek." });
  }
  try {
    const keys = extractReqKeys(req);
    const out = await refreshAllWatchlistAndNotify(keys);
    res.json({
      ok: true,
      checked: out.refreshed.length,
      alertsTriggered: out.alertsTriggered,
      pushSentCount: out.pushSentCount,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// APPLE SHORTCUTS & iOS SHARE SHEET INTEGRATION
// ============================================================================

/**
 * Extracts a clean product URL or search query from iOS Share Sheet / Apple Shortcuts params.
 * Handles Trendyol/Hepsiburada/Amazon share messages like "iPhone 17 Pro https://ty.gl/abc123".
 */
export function extractSharedQuery(params = {}) {
  const candidates = [params.url, params.text, params.q, params.title]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const c of candidates) {
    const urlMatch = c.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
      return urlMatch[0].replace(/[),.;!?]+$/, "");
    }
  }

  return (candidates[0] || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

app.get("/share", (req, res) => {
  const shared = extractSharedQuery(req.query);
  if (!shared) {
    return res.redirect(302, "/");
  }
  return res.redirect(302, `/?q=${encodeURIComponent(shared)}&from=shortcut`);
});

// Lightweight JSON endpoint for Apple Shortcuts ("URL İçeriğini Al" / instant banner)
app.get("/api/shortcut-search", async (req, res) => {
  try {
    const q = extractSharedQuery(req.query);
    if (!q) {
      return res.status(400).json({ ok: false, error: "Ürün adı veya mağaza bağlantısı gereklidir." });
    }
    const keys = extractReqKeys(req);
    const result = await searchProducts(q, { page: 1, ...keys });
    const priced = (result.products || []).filter(
      (p) => !p.isAccessory && typeof p.lowestPrice === "number" && p.lowestPrice > 0 && p.badge !== "Tüm Mağazalar"
    );
    priced.sort((a, b) => a.lowestPrice - b.lowestPrice);
    const best = priced[0] || result.products?.[0] || null;
    const displayQuery = result.resolvedFromLink?.resolvedQuery || result.query || q;

    const summaryText = best?.lowestPrice
      ? `${displayQuery}: En ucuz ${formatTrNumber(best.lowestPrice)} TL (${best.source || best.badge || "Mağaza"}) — toplam ${result.totalFound} sonuç.`
      : `${displayQuery} için ${result.totalFound} sonuç bulundu.`;

    res.json({
      ok: true,
      query: displayQuery,
      resolvedStore: result.resolvedFromLink?.sourceStore || null,
      cheapestPrice: best?.lowestPrice ?? null,
      cheapestStore: best?.source || best?.badge || null,
      cheapestTitle: best?.title || null,
      cheapestUrl: best?.externalUrl || null,
      totalFound: result.totalFound,
      summaryText,
      appUrl: `/?q=${encodeURIComponent(displayQuery)}&from=shortcut`,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || "Kestirme araması başarısız." });
  }
});

// Fallback to index.html for SPA
app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`FiyatRadar sunucusu http://localhost:${PORT} adresinde çalışıyor.`);
  });
}

export default app;
