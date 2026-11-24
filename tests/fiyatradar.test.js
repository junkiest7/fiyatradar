import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeOfferAuthenticity,
  areColorsCompatible,
  extractUnitInfo,
  extractVariantAttributes,
  isAccessoryTitle,
  parseDeliverySpeed,
  parseShipping,
  parseStoreInfo,
  parseTrDate,
  parseTrPrice,
  suggestWatchlistFolder,
  transliterateTr,
} from "../src/parsers.js";
import {
  analyzeOffers,
  analyzePriceHistory,
  annotateSearchPricePositions,
  classifyCardPricePosition,
  detectFakeDiscount,
} from "../src/analyzer.js";
import { getProductDetail, searchProducts } from "../src/scraper.js";
import {
  buildSecondHandQuickLinks,
  buildTurkeySearchResponse,
  classifyStoreUrl,
  detectSecondHandCondition,
  extractAkinonAvailableSizes,
  extractOrganicPriceInfo,
  fetchLiveProductPrice,
  getVirtualDetail,
  isPriceAggregatorUrl,
  isSecondHandOffer,
  matchesZeroKeyQuery,
  mergeLiveAndSerperResults,
  mergeZeroKeyStoreItems,
  pickBestProductImage,
  resolveBarcode,
  resolveStoreFromUrl,
  searchOfficialFallback,
  searchSecondHandTurkey,
  sortAvailableSizes,
} from "../src/providers.js";
import {
  getPushSubscriptions,
  getWatchlist,
  removePushSubscription,
  removeWatchlistItem,
  savePushSubscription,
  summarizeWatchlistBudget,
  updateWatchlistItem,
  upsertWatchlistItem,
} from "../src/db.js";
import {
  detectWatchlistPushAlerts,
  getPushConfig,
  isValidPushEndpoint,
} from "../src/push.js";
import { extractQueryFromStoreUrl, isExternalStoreUrl } from "../src/urlResolver.js";
import { optimizeCart } from "../src/optimizer.js";
import { extractSharedQuery, isPrivateOrReservedIp } from "../src/server.js";
import { cleanOcrProductLines } from "../public/mediaSearch.js";

test("parseTrPrice handles both Turkish and Google/US formatted currency strings accurately", () => {
  assert.equal(parseTrPrice("54.999,00 TL"), 54999);
  assert.equal(parseTrPrice("₺54,999.00"), 54999);
  assert.equal(parseTrPrice("TRY 54,999.00"), 54999);
  assert.equal(parseTrPrice("55.377,24 TL"), 55377.24);
  assert.equal(parseTrPrice("1,299.90 ₺"), 1299.9);
  assert.equal(parseTrPrice("1.990,00 TL"), 1990);
  assert.equal(parseTrPrice("2.490 TL"), 2490);
  assert.equal(parseTrPrice("+44,99 TL kargo"), 44.99);
  assert.equal(parseTrPrice("717,80 TL"), 717.8);
  assert.equal(parseTrPrice("6.900 TL"), 6900);
  assert.equal(parseTrPrice(""), null);
});

test("transliterateTr & isAccessoryTitle filter accessories only when query does not request them", () => {
  assert.equal(transliterateTr("gucci güneş gözlüğü"), "gucci gunes gozlugu");
  assert.equal(transliterateTr("ÇİÇEK ŞİŞE ÖRDEK ÜZÜM"), "CICEK SISE ORDEK UZUM");

  assert.equal(isAccessoryTitle("iPhone 17 Pro MagSafe Silikon Kılıf", "iphone 17"), true);
  assert.equal(isAccessoryTitle("iPhone 17 Pro MagSafe Silikon Kılıf", "iphone 17 kılıf"), false);
  assert.equal(isAccessoryTitle("Philips Airfryer Pişirme Kağıdı 100'lü", "philips airfryer"), true);
  assert.equal(isAccessoryTitle("Apple iPhone 17 256 GB Siyah", "iphone 17"), false);
  assert.equal(isAccessoryTitle("Gucci GG1221S Kadın Güneş Gözlüğü", "gucci güneş gözlüğü"), false);
  assert.equal(isAccessoryTitle("Gucci Gözlük Kılıfı & Temizleme Bezi", "gucci güneş gözlüğü"), true);
});

test("extractOrganicPriceInfo extracts TL prices, installment totals, and shipping from Google TR snippets", () => {
  const s1 = extractOrganicPriceInfo({
    title: "Kadın Topuklu Ayakkabı | Stradivarius Türkiye",
    snippet: "Metal detaylı topuklu ayakkabı. 1.990,00 TL. Night Out.",
  });
  assert.equal(s1.price, 1990);

  const s2 = extractOrganicPriceInfo({
    title: "Stradivarius Basic topuklu ayakkabı - Trendyol",
    snippet: "Stradivarius Basic topuklu ayakkabı. Peşin Fiyatına 3 Taksit. 3x 596,67 TL. 4.6.",
  });
  assert.equal(s2.price, 1790.01);
  assert.equal(s2.source, "installment");

  const s3 = extractOrganicPriceInfo({
    title: "Apple iPhone 17 256GB Siyah - Trendyol",
    snippet: "500 TL üzeri kargo bedava! Kargo Bedava. 115.698,70 TL",
  });
  assert.equal(s3.price, 115698.7);
  assert.equal(s3.shipping.isFree, true);

  assert.equal(resolveStoreFromUrl("https://www.stradivarius.com/tr/kadin/topuklu").platform, "Stradivarius");
  assert.equal(resolveStoreFromUrl("https://www.trendyol.com/apple/iphone-17").platform, "Trendyol");
  assert.equal(resolveStoreFromUrl("https://www.amazon.com.tr/dp/B001").platform, "Amazon Türkiye");
});

test("parseShipping distinguishes free vs paid shipping", () => {
  const free = parseShipping("Ücretsiz kargo");
  assert.equal(free.isFree, true);
  assert.equal(free.cost, 0);

  const paid = parseShipping("+44,99 TL kargo");
  assert.equal(paid.isFree, false);
  assert.equal(paid.cost, 44.99);
});

test("parseTrDate converts DD.MM.YYYY to ISO YYYY-MM-DD", () => {
  assert.equal(parseTrDate("23.11.2026"), "2026-11-23");
  assert.equal(parseTrDate("invalid"), null);
});

test("extractUnitInfo extracts kg, multipack ml, counts, and storage correctly", () => {
  const coffee = extractUnitInfo("Lavazza Crema E Aroma Çekirdek Kahve 1000 gr", 720);
  assert.equal(coffee.unit, "kg");
  assert.equal(coffee.quantity, 1);
  assert.equal(coffee.unitPrice, 720);

  const multipack = extractUnitInfo("Süt 6 x 200 ml Paket", 120);
  assert.equal(multipack.unit, "lt");
  assert.equal(multipack.quantity, 1.2);
  assert.equal(multipack.unitPrice, 100);

  const diaper = extractUnitInfo("Prima Bebek Bezi 120'li Fırsat Paketi", 600);
  assert.equal(diaper.unit, "adet");
  assert.equal(diaper.quantity, 120);
  assert.equal(diaper.unitPrice, 5);

  // Airfryer 7.2 lt should NOT be treated as a liquid consumable TL/lt
  const fryer = extractUnitInfo("Philips Airfryer 7.2 lt Yağsız Fritöz", 6762);
  assert.equal(fryer, null);

  const phone = extractUnitInfo("iPhone 15 128 GB Mavi", 54999);
  assert.equal(phone.unit, "GB");
  assert.equal(phone.quantity, 128);
});

