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

import * as cheerio from "cheerio";
import {
  areColorsCompatible,
  extractColorFromText,
  extractUnitInfo,
  extractVariantAttributes,
  isAccessoryTitle,
  parseDeliverySpeed,
  parseShipping,
  parseStoreInfo,
  parseTrPrice,
  transliterateTr,
} from "./parsers.js";
import { analyzeOffers, analyzePriceHistory } from "./analyzer.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let sharedSerperRoundRobinIdx = 0;

/**
 * Returns a deduplicated, round-robin rotated pool of configured Serper API keys
 * (client key -> SERPER_API_KEYS pool -> SERPER_API_KEY).
 */
export function getSerperKeyPool(clientKey = "") {
  const keys = [];
  const pushUnique = (raw) => {
    const k = String(raw || "").trim();
    if (k && !keys.includes(k)) keys.push(k);
  };
  pushUnique(clientKey);
  const envList = [
    ...String(process.env.SERPER_API_KEYS || "").split(/[\s,;]+/),
    String(process.env.SERPER_API_KEY || ""),
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  if (envList.length > 1) {
    const start = sharedSerperRoundRobinIdx++ % envList.length;
    for (let i = 0; i < envList.length; i++) {
      pushUnique(envList[(start + i) % envList.length]);
    }
  } else {
    envList.forEach(pushUnique);
  }
  return keys;
}

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
  ["letgo.com", "Letgo"],
  ["modacruz.com", "ModaCruz"],
  ["zebramo.com", "Zebramo"],
];

const SECOND_HAND_DOMAINS = [
  "dolap.com",
  "gardrops.com",
  "sahibinden.com",
  "letgo.com",
  "modacruz.com",
  "zebramo.com",
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

const PRICE_AGGREGATOR_DOMAINS = [
  "cimri.com",
  "epey.com",
  "akakce.com",
  "fiyat.com",
  "enuygun.com",
  "ucuzu.com",
  "bilio.com",
];

function isNonShoppingUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase();
    return NON_SHOPPING_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function isPriceAggregatorUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\.|^m\./i, "").toLowerCase();
    return PRICE_AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

const LISTING_PATH_RE =
  /(?:^|\/)(sr|ara|arama|search|list|browse|kategori|category|marka|markalar|brand|butik|magaza|koleksiyon|koleksiyonlar|kampanya|kampanyalar|tum-urunler|indirimler|urunler|erkek-ayakkabi|kadin-ayakkabi|cocuk-ayakkabi|spor-ayakkabi|erkek-spor-ayakkabi|kadin-spor-ayakkabi)(?:\/|$)/i;

const LISTING_TITLE_RE =
  /\b(modelleri|cesitleri|fiyatlari|markalari\s*(?:ve|,|&)\s*fiyatlari|urunleri\s*(?:ve|,|&)\s*fiyatlari|en\s+ucuz\s+.+\s+fiyatlari|parfumeri|parfumleri|gomlekleri|ayakkabilari|tisortleri|elbiseleri|pantolonlari|ceketleri|cantalari|gozlukleri|saatleri|telefonlari|bilgisayarlari)\b/i;

const SEARCH_QUERY_PARAMS = ["q", "query", "search", "search_text", "arama", "keyword", "k", "s", "ft"];

function normalizeUrlForMatch(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.hostname.replace(/^www\.|^m\./i, "").toLowerCase()}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return String(urlStr || "").toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * Classifies a Turkish e-commerce URL as either a direct single-product page (`isProductPage: true`)
 * or a category / search / brand listing page (`isListingPage: true`), and extracts a canonical
 * store-scoped productId when present.
 */
