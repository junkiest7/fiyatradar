/**
 * Cloud-proof Turkish e-commerce data providers:
 * 1. Serper.dev Google Türkiye Search (/search with gl:"tr", hl:"tr")
 *    NOTE: Google Shopping (/shopping) was disabled in Turkey in 2020 by Rekabet Kurumu,
 *    so /search organic + rich product snippets (price, priceRange, rating, TL snippets)
 *    across Trendyol, Hepsiburada, Amazon TR, Stradivarius, Zara, Boyner, n11, Akakçe,
 *    Cimri, MediaMarkt, Teknosa, Vatan, etc. is the reliable Turkey engine!
 * 2. SerpAPI Google Türkiye Search (engine=google, gl=tr, hl=tr)
 * 3. T.C. Ticaret Bakanlığı / TÜBİTAK Market Fiyatı API (Zero-key official API)
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

const DOMAIN_STORE_MAP = [
  ["trendyol.com", "Trendyol"],
  ["hepsiburada.com", "Hepsiburada"],
  ["amazon.com.tr", "Amazon Türkiye"],
  ["n11.com", "n11"],
  ["pazarama.com", "Pazarama"],
  ["idefix.com", "idefix"],
  ["pttavm.com", "PttAVM"],
  ["mediamarkt.com.tr", "MediaMarkt"],
  ["teknosa.com", "Teknosa"],
  ["vatanbilgisayar.com", "Vatan Bilgisayar"],
  ["akakce.com", "Akakçe"],
  ["cimri.com", "Cimri"],
  ["epey.com", "Epey"],
  ["migros.com.tr", "Migros"],
  ["carrefoursa.com", "CarrefourSA"],
  ["a101.com.tr", "A101"],
  ["bim.com.tr", "BİM"],
  ["sokmarket.com.tr", "ŞOK Market"],
  ["ciceksepeti.com", "Çiçeksepeti"],
  ["stradivarius.com", "Stradivarius"],
  ["zara.com", "Zara"],
  ["mango.com", "Mango"],
  ["bershka.com", "Bershka"],
  ["pullandbear.com", "Pull&Bear"],
  ["massimodutti.com", "Massimo Dutti"],
  ["oysho.com", "Oysho"],
  ["hm.com", "H&M"],
  ["boyner.com.tr", "Boyner"],
  ["beymen.com", "Beymen"],
  ["vakko.com", "Vakko"],
  ["flo.com.tr", "FLO"],
  ["derimod.com.tr", "Derimod"],
  ["hotic.com.tr", "Hotiç"],
  ["desa.com.tr", "Desa"],
  ["elle.com.tr", "Elle Shoes"],
  ["inci.com.tr", "İnci"],
  ["lcw.com", "LC Waikiki"],
  ["lcwaikiki.com", "LC Waikiki"],
  ["koton.com", "Koton"],
  ["defacto.com.tr", "DeFacto"],
  ["mavi.com", "Mavi"],
  ["ipekyol.com.tr", "İpekyol"],
  ["network.com.tr", "NetWork"],
  ["nike.com", "Nike Türkiye"],
  ["adidas.com.tr", "Adidas Türkiye"],
  ["puma.com", "Puma Türkiye"],
  ["superstep.com.tr", "SuperStep"],
  ["sneaksup.com", "Sneaks Up"],
  ["decathlon.com.tr", "Decathlon"],
  ["dr.com.tr", "D&R"],
  ["koctas.com.tr", "Koçtaş"],
  ["ikea.com.tr", "IKEA Türkiye"],
  ["dyson.com.tr", "Dyson Türkiye"],
  ["apple.com", "Apple Türkiye"],
  ["samsung.com", "Samsung Türkiye"],
  ["philips.com.tr", "Philips Türkiye"],
  ["karaca.com", "Karaca"],
  ["korkmazstore.com.tr", "Korkmaz"],
  ["englishhome.com", "English Home"],
  ["madamecoco.com", "Madame Coco"],
  ["sephora.com.tr", "Sephora"],
  ["watsons.com.tr", "Watsons"],
  ["gratis.com", "Gratis"],
  ["itopya.com", "İtopya"],
  ["incehesap.com", "İncehesap"],
  ["sinerji.gen.tr", "Sinerji"],
  ["gaming.gen.tr", "Gaming.Gen.TR"],
  ["gurgencler.com.tr", "Gürgençler"],
  ["troyestore.com", "Troy"],
  ["pt.com.tr", "Pozitif Teknoloji"],
  ["turkcell.com.tr", "Turkcell Pasaj"],
  ["vodafone.com.tr", "Vodafone"],
  ["ebek.com", "ebebek"],
  ["ebebek.com", "ebebek"],
  ["civilim.com", "Civil"],
  ["dolap.com", "Dolap"],
  ["gardrops.com", "Gardrops"],
  ["sahibinden.com", "sahibinden"],
];

// Non-shopping informational / social domains to exclude from store offers
const NON_SHOPPING_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "eksisozluk.com",
  "wikipedia.org",
  "pinterest.com",
  "linkedin.com",
  "sikayetvar.com",
];

// In-memory store for detail views of non-Akakce provider products
const virtualDetailCache = new Map();

function saveVirtualDetail(key, payload) {
  if (virtualDetailCache.size > 300) {
    const first = virtualDetailCache.keys().next().value;
    virtualDetailCache.delete(first);
  }
  virtualDetailCache.set(key, { payload, expiresAt: Date.now() + 30 * 60 * 1000 });
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
 * Resolves Turkish store name & favicon from any product URL.
 */
