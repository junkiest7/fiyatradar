/**
 * Cloud-proof Turkish e-commerce data providers:
 * 1. Serper.dev Google Shopping Türkiye (Official REST API, 2,500 free queries — covers ALL 50+ TR stores)
 * 2. SerpAPI Google Shopping Türkiye (Official REST API, 100 free/mo — covers ALL 50+ TR stores)
 * 3. T.C. Ticaret Bakanlığı / TÜBİTAK Market Fiyatı API (Zero-key official API: A101, BİM, CarrefourSA, Migros, ŞOK, Hakmar, Tarım Kredi)
 * 4. Migros Elektronik & Sanal Market REST API (Zero-key official JSON API)
 */

import {
  extractUnitInfo,
  parseDeliverySpeed,
  parseShipping,
  parseStoreInfo,
  parseTrPrice,
} from "./parsers.js";
import { analyzeOffers, analyzePriceHistory } from "./analyzer.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MARKET_NAMES = {
  a101: "A101",
  bim: "BİM",
  carrefour: "CarrefourSA",
  hakmar: "Hakmar Express",
  migros: "Migros",
  sok: "ŞOK Market",
  tarim_kredi: "Tarım Kredi Kooperatif",
};

// In-memory store for detail views of non-Akakce provider products
const virtualDetailCache = new Map();

function saveVirtualDetail(key, payload) {
  if (virtualDetailCache.size > 300) {
    const first = virtualDetailCache.keys().next().value;
    virtualDetailCache.delete(first);
  }
  virtualDetailCache.set(key, { payload, expiresAt: Date.now() + 20 * 60 * 1000 });
}

export function getVirtualDetail(key) {
  const entry = virtualDetailCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    virtualDetailCache.delete(key);
    return null;
  }
  return entry.payload;
}

/**
 * Provider 1: Google Shopping Türkiye via Serper.dev (POST https://google.serper.dev/shopping)
 * Returns live offers across Trendyol, Hepsiburada, Amazon TR, n11, Pazarama, idefix,
 * MediaMarkt, Teknosa, Vatan, Migros, PttAVM, Akakçe, etc.
 */
