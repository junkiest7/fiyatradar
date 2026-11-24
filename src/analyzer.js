/**
 * Statistical price analyzer, shipping-trap detector, deal scoring engine,
 * and 180-day timing/fake-discount advisor.
 */

import { analyzeOfferAuthenticity, formatTrNumber } from "./parsers.js";

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Analyzes all store offers for a single product, computing:
 * - netPrice (base + shipping)
 * - unitPrice (if product has measurable quantity)
 * - shipping traps (sticker price cheaper, but net price more expensive)
 * - outlier flagging (overpriced listings)
 * - authenticity / TR Official vs Importer Warranty / Refurbished & Demo Trust Shield
 * - 0-100 Deal Score per offer
 * - Top picks (Cheapest Net, Best Value, Fastest Competitive)
 * - Marketplace breakdown (min/avg/count per platform)
 */
export function analyzeOffers(rawOffers, unitInfo = null, context = {}) {
  const productTitle = context?.productTitle || "";
  const productCategory = context?.category || "";

  const valid = rawOffers
    .filter((o) => typeof o.basePrice === "number" && Number.isFinite(o.basePrice) && o.basePrice > 0)
    .map((o) => {
      const shippingCost = typeof o.shipping?.cost === "number" ? o.shipping.cost : 0;
      const netPrice = round2(o.basePrice + shippingCost);
      const unitPrice =
        unitInfo && unitInfo.quantity > 0 ? round2(netPrice / unitInfo.quantity) : null;
      return {
        ...o,
        shippingCost,
        netPrice,
        unitPrice,
      };
    });

  if (!valid.length) {
    return {
      offers: [],
      stats: null,
      picks: null,
      shippingTraps: [],
      platformBreakdown: [],
      trustSummary: null,
    };
  }

  // Sort by netPrice ascending, tie-break by trustScore desc then delivery score desc
  valid.sort((a, b) => {
    if (a.netPrice !== b.netPrice) return a.netPrice - b.netPrice;
    if ((b.store?.trustScore || 0) !== (a.store?.trustScore || 0)) {
      return (b.store?.trustScore || 0) - (a.store?.trustScore || 0);
    }
    return (b.delivery?.score || 0) - (a.delivery?.score || 0);
  });

  const netPrices = valid.map((o) => o.netPrice);
  const minNet = netPrices[0];
  const maxNet = netPrices[netPrices.length - 1];
  const meanNet = round2(netPrices.reduce((s, v) => s + v, 0) / netPrices.length);
  const medianNet = round2(quantile(netPrices, 0.5));
  const q1 = round2(quantile(netPrices, 0.25));
  const q3 = round2(quantile(netPrices, 0.75));
  const iqr = round2(q3 - q1);
  const variance = netPrices.reduce((s, v) => s + (v - meanNet) ** 2, 0) / netPrices.length;
  const stdDev = round2(Math.sqrt(variance));

  // Outlier thresholds:
  // - Upper outlier: Tukey upper fence OR >35% above both market median and cheapest net price
  // - Suspiciously-low anomaly: <35% of market median when >= 4 offers (catches cases, accessories, imitations)
  const tukeyFence = q3 + 1.5 * iqr;
  const relativeFence = Math.max(medianNet * 1.35, minNet * 1.35);
  const suspiciousLowThreshold = valid.length >= 4 ? medianNet * 0.35 : 0;

  // Compute verified minNet excluding suspiciously-low anomalies (falls back to global minNet if none)
  const nonSuspicious = valid.filter((o) => o.netPrice >= suspiciousLowThreshold);
  const verifiedMinNet = nonSuspicious.length ? nonSuspicious[0].netPrice : minNet;

  // Detect shipping traps: offer A has strictly lower basePrice than offer B,
  // yet offer A's netPrice is strictly higher than offer B's netPrice!
  const shippingTraps = [];
  const trapIds = new Set();

  for (let i = 0; i < valid.length; i++) {
    const a = valid[i];
    if (a.shippingCost <= 0 || a.netPrice < suspiciousLowThreshold) continue;
    const betterFree = valid.find(
      (b) =>
        b !== a &&
        b.netPrice >= suspiciousLowThreshold &&
        b.basePrice >= a.basePrice &&
        b.netPrice < a.netPrice
    );
    if (betterFree) {
      trapIds.add(a.id);
      shippingTraps.push({
        offerId: a.id,
        store: a.store?.displayName || "Mağaza",
        basePrice: a.basePrice,
        shippingCost: a.shippingCost,
        netPrice: a.netPrice,
        betterStore: betterFree.store?.displayName || "Mağaza",
        betterBasePrice: betterFree.basePrice,
        betterNetPrice: betterFree.netPrice,
        extraCost: round2(a.netPrice - betterFree.netPrice),
        message: `${a.store?.displayName} etiket fiyatı (${formatTrNumber(a.basePrice)} TL) daha ucuz görünse de +${formatTrNumber(a.shippingCost)} TL kargo ile ${formatTrNumber(a.netPrice)} TL'ye geliyor; ${betterFree.store?.displayName} (${formatTrNumber(betterFree.netPrice)} TL) kargo dahil ${formatTrNumber(a.netPrice - betterFree.netPrice)} TL daha ucuz.`,
      });
    }
  }

  // Score each offer (0 - 100) + evaluate Authenticity / Warranty Trust Shield
  const scoredOffers = valid.map((o, idx) => {
    const isSuspiciousLow = suspiciousLowThreshold > 0 && o.netPrice < suspiciousLowThreshold;
    const refMin = verifiedMinNet;
    const diffFromMin = round2(o.netPrice - refMin);
    const diffFromMinPct = refMin > 0 ? round2((diffFromMin / refMin) * 100) : 0;
    const diffFromMedianPct = medianNet > 0 ? round2(((o.netPrice - medianNet) / medianNet) * 100) : 0;
    const isOutlier =
      valid.length >= 3 &&
      (o.netPrice > tukeyFence || o.netPrice > relativeFence);
    const isShippingTrap = trapIds.has(o.id);

    const trustShield = analyzeOfferAuthenticity(
      { ...o, isSuspiciousLow },
      productTitle,
      productCategory
    );

    // 1. Price score (0-55 pts): exponential decay as % above verified cheapest rises
    const priceScore = isSuspiciousLow
      ? 12
      : 55 * Math.exp(-0.05 * Math.max(0, diffFromMinPct));

    // 2. Store reliability & official seller (0-20 pts)
    const trustNorm = Math.max(0.5, Math.min(1.0, o.store?.trustScore || 0.72));
    const trustPoints = ((trustNorm - 0.5) / 0.5) * 20;

    // 3. Free shipping advantage (0-12 pts)
    const shippingPoints = o.shipping?.isFree ? 12 : o.shipping?.unknown ? 5 : Math.max(0, 8 - (o.shippingCost / Math.max(100, refMin * 0.02)) * 8);

    // 4. Delivery & stock signal (0-13 pts)
    const deliveryPoints = (o.delivery?.score || 0.55) * 9 + (o.inStock ? 4 : 0);

    // 5. Authenticity & Warranty risk adjustment (prevents importer/refurbished/demo from winning Best Value)
    let shieldPenalty = 0;
    if (trustShield.condition === "demo") shieldPenalty += 18;
    else if (trustShield.condition === "refurbished") shieldPenalty += 14;
    if (trustShield.warranty === "importer") shieldPenalty += 10;
    if (trustShield.isHighRiskCategory && !trustShield.isAuthorized && trustShield.condition === "new") {
      shieldPenalty += 8;
    }

    const dealScore = Math.max(
      1,
      Math.min(100, Math.round(priceScore + trustPoints + shippingPoints + deliveryPoints - shieldPenalty))
    );

    return {
      ...o,
      rankByNet: idx + 1,
      diffFromMin,
      diffFromMinPct,
      diffFromMedianPct,
      isOutlier,
      isSuspiciousLow,
      isShippingTrap,
      trustShield,
      dealScore,
      badges: [],
    };
  });

  // Top picks (prefer authentic non-suspicious brand-new offers!)
  const authenticPool = scoredOffers.filter((o) => !o.isSuspiciousLow);
  const pickBase = authenticPool.length ? authenticPool : scoredOffers;
  const brandNewPool = pickBase.filter((o) => o.trustShield?.condition === "new");
  const primaryPool = brandNewPool.length ? brandNewPool : pickBase;

  const cheapestNet = primaryPool[0];
  const bestValue = [...primaryPool].sort((a, b) => b.dealScore - a.dealScore || a.netPrice - b.netPrice)[0];
  const competitivePool = primaryPool.filter((o) => o.diffFromMinPct <= 6);
  const fastestCompetitive = [...(competitivePool.length ? competitivePool : primaryPool)].sort(
    (a, b) => (a.delivery?.days ?? 5) - (b.delivery?.days ?? 5) || a.netPrice - b.netPrice
  )[0];

  if (cheapestNet) cheapestNet.badges.push({ type: "cheapest", label: "Kargo Dahil En Ucuz" });
  if (bestValue) bestValue.badges.push({ type: "best-value", label: "En Dengeli Fırsat" });
  if (fastestCompetitive && fastestCompetitive.delivery?.days <= 1) {
    fastestCompetitive.badges.push({ type: "fast", label: fastestCompetitive.delivery.label });
  }
  for (const o of scoredOffers) {
    const ts = o.trustShield;
    if (ts?.condition === "refurbished") o.badges.push({ type: "warn", label: "♻ Yenilenmiş / Outlet" });
    if (ts?.condition === "demo") o.badges.push({ type: "trap", label: "⚠ Teşhir / Açık Kutu" });
    if (ts?.warranty === "importer") o.badges.push({ type: "warn", label: "⚠ İthalatçı Garantili" });
    else if (ts?.warranty === "distributor") o.badges.push({ type: "official", label: "✓ TR Resmi Garanti" });
    if (ts?.isHighRiskCategory && !ts.isAuthorized && ts.condition === "new" && !o.isSuspiciousLow) {
      o.badges.push({ type: "warn", label: "⚠ 3. Parti Satıcı" });
    }
    if (o.isShippingTrap) o.badges.push({ type: "trap", label: "Kargo Tuzağı" });
    if (o.isOutlier) o.badges.push({ type: "outlier", label: "Piyasa Üstü Fiyat" });
    if (o.isSuspiciousLow) o.badges.push({ type: "trap", label: "⚠ Şüpheli Ucuz / Muadil" });
  }

  // Trust & Authenticity summary across all analyzed offers
  const authorizedOffers = pickBase.filter((o) => o.trustShield?.isAuthorized);
  const importerCount = scoredOffers.filter((o) => o.trustShield?.warranty === "importer").length;
  const distributorCount = scoredOffers.filter((o) => o.trustShield?.warranty === "distributor").length;
  const refurbishedCount = scoredOffers.filter((o) => o.trustShield?.condition === "refurbished").length;
  const demoCount = scoredOffers.filter((o) => o.trustShield?.condition === "demo").length;
  const cautionCount = scoredOffers.filter((o) => o.trustShield?.trustTier === "caution").length;
  const isHighRiskCategory = scoredOffers.some((o) => o.trustShield?.isHighRiskCategory);
  const cheapestAuthorized = authorizedOffers.length ? pickSummary(authorizedOffers[0]) : null;

  let recommendationNote = "";
  if (isHighRiskCategory && cheapestAuthorized && cheapestNet && !cheapestNet.trustShield?.isAuthorized) {
    const diff = round2(cheapestAuthorized.netPrice - cheapestNet.netPrice);
    recommendationNote =
      diff > 0
        ? `Bu kategori (parfüm/kozmetik/lüks/ayakkabı) sahte ürün riski taşır. En ucuz yetkili/resmi satıcı (${cheapestAuthorized.store}) sadece +${formatTrNumber(diff)} TL farkla orijinallik güvencesi sunuyor.`
        : `En ucuz yetkili/resmi satıcı: ${cheapestAuthorized.store} (${formatTrNumber(cheapestAuthorized.netPrice)} TL).`;
  } else if (importerCount > 0 || refurbishedCount > 0 || demoCount > 0) {
    const parts = [];
    if (importerCount > 0) parts.push(`${importerCount} ithalatçı garantili`);
    if (refurbishedCount > 0) parts.push(`${refurbishedCount} yenilenmiş/outlet`);
    if (demoCount > 0) parts.push(`${demoCount} teşhir/açık kutu`);
    recommendationNote = `Teklifler arasında ${parts.join(", ")} ilan tespit edildi. Aşağıdaki filtreyle tek dokunuşta ayıklayabilirsiniz.`;
  } else if (isHighRiskCategory && authorizedOffers.length > 0) {
    recommendationNote = `${authorizedOffers.length} yetkili / resmi mağaza teklifi doğrulandı. Orijinallik için 'Sadece Yetkili Satıcılar' filtresini kullanabilirsiniz.`;
  } else if (isHighRiskCategory && authorizedOffers.length === 0 && cautionCount > 0) {
    recommendationNote = `Bu kategori (parfüm/kozmetik/lüks/ayakkabı) sahte ürün riski taşır ve listelenen ${cautionCount} teklifin tamamı 3. parti satıcıdır. Satın almadan önce yetkili satıcılar veya marka resmi sitesiyle karşılaştırmanız önerilir.`;
  }

  const trustSummary = {
    isHighRiskCategory,
    authorizedCount: authorizedOffers.length,
    distributorCount,
    importerCount,
    refurbishedCount,
    demoCount,
    cautionCount,
    cheapestAuthorized,
    recommendationNote,
  };

  // Platform breakdown
  const platMap = new Map();
  for (const o of pickBase) {
    const plat = o.store?.platform || "Diğer";
    if (!platMap.has(plat)) {
      platMap.set(plat, {
        platform: plat,
        logoUrl: o.storeLogo || null,
        count: 0,
        minNet: o.netPrice,
        maxNet: o.netPrice,
        sumNet: 0,
        freeShippingCount: 0,
        bestOfferUrl: o.url,
      });
    }
    const entry = platMap.get(plat);
    entry.count += 1;
    entry.sumNet += o.netPrice;
    if (o.netPrice < entry.minNet) {
      entry.minNet = o.netPrice;
      entry.bestOfferUrl = o.url;
    }
    if (o.netPrice > entry.maxNet) entry.maxNet = o.netPrice;
    if (o.shipping?.isFree) entry.freeShippingCount += 1;
    if (!entry.logoUrl && o.storeLogo) entry.logoUrl = o.storeLogo;
  }

  const platformBreakdown = [...platMap.values()]
    .map((p) => ({
      ...p,
      avgNet: round2(p.sumNet / p.count),
      diffFromGlobalMinPct: verifiedMinNet > 0 ? round2(((p.minNet - verifiedMinNet) / verifiedMinNet) * 100) : 0,
    }))
    .sort((a, b) => a.minNet - b.minNet);

  const nonOutliers = scoredOffers.filter((o) => !o.isOutlier);
  const suspiciousLowCount = scoredOffers.filter((o) => o.isSuspiciousLow).length;
  const marketSpreadPct = verifiedMinNet > 0 ? round2(((maxNet - verifiedMinNet) / verifiedMinNet) * 100) : 0;
  const savingsVsMedian = round2(Math.max(0, medianNet - verifiedMinNet));
  const savingsVsMedianPct = medianNet > 0 ? round2((savingsVsMedian / medianNet) * 100) : 0;

  return {
    offers: scoredOffers,
    stats: {
      offerCountAnalyzed: scoredOffers.length,
      minNet: verifiedMinNet,
      rawMinNet: minNet,
      maxNet,
      meanNet,
      medianNet,
      q1,
      q3,
      iqr,
      stdDev,
      marketSpreadPct,
      savingsVsMedian,
      savingsVsMedianPct,
      freeShippingCount: scoredOffers.filter((o) => o.shipping?.isFree).length,
      inStockCount: scoredOffers.filter((o) => o.inStock).length,
      outlierCount: scoredOffers.length - nonOutliers.length,
      suspiciousLowCount,
      authorizedCount: authorizedOffers.length,
      importerCount,
      refurbishedCount,
      demoCount,
      bestUnitPrice: cheapestNet?.unitPrice ?? null,
    },
    picks: {
      cheapestNet: cheapestNet ? pickSummary(cheapestNet) : null,
      bestValue: bestValue ? pickSummary(bestValue) : null,
      fastestCompetitive: fastestCompetitive ? pickSummary(fastestCompetitive) : null,
    },
    shippingTraps,
    platformBreakdown,
    trustSummary,
  };
}

