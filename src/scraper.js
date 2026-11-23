/**
 * Live Turkish e-commerce price aggregator & product research scraper.
 * Aggregates multi-store offers (Trendyol, Hepsiburada, Amazon TR, n11, Pazarama,
 * idefix, PttAVM, Migros, MediaMarkt, Teknosa, Vatan, etc.) with shipping costs,
 * direct store links, technical specs, variants, and 6-month daily price history.
 */

import * as cheerio from "cheerio";
import {
  extractUnitInfo,
  isAccessoryTitle,
  parseDeliverySpeed,
  parseShipping,
  parseStoreInfo,
  parseTrDate,
  parseTrPrice,
} from "./parsers.js";
import { analyzeOffers, analyzePriceHistory } from "./analyzer.js";
import {
  getVirtualDetail,
  searchOfficialFallback,
  searchSerpApiTurkey,
  searchSerperTurkey,
} from "./providers.js";
import { isExternalStoreUrl, resolveStoreProductUrl } from "./urlResolver.js";
import { getPriceSnapshots, getWatchlistItemByUrl } from "./db.js";

const BASE_URL = "https://www.akakce.com";
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
};

// Simple in-memory TTL cache
const cache = new Map();
const SEARCH_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 3 * 60 * 1000;
const SUGGEST_TTL_MS = 10 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data, ttlMs) {
  if (cache.size > 250) {
    // Evict oldest entry
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Validates and normalizes an Akakce product URL or internal virtual provider key (SSRF-safe).
 */
export function normalizeProductUrl(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (/^virtual:(serper|serpapi|mf|migros):/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `${BASE_URL}${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "https:" &&
      (parsed.hostname === "www.akakce.com" || parsed.hostname === "akakce.com")
    ) {
      return `https://www.akakce.com${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Kaynak yanıt hatası (HTTP ${res.status})`);
  }
  return res.text();
}

/**
 * Live Turkish product autocomplete suggestions via Amazon TR suggestion endpoint.
 */
export async function getSuggestions(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const cacheKey = `suggest:${q.toLocaleLowerCase("tr-TR")}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://completion.amazon.co.uk/api/2017/suggestions?mid=A33AVAJ2PDY3EV&alias=aps&prefix=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list = (json.suggestions || [])
      .map((s) => s.value)
      .filter(Boolean)
      .slice(0, 8);
    setCached(cacheKey, list, SUGGEST_TTL_MS);
    return list;
  } catch {
    return [];
  }
}

/**
 * Searches Turkish e-commerce products with automatic multi-provider fallback:
 * 1. Serper.dev / SerpAPI Google Shopping TR (when API key is provided — 100% cloud-proof across 50+ TR stores)
 * 2. Akakçe direct live engine (when server IP is accepted)
 * 3. Zero-key Official Fallback (T.C. Market Fiyatı + Migros Elektronik + Migros Sanal Market)
 */
export async function searchProducts(query, options = {}) {
  let q = (query || "").trim();
  if (!q) {
    throw new Error("Arama terimi boş olamaz.");
  }

  const serperKey = (options.serperKey || process.env.SERPER_API_KEY || "").trim();
  const serpApiKey = (options.serpApiKey || process.env.SERPAPI_KEY || "").trim();

  // Universal Turkish Store Link Resolver (Trendyol, ty.gl, Hepsiburada, Amazon TR, Stradivarius, Zara, n11, etc.)
  let resolvedFromLink = null;
  if (isExternalStoreUrl(q)) {
    const resolved = await resolveStoreProductUrl(q);
    if (!resolved.resolvedQuery) {
      throw new Error(
        `${resolved.sourceStore} bağlantısından ürün adı çözümlenemedi. Lütfen ürün adını doğrudan yazarak arayın.`
      );
    }
    resolvedFromLink = resolved;
    q = resolved.resolvedQuery;
  }

  // If user pasted a direct Akakce URL, return a direct redirect hint
  const maybeUrl = normalizeProductUrl(q);
  if (maybeUrl && maybeUrl.includes("fiyati,")) {
    const detail = await getProductDetail(maybeUrl, { refresh: options.refresh, serperKey, serpApiKey });
    return {
      query: q,
      provider: detail.provider || "Akakçe",
      directProduct: true,
      fetchedAt: detail.fetchedAt,
      cached: detail.cached,
      totalFound: 1,
      products: [
        {
          id: detail.id,
          title: detail.title,
          url: detail.url,
          image: detail.image,
          lowestPrice: detail.stats?.minNet ?? detail.lowPrice,
          offerCount: detail.totalOfferCount,
          badge: detail.verdict?.label || "",
          isAccessory: false,
          unitInfo: detail.unitInfo,
        },
      ],
      detail,
    };
  }

  // Priority 1: Google Türkiye Search via Serper.dev (works for ALL Turkish stores incl. fashion & electronics!)
  if (serperKey) {
    const cKey = `serper-tr:${q.toLocaleLowerCase("tr-TR")}`;
    if (!options.refresh) {
      const cached = getCached(cKey);
      if (cached) return { ...cached, cached: true, resolvedFromLink };
    }
    const result = await searchSerperTurkey(q, serperKey);
    setCached(cKey, result, SEARCH_TTL_MS);
    return { ...result, resolvedFromLink };
  }

  // Priority 2: Google Türkiye Search via SerpAPI
  if (serpApiKey) {
    const cKey = `serpapi-tr:${q.toLocaleLowerCase("tr-TR")}`;
    if (!options.refresh) {
      const cached = getCached(cKey);
      if (cached) return { ...cached, cached: true, resolvedFromLink };
    }
    const result = await searchSerpApiTurkey(q, serpApiKey);
    setCached(cKey, result, SEARCH_TTL_MS);
    return { ...result, resolvedFromLink };
  }

  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const cacheKey = `search:${q.toLocaleLowerCase("tr-TR")}:p${page}`;

  if (!options.refresh) {
    const cached = getCached(cacheKey);
    if (cached) {
      return { ...cached, cached: true, resolvedFromLink };
    }
  }

  // Priority 3: Direct Akakce live search, with automatic fallback on 403/timeout (e.g. Render cloud IP)
  let html;
  try {
    const searchUrl = `${BASE_URL}/arama/?q=${encodeURIComponent(q)}${page > 1 ? `&p=${page}` : ""}`;
    html = await fetchHtml(searchUrl);
  } catch (akakceErr) {
    const fallback = await searchOfficialFallback(q);
    fallback.fallbackReason = akakceErr.message || "Akakçe erişimi kısıtlandı";
    fallback.fallbackNotice =
      "Bulut sunucu IP'si nedeniyle Akakçe doğrudan erişimi kısıtlandı; şu an Migros Elektronik ve T.C. Market Fiyatı resmi kaynakları taranıyor. Trendyol, Hepsiburada, Amazon TR, n11, MediaMarkt dahil 50+ mağazanın tamamı için Ayarlar'dan ücretsiz Serper API anahtarı (2.500 ücretsiz arama) ekleyebilirsiniz.";
    setCached(cacheKey, fallback, 2 * 60 * 1000);
    return { ...fallback, resolvedFromLink };
  }

  const $ = cheerio.load(html);

  const products = [];
  const seenIds = new Set();

  $("li[data-pr]").each((_, el) => {
    const $li = $(el);
    const id = $li.attr("data-pr") || "";
    if (!id || seenIds.has(id)) return;

    const $link = $li.find("a.iC").first();
    const href = $link.attr("href") || "";
    const title = ($li.find("h3.pn_v8").first().text() || $link.attr("title") || "").replace(/\s+/g, " ").trim();
    if (!title || !href) return;

    const fullUrl = normalizeProductUrl(href);
    if (!fullUrl) return;

    // Extract image (handle lazy loading attributes)
    const $img = $li.find("figure img").first();
    let image = $img.attr("data-src") || $img.attr("src") || "";
    if (image.startsWith("//")) image = `https:${image}`;
    if (image.includes("t.gif")) image = $img.attr("data-src") || "";

    // Extract lowest price from .pt_v9 (clone to remove nested "+56 FİYAT" span)
    const $priceEl = $li.find(".pt_v9, .pt_v8").first().clone();
    const offerCountRaw = $priceEl.find("span").text() || $li.find(".bt_v8").text() || "";
    $priceEl.find("span").remove();
    const priceText = $priceEl.text().replace(/\s+/g, " ").trim();
    const lowestPrice = parseTrPrice(priceText);

    const offerCountMatch = offerCountRaw.match(/\+?(\d+)/);
    const offerCount = offerCountMatch ? Number.parseInt(offerCountMatch[1], 10) : 1;

    const badge = $li.find(".db_v9").first().text().replace(/\s+/g, " ").trim();
    const unitInfo = extractUnitInfo(title, lowestPrice);
    const isAccessory = isAccessoryTitle(title, q);

    seenIds.add(id);
    products.push({
      id,
      title,
      url: fullUrl,
      image,
      lowestPrice,
      offerCount,
      badge: badge && badge !== "En Ucuz" ? badge : "",
      source: "Akakçe",
      isOfficialStore: true,
      isFreeShipping: false,
      isAccessory,
      unitInfo,
    });
  });

  const payload = {
    query: q,
    provider: "Akakçe (50+ Mağaza)",
    directProduct: false,
    page,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: products.length,
    accessoryCount: products.filter((p) => p.isAccessory).length,
    products,
    resolvedFromLink,
  };

  setCached(cacheKey, payload, SEARCH_TTL_MS);
  return payload;
}

/**
 * Extracts a searchable query from an expired `virtual:` URL so watched items
 * can be seamlessly re-fetched live after Render wakes from sleep.
 */
function extractQueryFromVirtualUrl(vUrl, fallbackTitle = "") {
  const parts = String(vUrl || "").split(":");
  // Patterns:
  // virtual:serper:all:<encodedQuery>
  // virtual:serper:<encodedQuery>:<idx>
  // virtual:serper:cat:<encodedQuery>:<id>
  if ((parts[1] === "serper" || parts[1] === "serpapi") && parts.length >= 4) {
    const raw = parts[2] === "all" || parts[2] === "cat" ? parts[3] : parts[2];
    try {
      const decoded = decodeURIComponent(raw).trim();
      if (decoded.length >= 2) return decoded;
    } catch {
      // Fall through
    }
  }
  return String(fallbackTitle || "")
    .replace(/^📊\s*/, "")
    .replace(/\s*[—–-]\s*(Türkiye Mağaza.*|Tüm Mağazaları.*|Trendyol|Hepsiburada|Amazon.*|n11|Akakçe|Cimri).*$/i, "")
    .trim();
}

/**
 * Attaches personal recorded price snapshots as a chartable history series
 * for products that don't carry an upstream 6-month table (e.g. Google TR / Migros / MarketFiyati).
 */
function attachPersonalSnapshots(detail) {
  if (!detail || (Array.isArray(detail.history) && detail.history.length >= 2)) {
    return detail;
  }
  const snapshots = getPriceSnapshots(detail.id, 90);
  const currentNet = detail.stats?.minNet ?? detail.lowPrice;
  const combined = [...snapshots];
  if (typeof currentNet === "number" && currentNet > 0) {
    const last = combined[combined.length - 1];
    const nowIso = new Date().toISOString();
    if (!last || Math.abs(last.net_price - currentNet) > 0.01 || Date.now() - Date.parse(last.captured_at) > 60000) {
      combined.push({ net_price: currentNet, captured_at: nowIso });
    }
  }

  if (combined.length < 2) {
    return {
      ...detail,
      personalHistoryCount: combined.length,
    };
  }

  // Convert snapshots to chart points
  const points = combined.map((s, idx) => {
    const d = new Date(s.captured_at);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const prevPrice = idx > 0 ? combined[idx - 1].net_price : s.net_price;
    const delta = Math.round((s.net_price - prevPrice) * 100) / 100;
    const pct = prevPrice > 0 ? Math.round((delta / prevPrice) * 1000) / 10 : 0;
    return {
      isoDate: s.captured_at,
      dateLabel: `${dd}.${mm}.${yyyy} ${hh}:${mi}`,
      price: s.net_price,
      delta,
      pctLabel: delta !== 0 ? `%${Math.abs(pct)}` : "",
    };
  });

  const histAnalysis = analyzePriceHistory(points, currentNet);
  return {
    ...detail,
    history: histAnalysis.points,
    historySummary: histAnalysis.summary,
    isPersonalHistory: true,
    personalHistoryCount: points.length,
  };
}

/**
 * Fetches and deeply analyzes a single product across all Turkish e-commerce stores.
 */
export async function getProductDetail(rawUrl, options = {}) {
  const url = normalizeProductUrl(rawUrl);
  if (!url) {
    throw new Error("Geçersiz ürün bağlantısı.");
  }

  // Handle virtual provider product detail (Google TR, T.C. Market Fiyatı, Migros)
  if (url.startsWith("virtual:")) {
    if (!options.refresh) {
      const cachedVirtual = getVirtualDetail(url);
      if (cachedVirtual) {
        return attachPersonalSnapshots(cachedVirtual);
      }
    }

    // Auto-rehydrate expired or refreshed virtual URL by re-running live search!
    const watched = getWatchlistItemByUrl(url);
    const reQuery = extractQueryFromVirtualUrl(url, options.fallbackQuery || watched?.title || "");
    if (!reQuery) {
      throw new Error("Bu ürünün geçici analiz oturumu süresi doldu. Lütfen ürünü yeniden aratın.");
    }

    const freshSearch = await searchProducts(reQuery, {
      refresh: true,
      serperKey: options.serperKey,
      serpApiKey: options.serpApiKey,
    });

    // Try exact virtual key first, then aggregateUrl, then first virtual or real Akakce product
    let rehydrated =
      getVirtualDetail(url) ||
      (freshSearch.aggregateUrl ? getVirtualDetail(freshSearch.aggregateUrl) : null) ||
      (freshSearch.products?.[0]?.url?.startsWith("virtual:")
        ? getVirtualDetail(freshSearch.products[0].url)
        : null);

    if (!rehydrated && freshSearch.products?.[0]?.url?.startsWith("https://")) {
      try {
        rehydrated = await getProductDetail(freshSearch.products[0].url, {
          refresh: Boolean(options.refresh),
          serperKey: options.serperKey,
          serpApiKey: options.serpApiKey,
        });
      } catch {
        // Fall through to error message below
      }
    }

    if (rehydrated) {
      // Preserve stable watchlist URL & id when rehydrated so snapshots stay linked
      const stableDetail = {
        ...rehydrated,
        id: watched?.id || rehydrated.id,
        url,
        rehydrated: true,
      };
      return attachPersonalSnapshots(stableDetail);
    }

    throw new Error(`"${reQuery}" için güncel mağaza verisi yenilenemedi. Lütfen tekrar aratın.`);
  }

  const cacheKey = `detail:${url}`;
  if (!options.refresh) {
    const cached = getCached(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // 1. Parse JSON-LD structured product metadata
  let ld = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ld) return;
    try {
      const parsed = JSON.parse($(el).html() || "");
      if (parsed && (parsed["@type"] === "Product" || parsed["@type"] === "ProductGroup")) {
        ld = parsed;
      }
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  });

  const idMatch = url.match(/,(\d+)\.html/);
  const productId = String(ld?.sku || ld?.productGroupID || (idMatch ? idMatch[1] : ""));
  const title = (ld?.name || $("h1").first().text() || "Ürün").replace(/\s+/g, " ").trim();
  const brand = ld?.brand?.name || ld?.manufacturer?.name || "";
  const category = ld?.category || "";
  const description = (ld?.description || "").replace(/\s+/g, " ").trim();

  let image = "";
  if (Array.isArray(ld?.image) && ld.image.length) {
    image = typeof ld.image[0] === "string" ? ld.image[0] : ld.image[0]?.url || "";
  } else if (typeof ld?.image === "string") {
    image = ld.image;
  } else {
    image = $("meta[property='og:image']").attr("content") || "";
  }
  if (image.startsWith("//")) image = `https:${image}`;

  const rating = ld?.aggregateRating
    ? {
        value: Number.parseFloat(ld.aggregateRating.ratingValue) || null,
        count: Number.parseInt(ld.aggregateRating.ratingCount, 10) || 0,
        best: Number.parseFloat(ld.aggregateRating.bestRating) || 5,
      }
    : null;

  // 2. Extract direct store URLs from JSON-LD AggregateOffer
  const ldOffers = [];
  const rawLdOffers = Array.isArray(ld?.offers?.offers)
    ? ld.offers.offers
    : Array.isArray(ld?.offers)
      ? ld.offers
      : [];

  for (const lo of rawLdOffers) {
    const price = parseTrPrice(lo.price);
    if (!price) continue;
    const sellerRaw = lo.seller?.name || "";
    const store = parseStoreInfo("", sellerRaw);
    ldOffers.push({
      price,
      url: lo.url || url,
      sellerRaw,
      store,
      matched: false,
    });
  }

  const totalOfferCount =
    Number.parseInt(ld?.offers?.offerCount, 10) ||
    Math.max(ldOffers.length, $("#PL > li").length);

  // 3. Extract rich live store offers from ul#PL (includes shipping, stock, delivery speed, last update)
  const offers = [];
  $("#PL > li").each((idx, el) => {
    const $li = $(el);
    const priceText = $li.find(".pt_v8").first().text().replace(/\s+/g, " ").trim();
    const basePrice = parseTrPrice(priceText);
    if (!basePrice) return;

    const shipText = $li.find(".uk_v8, .n_uk_v8, .k_v8").first().text().replace(/\s+/g, " ").trim();
    const shipping = parseShipping(shipText);

    const $storeWrap = $li.find(".v_v8").first();
    const $storeImg = $storeWrap.find("img").first();
    const storeAlt = $storeImg.attr("alt") || "";
    let storeLogo = $storeImg.attr("src") || "";
    if (storeLogo.startsWith("//")) storeLogo = `https:${storeLogo}`;

    // Extract seller rating & review count (e.g. "8,6" and "699 Yorum") before reading seller text
    const $rc = $storeWrap.find(".rc_v8").first();
    const sellerRating = parseTrPrice($rc.find(".r_v8").first().text());
    const sellerReviewsText = $rc.find("em").first().text().replace(/\s+/g, " ").trim();
    const $storeClone = $storeWrap.clone();
    $storeClone.find(".rc_v8").remove();
    const storeText = $storeClone.text().replace(/\s+/g, " ").trim();
    const store = parseStoreInfo(storeAlt, storeText);
    if (sellerRating !== null && sellerRating > 0 && sellerRating <= 10) {
      store.sellerRating = sellerRating;
      store.sellerReviews = sellerReviewsText;
      // Blend real seller rating into trustScore
      const ratingNorm = Math.max(0.5, Math.min(1.0, sellerRating / 10));
      store.trustScore = Math.round(((store.trustScore + ratingNorm) / 2) * 100) / 100;
    }

    const offerTitle = $li.find(".pn_v8").first().text().replace(/\s+/g, " ").trim() || title;
    const promoNote = $li.find(".vds_v8").first().text().replace(/\s+/g, " ").trim();
    const stockText = $li.find(".stock_v8").first().text().replace(/\s+/g, " ").trim();
    const inStock = !/tükendi|stokta yok/i.test(stockText);
    const deliveryText = $li.find(".sd_v8").first().text().replace(/\s+/g, " ").trim();
    const delivery = parseDeliverySpeed(deliveryText);
    const lastUpdated = $li.find(".bd_v8 i").first().text().replace(/\s+/g, " ").trim();
    const akakceBadge = $li.find(".bdgv_v8").first().text().replace(/\s+/g, " ").trim();

    // Match direct store URL from JSON-LD offers
    let matchedUrl = null;
    let isDirectLink = false;
    const platKey = store.platform.toLocaleLowerCase("tr-TR");
    const sellerKey = store.seller.toLocaleLowerCase("tr-TR");

    // Pass 1: Exact platform + seller + close price match
    let candidate = ldOffers.find(
      (lo) =>
        !lo.matched &&
        Math.abs(lo.price - basePrice) <= 2 &&
        lo.store.platform.toLocaleLowerCase("tr-TR").includes(platKey.slice(0, 4)) &&
        (!sellerKey || lo.store.seller.toLocaleLowerCase("tr-TR").includes(sellerKey.slice(0, 5)))
    );
    // Pass 2: Platform + close price match
    if (!candidate) {
      candidate = ldOffers.find(
        (lo) =>
          !lo.matched &&
          Math.abs(lo.price - basePrice) <= 50 &&
          lo.store.platform.toLocaleLowerCase("tr-TR").includes(platKey.slice(0, 4))
      );
    }
    // Pass 3: Exact price match
    if (!candidate) {
      candidate = ldOffers.find((lo) => !lo.matched && Math.abs(lo.price - basePrice) <= 1);
    }

    if (candidate) {
      candidate.matched = true;
      matchedUrl = candidate.url;
      isDirectLink = true;
    }

    offers.push({
      id: `offer-${idx + 1}`,
      offerTitle,
      basePrice,
      shipping,
      store,
      storeLogo: storeLogo || null,
      stockText: stockText || "Stokta",
      inStock,
      delivery,
      lastUpdated: lastUpdated || "",
      promoNote,
      akakceBadge,
      url: matchedUrl || url,
      isDirectLink,
    });
  });

  // Append any remaining unmatched JSON-LD offers (ensures complete coverage)
  for (let i = 0; i < ldOffers.length; i++) {
    const lo = ldOffers[i];
    if (lo.matched) continue;
    // Skip if already represented by same platform and nearly identical price
    const duplicate = offers.some(
      (o) =>
        o.store.platform.toLocaleLowerCase("tr-TR") === lo.store.platform.toLocaleLowerCase("tr-TR") &&
        Math.abs(o.basePrice - lo.price) <= 1
    );
    if (duplicate) continue;

    offers.push({
      id: `offer-ld-${i + 1}`,
      offerTitle: title,
      basePrice: lo.price,
      shipping: { cost: 0, isFree: false, label: "Mağazada kontrol edin", unknown: true },
      store: lo.store,
      storeLogo: null,
      stockText: "Stokta",
      inStock: true,
      delivery: parseDeliverySpeed(""),
      lastUpdated: "",
      promoNote: "",
      akakceBadge: "",
      url: lo.url || url,
      isDirectLink: Boolean(lo.url && lo.url !== url),
    });
  }

  // 4. Parse unit info from product title
  const cheapestBase = offers.length ? Math.min(...offers.map((o) => o.basePrice)) : null;
  const unitInfo = extractUnitInfo(title, cheapestBase);

  // 5. Run offer statistical analysis & deal scoring
  const offerAnalysis = analyzeOffers(offers, unitInfo);

  // Update unitInfo with best net price
  const finalUnitInfo = unitInfo
    ? extractUnitInfo(title, offerAnalysis.stats?.minNet ?? cheapestBase)
    : null;

  // 6. Parse 6-month daily price history table (#tableContent table.graph_table)
  const rawHistory = [];
  $("table.graph_table tbody tr").each((_, tr) => {
    const $tds = $(tr).find("td");
    if ($tds.length < 2) return;
    const dateLabel = $tds.eq(0).text().replace(/\s+/g, " ").trim();
    const isoDate = parseTrDate(dateLabel);
    const price = parseTrPrice($tds.eq(1).text());
    if (!isoDate || !price) return;

    const deltaCell = $tds.eq(2);
    const deltaVal = parseTrPrice(deltaCell.text());
    const isUp = deltaCell.find(".red").length > 0;
    const isDown = deltaCell.find(".green").length > 0;
    const delta = deltaVal !== null ? (isDown ? -deltaVal : isUp ? deltaVal : 0) : 0;

    const pctText = $tds.eq(3).text().replace(/\s+/g, " ").trim();
    rawHistory.push({
      isoDate,
      dateLabel,
      price,
      delta,
      pctLabel: pctText,
    });
  });

  // Also check Akakce's recent-low callout badge (e.g. 49.999 TL on 11.11.2026)
  const badgeLowPrice = parseTrPrice($(".glp.lp").first().text());
  const badgeLowDateLabel = $(".mindate.lp").first().text().replace(/\s+/g, " ").trim();
  const fallbackHistoricalLow =
    badgeLowPrice && badgeLowDateLabel
      ? {
          price: badgeLowPrice,
          dateLabel: badgeLowDateLabel,
          isoDate: parseTrDate(badgeLowDateLabel),
        }
      : null;

  const historyAnalysis = analyzePriceHistory(
    rawHistory,
    offerAnalysis.stats?.minNet ?? cheapestBase,
    fallbackHistoricalLow
  );

  // 7. Parse variants (other colors / storage options)
  const variants = [];
  if (Array.isArray(ld?.hasVariant)) {
    for (const v of ld.hasVariant.slice(0, 12)) {
      const vOffer = Array.isArray(v.offers) ? v.offers[0] : v.offers;
      const vPrice = parseTrPrice(vOffer?.price);
      const vUrl = normalizeProductUrl(v["@id"] || v.url || "") || vOffer?.url || null;
      variants.push({
        name: v.name || "",
        price: vPrice,
        seller: vOffer?.seller?.name || "",
        url: vUrl,
        isAkakceUrl: Boolean(vUrl && vUrl.includes("akakce.com")),
      });
    }
  }

  // 8. Parse technical specs from JSON-LD additionalProperty
  const specs = [];
  if (Array.isArray(ld?.additionalProperty)) {
    for (const prop of ld.additionalProperty) {
      if (prop?.name && prop?.value !== undefined && prop?.value !== null && prop?.value !== "") {
        specs.push({
          name: String(prop.name).trim(),
          value: String(prop.value).trim(),
        });
      }
    }
  }

  const payload = {
    id: productId,
    title,
    brand,
    category,
    description,
    url,
    image,
    rating,
    totalOfferCount,
    unitInfo: finalUnitInfo,
    fetchedAt: new Date().toISOString(),
    cached: false,
    lowPrice: parseTrPrice(ld?.offers?.lowPrice) ?? offerAnalysis.stats?.minNet ?? null,
    highPrice: parseTrPrice(ld?.offers?.highPrice) ?? offerAnalysis.stats?.maxNet ?? null,
    stats: offerAnalysis.stats,
    picks: offerAnalysis.picks,
    shippingTraps: offerAnalysis.shippingTraps,
    platformBreakdown: offerAnalysis.platformBreakdown,
    offers: offerAnalysis.offers,
    history: historyAnalysis.points,
    historySummary: historyAnalysis.summary,
    verdict: historyAnalysis.verdict,
    variants,
    specs,
  };

  setCached(cacheKey, payload, DETAIL_TTL_MS);
  return payload;
}