test("analyzeOffers detects shipping traps, high outliers, and suspiciously-low anomalies", () => {
  const rawOffers = [
    {
      id: "o1",
      basePrice: 6899,
      shipping: parseShipping("+44,99 TL kargo"),
      store: parseStoreInfo("Trendyol", ""),
      inStock: true,
      delivery: parseDeliverySpeed("Yarın kargoda"),
      url: "https://trendyol.com/a",
    },
    {
      id: "o2",
      basePrice: 6900,
      shipping: parseShipping("Ücretsiz kargo"),
      store: parseStoreInfo("n11", "/mediamarkt"),
      inStock: true,
      delivery: parseDeliverySpeed("2 iş günü"),
      url: "https://n11.com/b",
    },
    {
      id: "o3",
      basePrice: 12500,
      shipping: parseShipping("Ücretsiz kargo"),
      store: parseStoreInfo("Pazarama", "/pahalisatici"),
      inStock: true,
      delivery: parseDeliverySpeed("3 iş günü"),
      url: "https://pazarama.com/c",
    },
  ];

  const analysis = analyzeOffers(rawOffers, null);
  // o2 (6900 net) must beat o1 (6943.99 net) even though o1 had lower sticker price!
  assert.equal(analysis.offers[0].id, "o2");
  assert.equal(analysis.offers[0].netPrice, 6900);
  assert.equal(analysis.offers[1].id, "o1");
  assert.equal(analysis.offers[1].netPrice, 6943.99);
  assert.equal(analysis.offers[1].isShippingTrap, true);
  assert.equal(analysis.shippingTraps.length, 1);
  assert.equal(analysis.offers[2].isOutlier, true);

  // Suspiciously-low fake/case listing (e.g. 1.104 TL alongside ~11.500 TL authentic sunglasses)
  const luxuryOffers = [
    { id: "fake", basePrice: 1104, shipping: parseShipping("Ücretsiz kargo"), store: parseStoreInfo("Trendyol", "/x"), inStock: true, delivery: parseDeliverySpeed("2 gün"), url: "https://t.co/1" },
    { id: "g1", basePrice: 10500, shipping: parseShipping("Ücretsiz kargo"), store: parseStoreInfo("Boyner", ""), inStock: true, delivery: parseDeliverySpeed("2 gün"), url: "https://t.co/2" },
    { id: "g2", basePrice: 11200, shipping: parseShipping("Ücretsiz kargo"), store: parseStoreInfo("Beymen", ""), inStock: true, delivery: parseDeliverySpeed("2 gün"), url: "https://t.co/3" },
    { id: "g3", basePrice: 11800, shipping: parseShipping("Ücretsiz kargo"), store: parseStoreInfo("Atasun Optik", ""), inStock: true, delivery: parseDeliverySpeed("2 gün"), url: "https://t.co/4" },
    { id: "g4", basePrice: 12400, shipping: parseShipping("Ücretsiz kargo"), store: parseStoreInfo("Hepsiburada", ""), inStock: true, delivery: parseDeliverySpeed("2 gün"), url: "https://t.co/5" },
  ];
  const luxAnalysis = analyzeOffers(luxuryOffers, null);
  const fakeOffer = luxAnalysis.offers.find((o) => o.id === "fake");
  assert.equal(fakeOffer.isSuspiciousLow, true);
  assert.equal(luxAnalysis.stats.suspiciousLowCount, 1);
  assert.equal(luxAnalysis.stats.minNet, 10500);
  assert.equal(luxAnalysis.picks.cheapestNet.netPrice, 10500);
});

test("analyzePriceHistory calculates buy timing score and verdict", () => {
  const history = [
    { isoDate: "2026-09-01", dateLabel: "01.09.2026", price: 1200 },
    { isoDate: "2026-10-01", dateLabel: "01.10.2026", price: 1150 },
    { isoDate: "2026-11-01", dateLabel: "01.11.2026", price: 1100 },
    { isoDate: "2026-11-20", dateLabel: "20.11.2026", price: 1020 },
    { isoDate: "2026-11-23", dateLabel: "23.11.2026", price: 1000 },
  ];
  const res = analyzePriceHistory(history, 1000);
  assert.equal(res.summary.minPrice, 1000);
  assert.equal(res.summary.maxPrice, 1200);
  assert.ok(res.verdict.score >= 75, `Expected strong buy score >= 75, got ${res.verdict.score}`);
});

test("urlResolver recognizes Turkish store URLs, rejects unsafe/non-store URLs, and extracts clean queries", () => {
  assert.equal(isExternalStoreUrl("https://www.trendyol.com/apple/iphone-17-256gb-siyah-p-985256842"), true);
  assert.equal(isExternalStoreUrl("https://www.hepsiburada.com/philips-airfryer-xxl-hd9650-90-p-HBV00000ABC"), true);
  assert.equal(isExternalStoreUrl("https://www.stradivarius.com/tr/kadin-topuklu-ayakkabi-l19234370"), true);
  assert.equal(isExternalStoreUrl("https://ty.gl/abc123"), true);
  assert.equal(isExternalStoreUrl("https://www.akakce.com/cep-telefonu/en-ucuz-iphone-15-fiyati,12345.html"), false);
  assert.equal(isExternalStoreUrl("http://localhost:3456/admin"), false);
  assert.equal(isExternalStoreUrl("http://169.254.169.254/latest/meta-data"), false);

  const ty = extractQueryFromStoreUrl("https://www.trendyol.com/apple/iphone-17-256gb-siyah-p-985256842");
  assert.match(ty.toLowerCase(), /apple.*iphone 17 256gb siyah/);

  const hb = extractQueryFromStoreUrl("https://www.hepsiburada.com/philips-airfryer-xxl-hd9650-90-p-HBV00000ABC");
  assert.match(hb.toLowerCase(), /philips airfryer xxl/);

  const strad = extractQueryFromStoreUrl("https://www.stradivarius.com/tr/kadin-topuklu-ayakkabi-l19234370");
  assert.match(strad.toLowerCase(), /stradivarius.*topuklu ayakkabi/);

  const cimri = extractQueryFromStoreUrl("https://www.cimri.com/cep-telefonlari/en-ucuz-apple-iphone-17-fiyatlari,a2393572193");
  assert.match(cimri.toLowerCase(), /apple iphone 17/);

  const n11 = extractQueryFromStoreUrl("https://www.n11.com/urun/apple-iphone-15-128-gb-43821353");
  assert.match(n11.toLowerCase(), /apple iphone 15 128 gb/);
});

test("optimizeCart picks Single-Store when free-shipping consolidation saves money, and Split-Store when cheaper", () => {
  // Case 1: Single-Store wins due to Trendyol 250 TL free-shipping threshold
  const cartConsolidate = [
    {
      id: "i1",
      title: "Kahve 250g",
      quantity: 1,
      offers: [
        { basePrice: 140, shippingCost: 50, netPrice: 190, shipping: { isFree: false, cost: 50 }, store: { platform: "n11", displayName: "n11" }, url: "https://n11.com/1" },
        { basePrice: 145, shippingCost: 45, netPrice: 190, shipping: { isFree: false, cost: 45 }, store: { platform: "Trendyol", displayName: "Trendyol" }, url: "https://trendyol.com/1" },
      ],
    },
    {
      id: "i2",
      title: "Filtre Kağıdı",
      quantity: 1,
      offers: [
        { basePrice: 115, shippingCost: 50, netPrice: 165, shipping: { isFree: false, cost: 50 }, store: { platform: "Hepsiburada", displayName: "Hepsiburada" }, url: "https://hb.com/2" },
        { basePrice: 120, shippingCost: 45, netPrice: 165, shipping: { isFree: false, cost: 45 }, store: { platform: "Trendyol", displayName: "Trendyol" }, url: "https://trendyol.com/2" },
      ],
    },
  ];
  const plan1 = optimizeCart(cartConsolidate);
  // Split = (140+50) + (115+50) = 355 TL; Trendyol single = 145+120 = 265 TL (>=250 -> free ship!) => 90 TL savings!
  assert.equal(plan1.recommendation.winner, "single");
  assert.equal(plan1.recommendation.bestPlatform, "Trendyol");
  assert.equal(plan1.recommendation.savings, 90);

  // Case 2: Split-Store wins easily on big-ticket items with free shipping
  const cartSplit = [
    {
      id: "b1",
      title: "Airfryer",
      quantity: 1,
      offers: [
        { basePrice: 5000, shippingCost: 0, netPrice: 5000, shipping: { isFree: true, cost: 0 }, store: { platform: "Amazon Türkiye", displayName: "Amazon Türkiye" }, url: "https://amazon.com.tr/1" },
        { basePrice: 5800, shippingCost: 0, netPrice: 5800, shipping: { isFree: true, cost: 0 }, store: { platform: "Trendyol", displayName: "Trendyol" }, url: "https://trendyol.com/1" },
      ],
    },
    {
      id: "b2",
      title: "Blender",
      quantity: 1,
      offers: [
        { basePrice: 2000, shippingCost: 0, netPrice: 2000, shipping: { isFree: true, cost: 0 }, store: { platform: "Trendyol", displayName: "Trendyol" }, url: "https://trendyol.com/2" },
        { basePrice: 2600, shippingCost: 0, netPrice: 2600, shipping: { isFree: true, cost: 0 }, store: { platform: "Amazon Türkiye", displayName: "Amazon Türkiye" }, url: "https://amazon.com.tr/2" },
      ],
    },
  ];
  const plan2 = optimizeCart(cartSplit);
  assert.equal(plan2.recommendation.winner, "split");
  assert.equal(plan2.splitStrategy.total, 7000);
  assert.equal(plan2.recommendation.savings, 600);
});

test("Live integration: resolveBarcode resolves EAN-13 Nutella barcode via Open Food Facts", async () => {
  const b = await resolveBarcode("3017620422003");
  assert.equal(b.code, "3017620422003");
  assert.match(b.query.toLowerCase(), /nutella/);
});