function pickSummary(o) {
  return {
    id: o.id,
    store: o.store?.displayName || "Mağaza",
    platform: o.store?.platform || "",
    seller: o.store?.seller || "",
    basePrice: o.basePrice,
    shippingCost: o.shippingCost,
    shippingLabel: o.shipping?.label || "",
    netPrice: o.netPrice,
    unitPrice: o.unitPrice,
    dealScore: o.dealScore,
    deliveryLabel: o.delivery?.label || "",
    stockText: o.stockText || "",
    url: o.url,
    storeLogo: o.storeLogo || null,
    trustTier: o.trustShield?.trustTier || "standard",
    warrantyLabel: o.trustShield?.warrantyLabel || "",
    conditionLabel: o.trustShield?.condition !== "new" ? o.trustShield?.conditionLabel || "" : "",
    priceVerified: o.priceVerified !== false,
    priceSource: o.priceSource || "live",
  };
}

/**
 * Campaign / Fake-Discount Detector ("Sahte İndirim & Fiyat Şişirme Dedektörü").
 * Detects pre-campaign "bindirim → indirim" spikes (e.g. 11.11 / Efsane Cuma),
 * exaggerated discounts, genuine verified discounts, and inflated list prices.
 *
 * @param {Array<{isoDate?: string, dateLabel?: string, price: number}>} rawPoints
 * @param {number|null} currentNetPrice
 * @param {{ marketMedian?: number|null, listPrice?: number|null }} [options]
 */
