/**
 * Turkish e-commerce price, shipping, store, and unit-price parsing utilities.
 */

const TRUSTED_PLATFORMS = {
  "amazon türkiye": 1.0,
  "amazon": 1.0,
  "hepsiburada": 0.96,
  "trendyol": 0.94,
  "mediamarkt": 0.95,
  "teknosa": 0.94,
  "vatan bilgisayar": 0.94,
  "vatan": 0.94,
  "migros": 0.93,
  "migros sanal market ekstra": 0.93,
  "migros ekstra": 0.93,
  "d&r": 0.92,
  "n11": 0.88,
  "pazarama": 0.88,
  "idefix": 0.87,
  "çiçeksepeti": 0.85,
  "pttavm": 0.82,
  "a101": 0.86,
  "carrefoursa": 0.88,
  "koçtaş": 0.88,
  "itopya": 0.91,
  "sinerji": 0.89,
  "incehesap": 0.89,
  "gaming.gen.tr": 0.89,
  "gürgençler": 0.95,
  "troy": 0.95,
  "pt": 0.94,
  "pozitif teknoloji": 0.94,
};

const OFFICIAL_SELLER_KEYWORDS = [
  "yetkili",
  "resmi",
  "official",
  "premium",
  "mediamarkt",
  "teknosa",
  "vatan",
  "hepsiburada",
  "amazon",
  "trendyol",
  "gürgençler",
  "troy",
  "migros",
  "carrefoursa",
  "dyson",
  "philips",
  "samsung",
  "apple",
  "sony",
  "bosch",
  "siemens",
  "arçelik",
  "beko",
  "lg",
  "xiaomi",
];

/**
 * Parses Turkish formatted price strings like "54.999,00 TL", "+44,99 TL kargo", "717,80".
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
export function parseTrPrice(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (!raw || typeof raw !== "string") return null;

  // Extract first Turkish-style numeric token: digits with optional dot thousands and comma decimals
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d{1,3}(?:\.\d{3})+|\d+(?:\.\d{1,2})?)/);
  if (!match) return null;

  let token = match[1];
  if (token.includes(",")) {
    // Turkish format: dots are thousands separators, comma is decimal separator
    token = token.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(token)) {
    // Dot-separated thousands without decimals (e.g., "54.999")
    token = token.replace(/\./g, "");
  }

  const val = Number.parseFloat(token);
  return Number.isFinite(val) ? Math.round(val * 100) / 100 : null;
}

/**
 * Parses shipping text such as "Ücretsiz kargo", "+44,99 TL kargo", "Kargo Dahil", "".
 * @param {string} rawText
 * @returns {{ cost: number, isFree: boolean, label: string, unknown: boolean }}
 */
export function parseShipping(rawText) {
  const txt = (rawText || "").replace(/\s+/g, " ").trim();
  const lower = txt.toLocaleLowerCase("tr-TR");

  if (!txt) {
    return { cost: 0, isFree: false, label: "Belirtilmemiş", unknown: true };
  }
  if (
    lower.includes("ücretsiz") ||
    lower.includes("bedava") ||
    lower.includes("kargo dahil") ||
    lower.includes("kargo bedava")
  ) {
    return { cost: 0, isFree: true, label: "Ücretsiz kargo", unknown: false };
  }

  const amount = parseTrPrice(txt);
  if (amount !== null && amount >= 0) {
    return {
      cost: amount,
      isFree: amount === 0,
      label: amount === 0 ? "Ücretsiz kargo" : `+${formatTrNumber(amount)} TL kargo`,
      unknown: false,
    };
  }

  return { cost: 0, isFree: false, label: txt, unknown: true };
}

/**
 * Parses Turkish date string "DD.MM.YYYY" into ISO "YYYY-MM-DD".
 * @param {string} raw
 * @returns {string|null}
 */
