/**
 * Universal Turkish e-commerce URL resolver.
 * Accepts links copied from Trendyol, Hepsiburada, Amazon TR, Stradivarius, Zara,
 * Mango, Boyner, n11, MediaMarkt, Teknosa, Vatan, Pazarama, idefix, Cimri, Migros,
 * plus short links (ty.gl, amzn.eu, hb.biz) and extracts a clean search query to
 * find cheaper offers across ALL competing Turkish stores.
 */

const ALLOWED_SHORTENERS = new Set([
  "ty.gl",
  "amzn.eu",
  "amzn.to",
  "hb.biz",
  "app.hb.biz",
  "link.migros.com.tr",
]);

const KNOWN_STORES = [
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
  ["cimri.com", "Cimri"],
  ["akakce.com", "Akakçe"],
  ["epey.com", "Epey"],
  ["migros.com.tr", "Migros"],
  ["stradivarius.com", "Stradivarius"],
  ["zara.com", "Zara"],
  ["mango.com", "Mango"],
  ["bershka.com", "Bershka"],
  ["pullandbear.com", "Pull&Bear"],
  ["massimodutti.com", "Massimo Dutti"],
  ["boyner.com.tr", "Boyner"],
  ["beymen.com", "Beymen"],
  ["flo.com.tr", "FLO"],
  ["lcw.com", "LC Waikiki"],
  ["lcwaikiki.com", "LC Waikiki"],
  ["koton.com", "Koton"],
  ["defacto.com.tr", "DeFacto"],
  ["mavi.com", "Mavi"],
  ["nike.com", "Nike Türkiye"],
  ["adidas.com.tr", "Adidas Türkiye"],
  ["superstep.com.tr", "SuperStep"],
  ["decathlon.com.tr", "Decathlon"],
  ["ciceksepeti.com", "Çiçeksepeti"],
  ["dr.com.tr", "D&R"],
  ["koctas.com.tr", "Koçtaş"],
  ["ikea.com.tr", "IKEA Türkiye"],
  ["sephora.com.tr", "Sephora"],
  ["watsons.com.tr", "Watsons"],
  ["gratis.com", "Gratis"],
  ["dyson.com.tr", "Dyson Türkiye"],
  ["turkcell.com.tr", "Turkcell Pasaj"],
  ["itopya.com", "İtopya"],
  ["incehesap.com", "İncehesap"],
  ["sinerji.gen.tr", "Sinerji"],
  ["gaming.gen.tr", "Gaming.Gen.TR"],
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function matchKnownStore(hostname) {
  const host = String(hostname || "").replace(/^www\.|^m\./i, "").toLowerCase();
  for (const [domain, label] of KNOWN_STORES) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return { domain, label, host };
    }
  }
  return null;
}

/**
 * Checks whether input looks like a non-Akakce store URL we should resolve.
 */
export function isExternalStoreUrl(input) {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\.|^m\./i, "").toLowerCase();
    // Akakce product URLs are handled natively by Akakce detail parser
    if (host === "akakce.com" && u.pathname.includes("fiyati,")) return false;
    return ALLOWED_SHORTENERS.has(host) || Boolean(matchKnownStore(host));
  } catch {
    return false;
  }
}

/**
 * Extracts a clean, human-readable product search query directly from a Turkish
 * e-commerce URL path (instant, 0ms, immune to cloud 403 blocks).
 */
