import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUnitInfo,
  parseDeliverySpeed,
  parseShipping,
  parseStoreInfo,
  parseTrDate,
  parseTrPrice,
} from "../src/parsers.js";
import { analyzeOffers, analyzePriceHistory } from "../src/analyzer.js";
import { getProductDetail, searchProducts } from "../src/scraper.js";

test("parseTrPrice handles Turkish formatted currency strings accurately", () => {
  assert.equal(parseTrPrice("54.999,00 TL"), 54999);
  assert.equal(parseTrPrice("55.377,24 TL"), 55377.24);
  assert.equal(parseTrPrice("+44,99 TL kargo"), 44.99);
  assert.equal(parseTrPrice("717,80 TL"), 717.8);
  assert.equal(parseTrPrice("6.900 TL"), 6900);
  assert.equal(parseTrPrice(""), null);
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

test("analyzeOffers detects shipping traps, outliers, and ranks by net price", () => {
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