test("Live integration: searchProducts & getProductDetail return real Turkish market data", async () => {
  const search = await searchProducts("philips airfryer");
  assert.ok(search.products.length >= 5, `Expected >= 5 search results, got ${search.products.length}`);
  const first = search.products[0];
  assert.ok(first.url.startsWith("https://www.akakce.com/"));
  assert.ok(first.lowestPrice > 0);

  const detail = await getProductDetail(first.url);
  assert.ok(detail.offers.length >= 2, `Expected >= 2 store offers, got ${detail.offers.length}`);
  assert.ok(detail.stats.minNet > 0);
  assert.ok(detail.picks.cheapestNet.netPrice === detail.stats.minNet);
  assert.ok(detail.verdict.score >= 1 && detail.verdict.score <= 100);
});

test("Live integration: cloud-proof official fallback (MarketFiyati + Migros) returns real products & detail", async () => {
  const fb = await searchOfficialFallback("prima bebek bezi");
  assert.ok(fb.products.length >= 2, `Expected >= 2 fallback products, got ${fb.products.length}`);
  const first = fb.products[0];
  assert.ok(first.url.startsWith("virtual:"));
  assert.ok(first.lowestPrice > 0);
  const det = await getProductDetail(first.url);
  assert.ok(det.offers.length >= 1);
  assert.ok(det.stats.minNet > 0);
  assert.ok(getVirtualDetail(first.url) !== null);
});

test("extractVariantAttributes extracts capacity, color, size, and volume for variant grouping", () => {
  const phone = extractVariantAttributes("Apple iPhone 16 Pro 256 GB Çöl Titanyum");
  assert.equal(phone.capacity, "256 GB");
  assert.equal(phone.color, "Çöl Titanyum");

  const laptop = extractVariantAttributes("MacBook Air M3 16 GB RAM 512 GB SSD Uzay Grisi");
  assert.equal(laptop.capacity, "512 GB");
  assert.equal(laptop.color, "Uzay Grisi");

  const shoe = extractVariantAttributes("Stradivarius Siyah Topuklu Ayakkabı 38 Numara");
  assert.equal(shoe.color, "Siyah");
  assert.equal(shoe.size, "38 Numara");

  const shirt = extractVariantAttributes("Zara Ekru Keten Gömlek M Beden");
  assert.equal(shirt.color, "Ekru");
  assert.equal(shirt.size, "M Beden");

  const coffee = extractVariantAttributes("Lavazza Crema e Aroma 1000 gr Çekirdek Kahve");
  assert.equal(coffee.volume, "1 kg");
});

test("cleanOcrProductLines strips phone/shopping UI noise and extracts clean product queries", () => {
  const rawScreenshot = `
    14:32
    5G
    89%
    Trendyol
    Apple iPhone 17 Pro 256 GB Siyah
    78.499,00 TL
    Ücretsiz Kargo
    Sepete Ekle
    Favorilere Ekle
    4.8 (124)
  `;
  const parsed = cleanOcrProductLines(rawScreenshot);
  assert.equal(parsed.bestQuery, "Apple iPhone 17 Pro 256 GB Siyah");
  assert.ok(!parsed.candidates.some((c) => /sepete ekle|ücretsiz kargo|14:32/i.test(c)));
});

