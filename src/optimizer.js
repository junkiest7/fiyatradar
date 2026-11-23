/**
 * Shopping Cart Cost Optimizer ("Sepet Optimizatörü")
 * Compares Split-Store (buying each item from its cheapest net store) vs
 * Single-Store Consolidation (buying all or maximum subset from one marketplace
 * to save on combined shipping / free-shipping thresholds).
 */

const PLATFORM_FREE_SHIPPING_THRESHOLD = {
  trendyol: 250,
  hepsiburada: 250,
  "amazon türkiye": 0, // Prime / very low threshold
  n11: 300,
  pazarama: 250,
  idefix: 250,
  mediamarkt: 500,
  teknosa: 500,
  "vatan bilgisayar": 500,
  migros: 500,
  "migros ekstra": 500,
  stradivarius: 990,
  zara: 1200,
  mango: 1000,
  boyner: 1000,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normPlatform(name) {
  return String(name || "Diğer").trim().toLocaleLowerCase("tr-TR");
}

function getPlatformThreshold(platform) {
  const key = normPlatform(platform);
  for (const [k, v] of Object.entries(PLATFORM_FREE_SHIPPING_THRESHOLD)) {
    if (key.includes(k)) return v;
  }
  return 500;
}

/**
 * Optimizes a shopping cart of items, each with `{ id, title, quantity, offers: [...] }`.
 */
export function optimizeCart(cartItems) {
  const validItems = (cartItems || [])
    .filter((it) => it && Array.isArray(it.offers) && it.offers.length > 0)
    .map((it) => ({
      id: it.id,
      title: it.title,
      image: it.image || "",
      quantity: Math.max(1, Number.parseInt(it.quantity, 10) || 1),
      offers: it.offers
        .filter((o) => typeof o.basePrice === "number" && o.basePrice > 0 && !o.isSuspiciousLow)
        .sort((a, b) => (a.netPrice ?? a.basePrice) - (b.netPrice ?? b.basePrice)),
    }))
    .filter((it) => it.offers.length > 0);

  if (!validItems.length) {
    return {
      itemCount: 0,
      splitStrategy: null,
      singleStoreOptions: [],
      recommendation: null,
    };
  }

  // Strategy 1: Split-Store (pick cheapest valid net offer per item, consolidating shipping if same store!)
  const splitAssignments = [];
  const splitByStore = new Map();

  for (const item of validItems) {
    const best = item.offers[0];
    const plat = best.store?.platform || "Diğer";
    const lineBase = round2(best.basePrice * item.quantity);
    const unitShip = best.shippingCost ?? best.shipping?.cost ?? 0;

    splitAssignments.push({
      itemId: item.id,
      title: item.title,
      quantity: item.quantity,
      platform: plat,
      store: best.store?.displayName || plat,
      unitBasePrice: best.basePrice,
      lineBasePrice: lineBase,
      unitShipping: unitShip,
      isFreeShipping: Boolean(best.shipping?.isFree || unitShip === 0),
      url: best.url,
    });

    const pKey = normPlatform(plat);
    if (!splitByStore.has(pKey)) {
      splitByStore.set(pKey, {
        platform: plat,
        subtotal: 0,
        maxShip: 0,
        allFree: true,
        items: [],
      });
    }
    const bucket = splitByStore.get(pKey);
    bucket.subtotal = round2(bucket.subtotal + lineBase);
    if (!best.shipping?.isFree && unitShip > 0) {
      bucket.allFree = false;
      bucket.maxShip = Math.max(bucket.maxShip, unitShip);
    }
    bucket.items.push(item.title);
  }

  let splitSubtotal = 0;
  let splitShipping = 0;
  const splitStoreSummary = [];
  for (const bucket of splitByStore.values()) {
    const threshold = getPlatformThreshold(bucket.platform);
    const effectiveShip =
      bucket.allFree || bucket.subtotal >= threshold ? 0 : bucket.maxShip;
    splitSubtotal = round2(splitSubtotal + bucket.subtotal);
    splitShipping = round2(splitShipping + effectiveShip);
    splitStoreSummary.push({
      platform: bucket.platform,
      itemCount: bucket.items.length,
      subtotal: bucket.subtotal,
      shipping: effectiveShip,
      total: round2(bucket.subtotal + effectiveShip),
      freeShippingUnlocked: !bucket.allFree && bucket.maxShip > 0 && effectiveShip === 0,
    });
  }

  const splitStrategy = {
    subtotal: splitSubtotal,
    shipping: splitShipping,
    total: round2(splitSubtotal + splitShipping),
    storeCount: splitStoreSummary.length,
    stores: splitStoreSummary,
    assignments: splitAssignments,
  };

  // Strategy 2: Single-Store Consolidation (for every marketplace present across items)
  const allPlatforms = new Map();
  for (const item of validItems) {
    for (const o of item.offers) {
      const plat = o.store?.platform || "Diğer";
      const key = normPlatform(plat);
      if (!allPlatforms.has(key)) allPlatforms.set(key, plat);
    }
  }

  const singleStoreOptions = [];
  for (const [pKey, platName] of allPlatforms.entries()) {
    const matched = [];
    const missing = [];
    let subtotal = 0;
    let maxShip = 0;
    let anyPaidShip = false;

    for (const item of validItems) {
      const storeOffer = item.offers.find((o) => normPlatform(o.store?.platform) === pKey);
      if (storeOffer) {
        const lineBase = round2(storeOffer.basePrice * item.quantity);
        const ship = storeOffer.shippingCost ?? storeOffer.shipping?.cost ?? 0;
        subtotal = round2(subtotal + lineBase);
        if (!storeOffer.shipping?.isFree && ship > 0) {
          anyPaidShip = true;
          maxShip = Math.max(maxShip, ship);
        }
        matched.push({
          itemId: item.id,
          title: item.title,
          quantity: item.quantity,
          unitBasePrice: storeOffer.basePrice,
          lineBasePrice: lineBase,
          url: storeOffer.url,
        });
      } else {
        missing.push(item.title);
      }
    }

    if (matched.length < Math.min(2, validItems.length)) continue;

    const threshold = getPlatformThreshold(platName);
    const shipping = !anyPaidShip || subtotal >= threshold ? 0 : maxShip;
    const total = round2(subtotal + shipping);
    const coversAll = missing.length === 0;

    singleStoreOptions.push({
      platform: platName,
      coversAll,
      matchedCount: matched.length,
      totalItems: validItems.length,
      missing,
      subtotal,
      shipping,
      total,
      diffVsSplit: coversAll ? round2(total - splitStrategy.total) : null,
      items: matched,
    });
  }

  singleStoreOptions.sort((a, b) => {
    if (a.coversAll !== b.coversAll) return a.coversAll ? -1 : 1;
    if (a.matchedCount !== b.matchedCount) return b.matchedCount - a.matchedCount;
    return a.total - b.total;
  });

  const bestFullSingle = singleStoreOptions.find((s) => s.coversAll) || null;

  let recommendation;
  if (validItems.length === 1) {
    recommendation = {
      winner: "single",
      savings: 0,
      headline: `Sepetinizde 1 ürün var — en ucuz net seçenek ${splitStrategy.stores[0]?.platform} (${splitStrategy.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL).`,
      detail: "Birden fazla ürün ekleyerek tek mağaza vs karışık mağaza kargo optimizasyonunu görebilirsiniz.",
    };
  } else if (bestFullSingle && bestFullSingle.total <= splitStrategy.total) {
    const saved = round2(splitStrategy.total - bestFullSingle.total);
    recommendation = {
      winner: "single",
      bestPlatform: bestFullSingle.platform,
      savings: saved,
      headline: `Tüm sepeti tek mağazadan (${bestFullSingle.platform}) almak en avantajlısı!`,
      detail:
        saved > 0
          ? `Toplam ${bestFullSingle.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL — tek kargo / ücretsiz kargo avantajıyla karışık almaya göre ${saved.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL tasarruf sağlarsınız.`
          : `Toplam ${bestFullSingle.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL — aynı fiyata tüm ürünleri tek pakette/tek mağazadan alabilirsiniz.`,
    };
  } else if (bestFullSingle) {
    const saved = round2(bestFullSingle.total - splitStrategy.total);
    recommendation = {
      winner: "split",
      savings: saved,
      headline: `${splitStrategy.storeCount} farklı mağazadan karışık almak ${saved.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL daha ucuz!`,
      detail: `Karışık sepet toplamı ${splitStrategy.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL (en ucuz tek mağaza olan ${bestFullSingle.platform}: ${bestFullSingle.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL).`,
    };
  } else {
    recommendation = {
      winner: "split",
      savings: 0,
      headline: `En ucuz toplam maliyet: ${splitStrategy.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL (${splitStrategy.storeCount} mağaza).`,
      detail: "Sepetteki tüm ürünleri tek başına satan tek bir mağaza bulunmadı; her ürünü kendi en ucuz mağazasından almak en iyi seçenek.",
    };
  }

  return {
    itemCount: validItems.length,
    totalUnits: validItems.reduce((s, it) => s + it.quantity, 0),
    splitStrategy,
    singleStoreOptions: singleStoreOptions.slice(0, 6),
    recommendation,
  };
}