export function resolveStoreFromUrl(urlStr, fallbackSource = "") {
  let host = "";
  try {
    host = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    host = "";
  }

  for (const [domain, label] of DOMAIN_STORE_MAP) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return {
        platform: label,
        host,
        logoUrl: host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null,
      };
    }
  }

  const prettyHost = fallbackSource || (host ? host.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : "Mağaza");
  return {
    platform: prettyHost,
    host,
    logoUrl: host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null,
  };
}

function isNonShoppingUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase();
    return NON_SHOPPING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Extracts live TL price & shipping cues from Google Turkey organic/rich result objects.
 * Handles:
 * - Structured rich result fields (item.price, item.priceRange, item.attributes)
 * - Turkish TL/₺ prices in snippet/title ("1.990,00 TL", "₺54.999", "81.997,26 TL", "2.490 TL")
 * - Installment patterns ("3x 596,67 TL" -> 1.790,01 TL when no direct cash price exists)
 * - Avoids mistaking shipping thresholds ("500 TL üzeri kargo bedava") or shipping fees ("+44,99 TL kargo") for product prices
 */
export function extractOrganicPriceInfo(item) {
  const snippet = String(item?.snippet || "");
  const title = String(item?.title || "");
  const attrText = item?.attributes && typeof item.attributes === "object"
    ? Object.entries(item.attributes).map(([k, v]) => `${k}: ${v}`).join(" · ")
    : "";
  const combinedText = `${title} | ${attrText} | ${snippet}`;

  // 1. Detect shipping cues in text
  let shipping = { cost: 0, isFree: false, label: "Mağazada kontrol edin", unknown: true };
  if (/ücretsiz\s+kargo|kargo\s+bedava|bedava\s+kargo|kargo\s+dahil/i.test(combinedText)) {
    shipping = { cost: 0, isFree: true, label: "Ücretsiz kargo", unknown: false };
  } else {
    const shipCostMatch = combinedText.match(/\+?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:TL|₺)\s*kargo/i);
    if (shipCostMatch) {
      const sc = parseTrPrice(shipCostMatch[1]);
      if (sc !== null && sc > 0 && sc < 2000) {
        shipping = parseShipping(`+${shipCostMatch[1]} TL kargo`);
      }
    }
  }

  // 2. Check structured rich fields first (Google rich product schema parsed by Serper/SerpAPI)
  const currencyRaw = String(item?.currency || "").toUpperCase();
  const isForeignCurrency =
    currencyRaw && !["TRY", "TL", "₺"].includes(currencyRaw) && /USD|\$|EUR|€|GBP|£/.test(currencyRaw);

  if (!isForeignCurrency) {
    if (typeof item?.price === "number" && item.price > 0) {
      return { price: Math.round(item.price * 100) / 100, shipping, source: "rich" };
    }
    if (typeof item?.price === "string" && item.price.trim()) {
      const p = parseTrPrice(item.price);
      if (p && p > 0) return { price: p, shipping, source: "rich" };
    }
    if (typeof item?.priceRange === "string" && item.priceRange.trim()) {
      const p = parseTrPrice(item.priceRange);
      if (p && p > 0) return { price: p, shipping, source: "range" };
    }
  }

  // 3. Scan snippet + attributes + title for TL / ₺ prices
  const directCandidates = [];
  const installmentCandidates = [];

  // Pattern A: optional "3x " + number + " TL / ₺ / TRY"
  const afterRe = /(?:(\d{1,2})\s*[x×]\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)(?![a-zA-ZğüşıöçĞÜŞİÖÇ])/gi;
  for (const m of combinedText.matchAll(afterRe)) {
    const val = parseTrPrice(m[2]);
    if (!val || val < 10) continue;
    const afterCtx = combinedText.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 26).toLowerCase();
    const beforeCtx = combinedText.slice(Math.max(0, (m.index || 0) - 24), m.index || 0).toLowerCase();

    // Skip shipping fees, coupon discounts, free-shipping minimums
    if (/^\s*(kargo|üzeri|üzerine|altı|indirim|kupon|puan|hediye|cashback|kazan)/i.test(afterCtx)) continue;
    if (/(kargo|kupon|indirim|puan|hediye)\s*[:+]?\s*$/i.test(beforeCtx)) continue;

    if (m[1]) {
      const mul = Number.parseInt(m[1], 10);
      if (mul >= 2 && mul <= 12) {
        installmentCandidates.push(Math.round(val * mul * 100) / 100);
        continue;
      }
    }
    if (/taksit/i.test(afterCtx) && val < 2000) {
      continue;
    }
    directCandidates.push(val);
  }

  // Pattern B: "₺1.990,00" or "TRY 54,999.00"
  const beforeRe = /(?:₺|TRY)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  for (const m of combinedText.matchAll(beforeRe)) {
    const val = parseTrPrice(m[1]);
    if (!val || val < 10) continue;
    directCandidates.push(val);
  }

  if (directCandidates.length > 0) {
    return { price: directCandidates[0], shipping, source: "snippet" };
  }
  if (installmentCandidates.length > 0) {
    return { price: installmentCandidates[0], shipping, source: "installment" };
  }

  return { price: null, shipping, source: "none" };
}