test("isPrivateOrReservedIp blocks loopback, link-local, and RFC1918 addresses while allowing public IPs", () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("10.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true);
  assert.equal(isPrivateOrReservedIp("172.16.5.2"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.10"), true);
  assert.equal(isPrivateOrReservedIp("::1"), true);
  assert.equal(isPrivateOrReservedIp("fe80::1"), true);
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("104.18.2.1"), false);
});

test("classifyStoreUrl separates direct product pages from category/search listing pages across Turkish stores", () => {
  // Trendyol: category/search vs direct product (-p-<id>)
  const tyCat = classifyStoreUrl("https://www.trendyol.com/zara-erkek-parfum-x-b101476-c103706", "Zara Erkek Parfüm Modelleri ve Fiyatları");
  assert.equal(tyCat.isListingPage, true);
  assert.equal(tyCat.isProductPage, false);

  const tySearch = classifyStoreUrl("https://www.trendyol.com/sr?q=zara+erkek+parfumeri");
  assert.equal(tySearch.isListingPage, true);
  assert.equal(tySearch.isProductPage, false);

  const tyProd = classifyStoreUrl("https://www.trendyol.com/zara/vibrant-leather-edp-100-ml-p-34055913");
  assert.equal(tyProd.isProductPage, true);
  assert.equal(tyProd.isListingPage, false);
  assert.equal(tyProd.productId, "ty:34055913");

  // Hepsiburada
  assert.equal(classifyStoreUrl("https://www.hepsiburada.com/zara-parfumler-xc-341414").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.hepsiburada.com/ara?q=zara+parfum").isListingPage, true);
  const hbProd = classifyStoreUrl("https://www.hepsiburada.com/zara-seoul-100-ml-p-HBCV000012345");
  assert.equal(hbProd.isProductPage, true);
  assert.equal(hbProd.productId, "hb:hbcv000012345");

  // Amazon TR & n11
  assert.equal(classifyStoreUrl("https://www.amazon.com.tr/s?k=zara+parfum").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.amazon.com.tr/Zara-Vibrant-Leather/dp/B08XYZ1234").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.n11.com/arama?q=zara+parfum").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.n11.com/urun/zara-seoul-edt-100-ml-48291023").isProductPage, true);

  // Zara & Stradivarius & Akakçe
  assert.equal(classifyStoreUrl("https://www.zara.com/tr/tr/erkek-aksesuar-parfum-l551.html").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.zara.com/tr/tr/red-vanilla-90-ml-p20110510.html").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.stradivarius.com/tr/kadin/giyim/gomlekler-n1980").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.stradivarius.com/tr/poplin-gomlek-l19234370").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.akakce.com/parfum/zara.html").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.akakce.com/parfum/en-ucuz-zara-man-silver-fiyati,105786078.html").isProductPage, true);
});

test("extractOrganicPriceInfo rejects listing minimums, monthly installments, wide ranges, and shipping thresholds", () => {
  // 1. Trendyol category/search page with misleading 552 TL must NOT be priced
  const catItem = extractOrganicPriceInfo({
    title: "Zara Erkek Parfümeri Modelleri ve Fiyatları - Trendyol",
    link: "https://www.trendyol.com/zara-erkek-parfum-x-b101476-c103706",
    price: 552,
    snippet: "Zara erkek parfüm çeşitleri 552 TL'den başlayan fiyatlarla Trendyol'da!",
  });
  assert.equal(catItem.price, null);
  assert.equal(catItem.source, "listing");

  // 2. Monthly installment without interest-free guarantee ("ayda 552 TL" / "3 taksitle ayda 552 TL") -> NEVER return 552
  const monthlyOnly = extractOrganicPriceInfo({
    title: "Zara Vibrant Leather EDP 100 ml - Trendyol",
    link: "https://www.trendyol.com/zara/vibrant-leather-edp-100-ml-p-34055913",
    snippet: "3 taksitle ayda 552,00 TL'den başlayan taksitlerle. Ücretsiz kargo.",
  });
  assert.equal(monthlyOnly.price, null);

  // 3. Interest-free "Peşin fiyatına 3 taksit 552,00 TL" -> returns total cash price 1656 TL, NOT 552 TL
  const interestFreeInst = extractOrganicPriceInfo({
    title: "Zara Vibrant Leather EDP 100 ml - Trendyol",
    link: "https://www.trendyol.com/zara/vibrant-leather-edp-100-ml-p-34055913",
    snippet: "Peşin fiyatına 3 taksit 552,00 TL.",
  });
  assert.equal(interestFreeInst.price, 1656);
  assert.equal(interestFreeInst.source, "installment");

  // 4. Rich item.price accidentally scraped as monthly installment 552 while cash price 1.656 TL is in snippet
  const badRichInst = extractOrganicPriceInfo({
    title: "Zara Vibrant Leather EDP 100 ml - Trendyol",
    link: "https://www.trendyol.com/zara/vibrant-leather-edp-100-ml-p-34055913",
    price: 552,
    snippet: "1.656,00 TL. Peşin fiyatına 3x 552,00 TL taksit imkanı.",
  });
  assert.equal(badRichInst.price, 1656);
  assert.equal(badRichInst.source, "snippet");

  // 5. Pattern B ("₺") respects shipping threshold ("ve üzeri") and installment filters ("₺552 x 6")
  const patternB = extractOrganicPriceInfo({
    title: "Zara Seoul 100 ml",
    link: "https://www.hepsiburada.com/zara-seoul-100-ml-p-HBCV00001",
    snippet: "₺500 ve üzeri kargo bedava! ₺552 x 6 taksit. ₺1.890,00",
  });
  assert.equal(patternB.price, 1890);

  // 6. Wide priceRange ("552 TL - 3.499 TL") is rejected instead of showing 552 TL
  const wideRange = extractOrganicPriceInfo({
    title: "Zara Parfüm Seti",
    link: "https://www.trendyol.com/zara/parfum-seti-p-99999",
    priceRange: "552 TL - 3.499 TL",
    snippet: "552 TL - 3.499 TL arası seçenekler.",
  });
  assert.equal(wideRange.price, null);

  // 7. Shipping threshold "500 TL ve üzeri kargo bedava" & large installment >= 2000 TL skipped
  const bigInst = extractOrganicPriceInfo({
    title: "Apple iPhone 17 256 GB",
    link: "https://www.trendyol.com/apple/iphone-17-256gb-p-123456",
    snippet: "500 TL ve üzeri kargo bedava. 2.500 TL x 12 taksit. 28.999,00 TL",
  });
  assert.equal(bigInst.price, 28999);
});

test("pickBestProductImage matches exact colors (Siyah/Beyaz/Yeşil), blocks color conflicts, and deduplicates photos", () => {
  assert.equal(areColorsCompatible("Siyah", "Beyaz"), false);
  assert.equal(areColorsCompatible("Siyah", "Yeşil"), false);
  assert.equal(areColorsCompatible("Beyaz", "Kırık Beyaz"), true);

  // Simulate Stradivarius gömlek pool where Siyah is listed FIRST on trendyol.com!
  const pool = [
    {
      title: "Stradivarius Siyah Poplin Gömlek - Trendyol",
      link: "https://www.trendyol.com/stradivarius/siyah-poplin-gomlek-p-111",
      thumbnailUrl: "https://img.example.com/siyah-1.jpg",
    },
    {
      title: "Stradivarius Siyah Keten Gömlek - Trendyol",
      link: "https://www.trendyol.com/stradivarius/siyah-keten-gomlek-p-112",
      thumbnailUrl: "https://img.example.com/siyah-2.jpg",
    },
    {
      title: "Stradivarius Beyaz Poplin Gömlek - Trendyol",
      link: "https://www.trendyol.com/stradivarius/beyaz-poplin-gomlek-p-222",
      thumbnailUrl: "https://img.example.com/beyaz-1.jpg",
      _hintColor: "Beyaz",
    },
    {
      title: "Stradivarius Yeşil Keten Gömlek - Stradivarius",
      link: "https://www.stradivarius.com/tr/yesil-keten-gomlek-l02135421",
      thumbnailUrl: "https://img.example.com/yesil-1.jpg",
      _hintColor: "Yeşil",
    },
  ];

  const used = new Set();
  const imgBlack1 = pickBestProductImage(
    {
      title: "Stradivarius Siyah Poplin Gömlek",
      url: "https://www.trendyol.com/stradivarius/siyah-poplin-gomlek-p-111",
      host: "trendyol.com",
      productId: "ty:111",
      color: "Siyah",
      slug: "stradivarius siyah poplin gomlek p 111",
    },
    pool,
    used,
    "stradivarius gomlek"
  );
  const imgWhite = pickBestProductImage(
    {
      title: "Stradivarius Beyaz Poplin Gömlek",
      url: "https://www.trendyol.com/stradivarius/beyaz-poplin-gomlek-p-999",
      host: "trendyol.com",
      productId: "ty:999",
      color: "Beyaz",
      slug: "stradivarius beyaz poplin gomlek p 999",
    },
    pool,
    used,
    "stradivarius gomlek"
  );
  const imgGreen = pickBestProductImage(
    {
      title: "Stradivarius Yeşil Keten Gömlek",
      url: "https://www.trendyol.com/stradivarius/yesil-keten-gomlek-p-888",
      host: "trendyol.com",
      productId: "ty:888",
      color: "Yeşil",
      slug: "stradivarius yesil keten gomlek p 888",
    },
    pool,
    used,
    "stradivarius gomlek"
  );
  const imgBlack2 = pickBestProductImage(
    {
      title: "Stradivarius Siyah Keten Gömlek",
      url: "https://www.trendyol.com/stradivarius/siyah-keten-gomlek-p-777",
      host: "trendyol.com",
      productId: "ty:777",
      color: "Siyah",
      slug: "stradivarius siyah keten gomlek p 777",
    },
    pool,
    used,
    "stradivarius gomlek"
  );

  assert.equal(imgBlack1, "https://img.example.com/siyah-1.jpg");
  assert.equal(imgWhite, "https://img.example.com/beyaz-1.jpg");
  assert.equal(imgGreen, "https://img.example.com/yesil-1.jpg");
  assert.equal(imgBlack2, "https://img.example.com/siyah-2.jpg");

  // Hard conflict guard: if pool ONLY contains black shirt images, a purple shirt MUST NOT get a black photo!
  const blackOnlyPool = [pool[0]];
  const imgPurple = pickBestProductImage(
    {
      title: "Stradivarius Mor Poplin Gömlek",
      url: "https://www.trendyol.com/stradivarius/mor-poplin-gomlek-p-555",
      host: "trendyol.com",
      productId: "ty:555",
      color: "Mor",
      slug: "stradivarius mor poplin gomlek p 555",
    },
    blackOnlyPool,
    new Set(),
    "stradivarius gomlek"
  );
  assert.equal(imgPurple, "");
});

test("buildTurkeySearchResponse isolates direct Zara perfume products from Trendyol listing pages & prevents cross-product hijacking", () => {
  const rawOrganic = [
    {
      title: "Zara Erkek Parfümeri Modelleri ve Fiyatları - Trendyol",
      link: "https://www.trendyol.com/zara-erkek-parfum-x-b101476-c103706",
      price: 552,
      snippet: "Zara erkek parfüm 552 TL'den başlayan fiyatlarla!",
    },
    {
      title: "Zara Vibrant Leather EDP 100 ml Erkek Parfüm - Trendyol",
      link: "https://www.trendyol.com/zara/vibrant-leather-edp-100-ml-p-34055913",
      snippet: "Zara Vibrant Leather EDP 100 ml. 1.650,00 TL. Ücretsiz Kargo.",
    },
    {
      title: "Zara Seoul EDT 100 ml Erkek Parfüm - Hepsiburada",
      link: "https://www.hepsiburada.com/zara-seoul-edt-100-ml-p-HBCV000012345",
      snippet: "Zara Seoul EDT 100 ml Erkek Parfüm. 1.450,00 TL. Ücretsiz Kargo.",
    },
  ];

  const resp = buildTurkeySearchResponse("zara parfüm", rawOrganic, [], "Google Türkiye (Serper)", "serper");
  const listingCard = resp.products.find((p) => p.externalUrl?.includes("x-b101476"));
  const vibrantCard = resp.products.find((p) => p.externalUrl?.includes("-p-34055913"));
  const seoulCard = resp.products.find((p) => p.externalUrl?.includes("-p-HBCV000012345"));

  // Category page MUST NOT get a fake 552 TL price
  assert.ok(listingCard);
  assert.equal(listingCard.isListingPage, true);
  assert.equal(listingCard.lowestPrice, null);

  // Direct products MUST get their real cash prices and direct product URLs
  assert.equal(vibrantCard.lowestPrice, 1650);
  assert.equal(vibrantCard.isProductPage, true);
  assert.equal(seoulCard.lowestPrice, 1450);

  // Detail view for Vibrant Leather MUST point to Vibrant Leather's own URL & price, NOT hijacked by Seoul!
  const vibrantDetail = getVirtualDetail(vibrantCard.url);
  assert.equal(vibrantDetail.picks.cheapestNet.netPrice, 1650);
  assert.equal(vibrantDetail.picks.cheapestNet.url, "https://www.trendyol.com/zara/vibrant-leather-edp-100-ml-p-34055913");
  assert.ok(vibrantDetail.variants.some((v) => v.isInternalVirtual && v.url === seoulCard.url));
});

test("detectFakeDiscount catches 'Bindirim → İndirim' traps, partial discounts, genuine drops, inflation, and list-price inflation", () => {
  // 1. Classic 11.11 / Efsane Cuma fake discount: normal ~1000 TL -> spiked to 1450 TL -> 'discounted' to 1020 TL
  const fakeSeries = [
    { isoDate: "2026-09-01", dateLabel: "01.09.2026", price: 990 },
    { isoDate: "2026-09-15", dateLabel: "15.09.2026", price: 1000 },
    { isoDate: "2026-10-01", dateLabel: "01.10.2026", price: 1010 },
    { isoDate: "2026-10-15", dateLabel: "15.10.2026", price: 1000 },
    { isoDate: "2026-11-05", dateLabel: "05.11.2026", price: 1450 },
    { isoDate: "2026-11-11", dateLabel: "11.11.2026", price: 1020 },
  ];
  const fakeRes = detectFakeDiscount(fakeSeries, 1020);
  assert.equal(fakeRes.status, "fake_discount");
  assert.equal(fakeRes.tone, "bad");
  assert.ok(fakeRes.authenticityScore <= 35, `Expected low authenticityScore, got ${fakeRes.authenticityScore}`);
  assert.equal(fakeRes.metrics.peakPrice, 1450);

  // analyzePriceHistory must cap timingScore <= 45 when fake_discount is triggered!
  const histWithTrap = analyzePriceHistory(fakeSeries, 1020);
  assert.equal(histWithTrap.fakeDiscount.status, "fake_discount");
  assert.ok(histWithTrap.verdict.score <= 45, `Expected timingScore capped <= 45 on fake discount, got ${histWithTrap.verdict.score}`);

  // 2. Partial / exaggerated discount: normal 1000 -> spiked to 1350 -> dropped to 940 (-30% advertised, -6% real)
  const partialSeries = [
    { isoDate: "2026-09-01", dateLabel: "01.09.2026", price: 1000 },
    { isoDate: "2026-09-15", dateLabel: "15.09.2026", price: 1000 },
    { isoDate: "2026-10-01", dateLabel: "01.10.2026", price: 1000 },
    { isoDate: "2026-10-20", dateLabel: "20.10.2026", price: 1000 },
    { isoDate: "2026-11-05", dateLabel: "05.11.2026", price: 1350 },
    { isoDate: "2026-11-11", dateLabel: "11.11.2026", price: 940 },
  ];
  const partialRes = detectFakeDiscount(partialSeries, 940);
  assert.equal(partialRes.status, "partial_discount");
  assert.equal(partialRes.tone, "warn");

  // 3. Genuine verified discount: stable ~2000 TL -> genuine drop to 1650 TL (-17.5%)
  const genuineSeries = [
    { isoDate: "2026-09-01", dateLabel: "01.09.2026", price: 2000 },
    { isoDate: "2026-09-20", dateLabel: "20.09.2026", price: 1990 },
    { isoDate: "2026-10-10", dateLabel: "10.10.2026", price: 2010 },
    { isoDate: "2026-11-01", dateLabel: "01.11.2026", price: 2000 },
    { isoDate: "2026-11-20", dateLabel: "20.11.2026", price: 1650 },
  ];
  const genuineRes = detectFakeDiscount(genuineSeries, 1650);
  assert.equal(genuineRes.status, "genuine_discount");
  assert.equal(genuineRes.tone, "good");
  assert.ok(genuineRes.authenticityScore >= 85);

  // 4. Currently inflated price (+18% above normal)
  const inflatedSeries = [
    { isoDate: "2026-09-01", dateLabel: "01.09.2026", price: 1000 },
    { isoDate: "2026-10-01", dateLabel: "01.10.2026", price: 1000 },
    { isoDate: "2026-11-01", dateLabel: "01.11.2026", price: 1020 },
    { isoDate: "2026-11-20", dateLabel: "20.11.2026", price: 1180 },
  ];
  const inflatedRes = detectFakeDiscount(inflatedSeries, 1180);
  assert.equal(inflatedRes.status, "inflated");

  // 5. No-history cross-store checks (inflated list price vs market median, and genuine market deal)
  const inflatedList = detectFakeDiscount([], 1000, { marketMedian: 1000, listPrice: 1450 });
  assert.equal(inflatedList.status, "fake_discount");

  const marketDeal = detectFakeDiscount([], 820, { marketMedian: 1000 });
  assert.equal(marketDeal.status, "market_deal");
  assert.equal(marketDeal.tone, "good");
});

test("suggestWatchlistFolder & summarizeWatchlistBudget + DB folder/budget persistence work cleanly", () => {
  assert.equal(suggestWatchlistFolder("Apple iPhone 17 Pro 256 GB"), "Teknoloji");
  assert.equal(suggestWatchlistFolder("Stradivarius Siyah Poplin Gömlek"), "Giyim & Ayakkabı");
  assert.equal(suggestWatchlistFolder("Zara Vibrant Leather EDP 100 ml Parfüm"), "Parfüm & Kozmetik");
  assert.equal(suggestWatchlistFolder("Philips Airfryer XXL Fritöz"), "Ev & Mutfak");
  assert.equal(suggestWatchlistFolder("Lavazza Çekirdek Kahve 1 kg"), "Market");
  assert.equal(suggestWatchlistFolder("Özel Koleksiyon Objesi"), "Diğer");

  const budget = summarizeWatchlistBudget(
    [
      {
        id: "b1",
        folder: "Teknoloji",
        initial_net_price: 50000,
        last_net_price: 46000,
        target_price: 47000,
      },
      {
        id: "b2",
        folder: "Giyim & Ayakkabı",
        initial_net_price: 1500,
        last_net_price: 1700,
        target_price: 1300,
      },
    ],
    ""
  );
  assert.equal(budget.currentTotal, 47700);
  assert.equal(budget.initialTotal, 51500);
  assert.equal(budget.targetTotal, 48300);
  assert.equal(budget.netDelta, -3800);
  assert.equal(budget.targetHits, 1);
  assert.equal(budget.folders.length, 2);

  const scopedTech = summarizeWatchlistBudget(
    [
      { id: "b1", folder: "Teknoloji", initial_net_price: 50000, last_net_price: 46000, target_price: 47000 },
      { id: "b2", folder: "Giyim & Ayakkabı", initial_net_price: 1500, last_net_price: 1700, target_price: 1300 },
    ],
    "Teknoloji"
  );
  assert.equal(scopedTech.count, 1);
  assert.equal(scopedTech.currentTotal, 46000);

  // DB round-trip test with guaranteed cleanup
  const testId = `__test_v8_${Date.now()}`;
  try {
    upsertWatchlistItem({
      id: testId,
      title: "Stradivarius Test Gömlek",
      url: `https://example.com/${testId}`,
      folder: "Giyim & Ayakkabı",
      target_price: 900,
      last_net_price: 1200,
      fake_discount_status: "fake_discount",
      fake_discount_label: "⚠ Sahte İndirim Riski",
    });

    // Update price down -> initial_net_price MUST remain 1200 so net delta is -350 TL!
    upsertWatchlistItem({
      id: testId,
      title: "Stradivarius Test Gömlek",
      url: `https://example.com/${testId}`,
      last_net_price: 850,
    });

    updateWatchlistItem(testId, { folder: "Çeyiz" });
    const row = getWatchlist().find((w) => w.id === testId);
    assert.ok(row);
    assert.equal(row.folder, "Çeyiz");
    assert.equal(row.initial_net_price, 1200);
    assert.equal(row.last_net_price, 850);
    assert.equal(row.priceChangeFromInitial, -350);
    assert.equal(row.targetReached, true);
    assert.equal(row.fake_discount_status, "fake_discount");
  } finally {
    removeWatchlistItem(testId);
  }
});

test("Second-hand detection (Dolap, Gardrops, sahibinden) classifies conditions, isolates retail median, and provides quick links", async () => {
  assert.equal(isSecondHandOffer("https://dolap.com/urun/stradivarius-siyah-gomlek-12345678", "Stradivarius Gömlek"), true);
  assert.equal(isSecondHandOffer("https://www.gardrops.com/kadin/stradivarius-gomlek-98765432", "Stradivarius Gömlek"), true);
  assert.equal(isSecondHandOffer("https://www.sahibinden.com/ilan/ikinci-el-ve-sifir-alisveris-123456789/detay", "iPhone 15"), true);
  assert.equal(isSecondHandOffer("https://www.trendyol.com/stradivarius/siyah-gomlek-p-12345", "Stradivarius Gömlek"), false);

  assert.equal(detectSecondHandCondition("Stradivarius Siyah Gömlek Yeni Etiketli", ""), "Yeni & Etiketli");
  assert.equal(detectSecondHandCondition("Zara Ceket", "Sadece 1 kez giyildi, tertemiz"), "Az Kullanılmış");
  assert.equal(detectSecondHandCondition("iPhone 14 Yenilenmiş 128 GB", ""), "Yenilenmiş");
  assert.equal(detectSecondHandCondition("Stradivarius Gömlek M Beden", ""), "2. El");

  // Direct listing vs product page URL classification for Dolap, Gardrops & sahibinden
  assert.equal(classifyStoreUrl("https://dolap.com/urun/stradivarius-gomlek-123456").isProductPage, true);
  assert.equal(classifyStoreUrl("https://dolap.com/ara?q=stradivarius+gomlek").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.gardrops.com/kadin/stradivarius-gomlek-98765432").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.gardrops.com/ara?q=stradivarius").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.sahibinden.com/ilan/ikinci-el-telefon-1122334455/detay").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.sahibinden.com/kelime-ile-arama?query_text=iphone").isListingPage, true);

  // Retail isolation: Dolap 450 TL offer must NOT distort brand-new Trendyol/Stradivarius retail median (~1500 TL)!
  const mixedOrganic = [
    {
      title: "Stradivarius Siyah Poplin Gömlek Yeni Etiketli - Dolap",
      link: "https://dolap.com/urun/stradivarius-siyah-poplin-gomlek-99887766",
      snippet: "Yeni ve etiketli Stradivarius siyah gömlek. 450,00 TL.",
    },
    {
      title: "Stradivarius Siyah Poplin Gömlek - Trendyol",
      link: "https://www.trendyol.com/stradivarius/siyah-poplin-gomlek-p-11122233",
      snippet: "Stradivarius Siyah Poplin Gömlek. 1.490,00 TL. Ücretsiz Kargo.",
    },
    {
      title: "Stradivarius Siyah Poplin Gömlek - Hepsiburada",
      link: "https://www.hepsiburada.com/stradivarius-siyah-poplin-gomlek-p-HBCV0000999",
      snippet: "Stradivarius Siyah Poplin Gömlek. 1.590,00 TL. Ücretsiz Kargo.",
    },
  ];
  const resp = buildTurkeySearchResponse("stradivarius siyah poplin gömlek", mixedOrganic, [], "Google Türkiye", "serper");
  const dolapCard = resp.products.find((p) => p.externalUrl?.includes("dolap.com"));
  const allCard = resp.products.find((p) => p.badge === "Tüm Mağazalar");
  assert.ok(dolapCard);
  assert.equal(dolapCard.isSecondHand, true);
  assert.equal(dolapCard.secondHandCondition, "Yeni & Etiketli");
  // Aggregate retail card MUST start at 1.490 TL (retail), NOT 450 TL (Dolap 2. El)!
  assert.ok(allCard);
  assert.equal(allCard.lowestPrice, 1490);

  // QuickLinks & zero-key searchSecondHandTurkey behavior
  const links = buildSecondHandQuickLinks("stradivarius gömlek");
  assert.equal(links.length, 3);
  assert.ok(links.some((l) => l.platform === "Dolap" && l.url.includes("dolap.com")));
  assert.ok(links.some((l) => l.platform === "Gardrops" && l.url.includes("gardrops.com")));
  assert.ok(links.some((l) => l.platform === "sahibinden" && l.url.includes("sahibinden.com")));

  const zeroKeyRes = await searchSecondHandTurkey("stradivarius gömlek", { serperKey: "", serpApiKey: "" });
  assert.equal(zeroKeyRes.quickLinks.length, 3);
  assert.equal(zeroKeyRes.liveIndexed, false);
});