export async function searchSerperShopping(query, apiKey) {
  const res = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: "tr",
      hl: "tr",
      num: 40,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`Google Shopping (Serper) yanıt hatası (HTTP ${res.status}): ${errTxt.slice(0, 120)}`);
  }

  const data = await res.json();
  const shopping = Array.isArray(data.shopping) ? data.shopping : [];

  const offers = [];
  const products = [];

  shopping.forEach((item, idx) => {
    const basePrice = parseTrPrice(item.price);
    if (!basePrice || basePrice <= 0) return;

    const deliveryRaw = item.delivery || "";
    const shipping = parseShipping(deliveryRaw);
    const store = parseStoreInfo(item.source || "", "");
    if (typeof item.rating === "number" && item.rating > 0) {
      // Convert 5-star rating to 10-point scale for unified UI display
      store.sellerRating = Math.round(item.rating * 2 * 10) / 10;
      store.sellerReviews = item.ratingCount ? `${item.ratingCount} yorum` : "";
    }

    const offer = {
      id: `serper-${idx + 1}`,
      offerTitle: item.title || query,
      basePrice,
      shipping,
      store,
      storeLogo: null,
      stockText: "Stokta",
      inStock: true,
      delivery: parseDeliverySpeed(deliveryRaw),
      lastUpdated: "Canlı",
      promoNote: item.offers ? String(item.offers) : "",
      akakceBadge: "",
      url: item.link || `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(item.title || query)}`,
      isDirectLink: Boolean(item.link),
      image: item.imageUrl || "",
    };
    offers.push(offer);

    const vKey = `virtual:serper:${encodeURIComponent(query)}:${idx}`;
    const unitInfo = extractUnitInfo(item.title || query, basePrice + shipping.cost);
    products.push({
      id: `sp-${idx + 1}`,
      title: item.title || query,
      url: vKey,
      externalUrl: offer.url,
      image: item.imageUrl || "",
      lowestPrice: Math.round((basePrice + shipping.cost) * 100) / 100,
      offerCount: 1,
      badge: store.platform,
      source: "Google Shopping TR",
      unitInfo,
    });
  });

  // Build an aggregated multi-store comparison dossier for the full query!
  const aggregateKey = `virtual:serper:all:${encodeURIComponent(query.toLocaleLowerCase("tr-TR"))}`;
  const unitInfo = extractUnitInfo(query, offers[0]?.basePrice ?? null);
  const analysis = analyzeOffers(offers, unitInfo);
  const histAnalysis = analyzePriceHistory([], analysis.stats?.minNet ?? null);

  const aggregateDetail = {
    id: `gshop-${Date.now()}`,
    title: `${query} — Tüm Türkiye Mağaza Teklifleri`,
    brand: "",
    category: "Google Shopping Türkiye · Canlı Çoklu Mağaza Karşılaştırması",
    description: `${query} araması için Google Shopping Türkiye üzerinden canlı derlenen ${offers.length} mağaza teklifi.`,
    url: aggregateKey,
    image: offers.find((o) => o.image)?.image || "",
    rating: null,
    totalOfferCount: offers.length,
    unitInfo: unitInfo ? extractUnitInfo(query, analysis.stats?.minNet ?? offers[0]?.basePrice) : null,
    fetchedAt: new Date().toISOString(),
    cached: false,
    provider: "Google Shopping TR (Serper)",
    lowPrice: analysis.stats?.minNet ?? null,
    highPrice: analysis.stats?.maxNet ?? null,
    stats: analysis.stats,
    picks: analysis.picks,
    shippingTraps: analysis.shippingTraps,
    platformBreakdown: analysis.platformBreakdown,
    offers: analysis.offers,
    history: [],
    historySummary: null,
    verdict: {
      ...histAnalysis.verdict,
      headline: `${offers.length} mağaza arasından kargo dahil en ucuz teklif ve fiyat dağılımı çıkarıldı.`,
      reasons: [
        analysis.stats
          ? `Piyasa medyanı ${analysis.stats.medianNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL; en ucuz teklif medyanın %${analysis.stats.savingsVsMedianPct} altında.`
          : "Canlı mağaza teklifleri kargo dahil net fiyata göre sıralandı.",
        `${analysis.platformBreakdown.length} farklı mağaza/pazaryeri karşılaştırıldı.`,
      ],
    },
    variants: [],
    specs: [],
  };

  saveVirtualDetail(aggregateKey, aggregateDetail);

  // Also cache each individual clicked item pointing to a focused cluster of similar offers
  products.forEach((p, idx) => {
    const itemTokens = tokenize(p.title);
    const matchingOffers = offers.filter((o) => overlapScore(itemTokens, tokenize(o.offerTitle)) >= 0.45);
    const pool = matchingOffers.length >= 2 ? matchingOffers : [offers[idx], ...offers.slice(0, 11)].filter(Boolean);
    const dedup = [];
    const seen = new Set();
    for (const o of pool) {
      if (!o || seen.has(o.id)) continue;
      seen.add(o.id);
      dedup.push(o);
    }
    const uInfo = extractUnitInfo(p.title, dedup[0]?.basePrice ?? null);
    const itemAnalysis = analyzeOffers(dedup, uInfo);
    saveVirtualDetail(p.url, {
      ...aggregateDetail,
      id: p.id,
      title: p.title,
      url: p.url,
      image: p.image || aggregateDetail.image,
      totalOfferCount: dedup.length,
      unitInfo: uInfo ? extractUnitInfo(p.title, itemAnalysis.stats?.minNet ?? p.lowestPrice) : null,
      lowPrice: itemAnalysis.stats?.minNet ?? p.lowestPrice,
      highPrice: itemAnalysis.stats?.maxNet ?? p.lowestPrice,
      stats: itemAnalysis.stats,
      picks: itemAnalysis.picks,
      shippingTraps: itemAnalysis.shippingTraps,
      platformBreakdown: itemAnalysis.platformBreakdown,
      offers: itemAnalysis.offers,
    });
  });

  // Put the aggregated "Tüm Teklifleri Kıyasla" summary card first when >= 2 offers exist
  const finalProducts =
    offers.length >= 2
      ? [
          {
            id: "sp-all",
            title: `📊 ${query} — Tüm Mağazaları Karşılaştır (${offers.length} teklif)`,
            url: aggregateKey,
            image: aggregateDetail.image,
            lowestPrice: analysis.stats?.minNet ?? null,
            offerCount: offers.length,
            badge: "Tüm Mağazalar",
            source: "Google Shopping TR",
            unitInfo: aggregateDetail.unitInfo,
          },
          ...products,
        ]
      : products;

  return {
    query,
    provider: "Google Shopping TR (Serper)",
    directProduct: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: finalProducts.length,
    products: finalProducts,
    aggregateUrl: offers.length >= 2 ? aggregateKey : null,
  };
}