export function parseTrDate(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Normalizes platform and sub-seller info from Akakce's `.v_v8` cell.
 * @param {string} imgAlt
 * @param {string} rawText
 */
export function parseStoreInfo(imgAlt, rawText) {
  const cleanAlt = (imgAlt || "").replace(/\s+/g, " ").trim();
  const cleanTxt = (rawText || "").replace(/\s+/g, " ").trim();

  let platform = cleanAlt;
  let seller = "";

  if (cleanTxt) {
    if (cleanTxt.startsWith("/")) {
      seller = cleanTxt.slice(1).trim();
    } else if (cleanTxt.includes("/")) {
      const parts = cleanTxt.split("/").map((p) => p.trim()).filter(Boolean);
      if (!platform && parts.length > 0) {
        platform = parts[0];
        seller = parts.slice(1).join(" / ");
      } else if (parts.length > 1) {
        seller = parts.slice(1).join(" / ");
      } else {
        seller = parts[0] || "";
      }
    } else if (!platform) {
      platform = cleanTxt;
    } else if (cleanTxt.toLocaleLowerCase("tr-TR") !== platform.toLocaleLowerCase("tr-TR")) {
      seller = cleanTxt;
    }
  }

  if (!platform) platform = "Diğer Mağaza";

  const platLower = platform.toLocaleLowerCase("tr-TR");
  const sellerLower = seller.toLocaleLowerCase("tr-TR");

  // Clean duplicate seller like "Trendyol / Trendyol"
  if (seller && sellerLower === platLower) {
    seller = "";
  }

  const displayName = seller ? `${platform} / ${seller}` : platform;

  // Compute trust score (0.65 - 1.0)
  let trustScore = 0.72;
  for (const [key, score] of Object.entries(TRUSTED_PLATFORMS)) {
    if (platLower.includes(key)) {
      trustScore = Math.max(trustScore, score);
    }
  }

  // Official / direct marketplace seller bonus
  let isOfficialSeller = false;
  if (!seller && (platLower.includes("amazon") || platLower.includes("hepsiburada") || platLower.includes("trendyol") || platLower.includes("mediamarkt") || platLower.includes("teknosa") || platLower.includes("vatan") || platLower.includes("migros"))) {
    isOfficialSeller = true;
    trustScore = Math.min(1.0, trustScore + 0.04);
  } else if (seller && OFFICIAL_SELLER_KEYWORDS.some((kw) => sellerLower.includes(kw))) {
    isOfficialSeller = true;
    trustScore = Math.min(1.0, trustScore + 0.05);
  }

  return {
    platform,
    seller,
    displayName,
    trustScore: Math.round(trustScore * 100) / 100,
    isOfficialSeller,
  };
}

/**
 * Extracts delivery speed score (0-1) and normalized days estimate.
 * @param {string} deliveryText
 */
export function parseDeliverySpeed(deliveryText) {
  const txt = (deliveryText || "").replace(/\s+/g, " ").trim();
  const lower = txt.toLocaleLowerCase("tr-TR");

  if (!txt) return { label: "Standart", days: 3, score: 0.55 };
  if (lower.includes("aynı gün") || lower.includes("bugün")) {
    return { label: txt, days: 0, score: 1.0 };
  }
  if (lower.includes("yarın")) {
    return { label: txt, days: 1, score: 0.92 };
  }
  const dayMatch = lower.match(/(\d+)\s*(?:iş\s*)?gün/);
  if (dayMatch) {
    const days = Number.parseInt(dayMatch[1], 10);
    const score = days <= 1 ? 0.9 : days === 2 ? 0.78 : days <= 3 ? 0.65 : days <= 5 ? 0.45 : 0.3;
    return { label: txt, days, score };
  }
  return { label: txt, days: 3, score: 0.55 };
}

/**
 * Extracts measurable quantity/weight/volume/count/storage from Turkish product titles
 * to calculate accurate unit prices (TL/kg, TL/lt, TL/adet, TL/yıkama, TL/GB).
 *
 * Examples:
 * - "Lavazza ... 1000 gr" -> 1 kg -> TL/kg
 * - "3 x 200 ml" -> 0.6 lt -> TL/lt
 * - "Prima 120'li Bebek Bezi" -> 120 adet -> TL/adet
 * - "iPhone 15 128 GB" -> 128 GB -> TL/GB (category-aware storage metric)
 *
 * @param {string} title
 * @param {number|null} price
 */
export function extractUnitInfo(title, price = null) {
  if (!title || typeof title !== "string") return null;
  const text = title.replace(/,/g, ".");

  // Helper to construct result
  const makeResult = (quantity, unit, baseLabel, rawMatch) => {
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    const roundedQty = Math.round(quantity * 1000) / 1000;
    const unitPrice =
      typeof price === "number" && Number.isFinite(price) && price > 0
        ? Math.round((price / roundedQty) * 100) / 100
        : null;
    return {
      quantity: roundedQty,
      unit,
      unitLabel: baseLabel,
      rawMatch: rawMatch.trim(),
      unitPrice,
      formatted: unitPrice !== null ? `${formatTrNumber(unitPrice)} TL / ${baseLabel}` : `${roundedQty} ${baseLabel}`,
    };
  };

  // 1. Multipack mass/volume: e.g., "3 x 500 gr", "6x1 lt", "2 x 250 ml", "4x1.5 L"
  const multiMassVol = text.match(/(\d+)\s*[x×\*]\s*(\d+(?:\.\d+)?)\s*(kg|kilo|gr|g|gram|lt|l|litre|ml)\b/i);
  if (multiMassVol) {
    const count = Number.parseFloat(multiMassVol[1]);
    const amount = Number.parseFloat(multiMassVol[2]);
    const u = multiMassVol[3].toLowerCase();
    if (count > 0 && count <= 200 && amount > 0) {
      if (u === "kg" || u === "kilo") return makeResult(count * amount, "kg", "kg", multiMassVol[0]);
      if (u === "gr" || u === "g" || u === "gram") return makeResult((count * amount) / 1000, "kg", "kg", multiMassVol[0]);
      if (u === "lt" || u === "l" || u === "litre") return makeResult(count * amount, "lt", "lt", multiMassVol[0]);
      if (u === "ml") return makeResult((count * amount) / 1000, "lt", "lt", multiMassVol[0]);
    }
  }

  // 2. Single mass: kg / gr / g / gram (avoid matching "5G" cellular!)
  const massMatch = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|kilo|gr|gram)\b/i);
  if (massMatch) {
    const amount = Number.parseFloat(massMatch[1]);
    const u = massMatch[2].toLowerCase();
    // Check if there is also a pack multiplier like "2'li" or "3 Adet"
    const packMul = extractPackMultiplier(text);
    const totalKg = (u === "kg" || u === "kilo" ? amount : amount / 1000) * packMul;
    if (totalKg > 0 && totalKg <= 500) {
      return makeResult(totalKg, "kg", "kg", massMatch[0]);
    }
  }

  // 3. Single volume: lt / litre / ml (skip airfryer/appliance capacity when "fritöz|fırın|tencere|termos|çanta|valiz|buzdolabı" present)
  const isApplianceVolume = /fritöz|airfryer|fırın|mikrodalga|buzdolabı|valiz|çanta|termos|tencere|kettle|su ısıtıcı|düdüklü|mikser|blender|süpürge|klima/i.test(text);
  if (!isApplianceVolume) {
    const volMatch = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(lt|litre|ml|cl)\b/i);
    if (volMatch) {
      const amount = Number.parseFloat(volMatch[1]);
      const u = volMatch[2].toLowerCase();
      const packMul = extractPackMultiplier(text);
      let totalLt = amount;
      if (u === "ml") totalLt = amount / 1000;
      else if (u === "cl") totalLt = amount / 100;
      totalLt *= packMul;
      if (totalLt > 0 && totalLt <= 500) {
        return makeResult(totalLt, "lt", "lt", volMatch[0]);
      }
    }
  }

  // 4. Wash / tablet / capsule / diaper / sheet counts
  const countMatch = text.match(/(?:^|\s)(\d+)\s*(yıkama|kapsül|tablet|poşet|rulo|yaprak|adet|'li|'lı|'lu|'lü|li\s+paket|lı\s+paket)\b/i);
  if (countMatch) {
    const count = Number.parseInt(countMatch[1], 10);
    const rawU = countMatch[2].toLowerCase();
    if (count >= 2 && count <= 2000) {
      let label = "adet";
      if (rawU.includes("yıkama")) label = "yıkama";
      else if (rawU.includes("kapsül")) label = "kapsül";
      else if (rawU.includes("tablet")) label = "tablet";
      else if (rawU.includes("rulo")) label = "rulo";
      else if (rawU.includes("yaprak")) label = "yaprak";
      return makeResult(count, label, label, countMatch[0]);
    }
  }

  // 5. Storage capacity (SSD / USB / Phone / SD Card): e.g. "128 GB", "1 TB", "512 GB"
  const storageMatch = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
  if (storageMatch) {
    const amount = Number.parseFloat(storageMatch[1]);
    const u = storageMatch[2].toUpperCase();
    const gb = u === "TB" ? amount * 1024 : amount;
    // Only treat as meaningful storage unit if >= 32 GB (avoids matching 8 GB RAM as primary storage when 512 GB isn't matched)
    // Prefer largest GB/TB number in title!
    const allStorage = [...text.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*(TB|GB)\b/gi)].map((m) => ({
      gb: m[2].toUpperCase() === "TB" ? Number.parseFloat(m[1]) * 1024 : Number.parseFloat(m[1]),
      raw: m[0],
    }));
    const largest = allStorage.sort((a, b) => b.gb - a.gb)[0];
    if (largest && largest.gb >= 32) {
      return makeResult(largest.gb, "GB", "GB", largest.raw);
    }
  }

  return null;
}

function extractPackMultiplier(text) {
  const m = text.match(/(?:^|\s)(\d+)\s*(?:'li|'lı|'lu|'lü|adet|paket)\b/i);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 2 && n <= 48) return n;
  }
  return 1;
}

/**
 * Formats number in Turkish locale ("54.999,00").
 * @param {number} n
 */
export function formatTrNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