test("v9 Feature 1: Web Push config, endpoint validation, DB persistence, and watchlist price-drop alert detection", () => {
  const cfg = getPushConfig();
  assert.equal(cfg.supported, true);
  assert.ok(typeof cfg.publicKey === "string" && cfg.publicKey.length > 40);

  // Endpoint security validation
  assert.equal(isValidPushEndpoint("https://web.push.apple.com/QAbc123xyz"), true);
  assert.equal(isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(isValidPushEndpoint("http://web.push.apple.com/insecure"), false);
  assert.equal(isValidPushEndpoint("https://localhost:3456/push"), false);
  assert.equal(isValidPushEndpoint("https://127.0.0.1/push"), false);

  // DB round-trip with cleanup
  const testEndpoint = `https://web.push.apple.com/__test_v9_${Date.now()}`;
  try {
    savePushSubscription({ endpoint: testEndpoint, keys: { p256dh: "p256_test_key", auth: "auth_test_key" } }, "iPhone");
    const subs = getPushSubscriptions();
    assert.ok(subs.some((s) => s.endpoint === testEndpoint));
  } finally {
    removePushSubscription(testEndpoint);
    assert.ok(!getPushSubscriptions().some((s) => s.endpoint === testEndpoint));
  }

  // Watchlist alert detection: target hit, sharp drop (>=10%), and no duplicate when unchanged
  const before = [
    { id: "w1", title: "iPhone 17 256 GB", url: "https://ex.com/1", target_price: 70000, last_net_price: 74000, targetReached: false },
    { id: "w2", title: "Philips Airfryer XXL", url: "https://ex.com/2", target_price: null, last_net_price: 7000, targetReached: false },
    { id: "w3", title: "Dyson V15", url: "https://ex.com/3", target_price: 25000, last_net_price: 24000, targetReached: true },
  ];
  const after = [
    { id: "w1", title: "iPhone 17 256 GB", url: "https://ex.com/1", target_price: 70000, last_net_price: 69500, best_store: "Amazon Türkiye", targetReached: true },
    { id: "w2", title: "Philips Airfryer XXL", url: "https://ex.com/2", target_price: null, last_net_price: 6200, best_store: "Hepsiburada", targetReached: false },
    { id: "w3", title: "Dyson V15", url: "https://ex.com/3", target_price: 25000, last_net_price: 24000, best_store: "Dyson", targetReached: true },
  ];
  const alerts = detectWatchlistPushAlerts(before, after);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].type, "target_hit");
  assert.equal(alerts[0].itemId, "w1");
  assert.equal(alerts[1].type, "price_drop");
  assert.equal(alerts[1].itemId, "w2");
  assert.ok(alerts[1].dropPct >= 10);
});