/**
 * Provider 1: Serper.dev Google Türkiye Search Engine
 * Uses /search (gl: "tr", hl: "tr") because Google Shopping (/shopping) is disabled in Turkey!
 * Automatically extracts live prices, shipping, ratings, images, and store links across
 * Trendyol, Hepsiburada, Amazon TR, Stradivarius, Zara, Boyner, n11, Akakçe, Cimri, MediaMarkt, etc.
 */
export async function searchSerperTurkey(query, apiKey) {
  const callSerper = async (endpoint, body) => {
    const res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new Error("Serper API anahtarı geçersiz veya kredi tükendi. Lütfen Ayarlar (⚙) menüsünden anahtarınızı kontrol edin.");
      }
      throw new Error(`Serper API yanıt hatası (HTTP ${res.status}): ${errTxt.slice(0, 120)}`);
    }
    return res.json();
  };

  // Query 1: Broad Turkish price search (captures official brand stores like Stradivarius, Zara, Apple + Trendyol/Hepsiburada/Akakce/Cimri)
  const qWithPrice = /fiyat|tl\b/i.test(query) ? query : `${query} fiyat TL`;
  const data1 = await callSerper("search", {
    q: qWithPrice,
    gl: "tr",
    hl: "tr",
    num: 20,
  });

  const organic1 = Array.isArray(data1.organic) ? data1.organic : [];
  let combinedOrganic = [...organic1];

  // Count how many priced items we got from call 1
  const pricedCount1 = organic1.filter((it) => !isNonShoppingUrl(it.link) && extractOrganicPriceInfo(it).price !== null).length;

  // Query 2 (only if < 5 priced results from query 1): targeted major TR marketplaces & price comparators
  if (pricedCount1 < 5) {
    try {
      const data2 = await callSerper("search", {
        q: `${query} fiyat (site:trendyol.com OR site:hepsiburada.com OR site:amazon.com.tr OR site:n11.com OR site:akakce.com OR site:cimri.com OR site:mediamarkt.com.tr OR site:teknosa.com OR site:pazarama.com)`,
        gl: "tr",
        hl: "tr",
        num: 15,
      });
      if (Array.isArray(data2.organic)) {
        combinedOrganic.push(...data2.organic);
      }
    } catch {
      // Non-fatal; keep query 1 results
    }
  }

  // Optional: If Serper also returned inline shopping results or images, capture them too!
  const inlineImages = Array.isArray(data1.images) ? data1.images : [];
  const defaultProductImage = inlineImages[0]?.imageUrl || "";

  return buildTurkeySearchResponse(query, combinedOrganic, defaultProductImage, "Google Türkiye (Serper)", "serper");
}