export function extractQueryFromStoreUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\.|^m\./i, "").toLowerCase();
  const store = matchKnownStore(host);
  const storeName = store?.label || "";

  // Clean path segments
  const rawSegments = u.pathname
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean);

  if (!rawSegments.length) return null;

  // Amazon TR: /dp/B0CHXGB3NG or /Apple-iPhone-15-128-GB/dp/B0CHXGB3NG
  if (host.includes("amazon.com.tr")) {
    const dpIdx = rawSegments.findIndex((s) => s.toLowerCase() === "dp" || s.toLowerCase() === "gp");
    if (dpIdx > 0 && rawSegments[dpIdx - 1].length > 3) {
      return cleanSlug(rawSegments[dpIdx - 1]);
    }
    const asin = dpIdx >= 0 ? rawSegments[dpIdx + 1] : rawSegments.find((s) => /^B0[A-Z0-9]{8}$/i.test(s));
    if (asin) return asin.toUpperCase();
  }

  // Trendyol: /apple/iphone-17-256gb-siyah-p-985256842 -> "apple iphone 17 256gb siyah"
  if (host.includes("trendyol.com")) {
    const prodSeg = rawSegments.find((s) => /-p-\d+$/i.test(s));
    if (prodSeg) {
      const idx = rawSegments.indexOf(prodSeg);
      const brandSeg = idx > 0 && !/^(sr|butik|magaza)$/i.test(rawSegments[idx - 1]) ? rawSegments[idx - 1] : "";
      const prodClean = cleanSlug(prodSeg.replace(/-p-\d+$/i, ""));
      const brandClean = cleanSlug(brandSeg);
      if (brandClean && !prodClean.toLowerCase().startsWith(brandClean.toLowerCase())) {
        return `${brandClean} ${prodClean}`.trim();
      }
      return prodClean;
    }
  }

  // Hepsiburada: /apple-iphone-15-128-gb-mavi-p-HBCV00004X9ZCK
  if (host.includes("hepsiburada.com")) {
    const prodSeg = rawSegments.find((s) => /-p-[a-z0-9]+$/i.test(s) || /-pm-[a-z0-9]+$/i.test(s));
    if (prodSeg) {
      return cleanSlug(prodSeg.replace(/-pm?-[a-z0-9]+$/i, ""));
    }
  }

  // Cimri: /cep-telefonlari/en-ucuz-apple-iphone-17-fiyatlari,a2393572193
  if (host.includes("cimri.com")) {
    const prodSeg = rawSegments[rawSegments.length - 1];
    return cleanSlug(
      prodSeg
        .replace(/,[a-z]?\d+$/i, "")
        .replace(/^en-ucuz-/i, "")
        .replace(/-fiyatlari$/i, "")
        .replace(/-fiyati$/i, "")
    );
  }

  // n11: /urun/apple-iphone-15-128-gb-43821353
  if (host.includes("n11.com")) {
    const prodSeg = rawSegments[rawSegments.length - 1];
    return cleanSlug(prodSeg.replace(/-\d{6,}$/, ""));
  }

  // Inditex brands (Stradivarius, Zara, Bershka, Pull&Bear, Massimo Dutti)
  if (/stradivarius|zara|bershka|pullandbear|massimodutti/.test(host)) {
    const meaningful = [...rawSegments]
      .reverse()
      .find((s) => s.length > 5 && !/^(tr|en|kadin|erkek|tumu|product|urun)$/i.test(s));
    if (meaningful) {
      const cleaned = cleanSlug(
        meaningful
          .replace(/\.html$/i, "")
          .replace(/-[lpcn]\d+$/i, "")
          .replace(/-p\d+$/i, "")
      );
      if (storeName && cleaned && !cleaned.toLowerCase().includes(storeName.toLowerCase())) {
        return `${storeName} ${cleaned}`.trim();
      }
      return cleaned;
    }
  }

  // Generic Turkish store fallback: pick the longest meaningful path slug
  const skipWords = new Set(["tr", "en", "urun", "product", "p", "dp", "elektronik", "kadin", "erkek", "kategori", "detail"]);
  const candidates = rawSegments
    .filter((s) => !skipWords.has(s.toLowerCase()) && !/^\d+$/.test(s))
    .map((s) =>
      cleanSlug(
        s
          .replace(/\.html?$/i, "")
          .replace(/-p-[a-z0-9]+$/i, "")
          .replace(/-[a-z]?\d{5,}$/i, "")
          .replace(/,.*$/, "")
      )
    )
    .filter((s) => s.length >= 3);

  if (!candidates.length) return null;
  // Prefer the longest slug segment
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function cleanSlug(str) {
  return String(str || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(fiyati|fiyatlari|en ucuz|modelleri|satin al)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Full async resolver: expands allowed short links (ty.gl, amzn.eu, hb.biz),
 * extracts clean product query from URL slug, and optionally falls back to
 * lightweight <title> extraction if the slug is an opaque ID.
 */
export async function resolveStoreProductUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  let finalUrl = input;

  try {
    const parsed = new URL(input);
    const host = parsed.hostname.replace(/^www\.|^m\./i, "").toLowerCase();

    // Expand known short links safely
    if (ALLOWED_SHORTENERS.has(host)) {
      const res = await fetch(input, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" },
        signal: AbortSignal.timeout(6000),
      });
      if (res.url && /^https?:\/\//i.test(res.url)) {
        const expandedHost = new URL(res.url).hostname.replace(/^www\.|^m\./i, "").toLowerCase();
        if (matchKnownStore(expandedHost)) {
          finalUrl = res.url;
        }
      }
    }
  } catch {
    // Keep original URL if redirect expansion fails
  }

  let storeInfo = null;
  try {
    storeInfo = matchKnownStore(new URL(finalUrl).hostname);
  } catch {
    storeInfo = null;
  }

  let resolvedQuery = extractQueryFromStoreUrl(finalUrl);

  // If slug is an opaque ID (e.g. Amazon ASIN only, or empty), attempt lightweight HTML title fetch
  if (!resolvedQuery || /^[A-Z0-9]{8,14}$/.test(resolvedQuery)) {
    try {
      const res = await fetch(finalUrl, {
        headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 35000);
        const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const rawTitle = (ogMatch?.[1] || titleMatch?.[1] || "")
          .replace(/\|.*$/, "")
          .replace(/\s*[-–]\s*(Trendyol|Hepsiburada|Amazon\.com\.tr|n11|MediaMarkt|Teknosa|Vatan|Migros|Akakçe|Cimri).*$/i, "")
          .replace(/\s+/g, " ")
          .trim();
        if (rawTitle.length >= 4 && !/robot|captcha|erişim|access denied|just a moment/i.test(rawTitle)) {
          resolvedQuery = rawTitle.slice(0, 90);
        }
      }
    } catch {
      // Fall back to slug/ASIN
    }
  }

  return {
    originalUrl: input,
    expandedUrl: finalUrl,
    sourceStore: storeInfo?.label || "Mağaza",
    resolvedQuery: resolvedQuery || "",
  };
}