test("v9 Feature 6: Authenticity, Official TR Warranty vs Importer Warranty, Refurbished/Demo & Seller Trust Shield", () => {
  // 1. Importer warranty vs Official TR Distributor
  const importer = analyzeOfferAuthenticity(
    {
      offerTitle: "Apple iPhone 16 Pro 256 GB İthalatçı Garantili",
      store: parseStoreInfo("n11", "/ucuzgsm"),
      url: "https://www.n11.com/urun/iphone-16",
    },
    "iPhone 16 Pro 256 GB"
  );
  assert.equal(importer.warranty, "importer");
  assert.equal(importer.isAuthorized, false);
  assert.equal(importer.trustTier, "caution");

  const official = analyzeOfferAuthenticity(
    {
      offerTitle: "Apple iPhone 16 Pro 256 GB Apple Türkiye Garantili",
      store: parseStoreInfo("MediaMarkt", ""),
      url: "https://www.mediamarkt.com.tr/tr/product/iphone-16",
    },
    "iPhone 16 Pro 256 GB"
  );
  assert.equal(official.warranty, "distributor");
  assert.equal(official.isAuthorized, true);
  assert.equal(official.trustTier, "verified");

  // 2. Refurbished & Demo detection
  const refurb = analyzeOfferAuthenticity(
    {
      offerTitle: "Apple iPhone 15 128 GB Yenilenmiş A Kalite",
      store: parseStoreInfo("EasyCep", ""),
      url: "https://easycep.com/iphone-15",
    },
    "iPhone 15 128 GB"
  );
  assert.equal(refurb.condition, "refurbished");
  assert.equal(refurb.isAuthorized, false);
  assert.equal(refurb.trustTier, "caution");

  const demo = analyzeOfferAuthenticity(
    {
      offerTitle: "Philips Airfryer XXL Teşhir Ürünü Açık Kutu",
      store: parseStoreInfo("Trendyol", "/outletmagaza"),
      url: "https://trendyol.com/p/1",
    },
    "Philips Airfryer XXL"
  );
  assert.equal(demo.condition, "demo");
  assert.equal(demo.trustTier, "caution");

  // 3. Perfume / Luxury high-counterfeit category: Sephora verified vs random 3rd-party caution
  const sephora = analyzeOfferAuthenticity(
    {
      offerTitle: "Dior Sauvage EDP 100 ml Erkek Parfüm",
      store: parseStoreInfo("Sephora", ""),
      url: "https://www.sephora.com.tr/p/dior-sauvage",
    },
    "Dior Sauvage EDP 100 ml"
  );
  assert.equal(sephora.isHighRiskCategory, true);
  assert.equal(sephora.isAuthorized, true);
  assert.equal(sephora.trustTier, "verified");

  const thirdParty = analyzeOfferAuthenticity(
    {
      offerTitle: "Dior Sauvage EDP 100 ml Erkek Parfüm",
      store: parseStoreInfo("n11", "/ucuzparfum34"),
      url: "https://www.n11.com/urun/dior-sauvage",
    },
    "Dior Sauvage EDP 100 ml"
  );
  assert.equal(thirdParty.isHighRiskCategory, true);
  assert.equal(thirdParty.isAuthorized, false);
  assert.equal(thirdParty.trustTier, "caution");

  // 4. Full analyzeOffers integration: Trust Shield picks official over refurbished/importer for Best Value
  const analyzed = analyzeOffers(
    [
      {
        id: "r1",
        offerTitle: "Apple iPhone 16 Pro 256 GB Yenilenmiş",
        basePrice: 62000,
        shipping: parseShipping("Ücretsiz kargo"),
        store: parseStoreInfo("EasyCep", ""),
        inStock: true,
        delivery: parseDeliverySpeed("2 gün"),
        url: "https://easycep.com/1",
      },
      {
        id: "i1",
        offerTitle: "Apple iPhone 16 Pro 256 GB İthalatçı Garantili",
        basePrice: 74000,
        shipping: parseShipping("Ücretsiz kargo"),
        store: parseStoreInfo("n11", "/ucuzgsm"),
        inStock: true,
        delivery: parseDeliverySpeed("2 gün"),
        url: "https://n11.com/2",
      },
      {
        id: "o1",
        offerTitle: "Apple iPhone 16 Pro 256 GB Apple Türkiye Garantili",
        basePrice: 75999,
        shipping: parseShipping("Ücretsiz kargo"),
        store: parseStoreInfo("MediaMarkt", ""),
        inStock: true,
        delivery: parseDeliverySpeed("Yarın kargoda"),
        url: "https://mediamarkt.com.tr/3",
      },
    ],
    null,
    { productTitle: "Apple iPhone 16 Pro 256 GB" }
  );

  assert.equal(analyzed.trustSummary.refurbishedCount, 1);
  assert.equal(analyzed.trustSummary.importerCount, 1);
  assert.equal(analyzed.trustSummary.authorizedCount, 1);
  assert.equal(analyzed.trustSummary.cheapestAuthorized.netPrice, 75999);
  // Best Value must favor official TR warranty MediaMarkt over importer/refurbished!
  assert.equal(analyzed.picks.bestValue.id, "o1");
  // Cheapest brand-new pick skips refurbished EasyCep!
  assert.equal(analyzed.picks.cheapestNet.id, "i1");
});