/**
 * Quick key validation helper for Settings modal ("Anahtarı Test Et").
 */
export async function testSerperKey(apiKey) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: "iphone fiyat", gl: "tr", hl: "tr", num: 5 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      res.status === 401 || res.status === 403
        ? "Serper API anahtarı geçersiz veya yetkisiz."
        : `Serper hata (HTTP ${res.status}): ${txt.slice(0, 100)}`
    );
  }
  const data = await res.json();
  return {
    ok: true,
    creditsLeft: data.credits ?? null,
    sampleCount: Array.isArray(data.organic) ? data.organic.length : 0,
  };
}

/**
 * Provider 2: SerpAPI Google Türkiye Search
 */
export async function searchSerpApiTurkey(query, apiKey) {
  const qWithPrice = /fiyat|tl\b/i.test(query) ? query : `${query} fiyat TL`;
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(qWithPrice)}&gl=tr&hl=tr&num=20&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    throw new Error(`SerpAPI yanıt hatası (HTTP ${res.status})`);
  }
  const data = await res.json();
  const organic = (Array.isArray(data.organic_results) ? data.organic_results : []).map((it) => ({
    title: it.title,
    link: it.link,
    snippet: it.snippet || "",
    imageUrl: it.thumbnail || "",
    price: it.rich_snippet?.bottom?.detected_extensions?.price ?? it.rich_snippet?.top?.detected_extensions?.price,
    currency: it.rich_snippet?.bottom?.detected_extensions?.currency ?? it.rich_snippet?.top?.detected_extensions?.currency,
    rating: it.rich_snippet?.top?.detected_extensions?.rating ?? it.rich_snippet?.bottom?.detected_extensions?.rating,
    ratingCount: it.rich_snippet?.top?.detected_extensions?.reviews ?? it.rich_snippet?.bottom?.detected_extensions?.reviews,
  }));

  return buildTurkeySearchResponse(query, organic, "", "Google Türkiye (SerpAPI)", "serpapi");
}