export function detectFakeDiscount(rawPoints, currentNetPrice, options = {}) {
  const points = [...(rawPoints || [])]
    .filter((p) => p && typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => String(a.isoDate || "").localeCompare(String(b.isoDate || "")));

  const latestPrice =
    typeof currentNetPrice === "number" && Number.isFinite(currentNetPrice) && currentNetPrice > 0
      ? currentNetPrice
      : points.length
        ? points[points.length - 1].price
        : null;

  const marketMedian =
    typeof options?.marketMedian === "number" && Number.isFinite(options.marketMedian) && options.marketMedian > 0
      ? options.marketMedian
      : null;
  const listPrice =
    typeof options?.listPrice === "number" && Number.isFinite(options.listPrice) && options.listPrice > 0
      ? options.listPrice
      : null;

  // Case 1: Insufficient historical series (< 2 points) -> cross-store market check
  if (points.length < 2 || !latestPrice) {
    if (latestPrice && marketMedian && listPrice && listPrice >= marketMedian * 1.15 && latestPrice >= marketMedian * 0.98) {
      const fakeCutPct = round2(((listPrice - latestPrice) / listPrice) * 100);
      const vsMarketPct = round2(((latestPrice - marketMedian) / marketMedian) * 100);
      return {
        status: "fake_discount",
        tone: "warn",
        authenticityScore: 28,
        label: "⚠ Şişirilmiş Liste Fiyatı",
        headline: `Üstü çizili liste fiyatı (${formatTrNumber(listPrice)} TL) piyasa medyanının oldukça üzerinde.`,
        details: [
          `Liste fiyatına göre %${formatTrNumber(fakeCutPct)} indirim görünse de güncel fiyat piyasa medyanına (${formatTrNumber(marketMedian)} TL) göre ${vsMarketPct >= 0 ? `+%${formatTrNumber(vsMarketPct)} yukarıda` : `yalnızca %${formatTrNumber(Math.abs(vsMarketPct))} aşağıda`}.`,
          "Ürünü takibe aldığınızda zaman içindeki fiyat şişirmelerini otomatik olarak yakalarız.",
        ],
        metrics: {
          normalPrice: marketMedian,
          peakPrice: listPrice,
          peakDate: "Liste fiyatı",
          currentPrice: latestPrice,
          spikePct: round2(((listPrice - marketMedian) / marketMedian) * 100),
          apparentDropPct: fakeCutPct,
          realDiffPct: vsMarketPct,
        },
        hasHistory: false,
      };
    }

    if (latestPrice && marketMedian && latestPrice <= marketMedian * 0.9) {
      const savePct = round2(((marketMedian - latestPrice) / marketMedian) * 100);
      const saveTl = round2(marketMedian - latestPrice);
      return {
        status: "market_deal",
        tone: "good",
        authenticityScore: Math.min(92, Math.round(74 + savePct)),
        label: "✓ Piyasa Medyanının Altında",
        headline: `Rakip mağaza medyanına (${formatTrNumber(marketMedian)} TL) göre %${formatTrNumber(savePct)} (${formatTrNumber(saveTl)} TL) avantajlı.`,
        details: [
          "Tarihsel seri henüz birikmedi; ancak anlık çoklu mağaza dağılımına göre rekabetçi bir fiyat.",
          "Takip listesine ekleyerek kampanya dönemlerindeki fiyat şişirmelerini otomatik denetleyebilirsiniz.",
        ],
        metrics: {
          normalPrice: marketMedian,
          peakPrice: null,
          peakDate: "",
          currentPrice: latestPrice,
          spikePct: 0,
          apparentDropPct: savePct,
          realDiffPct: -savePct,
        },
        hasHistory: false,
      };
    }

    return {
      status: "insufficient_history",
      tone: "neutral",
      authenticityScore: null,
      label: "Geçmiş Veri Birikiyor",
      headline: "Sahte indirim analizi için en az 2 tarihli fiyat kaydı gerekiyor.",
      details: [
        "Ürünü takibe alıp zaman zaman güncellediğinizde kampanya öncesi zam → indirim tuzaklarını otomatik yakalarız.",
      ],
      metrics: null,
      hasHistory: false,
    };
  }

  // Case 2: Analyze chronological price series (Akakçe 6-month history OR personal snapshots)
  // Ensure latestPrice is evaluated as the terminal point
  const series = [...points];
  const lastPt = series[series.length - 1];
  if (Math.abs(lastPt.price - latestPrice) > 0.01) {
    series.push({
      isoDate: new Date().toISOString(),
      dateLabel: "Bugün",
      price: latestPrice,
    });
  }

  const allSorted = series.map((p) => p.price).sort((a, b) => a - b);
  const overallMedian = round2(quantile(allSorted, 0.5));

  // Recent window: last 30 points or ~45% of shorter series (minimum 2 points)
  const recentLen = Math.min(30, Math.max(2, Math.ceil(series.length * 0.45)));
  const recentStartIdx = Math.max(1, series.length - recentLen);

  // Find peak inside recent window (excluding the very first point so a pre-peak baseline exists)
  let peakIdx = recentStartIdx;
  for (let i = recentStartIdx; i < series.length; i++) {
    if (series[i].price > series[peakIdx].price) {
      peakIdx = i;
    }
  }
  const recentPeak = series[peakIdx];

  // Normal pre-peak baseline: median of points strictly before peakIdx (fallback to earlier half or overallMedian)
  const prePeakSlice = series.slice(0, peakIdx).map((p) => p.price).sort((a, b) => a - b);
  const earlySlice = series.slice(0, Math.max(1, Math.floor(series.length * 0.65))).map((p) => p.price).sort((a, b) => a - b);
  const normalPrice = round2(
    prePeakSlice.length >= 2
      ? quantile(prePeakSlice, 0.5)
      : prePeakSlice.length === 1
        ? prePeakSlice[0]
        : quantile(earlySlice, 0.5) || overallMedian
  );

  const spikePct = normalPrice > 0 ? round2(((recentPeak.price - normalPrice) / normalPrice) * 100) : 0;
  const apparentDropPct = recentPeak.price > 0 ? round2(((recentPeak.price - latestPrice) / recentPeak.price) * 100) : 0;
  const realDiffPct = normalPrice > 0 ? round2(((latestPrice - normalPrice) / normalPrice) * 100) : 0;
  const diffVsOverallMedianPct = overallMedian > 0 ? round2(((latestPrice - overallMedian) / overallMedian) * 100) : 0;

  const metrics = {
    normalPrice,
    peakPrice: recentPeak.price,
    peakDate: recentPeak.dateLabel || recentPeak.isoDate?.slice(0, 10) || "",
    currentPrice: latestPrice,
    overallMedian,
    spikePct,
    apparentDropPct,
    realDiffPct,
  };

  // Pattern 1: Classic "Bindirim → İndirim" Fake Discount Trap!
  // Price jumped >= 10% above normal baseline, then "dropped" >= 5% from that peak,
  // yet current price is still >= normalPrice * 0.98 (no real discount vs pre-spike normal!)
  if (spikePct >= 10 && apparentDropPct >= 5 && realDiffPct >= -2) {
    const score = Math.max(
      8,
      Math.min(35, Math.round(32 - Math.max(0, realDiffPct) * 1.4 - Math.max(0, spikePct - 10) * 0.35))
    );
    const diffLabel =
      realDiffPct > 0.5
        ? `normal fiyatın hâlâ +%${formatTrNumber(realDiffPct)} üzerinde`
        : "aslında eski normal fiyatıyla neredeyse aynı seviyede";
    return {
      status: "fake_discount",
      tone: "bad",
      authenticityScore: score,
      label: "⚠ Sahte İndirim Riski",
      headline: `Önce %${formatTrNumber(spikePct)} zamlanıp ardından %${formatTrNumber(apparentDropPct)} indirilmiş; ${diffLabel}.`,
      details: [
        `Önceki normal fiyat medyanı ${formatTrNumber(normalPrice)} TL iken ${metrics.peakDate || "yakın dönemde"} ${formatTrNumber(recentPeak.price)} TL'ye (+%${formatTrNumber(spikePct)}) yükselmiş.`,
        `Zirveden %${formatTrNumber(apparentDropPct)} düşmüş gibi görünse de güncel ${formatTrNumber(latestPrice)} TL fiyatı ${diffLabel}.`,
        "Kampanya etiketi yanıltıcı olabilir; acil değilse gerçek dip seviye için beklemek daha mantıklı.",
      ],
      metrics,
      hasHistory: true,
    };
  }

  // Pattern 2: Exaggerated / Partial Discount (spiked first, real savings exist but much smaller than advertised!)
  if (spikePct >= 10 && apparentDropPct >= 8 && realDiffPct < -2 && apparentDropPct >= Math.abs(realDiffPct) * 1.7) {
    const realSaveTl = round2(normalPrice - latestPrice);
    const score = Math.max(45, Math.min(68, Math.round(52 + Math.abs(realDiffPct) * 1.2)));
    return {
      status: "partial_discount",
      tone: "warn",
      authenticityScore: score,
      label: "⚡ Abartılı İndirim (Kısmi Fırsat)",
      headline: `Zirveye göre %${formatTrNumber(apparentDropPct)} indirim görünse de gerçek indirim %${formatTrNumber(Math.abs(realDiffPct))}.`,
      details: [
        `Fiyat normal medyan olan ${formatTrNumber(normalPrice)} TL'den ${formatTrNumber(recentPeak.price)} TL'ye (+%${formatTrNumber(spikePct)}) çıkıp ${formatTrNumber(latestPrice)} TL'ye gerilemiş.`,
        `Yine de normal fiyata kıyasla ${formatTrNumber(realSaveTl)} TL (%${formatTrNumber(Math.abs(realDiffPct))}) gerçek bir avantaj mevcut.`,
      ],
      metrics,
      hasHistory: true,
    };
  }

  // Pattern 3: Genuine Verified Discount (clearly below both prior normal baseline and overall median)
  if (realDiffPct <= -5 && diffVsOverallMedianPct <= -3.5) {
    const realSaveTl = round2(normalPrice - latestPrice);
    const score = Math.min(99, Math.round(78 + Math.min(20, Math.abs(realDiffPct) * 1.15)));
    return {
      status: "genuine_discount",
      tone: "good",
      authenticityScore: score,
      label: "✓ Gerçek İndirim Doğrulandı",
      headline: `Önceki normal piyasa medyanına (${formatTrNumber(normalPrice)} TL) göre gerçek %${formatTrNumber(Math.abs(realDiffPct))} (${formatTrNumber(realSaveTl)} TL) indirim var.`,
      details: [
        `Kampanya öncesi yapay fiyat şişirmesi tespit edilmedi; tüm dönem medyanının (${formatTrNumber(overallMedian)} TL) %${formatTrNumber(Math.abs(diffVsOverallMedianPct))} altında.`,
        "Tarihsel veriler gerçek bir fırsat dönemine işaret ediyor.",
      ],
      metrics,
      hasHistory: true,
    };
  }

  // Pattern 4: Inflated / Pre-Campaign Price Spike currently underway
  if (realDiffPct >= 8 || diffVsOverallMedianPct >= 10) {
    const overPct = Math.max(realDiffPct, diffVsOverallMedianPct);
    const score = Math.max(12, Math.min(42, Math.round(42 - overPct * 0.9)));
    return {
      status: "inflated",
      tone: "bad",
      authenticityScore: score,
      label: "↑ Fiyat Şişirmesi (Bekleyin)",
      headline: `Güncel fiyat normal piyasa medyanının (${formatTrNumber(normalPrice)} TL) +%${formatTrNumber(overPct)} üzerinde.`,
      details: [
        "Yakın dönemdeki sert yükseliş, olası bir kampanya öncesi fiyat şişirmesi (bindirim) olabilir.",
        "Acil değilse takip listesine ekleyip normal fiyat bandına dönüşünü beklemeniz önerilir.",
      ],
      metrics,
      hasHistory: true,
    };
  }

  // Pattern 5: Normal Stable Market Trajectory
  return {
    status: "stable",
    tone: "neutral",
    authenticityScore: 70,
    label: "• Normal Piyasa Seyri",
    headline: `Güncel fiyat normal medyanına (${formatTrNumber(normalPrice)} TL) paralel seyrediyor (${realDiffPct >= 0 ? "+" : ""}%${formatTrNumber(realDiffPct)}).`,
    details: [
      "Önce zam sonra indirim şeklinde bir fiyat manipülasyonu tespit edilmedi.",
      "İhtiyacınız varsa güvenle alınabilir veya indirim için hedef fiyat alarmı kurulabilir.",
    ],
    metrics,
    hasHistory: true,
  };
}