test("v9 Feature 7: extractSharedQuery extracts Turkish store links or text from Apple Shortcuts / Share Sheet payloads", () => {
  assert.equal(
    extractSharedQuery({ text: "Apple iPhone 17 Pro 256 GB Siyah https://ty.gl/abc123!" }),
    "https://ty.gl/abc123"
  );
  assert.equal(
    extractSharedQuery({ url: "https://www.hepsiburada.com/dyson-v15-p-HBV123", title: "Dyson V15" }),
    "https://www.hepsiburada.com/dyson-v15-p-HBV123"
  );
  assert.equal(
    extractSharedQuery({ text: "  Gucci   Güneş   Gözlüğü  " }),
    "Gucci Güneş Gözlüğü"
  );
  assert.equal(extractSharedQuery({}), "");
});

test("v11 Zero-Key Turkey Retail Network: strict relevance guard, cross-store SKU merging, and live zero-key search", async () => {
  // 1. Strict relevance guard rejects numeric-only / catalog-default false positives
  assert.equal(matchesZeroKeyQuery("Timberland 15 cm Su Geçirmez Bot", "Timberland", "TB1A", "iphone 15").ok, false);
  assert.equal(matchesZeroKeyQuery("Rowenta 15 in 1 Tıraş Makinesi", "Rowenta", "TN944", "iphone 15").ok, false);
  assert.equal(matchesZeroKeyQuery("Crocs Medium Eva Tote Çanta", "Crocs", "CZFB0002", "adidas erkek ayakkabı").ok, false);

  // Accepts true matches & Turkish synonyms (ayakkabı <-> sneaker / koşu ayakkabısı)
  assert.equal(matchesZeroKeyQuery("adidas Hyperboost Edge Erkek Beyaz Koşu Ayakkabısı", "adidas", "KI4392", "adidas erkek ayakkabı").ok, true);
  assert.equal(matchesZeroKeyQuery("Adidas X Wales Bonner Erkek Deri Sneaker", "Adidas", "", "adidas erkek ayakkabı").ok, true);
  assert.equal(matchesZeroKeyQuery("Apple Airpods 4. Nesil MXP63TU/A", "Apple", "MXP63TU", "airpods").ok, true);

  // 2. Cross-store SKU merging combines identical model across SuperStep + Intersport into 1 card with 2 offers
  const merged = mergeZeroKeyStoreItems(
    [
      {
        id: "ss-1",
        storeName: "SuperStep",
        title: "adidas Hyperboost Edge Erkek Beyaz Koşu Ayakkabısı",
        brand: "adidas",
        code: "KI4392",
        price: 13599,
        listPrice: 13599,
        image: "https://example.com/a.jpg",
        productUrl: "https://www.superstep.com.tr/urun/adidas-hyperboost/ki4392/",
        inStock: true,
        freeShipThreshold: 2500,
        category: "Ayakkabı & Spor",
        relevanceScore: 130,
      },
      {
        id: "is-1",
        storeName: "Intersport",
        title: "adidas Hyperboost Edge Erkek Beyaz Koşu Ayakkabısı",
        brand: "adidas",
        code: "KI4392",
        price: 9519,
        listPrice: 13599,
        image: "https://example.com/a.jpg",
        productUrl: "https://www.intersport.com.tr/urun/adidas-hyperboost/ki4392/",
        inStock: true,
        freeShipThreshold: 2500,
        category: "Spor & Ayakkabı",
        relevanceScore: 130,
      },
    ],
    "adidas erkek ayakkabı"
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].offerCount, 2);
  assert.equal(merged[0].lowestPrice, 9519);
  assert.ok(merged[0].url.startsWith("virtual:trnet:"));
  const det = getVirtualDetail(merged[0].url);
  assert.ok(det);
  assert.equal(det.offers.length, 2);
  assert.equal(det.picks.cheapestNet.store, "Intersport");
  assert.equal(det.stats.minNet, 9519);
  assert.equal(det.stats.maxNet, 13599);

  // 3. Live zero-key cloud-proof search for "adidas erkek ayakkabı" returns real Turkish store products!
  const live = await searchOfficialFallback("adidas erkek ayakkabı");
  assert.ok(live.totalFound >= 5, `Expected >= 5 live zero-key results for adidas erkek ayakkabı, got ${live.totalFound}`);
  assert.ok(live.products[0].lowestPrice > 0);
  assert.ok(live.products[0].externalUrl?.startsWith("https://"));
  const liveDetail = await getProductDetail(live.products[0].url);
  assert.ok(liveDetail.offers.length >= 1);
  assert.ok(liveDetail.trustSummary);
});

test("v12 Direct Product Link Enforcement: rejects Adidas/Nike/FLO/SuperStep/generic category pages as listing pages", () => {
  // Category / Modelleri pages MUST be classified as isListingPage: true
  assert.equal(classifyStoreUrl("https://www.adidas.com.tr/tr/erkek-ayakkabi", "Adidas Erkek Ayakkabı Modelleri").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.nike.com/tr/w/erkek-ayakkabi", "Nike Erkek Ayakkabı").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.flo.com.tr/marka/adidas/erkek-ayakkabi", "Adidas Erkek Ayakkabı").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.superstep.com.tr/adidas-erkek-ayakkabi/", "Adidas Erkek Ayakkabı").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.fashfed.com/list/?search_text=adidas", "Adidas Modelleri").isListingPage, true);
  assert.equal(classifyStoreUrl("https://www.some-tr-shop.com.tr/erkek/adidas-ayakkabi", "Adidas Erkek Ayakkabı Modelleri").isListingPage, true);

  // Direct single-product pages MUST be classified as isProductPage: true, isListingPage: false
  assert.equal(classifyStoreUrl("https://www.adidas.com.tr/tr/runfalcon-5-running-shoes/IE8808.html", "Adidas Runfalcon 5").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.nike.com/tr/t/air-force-1-07-ayakkabisi-GjGXSP/CW2288-111", "Nike Air Force 1").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.superstep.com.tr/urun/adidas-superstar-ii/ki5010/", "adidas Superstar II").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.sporjinal.com/adidas-vl-court-base-erkek-beyaz-spor-ayakkabi-id3711/", "adidas VL Court").isProductPage, true);
  assert.equal(classifyStoreUrl("https://www.dr.com.tr/elektronik/apple-airpods-4/urunno=0002136379001", "Apple AirPods 4").isProductPage, true);
});