/**
 * Provider 2: Google Shopping Türkiye via SerpAPI
 */
export async function searchSerpApiShopping(query, apiKey) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query)}&gl=tr&hl=tr&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    throw new Error(`SerpAPI yanıt hatası (HTTP ${res.status})`);
  }
  const data = await res.json();
  const shopping = Array.isArray(data.shopping_results) ? data.shopping_results : [];

  // Normalize to Serper-like items and reuse exact analysis pipeline
  const normalized = shopping.map((item) => ({
    title: item.title,
    price: item.extracted_price ?? item.price,
    delivery: item.delivery || "",
    source: item.source || "",
    rating: item.rating,
    ratingCount: item.reviews,
    link: item.link || item.product_link,
    imageUrl: item.thumbnail,
  }));

  // Reuse offer builder
  return buildShoppingResponse(query, normalized, "Google Shopping TR (SerpAPI)", "serpapi");
}

function buildShoppingResponse(query, items, providerName, prefix) {
  const offers = [];
  const products = [];

  items.forEach((item, idx) => {
    const basePrice = parseTrPrice(item.price);
    if (!basePrice || basePrice <= 0) return;

    const shipping = parseShipping(item.delivery || "");
    const store = parseStoreInfo(item.source || "", "");
    if (typeof item.rating === "number" && item.rating > 0) {
      store.sellerRating = Math.round(item.rating * 2 * 10) / 10;
      store.sellerReviews = item.ratingCount ? `${item.ratingCount} yorum` : "";
    }

    const offer = {
      id: `${prefix}-${idx + 1}`,
      offerTitle: item.title || query,
      basePrice,
      shipping,
      store,
      storeLogo: null,
      stockText: "Stokta",
      inStock: true,
      delivery: parseDeliverySpeed(item.delivery || ""),
      lastUpdated: "Canlı",
      promoNote: "",
      akakceBadge: "",
      url: item.link || `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(item.title || query)}`,
      isDirectLink: Boolean(item.link),
      image: item.imageUrl || "",
    };
    offers.push(offer);

    const vKey = `virtual:${prefix}:${encodeURIComponent(query)}:${idx}`;
    const unitInfo = extractUnitInfo(item.title || query, basePrice + shipping.cost);
    products.push({
      id: `${prefix}-${idx + 1}`,
      title: item.title || query,
      url: vKey,
      image: item.imageUrl || "",
      lowestPrice: Math.round((basePrice + shipping.cost) * 100) / 100,
      offerCount: 1,
      badge: store.platform,
      source: providerName,
      unitInfo,
    });
  });

  const aggregateKey = `virtual:${prefix}:all:${encodeURIComponent(query.toLocaleLowerCase("tr-TR"))}`;
  const unitInfo = extractUnitInfo(query, offers[0]?.basePrice ?? null);
  const analysis = analyzeOffers(offers, unitInfo);
  const histAnalysis = analyzePriceHistory([], analysis.stats?.minNet ?? null);

  const aggregateDetail = {
    id: `${prefix}-${Date.now()}`,
    title: `${query} — Tüm Türkiye Mağaza Teklifleri`,
    brand: "",
    category: `${providerName} · Canlı Çoklu Mağaza Karşılaştırması`,
    description: `${query} için canlı derlenen ${offers.length} mağaza teklifi.`,
    url: aggregateKey,
    image: offers.find((o) => o.image)?.image || "",
    rating: null,
    totalOfferCount: offers.length,
    unitInfo: unitInfo ? extractUnitInfo(query, analysis.stats?.minNet ?? offers[0]?.basePrice) : null,
    fetchedAt: new Date().toISOString(),
    cached: false,
    provider: providerName,
    lowPrice: analysis.stats?.minNet ?? null,
    highPrice: analysis.stats?.maxNet ?? null,
    stats: analysis.stats,
    picks: analysis.picks,
    shippingTraps: analysis.shippingTraps,
    platformBreakdown: analysis.platformBreakdown,
    offers: analysis.offers,
    history: [],
    historySummary: null,
    verdict: histAnalysis.verdict,
    variants: [],
    specs: [],
  };
  saveVirtualDetail(aggregateKey, aggregateDetail);

  products.forEach((p, idx) => {
    const itemTokens = tokenize(p.title);
    const matching = offers.filter((o) => overlapScore(itemTokens, tokenize(o.offerTitle)) >= 0.45);
    const pool = matching.length >= 2 ? matching : [offers[idx], ...offers.slice(0, 11)].filter(Boolean);
    const uInfo = extractUnitInfo(p.title, pool[0]?.basePrice ?? null);
    const itemAnalysis = analyzeOffers(pool, uInfo);
    saveVirtualDetail(p.url, {
      ...aggregateDetail,
      id: p.id,
      title: p.title,
      url: p.url,
      image: p.image || aggregateDetail.image,
      totalOfferCount: pool.length,
      unitInfo: uInfo ? extractUnitInfo(p.title, itemAnalysis.stats?.minNet ?? p.lowestPrice) : null,
      lowPrice: itemAnalysis.stats?.minNet ?? p.lowestPrice,
      highPrice: itemAnalysis.stats?.maxNet ?? p.lowestPrice,
      stats: itemAnalysis.stats,
      picks: itemAnalysis.picks,
      shippingTraps: itemAnalysis.shippingTraps,
      platformBreakdown: itemAnalysis.platformBreakdown,
      offers: itemAnalysis.offers,
    });
  });

  const finalProducts =
    offers.length >= 2
      ? [
          {
            id: `${prefix}-all`,
            title: `📊 ${query} — Tüm Mağazaları Karşılaştır (${offers.length} teklif)`,
            url: aggregateKey,
            image: aggregateDetail.image,
            lowestPrice: analysis.stats?.minNet ?? null,
            offerCount: offers.length,
            badge: "Tüm Mağazalar",
            source: providerName,
            unitInfo: aggregateDetail.unitInfo,
          },
          ...products,
        ]
      : products;

  return {
    query,
    provider: providerName,
    directProduct: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: finalProducts.length,
    products: finalProducts,
    aggregateUrl: offers.length >= 2 ? aggregateKey : null,
  };
}