export function classifyStoreUrl(urlStr, title = "") {
  if (!urlStr || typeof urlStr !== "string") {
    return { isProductPage: false, isListingPage: false, productId: null, slug: "" };
  }

  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return { isProductPage: false, isListingPage: false, productId: null, slug: "" };
  }

  const host = u.hostname.replace(/^www\.|^m\./i, "").toLowerCase();
  const pathname = u.pathname || "/";
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    decodedPath = pathname;
  }
  const slug = decodedPath.replace(/[-_/]+/g, " ").trim();

  // 1. Trendyol: direct products ALWAYS contain -p-<digits>
  if (host === "trendyol.com" || host.endsWith(".trendyol.com")) {
    const m = pathname.match(/-p-(\d+)(?:\/|$)/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `ty:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 2. Hepsiburada: direct products ALWAYS contain -p-<id> or -pm-<id>
  if (host === "hepsiburada.com" || host.endsWith(".hepsiburada.com")) {
    const m = pathname.match(/-pm?-([a-z0-9]+)(?:\/|$)/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `hb:${m[1].toLowerCase()}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 3. Amazon TR: /dp/<ASIN> or /gp/product/<ASIN>
  if (host === "amazon.com.tr" || host.endsWith(".amazon.com.tr")) {
    const m = pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `amz:${m[1].toLowerCase()}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 4. n11: /urun/...
  if (host === "n11.com" || host.endsWith(".n11.com")) {
    if (/\/urun\//i.test(pathname)) {
      const m = pathname.match(/-(\d{5,})(?:\/|$)/);
      return { isProductPage: true, isListingPage: false, productId: m ? `n11:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 5. Zara: -p<digits>.html = product; -l<digits>.html = category listing
  if (host === "zara.com" || host.endsWith(".zara.com")) {
    const m = pathname.match(/-p(\d{5,})\.html/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `zara:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 6. Stradivarius / Pull&Bear / Massimo Dutti / Oysho: -l<6+ digits> or -c<id>p<id> or ?pe=<id>
  if (/(?:^|\.)(stradivarius|pullandbear|massimodutti|oysho)\.com$/.test(host)) {
    const mL = pathname.match(/-l(\d{6,})(?:\.html|\/|$)/i);
    const mCP = pathname.match(/-c\d*p(\d{5,})(?:\.html|\/|$)/i);
    const pe = u.searchParams.get("pe");
    if (mL || mCP || (pe && /^\d{5,}$/.test(pe))) {
      const pid = mL?.[1] || mCP?.[1] || pe;
      return { isProductPage: true, isListingPage: false, productId: `ind:${pid}`, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 7. Bershka: -c0p<digits>.html or -p<digits>.html
  if (host === "bershka.com" || host.endsWith(".bershka.com")) {
    const m = pathname.match(/-(?:c\d*)?p(\d{5,})\.html/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `ind:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 8. Akakçe & Cimri
  if (host === "akakce.com" || host.endsWith(".akakce.com")) {
    const m = pathname.match(/fiyati,(\d+)\.html/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `akakce:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "cimri.com" || host.endsWith(".cimri.com")) {
    const m = pathname.match(/,a?(\d+)$/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `cimri:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 9. Major TR marketplaces with deterministic -p-<id> product URLs
  if (/(?:^|\.)(pazarama\.com|idefix\.com|boyner\.com\.tr|pttavm\.com|teknosa\.com|migros\.com\.tr|gratis\.com|watsons\.com\.tr)$/.test(host)) {
    const m = pathname.match(/-p-([a-z0-9]+)(?:\/|$)/i) || pathname.match(/\/p\/([^/]+)/i);
    if (m) {
      const prefix = host.split(".")[0];
      return { isProductPage: true, isListingPage: false, productId: `${prefix}:${m[1].toLowerCase()}`, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 10. MediaMarkt / Sephora / Mango / H&M / Çiçeksepeti / LCW / Beymen
  if (host === "mediamarkt.com.tr" || host.endsWith(".mediamarkt.com.tr")) {
    if (/\/product\//i.test(pathname)) {
      const m = pathname.match(/-(\d{6,})\.html/i);
      return { isProductPage: true, isListingPage: false, productId: m ? `mm:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "ciceksepeti.com" || host.endsWith(".ciceksepeti.com")) {
    const m = pathname.match(/-(kcm?\d+)(?:\/|$)/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `cs:${m[1].toLowerCase()}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "sephora.com.tr" || host.endsWith(".sephora.com.tr") || host === "mango.com" || host.endsWith(".mango.com")) {
    if (/\/p\//i.test(pathname)) return { isProductPage: true, isListingPage: false, productId: null, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "hm.com" || host.endsWith(".hm.com")) {
    const m = pathname.match(/productpage\.(\d+)\.html/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `hm:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "lcw.com" || host === "lcwaikiki.com" || host.endsWith(".lcw.com") || host.endsWith(".lcwaikiki.com")) {
    const m = pathname.match(/-o-(\d+)/i);
    if (m || /\/urun\//i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `lcw:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "beymen.com" || host.endsWith(".beymen.com")) {
    const m = pathname.match(/(?:\/p_|_)(\d{5,})(?:\/|$)/i);
    if (m || /\/p_/i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `beymen:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 10b. Second-hand marketplaces (Dolap, Gardrops, sahibinden)
  if (host === "dolap.com" || host.endsWith(".dolap.com")) {
    const m = pathname.match(/\/urun\/[^/]+-(\d{5,})(?:\/|$)/i);
    if (m || /\/urun\//i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `dolap:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "gardrops.com" || host.endsWith(".gardrops.com")) {
    const m = pathname.match(/-(\d{6,})(?:\/|$)/i);
    if (m && !LISTING_PATH_RE.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: `gardrops:${m[1]}`, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "sahibinden.com" || host.endsWith(".sahibinden.com")) {
    const m = pathname.match(/\/ilan\/[^/]+-(\d{7,})\/detay/i) || pathname.match(/\/ilan\/[^/]+-(\d{7,})/i);
    if (m || /\/ilan\//i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `shb:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 10c. Major shoe / sportswear / fashion / tech TR stores with distinct product vs category URLs
  if (host === "adidas.com.tr" || host.endsWith(".adidas.com.tr")) {
    const m = pathname.match(/\/([A-Z0-9]{5,8})\.html$/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `adidas:${m[1].toLowerCase()}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "nike.com" || host.endsWith(".nike.com")) {
    const m = pathname.match(/\/t\/[^/]+\/([A-Z0-9-]{6,})(?:\/|$)/i);
    if (m || /\/t\//i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `nike:${m[1].toLowerCase()}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "puma.com" || host.endsWith(".puma.com")) {
    const m = pathname.match(/\/pd\/[^/]+\/(\d{6,})/i) || pathname.match(/-(\d{6,})(?:\/|$)/);
    if (m || /\/pd\//i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `puma:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "flo.com.tr" || host.endsWith(".flo.com.tr")) {
    const m = pathname.match(/\/urun\/[^/]+-(\d{6,})(?:\/|$)/i) || pathname.match(/-(\d{7,})(?:\/|$)/);
    if (m || /\/urun\//i.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: m ? `flo:${m[1]}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (
    /(?:^|\.)(superstep\.com\.tr|fashfed\.com|intersport\.com\.tr|barcin\.com|sportive\.com\.tr|sporjinal\.com|sneaksup\.com|korayspor\.com|koton\.com|tefal\.com\.tr|lacoste\.com\.tr|converse\.com\.tr)$/.test(
      host
    )
  ) {
    if (LISTING_PATH_RE.test(pathname)) {
      return { isProductPage: false, isListingPage: true, productId: null, slug };
    }
    const mSku = pathname.match(/\/urun\/.+?\/([a-z0-9-]{4,})\/?$/i) || pathname.match(/-([a-z]{1,4}\d{3,}[a-z0-9-]*|\d{5,})\/?$/i);
    if (/\/urun\//i.test(pathname) || mSku) {
      return { isProductPage: true, isListingPage: false, productId: mSku ? `${host.split(".")[0]}:${mSku[1].toLowerCase()}` : null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "decathlon.com.tr" || host.endsWith(".decathlon.com.tr")) {
    if (/\/p\//i.test(pathname)) return { isProductPage: true, isListingPage: false, productId: null, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "dr.com.tr" || host.endsWith(".dr.com.tr")) {
    const m = pathname.match(/urunno=(\d+)/i);
    if (m) return { isProductPage: true, isListingPage: false, productId: `dr:${m[1]}`, slug };
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }
  if (host === "vatanbilgisayar.com" || host.endsWith(".vatanbilgisayar.com")) {
    if (/\.html$/i.test(pathname) && !LISTING_PATH_RE.test(pathname)) {
      return { isProductPage: true, isListingPage: false, productId: null, slug };
    }
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // 11. Universal fallback checks for other stores
  const hasSearchQueryParam = SEARCH_QUERY_PARAMS.some((k) => u.searchParams.has(k));
  if (hasSearchQueryParam || LISTING_PATH_RE.test(pathname)) {
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // Check if the URL clearly carries a generic product pattern (-p-<id>, /urun/, /product/)
  const genericProd = pathname.match(/-p-([a-z0-9]+)(?:\/|$)/i);
  if (genericProd) {
    return { isProductPage: true, isListingPage: false, productId: `${host}:${genericProd[1].toLowerCase()}`, slug };
  }
  if (/\/(urun|product|p)\//i.test(pathname)) {
    return { isProductPage: true, isListingPage: false, productId: null, slug };
  }

  // Plural category titles on ambiguous URLs indicate a category/listing page
  const asciiTitle = transliterateTr(title).toLowerCase();
  if (asciiTitle && LISTING_TITLE_RE.test(asciiTitle)) {
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // Root / homepage URLs are never single products
  const segments = pathname.split("/").filter(Boolean);
  if (pathname === "/" || segments.length === 0) {
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  // Unknown store URLs without an explicit product path or product ID/SKU in the final segment
  // (e.g. /adidas-erkek-ayakkabi or /erkek/spor-ayakkabi) are category/listing pages, not direct products!
  const lastSeg = segments[segments.length - 1] || "";
  const hasExplicitProductSignal =
    /\.html$/i.test(lastSeg) ||
    /(?:^|[-_])([a-z]{1,4}\d{3,}|\d{5,})(?:$|[-_])/i.test(lastSeg) ||
    u.searchParams.has("productId") ||
    u.searchParams.has("urunId");
  if (!hasExplicitProductSignal) {
    return { isProductPage: false, isListingPage: true, productId: null, slug };
  }

  return { isProductPage: true, isListingPage: false, productId: null, slug };
}

/**
 * Checks whether a listing belongs to a Turkish second-hand / tagged resale platform
 * (Dolap, Gardrops, sahibinden, Letgo, ModaCruz) or explicitly states 2nd-hand condition.
 */
export function isSecondHandOffer(urlStr, title = "") {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\.|^m\./i, "").toLowerCase();
    if (SECOND_HAND_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
      return true;
    }
  } catch {
    // Ignore invalid URL
  }
  const norm = transliterateTr(String(title || "")).toLowerCase();
  return /\b(2\.\s*el|ikinci\s+el|yenilenmis|refurbished|az\s+kullanilmis|kullanilmis)\b/i.test(norm);
}

/**
 * Detects condition label for second-hand / tagged resale listings.
 */
export function detectSecondHandCondition(title = "", snippet = "") {
  const norm = transliterateTr(`${title} ${snippet}`).toLowerCase();
  if (/\b(yeni\s*(ve|&)?\s*etiketli|sifir\s*etiketli|etiketli|hic\s+kullanilmadi|kullanilmamis|etiketi\s+uzerinde)\b/i.test(norm)) {
    return "Yeni & Etiketli";
  }
  if (/\b(az\s+kullanilmis|1\s*kez|bir\s*kez|tertemiz|sifir\s+ayarinda|yeni\s+gibi)\b/i.test(norm)) {
    return "Az Kullanılmış";
  }
  if (/\b(yenilenmis|refurbished)\b/i.test(norm)) {
    return "Yenilenmiş";
  }
  return "2. El";
}

/**
 * Extracts live TL cash price & shipping cues from Google Turkey organic/rich result objects.
 * Strict protections:
 * - Rejects category/search/listing pages so misleading category minimums ("552 TL'den başlayan") never appear as product prices
 * - Never returns a single monthly installment amount ("3 taksit 552 TL", "ayda 552 TL", "₺552 x 6") as a cash price
 * - Computes interest-free total ONLY when explicitly "peşin fiyatına / vadesiz / faizsiz" (or unambiguous N x amount without interest)
 * - Avoids shipping thresholds ("500 TL ve üzeri kargo bedava"), shipping fees ("+44,99 TL kargo"), coupons, and wide price ranges
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

  // 2. If link is a category / search / brand listing page, do NOT treat snippet/range numbers as a product price!
  if (item?.link && classifyStoreUrl(item.link, title).isListingPage) {
    return { price: null, shipping, source: "listing" };
  }

  // 2b. If link is a price-comparison aggregator (Cimri, Epey, Akakçe), NEVER trust stale Google SERP snippet prices!
  if (item?.link && isPriceAggregatorUrl(item.link)) {
    return { price: null, shipping, source: "aggregator" };
  }

  // 2c. If we live-verified the exact checkout price directly from the store page right now, trust it 100%!
  if (typeof item?._liveVerifiedPrice === "number" && item._liveVerifiedPrice >= 10) {
    return {
      price: Math.round(item._liveVerifiedPrice * 100) / 100,
      shipping,
      source: "live_verified",
    };
  }

  const asciiCombined = transliterateTr(combinedText);
  const installmentTotals = [];
  const installmentUnitValues = [];

  const isInterestFreeContext = (ctx) =>
    /(pesin\s+fiyatina|vadesiz|faizsiz)/i.test(ctx) && !/(vade\s+fark|faizli)/i.test(ctx);

  // Pre-scan explicit installment expressions to collect monthly unit values (to block false rich prices)
  // and compute interest-free cash totals when explicitly "peşin fiyatına / vadesiz / faizsiz"
  const instPatterns = [
    // "3x 596,67 TL" or "3 x ₺596,67"
    {
      re: /(\d{1,2})\s*[x×]\s*(?:₺|TRY)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)?/gi,
      mulIdx: 1,
      valIdx: 2,
    },
    // "552 TL x 3" or "₺552 x 6 taksit"
    {
      re: /(?:₺|TRY)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)?\s*[x×]\s*(\d{1,2})\s*(?:taksit|ay)?/gi,
      mulIdx: 2,
      valIdx: 1,
    },
    // "3 taksit 552,00 TL" or "3 taksitle ₺552"
    {
      re: /(\d{1,2})\s*(?:ay\s*)?taksit(?:le|li|e)?\s*(?:[:x×-]?\s*)?(?:ayda\s*)?(?:₺|TRY)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)/gi,
      mulIdx: 1,
      valIdx: 2,
    },
  ];

  for (const { re, mulIdx, valIdx } of instPatterns) {
    for (const m of asciiCombined.matchAll(re)) {
      // Must actually carry a currency marker near the match so "3 x 200 ml" is never treated as money!
      const localWindow = asciiCombined.slice(
        Math.max(0, (m.index || 0) - 45),
        Math.min(asciiCombined.length, (m.index || 0) + m[0].length + 25)
      );
      if (!/(?:TL|₺|TRY)/i.test(m[0]) && !/taksit/i.test(localWindow)) continue;
      if (/\b(ml|gr|kg|lt|cm|mm|gb|tb|adet)\b/i.test(m[0])) continue;

      const mul = Number.parseInt(m[mulIdx], 10);
      const val = parseTrPrice(m[valIdx]);
      if (!val || val < 10 || mul < 2 || mul > 12) continue;

      installmentUnitValues.push(val);
      if (isInterestFreeContext(localWindow)) {
        installmentTotals.push(Math.round(val * mul * 100) / 100);
      }
    }
  }

  // Also catch bare monthly installment mentions ("ayda 552 TL", "aylık ₺552", "552 TL / ay", "552 TL taksit")
  for (const m of asciiCombined.matchAll(/(?:ayda|aylik|her\s+ay)\s*(?:₺|TRY)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)?/gi)) {
    const val = parseTrPrice(m[1]);
    if (val && val >= 10) installmentUnitValues.push(val);
  }
  for (const m of asciiCombined.matchAll(/(?:₺|TRY)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)\s*(?:\/?\s*ay\b|aylik\b|taksit)/gi)) {
    const val = parseTrPrice(m[1]);
    if (val && val >= 10) installmentUnitValues.push(val);
  }

  const looksLikeInstallmentUnit = (candidateVal) =>
    installmentUnitValues.some((u) => Math.abs(u - candidateVal) <= 0.5);

  // 3. Check structured rich fields first (Google rich product schema parsed by Serper/SerpAPI)
  const currencyRaw = String(item?.currency || "").toUpperCase();
  const isForeignCurrency =
    currencyRaw && !["TRY", "TL", "₺"].includes(currencyRaw) && /USD|\$|EUR|€|GBP|£/.test(currencyRaw);

  if (!isForeignCurrency) {
    let richPrice = null;
    if (typeof item?.price === "number" && item.price >= 10) {
      richPrice = Math.round(item.price * 100) / 100;
    } else if (typeof item?.price === "string" && item.price.trim()) {
      const p = parseTrPrice(item.price);
      if (p && p >= 10) richPrice = p;
    }
    if (richPrice !== null && !looksLikeInstallmentUnit(richPrice)) {
      return { price: richPrice, shipping, source: "rich" };
    }

    if (typeof item?.priceRange === "string" && item.priceRange.trim()) {
      // Reject wide multi-product price ranges (e.g. "₺552 - ₺3.499") — keep only single or tight ranges
      const nums = [...item.priceRange.matchAll(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g)]
        .map((x) => parseTrPrice(x[1]))
        .filter((n) => typeof n === "number" && n >= 10);
      if (nums.length === 1 && !looksLikeInstallmentUnit(nums[0])) {
        return { price: nums[0], shipping, source: "range" };
      }
      if (nums.length >= 2) {
        const low = Math.min(...nums);
        const high = Math.max(...nums);
        if (low > 0 && high <= low * 1.15 && !looksLikeInstallmentUnit(low)) {
          return { price: low, shipping, source: "range" };
        }
      }
    }
  }

  // 4. Unified context-aware scanner for BOTH "1.990,00 TL" and "₺1.990,00" / "TRY 1,990.00"
  const directCandidates = [];

  const isDisqualifiedByContext = (beforeRaw, afterRaw) => {
    const before = transliterateTr(beforeRaw).toLowerCase();
    const after = transliterateTr(afterRaw).toLowerCase();

    // Historical / dated / aggregator summary prices (e.g. "20.11.2026 tarihinde 1.399,00 TL", "12 satıcı arasındaki en ucuz")
    if (/(tarihinde|tarihli|satici\s+arasindaki|son\s+\d+\s+(?:ayin|gunun|haftanin)|en\s+dusuk\s+fiyati?|en\s+yuksek\s+fiyati?|eski\s+fiyati?)\s*[:,-]?\s*$/i.test(before)) {
      return true;
    }
    if (/^\s*(?:idi|oldu|seviyesinde|tarihinde|ile\s+son\s+\d+)/i.test(after)) {
      return true;
    }

    // Installment cues before or after the number (regardless of price magnitude!)
    if (/(\d{1,2}\s*[x×]\s*$|\btaksit(?:le|li|i|e|ten|ler)?\s*[:x×-]?\s*$|\bayda\s*$|\baylik\s*$|\bher\s+ay\s*$|\d{1,2}\s*ay\s*[:x×-]?\s*$)/i.test(before)) {
      return true;
    }
    if (/^\s*(?:[x×]\s*\d{1,2}\b|\/?\s*ay\b|aylik\b|taksit|['’]?lik\s+taksit|['’]?(?:den|dan|ten|tan)\s+baslayan\s+taksit)/i.test(after)) {
      return true;
    }

    // Shipping fees/thresholds, coupons, discounts, points, bonuses, minimum basket
    if (/^\s*(?:ve\s+)?(kargo|uzeri|uzerine|ustu|ustune|alti|altinda|indirim|kupon|puan|hediye|cashback|kazan|tasarruf|bonus|chip|iade|alisveris|sepet|komisyon|degerinde)\b/i.test(after)) {
      return true;
    }
    if (/^\s*['’]?(?:ye|ya|e|a)\s+varan\b/i.test(after)) return true;
    if (/^\s*['’]?(?:den|dan|ten|tan)\s+baslayan\b/i.test(after)) return true;
    if (/^\s*['’]?(?:lik|luk)\s+(?:alisveris|kupon|indirim|hediye|puan|taksit)\b/i.test(after)) return true;

    // Price range ("552 TL - 2.499 TL" or "552 TL ile 2.499 TL")
    if (/^\s*(?:-|–|ile)\s*(?:₺|TRY)?\s*\d/i.test(after)) return true;
    if (/\d\s*(?:tl|₺|try)\s*(?:-|–|ile)\s*$/i.test(before)) return true;

    if (/(kargo|kupon|indirim|puan|hediye|bonus|kazan|tasarruf|iade|en\s+az|minimum|min\.?|alt\s+limit|sepet\s+alt|uzeri|ustu)\s*[:+]?\s*$/i.test(before)) {
      return true;
    }

    return false;
  };

  // Pattern A: number followed by "TL / ₺ / TRY"
  const afterRe = /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:TL|₺|TRY)(?![a-zA-ZğüşıöçĞÜŞİÖÇ])/gi;
  for (const m of combinedText.matchAll(afterRe)) {
    const val = parseTrPrice(m[1]);
    if (!val || val < 10) continue;
    const beforeCtx = combinedText.slice(Math.max(0, (m.index || 0) - 48), m.index || 0);
    const afterCtx = combinedText.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 36);
    if (isDisqualifiedByContext(beforeCtx, afterCtx)) continue;
    if (looksLikeInstallmentUnit(val)) continue;
    directCandidates.push(val);
  }

  // Pattern B: "₺1.990,00" or "TRY 54,999.00" (now with identical strict context filtering!)
  const beforeRe = /(?:₺|TRY)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  for (const m of combinedText.matchAll(beforeRe)) {
    const val = parseTrPrice(m[1]);
    if (!val || val < 10) continue;
    const beforeCtx = combinedText.slice(Math.max(0, (m.index || 0) - 48), m.index || 0);
    const afterCtx = combinedText.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 36);
    if (isDisqualifiedByContext(beforeCtx, afterCtx)) continue;
    if (looksLikeInstallmentUnit(val)) continue;
    directCandidates.push(val);
  }

  if (directCandidates.length > 0) {
    return { price: directCandidates[0], shipping, source: "snippet" };
  }
  if (installmentTotals.length > 0) {
    return { price: installmentTotals[0], shipping, source: "installment" };
  }

  return { price: null, shipping, source: "none" };
}

// Image, OG-image & live checkout price verification caches (10-30 min TTL)
const imageCache = new Map();
const ogImageCache = new Map();
const livePriceCache = new Map();

function getCachedImages(qKey) {
  const entry = imageCache.get(qKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    imageCache.delete(qKey);
    return null;
  }
  return entry.images;
}

function setCachedImages(qKey, images) {
  if (imageCache.size > 200) {
    imageCache.delete(imageCache.keys().next().value);
  }
  imageCache.set(qKey, { images, expiresAt: Date.now() + 15 * 60 * 1000 });
}

// Stores whose product pages respond cleanly to fast lightweight og:image & live checkout price lookups
const FAST_OG_HOSTS = [
  "superstep.com.tr",
  "houseofsuperstep.com",
  "fashfed.com",
  "intersport.com.tr",
  "barcin.com",
  "sportive.com.tr",
  "sporjinal.com",
  "koton.com",
  "tefal.com.tr",
  "lacoste.com.tr",
  "converse.com.tr",
  "occasion.com.tr",
  "underarmour.com.tr",
  "marksandspencer.com.tr",
  "gap.com.tr",
  "gant.com.tr",
  "nautica-tr.com",
  "gratis.com",
  "gaming.gen.tr",
  "beymen.com",
  "dr.com.tr",
  "migros.com.tr",
  "idefix.com",
  "pazarama.com",
];

export function isFastOgHost(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\.|^m\./i, "").toLowerCase();
    return FAST_OG_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Live-verifies the actual current checkout price, rating, barcode/SKU & og:image directly
 * from a Turkish store's product page (JSON-LD Product/Offer.price + product:price:amount meta tags),
 * eliminating stale Google SERP snippet price mismatches.
 */
export async function fetchLiveProductPrice(urlStr) {
  if (!urlStr || !isFastOgHost(urlStr)) return null;
  const cached = livePriceCache.get(urlStr);
  if (cached && Date.now() <= cached.expiresAt) return cached.data;

  try {
    const res = await fetch(urlStr, {
      headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", Accept: "text/html" },
      signal: AbortSignal.timeout(2500),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (/Just a moment|cf-browser-verification|challenge-platform/i.test(html)) return null;

    let livePrice = null;
    let inStock = true;
    let ogImg = "";
    let rating = null;
    let barcode = "";
    let sku = "";

    // 1. JSON-LD Product / Offer schema (most accurate live checkout price across Turkish retailers)
    const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of ldMatches) {
      try {
        const parsed = JSON.parse(m[1]);
        const nodes = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const offersRaw = node.offers;
          if (offersRaw) {
            const offerList = Array.isArray(offersRaw) ? offersRaw : [offersRaw];
            for (const off of offerList) {
              const rawP = off?.price ?? off?.lowPrice;
              const parsedP = typeof rawP === "number" ? rawP : parseTrPrice(String(rawP || ""));
              if (parsedP && parsedP >= 10 && (livePrice === null || parsedP < livePrice)) {
                livePrice = Math.round(parsedP * 100) / 100;
              }
              if (typeof off?.availability === "string" && /OutOfStock/i.test(off.availability)) {
                inStock = false;
              }
            }
          }
          if (!rating && node.aggregateRating && typeof node.aggregateRating === "object") {
            const rv = Number.parseFloat(String(node.aggregateRating.ratingValue || "").replace(",", "."));
            const rc = Number.parseInt(String(node.aggregateRating.reviewCount ?? node.aggregateRating.ratingCount ?? "0"), 10);
            if (Number.isFinite(rv) && rv > 0 && rv <= 5) {
              rating = {
                value: Math.round(rv * 10) / 10,
                count: Number.isFinite(rc) && rc > 0 ? rc : null,
              };
            }
          }
          if (!barcode) {
            const rawGtin = String(node.gtin13 || node.gtin14 || node.gtin12 || node.gtin || node.ean || "").replace(/\D/g, "");
            if (rawGtin.length >= 8 && rawGtin.length <= 14) barcode = rawGtin;
          }
          if (!sku && (node.sku || node.mpn)) {
            sku = String(node.sku || node.mpn).trim();
          }
          if (!ogImg && typeof node.image === "string" && /^https?:\/\//i.test(node.image)) {
            ogImg = node.image;
          } else if (!ogImg && Array.isArray(node.image) && typeof node.image[0] === "string") {
            ogImg = node.image[0];
          }
        }
      } catch {
        // Ignore malformed LD+JSON blocks
      }
    }

    // 2. Fallback to product:price:amount / og:price:amount / itemprop="price" meta tags
    if (livePrice === null) {
      const metaMatch =
        html.match(/property=["'](?:product|og):price:amount["'][^>]*content=["']([^"']+)["']/i) ||
        html.match(/content=["']([^"']+)["'][^>]*property=["'](?:product|og):price:amount["']/i) ||
        html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
      if (metaMatch?.[1]) {
        const p = parseTrPrice(metaMatch[1]);
        if (p && p >= 10) livePrice = Math.round(p * 100) / 100;
      }
    }

    // 3. Extract og:image if not found in JSON-LD
    if (!ogImg) {
      const ogMatch =
        html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
      ogImg = ogMatch?.[1]?.trim() || "";
      if (ogImg.startsWith("//")) ogImg = `https:${ogImg}`;
      if (!/^https?:\/\//i.test(ogImg) || /favicon|logo|placeholder/i.test(ogImg)) ogImg = "";
    }

    const result = { price: livePrice, inStock, image: ogImg, rating, barcode, sku };
    if (livePriceCache.size > 300) {
      livePriceCache.delete(livePriceCache.keys().next().value);
    }
    livePriceCache.set(urlStr, { data: result, expiresAt: Date.now() + 10 * 60 * 1000 });
    return result;
  } catch {
    return null;
  }
}

async function fetchProductOgImage(urlStr) {
  if (!urlStr || !isFastOgHost(urlStr)) return "";
  const cached = ogImageCache.get(urlStr);
  if (cached && Date.now() <= cached.expiresAt) return cached.image;

  try {
    const res = await fetch(urlStr, {
      headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(2200),
      redirect: "follow",
    });
    if (!res.ok) return "";
    const html = (await res.text()).slice(0, 45000);
    const ogMatch =
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    let img = ogMatch?.[1]?.trim() || "";
    if (img.startsWith("//")) img = `https:${img}`;
    if (!/^https?:\/\//i.test(img) || /favicon|logo|placeholder/i.test(img)) img = "";
    if (ogImageCache.size > 300) {
      ogImageCache.delete(ogImageCache.keys().next().value);
    }
    ogImageCache.set(urlStr, { image: img, expiresAt: Date.now() + 30 * 60 * 1000 });
    return img;
  } catch {
    return "";
  }
}

function isUsableDirectPhoto(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return false;
  const s = urlStr.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/google\.com\/s2\/favicons|favicon\.ico/i.test(s)) return false;
  return true;
}

function detectExplicitImageColor(im) {
  if (!im) return null;
  const fromTitle = extractColorFromText(im.title || "");
  if (fromTitle) return fromTitle;
  if (im.link) {
    try {
      const u = new URL(im.link);
      const fromLink = extractColorFromText(decodeURIComponent(u.pathname));
      if (fromLink) return fromLink;
    } catch {
      // Ignore malformed link
    }
  }
  if (im.imageUrl) {
    try {
      const u = new URL(im.imageUrl);
      const fromUrl = extractColorFromText(decodeURIComponent(u.pathname));
      if (fromUrl) return fromUrl;
    } catch {
      // Ignore
    }
  }
  return null;
}

function buildColorImageQuery(baseQuery, color) {
  const existingColor = extractColorFromText(baseQuery);
  let cleaned = String(baseQuery || "").trim();
  if (existingColor && !areColorsCompatible(existingColor, color)) {
    const colorAscii = transliterateTr(existingColor).toLowerCase();
    cleaned = cleaned
      .split(/\s+/)
      .filter((w) => transliterateTr(w).toLowerCase() !== colorAscii)
      .join(" ")
      .trim();
  }
  const colorLower = transliterateTr(color).toLowerCase();
  if (transliterateTr(cleaned).toLowerCase().includes(colorLower)) {
    return cleaned;
  }
  return `${cleaned} ${color}`.trim();
}

/**
 * Provider 1: Serper.dev Google Türkiye Search Engine (v3)
 * - Uses num: 10 (Google's post-2025 reliable page size — prevents intermittent empty SERP pages)
 * - Automatic retry with clean query & ASCII-transliterated Turkish fallback
 * - Strictly separates direct product pages from category/search listing pages
 * - Automatically targets direct product URLs (-p-, /dp/, /urun/, fiyati,) when Query 1 returns category pages
 * - Color-aware & product-ID-aware image enrichment so Siyah/Beyaz/Yeşil variants show their own true photos
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
        throw new Error("Arama servisi geçici olarak yanıt veremedi; canlı mağaza ağıyla devam ediliyor.");
      }
      throw new Error(`Serper API yanıt hatası (HTTP ${res.status}): ${errTxt.slice(0, 120)}`);
    }
    return res.json();
  };

  // Query 1: Clean Turkish price query with reliable num: 10
  const q1 = /fiyat|tl\b/i.test(query) ? query : `${query} fiyat`;
  let data1 = await callSerper("search", {
    q: q1,
    gl: "tr",
    hl: "tr",
    num: 10,
  });

  let organic1 = Array.isArray(data1.organic) ? data1.organic : [];

  // Retry A: If Google returned an intermittent empty SERP, retry with clean query
  if (organic1.length === 0) {
    try {
      const retryA = await callSerper("search", { q: query, gl: "tr", hl: "tr", num: 10 });
      if (Array.isArray(retryA.organic) && retryA.organic.length > 0) {
        data1 = retryA;
        organic1 = retryA.organic;
      }
    } catch {
      // Continue to Retry B
    }
  }

  // Retry B: If still empty and query has Turkish diacritics, retry with ASCII-normalized query
  const asciiQuery = transliterateTr(query);
  if (organic1.length === 0 && asciiQuery.toLowerCase() !== query.toLowerCase()) {
    try {
      const retryB = await callSerper("search", {
        q: `${asciiQuery} fiyat`,
        gl: "tr",
        hl: "tr",
        num: 10,
      });
      if (Array.isArray(retryB.organic) && retryB.organic.length > 0) {
        data1 = retryB;
        organic1 = retryB.organic;
      }
    } catch {
      // Non-fatal
    }
  }

  let combinedOrganic = [...organic1];
  const extraInlineImages = Array.isArray(data1.images) ? [...data1.images] : [];

  // Count how many DIRECT (non-listing, non-aggregator, non-accessory) priced product pages came back from Query 1
  const directPricedCount1 = organic1.filter((it) => {
    if (!it?.link || isNonShoppingUrl(it.link) || isPriceAggregatorUrl(it.link)) return false;
    if (classifyStoreUrl(it.link, it.title).isListingPage) return false;
    if (isAccessoryTitle(it.title, query)) return false;
    return extractOrganicPriceInfo(it).price !== null;
  }).length;

  // Query 2 (when < 5 direct priced product pages): explicitly target REAL DIRECT STORE PRODUCT URLs
  // (never price-comparison aggregators like Cimri/Epey/Akakçe!)
  if (directPricedCount1 < 5) {
    try {
      const qTarget = asciiQuery !== query && organic1.length === 0 ? asciiQuery : query;
      const data2 = await callSerper("search", {
        q: `${qTarget} fiyat (inurl:-p- OR inurl:/dp/ OR inurl:/urun/ OR inurl:/p_)`,
        gl: "tr",
        hl: "tr",
        num: 10,
      });
      if (Array.isArray(data2.organic) && data2.organic.length > 0) {
        combinedOrganic.push(...data2.organic);
      }
      if (Array.isArray(data2.images)) {
        extraInlineImages.push(...data2.images);
      }
    } catch {
      // Non-fatal
    }
  }

  // Live-verify actual checkout prices (and og:image) directly from open Turkish store pages
  // so stale Google SERP snippet prices are overwritten with real-time checkout prices!
  const liveVerifyCandidates = combinedOrganic
    .filter(
      (it) =>
        it?.link &&
        !isNonShoppingUrl(it.link) &&
        !isPriceAggregatorUrl(it.link) &&
        !classifyStoreUrl(it.link, it.title).isListingPage &&
        isFastOgHost(it.link)
    )
    .slice(0, 8);
  if (liveVerifyCandidates.length > 0) {
    await Promise.all(
      liveVerifyCandidates.map(async (it) => {
        const live = await fetchLiveProductPrice(it.link);
        if (!live) return;
        if (typeof live.price === "number" && live.price >= 10) {
          it._liveVerifiedPrice = live.price;
        }
        if (live.inStock === false) {
          it._liveOutOfStock = true;
        }
        if (live.image && !isUsableDirectPhoto(it.imageUrl)) {
          it.imageUrl = live.image;
        }
      })
    );
  }

  // Enrich with real product images + color-specific images for distinct variant colors!
  let imagePool = [...extraInlineImages];
  const nonListingNeedsPhoto = combinedOrganic.filter(
    (it) =>
      it?.link &&
      !isNonShoppingUrl(it.link) &&
      !isPriceAggregatorUrl(it.link) &&
      !classifyStoreUrl(it.link, it.title).isListingPage &&
      !isUsableDirectPhoto(it.imageUrl) &&
      !isUsableDirectPhoto(it.thumbnailUrl)
  );

  const fetchSerperImagesCached = async (imgQuery, hintColor = null) => {
    const imgKey = imgQuery.toLocaleLowerCase("tr-TR");
    const cachedImgs = getCachedImages(imgKey);
    let list = cachedImgs;
    if (!list) {
      try {
        const imgData = await callSerper("images", { q: imgQuery, gl: "tr", hl: "tr", num: 10 });
        list = Array.isArray(imgData.images) ? imgData.images : [];
        if (list.length) setCachedImages(imgKey, list);
      } catch {
        list = [];
      }
    }
    return hintColor ? list.map((im) => ({ ...im, _hintColor: hintColor })) : list;
  };

  if (combinedOrganic.length > 0 && (nonListingNeedsPhoto.length > 0 || imagePool.length === 0)) {
    const baseImgs = await fetchSerperImagesCached(query, null);
    if (baseImgs.length) imagePool = [...imagePool, ...baseImgs];
  }

  // Color-aware image enrichment: if cards include distinct colors (e.g. Siyah, Beyaz, Yeşil)
  // that aren't well represented in imagePool yet, fetch targeted color photos in parallel!
  if (nonListingNeedsPhoto.length > 0) {
    const colorCounts = new Map();
    for (const it of nonListingNeedsPhoto) {
      const cls = classifyStoreUrl(it.link, it.title);
      const col = extractVariantAttributes(it.title, cls.slug).color;
      if (col) colorCounts.set(col, (colorCounts.get(col) || 0) + 1);
    }

    const colorsToEnrich = [];
    for (const [col] of [...colorCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const existingMatches = imagePool.filter((im) => {
        const expCol = detectExplicitImageColor(im);
        return expCol && areColorsCompatible(col, expCol);
      }).length;
      if (existingMatches < 2) {
        colorsToEnrich.push(col);
      }
      if (colorsToEnrich.length >= 4) break;
    }

    if (colorsToEnrich.length > 0) {
      const colorBatches = await Promise.all(
        colorsToEnrich.map((col) => fetchSerperImagesCached(buildColorImageQuery(query, col), col))
      );
      for (const batch of colorBatches) {
        if (batch.length) imagePool.push(...batch);
      }
    }

    // Fast og:image enrichment fallback for remaining open pages without photos
    const fastOgCandidates = nonListingNeedsPhoto.filter((it) => isFastOgHost(it.link) && !it.imageUrl).slice(0, 4);
    if (fastOgCandidates.length > 0) {
      await Promise.all(
        fastOgCandidates.map(async (it) => {
          const ogImg = await fetchProductOgImage(it.link);
          if (ogImg) it.imageUrl = ogImg;
        })
      );
    }
  }

  return buildTurkeySearchResponse(query, combinedOrganic, imagePool, "Google Türkiye (Serper)", "serper");
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
  const q1 = /fiyat|tl\b/i.test(query) ? query : `${query} fiyat`;
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q1)}&gl=tr&hl=tr&num=10&api_key=${encodeURIComponent(apiKey)}`;
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

  const inlineImgs = (Array.isArray(data.inline_images) ? data.inline_images : []).map((im) => ({
    imageUrl: im.original || im.thumbnail,
    thumbnailUrl: im.thumbnail,
    title: im.title || "",
    link: im.source || "",
  }));

  return buildTurkeySearchResponse(query, organic, inlineImgs, "Google Türkiye (SerpAPI)", "serpapi");
}

const IMAGE_MATCH_STOPWORDS = new Set([
  "trendyol",
  "hepsiburada",
  "amazon",
  "n11",
  "akakce",
  "cimri",
  "pazarama",
  "idefix",
  "pttavm",
  "boyner",
  "mediamarkt",
  "teknosa",
  "vatan",
  "migros",
  "fiyat",
  "fiyati",
  "fiyatlari",
  "modelleri",
  "cesitleri",
  "online",
  "satis",
  "satin",
  "turkiye",
  "kargo",
  "bedava",
  "ucretsiz",
  "ucuz",
  "indirim",
  "kampanya",
  "urun",
  "urunleri",
  "com",
  "www",
  "html",
  "tr",
]);

function meaningfulTokens(str) {
  const out = new Set();
  for (const w of tokenize(transliterateTr(str))) {
    if (!IMAGE_MATCH_STOPWORDS.has(w) && !/^\d{5,}$/.test(w)) {
      out.add(w);
    }
  }
  return out;
}

/**
 * Selects the most accurate, color-faithful, non-duplicated product photo from an image pool.
 * Priority:
 * 1. Exact product URL match (+100) or exact store product ID match (+80)
 * 2. Strict color conflict rejection (never assigns a Black photo to a White/Green item!)
 * 3. Color match bonus (explicit +14, color-query hint +7)
 * 4. Meaningful product title + slug token overlap (extra weight on query-differentiating words)
 * 5. Small host tiebreaker (+1.5) & heavy reuse penalty (-10) so distinct products get distinct photos
 */
export function pickBestProductImage(itemMeta, imagePool, usedImages = null, query = "") {
  if (!Array.isArray(imagePool) || !imagePool.length) return "";

  const meta =
    typeof itemMeta === "string"
      ? { title: itemMeta, url: "", host: "", productId: null, color: extractColorFromText(itemMeta), slug: "" }
      : itemMeta || {};

  const itemNormUrl = meta.url ? normalizeUrlForMatch(meta.url) : "";
  const itemProductId = meta.productId || null;
  const itemColor = meta.color || extractVariantAttributes(meta.title || "", meta.slug || "").color;
  const itemTokens = meaningfulTokens(`${meta.title || ""} ${meta.slug || ""}`);
  const queryTokens = meaningfulTokens(query);
  const diffTokens = new Set([...itemTokens].filter((t) => !queryTokens.has(t)));

  let bestImg = "";
  let bestScore = -Infinity;

  for (const im of imagePool) {
    const candidateUrl = im?.thumbnailUrl || im?.imageUrl || "";
    if (!candidateUrl || candidateUrl.startsWith("data:") || !isUsableDirectPhoto(candidateUrl)) continue;

    const imNormUrl = im?.link ? normalizeUrlForMatch(im.link) : "";
    const imCls = im?.link ? classifyStoreUrl(im.link, im.title || "") : { productId: null, slug: "" };
    const exactUrlMatch = Boolean(itemNormUrl && imNormUrl && itemNormUrl === imNormUrl);
    const exactIdMatch = Boolean(itemProductId && imCls.productId && itemProductId === imCls.productId);
    const exactMatch = exactUrlMatch || exactIdMatch;

    const imExplicitColor = detectExplicitImageColor(im);
    const imHintColor = im?._hintColor || null;

    // HARD COLOR CONFLICT GUARD: Never show a Black photo on a White/Green product!
    if (itemColor && !exactMatch) {
      if (imExplicitColor && !areColorsCompatible(itemColor, imExplicitColor)) {
        continue;
      }
      if (imHintColor && !areColorsCompatible(itemColor, imHintColor)) {
        continue;
      }
    }

    let score = 0;
    if (exactUrlMatch) score += 100;
    else if (exactIdMatch) score += 80;

    if (itemColor) {
      if (imExplicitColor && areColorsCompatible(itemColor, imExplicitColor)) {
        score += 14;
      } else if (imHintColor && areColorsCompatible(itemColor, imHintColor)) {
        score += 7;
      } else if (!exactMatch) {
        score -= 5;
      }
    }

    const imTokens = meaningfulTokens(`${im?.title || ""} ${imCls.slug || ""}`);
    if (imTokens.size > 0 && itemTokens.size > 0) {
      score += overlapScore(itemTokens, imTokens) * 8;
      if (diffTokens.size > 0) {
        score += overlapScore(diffTokens, imTokens) * 6;
      }
    }

    // Small same-store tiebreaker (never allowed to overpower color or product match)
    if (meta.host && im?.link && String(im.link).toLowerCase().includes(meta.host)) {
      score += 1.5;
    }

    // Strongly prefer distinct unused photos across cards unless exact product URL/ID matches
    if (usedImages && usedImages.has(candidateUrl) && !exactMatch) {
      score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestImg = candidateUrl;
    }
  }

  const minThreshold = itemColor ? 4 : 1.5;
  if (bestImg && bestScore >= minThreshold) {
    if (usedImages) usedImages.add(bestImg);
    return bestImg;
  }

  // If the product has a specific color and NO compatible color photo was found,
  // NEVER fall back to a random/wrong-color image!
  if (itemColor) {
    return "";
  }

  // For uncolored products, pick the first unused generic image (not locked to a different color query)
  for (const im of imagePool) {
    if (im?._hintColor) continue;
    const candidateUrl = im?.thumbnailUrl || im?.imageUrl || "";
    if (!candidateUrl || candidateUrl.startsWith("data:") || !isUsableDirectPhoto(candidateUrl)) continue;
    if (usedImages && usedImages.has(candidateUrl)) continue;
    if (usedImages) usedImages.add(candidateUrl);
    return candidateUrl;
  }

  return "";
}

export function buildTurkeySearchResponse(query, rawOrganic, imagePoolInput, providerName, prefix) {
  const imagePool = Array.isArray(imagePoolInput) ? imagePoolInput : [];
  const defaultProductImage =
    imagePool.find((im) => !im?._hintColor && isUsableDirectPhoto(im?.thumbnailUrl || im?.imageUrl))?.thumbnailUrl ||
    imagePool.find((im) => !im?._hintColor && isUsableDirectPhoto(im?.imageUrl))?.imageUrl ||
    imagePool[0]?.thumbnailUrl ||
    imagePool[0]?.imageUrl ||
    "";
  const seenUrls = new Set();
  const usedImages = new Set();
  const pricedOffers = [];
  const catalogLinks = [];
  const products = [];

  for (const item of rawOrganic) {
    const link = item?.link;
    const title = String(item?.title || "").replace(/\s+/g, " ").trim();
    const normLink = normalizeUrlForMatch(link);
    if (!link || !title || seenUrls.has(normLink) || isNonShoppingUrl(link) || isPriceAggregatorUrl(link)) continue;
    seenUrls.add(normLink);

    const urlClass = classifyStoreUrl(link, title);
    const storeMeta = resolveStoreFromUrl(link, item.source || "");
    const store = parseStoreInfo(storeMeta.platform, "");
    const priceInfo = extractOrganicPriceInfo(item);
    const snippet = String(item.snippet || "").replace(/\s+/g, " ").trim();
    const delivery = parseDeliverySpeed(snippet);
    const isAccessory = isAccessoryTitle(title, query);
    const variantAttrs = extractVariantAttributes(title, urlClass.isListingPage ? "" : urlClass.slug);

    const idx = pricedOffers.length + catalogLinks.length + 1;
    const directImg = isUsableDirectPhoto(item.imageUrl)
      ? item.imageUrl
      : isUsableDirectPhoto(item.thumbnailUrl)
        ? item.thumbnailUrl
        : "";
    if (directImg) usedImages.add(directImg);

    const matchedPhoto =
      directImg ||
      pickBestProductImage(
        {
          title,
          url: link,
          host: storeMeta.host,
          productId: urlClass.productId,
          color: variantAttrs.color,
          slug: urlClass.isListingPage ? "" : urlClass.slug,
        },
        imagePool,
        usedImages,
        query
      );

    if (typeof item.rating === "number" && item.rating > 0) {
      store.sellerRating = Math.round(item.rating * 2 * 10) / 10;
      store.sellerReviews = item.ratingCount ? `${item.ratingCount} yorum` : "";
    }

    const vKey = `virtual:${prefix}:${encodeURIComponent(query)}:${idx}`;
    const sellerCountMatch = snippet.match(/(?:\+(\d+)\s*FİYAT|(\d+)\s*satıcı)/i);
    const offerCountHint = sellerCountMatch ? Number.parseInt(sellerCountMatch[1] || sellerCountMatch[2], 10) : 1;
    const isSecondHand = isSecondHandOffer(link, title);
    const secondHandCondition = isSecondHand ? detectSecondHandCondition(title, snippet) : null;
    const isLiveVerified = priceInfo.source === "live_verified";
    const outOfStock = Boolean(item._liveOutOfStock) || /tükendi|stokta yok/i.test(snippet);

    // Only direct single-product pages with a verified cash price become priced product offers!
    if (!urlClass.isListingPage && priceInfo.price !== null && priceInfo.price > 0) {
      const offer = {
        id: `${prefix}-${idx}`,
        offerTitle: title,
        basePrice: priceInfo.price,
        shipping: priceInfo.shipping,
        store,
        storeLogo: storeMeta.logoUrl,
        stockText: outOfStock ? "Stok kontrol edin" : isSecondHand ? secondHandCondition : "Stokta",
        inStock: !outOfStock,
        delivery,
        lastUpdated: isLiveVerified ? "Canlı Doğrulandı" : "Google İndeks (Değişebilir)",
        promoNote: isLiveVerified
          ? "Fiyat mağaza sayfasından anlık doğrulandı"
          : priceInfo.source === "installment"
            ? "Peşin fiyatına taksitten hesaplandı (toplam)"
            : "Google indeks fiyatı — mağaza sayfasında anlık değişebilir",
        priceSource: priceInfo.source,
        priceVerified: isLiveVerified,
        akakceBadge: "",
        url: link,
        isDirectLink: true,
        isProductPage: true,
        isListingPage: false,
        isSecondHand,
        secondHandCondition,
        isAccessory,
        image: matchedPhoto,
        variantAttrs,
      };
      pricedOffers.push(offer);

      const netEstimate = Math.round((priceInfo.price + priceInfo.shipping.cost) * 100) / 100;
      const unitInfo = extractUnitInfo(title, netEstimate);

      products.push({
        id: `${prefix}-${idx}`,
        title,
        url: vKey,
        externalUrl: link,
        image: matchedPhoto || storeMeta.logoUrl || (variantAttrs.color ? "" : defaultProductImage),
        lowestPrice: netEstimate,
        priceSource: priceInfo.source,
        priceVerified: isLiveVerified,
        offerCount: offerCountHint,
        badge: storeMeta.platform,
        source: storeMeta.platform,
        isOfficialStore: !isSecondHand && (store.isOfficialSeller || store.trustScore >= 0.92),
        isFreeShipping: Boolean(priceInfo.shipping?.isFree),
        isAccessory,
        isProductPage: true,
        isListingPage: false,
        isSecondHand,
        secondHandCondition,
        variantAttrs,
        unitInfo,
        _offer: offer,
      });
    } else {
      catalogLinks.push({
        id: `${prefix}-cat-${idx}`,
        title,
        url: link,
        store: storeMeta.platform,
        isOfficialStore: !isSecondHand && (store.isOfficialSeller || store.trustScore >= 0.92),
        isAccessory,
        isProductPage: urlClass.isProductPage,
        isListingPage: urlClass.isListingPage,
        isSecondHand,
        secondHandCondition,
        variantAttrs,
        logoUrl: storeMeta.logoUrl,
        image: matchedPhoto || storeMeta.logoUrl || (variantAttrs.color ? "" : defaultProductImage),
        snippet,
      });
    }
  }

  // Prefer brand-new, non-accessory offers for the main multi-store retail comparison
  const retailPrimaryOffers = pricedOffers.filter((o) => !o.isAccessory && !o.isSecondHand);
  const nonAccessoryOffers = pricedOffers.filter((o) => !o.isAccessory);
  const analysisPool =
    retailPrimaryOffers.length >= 2
      ? retailPrimaryOffers
      : retailPrimaryOffers.length === 1
        ? retailPrimaryOffers
        : nonAccessoryOffers.length >= 2
          ? nonAccessoryOffers
          : pricedOffers;

  const unitInfoGlobal = extractUnitInfo(query, analysisPool[0]?.basePrice ?? null);
  const analysis = analyzeOffers(analysisPool, unitInfoGlobal, { productTitle: query });
  const histAnalysis = analyzePriceHistory([], analysis.stats?.minNet ?? null, null, analysis.stats);

  const aggregateKey = `virtual:${prefix}:all:${encodeURIComponent(query.toLocaleLowerCase("tr-TR"))}`;
  const bestImage =
    analysisPool.find((o) => o.image)?.image ||
    catalogLinks.find((c) => c.image)?.image ||
    defaultProductImage;

  const extraStoreVariants = catalogLinks
    .filter((c) => !c.isListingPage)
    .slice(0, 10)
    .map((c) => ({
      name: `${c.store} — ${c.title.slice(0, 56)}`,
      price: null,
      seller: c.store,
      url: c.url,
      image: c.image || "",
      isAkakceUrl: false,
      isInternalVirtual: false,
      isListingPage: false,
    }));

  const aggregateDetail = {
    id: `${prefix}-${encodeURIComponent(query.toLocaleLowerCase("tr-TR")).slice(0, 32)}`,
    title: `${query} — Türkiye Mağaza Fiyat Karşılaştırması`,
    searchQuery: query,
    brand: "",
    category: `${providerName} · Canlı Çoklu Mağaza Analizi`,
    description: `${query} için Türkiye mağazalarından canlı derlenen ${analysisPool.length} doğrudan ürün teklifi ve ${catalogLinks.length} mağaza sayfası.`,
    url: aggregateKey,
    image: bestImage,
    rating: null,
    totalOfferCount: analysisPool.length,
    unitInfo: unitInfoGlobal ? extractUnitInfo(query, analysis.stats?.minNet ?? analysisPool[0]?.basePrice) : null,
    fetchedAt: new Date().toISOString(),
    cached: false,
    provider: providerName,
    lowPrice: analysis.stats?.minNet ?? null,
    highPrice: analysis.stats?.maxNet ?? null,
    stats: analysis.stats,
    picks: analysis.picks,
    shippingTraps: analysis.shippingTraps,
    platformBreakdown: analysis.platformBreakdown,
    trustSummary: analysis.trustSummary,
    offers: analysis.offers,
    history: [],
    historySummary: null,
    fakeDiscount: histAnalysis.fakeDiscount,
    verdict: {
      ...histAnalysis.verdict,
      score: analysis.stats ? (analysis.stats.savingsVsMedianPct >= 15 ? 82 : analysis.stats.savingsVsMedianPct >= 6 ? 72 : 64) : 60,
      label: analysis.stats ? `${analysisPool.length} Doğrudan Teklif Karşılaştırıldı` : "Mağaza Bağlantıları Bulundu",
      tone: analysis.stats && analysis.stats.savingsVsMedianPct >= 10 ? "good" : "good-soft",
      headline: analysis.stats
        ? `Doğrulanmış en ucuz net teklif ${analysis.stats.minNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL (${analysis.picks?.cheapestNet?.store || ""}).`
        : "Fiyatlar doğrudan mağaza sayfalarından incelenebilir.",
      reasons: analysis.stats
        ? [
            `Piyasa medyanı ${analysis.stats.medianNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL; en ucuz seçenek medyanın %${analysis.stats.savingsVsMedianPct} altında.`,
            `${analysis.platformBreakdown.length} farklı mağaza/platform karşılaştırıldı.`,
            ...(analysis.stats.suspiciousLowCount > 0
              ? [`${analysis.stats.suspiciousLowCount} adet piyasa medyanının çok altında (şüpheli ucuz / muadil / aksesuar) ilan ayrıştırıldı.`]
              : []),
            "Ürünü takibe aldığınızda her kontrolünüzde kendi fiyat geçmişi grafiğiniz otomatik oluşur.",
          ]
        : ["Bu aramada fiyat bilgisi ürün sayfalarının içinde yer alıyor; aşağıdaki mağaza linklerinden anında açabilirsiniz."],
    },
    variants: extraStoreVariants,
    specs: [],
  };

  saveVirtualDetail(aggregateKey, aggregateDetail);

  // Helper to check if two offers belong to the same specific product & variant (no cross-model/color/volume mixing!)
  const GENERIC_MODEL_NOISE = new Set([
    "erkek",
    "kadin",
    "unisex",
    "cocuk",
    "bebek",
    "ml",
    "gr",
    "kg",
    "lt",
    "cm",
    "mm",
    "gb",
    "tb",
    "adet",
    "paket",
    "yeni",
    "sezon",
    "orijinal",
    "original",
  ]);
  const baseQueryToks = meaningfulTokens(query);
  const modelDiffTokens = (str) =>
    new Set(
      [...meaningfulTokens(str)].filter(
        (t) => !baseQueryToks.has(t) && !GENERIC_MODEL_NOISE.has(t) && !/^\d+$/.test(t)
      )
    );

  const isSameVariantOffer = (baseProduct, candidateOffer) => {
    if (!candidateOffer) return false;
    if (candidateOffer.id === baseProduct._offer?.id) return true;
    const pAttrs = baseProduct.variantAttrs || {};
    const oAttrs = candidateOffer.variantAttrs || {};
    if (pAttrs.color && oAttrs.color && !areColorsCompatible(pAttrs.color, oAttrs.color)) return false;
    if (pAttrs.capacity && oAttrs.capacity && pAttrs.capacity !== oAttrs.capacity) return false;
    if (pAttrs.volume && oAttrs.volume && pAttrs.volume !== oAttrs.volume) return false;

    const pToks = meaningfulTokens(baseProduct.title);
    const oToks = meaningfulTokens(candidateOffer.offerTitle);
    if (overlapScore(pToks, oToks) < 0.55) return false;

    // Differentiating model tokens (excluding base query & generic gender/unit words) must genuinely overlap!
    const pDiff = modelDiffTokens(baseProduct.title);
    const oDiff = modelDiffTokens(candidateOffer.offerTitle);
    if (pDiff.size > 0 && oDiff.size > 0) {
      let commonDiff = 0;
      for (const t of pDiff) {
        if (oDiff.has(t)) commonDiff++;
      }
      const unionDiff = new Set([...pDiff, ...oDiff]).size;
      if (unionDiff > 0 && commonDiff / unionDiff < 0.5) return false;
    }
    return true;
  };

  // Sort priced cards: non-accessories first, then price ascending (so peerVariants are cheapest-first too)
  products.sort((a, b) => {
    if (a.isAccessory !== b.isAccessory) return a.isAccessory ? 1 : -1;
    return (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity);
  });

  // Cache detail view for every individual priced product card (strictly isolated to matching offers!)
  for (const p of products) {
    const matchingOffers = analysisPool.filter((o) => isSameVariantOffer(p, o));
    const dedup = [];
    const seen = new Set();
    for (const o of [p._offer, ...matchingOffers]) {
      if (!o || seen.has(o.id)) continue;
      seen.add(o.id);
      dedup.push(o);
    }

    const uInfo = extractUnitInfo(p.title, p.lowestPrice);
    const itemAnalysis = analyzeOffers(dedup, uInfo, { productTitle: p.title });

    // Other products/colors from this search become navigable internal variants (with their own images & prices!)
    const peerVariants = products
      .filter((other) => other.id !== p.id && !other.isAccessory)
      .slice(0, 8)
      .map((other) => ({
        name: other.title.slice(0, 62),
        price: other.lowestPrice,
        seller: other.source,
        color: other.variantAttrs?.color || null,
        image: other.image || "",
        url: other.url,
        isAkakceUrl: false,
        isInternalVirtual: true,
      }));

    const itemVerdict = {
      ...aggregateDetail.verdict,
      label: dedup.length >= 2 ? `${dedup.length} Mağazada Karşılaştırıldı` : `${p.source} Doğrudan Ürün`,
      headline: itemAnalysis.stats
        ? `Bu ürün için doğrulanmış net fiyat ${itemAnalysis.stats.minNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL (${itemAnalysis.picks?.cheapestNet?.store || p.source}).`
        : aggregateDetail.verdict.headline,
      reasons:
        dedup.length >= 2 && itemAnalysis.stats
          ? [
              `Aynı ürün/varyant için ${dedup.length} mağaza teklifi karşılaştırıldı.`,
              `Medyan fiyat ${itemAnalysis.stats.medianNet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL.`,
              "Mağazaya Git butonu sizi doğrudan bu ürünün sayfasına götürür.",
            ]
          : [
              `${p.source} doğrudan ürün sayfasından alınan güncel fiyat bilgisidir.`,
              ...(p.priceSource === "installment"
                ? ["Fiyat, ilandaki peşin fiyatına taksit bilgisinden toplam tutar olarak hesaplanmıştır."]
                : []),
              "Diğer renk/modelleri aşağıdaki seçeneklerden kıyaslayabilirsiniz.",
            ],
    };

    saveVirtualDetail(p.url, {
      ...aggregateDetail,
      id: p.id,
      title: p.title,
      searchQuery: query,
      url: p.url,
      externalUrl: p.externalUrl,
      image: p.image || (p.variantAttrs?.color ? "" : bestImage),
      totalOfferCount: dedup.length,
      unitInfo: uInfo ? extractUnitInfo(p.title, itemAnalysis.stats?.minNet ?? p.lowestPrice) : null,
      lowPrice: itemAnalysis.stats?.minNet ?? p.lowestPrice,
      highPrice: itemAnalysis.stats?.maxNet ?? p.lowestPrice,
      stats: itemAnalysis.stats,
      picks: itemAnalysis.picks,
      shippingTraps: itemAnalysis.shippingTraps,
      platformBreakdown: itemAnalysis.platformBreakdown,
      trustSummary: itemAnalysis.trustSummary,
      offers: itemAnalysis.offers,
      verdict: itemVerdict,
      variants: [...peerVariants, ...extraStoreVariants.slice(0, 4)],
    });
  }

  for (const p of products) {
    delete p._offer;
  }

  // Add unpriced direct products & category/listing pages as clearly labeled catalog cards
  const catalogCards = catalogLinks.slice(0, 8).map((c) => {
    const cKey = `virtual:${prefix}:cat:${encodeURIComponent(query)}:${encodeURIComponent(c.id)}`;
    saveVirtualDetail(cKey, {
      ...aggregateDetail,
      id: c.id,
      title: c.title,
      searchQuery: query,
      url: cKey,
      externalUrl: c.url,
      image: c.image || (c.variantAttrs?.color ? "" : bestImage),
      description: c.snippet,
      variants: [
        {
          name: c.isListingPage ? `${c.store} Kategori Sayfasına Git` : `${c.store} Ürün Sayfasına Git`,
          price: null,
          seller: c.store,
          url: c.url,
          isAkakceUrl: false,
          isInternalVirtual: false,
        },
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
      priceSource: null,
      offerCount: 1,
      badge: c.store,
      source: c.store,
      isOfficialStore: c.isOfficialStore,
      isFreeShipping: false,
      isAccessory: c.isAccessory,
      isProductPage: c.isProductPage,
      isListingPage: c.isListingPage,
      isSecondHand: c.isSecondHand,
      secondHandCondition: c.secondHandCondition,
      variantAttrs: c.variantAttrs,
      unitInfo: null,
    };
  });

  // Sort catalog cards: direct unpriced products before category/listing pages
  catalogCards.sort((a, b) => {
    if (a.isListingPage !== b.isListingPage) return a.isListingPage ? 1 : -1;
    return 0;
  });

  const finalProducts = [
    ...(analysisPool.length >= 2
      ? [
          {
            id: `${prefix}-all`,
            title: `📊 ${query} — Tüm Mağazaları Karşılaştır (${analysisPool.length} teklif)`,
            url: aggregateKey,
            image: bestImage,
            lowestPrice: analysis.stats?.minNet ?? null,
            offerCount: analysisPool.length,
            badge: "Tüm Mağazalar",
            source: providerName,
            isOfficialStore: true,
            isFreeShipping: Boolean(analysis.picks?.cheapestNet?.shippingCost === 0),
            isAccessory: false,
            isProductPage: true,
            isListingPage: false,
            isSecondHand: false,
            secondHandCondition: null,
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
    directProductCount: products.length,
    listingCount: catalogCards.filter((c) => c.isListingPage).length,
    secondHandCount: finalProducts.filter((p) => p.isSecondHand).length,
    accessoryCount: finalProducts.filter((p) => p.isAccessory).length,
    products: finalProducts,
    aggregateUrl: analysisPool.length >= 2 ? aggregateKey : null,
  };
}

// 5-minute cache for dedicated second-hand (Dolap / Gardrops / sahibinden) searches
const secondHandCache = new Map();

/**
 * Builds direct 1-tap search links for Turkey's top second-hand / tagged resale platforms.
 */
export function buildSecondHandQuickLinks(query) {
  const q = String(query || "").trim();
  const enc = encodeURIComponent(q);
  return [
    {
      platform: "Dolap",
      label: "Dolap'ta Ara (Yeni & Etiketli / 2. El)",
      url: `https://dolap.com/ara?q=${enc}`,
      logoUrl: "https://www.google.com/s2/favicons?domain=dolap.com&sz=64",
    },
    {
      platform: "Gardrops",
      label: "Gardrops'ta Ara (2. El / Etiketli)",
      url: `https://www.gardrops.com/ara?q=${enc}`,
      logoUrl: "https://www.google.com/s2/favicons?domain=gardrops.com&sz=64",
    },
    {
      platform: "sahibinden",
      label: "sahibinden'de Ara",
      url: `https://www.sahibinden.com/kelime-ile-arama?query_text=${enc}`,
      logoUrl: "https://www.google.com/s2/favicons?domain=sahibinden.com&sz=64",
    },
  ];
}

/**
 * Dedicated Second-Hand & Tagged Resale search engine (Dolap, Gardrops, sahibinden).
 * Uses Serper or SerpAPI when configured, and always provides direct 1-tap platform links.
 */
export async function searchSecondHandTurkey(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) {
    throw new Error("Arama terimi boş olamaz.");
  }

  const quickLinks = buildSecondHandQuickLinks(q);
  const serperKeys = getSerperKeyPool(options.serperKey);
  const serperKey = serperKeys[0] || "";
  const serpApiKey = (options.serpApiKey || process.env.SERPAPI_KEY || "").trim();
  const cacheKey = `2el:${q.toLocaleLowerCase("tr-TR")}:${serperKey ? "sp" : serpApiKey ? "sa" : "none"}`;

  if (!options.refresh) {
    const cached = secondHandCache.get(cacheKey);
    if (cached && Date.now() <= cached.expiresAt) {
      return { ...cached.data, cached: true };
    }
  }

  if (!serperKey && !serpApiKey) {
    return {
      query: q,
      provider: "Doğrudan 2. El Bağlantıları",
      liveIndexed: false,
      fetchedAt: new Date().toISOString(),
      cached: false,
      totalFound: 0,
      pricedFound: 0,
      lowestPrice: null,
      items: [],
      quickLinks,
      notice:
        "Bu arama için anlık 2. el ilan özeti bulunamadı. Aşağıdaki tek tık bağlantılarla Dolap, Gardrops ve sahibinden ilanlarını doğrudan açabilirsiniz.",
    };
  }

  let rawOrganic = [];
  let imagePool = [];
  let providerName = "Dolap · Gardrops · sahibinden";

  const shQuery = `${q} (site:dolap.com/urun OR site:gardrops.com OR site:sahibinden.com/ilan)`;

  if (serperKey) {
    providerName = "Dolap · Gardrops · sahibinden (Serper)";
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: shQuery, gl: "tr", hl: "tr", num: 10 }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      throw new Error(`2. El arama hatası (HTTP ${res.status})`);
    }
    const data = await res.json();
    rawOrganic = Array.isArray(data.organic) ? data.organic : [];
    imagePool = Array.isArray(data.images) ? data.images : [];

    // Fallback broader query if /urun + /ilan had very few hits
    if (rawOrganic.length < 3) {
      try {
        const res2 = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            q: `${q} (site:dolap.com OR site:gardrops.com OR site:sahibinden.com)`,
            gl: "tr",
            hl: "tr",
            num: 10,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (res2.ok) {
          const data2 = await res2.json();
          if (Array.isArray(data2.organic)) rawOrganic.push(...data2.organic);
        }
      } catch {
        // Non-fatal
      }
    }

    const needPhotos = rawOrganic.filter((it) => !isUsableDirectPhoto(it?.imageUrl) && !isUsableDirectPhoto(it?.thumbnailUrl)).length;
    if (rawOrganic.length > 0 && needPhotos > 0 && imagePool.length === 0) {
      const imgKey = `2el:${q.toLocaleLowerCase("tr-TR")}`;
      const cachedImgs = getCachedImages(imgKey);
      if (cachedImgs) {
        imagePool = cachedImgs;
      } else {
        try {
          const imgRes = await fetch("https://google.serper.dev/images", {
            method: "POST",
            headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: `${q} dolap gardrops`, gl: "tr", hl: "tr", num: 10 }),
            signal: AbortSignal.timeout(9000),
          });
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            if (Array.isArray(imgData.images) && imgData.images.length) {
              imagePool = imgData.images;
              setCachedImages(imgKey, imgData.images);
            }
          }
        } catch {
          // Non-fatal
        }
      }
    }
  } else if (serpApiKey) {
    providerName = "Dolap · Gardrops · sahibinden (SerpAPI)";
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(shQuery)}&gl=tr&hl=tr&num=10&api_key=${encodeURIComponent(serpApiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`2. El SerpAPI yanıt hatası (HTTP ${res.status})`);
    const data = await res.json();
    rawOrganic = (Array.isArray(data.organic_results) ? data.organic_results : []).map((it) => ({
      title: it.title,
      link: it.link,
      snippet: it.snippet || "",
      imageUrl: it.thumbnail || "",
      price: it.rich_snippet?.bottom?.detected_extensions?.price ?? it.rich_snippet?.top?.detected_extensions?.price,
      currency: it.rich_snippet?.bottom?.detected_extensions?.currency ?? it.rich_snippet?.top?.detected_extensions?.currency,
    }));
  }

  const seen = new Set();
  const usedImgs = new Set();
  const items = [];

  for (const raw of rawOrganic) {
    const link = raw?.link;
    const title = String(raw?.title || "").replace(/\s+/g, " ").trim();
    const norm = normalizeUrlForMatch(link);
    if (!link || !title || seen.has(norm) || isNonShoppingUrl(link)) continue;
    seen.add(norm);

    const cls = classifyStoreUrl(link, title);
    const storeMeta = resolveStoreFromUrl(link, raw.source || "");
    const priceInfo = extractOrganicPriceInfo(raw);
    const snippet = String(raw.snippet || "").replace(/\s+/g, " ").trim();
    const condition = detectSecondHandCondition(title, snippet);
    const variantAttrs = extractVariantAttributes(title, cls.isListingPage ? "" : cls.slug);

    const directImg = isUsableDirectPhoto(raw.imageUrl)
      ? raw.imageUrl
      : isUsableDirectPhoto(raw.thumbnailUrl)
        ? raw.thumbnailUrl
        : "";
    if (directImg) usedImgs.add(directImg);

    const matchedPhoto =
      directImg ||
      pickBestProductImage(
        {
          title,
          url: link,
          host: storeMeta.host,
          productId: cls.productId,
          color: variantAttrs.color,
          slug: cls.isListingPage ? "" : cls.slug,
        },
        imagePool,
        usedImgs,
        q
      );

    items.push({
      id: `2el-${items.length + 1}`,
      title,
      url: link,
      externalUrl: link,
      platform: storeMeta.platform,
      badge: storeMeta.platform,
      logoUrl: storeMeta.logoUrl,
      image: matchedPhoto || storeMeta.logoUrl || "",
      price: !cls.isListingPage && priceInfo.price && priceInfo.price > 0 ? priceInfo.price : null,
      shippingLabel: priceInfo.shipping?.label || "Satıcı ile kontrol edin",
      condition,
      isSecondHand: true,
      isListingPage: cls.isListingPage,
      isProductPage: cls.isProductPage,
      variantAttrs,
      snippet: snippet.slice(0, 140),
    });
  }

  // Sort: direct priced items first (cheapest ascending), then direct unpriced, then listing pages
  items.sort((a, b) => {
    const aRank = a.isListingPage ? 2 : a.price ? 0 : 1;
    const bRank = b.isListingPage ? 2 : b.price ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    if (a.price && b.price) return a.price - b.price;
    return 0;
  });

  const pricedItems = items.filter((it) => typeof it.price === "number" && it.price > 0);
  const lowestPrice = pricedItems.length ? Math.min(...pricedItems.map((it) => it.price)) : null;

  const payload = {
    query: q,
    provider: providerName,
    liveIndexed: true,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: items.length,
    pricedFound: pricedItems.length,
    lowestPrice,
    items,
    quickLinks,
  };

  if (secondHandCache.size > 120) {
    secondHandCache.delete(secondHandCache.keys().next().value);
  }
  secondHandCache.set(cacheKey, { data: payload, expiresAt: Date.now() + 5 * 60 * 1000 });
  return payload;
}

/**
 * Resolves an EAN-8 / EAN-13 / UPC-A / GTIN-14 barcode into a searchable Turkish product name
 * using Open Food Facts, UPCitemdb, T.C. Market Fiyatı, and (when configured) Google TR search.
 */
export async function resolveBarcode(rawCode, options = {}) {
  const code = String(rawCode || "").replace(/\D+/g, "").trim();
  if (code.length < 8 || code.length > 14) {
    throw new Error("Geçersiz barkod numarası (8 ile 14 haneli rakam olmalıdır).");
  }

  // 1. Open Food Facts (great for supermarket, coffee, beverage, food, personal care)
  try {
    const offRes = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_tr,brands,quantity,image_url`,
      { headers: { "User-Agent": "FiyatRadar/2.0" }, signal: AbortSignal.timeout(5000) }
    );
    if (offRes.ok) {
      const off = await offRes.json();
      if (off.status === 1 && off.product) {
        const name = (off.product.product_name_tr || off.product.product_name || "").trim();
        const brand = (off.product.brands || "").split(",")[0].trim();
        const qty = (off.product.quantity || "").trim();
        const parts = [brand, name, qty].filter(Boolean);
        const query = [...new Set(parts)].join(" ").replace(/\s+/g, " ").trim();
        if (query.length >= 3) {
          return {
            code,
            query,
            source: "Open Food Facts",
            image: off.product.image_url || "",
          };
        }
      }
    }
  } catch {
    // Continue to next source
  }

  // 2. UPCitemdb free lookup (great for electronics, gadgets, global brands)
  try {
    const upcRes = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
      { headers: { "User-Agent": "FiyatRadar/2.0", Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
    );
    if (upcRes.ok) {
      const upc = await upcRes.json();
      const first = upc?.items?.[0];
      if (first?.title) {
        return {
          code,
          query: String(first.title).trim().slice(0, 80),
          source: "UPC Veritabanı",
          image: first.images?.[0] || "",
        };
      }
    }
  } catch {
    // Continue
  }

  // 3. Google Turkey barcode lookup via Serper (finds Turkish 869... EAN products!)
  const serperKeys = getSerperKeyPool(options.serperKey);
  for (const serperKey of serperKeys) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: code, gl: "tr", hl: "tr", num: 5 }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const first = (data.organic || []).find((o) => o?.title && !isNonShoppingUrl(o.link));
        if (first?.title) {
          const cleanTitle = String(first.title)
            .replace(/\s*[-|–]\s*(Trendyol|Hepsiburada|Amazon.*|n11|Akakçe|Cimri|Migros|PttAVM|MediaMarkt|Teknosa|Vatan|Fiyatı.*|Modelleri.*)$/i, "")
            .replace(new RegExp(code, "g"), "")
            .replace(/\s+/g, " ")
            .trim();
          if (cleanTitle.length >= 3) {
            return {
              code,
              query: cleanTitle.slice(0, 80),
              source: "Google Türkiye Barkod",
              image: first.imageUrl || "",
            };
          }
        }
        break;
      }
    } catch {
      // Rotate to next key if available
    }
  }

  // 4. Fallback: search the barcode number directly
  return {
    code,
    query: code,
    source: "Doğrudan Barkod Araması",
    image: "",
  };
}

const ZERO_KEY_STOP_WORDS = new Set([
  "ve",
  "ile",
  "icin",
  "en",
  "ucuz",
  "fiyat",
  "fiyati",
  "fiyatlari",
  "tl",
  "online",
  "satis",
  "orijinal",
  "yeni",
  "sezon",
  "modelleri",
  "modeli",
]);

const ZERO_KEY_GENERIC_WORDS = new Set([
  "erkek",
  "kadin",
  "cocuk",
  "unisex",
  "bebek",
  "spor",
  "gunluk",
  "klasik",
  "siyah",
  "beyaz",
  "mavi",
  "kirmizi",
  "yesil",
  "gri",
  "bej",
  "kahverengi",
  "lacivert",
  "pembe",
  "sari",
  "mor",
  "turuncu",
  "buyuk",
  "kucuk",
]);

const ZERO_KEY_SYNONYMS = {
  ayakkabi: ["ayakkabi", "sneaker", "bot", "sandalet", "terlik", "krampon", "loafer", "babet", "stiletto", "cizme"],
  sneaker: ["sneaker", "ayakkabi"],
  parfum: ["parfum", "edp", "edt", "elixir", "cologne", "eau"],
  gozluk: ["gozluk", "sunglass"],
  kulaklik: ["kulaklik", "airpods", "earbuds", "headphone", "buds"],
  supurge: ["supurge", "vacuum"],
  airfryer: ["airfryer", "fritoz", "easy fry", "actifry"],
  fritoz: ["fritoz", "airfryer", "easy fry"],
};

const AKINON_TR_STORES = [
  { name: "SuperStep", baseUrl: "https://www.superstep.com.tr", freeShipThreshold: 2500, category: "Ayakkabı & Spor", vertical: "fashion_sports" },
  { name: "House of SuperStep", baseUrl: "https://www.houseofsuperstep.com", freeShipThreshold: 2500, category: "Sneaker & Streetwear", vertical: "fashion_sports" },
  { name: "FashFed", baseUrl: "https://www.fashfed.com", freeShipThreshold: 2500, category: "Moda & Ayakkabı", vertical: "fashion_sports" },
  { name: "Intersport", baseUrl: "https://www.intersport.com.tr", freeShipThreshold: 2500, category: "Spor & Ayakkabı", vertical: "fashion_sports" },
  { name: "Barçın", baseUrl: "https://www.barcin.com", freeShipThreshold: 2000, category: "Spor & Ayakkabı", vertical: "fashion_sports" },
  { name: "Sportive", baseUrl: "https://www.sportive.com.tr", freeShipThreshold: 1500, category: "Spor & Ayakkabı", vertical: "fashion_sports" },
  { name: "Sporjinal", baseUrl: "https://www.sporjinal.com", freeShipThreshold: 1500, category: "Spor & Ayakkabı", vertical: "fashion_sports" },
  { name: "Occasion", baseUrl: "https://www.occasion.com.tr", freeShipThreshold: 2500, category: "Moda & Outlet", vertical: "fashion_sports" },
  { name: "Under Armour Türkiye", baseUrl: "https://www.underarmour.com.tr", freeShipThreshold: 2500, category: "Spor & Ayakkabı", vertical: "fashion_sports" },
  { name: "Lacoste Türkiye", baseUrl: "https://www.lacoste.com.tr", freeShipThreshold: 2500, category: "Moda & Ayakkabı", vertical: "fashion_sports" },
  { name: "Converse Türkiye", baseUrl: "https://www.converse.com.tr", freeShipThreshold: 2500, category: "Ayakkabı", vertical: "fashion_sports" },
  { name: "Koton", baseUrl: "https://www.koton.com", freeShipThreshold: 1000, category: "Moda & Giyim", vertical: "fashion_sports" },
  { name: "Marks & Spencer Türkiye", baseUrl: "https://www.marksandspencer.com.tr", freeShipThreshold: 2000, category: "Moda & Ev", vertical: "fashion_sports" },
  { name: "GAP Türkiye", baseUrl: "https://www.gap.com.tr", freeShipThreshold: 2000, category: "Moda & Giyim", vertical: "fashion_sports" },
  { name: "GANT Türkiye", baseUrl: "https://www.gant.com.tr", freeShipThreshold: 2500, category: "Moda & Giyim", vertical: "fashion_sports" },
  { name: "Nautica Türkiye", baseUrl: "https://www.nautica-tr.com", freeShipThreshold: 2000, category: "Moda & Giyim", vertical: "fashion_sports" },
  { name: "Tefal Türkiye", baseUrl: "https://www.tefal.com.tr", freeShipThreshold: 1500, category: "Küçük Ev Aletleri", vertical: "home_appliance" },
];

function normalizeZeroKeyText(str) {
  return transliterateTr(String(str || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenMatchesHaystack(token, haystack, hayTokens) {
  if (!token) return false;
  const syns = ZERO_KEY_SYNONYMS[token] || [token];
  for (const s of syns) {
    if (s.includes(" ")) {
      if (haystack.includes(s)) return true;
      continue;
    }
    if (/^\d+$/.test(s)) {
      if (hayTokens.has(s)) return true;
      continue;
    }
    if (s.length >= 4) {
      // Allow Turkish inflections (e.g., ayakkabi -> ayakkabisi, parfum -> parfumu)
      const stem = s.length >= 6 && /[iu]$/.test(s) ? s.slice(0, -1) : s;
      if (haystack.includes(stem)) return true;
    } else if (hayTokens.has(s)) {
      return true;
    }
  }
  return false;
}

/**
 * Strict relevance filter for zero-key multi-store search results.
 * Prevents catalog-default leaks (e.g., shoes or blenders showing up for "iphone 15").
 */
export function matchesZeroKeyQuery(title, brand, code, query) {
  const qNorm = normalizeZeroKeyText(query);
  if (!qNorm) return { ok: false, score: 0 };

  const qTokens = qNorm
    .split(" ")
    .filter((t) => t.length >= 2 && !ZERO_KEY_STOP_WORDS.has(t));
  if (!qTokens.length) return { ok: true, score: 1 };

  const haystack = normalizeZeroKeyText(`${brand || ""} ${title || ""} ${code || ""}`);
  if (!haystack) return { ok: false, score: 0 };
  const hayTokens = new Set(haystack.split(" "));

  const alphaTokens = qTokens.filter((t) => /[a-z]{2,}/.test(t));
  const coreAlphaTokens = alphaTokens.filter((t) => !ZERO_KEY_GENERIC_WORDS.has(t));

  let matchedCount = 0;
  let alphaMatched = 0;
  let coreAlphaMatched = 0;

  for (const tok of qTokens) {
    if (tokenMatchesHaystack(tok, haystack, hayTokens)) {
      matchedCount++;
      if (/[a-z]{2,}/.test(tok)) {
        alphaMatched++;
        if (!ZERO_KEY_GENERIC_WORDS.has(tok)) coreAlphaMatched++;
      }
    }
  }

  // Never allow a pure numeric token match (like "15" in "15 cm bot") when query has alphabetic terms
  if (alphaTokens.length > 0 && alphaMatched === 0) return { ok: false, score: 0 };
  if (coreAlphaTokens.length > 0 && coreAlphaMatched === 0) return { ok: false, score: 0 };

  // Primary brand / lead product keyword must match when specific
  const leadCore = coreAlphaTokens[0];
  if (leadCore && leadCore.length >= 3 && !tokenMatchesHaystack(leadCore, haystack, hayTokens)) {
    return { ok: false, score: 0 };
  }

  const ratio = matchedCount / qTokens.length;
  const minRatio = qTokens.length <= 2 ? 0.99 : 0.65;
  if (ratio < minRatio) return { ok: false, score: 0 };

  return { ok: true, score: Math.round((ratio * 100 + coreAlphaMatched * 15) * 10) / 10 };
}

/**
 * Extracts a canonical manufacturer model/style code (e.g., KI4392, IF4466, HP9426, MXP63TU)
 * so identical items across SuperStep, FashFed, Intersport, Sportive, etc. merge into one card.
 */
function extractModelStyleCode(code, title) {
  const candidates = [String(code || "").trim(), ...String(title || "").split(/[\s/,()\-]+/)];
  for (const raw of candidates) {
    const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (clean.length < 5 || clean.length > 12) continue;
    if (!/[A-Z]/.test(clean) || !/\d/.test(clean)) continue;
    // Skip storage, weight, volume, dimensions, or years
    if (/^\d+(GB|TB|MB|ML|LT|KG|GR|CM|MM|HZ|MAH|W|V|INCH|IN)$/.test(clean)) continue;
    if (/^(19|20)\d{2}/.test(clean)) continue;
    if (/^\d{1,3}[A-Z]{1,2}$/.test(clean)) continue;
    return clean;
  }
  return "";
}

const CLOTHING_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "STD"];

function normalizeAvailableSize(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!s || s === "-" || s === "0" || s === "999" || s === "NONE" || s === "NULL") return "";

  // Clothing letter sizes (XS, S, M, L, XL, XXL, 2XL, 3XL)
  if (/^(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL)$/.test(s)) {
    return s === "XXL" ? "2XL" : s;
  }

  // EU shoe / waist numeric sizes (e.g. "42", "42,5", "42.5", "42 2/3" -> "42,5")
  const euHalf = s.match(/^(\d{2})\s*(?:[.,]([05])|(?:1\/3|2\/3|1\/2))$/);
  if (euHalf) {
    const num = Number.parseInt(euHalf[1], 10);
    if (num >= 20 && num <= 50) {
      return euHalf[2] === "0" ? String(num) : `${num},5`;
    }
  }
  const euInt = s.match(/^(\d{2})$/);
  if (euInt) {
    const num = Number.parseInt(euInt[1], 10);
    if (num >= 20 && num <= 50) return String(num);
  }
  return "";
}

export function sortAvailableSizes(sizes) {
  return [...sizes].sort((a, b) => {
    const strA = String(a).trim();
    const strB = String(b).trim();
    const aIsNum = /^\d+(?:[.,]\d+)?$/.test(strA);
    const bIsNum = /^\d+(?:[.,]\d+)?$/.test(strB);
    if (aIsNum && bIsNum) {
      return Number.parseFloat(strA.replace(",", ".")) - Number.parseFloat(strB.replace(",", "."));
    }
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    const idxA = CLOTHING_SIZE_ORDER.indexOf(strA.toUpperCase());
    const idxB = CLOTHING_SIZE_ORDER.indexOf(strB.toUpperCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return strA.localeCompare(strB, "tr");
  });
}

/**
 * Extracts real in-stock EU shoe numbers & clothing sizes from Akinon storefront JSON
 * (SuperStep, FashFed, Intersport, Sportive, Sporjinal, Koton).
 */
export function extractAkinonAvailableSizes(p) {
  const found = new Set();
  const addRaw = (val) => {
    const norm = normalizeAvailableSize(val);
    if (norm) found.add(norm);
  };

  // 1. Walk extra_data.variants options (contains full in-stock size list per product!)
  const variants = Array.isArray(p?.extra_data?.variants) ? p.extra_data.variants : [];
  for (const v of variants) {
    const opts = Array.isArray(v?.options) ? v.options : [];
    for (const o of opts) {
      const inStock =
        o?.is_selectable !== false &&
        o?.in_stock !== false &&
        o?.product?.in_stock !== false;
      if (!inStock) continue;
      const attrs = o?.product?.attributes || {};
      const preferred = attrs.filterable_size || attrs.filterable_beden || attrs.beden;
      if (preferred) {
        addRaw(preferred);
      } else {
        addRaw(attrs.integration_beden || o?.label);
      }
    }
  }

  // 2. Fallback / supplement from top-level product attributes when in stock
  if (p?.in_stock !== false) {
    const attrs = p?.attributes || {};
    const preferred = attrs.filterable_size || attrs.filterable_beden || attrs.beden;
    if (preferred) {
      addRaw(preferred);
    } else if (attrs.integration_beden) {
      addRaw(attrs.integration_beden);
    }
  }

  return sortAvailableSizes([...found]);
}

/**
 * Extracts real in-cart discount ("Sepette Ek İndirim") price, label, and live coupon code
 * from Akinon product `basket_offers` array (SuperStep, Intersport, FashFed, Sportive, Koton, etc.).
 */
export function extractAkinonBasketOffer(p, basePrice) {
  const offers = Array.isArray(p?.basket_offers) ? p.basket_offers : [];
  if (!offers.length || !(typeof basePrice === "number" && basePrice > 0)) {
    return { basketPrice: null, basketOfferLabel: "", couponCode: "" };
  }

  let bestPrice = null;
  let bestLabel = "";
  let bestCoupon = "";

  for (const bo of offers) {
    if (!bo || typeof bo !== "object") continue;
    const rawLabel = String(
      bo.label || bo.name || bo.title || bo.listing_kwargs?.label || bo.listing_kwargs?.text || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    // Look for live coupon code (e.g. "KASIM30 KODU İLE EK %30 İNDİRİM" or "KOD: SEPET20")
    const codeMatch =
      rawLabel.match(/\b([A-Z0-9]{4,16})\s+KOD[UI]?\b/i) ||
      rawLabel.match(/\bKOD[UI]?\s*[:\-]?\s*([A-Z0-9]{4,16})\b/i);
    const coupon = codeMatch?.[1] && /[A-Z]/i.test(codeMatch[1]) ? codeMatch[1].toUpperCase() : "";

    // 1. Prefer exact pre-computed discounted_total_price from Akinon listing_kwargs
    const rawDisc =
      bo.listing_kwargs?.discounted_total_price ??
      bo.discounted_total_price ??
      bo.listing_kwargs?.discounted_price ??
      bo.discounted_price;
    let computed = typeof rawDisc === "number" ? rawDisc : parseTrPrice(rawDisc);

    // 2. If only an unconditional "%X Sepette İndirim" label exists (no "ÜZERİNE" threshold), compute safely
    if ((!computed || computed >= basePrice) && rawLabel && !/üzeri|adet|ikinci|2\.|3\./i.test(rawLabel)) {
      const pctMatch = rawLabel.match(/%\s*(\d{1,2})\b/);
      if (pctMatch) {
        const pct = Number.parseInt(pctMatch[1], 10);
        if (pct >= 5 && pct <= 60) {
          computed = Math.round(basePrice * (1 - pct / 100) * 100) / 100;
        }
      }
    }

    if (computed && computed > 0 && computed < basePrice * 0.99 && computed >= basePrice * 0.3) {
      const rounded = Math.round(computed * 100) / 100;
      if (bestPrice === null || rounded < bestPrice) {
        bestPrice = rounded;
        bestLabel = rawLabel || "Sepette Ek İndirim";
        bestCoupon = coupon || bestCoupon;
      }
    } else if (!bestLabel && rawLabel) {
      bestLabel = rawLabel;
      if (coupon && !bestCoupon) bestCoupon = coupon;
    }
  }

  return {
    basketPrice: bestPrice,
    basketOfferLabel: bestLabel.slice(0, 90),
    couponCode: bestCoupon,
  };
}

async function fetchAkinonStore(store, query) {
  const url = `${store.baseUrl}/list/?search_text=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "Accept-Language": "tr-TR,tr;q=0.9",
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return [];
  const text = await res.text();
  if (!text.trim().startsWith("{")) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data.products) ? data.products : [];
  const out = [];

  for (const p of list.slice(0, 32)) {
    const title = String(p?.name || "").replace(/\s+/g, " ").trim();
    const price = typeof p?.price === "number" ? p.price : parseTrPrice(p?.price);
    if (!title || !price || price <= 0) continue;

    const brand = String(p?.attributes?.brand || p?.attributes_kwargs?.brand?.label || "").trim();
    const rawCode = String(p?.base_code || p?.sku || "").trim();
    const rel = matchesZeroKeyQuery(title, brand, rawCode, query);
    if (!rel.ok) continue;

    const retailPrice = typeof p?.retail_price === "number" ? p.retail_price : parseTrPrice(p?.retail_price);
    const absPath = String(p?.absolute_url || "").trim();
    if (!absPath || /\/list\//i.test(absPath)) continue;
    const productUrl = absPath.startsWith("http")
      ? absPath
      : `${store.baseUrl}${absPath.startsWith("/") ? "" : "/"}${absPath}`;

    const gallery = [
      ...new Set(
        (Array.isArray(p?.productimage_set) ? p.productimage_set : [])
          .map((im) => String(im?.image || "").trim())
          .filter((u) => /^https?:\/\//i.test(u))
      ),
    ].slice(0, 6);
    const image = gallery[0] || "";
    const availableSizes = extractAkinonAvailableSizes(p);
    const roundedPrice = Math.round(price * 100) / 100;
    const basket = extractAkinonBasketOffer(p, roundedPrice);
    const rawStock = Number.parseInt(String(p?.stock ?? ""), 10);
    const stockCount = Number.isFinite(rawStock) && rawStock > 0 ? rawStock : null;
    const attrs = p?.attributes || {};
    const rawBarcode = String(
      attrs.mp_yurtdisi_barkod ||
        attrs.integration_yurt_disi_barkod ||
        attrs.integration_erenp_erenbarkod ||
        p?.barcode ||
        ""
    ).replace(/\D/g, "");
    const barcode = rawBarcode.length >= 8 && rawBarcode.length <= 14 ? rawBarcode : "";

    out.push({
      id: `${store.name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${p.pk || out.length}`,
      storeName: store.name,
      title,
      brand,
      code: extractModelStyleCode(rawCode, title),
      barcode,
      price: roundedPrice,
      basketPrice: basket.basketPrice,
      basketOfferLabel: basket.basketOfferLabel,
      couponCode: basket.couponCode,
      listPrice: retailPrice && retailPrice > roundedPrice ? Math.round(retailPrice * 100) / 100 : null,
      image,
      gallery,
      productUrl,
      inStock: p?.in_stock !== false,
      stockCount,
      availableSizes,
      freeShipThreshold: store.freeShipThreshold,
      deliveryLabel: "Hızlı Kargo (1-3 gün)",
      deliveryDays: 2,
      category: store.category,
      relevanceScore: rel.score,
    });
  }
  return out;
}

/**
 * Vertical SSR Store: Gratis (Cosmetics & Personal Care)
 * Extracts embedded Next.js SSR JSON product catalog with real Gratis Kart / promotion prices.
 */
async function fetchGratis(query) {
  const url = `https://www.gratis.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9",
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return [];
  const html = await res.text();
  if (/Just a moment|cf-browser-verification|challenge-platform/i.test(html)) return [];

  const marker = '\\"products\\":[';
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) return [];

  // Extract balanced JSON array from escaped Next.js flight payload
  const arrayStart = startIdx + marker.length - 1;
  let depth = 0;
  let endIdx = -1;
  for (let i = arrayStart; i < Math.min(html.length, arrayStart + 250000); i++) {
    const ch = html[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  if (endIdx === -1) return [];

  let productsJson;
  try {
    const unescaped = html
      .slice(arrayStart, endIdx)
      .replace(/\\"/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\\\/g, "\\");
    productsJson = JSON.parse(unescaped);
  } catch {
    return [];
  }
  if (!Array.isArray(productsJson)) return [];

  const out = [];
  for (const p of productsJson.slice(0, 24)) {
    const title = String(p?.name || p?.title || p?.displayName || "").replace(/\s+/g, " ").trim();
    const brand = String(p?.brand?.name || p?.brandName || "").trim();
    const fullTitle =
      brand && title && !title.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${title}` : title;
    const shareLink = String(p?.shareLink || "").trim();
    if (!fullTitle || !shareLink || !shareLink.startsWith("https://www.gratis.com/")) continue;

    const rel = matchesZeroKeyQuery(fullTitle, brand, String(p?.id || ""), query);
    if (!rel.ok) continue;

    const pr = p?.prices || {};
    const discRaw = typeof pr.discountedPrice === "number" ? pr.discountedPrice / 100 : parseTrPrice(pr.discountedPriceLabel);
    const normRaw = typeof pr.normalPrice === "number" ? pr.normalPrice / 100 : parseTrPrice(pr.normalPriceLabel);
    const promoRaw = typeof pr.promotionPrice === "number" && pr.promotionPrice > 0 ? pr.promotionPrice / 100 : parseTrPrice(pr.promotionPriceLabel);
    const price = discRaw && discRaw > 0 ? Math.round(discRaw * 100) / 100 : normRaw ? Math.round(normRaw * 100) / 100 : null;
    if (!price || price <= 0) continue;

    const basketPrice = promoRaw && promoRaw > 0 && promoRaw < price ? Math.round(promoRaw * 100) / 100 : null;
    const basketOfferLabel = basketPrice
      ? String(pr.promotionLabel || pr.discountedText || "Gratis Kart İndirimi").trim()
      : "";
    const gallery = (Array.isArray(p?.images) ? p.images : [])
      .map((im) => (typeof im === "string" ? im : im?.url || im?.src || ""))
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 5);
    const image = gallery[0] || String(p?.image || p?.thumbnail || "").trim();

    out.push({
      id: `gratis-${p.id || out.length}`,
      storeName: "Gratis",
      title: fullTitle,
      brand,
      code: extractModelStyleCode(String(p?.sku || ""), fullTitle),
      price,
      basketPrice,
      basketOfferLabel,
      couponCode: "",
      listPrice: normRaw && normRaw > price ? Math.round(normRaw * 100) / 100 : null,
      image: /^https?:\/\//i.test(image) ? image : "",
      gallery,
      productUrl: shareLink,
      inStock: p?.stockStatus !== "OUT_OF_STOCK",
      freeShipThreshold: 750,
      deliveryLabel: "Hızlı Kargo (1-3 gün)",
      deliveryDays: 2,
      category: "Kozmetik & Kişisel Bakım",
      relevanceScore: rel.score,
    });
  }
  return out;
}

/**
 * Vertical SSR Store: Gaming.Gen.TR (PC Hardware, Laptops & Gaming Gear)
 * Parses live WooCommerce search results with direct /urun/ product links.
 */
async function fetchGamingGenTr(query) {
  const url = `https://www.gaming.gen.tr/?s=${encodeURIComponent(query)}&post_type=product`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9",
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return [];
  const html = await res.text();
  if (/Just a moment|cf-browser-verification|challenge-platform/i.test(html)) return [];

  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $("li.product, .product-grid-item, .products .product").slice(0, 24).each((idx, el) => {
    const $el = $(el);
    const linkEl = $el.find('a[href*="/urun/"]').first();
    const href = String(linkEl.attr("href") || "").trim();
    if (!href || seen.has(href)) return;

    const title = (
      $el.find(".woocommerce-loop-product__title, h2, h3, .product-title").first().text() ||
      linkEl.attr("title") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 4) return;

    const rel = matchesZeroKeyQuery(title, "", "", query);
    if (!rel.ok) return;

    // WooCommerce shows <del>old</del> <ins>sale</ins> or single .woocommerce-Price-amount
    const insPriceText = $el.find("ins .woocommerce-Price-amount").first().text().trim();
    const delPriceText = $el.find("del .woocommerce-Price-amount").first().text().trim();
    const fallbackPriceText = $el.find(".woocommerce-Price-amount").last().text().trim();
    const price = parseTrPrice(insPriceText || fallbackPriceText);
    if (!price || price <= 0) return;
    const listPrice = parseTrPrice(delPriceText);

    const imgEl = $el.find("img").first();
    const image = String(imgEl.attr("data-src") || imgEl.attr("data-lazy-src") || imgEl.attr("src") || "").trim();
    seen.add(href);

    out.push({
      id: `gaminggen-${idx + 1}`,
      storeName: "Gaming.Gen.TR",
      title,
      brand: "",
      code: extractModelStyleCode("", title),
      price: Math.round(price * 100) / 100,
      listPrice: listPrice && listPrice > price ? Math.round(listPrice * 100) / 100 : null,
      image: /^https?:\/\//i.test(image) ? image : "",
      productUrl: href,
      inStock: !$el.hasClass("outofstock"),
      freeShipThreshold: 1500,
      deliveryLabel: "Hızlı Kargo (1-3 gün)",
      deliveryDays: 2,
      category: "PC & Oyuncu Donanım",
      relevanceScore: rel.score,
    });
  });

  return out;
}

/**
 * Category-aware zero-key store router to keep Render Free (0.1 vCPU / 512 MB RAM) fast and lean.
 * Only queries the vertical stores relevant to the user's query instead of blasting all 23 stores blindly.
 */
export function selectZeroKeyStoresForQuery(query) {
  const qNorm = normalizeZeroKeyText(query);
  const isGrocery =
    /\b(kahve|cay|sut|peynir|zeytinyagi|aycicek|yag|deterjan|bebek\s*bezi|prima|nutella|makarna|un|seker|pirinc|cikolata|biskuvi|su|kola|meyve\s*suyu|yogurt|tereyagi|yumurta|tuvalet\s*kagidi|kagit\s*havlu|lavazza|nescafe|jacobs|tchibo|ulker|eti|sutas|pinar|torku)\b/.test(
      qNorm
    );
  const isCosmetics =
    /\b(parfum|edp|edt|maskara|ruj|fondoten|krem|serum|sampuan|deodorant|gunes\s*kremi|cilt|makyaj|allik|eyeliner|kapatıcı|kapatici|tonik|loreal|maybelline|nivea|garnier|cerave|la\s*roche|dior|chanel|ysl|lancome|gratis|sephora)\b/.test(
      qNorm
    );
  const isTechGaming =
    /\b(iphone|samsung|galaxy|xiaomi|redmi|macbook|laptop|notebook|tablet|ipad|airpods|kulaklik|watch|monitor|rtx|geforce|radeon|ekran\s*karti|islemci|ryzen|intel|anakart|ram|ddr5|ssd|nvme|klavye|mouse|fare|oyuncu|gaming|ps5|playstation|xbox|nintendo|kamera|televizyon|tv|asus|msi|lenovo|acer|logitech|razer|steelseries|hyperx|corsair)\b/.test(
      qNorm
    );
  const isHomeAppliance =
    /\b(airfryer|fritoz|supurge|dyson|tefal|philips|blender|tost|kahve\s*makinesi|utu|kettle|su\s*isitici|tencere|tava|duduklu|robot\s*supurge|mikser|cayci|mutfak\s*sefi|klima|buzdolabi|camasir|bulasik)\b/.test(
      qNorm
    );
  const isFashionSports =
    /\b(ayakkabi|sneaker|bot|sandalet|terlik|krampon|tisort|tshirt|gomlek|pantolon|jean|ceket|mont|kaban|sweatshirt|hoodie|esofman|sort|elbise|etek|kazak|hirka|canta|gozluk|adidas|nike|puma|new\s*balance|converse|lacoste|vans|skechers|asics|salomon|under\s*armour|reebok|timberland|north\s*face|columbia|koton|gant|gap|nautica|marks|rayban|samba|gazelle|superstar|air\s*force|jordan)\b/.test(
      qNorm
    );

  // If multiple or none match, return a balanced general set
  if (isGrocery && !isTechGaming && !isFashionSports) {
    return {
      vertical: "grocery",
      akinonStores: [],
      beymen: false,
      dr: false,
      gratis: false,
      gamingGen: false,
      marketFiyati: true,
      migrosElec: false,
      migrosMarket: true,
    };
  }
  if (isCosmetics && !isTechGaming && !isFashionSports) {
    return {
      vertical: "cosmetics",
      akinonStores: AKINON_TR_STORES.filter((s) => ["FashFed", "Koton"].includes(s.name)),
      beymen: true,
      dr: false,
      gratis: true,
      gamingGen: false,
      marketFiyati: true,
      migrosElec: false,
      migrosMarket: true,
    };
  }
  if (isTechGaming && !isFashionSports) {
    return {
      vertical: "tech_gaming",
      akinonStores: [],
      beymen: false,
      dr: true,
      gratis: false,
      gamingGen: true,
      marketFiyati: false,
      migrosElec: true,
      migrosMarket: false,
    };
  }
  if (isHomeAppliance && !isFashionSports && !isTechGaming) {
    return {
      vertical: "home_appliance",
      akinonStores: AKINON_TR_STORES.filter((s) => s.vertical === "home_appliance"),
      beymen: false,
      dr: true,
      gratis: false,
      gamingGen: false,
      marketFiyati: false,
      migrosElec: true,
      migrosMarket: false,
    };
  }
  if (isFashionSports) {
    return {
      vertical: "fashion_sports",
      akinonStores: AKINON_TR_STORES.filter((s) => s.vertical === "fashion_sports"),
      beymen: true,
      dr: false,
      gratis: false,
      gamingGen: false,
      marketFiyati: false,
      migrosElec: false,
      migrosMarket: false,
    };
  }

  // General fallback: balanced top stores across verticals
  return {
    vertical: "general",
    akinonStores: AKINON_TR_STORES.filter((s) =>
      ["SuperStep", "FashFed", "Intersport", "Barçın", "Sportive", "Koton", "Tefal Türkiye"].includes(s.name)
    ),
    beymen: true,
    dr: true,
    gratis: true,
    gamingGen: true,
    marketFiyati: true,
    migrosElec: true,
    migrosMarket: true,
  };
}

async function fetchBeymen(query) {
  const url = `https://www.beymen.com/tr/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9",
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return [];
  const html = await res.text();
  if (/Just a moment|cf-browser-verification|challenge-platform/i.test(html)) return [];

  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $(".m-productCard").slice(0, 28).each((idx, el) => {
    const $el = $(el);
    const brand = $el.find(".m-productCard__title").first().text().replace(/\s+/g, " ").trim();
    // Desc often duplicates text across mobile/desktop spans; deduplicate lines cleanly
    const rawDesc = $el.find(".m-productCard__desc").first().text().trim();
    const descParts = rawDesc
      .split(/\n+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const desc = descParts[0] || "";
    const title = brand && desc && !desc.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${desc}` : desc || brand;
    const priceText = $el.find(".m-productCard__newPrice").first().text().trim();
    const oldPriceText = $el.find(".m-productCard__oldPrice").first().text().trim();
    const price = parseTrPrice(priceText);
    if (!title || !price || price <= 0) return;

    const rel = matchesZeroKeyQuery(title, brand, "", query);
    if (!rel.ok) return;

    const href = ($el.find("a").first().attr("href") || "").trim();
    if (!href || !/\/p_/i.test(href)) return;
    const productUrl = href.startsWith("http")
      ? href
      : `https://www.beymen.com${href.startsWith("/") ? "" : "/"}${href}`;
    if (seen.has(productUrl)) return;
    seen.add(productUrl);

    let image = $el.find("img").first().attr("data-src") || $el.find("img").first().attr("src") || "";
    if (image.startsWith("//")) image = `https:${image}`;
    const listPrice = parseTrPrice(oldPriceText);

    out.push({
      id: `beymen-${idx + 1}`,
      storeName: "Beymen",
      title,
      brand,
      code: extractModelStyleCode("", title),
      price,
      listPrice: listPrice && listPrice > price ? listPrice : null,
      image,
      productUrl,
      inStock: true,
      freeShipThreshold: 1500,
      deliveryLabel: "Hızlı Kargo (1-3 gün)",
      deliveryDays: 2,
      category: "Beymen",
      relevanceScore: rel.score,
    });
  });

  return out;
}

async function fetchDrStore(query) {
  const url = `https://www.dr.com.tr/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9",
    },
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return [];
  const html = await res.text();
  if (/Just a moment|cf-browser-verification|challenge-platform/i.test(html)) return [];

  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $(".prd").slice(0, 28).each((idx, el) => {
    const $el = $(el);
    let gtm = null;
    const rawGtm = $el.attr("data-gtm");
    if (rawGtm) {
      try {
        gtm = JSON.parse(rawGtm);
      } catch {
        // Ignore malformed JSON
      }
    }

    const title = String(gtm?.item_name || $el.find(".prd-name").first().text() || "")
      .replace(/\s+/g, " ")
      .trim();
    const brand = String(gtm?.item_brand || "").trim();
    const gtmPrice = gtm?.price ? Number.parseFloat(gtm.price) : null;
    // D&R often displays a lower "Sepette X TL" checkout price inside .prd-price alongside the list price
    const cardPriceText = $el.find("[class*='price']").text();
    const cardPrices = [...cardPriceText.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:TL|₺)/gi)]
      .map((m) => parseTrPrice(m[1]))
      .filter((v) => typeof v === "number" && v >= 10);
    const minCardPrice = cardPrices.length ? Math.min(...cardPrices) : null;
    const price =
      minCardPrice && gtmPrice
        ? Math.min(minCardPrice, gtmPrice)
        : minCardPrice || gtmPrice;
    const listPrice =
      gtmPrice && minCardPrice && gtmPrice > minCardPrice
        ? Math.round(gtmPrice * 100) / 100
        : null;
    if (!title || !Number.isFinite(price) || price <= 0) return;

    const rel = matchesZeroKeyQuery(title, brand, gtm?.item_id || "", query);
    if (!rel.ok) return;

    const href = ($el.find("a").first().attr("href") || "").trim();
    if (!href || !/urunno=/i.test(href)) return;
    const productUrl = href.startsWith("http")
      ? href
      : `https://www.dr.com.tr${href.startsWith("/") ? "" : "/"}${href}`;
    if (seen.has(productUrl)) return;
    seen.add(productUrl);

    let image = $el.find("img").first().attr("data-src") || $el.find("img").first().attr("src") || "";
    if (image.startsWith("//")) image = `https:${image}`;

    out.push({
      id: `dr-${gtm?.item_id || idx + 1}`,
      storeName: "D&R",
      title,
      brand,
      code: extractModelStyleCode("", title),
      price: Math.round(price * 100) / 100,
      listPrice,
      image,
      productUrl,
      inStock: gtm?.item_stock !== "No",
      freeShipThreshold: 1000,
      deliveryLabel: "Hızlı Kargo (1-3 gün)",
      deliveryDays: 2,
      category: gtm?.item_category || "D&R",
      relevanceScore: rel.score,
    });
  });

  return out;
}

/**
 * Merges identical zero-key store items across Turkish retailers by EAN-13 barcode,
 * manufacturer model code (e.g. KI4392 on Intersport + SuperStep), or normalized title,
 * building full FiyatRadar detail payloads with basket discounts, coupons, stock urgency & gallery.
 */
export function mergeZeroKeyStoreItems(rawItems, query) {
  const groups = new Map();

  for (const item of rawItems) {
    const titleKey = normalizeZeroKeyText(item.title)
      .split(" ")
      .filter((w) => !ZERO_KEY_STOP_WORDS.has(w))
      .slice(0, 7)
      .join(" ");
    const groupKey = item.barcode
      ? `ean:${item.barcode}`
      : item.code
        ? `code:${item.code}`
        : `title:${titleKey}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(item);
  }

  const products = [];
  const encodedQ = encodeURIComponent(query.slice(0, 60));
  let groupSeq = 0;

  for (const [, items] of groups.entries()) {
    // Keep cheapest effective offer per store within the merged product
    const effectivePriceOf = (it) =>
      typeof it.basketPrice === "number" && it.basketPrice > 0 && it.basketPrice < it.price
        ? it.basketPrice
        : it.price;

    const perStore = new Map();
    for (const it of items) {
      const sKey = it.storeName.toLowerCase();
      const prev = perStore.get(sKey);
      if (!prev || effectivePriceOf(it) < effectivePriceOf(prev)) {
        perStore.set(sKey, it);
      }
    }

    const storeItems = [...perStore.values()].sort((a, b) => effectivePriceOf(a) - effectivePriceOf(b));
    if (!storeItems.length) continue;

    groupSeq++;
    const best = storeItems[0];
    const bestImage = storeItems.find((x) => x.image)?.image || "";
    const bestBrand = storeItems.find((x) => x.brand)?.brand || "";
    const bestCode = storeItems.find((x) => x.code)?.code || "";
    const bestBarcode = storeItems.find((x) => x.barcode)?.barcode || "";
    const bestGallery = [
      ...new Set(storeItems.flatMap((x) => (Array.isArray(x.gallery) ? x.gallery : x.image ? [x.image] : []))),
    ].slice(0, 6);
    const isAccessory = isAccessoryTitle(best.title, query);
    const maxRelevance = Math.max(...storeItems.map((x) => x.relevanceScore || 0));

    const offers = storeItems.map((it, idx) => {
      const effPrice = effectivePriceOf(it);
      const isFreeShip = effPrice >= (it.freeShipThreshold || 1500);
      const shippingCost = isFreeShip ? 0 : 59.9;
      const promoParts = [];
      if (it.basketPrice && it.basketPrice < it.price) {
        promoParts.push(
          `${it.basketOfferLabel || "Sepette İndirim"} (Vitrin: ${it.price.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL)`
        );
      } else if (it.basketOfferLabel) {
        promoParts.push(it.basketOfferLabel);
      }
      if (it.couponCode) {
        promoParts.push(`Kupon: ${it.couponCode}`);
      }
      if (it.listPrice && it.listPrice > it.price) {
        promoParts.push(`Liste: ${it.listPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`);
      }

      const stockLabel =
        it.inStock === false
          ? "Stok yok"
          : typeof it.stockCount === "number" && it.stockCount > 0 && it.stockCount <= 3
            ? `Son ${it.stockCount} adet`
            : "Stokta";

      return {
        id: `${it.id}-${idx + 1}`,
        offerTitle: it.title,
        basePrice: effPrice,
        stickerPrice: it.basketPrice && it.basketPrice < it.price ? it.price : null,
        basketOfferLabel: it.basketOfferLabel || "",
        couponCode: it.couponCode || "",
        shipping: {
          cost: shippingCost,
          isFree: isFreeShip,
          label: isFreeShip ? "Ücretsiz kargo" : "Tahmini ~59,90 TL kargo",
          unknown: false,
        },
        store: parseStoreInfo(it.storeName, ""),
        storeLogo: null,
        stockText: stockLabel,
        stockCount: it.stockCount ?? null,
        inStock: it.inStock !== false,
        delivery: { label: it.deliveryLabel || "Kargo ile teslimat", days: it.deliveryDays ?? 2, score: 0.84 },
        lastUpdated: "Canlı Doğrulandı",
        priceVerified: true,
        priceSource: it.basketPrice && it.basketPrice < it.price ? "basket_live" : "live_verified",
        promoNote: promoParts.join(" · "),
        akakceBadge: "",
        url: it.productUrl,
        isDirectLink: true,
      };
    });

    const vKey = `virtual:trnet:${encodedQ}:${groupSeq}`;
    const minPrice = offers[0].basePrice;
    const unitInfo = extractUnitInfo(best.title, minPrice);
    const analysis = analyzeOffers(offers, unitInfo, { productTitle: best.title, category: best.category });
    const listPrices = storeItems.map((x) => x.listPrice).filter((v) => typeof v === "number" && v > 0);
    const refListPrice = listPrices.length ? Math.max(...listPrices) : null;
    const histAnalysis = analyzePriceHistory([], analysis.stats?.minNet ?? minPrice, null, {
      medianNet: analysis.stats?.medianNet ?? minPrice,
      listPrice: refListPrice,
    });

    const storeListText = storeItems.map((x) => x.storeName).join(", ");
    const mergedSizesSet = new Set();
    for (const x of storeItems) {
      for (const sz of x.availableSizes || []) mergedSizesSet.add(sz);
    }
    const availableSizes = sortAvailableSizes([...mergedSizesSet]);
    const bestBasketItem = storeItems.find((x) => x.basketPrice && x.basketPrice < x.price) || storeItems.find((x) => x.couponCode);
    const lowStockItem = storeItems.find((x) => typeof x.stockCount === "number" && x.stockCount > 0 && x.stockCount <= 3);

    saveVirtualDetail(vKey, {
      id: `trnet-${groupSeq}-${bestCode || best.id}`,
      title: best.title,
      brand: bestBrand,
      category: best.category || "Türkiye Mağazaları",
      description: `${best.title} — ${storeListText} canlı yetkili mağaza fiyatları.`,
      url: vKey,
      image: bestImage,
      gallery: bestGallery,
      rating: null,
      totalOfferCount: offers.length,
      unitInfo: unitInfo ? extractUnitInfo(best.title, analysis.stats?.minNet ?? minPrice) : null,
      fetchedAt: new Date().toISOString(),
      cached: false,
      provider: storeItems.length > 1 ? `${storeItems.length} Canlı Mağaza (${storeListText})` : best.storeName,
      lowPrice: analysis.stats?.minNet ?? minPrice,
      highPrice: analysis.stats?.maxNet ?? minPrice,
      stats: analysis.stats,
      picks: analysis.picks,
      shippingTraps: analysis.shippingTraps,
      platformBreakdown: analysis.platformBreakdown,
      trustSummary: analysis.trustSummary,
      offers: analysis.offers,
      history: [],
      historySummary: null,
      fakeDiscount: histAnalysis.fakeDiscount,
      verdict: histAnalysis.verdict,
      variants: [],
      availableSizes,
      barcode: bestBarcode || null,
      basketOfferLabel: bestBasketItem?.basketOfferLabel || "",
      couponCode: bestBasketItem?.couponCode || "",
      specs: [
        ...(bestCode ? [{ name: "Ürün / Model Kodu", value: bestCode }] : []),
        ...(bestBarcode ? [{ name: "EAN-13 Barkod", value: bestBarcode }] : []),
        ...(bestBrand ? [{ name: "Marka", value: bestBrand }] : []),
        ...(availableSizes.length ? [{ name: "Stoktaki Beden / Numaralar", value: availableSizes.join(", ") }] : []),
        ...(bestBasketItem?.basketOfferLabel ? [{ name: "Sepet Kampanyası", value: bestBasketItem.basketOfferLabel }] : []),
        ...(bestBasketItem?.couponCode ? [{ name: "Canlı Kupon Kodu", value: bestBasketItem.couponCode }] : []),
        ...(refListPrice && refListPrice > minPrice
          ? [{ name: "İndirimsiz Liste Fiyatı", value: `${refListPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` }]
          : []),
      ],
    });

    products.push({
      id: `trnet-${groupSeq}-${bestCode || best.id}`,
      title: best.title,
      url: vKey,
      externalUrl: best.productUrl,
      isListingPage: false,
      image: bestImage,
      lowestPrice: minPrice,
      stickerPrice: best.basketPrice && best.basketPrice < best.price ? best.price : null,
      basketOfferLabel: bestBasketItem?.basketOfferLabel || "",
      couponCode: bestBasketItem?.couponCode || "",
      stockCount: lowStockItem?.stockCount ?? null,
      barcode: bestBarcode || "",
      modelCode: bestCode || "",
      priceSource: best.basketPrice && best.basketPrice < best.price ? "basket_live" : "live_verified",
      priceVerified: true,
      availableSizes,
      offerCount: offers.length,
      badge: offers.length > 1 ? `${offers.length} Mağazada Kıyasla` : best.storeName,
      source: offers.length > 1 ? storeListText : best.storeName,
      isOfficialStore: true,
      isFreeShipping: offers.some((o) => o.shipping?.isFree),
      isAccessory,
      unitInfo,
      _relScore: maxRelevance,
    });
  }

  // Sort: non-accessories first, then multi-store comparisons, then relevance, then price
  products.sort((a, b) => {
    if (Boolean(a.isAccessory) !== Boolean(b.isAccessory)) return a.isAccessory ? 1 : -1;
    if ((b.offerCount > 1) !== (a.offerCount > 1)) return b.offerCount > 1 ? 1 : -1;
    if ((b._relScore || 0) !== (a._relScore || 0)) return (b._relScore || 0) - (a._relScore || 0);
    return (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity);
  });

  return products.map(({ _relScore, ...rest }) => rest);
}

/**
 * Combines real-time live official Turkish store results (100% live checkout prices)
 * with Serper/SerpAPI Google TR direct store results, preferring live store API prices
 * on matching URLs/barcodes and enriching the "Tüm Mağazalar" summary card with live offers.
 */
export function mergeLiveAndSerperResults(serperResult, liveResult) {
  const serperProds = Array.isArray(serperResult?.products) ? serperResult.products : [];
  const liveProds = Array.isArray(liveResult?.products) ? liveResult.products : [];
  if (!liveProds.length) return serperResult;
  if (!serperProds.length) return liveResult;

  const liveUrlSet = new Set();
  const liveBarcodeSet = new Set();
  for (const lp of liveProds) {
    if (lp.externalUrl) liveUrlSet.add(normalizeUrlForMatch(lp.externalUrl));
    if (lp.barcode) liveBarcodeSet.add(lp.barcode);
  }

  // Compute median of live verified prices so wildly stale/wrong unverified Google snippets
  // (e.g. a 1.399 TL outdated snippet when live stores are 4.400 TL) can be detected
  const livePrices = liveProds
    .filter((p) => !p.isAccessory && typeof p.lowestPrice === "number" && p.lowestPrice > 0)
    .map((p) => p.lowestPrice)
    .sort((a, b) => a - b);
  const liveMedian = livePrices.length >= 3 ? livePrices[Math.floor(livePrices.length / 2)] : null;

  const filteredSerper = serperProds.filter((sp) => {
    if (sp.badge === "Tüm Mağazalar") return true;
    if (sp.externalUrl && liveUrlSet.has(normalizeUrlForMatch(sp.externalUrl))) {
      // Live store API already has the exact real-time checkout price for this URL!
      return false;
    }
    // Drop unverified Google SERP snippets that are suspiciously < 45% of verified live market median
    if (
      liveMedian &&
      sp.priceVerified === false &&
      !sp.isAccessory &&
      typeof sp.lowestPrice === "number" &&
      sp.lowestPrice > 0 &&
      sp.lowestPrice < liveMedian * 0.45
    ) {
      return false;
    }
    return true;
  });

  // Enrich the "Tüm Mağazalar" aggregate detail with top live zero-key offers so users see all stores together
  const summaryCards = filteredSerper.filter((p) => p.badge === "Tüm Mağazalar");
  if (summaryCards.length === 1 && summaryCards[0].url) {
    const aggKey = summaryCards[0].url;
    const aggDetail = getVirtualDetail(aggKey);
    if (aggDetail && Array.isArray(aggDetail.offers)) {
      const seenOfferUrls = new Set(aggDetail.offers.map((o) => normalizeUrlForMatch(o.url || "")));
      const extraOffers = [];
      for (const lp of liveProds.filter((p) => !p.isAccessory).slice(0, 12)) {
        const lDet = getVirtualDetail(lp.url);
        for (const lo of lDet?.offers || []) {
          const uKey = normalizeUrlForMatch(lo.url || "");
          if (!uKey || seenOfferUrls.has(uKey)) continue;
          seenOfferUrls.add(uKey);
          extraOffers.push(lo);
        }
      }
      if (extraOffers.length > 0) {
        const combinedOffers = [...aggDetail.offers, ...extraOffers];
        const reAnalysis = analyzeOffers(combinedOffers, aggDetail.unitInfo || null, {
          productTitle: aggDetail.title,
          category: aggDetail.category,
        });
        saveVirtualDetail(aggKey, {
          ...aggDetail,
          totalOfferCount: combinedOffers.length,
          lowPrice: reAnalysis.stats?.minNet ?? aggDetail.lowPrice,
          highPrice: reAnalysis.stats?.maxNet ?? aggDetail.highPrice,
          stats: reAnalysis.stats,
          picks: reAnalysis.picks,
          shippingTraps: reAnalysis.shippingTraps,
          platformBreakdown: reAnalysis.platformBreakdown,
          trustSummary: reAnalysis.trustSummary,
          offers: reAnalysis.offers,
          provider: `${aggDetail.provider || "Google Türkiye"} + Canlı Mağazalar`,
        });
        summaryCards[0] = {
          ...summaryCards[0],
          lowestPrice: reAnalysis.stats?.minNet ?? summaryCards[0].lowestPrice,
          offerCount: combinedOffers.length,
        };
      }
    }
  }

  const serperDirect = filteredSerper.filter((p) => p.badge !== "Tüm Mağazalar" && !p.isListingPage);
  const serperListings = filteredSerper.filter((p) => p.isListingPage);

  // Interleave: live-verified official multi-store matches lead, followed by Serper direct stores (Trendyol/HB/Amazon)
  const merged = [...summaryCards, ...liveProds.slice(0, 28), ...serperDirect, ...serperListings];

  return {
    ...serperResult,
    provider: `${serperResult.provider} + Canlı Mağazalar`,
    totalFound: merged.length,
    products: merged,
  };
}

/**
 * Provider 3 (Zero-Key Cloud-Proof Official Turkish Store Network — 23 Live Stores):
 * Works out-of-the-box on any cloud IP (Render, Railway, Fly, etc.) with ZERO API key!
 * Uses category-aware store routing so Render Free stays fast and lean.
 */
export async function searchOfficialFallback(query, options = {}) {
  const route = selectZeroKeyStoresForQuery(query);
  const [
    akinonBatches,
    beymenItems,
    drItems,
    gratisItems,
    gamingGenItems,
    marketItems,
    migrosElec,
    migrosMarket,
  ] = await Promise.all([
    Promise.all(route.akinonStores.map((store) => fetchAkinonStore(store, query).catch(() => []))),
    route.beymen ? fetchBeymen(query).catch(() => []) : Promise.resolve([]),
    route.dr ? fetchDrStore(query).catch(() => []) : Promise.resolve([]),
    route.gratis ? fetchGratis(query).catch(() => []) : Promise.resolve([]),
    route.gamingGen ? fetchGamingGenTr(query).catch(() => []) : Promise.resolve([]),
    route.marketFiyati ? fetchMarketFiyati(query, options.location || {}).catch(() => []) : Promise.resolve([]),
    route.migrosElec ? fetchMigros(query, "elektronik").catch(() => []) : Promise.resolve([]),
    route.migrosMarket ? fetchMigros(query, "market").catch(() => []) : Promise.resolve([]),
  ]);

  const flatRetailItems = [
    ...akinonBatches.flat(),
    ...beymenItems,
    ...drItems,
    ...gratisItems,
    ...gamingGenItems,
  ];
  const mergedRetail = mergeZeroKeyStoreItems(flatRetailItems, query);

  const combined = [];
  const seenTitles = new Set();

  for (const item of [...mergedRetail, ...marketItems, ...migrosElec, ...migrosMarket]) {
    const key = item.title.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    combined.push(item);
  }

  // Sort combined list so non-accessories & multi-store offers lead cleanly
  combined.sort((a, b) => {
    if (Boolean(a.isAccessory) !== Boolean(b.isAccessory)) return a.isAccessory ? 1 : -1;
    if ((b.offerCount > 1) !== (a.offerCount > 1)) return b.offerCount > 1 ? 1 : -1;
    return 0;
  });

  const activeStores = new Set();
  for (const it of combined) {
    if (it.source) {
      for (const s of String(it.source).split(",")) {
        const t = s.trim();
        if (t) activeStores.add(t);
      }
    }
  }
  const storePreview = [...activeStores].slice(0, 4).join(", ");
  const extraCount = Math.max(0, activeStores.size - 4);
  const providerLabel = storePreview
    ? extraCount > 0
      ? `${storePreview} +${extraCount} mağaza`
      : storePreview
    : "Canlı Türkiye Mağaza Ağı";

  return {
    query,
    provider: providerLabel,
    vertical: route.vertical,
    fallbackMode: true,
    directProduct: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
    totalFound: combined.length,
    products: combined.slice(0, 60),
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

async function fetchMarketFiyati(query, locOpts = {}) {
  const payload = { keywords: query, pages: 0, size: 20 };
  const hasCoords =
    typeof locOpts.lat === "number" &&
    Number.isFinite(locOpts.lat) &&
    typeof locOpts.lng === "number" &&
    Number.isFinite(locOpts.lng);
  if (hasCoords) {
    payload.latitude = locOpts.lat;
    payload.longitude = locOpts.lng;
    payload.distance = Math.min(25, Math.max(1, Number(locOpts.distance) || 5));
  }

  const res = await fetch("https://api.marketfiyati.org.tr/api/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
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
      let distKm = null;
      if (hasCoords && typeof d.latitude === "number" && typeof d.longitude === "number") {
        distKm = haversineKm(locOpts.lat, locOpts.lng, d.latitude, d.longitude);
      }
      const promoParts = [];
      if (d.discount && d.discountlessPrice) {
        promoParts.push(`İndirimsiz: ${Number(d.discountlessPrice).toLocaleString("tr-TR")} TL`);
      }
      if (typeof d.discountRatio === "number" && d.discountRatio > 0) {
        promoParts.push(`%${Math.round(d.discountRatio)} indirim`);
      }
      if (d.promotionText && String(d.promotionText).trim()) {
        promoParts.push(String(d.promotionText).trim());
      }
      const depotDisplay = distKm !== null ? `${d.depotName || "Şube"} (${distKm} km)` : d.depotName || "";

      return {
        id: `mf-${item.id}-${idx + 1}`,
        offerTitle: item.title,
        basePrice: d.price,
        shipping: { cost: 0, isFree: true, label: "Mağaza / Market Fiyatı", unknown: false },
        store: parseStoreInfo(marketLabel, depotDisplay),
        storeLogo: null,
        stockText: "Mağazada",
        inStock: true,
        delivery: { label: distKm !== null ? `${distKm} km · Şube` : "Şube / Online", days: 0, score: 0.9 },
        lastUpdated: d.indexTime || "",
        promoNote: promoParts.join(" · "),
        akakceBadge: "",
        url: `https://marketfiyati.org.tr/ara?q=${encodeURIComponent(item.title)}`,
        isDirectLink: true,
      };
    });

    if (!chainOffers.length) continue;

    const vKey = `virtual:mf:${item.id}`;
    const minPrice = Math.min(...chainOffers.map((o) => o.basePrice));
    const volumeStr = String(item.refinedVolumeOrWeight || "").trim();
    const officialUnitStr = String(
      depots.find((d) => d.unitPrice)?.unitPrice || item.unitPrice || ""
    ).trim();
    const parsedUnit = extractUnitInfo(`${item.title} ${volumeStr}`.trim(), minPrice);
    const unitInfo =
      parsedUnit ||
      (officialUnitStr
        ? {
            formatted: officialUnitStr,
            rawMatch: volumeStr || officialUnitStr,
            unitPrice: null,
            unitLabel: "",
            quantity: 0,
          }
        : null);
    const analysis = analyzeOffers(chainOffers, parsedUnit, { productTitle: item.title, category: "Market" });
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
      unitInfo: parsedUnit ? extractUnitInfo(`${item.title} ${volumeStr}`.trim(), analysis.stats?.minNet ?? minPrice) : unitInfo,
      fetchedAt: new Date().toISOString(),
      cached: false,
      provider: "T.C. Market Fiyatı (TÜBİTAK)",
      lowPrice: analysis.stats?.minNet ?? minPrice,
      highPrice: analysis.stats?.maxNet ?? minPrice,
      stats: analysis.stats,
      picks: analysis.picks,
      shippingTraps: analysis.shippingTraps,
      platformBreakdown: analysis.platformBreakdown,
      trustSummary: analysis.trustSummary,
      offers: analysis.offers,
      history: [],
      historySummary: null,
      verdict: histAnalysis.verdict,
      variants: [],
      specs: [
        ...(volumeStr ? [{ name: "Miktar / Ağırlık", value: volumeStr }] : []),
        ...(officialUnitStr ? [{ name: "Resmi Birim Fiyat", value: officialUnitStr }] : []),
      ],
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

const MIGROS_BADGE_LABELS = {
  GREAT_PRICE: "Harika Fiyat",
  DELIST_SALEABLE: "Stok Eritme Fırsatı",
  NEW_PRODUCT: "Yeni Ürün",
};

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

    // Relevance guard so unrelated Migros recommendations don't pollute search results
    const rel = matchesZeroKeyQuery(title, it.brand?.name || "", String(it.sku || ""), query);
    if (!rel.ok) continue;

    const gallery = (Array.isArray(it.images) ? it.images : [])
      .map((im) => im?.urls?.PRODUCT_DETAIL || im?.urls?.PRODUCT_LIST || "")
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 6);
    const image = gallery[0] || "";
    const directUrl =
      vertical === "elektronik"
        ? `https://www.migros.com.tr/elektronik/${it.prettyName}`
        : `https://www.migros.com.tr/${it.prettyName}`;

    const badgeLabels = [
      ...new Set(
        (Array.isArray(it.badges) ? it.badges : [])
          .map((b) => MIGROS_BADGE_LABELS[b?.name || b] || "")
          .filter(Boolean)
      ),
    ];
    const crmTags = (Array.isArray(it.crmDiscountTags) ? it.crmDiscountTags : [])
      .map((t) => String(t?.tag || t?.name || (typeof t === "string" ? t : "")).trim())
      .filter(Boolean);
    const promoParts = [];
    if (crmTags.length) promoParts.push(crmTags[0]);
    if (badgeLabels.length) promoParts.push(badgeLabels[0]);
    if (regularPrice && regularPrice > price) {
      promoParts.push(`Liste: ${regularPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`);
    }

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
      promoNote: promoParts.join(" · "),
      akakceBadge: "",
      url: directUrl,
      isDirectLink: true,
    };

    const parsedUnit = extractUnitInfo(title, price);
    const officialUnitText = String(it.unitPrice || "").replace(/^\(|\)$/g, "").trim();
    const unitInfo =
      parsedUnit ||
      (officialUnitText
        ? { formatted: officialUnitText, rawMatch: officialUnitText, unitPrice: null, unitLabel: "", quantity: 0 }
        : null);
    const analysis = analyzeOffers([offer], parsedUnit, { productTitle: title, category: platformLabel });
    const histAnalysis = analyzePriceHistory([], price, null, {
      medianNet: analysis.stats?.medianNet ?? price,
      listPrice: regularPrice && regularPrice > price ? regularPrice : null,
    });

    saveVirtualDetail(vKey, {
      id: `mg-${it.id}`,
      title,
      brand: it.brand?.name || "",
      category: platformLabel,
      description: `${title} — ${platformLabel} canlı fiyatı.`,
      url: vKey,
      image,
      gallery,
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
      trustSummary: analysis.trustSummary,
      offers: analysis.offers,
      history: [],
      historySummary: null,
      fakeDiscount: histAnalysis.fakeDiscount,
      verdict: histAnalysis.verdict,
      variants: [],
      specs: [
        ...(officialUnitText ? [{ name: "Birim Fiyat", value: officialUnitText }] : []),
        ...(crmTags.length ? [{ name: "Money / Kampanya", value: crmTags.join(" · ") }] : []),
        ...(badgeLabels.length ? [{ name: "Migros Etiketi", value: badgeLabels.join(", ") }] : []),
        ...(regularPrice && regularPrice > price
          ? [{ name: "İndirimsiz Liste Fiyatı", value: `${regularPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` }]
          : []),
      ],
    });

    products.push({
      id: `mg-${it.id}`,
      title,
      url: vKey,
      externalUrl: directUrl,
      isListingPage: false,
      image,
      lowestPrice: price,
      priceVerified: true,
      priceSource: "live_verified",
      offerCount: 1,
      badge: platformLabel,
      source: platformLabel,
      basketOfferLabel: crmTags[0] || badgeLabels[0] || "",
      isOfficialStore: true,
      isFreeShipping: price >= 500,
      isAccessory: isAccessoryTitle(title, query),
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