test("v13 Live Checkout Price Accuracy: blocks stale Cimri/Epey aggregator snippets, rejects dated prices, and merges live store prices", async () => {
  // 1. Price comparison aggregators MUST be recognized & excluded from merchant offers
  assert.equal(isPriceAggregatorUrl("https://www.cimri.com/spor-ayakkabi/en-ucuz-adidas-samba-og-b75807,a12345"), true);
  assert.equal(isPriceAggregatorUrl("https://www.akakce.com/spor-ayakkabi/en-ucuz-adidas-samba-fiyati,12345.html"), true);
  assert.equal(isPriceAggregatorUrl("https://www.epey.com/akilli-telefonlar/apple-iphone-15.html"), true);
  assert.equal(isPriceAggregatorUrl("https://www.superstep.com.tr/urun/adidas-superstar-ii/ki5010/"), false);

  // 2. Exact Cimri stale snippet from user screenshot MUST be rejected
  const cimriItem = {
    title: "Adidas Samba OG B75807 Siyah Erkek Spor Ayakkabı",
    link: "https://www.cimri.com/spor-ayakkabi/en-ucuz-adidas-samba-og-b75807,a12345",
    snippet: "12 satıcı arasındaki en ucuz Adidas Samba OG Günlük Spor Ayakkabı fiyatı, 20.11.2026 tarihinde 1.399,00 TL. Şu anki fiyat, son 3 ayın en yüksek fiyatıdır.",
  };
  assert.equal(extractOrganicPriceInfo(cimriItem).price, null);

  // Even on a regular store domain, a historical dated price sentence MUST NOT be extracted as live price
  const datedSnippet = {
    title: "Adidas Samba OG B75807",
    link: "https://www.trendyol.com/adidas/samba-og-b75807-p-999999",
    snippet: "Adidas Samba OG fiyatı 20.11.2026 tarihinde 1.399,00 TL idi.",
  };
  assert.equal(extractOrganicPriceInfo(datedSnippet).price, null);

  // Live-verified price overrides stale Google snippet price
  const liveOverridden = {
    title: "Adidas Superstar II",
    link: "https://www.superstep.com.tr/urun/adidas-superstar-ii/ki5010/",
    snippet: "Eski fiyat 1.399,00 TL",
    _liveVerifiedPrice: 4424,
  };
  const verifiedInfo = extractOrganicPriceInfo(liveOverridden);
  assert.equal(verifiedInfo.price, 4424);
  assert.equal(verifiedInfo.source, "live_verified");

  // buildTurkeySearchResponse MUST completely exclude Cimri aggregator links
  const built = buildTurkeySearchResponse(
    "adidas samba",
    [
      cimriItem,
      {
        title: "Adidas Samba OG B75807 Siyah - Trendyol",
        link: "https://www.trendyol.com/adidas/samba-og-b75807-p-777777",
        price: 3083.46,
        snippet: "Adidas Samba OG B75807 3.083,46 TL Ücretsiz Kargo",
      },
    ],
    [],
    "Google Türkiye (Serper)",
    "serper"
  );
  assert.equal(built.products.some((p) => p.externalUrl?.includes("cimri.com")), false);
  assert.equal(built.products.some((p) => p.externalUrl?.includes("trendyol.com") && p.lowestPrice === 3083.46), true);

  // 3. mergeLiveAndSerperResults prefers live checkout price & drops extreme stale unverified low outliers
  const merged = mergeLiveAndSerperResults(
    {
      provider: "Google Türkiye (Serper)",
      products: [
        {
          id: "s1",
          title: "Adidas Samba OG",
          externalUrl: "https://www.superstep.com.tr/urun/adidas-samba/b75807/",
          lowestPrice: 1399,
          priceVerified: false,
          isAccessory: false,
        },
        {
          id: "s2",
          title: "Adidas Samba OG Stale Snippet",
          externalUrl: "https://www.trendyol.com/adidas/samba-og-p-123456",
          lowestPrice: 1399,
          priceVerified: false,
          isAccessory: false,
        },
        {
          id: "s3",
          title: "Adidas Samba OG Realistic",
          externalUrl: "https://www.trendyol.com/adidas/samba-og-p-654321",
          lowestPrice: 3899,
          priceVerified: false,
          isAccessory: false,
        },
      ],
    },
    {
      provider: "SuperStep, FashFed",
      products: [
        { id: "l1", title: "Adidas Samba OG", externalUrl: "https://www.superstep.com.tr/urun/adidas-samba/b75807/", lowestPrice: 4424, priceVerified: true, isAccessory: false },
        { id: "l2", title: "Adidas Gazelle", externalUrl: "https://www.fashfed.com/urun/adidas-gazelle/bb5476/", lowestPrice: 4299, priceVerified: true, isAccessory: false },
        { id: "l3", title: "Adidas Spezial", externalUrl: "https://www.intersport.com.tr/urun/adidas-spezial/bd7633/", lowestPrice: 4599, priceVerified: true, isAccessory: false },
      ],
    }
  );
  // Duplicate SuperStep URL must use live 4424 TL, NOT stale 1399 TL
  const ssEntries = merged.products.filter((p) => p.externalUrl?.includes("superstep.com.tr"));
  assert.equal(ssEntries.length, 1);
  assert.equal(ssEntries[0].lowestPrice, 4424);
  // Extreme stale 1399 TL unverified snippet (<45% of 4424 TL live median) must be filtered out, while realistic 3899 TL stays
  assert.equal(merged.products.some((p) => p.id === "s2"), false);
  assert.equal(merged.products.some((p) => p.id === "s3"), true);

  // 4. Concise delivery labels (no giant raw meta descriptions)
  assert.equal(
    parseDeliverySpeed("12 satıcı arasındaki en ucuz Adidas Samba OG fiyatı bugün güncellendi ve son 3 ayın en yüksek fiyatıdır.").label,
    "Aynı gün kargo"
  );

  // 5. Live checkout price verification against a real Turkish store product page
  const liveCheck = await fetchLiveProductPrice("https://www.superstep.com.tr/urun/adidas-superstar-ii-erkek-kahverengi-spor-ayakkabi/ki5010/");
  if (liveCheck) {
    assert.ok(liveCheck.price === null || liveCheck.price > 500);
  }
});

test("v17 Feature #2: extractAkinonAvailableSizes extracts real in-stock EU shoe/clothing sizes, skips out-of-stock & US sizes", async () => {
  const akinonProduct = {
    attributes: {
      filterable_size: "42",
      integration_beden: "8,5", // US size should be ignored when EU filterable_size exists
    },
    extra_data: {
      variants: [
        {
          options: [
            { is_selectable: true, in_stock: true, product: { attributes: { filterable_size: "43" } } },
            { is_selectable: true, in_stock: true, product: { attributes: { filterable_size: "42.5" } } },
            { is_selectable: true, in_stock: true, product: { attributes: { filterable_size: "41" } } },
            { is_selectable: false, in_stock: false, product: { attributes: { filterable_size: "46" } } },
          ],
        },
      ],
    },
  };
  const sizes = extractAkinonAvailableSizes(akinonProduct);
  assert.deepEqual(sizes, ["41", "42", "42,5", "43"]);

  // Clothing size sorting
  assert.deepEqual(sortAvailableSizes(["XL", "S", "M", "XS", "L", "2XL"]), ["XS", "S", "M", "L", "XL", "2XL"]);

  // Live zero-key search for shoes exposes real availableSizes on Akinon products
  const live = await searchOfficialFallback("adidas erkek ayakkabı");
  assert.ok(
    live.products.some((p) => Array.isArray(p.availableSizes) && p.availableSizes.length >= 2),
    "Expected live Akinon shoe results to include real availableSizes"
  );
});

test("v17 Feature #3: classifyCardPricePosition & annotateSearchPricePositions classify below/normal/above market prices safely", () => {
  assert.equal(classifyCardPricePosition(3200, 4000)?.tier, "below");
  assert.equal(classifyCardPricePosition(4000, 4000)?.tier, "normal");
  assert.equal(classifyCardPricePosition(5200, 4000)?.tier, "above");
  // Extreme <45% outlier is NOT falsely tagged as 'Piyasa Altı'
  assert.equal(classifyCardPricePosition(1200, 4000), null);

  // Too few comparable items (<4) should NOT annotate
  const tooFew = annotateSearchPricePositions([
    { id: "1", lowestPrice: 3000 },
    { id: "2", lowestPrice: 4000 },
    { id: "3", lowestPrice: 5000 },
  ]);
  assert.equal(tooFew.every((p) => !p.pricePosition), true);

  // >=4 comparable non-accessory items annotate accurately while skipping accessories & second-hand
  const annotated = annotateSearchPricePositions([
    { id: "a", lowestPrice: 3100, isAccessory: false },
    { id: "b", lowestPrice: 4000, isAccessory: false },
    { id: "c", lowestPrice: 4100, isAccessory: false },
    { id: "d", lowestPrice: 4200, isAccessory: false },
    { id: "e", lowestPrice: 5500, isAccessory: false },
    { id: "acc", lowestPrice: 120, isAccessory: true },
    { id: "sh", lowestPrice: 1500, isSecondHand: true },
  ]);
  const byId = new Map(annotated.map((p) => [p.id, p]));
  assert.equal(byId.get("a").pricePosition?.tier, "below");
  assert.equal(byId.get("b").pricePosition?.tier, "normal");
  assert.equal(byId.get("e").pricePosition?.tier, "above");
  assert.equal(byId.get("acc").pricePosition, undefined);
  assert.equal(byId.get("sh").pricePosition, undefined);
});