function buildTurkeySearchResponse(query, rawOrganic, fallbackImage, providerName, prefix) {
  const seenUrls = new Set();
  const pricedOffers = [];
  const catalogLinks = [];
  const products = [];

  for (const item of rawOrganic) {
    const link = item?.link;
    const title = String(item?.title || "").replace(/\s+/g, " ").trim();
    if (!link || !title || seenUrls.has(link) || isNonShoppingUrl(link)) continue;
    seenUrls.add(link);

    const storeMeta = resolveStoreFromUrl(link, item.source || "");
    const store = parseStoreInfo(storeMeta.platform, "");
    const priceInfo = extractOrganicPriceInfo(item);
    const snippet = String(item.snippet || "").replace(/\s+/g, " ").trim();
    const delivery = parseDeliverySpeed(snippet);
    const imgUrl = item.imageUrl || item.thumbnailUrl || "";

    if (typeof item.rating === "number" && item.rating > 0) {
      store.sellerRating = Math.round(item.rating * 2 * 10) / 10;
      store.sellerReviews = item.ratingCount ? `${item.ratingCount} yorum` : "";
    }

    const idx = pricedOffers.length + catalogLinks.length + 1;
    const vKey = `virtual:${prefix}:${encodeURIComponent(query)}:${idx}`;

    // Extract seller count hint from Akakce/Cimri snippets like "+150 FİYAT" or "19 satıcı"
    const sellerCountMatch = snippet.match(/(?:\+(\d+)\s*FİYAT|(\d+)\s*satıcı)/i);
    const offerCountHint = sellerCountMatch ? Number.parseInt(sellerCountMatch[1] || sellerCountMatch[2], 10) : 1;

    if (priceInfo.price !== null && priceInfo.price > 0) {
      const offer = {
        id: `${prefix}-${idx}`,
        offerTitle: title,
        basePrice: priceInfo.price,
        shipping: priceInfo.shipping,
        store,
        storeLogo: storeMeta.logoUrl,
        stockText: /tükendi|stokta yok/i.test(snippet) ? "Stok kontrol edin" : "Stokta",
        inStock: !/tükendi|stokta yok/i.test(snippet),
        delivery,
        lastUpdated: item.date || "Canlı Google TR",
        promoNote: priceInfo.source === "installment" ? "Taksit tutarından hesaplandı" : snippet.slice(0, 110),
        akakceBadge: "",
        url: link,
        isDirectLink: true,
        image: imgUrl,
      };
      pricedOffers.push(offer);

      const netEstimate = Math.round((priceInfo.price + priceInfo.shipping.cost) * 100) / 100;
      const unitInfo = extractUnitInfo(title, netEstimate);

      products.push({
        id: `${prefix}-${idx}`,
        title,
        url: vKey,
        externalUrl: link,
        image: imgUrl || storeMeta.logoUrl || fallbackImage,
        lowestPrice: netEstimate,
        offerCount: offerCountHint,
        badge: storeMeta.platform,
        source: storeMeta.platform,
        unitInfo,
        _offer: offer,
      });
    } else {
      // Unpriced store listing (e.g. Trendyol/Stradivarius category or product page without price in snippet)
      catalogLinks.push({
        id: `${prefix}-cat-${idx}`,
        title,
        url: link,
        store: storeMeta.platform,
        logoUrl: storeMeta.logoUrl,
        image: imgUrl || storeMeta.logoUrl || fallbackImage,
        snippet,
      });
    }
  }

  // Analyze all priced offers across all discovered Turkish stores
  const unitInfoGlobal = extractUnitInfo(query, pricedOffers[0]?.basePrice ?? null);
  const analysis = analyzeOffers(pricedOffers, unitInfoGlobal);
  const histAnalysis = analyzePriceHistory([], analysis.stats?.minNet ?? null);

  const aggregateKey = `virtual:${prefix}:all:${encodeURIComponent(query.toLocaleLowerCase("tr-TR"))}`;
  const bestImage =
    pricedOffers.find((o) => o.image)?.image ||
    catalogLinks.find((c) => c.image)?.image ||
    fallbackImage;

  const extraStoreVariants = catalogLinks.slice(0, 10).map((c) => ({
    name: `${c.store} — ${c.title.slice(0, 56)}`,
    price: null,
    seller: c.store,
    url: c.url,
    isAkakceUrl: false,
  }));

  const aggregateDetail = {
    id: `${prefix}-${Date.now()}`,
    title: `${query} — Türkiye Mağaza Fiyat Karşılaştırması`,
    brand: "",
    category: `${providerName} · Canlı Çoklu Mağaza Analizi`,
    description: `${query} için Türkiye mağazalarından canlı derlenen ${pricedOffers.length} fiyatlı teklif ve ${catalogLinks.length} mağaza sayfası.`,
    url: aggregateKey,
    image: bestImage,
    rating: null,
    totalOfferCount: pricedOffers.length,
    unitInfo: unitInfoGlobal ? extractUnitInfo(query, analysis.stats?.minNet ?? pricedOffers[0]?.basePrice) : null,
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
    verdict: {
      ...histAnalysis.verdict,
      score: analysis.stats ? (analysis.stats.savingsVsMedianPct >= 15 ? 82 : analysis.stats.savingsVsMedianPct >= 6 ? 72 : 64) : 60,
      label: analysis.stats ? `${pricedOffers.length} Fiyatlı Teklif Karşılaştırıldı` : "Mağaza Bağlantıları Bulundu",
      tone: analysis.stats && analysis.stats.savingsVsMedianPct >= 10 ? "good" : "good-soft",
      headline: analysis.stats
        ? `En ucuz net teklif ${analysis.stats.minNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL (${analysis.picks?.cheapestNet?.store || ""}).`
        : "Fiyatlar doğrudan mağaza sayfalarından incelenebilir.",
      reasons: analysis.stats
        ? [
            `Piyasa medyanı ${analysis.stats.medianNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL; en ucuz seçenek medyanın %${analysis.stats.savingsVsMedianPct} altında.`,
            `${analysis.platformBreakdown.length} farklı mağaza/platform karşılaştırıldı.`,
            "Satın almadan önce mağaza linkinden güncel beden/renk ve kargo tutarını doğrulamanız önerilir.",
          ]
        : ["Bu aramada fiyat bilgisi ürün sayfalarının içinde yer alıyor; aşağıdaki mağaza linklerinden anında açabilirsiniz."],
    },
    variants: extraStoreVariants,
    specs: [],
  };

  saveVirtualDetail(aggregateKey, aggregateDetail);

  // Cache detail view for every individual priced card
  for (const p of products) {
    const itemTokens = tokenize(p.title);
    const similar = pricedOffers.filter((o) => overlapScore(itemTokens, tokenize(o.offerTitle)) >= 0.4);
    const pool = similar.length >= 2 ? similar : [p._offer, ...pricedOffers.slice(0, 11)].filter(Boolean);
    const dedup = [];
    const seen = new Set();
    for (const o of pool) {
      if (!o || seen.has(o.id)) continue;
      seen.add(o.id);
      dedup.push(o);
    }
    const uInfo = extractUnitInfo(p.title, p.lowestPrice);
    const itemAnalysis = analyzeOffers(dedup, uInfo);

    saveVirtualDetail(p.url, {
      ...aggregateDetail,
      id: p.id,
      title: p.title,
      url: p.url,
      image: p.image || bestImage,
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
    delete p._offer;
  }

  // Also add unpriced catalog links as browsable cards (with direct external store jump + detail view)
  const catalogCards = catalogLinks.slice(0, 8).map((c) => {
    const cKey = `virtual:${prefix}:cat:${encodeURIComponent(c.id)}`;
    saveVirtualDetail(cKey, {
      ...aggregateDetail,
      id: c.id,
      title: c.title,
      url: cKey,
      image: c.image || bestImage,
      description: c.snippet,
      variants: [
        { name: `${c.store} Sayfasına Git`, price: null, seller: c.store, url: c.url, isAkakceUrl: false },
        ...extraStoreVariants.filter((v) => v.url !== c.url),
      ],
    });
    return {
      id: c.id,
      title: c.title,
      url: cKey,
      externalUrl: c.url,
      image: c.image,
      lowestPrice: null,
      offerCount: 1,
      badge: c.store,
      source: c.store,
      unitInfo: null,
    };
  });

  // Sort priced cards by lowestPrice ascending, prepend aggregate summary card when >= 2 priced offers exist
  products.sort((a, b) => (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity));

  const finalProducts = [
    ...(pricedOffers.length >= 2
      ? [
          {
            id: `${prefix}-all`,
            title: `📊 ${query} — Tüm Mağazaları Karşılaştır (${pricedOffers.length} fiyatlı teklif)`,
            url: aggregateKey,
            image: bestImage,
            lowestPrice: analysis.stats?.minNet ?? null,
            offerCount: pricedOffers.length,
            badge: "Tüm Mağazalar",
            source: providerName,
            unitInfo: aggregateDetail.unitInfo,
          },
        ]
      : []),
    ...products,
    ...catalogCards,
  ];

  return {
    query,
    provider: providerName,
    directProduct: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: finalProducts.length,
    pricedFound: pricedOffers.length,
    products: finalProducts,
    aggregateUrl: pricedOffers.length >= 2 ? aggregateKey : null,
  };
}

/**
 * Provider 3 (Zero-Key Official Cloud-Proof Fallback):
 * Combines:
 * - T.C. Ticaret Bakanlığı / TÜBİTAK Market Fiyatı API (A101, BİM, CarrefourSA, Migros, ŞOK, Hakmar, Tarım Kredi)
 * - Migros Elektronik REST API
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
