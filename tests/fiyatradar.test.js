import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUnitInfo,
  extractVariantAttributes,
  isAccessoryTitle,
  parseDeliverySpeed,
  parseShipping,
  parseStoreInfo,
  parseTrDate,
  parseTrPrice,
  transliterateTr,
} from "../src/parsers.js";
import { analyzeOffers, analyzePriceHistory } from "../src/analyzer.js";
import { getProductDetail, searchProducts } from "../src/scraper.js";
import {
  extractOrganicPriceInfo,
  getVirtualDetail,
  resolveBarcode,
  resolveStoreFromUrl,
  searchOfficialFallback,
} from "../src/providers.js";
import { extractQueryFromStoreUrl, isExternalStoreUrl } from "../src/urlResolver.js";
import { optimizeCart } from "../src/optimizer.js";
import { isPrivateOrReservedIp } from "../src/server.js";
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