/**
 * Analyzes 6-month real historical price series to produce:
 * - Moving averages, min/max dates, 30d/90d/180d averages
 * - Buy Timing Score (0-100) & "Şimdi Alınır mı?" verdict
 * - Campaign / Fake-discount ("sahte indirim") detection
 */
export function analyzePriceHistory(rawHistory, currentNetPrice, fallbackHistoricalLow = null, marketStats = null) {
  // Sort chronologically oldest -> newest
  const points = [...(rawHistory || [])]
    .filter((p) => p && p.isoDate && typeof p.price === "number" && p.price > 0)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  if (!points.length) {
    const fakeDiscount = detectFakeDiscount([], currentNetPrice, {
      marketMedian: marketStats?.medianNet ?? null,
      listPrice: marketStats?.listPrice ?? null,
    });
    return {
      points: [],
      summary: null,
      fakeDiscount,
      verdict: {
        score: 65,
        label: "Fiyat Geçmişi Sınırlı",
        tone: "neutral",
        headline: "Bu ürün için uzun dönemli tarihsel veri bulunamadı",
        reasons: [
          "Anlık mağaza karşılaştırmasına göre en düşük net fiyatlı ve güvenilir satıcıyı seçmeniz önerilir.",
        ],
      },
    };
  }

  // Compute 7-point moving average for smooth trend visualization
  const enrichedPoints = points.map((p, i) => {
    const start = Math.max(0, i - 6);
    const slice = points.slice(start, i + 1);
    const ma7 = round2(slice.reduce((s, x) => s + x.price, 0) / slice.length);
    return { ...p, ma7 };
  });

  const latestPrice = currentNetPrice || enrichedPoints[enrichedPoints.length - 1].price;
  const allPrices = enrichedPoints.map((p) => p.price);

  let minPoint = enrichedPoints[0];
  let maxPoint = enrichedPoints[0];
  for (const p of enrichedPoints) {
    if (p.price < minPoint.price) minPoint = p;
    if (p.price > maxPoint.price) maxPoint = p;
  }

  // Check if Akakce highlighted an even lower recent dip in summary badge
  if (fallbackHistoricalLow && fallbackHistoricalLow.price < minPoint.price) {
    minPoint = {
      isoDate: fallbackHistoricalLow.isoDate || minPoint.isoDate,
      dateLabel: fallbackHistoricalLow.dateLabel || minPoint.dateLabel,
      price: fallbackHistoricalLow.price,
    };
  }

  const avgAll = round2(allPrices.reduce((s, v) => s + v, 0) / allPrices.length);
  const last30 = enrichedPoints.slice(-30);
  const avg30 = round2(last30.reduce((s, p) => s + p.price, 0) / last30.length);
  const last7 = enrichedPoints.slice(-7);
  const avg7 = round2(last7.reduce((s, p) => s + p.price, 0) / last7.length);

  const price30DaysAgo = last30[0]?.price || latestPrice;
  const change30dPct = price30DaysAgo > 0 ? round2(((latestPrice - price30DaysAgo) / price30DaysAgo) * 100) : 0;

  const price7DaysAgo = last7[0]?.price || latestPrice;
  const change7dPct = price7DaysAgo > 0 ? round2(((latestPrice - price7DaysAgo) / price7DaysAgo) * 100) : 0;

  const range = Math.max(1, maxPoint.price - minPoint.price);
  const positionInRange = Math.max(0, Math.min(1, (latestPrice - minPoint.price) / range));
  const diffFromMinPct = minPoint.price > 0 ? round2(((latestPrice - minPoint.price) / minPoint.price) * 100) : 0;
  const diffFromAvg30Pct = avg30 > 0 ? round2(((latestPrice - avg30) / avg30) * 100) : 0;
  const diffFromAvgAllPct = avgAll > 0 ? round2(((latestPrice - avgAll) / avgAll) * 100) : 0;

  // Volatility (coefficient of variation)
  const variance = allPrices.reduce((s, v) => s + (v - avgAll) ** 2, 0) / allPrices.length;
  const volatilityPct = avgAll > 0 ? round2((Math.sqrt(variance) / avgAll) * 100) : 0;

  // Run Campaign / Fake-Discount Detector
  const fakeDiscount = detectFakeDiscount(enrichedPoints, latestPrice, {
    marketMedian: marketStats?.medianNet ?? null,
    listPrice: marketStats?.listPrice ?? null,
  });

  // Timing Score (0-100): Higher = better time to buy
  // Base on position in historical range (55 pts) + vs 30d avg (30 pts) + 7d momentum (15 pts)
  const rangePts = (1 - positionInRange) * 55;
  const avg30Pts = Math.max(0, Math.min(30, 15 - diffFromAvg30Pct * 1.6));
  const momentumPts = Math.max(0, Math.min(15, 7.5 - change7dPct * 1.1));
  let timingScore = Math.max(5, Math.min(99, Math.round(rangePts + avg30Pts + momentumPts)));

  // Cap overly optimistic timing score if a fake-discount spike was caught!
  if (fakeDiscount.status === "fake_discount") {
    timingScore = Math.min(timingScore, 45);
  }

  const reasons = [];
  if (fakeDiscount.status === "fake_discount") {
    reasons.push(`⚠ Sahte İndirim Radarı: ${fakeDiscount.headline}`);
  } else if (fakeDiscount.status === "genuine_discount") {
    reasons.push(`✓ Gerçek İndirim: ${fakeDiscount.headline}`);
  }

  if (diffFromMinPct <= 2) {
    reasons.push(`Güncel fiyat son ${enrichedPoints.length} günün taban seviyesine çok yakın (en düşük: ${formatTrNumber(minPoint.price)} TL, ${minPoint.dateLabel}).`);
  } else {
    reasons.push(`Son ${enrichedPoints.length} günlük en düşük fiyat ${minPoint.dateLabel} tarihinde ${formatTrNumber(minPoint.price)} TL oldu (şu an +%${formatTrNumber(diffFromMinPct)} yukarıda).`);
  }

  if (diffFromAvg30Pct <= -2) {
    reasons.push(`Son 30 gün ortalamasının (${formatTrNumber(avg30)} TL) %${formatTrNumber(Math.abs(diffFromAvg30Pct))} altında — gerçek bir fiyat avantajı var.`);
  } else if (diffFromAvg30Pct >= 3) {
    reasons.push(`Son 30 gün ortalamasının (${formatTrNumber(avg30)} TL) %${formatTrNumber(diffFromAvg30Pct)} üzerinde seyrediyor; kısa süreli zam/indirim dalgası olabilir.`);
  } else {
    reasons.push(`Son 30 gün ortalamasına (${formatTrNumber(avg30)} TL) paralel dengeli seviyede.`);
  }

  if (change7dPct <= -2) {
    reasons.push(`Son 7 günde %${formatTrNumber(Math.abs(change7dPct))} düşüş eğiliminde.`);
  } else if (change7dPct >= 3) {
    reasons.push(`Son 7 günde %${formatTrNumber(change7dPct)} yükseliş gösterdi; aceleniz yoksa geri çekilme beklenebilir.`);
  }

  if (volatilityPct >= 8) {
    reasons.push(`Fiyat oynaklığı yüksek (%${formatTrNumber(volatilityPct)}); kampanya dönemlerinde belirgin düşüşler yaşanıyor.`);
  }

  let label, tone, headline;
  if (timingScore >= 76) {
    label = "Güçlü Alım Fırsatı";
    tone = "good";
    headline = "Tarihsel verilere göre şu an almak için çok avantajlı bir dönem.";
  } else if (timingScore >= 58) {
    label = "Makul Fiyat — Alınabilir";
    tone = "good-soft";
    headline = "Piyasa ortalamasının altında veya dengeli seviyede; güvenle değerlendirilebilir.";
  } else if (timingScore >= 40) {
    label = "Ortalama Seviye";
    tone = "warn";
    headline = "Yakın geçmişte daha düşük fiyatlar görüldü; acil değilse takip listesine eklenebilir.";
  } else {
    label = "Zirveye Yakın — Bekleyin";
    tone = "bad";
    headline = "Fiyat son dönemin üst bandında; kampanya veya geri çekilme beklemek tasarruf sağlayabilir.";
  }

  return {
    points: enrichedPoints,
    summary: {
      dataPoints: enrichedPoints.length,
      startDate: enrichedPoints[0].dateLabel,
      endDate: enrichedPoints[enrichedPoints.length - 1].dateLabel,
      minPrice: minPoint.price,
      minDate: minPoint.dateLabel,
      maxPrice: maxPoint.price,
      maxDate: maxPoint.dateLabel,
      avgAll,
      avg30,
      avg7,
      change30dPct,
      change7dPct,
      diffFromMinPct,
      diffFromAvg30Pct,
      diffFromAvgAllPct,
      volatilityPct,
      positionInRangePct: Math.round(positionInRange * 100),
    },
    fakeDiscount,
    verdict: {
      score: timingScore,
      label,
      tone,
      headline,
      reasons,
    },
  };
}