/**
 * Provider 3 (Zero-Key Official Cloud-Proof Fallback):
 * Combines:
 * - T.C. Ticaret Bakanlığı / TÜBİTAK Market Fiyatı API (A101, BİM, CarrefourSA, Migros, ŞOK, Hakmar, Tarım Kredi)
 * - Migros Elektronik REST API (iPhones, Dyson, PlayStation, TVs, appliances)
 * - Migros Sanal Market REST API
 */
export async function searchOfficialFallback(query) {
  const [marketItems, migrosElec, migrosMarket] = await Promise.all([
    fetchMarketFiyati(query).catch(() => []),
    fetchMigros(query, "elektronik").catch(() => []),
    fetchMigros(query, "market").catch(() => []),
  ]);

  const combined = [];
  const seenTitles = new Set();

  for (const item of [...marketItems, ...migrosElec, ...migrosMarket]) {
    const key = item.title.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    combined.push(item);
  }

  return {
    query,
    provider: "Migros Elektronik + T.C. Market Fiyatı",
    fallbackMode: true,
    directProduct: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: combined.length,
    products: combined,
  };
}

async function fetchMarketFiyati(query) {
  const res = await fetch("https://api.marketfiyati.org.tr/api/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify({ keywords: query, pages: 0, size: 20 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const list = Array.isArray(data.content) ? data.content : [];

  const products = [];
  for (const item of list) {
    const depots = Array.isArray(item.productDepotInfoList) ? item.productDepotInfoList : [];
    if (!depots.length) continue;

    // Group best price per supermarket chain
    const byChain = new Map();
    for (const d of depots) {
      const p = typeof d.price === "number" ? d.price : parseTrPrice(d.price);
      if (!p || p <= 0) continue;
      const chainKey = String(d.marketAdi || "market").toLowerCase();
      const prev = byChain.get(chainKey);
      if (!prev || p < prev.price) {
        byChain.set(chainKey, { ...d, price: p, chainKey });
      }
    }

    const chainOffers = [...byChain.values()].map((d, idx) => {
      const marketLabel = MARKET_NAMES[d.chainKey] || d.marketAdi || "Market";
      return {
        id: `mf-${item.id}-${idx + 1}`,
        offerTitle: item.title,
        basePrice: d.price,
        shipping: { cost: 0, isFree: true, label: "Mağaza / Market Fiyatı", unknown: false },
        store: parseStoreInfo(marketLabel, d.depotName || ""),
        storeLogo: null,
        stockText: "Mağazada",
        inStock: true,
        delivery: { label: "Şube / Online", days: 0, score: 0.9 },
        lastUpdated: d.indexTime || "",
        promoNote: d.discount && d.discountlessPrice ? `İndirimsiz: ${d.discountlessPrice.toLocaleString("tr-TR")} TL` : "",
        akakceBadge: "",
        url: `https://marketfiyati.org.tr/ara?q=${encodeURIComponent(item.title)}`,
        isDirectLink: true,
      };
    });

    if (!chainOffers.length) continue;

    const vKey = `virtual:mf:${item.id}`;
    const minPrice = Math.min(...chainOffers.map((o) => o.basePrice));
    const unitInfo = extractUnitInfo(item.title, minPrice);
    const analysis = analyzeOffers(chainOffers, unitInfo);
    const histAnalysis = analyzePriceHistory([], analysis.stats?.minNet ?? minPrice);

    saveVirtualDetail(vKey, {
      id: `mf-${item.id}`,
      title: item.title,
      brand: item.brand || "",
      category: Array.isArray(item.categories) ? item.categories.join(" > ") : "Market",
      description: `${item.title} için T.C. Ticaret Bakanlığı Market Fiyatı resmi verileri.`,
      url: vKey,
      image: item.imageUrl || "",
      rating: null,
      totalOfferCount: chainOffers.length,
      unitInfo: unitInfo ? extractUnitInfo(item.title, analysis.stats?.minNet ?? minPrice) : null,
      fetchedAt: new Date().toISOString(),
      cached: false,
      provider: "T.C. Market Fiyatı (TÜBİTAK)",
      lowPrice: analysis.stats?.minNet ?? minPrice,
      highPrice: analysis.stats?.maxNet ?? minPrice,
      stats: analysis.stats,
      picks: analysis.picks,
      shippingTraps: analysis.shippingTraps,
      platformBreakdown: analysis.platformBreakdown,
      offers: analysis.offers,
      history: [],
      historySummary: null,
      verdict: histAnalysis.verdict,
      variants: [],
      specs: item.refinedQuantityUnit
        ? [{ name: "Miktar / Birim", value: item.refinedQuantityUnit }]
        : [],
    });

    products.push({
      id: `mf-${item.id}`,
      title: item.title,
      url: vKey,
      image: item.imageUrl || "",
      lowestPrice: minPrice,
      offerCount: chainOffers.length,
      badge: "T.C. Market Fiyatı",
      source: "T.C. Market Fiyatı",
      unitInfo,
    });
  }

  return products;
}

async function fetchMigros(query, vertical = "elektronik") {
  const endpoint =
    vertical === "elektronik"
      ? `https://www.migros.com.tr/rest/elektronik/search/screens/products?q=${encodeURIComponent(query)}&sayfa=1`
      : `https://www.migros.com.tr/rest/search/screens/products?q=${encodeURIComponent(query)}&sayfa=1&sirala=onerilenler`;

  const res = await fetch(endpoint, {
    headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "tr-TR,tr;q=0.9" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const items = json?.data?.searchInfo?.storeProductInfos || [];

  const products = [];
  for (const it of items.slice(0, 18)) {
    const rawPrice = it.shownPrice || it.salePrice || it.regularPrice;
    if (!rawPrice || rawPrice <= 0) continue;
    // Migros REST API returns prices in kuruş (integer * 100)
    const price = Math.round((rawPrice / 100) * 100) / 100;
    const regularPrice = it.regularPrice ? Math.round((it.regularPrice / 100) * 100) / 100 : null;
    const title = String(it.name || "").trim();
    if (!title) continue;

    const image =
      it.images?.[0]?.urls?.PRODUCT_DETAIL ||
      it.images?.[0]?.urls?.PRODUCT_LIST ||
      "";
    const directUrl =
      vertical === "elektronik"
        ? `https://www.migros.com.tr/elektronik/${it.prettyName}`
        : `https://www.migros.com.tr/${it.prettyName}`;

    const vKey = `virtual:migros:${vertical}:${it.id}`;
    const platformLabel = vertical === "elektronik" ? "Migros Ekstra" : "Migros Sanal Market";
    const offer = {
      id: `mg-${it.id}`,
      offerTitle: title,
      basePrice: price,
      shipping: {
        cost: 0,
        isFree: price >= 500,
        label: price >= 500 ? "Ücretsiz kargo" : "Migros teslimat",
        unknown: price < 500,
      },
      store: parseStoreInfo(platformLabel, ""),
      storeLogo: null,
      stockText: it.status === "IN_SALE" ? "Stokta" : "Kontrol edin",
      inStock: it.status === "IN_SALE",
      delivery: { label: vertical === "elektronik" ? "Kargo ile teslimat" : "Aynı gün teslimat", days: vertical === "elektronik" ? 2 : 0, score: vertical === "elektronik" ? 0.78 : 0.98 },
      lastUpdated: "Canlı",
      promoNote:
        regularPrice && regularPrice > price
          ? `Liste fiyatı: ${regularPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`
          : "",
      akakceBadge: "",
      url: directUrl,
      isDirectLink: true,
    };

    const unitInfo = extractUnitInfo(title, price);
    const analysis = analyzeOffers([offer], unitInfo);
    const histAnalysis = analyzePriceHistory([], price);

    saveVirtualDetail(vKey, {
      id: `mg-${it.id}`,
      title,
      brand: it.brand?.name || "",
      category: platformLabel,
      description: `${title} — ${platformLabel} canlı fiyatı.`,
      url: vKey,
      image,
      rating: null,
      totalOfferCount: 1,
      unitInfo,
      fetchedAt: new Date().toISOString(),
      cached: false,
      provider: platformLabel,
      lowPrice: price,
      highPrice: regularPrice || price,
      stats: analysis.stats,
      picks: analysis.picks,
      shippingTraps: [],
      platformBreakdown: analysis.platformBreakdown,
      offers: analysis.offers,
      history: [],
      historySummary: null,
      verdict: histAnalysis.verdict,
      variants: [],
      specs: regularPrice && regularPrice > price
        ? [{ name: "İndirimsiz Liste Fiyatı", value: `${regularPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` }]
        : [],
    });

    products.push({
      id: `mg-${it.id}`,
      title,
      url: vKey,
      image,
      lowestPrice: price,
      offerCount: 1,
      badge: platformLabel,
      source: platformLabel,
      unitInfo,
    });
  }

  return products;
}

function tokenize(str) {
  return new Set(
    String(str || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9ğüşıöç]+/gi, " ")
      .split(" ")
      .filter((w) => w.length >= 2)
  );
}

function overlapScore(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  for (const w of setA) {
    if (setB.has(w)) common++;
  }
  return common / Math.min(setA.size, setB.size);
}
