/**
 * FiyatRadar — Frontend SPA Controller
 * Handles live search, autocomplete, deep multi-store offer analysis,
 * shipping-trap alerts, interactive 6-month price chart, side-by-side comparison,
 * SQLite-backed watchlist & target price alerts, and CSV/JSON export.
 */

import { renderPriceChart } from "./chart.js";
import { startScanner, stopScanner } from "./scanner.js";
import {
  extractProductFromImageFile,
  isVoiceSearchSupported,
  startVoiceSearch,
  stopVoiceSearch,
} from "./mediaSearch.js";
import { generatePriceCard, sharePriceCardBlob } from "./shareCard.js";
import {
  getCurrentPushSubscription,
  getPushEnvironment,
  sendTestPush,
  subscribeToPush,
  syncExistingPushSubscription,
  unsubscribeFromPush,
} from "./pushClient.js";

const DEFAULT_WATCHLIST_FOLDERS = [
  "Teknoloji",
  "Giyim & Ayakkabı",
  "Parfüm & Kozmetik",
  "Ev & Mutfak",
  "Market",
  "Diğer",
];

const state = {
  activeView: "search", // 'search' | 'detail' | 'compare' | 'cart' | 'watchlist' | 'history'
  lastQuery: "",
  searchData: null,
  searchMode: "retail", // 'retail' | 'secondhand'
  secondHandData: null,
  secondHandLoading: false,
  secondHandError: "",
  searchFilters: {
    hideAccessories: true,
    hideListings: true,
    pricedOnly: false,
    officialOnly: false,
    freeShippingOnly: false,
    store: "",
    variantAttr: null, // { group: 'capacity'|'color'|'size'|'volume', value: string }
  },
  isListening: false,
  pushSubscribed: false,
  pushBusy: false,
  shareCard: {
    blob: null,
    dataUrl: "",
    filename: "",
    theme: "light",
  },
  currentDetail: null,
  chartRange: "all",
  installment: {
    months: 3,
    monthlyRate: 0,
  },
  offerSort: "net_asc",
  offerFilters: {
    freeShippingOnly: false,
    inStockOnly: false,
    hideOutliers: false,
    hideSuspicious: false,
    authorizedOnly: false,
    hideImporterAndRefurb: false,
    storeSearch: "",
  },
  compareBasket: loadLocalCompare(), // [{ id, title, url, image, lowestPrice }]
  compareResult: null,
  cart: loadLocalCart(), // [{ id, title, url, image, lowestPrice, quantity }]
  cartPlan: null,
  watchlist: [],
  watchlistFolder: "", // '' = Tümü
  customFolders: loadLocalCustomFolders(),
  history: [],
  suggestIndex: -1,
  suggestions: [],
};

// DOM Elements
const $ = (id) => document.getElementById(id);

const els = {
  openShortcutsBtn: $("openShortcutsBtn"),
  shortcutsModal: $("shortcutsModal"),
  closeShortcutsBtn: $("closeShortcutsBtn"),
  shortcutShareBaseUrl: $("shortcutShareBaseUrl"),
  copyShortcutShareUrlBtn: $("copyShortcutShareUrlBtn"),
  shortcutApiBaseUrl: $("shortcutApiBaseUrl"),
  copyShortcutApiUrlBtn: $("copyShortcutApiUrlBtn"),
  shortcutQuickGrid: $("shortcutQuickGrid"),
  themeToggleBtn: $("themeToggleBtn"),
  themeIconMoon: $("themeIconMoon"),
  themeIconSun: $("themeIconSun"),
  themeColorMeta: $("themeColorMeta"),
  searchHero: $("searchHero"),
  searchForm: $("searchForm"),
  searchInput: $("searchInput"),
  clearSearchBtn: $("clearSearchBtn"),
  voiceSearchBtn: $("voiceSearchBtn"),
  photoSearchBtn: $("photoSearchBtn"),
  photoSearchInput: $("photoSearchInput"),
  openScannerBtn: $("openScannerBtn"),
  suggestList: $("suggestList"),
  statusBanner: $("statusBanner"),
  viewSearch: $("viewSearch"),
  viewDetail: $("viewDetail"),
  viewCompare: $("viewCompare"),
  viewCart: $("viewCart"),
  viewWatchlist: $("viewWatchlist"),
  viewHistory: $("viewHistory"),
  linkResolvedBanner: $("linkResolvedBanner"),
  fallbackNoticeBanner: $("fallbackNoticeBanner"),
  searchModeBar: $("searchModeBar"),
  quickFilterBar: $("quickFilterBar"),
  variantGroupBar: $("variantGroupBar"),
  secondHandPanel: $("secondHandPanel"),
  resultsHeading: $("resultsHeading"),
  resultsSubmeta: $("resultsSubmeta"),
  resultsGrid: $("resultsGrid"),
  searchSortSelect: $("searchSortSelect"),
  filterMinPrice: $("filterMinPrice"),
  filterMaxPrice: $("filterMaxPrice"),
  applyPriceFilterBtn: $("applyPriceFilterBtn"),
  detailContainer: $("detailContainer"),
  detailCartToggleBtn: $("detailCartToggleBtn"),
  detailShareCardBtn: $("detailShareCardBtn"),
  detailShareBtn: $("detailShareBtn"),
  detailCompareToggleBtn: $("detailCompareToggleBtn"),
  detailRefreshBtn: $("detailRefreshBtn"),
  exportCsvBtn: $("exportCsvBtn"),
  exportJsonBtn: $("exportJsonBtn"),
  printReportBtn: $("printReportBtn"),
  backToResultsBtn: $("backToResultsBtn"),
  compareBadge: $("compareBadge"),
  cartBadge: $("cartBadge"),
  watchlistBadge: $("watchlistBadge"),
  mobileCompareBadge: $("mobileCompareBadge"),
  mobileCartBadge: $("mobileCartBadge"),
  mobileWatchlistBadge: $("mobileWatchlistBadge"),
  iosInstallBanner: $("iosInstallBanner"),
  dismissIosBannerBtn: $("dismissIosBannerBtn"),
  openSettingsBtn: $("openSettingsBtn"),
  closeSettingsBtn: $("closeSettingsBtn"),
  settingsModal: $("settingsModal"),
  settingsForm: $("settingsForm"),
  serperKeyInput: $("serperKeyInput"),
  serpApiKeyInput: $("serpApiKeyInput"),
  clearApiKeysBtn: $("clearApiKeysBtn"),
  apiReadyDot: $("apiReadyDot"),
  scannerModal: $("scannerModal"),
  closeScannerBtn: $("closeScannerBtn"),
  scannerVideo: $("scannerVideo"),
  scannerStatus: $("scannerStatus"),
  manualBarcodeForm: $("manualBarcodeForm"),
  manualBarcodeInput: $("manualBarcodeInput"),
  photoSearchModal: $("photoSearchModal"),
  closePhotoModalBtn: $("closePhotoModalBtn"),
  photoPreviewImg: $("photoPreviewImg"),
  photoProgressWrap: $("photoProgressWrap"),
  photoProgressBar: $("photoProgressBar"),
  photoStatusText: $("photoStatusText"),
  photoCandidatesWrap: $("photoCandidatesWrap"),
  photoCandidatesList: $("photoCandidatesList"),
  photoSearchConfirmForm: $("photoSearchConfirmForm"),
  photoQueryInput: $("photoQueryInput"),
  pickAnotherPhotoBtn: $("pickAnotherPhotoBtn"),
  photoConfirmSearchBtn: $("photoConfirmSearchBtn"),
  shareCardModal: $("shareCardModal"),
  closeShareCardBtn: $("closeShareCardBtn"),
  shareCardThemePills: $("shareCardThemePills"),
  shareCardLoading: $("shareCardLoading"),
  shareCardImg: $("shareCardImg"),
  downloadShareCardBtn: $("downloadShareCardBtn"),
  nativeShareCardBtn: $("nativeShareCardBtn"),
  compareBasketBar: $("compareBasketBar"),
  compareResultContainer: $("compareResultContainer"),
  runCompareBtn: $("runCompareBtn"),
  clearCompareBtn: $("clearCompareBtn"),
  cartItemsContainer: $("cartItemsContainer"),
  cartPlanContainer: $("cartPlanContainer"),
  optimizeCartBtn: $("optimizeCartBtn"),
  clearCartBtn: $("clearCartBtn"),
  newFolderBtn: $("newFolderBtn"),
  pushAlertCard: $("pushAlertCard"),
  watchlistFolderBar: $("watchlistFolderBar"),
  watchlistBudgetSummary: $("watchlistBudgetSummary"),
  watchlistContainer: $("watchlistContainer"),
  refreshWatchlistBtn: $("refreshWatchlistBtn"),
  historyContainer: $("historyContainer"),
  clearHistoryBtn: $("clearHistoryBtn"),
  floatingCompareBar: $("floatingCompareBar"),
  floatingCompareCount: $("floatingCompareCount"),
  floatingClearBtn: $("floatingClearBtn"),
  floatingOpenBtn: $("floatingOpenBtn"),
  toast: $("toast"),
};

// Formatting & Escaping Helpers
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtTL(val) {
  if (typeof val !== "number" || !Number.isFinite(val)) return "-";
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val)} TL`;
}

function fmtPct(val, withSign = true) {
  if (typeof val !== "number" || !Number.isFinite(val)) return "-";
  const sign = withSign && val > 0 ? "+" : "";
  return `${sign}%${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(val)}`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3000);
}

function setStatus(type, message) {
  if (!type) {
    els.statusBanner.hidden = true;
    els.statusBanner.className = "status-banner";
    els.statusBanner.innerHTML = "";
    return;
  }
  els.statusBanner.hidden = false;
  els.statusBanner.className = `status-banner ${type}`;
  els.statusBanner.innerHTML =
    type === "loading"
      ? `<span class="spinner" aria-hidden="true"></span><span>${esc(message)}</span>`
      : `<span>${esc(message)}</span>`;
}

function loadLocalCompare() {
  try {
    const raw = localStorage.getItem("fiyatradar_compare");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

function saveLocalCompare() {
  try {
    localStorage.setItem("fiyatradar_compare", JSON.stringify(state.compareBasket));
  } catch {
    // Ignore storage quota errors
  }
  updateCompareBadges();
}

function loadLocalCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem("fiyatradar_cart") || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function saveLocalCart() {
  try {
    localStorage.setItem("fiyatradar_cart", JSON.stringify(state.cart));
  } catch {
    // Ignore
  }
  updateCartBadges();
}

function loadLocalWatchlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem("fiyatradar_watchlist") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalWatchlist(items) {
  try {
    localStorage.setItem("fiyatradar_watchlist", JSON.stringify(items || []));
  } catch {
    // Ignore
  }
}

function loadLocalCustomFolders() {
  try {
    const parsed = JSON.parse(localStorage.getItem("fiyatradar_custom_folders") || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

function saveLocalCustomFolders() {
  try {
    localStorage.setItem("fiyatradar_custom_folders", JSON.stringify(state.customFolders || []));
  } catch {
    // Ignore
  }
}

function getAllWatchlistFolders() {
  const set = new Set([...DEFAULT_WATCHLIST_FOLDERS, ...(state.customFolders || [])]);
  for (const w of state.watchlist || []) {
    if (w?.folder && w.folder.trim()) set.add(w.folder.trim());
  }
  return [...set];
}

function suggestClientFolder(title) {
  const trMap = { ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c", İ: "i", Ğ: "g", Ü: "u", Ş: "s", Ö: "o", Ç: "c" };
  const norm = String(title || "").replace(/[ğüşıöçİĞÜŞÖÇ]/g, (c) => trMap[c] || c).toLowerCase();
  if (/\b(parfum|parfumeri|edp|edt|deodorant|krem|serum|ruj|maskara|sampuan|sephora|watsons|gratis)\b/.test(norm)) {
    return "Parfüm & Kozmetik";
  }
  if (/\b(gomlek|tisort|t-shirt|elbise|pantolon|jean|ceket|mont|kaban|kazak|sweat|ayakkabi|sneaker|bot|topuklu|canta|gozluk|stradivarius|bershka|mango|zara|nike|adidas|gucci)\b/.test(norm)) {
    return "Giyim & Ayakkabı";
  }
  if (/\b(iphone|samsung|galaxy|xiaomi|macbook|laptop|tablet|ipad|airpods|kulaklik|watch|tv|televizyon|monitor|ssd|ps5|playstation|apple)\b/.test(norm)) {
    return "Teknoloji";
  }
  if (/\b(airfryer|fritoz|supurge|dyson|kahve\s+makinesi|blender|tencere|firin|buzdolabi|camasir|utu|klima|kettle|karaca|philips|ikea)\b/.test(norm)) {
    return "Ev & Mutfak";
  }
  if (/\b(kahve|cay|zeytinyagi|bebek\s+bezi|prima|deterjan|sut|peynir|cikolata|nutella|makarna|lavazza|migros|bim|a101)\b/.test(norm)) {
    return "Market";
  }
  return "Diğer";
}

function computeClientFakeDiscount(points, latestPrice) {
  if (!Array.isArray(points) || points.length < 2 || !latestPrice) return null;
  const r2 = (n) => Math.round(n * 100) / 100;
  const medianOf = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const recentLen = Math.min(30, Math.max(2, Math.ceil(points.length * 0.45)));
  const startIdx = Math.max(1, points.length - recentLen);
  let peakIdx = startIdx;
  for (let i = startIdx; i < points.length; i++) {
    if (points[i].price > points[peakIdx].price) peakIdx = i;
  }
  const peak = points[peakIdx];
  const preSlice = points.slice(0, peakIdx).map((p) => p.price);
  const normalPrice = r2(preSlice.length ? medianOf(preSlice) : points[0].price);
  const overallMedian = r2(medianOf(points.map((p) => p.price)));
  const spikePct = normalPrice > 0 ? r2(((peak.price - normalPrice) / normalPrice) * 100) : 0;
  const apparentDropPct = peak.price > 0 ? r2(((peak.price - latestPrice) / peak.price) * 100) : 0;
  const realDiffPct = normalPrice > 0 ? r2(((latestPrice - normalPrice) / normalPrice) * 100) : 0;
  const metrics = {
    normalPrice,
    peakPrice: peak.price,
    peakDate: peak.dateLabel || "",
    currentPrice: latestPrice,
    overallMedian,
    spikePct,
    apparentDropPct,
    realDiffPct,
  };

  if (spikePct >= 10 && apparentDropPct >= 5 && realDiffPct >= -2) {
    return {
      status: "fake_discount",
      tone: "bad",
      authenticityScore: Math.max(8, Math.min(35, Math.round(32 - Math.max(0, realDiffPct) * 1.4))),
      label: "⚠ Sahte İndirim Riski",
      headline: `Kayıtlarınıza göre fiyat önce +%${spikePct} yükselip sonra %${apparentDropPct} inmiş; eski normal fiyatın ${realDiffPct > 0.5 ? `+%${realDiffPct} üzerinde` : "neredeyse aynısı"}.`,
      details: [
        `Normal fiyat medyanı ${fmtTL(normalPrice)} iken ${peak.dateLabel} tarihinde ${fmtTL(peak.price)} seviyesine çıkmış.`,
        `Güncel fiyat (${fmtTL(latestPrice)}) kampanya öncesi normal seviyenin altında değil.`,
      ],
      metrics,
      hasHistory: true,
    };
  }
  if (realDiffPct <= -5) {
    return {
      status: "genuine_discount",
      tone: "good",
      authenticityScore: Math.min(98, Math.round(78 + Math.min(20, Math.abs(realDiffPct) * 1.1))),
      label: "✓ Gerçek İndirim Doğrulandı",
      headline: `Kayıtlı normal fiyatınıza (${fmtTL(normalPrice)}) göre gerçek %${Math.abs(realDiffPct)} (${fmtTL(normalPrice - latestPrice)}) indirim var.`,
      details: ["Kişisel fiyat kayıtlarınızda yapay şişirme görülmedi; gerçek düşüş tespit edildi."],
      metrics,
      hasHistory: true,
    };
  }
  if (realDiffPct >= 8) {
    return {
      status: "inflated",
      tone: "bad",
      authenticityScore: Math.max(15, Math.min(42, Math.round(42 - realDiffPct))),
      label: "↑ Fiyat Şişirmesi (Bekleyin)",
      headline: `Fiyat kayıtlı normal seviyenin (${fmtTL(normalPrice)}) +%${realDiffPct} üzerinde.`,
      details: ["Kampanya öncesi zam dalgası olabilir; geri çekilmeyi beklemek avantajlı olabilir."],
      metrics,
      hasHistory: true,
    };
  }
  return {
    status: "stable",
    tone: "neutral",
    authenticityScore: 70,
    label: "• Normal Piyasa Seyri",
    headline: `Kayıtlı normal fiyatına (${fmtTL(normalPrice)}) paralel seyrediyor.`,
    details: ["Sahte indirim veya ani zam/indirim manipülasyonu tespit edilmedi."],
    metrics,
    hasHistory: true,
  };
}

// Local iPhone personal price snapshots (survives cloud restarts!)
function recordLocalSnapshot(key, netPrice) {
  if (!key || typeof netPrice !== "number" || !Number.isFinite(netPrice) || netPrice <= 0) return [];
  try {
    const all = JSON.parse(localStorage.getItem("fiyatradar_snapshots") || "{}");
    const list = Array.isArray(all[key]) ? all[key] : [];
    const nowIso = new Date().toISOString();
    const last = list[list.length - 1];
    // Record if first entry, price changed, or >30 minutes elapsed
    if (!last || Math.abs(last.price - netPrice) > 0.01 || Date.now() - Date.parse(last.isoDate) > 30 * 60 * 1000) {
      list.push({ isoDate: nowIso, price: netPrice });
    }
    all[key] = list.slice(-60);
    localStorage.setItem("fiyatradar_snapshots", JSON.stringify(all));
    return all[key];
  } catch {
    return [];
  }
}

function mergePersonalPriceHistory(detail) {
  if (!detail) return detail;
  const currentNet = detail.stats?.minNet ?? detail.lowPrice;
  const snapKey = detail.url || detail.id;
  const localSnaps = recordLocalSnapshot(snapKey, currentNet);

  // If upstream already has rich >= 3 point history (e.g. Akakce 6 months), keep it
  if (Array.isArray(detail.history) && detail.history.length >= 3 && !detail.isPersonalHistory) {
    return detail;
  }

  // Merge server snapshots + local iPhone snapshots
  const mergedMap = new Map();
  for (const pt of detail.history || []) {
    if (pt?.isoDate && pt?.price > 0) mergedMap.set(pt.isoDate.slice(0, 16), { isoDate: pt.isoDate, price: pt.price });
  }
  for (const ls of localSnaps) {
    if (ls?.isoDate && ls?.price > 0) mergedMap.set(ls.isoDate.slice(0, 16), { isoDate: ls.isoDate, price: ls.price });
  }

  const sorted = [...mergedMap.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  if (sorted.length < 2) {
    return { ...detail, personalHistoryCount: sorted.length };
  }

  const points = sorted.map((s, idx) => {
    const d = new Date(s.isoDate);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const prev = idx > 0 ? sorted[idx - 1].price : s.price;
    const delta = Math.round((s.price - prev) * 100) / 100;
    const pct = prev > 0 ? Math.round((delta / prev) * 1000) / 10 : 0;
    const start = Math.max(0, idx - 6);
    const slice = sorted.slice(start, idx + 1);
    const ma7 = Math.round((slice.reduce((acc, x) => acc + x.price, 0) / slice.length) * 100) / 100;
    return {
      isoDate: s.isoDate,
      dateLabel: `${dd}.${mm}.${yyyy} ${hh}:${mi}`,
      price: s.price,
      delta,
      pctLabel: delta !== 0 ? `%${Math.abs(pct)}` : "",
      ma7,
    };
  });

  const prices = points.map((p) => p.price);
  let minPt = points[0];
  let maxPt = points[0];
  for (const p of points) {
    if (p.price < minPt.price) minPt = p;
    if (p.price > maxPt.price) maxPt = p;
  }
  const avgAll = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
  const firstP = points[0].price;
  const latestP = points[points.length - 1].price;
  const changePct = firstP > 0 ? Math.round(((latestP - firstP) / firstP) * 1000) / 10 : 0;
  const diffFromMinPct = minPt.price > 0 ? Math.round(((latestP - minPt.price) / minPt.price) * 1000) / 10 : 0;
  const variance = prices.reduce((s, v) => s + (v - avgAll) ** 2, 0) / prices.length;
  const volatilityPct = avgAll > 0 ? Math.round((Math.sqrt(variance) / avgAll) * 1000) / 10 : 0;
  const clientFakeDiscount = computeClientFakeDiscount(points, currentNet || latestP);

  return {
    ...detail,
    isPersonalHistory: true,
    personalHistoryCount: points.length,
    history: points,
    fakeDiscount: clientFakeDiscount || detail.fakeDiscount || null,
    historySummary: {
      dataPoints: points.length,
      startDate: points[0].dateLabel,
      endDate: points[points.length - 1].dateLabel,
      minPrice: minPt.price,
      minDate: minPt.dateLabel,
      maxPrice: maxPt.price,
      maxDate: maxPt.dateLabel,
      avg30: avgAll,
      change30dPct: changePct,
      diffFromMinPct,
      volatilityPct,
    },
  };
}

function updateCompareBadges() {
  const count = state.compareBasket.length;
  els.compareBadge.textContent = String(count);
  els.compareBadge.hidden = count === 0;
  if (els.mobileCompareBadge) {
    els.mobileCompareBadge.textContent = String(count);
    els.mobileCompareBadge.hidden = count === 0;
  }

  els.floatingCompareCount.textContent = `${count} ürün`;
  els.floatingCompareBar.hidden =
    count === 0 || state.activeView === "compare";
}

function updateCartBadges() {
  const count = state.cart.reduce((s, it) => s + (it.quantity || 1), 0);
  if (els.cartBadge) {
    els.cartBadge.textContent = String(count);
    els.cartBadge.hidden = count === 0;
  }
  if (els.mobileCartBadge) {
    els.mobileCartBadge.textContent = String(count);
    els.mobileCartBadge.hidden = count === 0;
  }
}

function updateWatchlistBadge() {
  const count = state.watchlist.length;
  els.watchlistBadge.textContent = String(count);
  els.watchlistBadge.hidden = count === 0;
  if (els.mobileWatchlistBadge) {
    els.mobileWatchlistBadge.textContent = String(count);
    els.mobileWatchlistBadge.hidden = count === 0;
  }
}

// Navigation
function switchView(view) {
  state.activeView = view;
  const views = {
    search: els.viewSearch,
    detail: els.viewDetail,
    compare: els.viewCompare,
    cart: els.viewCart,
    watchlist: els.viewWatchlist,
    history: els.viewHistory,
  };

  for (const [k, node] of Object.entries(views)) {
    if (!node) continue;
    if (k === "search") {
      node.hidden = !(view === "search" && Boolean(state.searchData));
    } else {
      node.hidden = k !== view;
    }
  }

  document.querySelectorAll(".nav-tab, .mobile-tab").forEach((btn) => {
    const target = btn.dataset.view;
    const isActive = target === view || (view === "detail" && target === "search");
    btn.classList.toggle("active", isActive);
  });

  // Compact hero when viewing results or sub-views
  const shouldCompact =
    view === "detail" ||
    view === "compare" ||
    view === "cart" ||
    view === "watchlist" ||
    view === "history" ||
    (view === "search" && Boolean(state.searchData));
  els.searchHero.classList.toggle("compact", shouldCompact);

  updateCompareBadges();

  if (view === "compare") renderCompareView();
  if (view === "cart") renderCartView();
  if (view === "watchlist") loadWatchlist();
  if (view === "history") loadHistory();
}

// API Key storage helpers (stored locally on user's iPhone/browser)
function getStoredApiKeys() {
  try {
    return {
      serperKey: (localStorage.getItem("fiyatradar_serper_key") || "").trim(),
      serpApiKey: (localStorage.getItem("fiyatradar_serpapi_key") || "").trim(),
    };
  } catch {
    return { serperKey: "", serpApiKey: "" };
  }
}

function updateApiStatusDot(serverReady = false) {
  const { serperKey, serpApiKey } = getStoredApiKeys();
  if (els.apiReadyDot) {
    els.apiReadyDot.hidden = !(serverReady || serperKey || serpApiKey);
  }
}

// API Fetch Helper
async function apiFetch(url, options = {}) {
  const { serperKey, serpApiKey } = getStoredApiKeys();
  const headers = new Headers(options.headers || {});
  if (serperKey) headers.set("X-Serper-Key", serperKey);
  if (serpApiKey) headers.set("X-SerpApi-Key", serpApiKey);

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Sunucu hatası (HTTP ${res.status})`);
  }
  return data;
}

// ============================================================================
// SEARCH & AUTOCOMPLETE
// ============================================================================
let suggestTimer = null;
async function fetchSuggestions(query) {
  if (!query || query.length < 2 || query.startsWith("http")) {
    hideSuggestions();
    return;
  }
  try {
    const data = await apiFetch(`/api/suggest?q=${encodeURIComponent(query)}`);
    state.suggestions = data.suggestions || [];
    state.suggestIndex = -1;
    renderSuggestions();
  } catch {
    hideSuggestions();
  }
}

function renderSuggestions() {
  if (!state.suggestions.length) {
    hideSuggestions();
    return;
  }
  els.suggestList.hidden = false;
  els.suggestList.innerHTML = state.suggestions
    .map(
      (s, i) => `
      <li class="suggest-item ${i === state.suggestIndex ? "active" : ""}" role="option" data-idx="${i}">
        ${esc(s)}
      </li>`
    )
    .join("");
}

function hideSuggestions() {
  els.suggestList.hidden = true;
  state.suggestions = [];
  state.suggestIndex = -1;
}

async function performSearch(query, opts = {}) {
  const q = (query || "").trim();
  if (!q) return;
  hideSuggestions();

  // If user typed or pasted a raw EAN/UPC barcode directly into the main search box
  if (!opts.fromBarcode && /^\d{8,14}$/.test(q)) {
    lookupBarcode(q);
    return;
  }

  state.lastQuery = q;
  els.searchInput.value = q;
  els.clearSearchBtn.hidden = false;

  const sort = opts.sort || els.searchSortSelect.value || "relevance";
  const minPrice = els.filterMinPrice.value.trim();
  const maxPrice = els.filterMaxPrice.value.trim();

  const params = new URLSearchParams({ q, sort });
  if (minPrice) params.set("minPrice", minPrice);
  if (maxPrice) params.set("maxPrice", maxPrice);
  if (opts.refresh) params.set("refresh", "1");

  const isUrl = /^https?:\/\//i.test(q);
  setStatus(
    "loading",
    isUrl
      ? "Mağaza bağlantısı çözülüyor ve diğer tüm Türkiye mağazaları taranıyor..."
      : `"${q}" için Türkiye e-ticaret piyasası taranıyor...`
  );

  try {
    const data = await apiFetch(`/api/search?${params.toString()}`);
    setStatus(null);

    if (data.directProduct && data.detail) {
      state.currentDetail = mergePersonalPriceHistory(data.detail);
      switchView("detail");
      renderDetailView();
      return;
    }

    state.searchData = data;
    state.searchMode = "retail";
    state.secondHandData = null;
    state.secondHandLoading = false;
    state.secondHandError = "";
    // Reset per-search quick filters cleanly; auto-hide accessories and category/listing pages when direct priced products exist
    const allProds = data.products || [];
    const hasRetail = allProds.some((p) => !p.isSecondHand);
    const retailProds = hasRetail ? allProds.filter((p) => !p.isSecondHand) : allProds;
    const hasAccessories = retailProds.some((p) => p.isAccessory);
    const hasPrimary = retailProds.some((p) => !p.isAccessory);
    const hasListings = retailProds.some((p) => p.isListingPage);
    const directPricedCount = retailProds.filter(
      (p) => !p.isListingPage && p.badge !== "Tüm Mağazalar" && typeof p.lowestPrice === "number" && p.lowestPrice > 0
    ).length;
    state.searchFilters = {
      hideAccessories: hasAccessories && hasPrimary,
      hideListings: hasListings && directPricedCount >= 2,
      pricedOnly: false,
      officialOnly: false,
      freeShippingOnly: false,
      store: "",
      variantAttr: null,
    };

    switchView("search");
    renderSearchResults();
  } catch (err) {
    setStatus("error", err.message);
  }
}

const COLOR_SWATCH_MAP = {
  siyah: "#18181b",
  "siyah titanyum": "#27272a",
  "gece yarısı": "#1e293b",
  beyaz: "#ffffff",
  "beyaz titanyum": "#f4f4f5",
  "kırık beyaz": "#f7f5ef",
  "yıldız ışığı": "#f5f1e6",
  ekru: "#f3ead8",
  krem: "#f5ebd6",
  bej: "#d6c5a9",
  taş: "#cfc8bc",
  vizon: "#a89888",
  taba: "#b56c3b",
  kahverengi: "#6f4528",
  haki: "#5b643b",
  yeşil: "#16a34a",
  "su yeşili": "#5eead4",
  çağla: "#86b08c",
  lacivert: "#1e3a8a",
  indigo: "#3730a3",
  "saks mavisi": "#1d4ed8",
  mavi: "#3b82f6",
  kırmızı: "#dc2626",
  bordo: "#7f1d1d",
  pembe: "#ec4899",
  pudra: "#f5c2cf",
  mor: "#7c3aed",
  lila: "#c084fc",
  sarı: "#eab308",
  hardal: "#ca8a04",
  turuncu: "#f97316",
  altın: "#d4af37",
  gümüş: "#cbd5e1",
  gri: "#9ca3af",
  antrasit: "#4b5563",
  füme: "#52525b",
  "uzay grisi": "#52525b",
  "çöl titanyum": "#c5a98c",
  "doğal titanyum": "#b7b2a8",
  titanyum: "#9ca3af",
};

function renderColorSwatch(colorLabel) {
  if (!colorLabel) return "";
  const hex = COLOR_SWATCH_MAP[String(colorLabel).toLocaleLowerCase("tr-TR").trim()];
  if (!hex) return "";
  const needsDarkBorder = ["#ffffff", "#f4f4f5", "#f7f5ef", "#f5f1e6", "#f3ead8", "#f5ebd6"].includes(hex);
  return `<span class="color-swatch ${needsDarkBorder ? "light-swatch" : ""}" style="background:${hex};" aria-hidden="true"></span>`;
}

function isFaviconUrl(urlStr) {
  return typeof urlStr === "string" && /google\.com\/s2\/favicons/i.test(urlStr);
}

function getRetailBaseProducts() {
  const all = state.searchData?.products || [];
  const hasRetail = all.some((p) => !p.isSecondHand);
  return hasRetail ? all.filter((p) => !p.isSecondHand) : all;
}

function getFilteredSearchProducts() {
  const all = getRetailBaseProducts();
  const f = state.searchFilters;
  return all.filter((p) => {
    if (f.hideAccessories && p.isAccessory) return false;
    if (f.hideListings && p.isListingPage) return false;
    if (f.pricedOnly && !(typeof p.lowestPrice === "number" && p.lowestPrice > 0)) return false;
    if (f.officialOnly && !p.isOfficialStore) return false;
    if (f.freeShippingOnly && !p.isFreeShipping) return false;
    if (f.store) {
      const storeLabel = (p.badge || p.source || "").toLocaleLowerCase("tr-TR");
      if (storeLabel !== f.store.toLocaleLowerCase("tr-TR")) return false;
    }
    if (f.variantAttr) {
      const { group, value } = f.variantAttr;
      if (p.variantAttrs?.[group] !== value) return false;
    }
    return true;
  });
}

function getCombinedSecondHandItems() {
  const map = new Map();
  const normKey = (u) => String(u || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

  for (const p of state.searchData?.products || []) {
    if (!p.isSecondHand) continue;
    const link = p.externalUrl || p.url;
    const key = normKey(link);
    if (!key || map.has(key)) continue;
    map.set(key, {
      id: p.id,
      title: p.title,
      url: link,
      externalUrl: link,
      platform: p.badge || p.source || "2. El",
      badge: p.badge || p.source || "2. El",
      image: p.image || "",
      price: typeof p.lowestPrice === "number" && p.lowestPrice > 0 ? p.lowestPrice : null,
      condition: p.secondHandCondition || "2. El",
      isListingPage: Boolean(p.isListingPage),
      variantAttrs: p.variantAttrs || {},
      snippet: "",
    });
  }

  for (const it of state.secondHandData?.items || []) {
    const link = it.externalUrl || it.url;
    const key = normKey(link);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (it.price && !prev.price) || (it.snippet && !prev.snippet)) {
      map.set(key, it);
    }
  }

  return [...map.values()].sort((a, b) => {
    const aRank = a.isListingPage ? 2 : a.price ? 0 : 1;
    const bRank = b.isListingPage ? 2 : b.price ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    if (a.price && b.price) return a.price - b.price;
    return 0;
  });
}

function buildClientSecondHandQuickLinks(query) {
  const enc = encodeURIComponent(String(query || "").trim());
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

function getConditionBadgeClass(condition) {
  const c = String(condition || "").toLocaleLowerCase("tr-TR");
  if (c.includes("etiketli") || c.includes("yeni")) return "tagged";
  if (c.includes("az") || c.includes("temiz")) return "lightly-used";
  if (c.includes("yenilenmiş")) return "refurbished";
  return "used";
}

function renderSearchModeBar() {
  if (!els.searchModeBar) return;
  const data = state.searchData;
  if (!data?.query) {
    els.searchModeBar.hidden = true;
    els.searchModeBar.innerHTML = "";
    return;
  }

  const retailCount = getRetailBaseProducts().length;
  const shItems = getCombinedSecondHandItems();
  const shCount = shItems.length;
  const shBadge = state.secondHandLoading
    ? "..."
    : shCount > 0
      ? `${shCount}`
      : "Karşılaştır";

  els.searchModeBar.hidden = false;
  els.searchModeBar.innerHTML = `
    <div class="mode-tabs" role="tablist" aria-label="Sıfır ve 2. El Mağaza Sekmeleri">
      <button type="button" role="tab" aria-selected="${state.searchMode === "retail"}" class="mode-tab-btn ${state.searchMode === "retail" ? "active" : ""}" data-search-mode="retail">
        <span>Sıfır Mağazalar</span>
        <span class="mode-tab-count">${retailCount}</span>
      </button>
      <button type="button" role="tab" aria-selected="${state.searchMode === "secondhand"}" class="mode-tab-btn ${state.searchMode === "secondhand" ? "active" : ""}" data-search-mode="secondhand">
        <span>2. El / Etiketli (Dolap · Gardrops)</span>
        <span class="mode-tab-count ${shCount > 0 ? "accent" : ""}">${esc(shBadge)}</span>
      </button>
    </div>
  `;
}

async function loadSecondHandResults(refresh = false) {
  const q = state.searchData?.query;
  if (!q) return;
  if (state.secondHandLoading) return;
  if (!refresh && state.secondHandData && state.secondHandData.query === q) return;

  state.secondHandLoading = true;
  state.secondHandError = "";
  renderSearchResults();

  try {
    const params = new URLSearchParams({ q });
    if (refresh) params.set("refresh", "1");
    const res = await apiFetch(`/api/search/secondhand?${params.toString()}`);
    state.secondHandData = res;
  } catch (err) {
    state.secondHandError = err.message || "2. El / Etiketli ilanları alınamadı.";
  } finally {
    state.secondHandLoading = false;
    if (state.activeView === "search") renderSearchResults();
  }
}

function renderSecondHandView() {
  if (!els.secondHandPanel || !state.searchData) return;
  const q = state.searchData.query;
  const sh = state.secondHandData;
  const items = getCombinedSecondHandItems();
  const quickLinks = sh?.quickLinks?.length ? sh.quickLinks : buildClientSecondHandQuickLinks(q);

  // Compute lowest brand-new retail price for Sıfır vs. 2. El savings comparison
  const retailPriced = getRetailBaseProducts()
    .filter(
      (p) =>
        !p.isSecondHand &&
        !p.isAccessory &&
        !p.isListingPage &&
        p.badge !== "Tüm Mağazalar" &&
        typeof p.lowestPrice === "number" &&
        p.lowestPrice > 0
    )
    .map((p) => p.lowestPrice);
  const retailMin = retailPriced.length ? Math.min(...retailPriced) : null;

  const shPriced = items
    .filter((it) => !it.isListingPage && typeof it.price === "number" && it.price > 0)
    .map((it) => it.price);
  const shMin = shPriced.length ? Math.min(...shPriced) : null;

  let savingsHtml = "";
  if (retailMin && shMin) {
    const diff = Math.round((retailMin - shMin) * 100) / 100;
    const pct = retailMin > 0 ? Math.round((diff / retailMin) * 1000) / 10 : 0;
    const isCheaper = diff > 0;
    savingsHtml = `
      <div class="secondhand-savings-banner ${isCheaper ? "good" : "neutral"}">
        <div class="sh-compare-metric">
          <span class="sh-metric-label">Sıfır Mağaza En Ucuz</span>
          <strong class="sh-metric-val mono">${fmtTL(retailMin)}</strong>
        </div>
        <div class="sh-compare-arrow" aria-hidden="true">→</div>
        <div class="sh-compare-metric">
          <span class="sh-metric-label">2. El / Etiketli En Ucuz</span>
          <strong class="sh-metric-val mono ${isCheaper ? "good" : ""}">${fmtTL(shMin)}</strong>
        </div>
        <div class="sh-compare-verdict">
          ${
            isCheaper
              ? `<span class="sh-save-badge">✓ ${fmtTL(diff)} (${fmtPct(pct, false)}) tasarruf</span>`
              : `<span class="sh-save-badge neutral">Sıfır mağaza fiyatı şu an daha avantajlı</span>`
          }
        </div>
      </div>
    `;
  }

  const cardsHtml = items.length
    ? `
      <div class="results-grid" style="margin-top:14px;">
        ${items
          .map((it) => {
            const imgIsFavicon = isFaviconUrl(it.image);
            const colorLabel = it.variantAttrs?.color || "";
            const sizeLabel = it.variantAttrs?.size || it.variantAttrs?.capacity || "";
            const condClass = getConditionBadgeClass(it.condition);
            return `
              <article class="product-card secondhand-card">
                <a class="product-card-media ${imgIsFavicon ? "is-favicon-wrap" : ""}" href="${esc(it.externalUrl || it.url)}" target="_blank" rel="noopener noreferrer">
                  ${
                    it.image
                      ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" class="${imgIsFavicon ? "is-favicon" : ""}" loading="lazy" />`
                      : `<span class="muted-text">Görsel yok</span>`
                  }
                </a>
                <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;">
                  <span class="offer-pill">${esc(it.platform || it.badge || "2. El")}</span>
                  <span class="condition-badge ${condClass}">${esc(it.condition || "2. El")}</span>
                  ${colorLabel ? `<span class="color-tag">${renderColorSwatch(colorLabel)}${esc(colorLabel)}</span>` : ""}
                  ${sizeLabel ? `<span class="mini-badge fast">${esc(sizeLabel)}</span>` : ""}
                </div>
                <h3 class="product-card-title" title="${esc(it.title)}">${esc(it.title)}</h3>
                ${it.snippet ? `<p class="sh-snippet">${esc(it.snippet)}</p>` : ""}
                <div class="product-card-pricing">
                  <span class="price-main">${it.price ? fmtTL(it.price) : "İlanda Gör"}</span>
                  <span class="offer-pill">${it.isListingPage ? "Arama Sayfası" : "Doğrudan İlan"}</span>
                </div>
                <div class="product-card-footer">
                  <a href="${esc(it.externalUrl || it.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm btn-analyze">
                    ${it.isListingPage ? `${esc(it.platform || "Platform")}'da Gör ↗` : "İlana Git ↗"}
                  </a>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `
    : !state.secondHandLoading && !state.secondHandError
      ? `
      <div class="empty-state" style="margin-top:14px;">
        <h3>${sh?.liveIndexed ? "İndekslenmiş doğrudan ilan bulunamadı" : "2. El Platformlarında Hızlı Arama"}</h3>
        <p>${
          sh?.notice
            ? esc(sh.notice)
            : `"${esc(q)}" için Dolap, Gardrops veya sahibinden üzerinde doğrudan fiyatlı ilan eşleşmedi. Aşağıdaki tek tık bağlantılarla canlı ilanlara anında ulaşabilirsiniz.`
        }</p>
        ${sh && !sh.liveIndexed ? `<button type="button" class="btn btn-primary btn-sm" data-open-settings="1" style="margin-top:10px;">Ücretsiz API ile Canlı Fiyatları Aç</button>` : ""}
      </div>
    `
      : "";

  els.secondHandPanel.innerHTML = `
    <div class="secondhand-header">
      <div>
        <h3>2. El & Yeni Etiketli Piyasası</h3>
        <p class="muted-text" style="margin:2px 0 0;">
          Dolap, Gardrops ve sahibinden ilanları sıfır mağaza medyanını bozmadan ayrı listelenir${sh?.provider ? ` · ${esc(sh.provider)}` : ""}.
        </p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-refresh-secondhand="1" ${state.secondHandLoading ? "disabled" : ""}>
        ${state.secondHandLoading ? "Taranıyor..." : "İlanları Yenile"}
      </button>
    </div>

    ${savingsHtml}

    ${
      state.secondHandLoading
        ? `<div class="status-banner loading" style="margin-top:12px;"><span class="spinner" aria-hidden="true"></span><span>Dolap, Gardrops ve sahibinden ilanları taranıyor...</span></div>`
        : ""
    }
    ${
      state.secondHandError
        ? `<div class="status-banner error" style="margin-top:12px;"><span>${esc(state.secondHandError)}</span></div>`
        : ""
    }

    ${cardsHtml}

    <div class="secondhand-quick-wrap">
      <div class="sh-quick-title">Tek Tıkla 2. El Platformlarında Ara</div>
      <div class="secondhand-quick-links">
        ${quickLinks
          .map(
            (ql) => `
          <a href="${esc(ql.url)}" target="_blank" rel="noopener noreferrer" class="secondhand-quick-card">
            ${ql.logoUrl ? `<img src="${esc(ql.logoUrl)}" alt="${esc(ql.platform)}" class="sh-ql-logo" />` : ""}
            <div class="sh-ql-copy">
              <strong>${esc(ql.platform)}</strong>
              <span>${esc(ql.label)}</span>
            </div>
            <span class="sh-ql-arrow" aria-hidden="true">↗</span>
          </a>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderVariantGroupBar() {
  if (!els.variantGroupBar) return;
  const all = getRetailBaseProducts();
  const f = state.searchFilters;
  const pool = all.filter(
    (p) =>
      (!f.hideAccessories || !p.isAccessory) &&
      (!f.hideListings || !p.isListingPage) &&
      p.badge !== "Tüm Mağazalar"
  );
  if (pool.length < 2) {
    els.variantGroupBar.hidden = true;
    els.variantGroupBar.innerHTML = "";
    return;
  }

  const groupDefs = [
    { key: "capacity", label: "Kapasite" },
    { key: "color", label: "Renk" },
    { key: "size", label: "Beden / No" },
    { key: "volume", label: "Gramaj" },
  ];

  const rowsHtml = [];
  for (const def of groupDefs) {
    const map = new Map(); // value -> { count, minPrice }
    for (const p of pool) {
      const val = p.variantAttrs?.[def.key];
      if (!val) continue;
      const entry = map.get(val) || { count: 0, minPrice: Infinity };
      entry.count += 1;
      if (typeof p.lowestPrice === "number" && p.lowestPrice > 0 && p.lowestPrice < entry.minPrice) {
        entry.minPrice = p.lowestPrice;
      }
      map.set(val, entry);
    }

    // Only show a variant dimension when at least 2 distinct options exist (e.g. 128 GB vs 256 GB, or Siyah vs Beyaz)
    if (map.size < 2) continue;

    const entries = [...map.entries()].sort((a, b) => a[1].minPrice - b[1].minPrice || b[1].count - a[1].count);
    const globalMin = entries.reduce((m, [, info]) => Math.min(m, info.minPrice), Infinity);

    const chips = entries
      .slice(0, 10)
      .map(([val, info]) => {
        const isActive = f.variantAttr?.group === def.key && f.variantAttr?.value === val;
        const isKelepir = Number.isFinite(info.minPrice) && info.minPrice === globalMin && Number.isFinite(globalMin);
        const swatch = def.key === "color" ? renderColorSwatch(val) : "";
        const priceTag = Number.isFinite(info.minPrice)
          ? `<span class="vg-price">${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(info.minPrice)} TL${isKelepir ? " ★" : ""}</span>`
          : `<span class="vg-price">(${info.count})</span>`;
        return `<button type="button" class="variant-group-chip ${isKelepir ? "kelepir" : ""} ${isActive ? "active" : ""}" data-vgroup="${esc(def.key)}" data-vval="${esc(val)}">${swatch}${esc(val)} ${priceTag}</button>`;
      })
      .join("");

    rowsHtml.push(`
      <div class="variant-group-row">
        <span class="variant-group-label">${esc(def.label)}</span>
        ${chips}
      </div>
    `);
  }

  if (!rowsHtml.length) {
    els.variantGroupBar.hidden = true;
    els.variantGroupBar.innerHTML = "";
    return;
  }

  els.variantGroupBar.hidden = false;
  els.variantGroupBar.innerHTML = rowsHtml.join("");
}

function renderQuickFilterBar() {
  if (!els.quickFilterBar) return;
  const all = getRetailBaseProducts();
  if (!all.length) {
    els.quickFilterBar.hidden = true;
    els.quickFilterBar.innerHTML = "";
    return;
  }

  const f = state.searchFilters;
  const accCount = all.filter((p) => p.isAccessory).length;
  const listingCount = all.filter((p) => p.isListingPage).length;
  const freeShipCount = all.filter((p) => p.isFreeShipping).length;
  const pricedCount = all.filter((p) => typeof p.lowestPrice === "number" && p.lowestPrice > 0).length;

  // Dynamic top stores present in current results
  const storeCounts = new Map();
  for (const p of all) {
    const label = p.badge || p.source || "";
    if (!label || label === "Tüm Mağazalar" || label === "Akakçe") continue;
    storeCounts.set(label, (storeCounts.get(label) || 0) + 1);
  }
  const topStores = [...storeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const chips = [];
  const anyActive = f.pricedOnly || f.officialOnly || f.freeShippingOnly || Boolean(f.store) || Boolean(f.variantAttr);
  chips.push(
    `<button type="button" class="filter-chip ${!anyActive && !f.hideAccessories && !f.hideListings ? "active" : ""}" data-qfilter="reset">Tümü (${all.length})</button>`
  );

  if (listingCount > 0) {
    chips.push(
      `<button type="button" class="filter-chip ${f.hideListings ? "good-active" : ""}" data-qfilter="hideListings">${f.hideListings ? "✓ " : ""}Kategori Sayfalarını Gizle (${listingCount})</button>`
    );
  }
  if (accCount > 0) {
    chips.push(
      `<button type="button" class="filter-chip ${f.hideAccessories ? "good-active" : ""}" data-qfilter="hideAccessories">${f.hideAccessories ? "✓ " : ""}Aksesuarları Gizle (${accCount})</button>`
    );
  }
  if (pricedCount > 0 && pricedCount < all.length) {
    chips.push(
      `<button type="button" class="filter-chip ${f.pricedOnly ? "active" : ""}" data-qfilter="pricedOnly">Sadece Fiyatlı (${pricedCount})</button>`
    );
  }
  if (freeShipCount > 0) {
    chips.push(
      `<button type="button" class="filter-chip ${f.freeShippingOnly ? "active" : ""}" data-qfilter="freeShippingOnly">Ücretsiz Kargo (${freeShipCount})</button>`
    );
  }
  if (topStores.length >= 2) {
    chips.push(
      `<button type="button" class="filter-chip ${f.officialOnly ? "active" : ""}" data-qfilter="officialOnly">Resmi / Büyük Mağaza</button>`
    );
    for (const [storeName, count] of topStores) {
      chips.push(
        `<button type="button" class="filter-chip ${f.store === storeName ? "active" : ""}" data-qstore="${esc(storeName)}">${esc(storeName)} (${count})</button>`
      );
    }
  }

  els.quickFilterBar.hidden = false;
  els.quickFilterBar.innerHTML = chips.join("");
}

function renderSearchResults() {
  const data = state.searchData;
  if (!data) return;

  // Show link-resolved banner when user pasted a Trendyol/Hepsiburada/Amazon/Zara/Stradivarius link
  if (els.linkResolvedBanner) {
    if (data.resolvedFromLink?.resolvedQuery) {
      els.linkResolvedBanner.hidden = false;
      els.linkResolvedBanner.innerHTML = `
        <span><strong>✓ ${esc(data.resolvedFromLink.sourceStore)} bağlantısı çözüldü:</strong> "${esc(data.resolvedFromLink.resolvedQuery)}" için diğer tüm Türkiye mağazaları tarandı.</span>
        <a href="${esc(data.resolvedFromLink.expandedUrl || data.resolvedFromLink.originalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Orijinal Link ↗</a>
      `;
    } else {
      els.linkResolvedBanner.hidden = true;
      els.linkResolvedBanner.innerHTML = "";
    }
  }

  if (els.fallbackNoticeBanner) {
    if (data.fallbackNotice) {
      els.fallbackNoticeBanner.hidden = false;
      els.fallbackNoticeBanner.innerHTML = `
        <div class="fallback-notice-text">
          <strong>Yedek Canlı Kaynak Aktif:</strong> ${esc(data.fallbackNotice)}
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="fallbackOpenSettingsBtn">70+ Mağazayı Aç (Ücretsiz API)</button>
      `;
      $("fallbackOpenSettingsBtn")?.addEventListener("click", openSettingsModal);
    } else {
      els.fallbackNoticeBanner.hidden = true;
      els.fallbackNoticeBanner.innerHTML = "";
    }
  }

  renderSearchModeBar();

  if (state.searchMode === "secondhand") {
    if (els.quickFilterBar) els.quickFilterBar.hidden = true;
    if (els.variantGroupBar) els.variantGroupBar.hidden = true;
    if (els.resultsGrid) els.resultsGrid.hidden = true;
    if (els.secondHandPanel) els.secondHandPanel.hidden = false;

    const shCount = getCombinedSecondHandItems().length;
    els.resultsHeading.textContent = `"${data.query}" — 2. El / Etiketli`;
    els.resultsSubmeta.textContent = state.secondHandLoading
      ? "Dolap, Gardrops ve sahibinden taranıyor..."
      : `${shCount} 2. el / etiketli ilan · Sıfır mağazalardan ayrı karşılaştırma`;
    renderSecondHandView();
    return;
  }

  if (els.secondHandPanel) els.secondHandPanel.hidden = true;
  if (els.resultsGrid) els.resultsGrid.hidden = false;

  renderQuickFilterBar();
  renderVariantGroupBar();

  const visibleProducts = getFilteredSearchProducts();
  const retailBaseCount = getRetailBaseProducts().length;
  els.resultsHeading.textContent = `"${data.query}" sonuçları`;
  const providerTag = data.provider ? ` · Kaynak: ${data.provider}` : "";
  els.resultsSubmeta.textContent = `${visibleProducts.length} / ${retailBaseCount} sıfır ürün listelendi${providerTag}${data.cached ? " · Önbellek" : " · Canlı"}`;

  if (!visibleProducts.length) {
    els.resultsGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <h3>Eşleşen ürün bulunamadı</h3>
        <p>${
          data.products.length > 0
            ? "Seçili mağaza, kategori veya aksesuar filtresi sonuçları gizledi. Yukarıdaki 'Tümü' çipine dokunarak tüm sonuçları görebilirsiniz."
            : data.fallbackMode
              ? "Bu ürün Migros Elektronik / T.C. Market Fiyatı kataloğunda bulunamadı. Trendyol, Hepsiburada, Amazon TR, n11, Stradivarius ve MediaMarkt dahil tüm Türkiye mağazalarını taramak için Ayarlar'dan ücretsiz Serper API anahtarı ekleyebilirsiniz."
              : "Fiyat filtresini gevşetmeyi veya daha genel bir model adı denemeyi düşünün."
        }</p>
        ${data.fallbackMode && !data.products.length ? `<button type="button" class="btn btn-primary btn-sm" id="emptyOpenSettingsBtn" style="margin-top:10px;">Ücretsiz 70+ Mağaza API Ayarla</button>` : ""}
      </div>`;
    $("emptyOpenSettingsBtn")?.addEventListener("click", openSettingsModal);
    return;
  }

  els.resultsGrid.innerHTML = visibleProducts
    .map((p) => {
      const inCompare = state.compareBasket.some((c) => c.url === p.url);
      const inCart = state.cart.some((c) => c.url === p.url);
      const isCatalogOnly = !p.lowestPrice && Boolean(p.externalUrl);
      const hasDirectProductLink = Boolean(p.externalUrl && !p.isListingPage && !isCatalogOnly);
      const imgIsFavicon = isFaviconUrl(p.image);
      const colorLabel = p.variantAttrs?.color || "";
      return `
        <article class="product-card" data-url="${esc(p.url)}">
          <div class="product-card-media ${imgIsFavicon ? "is-favicon-wrap" : ""}" data-action="open-detail">
            ${
              p.image
                ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" class="${imgIsFavicon ? "is-favicon" : ""}" loading="lazy" />`
                : `<span class="muted-text">Görsel yok</span>`
            }
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;">
            ${p.badge ? `<span class="offer-pill">${esc(p.badge)}</span>` : ""}
            ${colorLabel ? `<span class="color-tag">${renderColorSwatch(colorLabel)}${esc(colorLabel)}</span>` : ""}
            ${p.trustShield?.condition === "refurbished" ? `<span class="mini-badge warn">♻ Yenilenmiş</span>` : ""}
            ${p.trustShield?.condition === "demo" ? `<span class="mini-badge trap">⚠ Teşhir</span>` : ""}
            ${p.trustShield?.warranty === "importer" ? `<span class="mini-badge warn">⚠ İthalatçı</span>` : ""}
            ${p.isListingPage ? `<span class="mini-badge fast">Kategori Sayfası</span>` : ""}
            ${p.priceSource === "installment" ? `<span class="mini-badge fast" title="Peşin fiyatına taksit bilgisinden toplam tutar olarak hesaplandı">Peşin Toplam</span>` : ""}
            ${p.isAccessory ? `<span class="mini-badge trap">Aksesuar</span>` : ""}
          </div>
          <h3 class="product-card-title" data-action="open-detail" title="${esc(p.title)}">${esc(p.title)}</h3>
          ${p.unitInfo ? `<div class="unit-pill" title="Otomatik birim maliyet (${esc(p.unitInfo.rawMatch)})">${esc(p.unitInfo.formatted)}</div>` : ""}
          <div class="product-card-pricing">
            <span class="price-main">${p.lowestPrice ? fmtTL(p.lowestPrice) : p.isListingPage ? "Kategoride Gör" : "Mağazada Gör"}</span>
            <span class="offer-pill">${p.offerCount > 1 ? `${p.offerCount} satıcı` : p.source ? esc(p.source) : "1 satıcı"}</span>
          </div>
          <div class="product-card-footer">
            ${
              isCatalogOnly
                ? `<a href="${esc(p.externalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm btn-analyze">${p.isListingPage ? "Kategoride Gör ↗" : "Ürüne Git ↗"}</a>`
                : `<button type="button" class="btn btn-primary btn-sm btn-analyze" data-action="open-detail">Detaylı Analiz</button>`
            }
            <div class="product-card-actions-mini">
              ${
                hasDirectProductLink
                  ? `<a href="${esc(p.externalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-good btn-sm" title="Doğrudan ürün sayfasını aç">Ürüne Git ↗</a>`
                  : ""
              }
              <button type="button" class="btn btn-secondary btn-sm btn-cart-toggle ${inCart ? "selected" : ""}" data-action="toggle-cart" title="Sepet maliyet optimizatörüne ekle">
                ${inCart ? "✓ Sepet" : "+ Sepet"}
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-compare-toggle ${inCompare ? "selected" : ""}" data-action="toggle-compare" title="Karşılaştırma listesine ekle/çıkar">
                ${inCompare ? "✓" : "+ Kıyasla"}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

// ============================================================================
// DEEP PRODUCT DETAIL VIEW
// ============================================================================
async function openProductDetail(url, refresh = false, fallbackTitle = "") {
  if (!url) return;
  setStatus("loading", "Tüm mağazalardan kargo dahil teklifler ve fiyat geçmişi analiz ediliyor...");
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const params = new URLSearchParams({ url });
    if (refresh) params.set("refresh", "1");
    if (fallbackTitle) params.set("title", fallbackTitle);
    const detail = await apiFetch(`/api/product?${params.toString()}`);
    setStatus(null);

    state.currentDetail = mergePersonalPriceHistory(detail);
    state.chartRange = "all";
    state.offerSort = "net_asc";
    state.offerFilters = {
      freeShippingOnly: false,
      inStockOnly: false,
      hideOutliers: false,
      hideSuspicious: Boolean(detail.stats?.suspiciousLowCount > 0),
      authorizedOnly: false,
      hideImporterAndRefurb: false,
      storeSearch: "",
    };

    switchView("detail");
    renderDetailView();
  } catch (err) {
    setStatus("error", err.message);
  }
}

function computeInstallment(principal, months, monthlyRatePct) {
  if (!principal || principal <= 0) return { monthly: 0, total: 0, extra: 0 };
  if (months <= 1 || monthlyRatePct <= 0) {
    const monthly = Math.round((principal / Math.max(1, months)) * 100) / 100;
    return { monthly, total: principal, extra: 0 };
  }
  const r = monthlyRatePct / 100;
  const factor = (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  const monthly = Math.round(principal * factor * 100) / 100;
  const total = Math.round(monthly * months * 100) / 100;
  const extra = Math.round(Math.max(0, total - principal) * 100) / 100;
  return { monthly, total, extra };
}

function renderTrustShieldPanel(ts, stats) {
  if (!ts) return "";
  const hasWarnings = ts.importerCount > 0 || ts.refurbishedCount > 0 || ts.demoCount > 0;
  const showPanel = hasWarnings || ts.isHighRiskCategory || ts.distributorCount > 0;
  if (!showPanel) return "";

  const panelTone = hasWarnings || (ts.isHighRiskCategory && ts.cautionCount > 0) ? "caution" : "verified";
  const pills = [];
  if (ts.authorizedCount > 0) {
    pills.push(`<span class="trust-pill good">🛡 ${ts.authorizedCount} Yetkili / Resmi Satıcı</span>`);
  }
  if (ts.distributorCount > 0) {
    pills.push(`<span class="trust-pill good">✓ ${ts.distributorCount} TR Resmi Garanti</span>`);
  }
  if (ts.importerCount > 0) {
    pills.push(`<span class="trust-pill warn">⚠ ${ts.importerCount} İthalatçı Garantili</span>`);
  }
  if (ts.refurbishedCount > 0) {
    pills.push(`<span class="trust-pill warn">♻ ${ts.refurbishedCount} Yenilenmiş / Outlet</span>`);
  }
  if (ts.demoCount > 0) {
    pills.push(`<span class="trust-pill bad">⚠ ${ts.demoCount} Teşhir / Açık Kutu</span>`);
  }
  if (ts.isHighRiskCategory) {
    pills.push(`<span class="trust-pill warn">Orijinallik Öncelikli Kategori</span>`);
  }

  const bestAuth = ts.cheapestAuthorized;
  return `
    <section class="trust-shield-panel ${panelTone}">
      <div class="trust-shield-head">
        <h3 class="trust-shield-title">🛡 Orijinallik, Garanti & Satıcı Güven Kalkanı</h3>
        <div class="trust-shield-pills">${pills.join("")}</div>
      </div>
      ${ts.recommendationNote ? `<p class="trust-shield-note">${esc(ts.recommendationNote)}</p>` : ""}
      ${
        bestAuth
          ? `
        <div class="trust-shield-best-auth">
          <div>
            <strong>En Ucuz Yetkili / Güvenilir Seçenek:</strong>
            <span>${esc(bestAuth.store)}</span> ·
            <strong class="mono" style="color:var(--good);">${fmtTL(bestAuth.netPrice)}</strong>
            ${bestAuth.warrantyLabel ? `<span class="mini-badge official" style="margin-left:6px;">${esc(bestAuth.warrantyLabel)}</span>` : ""}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${
              ts.authorizedCount > 0 && ts.authorizedCount < (stats?.offerCountAnalyzed || 0)
                ? `<button type="button" id="trustFilterAuthQuickBtn" class="btn btn-secondary btn-sm">${state.offerFilters.authorizedOnly ? "✓ Sadece Yetkili Aktif" : "Sadece Yetkilileri Göster"}</button>`
                : ""
            }
            <a href="${esc(bestAuth.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-good btn-sm">Yetkili Mağaza ↗</a>
          </div>
        </div>
      `
          : ""
      }
    </section>
  `;
}

function renderFakeDiscountPanel(fd) {
  if (!fd) return "";
  const tone = fd.tone || "neutral";
  const hasScore = typeof fd.authenticityScore === "number" && Number.isFinite(fd.authenticityScore);
  const m = fd.metrics || null;

  let trajectoryHtml = "";
  if (m && typeof m.normalPrice === "number" && typeof m.peakPrice === "number" && m.peakPrice > 0) {
    const spikeTag = m.spikePct > 0.5 ? `+${fmtPct(m.spikePct, false)}` : "Zirve";
    const diffClass = m.realDiffPct <= -2 ? "good" : m.realDiffPct >= 2 ? "bad" : "";
    trajectoryHtml = `
      <div class="fd-trajectory">
        <div class="fd-step">
          <span class="fd-step-label">Önceki Normal Medyan</span>
          <strong class="fd-step-val mono">${fmtTL(m.normalPrice)}</strong>
        </div>
        <span class="fd-arrow" aria-hidden="true">→</span>
        <div class="fd-step peak">
          <span class="fd-step-label">${esc(m.peakDate || "Kampanya Zirvesi")}</span>
          <strong class="fd-step-val mono">${fmtTL(m.peakPrice)}</strong>
          <span class="fd-step-sub">${esc(spikeTag)}</span>
        </div>
        <span class="fd-arrow" aria-hidden="true">→</span>
        <div class="fd-step current">
          <span class="fd-step-label">Güncel Net Fiyat</span>
          <strong class="fd-step-val mono ${diffClass}">${fmtTL(m.currentPrice)}</strong>
          <span class="fd-step-sub ${diffClass}">Gerçek fark: ${fmtPct(m.realDiffPct)}</span>
        </div>
      </div>
    `;
  } else if (m && typeof m.normalPrice === "number" && typeof m.currentPrice === "number") {
    const diffClass = m.realDiffPct <= -2 ? "good" : m.realDiffPct >= 2 ? "bad" : "";
    trajectoryHtml = `
      <div class="fd-trajectory compact">
        <div class="fd-step">
          <span class="fd-step-label">Piyasa Medyanı</span>
          <strong class="fd-step-val mono">${fmtTL(m.normalPrice)}</strong>
        </div>
        <span class="fd-arrow" aria-hidden="true">→</span>
        <div class="fd-step current">
          <span class="fd-step-label">En Ucuz Güncel</span>
          <strong class="fd-step-val mono ${diffClass}">${fmtTL(m.currentPrice)}</strong>
          <span class="fd-step-sub ${diffClass}">${fmtPct(m.realDiffPct)}</span>
        </div>
      </div>
    `;
  }

  return `
    <section class="fake-discount-panel ${esc(tone)}">
      <div class="fd-header">
        <div>
          <span class="fd-eyebrow">Kampanya & Sahte İndirim Radarı</span>
          <h3 class="fd-title">${esc(fd.label || "Fiyat Gerçeklik Analizi")}</h3>
        </div>
        ${
          hasScore
            ? `
          <div class="fd-score-box">
            <div class="fd-score-head">
              <span class="fd-score-label">Gerçeklik Skoru</span>
              <strong class="fd-score-num mono">${fd.authenticityScore}/100</strong>
            </div>
            <div class="fd-score-track" aria-hidden="true">
              <div class="fd-score-fill ${esc(tone)}" style="width:${Math.max(4, Math.min(100, fd.authenticityScore))}%;"></div>
            </div>
          </div>
        `
            : `<span class="fd-pill neutral">Veri Birikiyor</span>`
        }
      </div>
      <p class="fd-headline">${esc(fd.headline || "")}</p>
      ${trajectoryHtml}
      ${
        fd.details?.length
          ? `<ul class="fd-details">${fd.details.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
          : ""
      }
    </section>
  `;
}

function renderDetailView() {
  const d = state.currentDetail;
  if (!d) return;

  const inCompare = state.compareBasket.some((c) => c.url === d.url);
  els.detailCompareToggleBtn.textContent = inCompare ? "✓ Kıyasla" : "+ Kıyasla";
  els.detailCompareToggleBtn.classList.toggle("selected", inCompare);

  const inCart = state.cart.some((c) => c.url === d.url);
  if (els.detailCartToggleBtn) {
    els.detailCartToggleBtn.textContent = inCart ? "✓ Sepette" : "+ Sepet";
    els.detailCartToggleBtn.classList.toggle("selected", inCart);
  }

  els.backToResultsBtn.hidden = !state.searchData;

  const watched = state.watchlist.find((w) => w.url === d.url);
  const selectedFolder = watched?.folder || suggestClientFolder(d.title);
  const folderOptions = getAllWatchlistFolders();
  const stats = d.stats;
  const picks = d.picks;
  const hist = d.historySummary;
  const verdict = d.verdict || { score: 50, label: "Analiz", tone: "neutral", headline: "", reasons: [] };

  const primaryExternalUrl = d.url.startsWith("https://") ? d.url : picks?.cheapestNet?.url || d.externalUrl || "";
  const primaryExternalLabel = d.url.startsWith("https://")
    ? "Akakçe Sayfası ↗"
    : (d.offers?.length || 0) > 1
      ? "En Ucuz Mağaza ↗"
      : "Ürüne Git ↗";

  const instPrice = stats?.minNet || d.lowPrice || 0;
  const instCalc = computeInstallment(instPrice, state.installment.months, state.installment.monthlyRate);

  const html = `
    <!-- Overview + Buy Timing Verdict -->
    <div class="overview-card">
      <div class="overview-image-box">
        ${d.image ? `<img src="${esc(d.image)}" alt="${esc(d.title)}" />` : `<span class="muted-text">Görsel yok</span>`}
      </div>

      <div class="overview-meta">
        ${d.category ? `<div class="breadcrumb">${esc(d.category)}</div>` : ""}
        <h2 class="overview-title">${esc(d.title)}</h2>
        <div class="overview-tags">
          ${d.brand ? `<span class="meta-tag">${esc(d.brand)}</span>` : ""}
          <span class="meta-tag">${d.totalOfferCount} toplam mağaza teklifi (${d.offers.length} teklif derin incelendi)</span>
          ${d.unitInfo ? `<span class="meta-tag unit">Birim: ${esc(d.unitInfo.formatted)}</span>` : ""}
          ${d.rating?.value ? `<span class="meta-tag">★ ${d.rating.value} / ${d.rating.best} (${d.rating.count})</span>` : ""}
          <span class="meta-tag">Güncelleme: ${fmtDateTime(d.fetchedAt)}${d.cached ? " (önbellek)" : " (canlı)"}</span>
        </div>

        <form id="watchInlineForm" class="watch-inline">
          <label for="targetPriceInput">Hedef Fiyat (TL):</label>
          <input
            type="number"
            id="targetPriceInput"
            step="0.01"
            min="1"
            placeholder="${stats?.minNet ? Math.round(stats.minNet * 0.95) : "Örn. 50000"}"
            value="${watched?.target_price ?? ""}"
          />
          <select id="watchFolderSelect" class="select-sm" aria-label="Takip klasörü" title="Takip klasörü seçin">
            ${folderOptions
              .map((f) => `<option value="${esc(f)}" ${f === selectedFolder ? "selected" : ""}>${esc(f)}</option>`)
              .join("")}
          </select>
          <button type="submit" class="btn ${watched ? "btn-good" : "btn-primary"} btn-sm">
            ${watched ? "✓ Takibi Güncelle" : "Takibe Al"}
          </button>
          ${primaryExternalUrl ? `<a href="${esc(primaryExternalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">${primaryExternalLabel}</a>` : ""}
        </form>
      </div>

      <div class="verdict-panel ${esc(verdict.tone)}">
        <div class="verdict-header">
          <span class="verdict-eyebrow">Şimdi Alınır mı? Skoru</span>
          <span class="verdict-score-badge">${verdict.score}/100</span>
        </div>
        <div class="verdict-label">${esc(verdict.label)}</div>
        <p class="verdict-headline">${esc(verdict.headline)}</p>
        <ul class="verdict-reasons">
          ${(verdict.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}
        </ul>
      </div>
    </div>

    <!-- 4 Key KPI Cards -->
    ${
      stats
        ? `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Kargo Dahil En Ucuz</div>
          <div class="kpi-value good">${fmtTL(stats.minNet)}</div>
          <div class="kpi-sub">${esc(picks?.cheapestNet?.store || "")} · ${esc(picks?.cheapestNet?.shippingLabel || "")}</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Piyasa Medyanı & Tasarruf</div>
          <div class="kpi-value">${fmtTL(stats.medianNet)}</div>
          <div class="kpi-sub">Medyana göre <strong>${fmtTL(stats.savingsVsMedian)}</strong> (${fmtPct(stats.savingsVsMedianPct, false)}) tasarruf</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">${hist ? (d.isPersonalHistory ? "Kayıtlı En Düşük Fiyat" : "6 Aylık En Düşük Fiyat") : "Fiyat Aralığı (Min – Max)"}</div>
          <div class="kpi-value">${hist ? fmtTL(hist.minPrice) : fmtTL(stats.maxNet)}</div>
          <div class="kpi-sub">
            ${
              hist
                ? `${esc(hist.minDate)} (${hist.diffFromMinPct <= 0.1 ? "Şu an dip seviyede!" : `şu an ${fmtPct(hist.diffFromMinPct)} yukarıda`})`
                : `Piyasa yayılımı: ${fmtPct(stats.marketSpreadPct, false)}`
            }
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Kargo & Satıcı Özeti</div>
          <div class="kpi-value">${stats.freeShippingCount}/${stats.offerCountAnalyzed} <span style="font-size:0.82rem;font-weight:500;color:var(--ink-muted);">ücretsiz kargo</span></div>
          <div class="kpi-sub">${d.platformBreakdown.length} farklı pazaryeri${stats.suspiciousLowCount > 0 ? ` · ${stats.suspiciousLowCount} şüpheli ucuz ayrıştırıldı` : stats.outlierCount > 0 ? ` · ${stats.outlierCount} fahiş fiyat ayrıştırıldı` : " · Fiyat dağılımı tutarlı"}</div>
        </div>
      </div>
    `
        : ""
    }

    <!-- Shipping Trap Warning (if any!) -->
    ${
      d.shippingTraps?.length
        ? `
      <div class="insight-alert">
        <div class="insight-alert-title">⚠ Kargo Tuzağı Tespit Edildi (${d.shippingTraps.length} teklif)</div>
        ${d.shippingTraps.slice(0, 2).map((t) => `<p>${esc(t.message)}</p>`).join("")}
      </div>
    `
        : ""
    }

    <!-- Campaign & Fake-Discount Radar ("Bindirim → İndirim" Detector) -->
    ${renderFakeDiscountPanel(d.fakeDiscount)}

    <!-- Authenticity, Official TR Warranty vs Importer Warranty & Seller Trust Shield -->
    ${renderTrustShieldPanel(d.trustSummary, stats)}

    <!-- Top 3 Picks -->
    ${
      picks
        ? `
      <div class="picks-grid">
        ${renderPickCard("Kargo Dahil En Ucuz", "cheapest", picks.cheapestNet, d.unitInfo, true)}
        ${renderPickCard("En Dengeli / Güvenilir Tercih", "balanced", picks.bestValue, d.unitInfo, false)}
        ${renderPickCard("En Hızlı Teslimat", "fast", picks.fastestCompetitive, d.unitInfo, false)}
      </div>
    `
        : ""
    }

    <!-- Credit Card Installment Calculator -->
    ${
      instPrice > 0
        ? `
      <section class="installment-panel">
        <div class="installment-controls">
          <div>
            <h3 style="margin:0;font-size:1rem;font-weight:800;">Taksit & Aylık Ödeme Hesaplayıcı</h3>
            <p class="muted-text" style="margin:2px 0 0;">En ucuz net fiyat (${fmtTL(instPrice)}) üzerinden tahmini ödeme planı</p>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <div class="installment-pills" id="installmentMonthPills">
              ${[1, 3, 6, 9, 12]
                .map(
                  (m) => `
                <button type="button" class="inst-pill ${state.installment.months === m ? "active" : ""}" data-months="${m}">
                  ${m === 1 ? "Peşin" : `${m} Taksit`}
                </button>`
                )
                .join("")}
            </div>
            <select id="installmentRateSelect" class="select-sm" aria-label="Aylık vade farkı">
              <option value="0" ${state.installment.monthlyRate === 0 ? "selected" : ""}>%0 (Peşin Fiyatına)</option>
              <option value="2.5" ${state.installment.monthlyRate === 2.5 ? "selected" : ""}>%2,5 / ay vade</option>
              <option value="3.5" ${state.installment.monthlyRate === 3.5 ? "selected" : ""}>%3,5 / ay vade</option>
              <option value="4.5" ${state.installment.monthlyRate === 4.5 ? "selected" : ""}>%4,5 / ay vade</option>
            </select>
          </div>
        </div>
        <div class="installment-outputs" id="installmentOutputs">
          <div class="inst-stat">
            <div class="inst-stat-label">Aylık Ödeme (${state.installment.months === 1 ? "Tek Çekim" : `${state.installment.months} Ay`})</div>
            <div class="inst-stat-value">${fmtTL(instCalc.monthly)}</div>
          </div>
          <div class="inst-stat">
            <div class="inst-stat-label">Toplam Geri Ödeme</div>
            <div class="inst-stat-value">${fmtTL(instCalc.total)}</div>
          </div>
          <div class="inst-stat">
            <div class="inst-stat-label">Toplam Vade Farkı</div>
            <div class="inst-stat-value" style="color:${instCalc.extra > 0 ? "var(--warn)" : "var(--good)"};">${instCalc.extra > 0 ? `+${fmtTL(instCalc.extra)}` : "0,00 TL (Vadesiz)"}</div>
          </div>
        </div>
      </section>
    `
        : ""
    }

    <!-- Full Multi-Store Comparison Table -->
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Tüm Mağaza Teklifleri (Kargo Dahil Net Sıralama)</h3>
          <p class="muted-text">Fiyatlar kargo maliyeti eklenerek net toplam üzerinden sıralanır; fırsat skoru fiyat, satıcı güveni, garanti durumu, kargo ve teslimat hızını birleştirir.</p>
        </div>

        <div class="table-filters">
          <input type="text" id="offerStoreFilter" class="input-sm" style="width:155px;" placeholder="Mağaza / satıcı ara..." value="${esc(state.offerFilters.storeSearch)}" />
          <label class="checkbox-pill">
            <input type="checkbox" id="filterFreeShipping" ${state.offerFilters.freeShippingOnly ? "checked" : ""} />
            Ücretsiz Kargo
          </label>
          ${
            d.trustSummary?.authorizedCount > 0
              ? `
            <label class="checkbox-pill">
              <input type="checkbox" id="filterAuthorizedOnly" ${state.offerFilters.authorizedOnly ? "checked" : ""} />
              🛡 Yetkili Satıcı (${d.trustSummary.authorizedCount})
            </label>
          `
              : ""
          }
          ${
            (d.trustSummary?.importerCount || 0) + (d.trustSummary?.refurbishedCount || 0) + (d.trustSummary?.demoCount || 0) > 0
              ? `
            <label class="checkbox-pill">
              <input type="checkbox" id="filterHideImporterRefurb" ${state.offerFilters.hideImporterAndRefurb ? "checked" : ""} />
              İthalatçı / Yenilenmiş Gizle
            </label>
          `
              : ""
          }
          <label class="checkbox-pill">
            <input type="checkbox" id="filterHideOutliers" ${state.offerFilters.hideOutliers ? "checked" : ""} />
            Fahişleri Gizle
          </label>
          ${
            stats?.suspiciousLowCount > 0
              ? `
            <label class="checkbox-pill">
              <input type="checkbox" id="filterHideSuspicious" ${state.offerFilters.hideSuspicious ? "checked" : ""} />
              Şüpheli Ucuzları Gizle (${stats.suspiciousLowCount})
            </label>
          `
              : ""
          }
          <select id="offerSortSelect" class="select-sm" aria-label="Teklif sıralaması">
            <option value="net_asc" ${state.offerSort === "net_asc" ? "selected" : ""}>Sırala: Kargo Dahil Net (Artan)</option>
            <option value="score_desc" ${state.offerSort === "score_desc" ? "selected" : ""}>Sırala: Fırsat Skoru (Yüksek)</option>
            <option value="base_asc" ${state.offerSort === "base_asc" ? "selected" : ""}>Sırala: Etiket Fiyatı (Artan)</option>
            <option value="delivery_asc" ${state.offerSort === "delivery_asc" ? "selected" : ""}>Sırala: En Hızlı Kargo</option>
          </select>
        </div>
      </div>

      <div class="table-scroll offers-table-desktop">
        <table class="offers-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Mağaza & Satıcı</th>
              <th class="num">Etiket Fiyatı</th>
              <th>Kargo</th>
              <th class="num">Kargo Dahil Net</th>
              ${d.unitInfo ? `<th class="num">Birim (${esc(d.unitInfo.unitLabel)})</th>` : ""}
              <th class="num">Fark</th>
              <th>Teslimat & Stok</th>
              <th class="num">Fırsat Skoru</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="offersTableBody"></tbody>
        </table>
      </div>
      <div id="mobileOffersList" class="mobile-offers-list"></div>
    </section>

    <!-- Price History Chart & Marketplace Breakdown -->
    <div class="analytics-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>${d.isPersonalHistory ? "Kişisel Fiyat Takip Grafiğiniz" : "Fiyat Geçmişi Grafiği"}</h3>
            <p class="muted-text">${
              hist
                ? d.isPersonalHistory
                  ? `${hist.dataPoints} kontrol kaydınızdan oluşturuldu (${hist.startDate} – ${hist.endDate})`
                  : `${hist.startDate} – ${hist.endDate} arası ${hist.dataPoints} günlük gerçek en düşük piyasa fiyatı`
                : "Bu ürünün bugünkü fiyatı kaydedildi — ürünü takibe alıp yeniden kontrol ettikçe kişisel grafiğiniz burada otomatik oluşacak."
            }</p>
          </div>
          <div class="range-pills" id="chartRangePills">
            <button type="button" class="range-pill ${state.chartRange === "7" ? "active" : ""}" data-range="7">7G</button>
            <button type="button" class="range-pill ${state.chartRange === "30" ? "active" : ""}" data-range="30">1 Ay</button>
            <button type="button" class="range-pill ${state.chartRange === "90" ? "active" : ""}" data-range="90">3 Ay</button>
            <button type="button" class="range-pill ${state.chartRange === "all" ? "active" : ""}" data-range="all">Tümü</button>
          </div>
        </div>

        <div id="priceChartMount"></div>

        ${
          hist
            ? `
          <div class="chart-stats-strip">
            <div class="chart-stat-item">
              <span class="chart-stat-label">${d.isPersonalHistory ? "Kayıt Ortalaması" : "30 Gün Ortalama"}</span>
              <span class="chart-stat-val">${fmtTL(hist.avg30)}</span>
            </div>
            <div class="chart-stat-item">
              <span class="chart-stat-label">${d.isPersonalHistory ? "Toplam Değişim" : "30 Günlük Değişim"}</span>
              <span class="chart-stat-val ${hist.change30dPct > 0 ? "up" : hist.change30dPct < 0 ? "down" : ""}">${fmtPct(hist.change30dPct)}</span>
            </div>
            <div class="chart-stat-item">
              <span class="chart-stat-label">Dönem En Yüksek</span>
              <span class="chart-stat-val">${fmtTL(hist.maxPrice)}</span>
            </div>
            <div class="chart-stat-item">
              <span class="chart-stat-label">Fiyat Oynaklığı</span>
              <span class="chart-stat-val">${fmtPct(hist.volatilityPct, false)}</span>
            </div>
          </div>
        `
            : ""
        }
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Pazaryeri Bazlı En İyi Fiyatlar</h3>
            <p class="muted-text">Her platformdaki kargo dahil en ucuz teklif</p>
          </div>
        </div>
        <div class="platform-list">
          ${renderPlatformBars(d.platformBreakdown)}
        </div>
      </section>
    </div>

    <!-- Variants (Colors / Capacities / Additional Store Links) -->
    ${
      d.variants?.length
        ? (() => {
            const hasInternalVariants = d.variants.some((v) => v.isInternalVirtual || v.isAkakceUrl);
            return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>${hasInternalVariants ? "Diğer Renk / Model Seçenekleri" : "Diğer İlgili Mağaza Sayfaları"}</h3>
            <p class="muted-text">${hasInternalVariants ? "Farklı bir renk, model veya mağaza seçeneğini kendi görseli ve fiyatıyla inceleyin" : "Doğrudan ilgili mağazanın katalog veya ürün sayfasını açın"}</p>
          </div>
        </div>
        <div class="variants-grid">
          ${d.variants
            .map((v) => {
              const isNavigable = Boolean(v.isAkakceUrl || v.isInternalVirtual);
              const showThumb = Boolean(v.image && !isFaviconUrl(v.image));
              return `
            <a class="variant-chip ${showThumb ? "has-thumb" : ""}" ${isNavigable ? `href="#" data-variant-url="${esc(v.url)}"` : `href="${esc(v.url || d.url)}" target="_blank" rel="noopener noreferrer"`}>
              ${showThumb ? `<img class="variant-thumb" src="${esc(v.image)}" alt="${esc(v.name)}" loading="lazy" />` : ""}
              <div class="variant-info">
                <span class="variant-name">${v.color ? renderColorSwatch(v.color) : ""}${esc(v.name)}</span>
                <span class="variant-price">${v.price ? fmtTL(v.price) : v.isListingPage ? "Kategoride Gör ↗" : "Mağazada Gör ↗"}</span>
                ${v.seller ? `<span class="muted-text" style="font-size:0.74rem;margin:0;">${esc(v.seller)}</span>` : ""}
              </div>
            </a>`;
            })
            .join("")}
        </div>
      </section>
    `;
          })()
        : ""
    }

    <!-- Technical Specifications -->
    ${
      d.specs?.length
        ? `
      <section class="panel">
        <div class="panel-header">
          <h3>Teknik Özellikler</h3>
        </div>
        <div class="specs-grid">
          ${d.specs
            .map(
              (s) => `
            <div class="spec-item">
              <span class="spec-key">${esc(s.name)}</span>
              <span class="spec-val">${esc(s.value)}</span>
            </div>`
            )
            .join("")}
        </div>
      </section>
    `
        : ""
    }
  `;

  els.detailContainer.innerHTML = html;

  // Render offers table & price chart
  renderOffersTableBody();
  renderPriceChart($("priceChartMount"), d.history, state.chartRange);

  // Bind Installment Calculator controls
  const updateInstallmentUI = () => {
    const out = $("installmentOutputs");
    if (!out) return;
    const calc = computeInstallment(instPrice, state.installment.months, state.installment.monthlyRate);
    out.innerHTML = `
      <div class="inst-stat">
        <div class="inst-stat-label">Aylık Ödeme (${state.installment.months === 1 ? "Tek Çekim" : `${state.installment.months} Ay`})</div>
        <div class="inst-stat-value">${fmtTL(calc.monthly)}</div>
      </div>
      <div class="inst-stat">
        <div class="inst-stat-label">Toplam Geri Ödeme</div>
        <div class="inst-stat-value">${fmtTL(calc.total)}</div>
      </div>
      <div class="inst-stat">
        <div class="inst-stat-label">Toplam Vade Farkı</div>
        <div class="inst-stat-value" style="color:${calc.extra > 0 ? "var(--warn)" : "var(--good)"};">${calc.extra > 0 ? `+${fmtTL(calc.extra)}` : "0,00 TL (Vadesiz)"}</div>
      </div>
    `;
  };

  $("installmentMonthPills")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-months]");
    if (!btn) return;
    state.installment.months = Number.parseInt(btn.dataset.months, 10) || 1;
    $("installmentMonthPills")
      .querySelectorAll(".inst-pill")
      .forEach((b) => b.classList.toggle("active", b === btn));
    updateInstallmentUI();
  });

  $("installmentRateSelect")?.addEventListener("change", (e) => {
    state.installment.monthlyRate = Number.parseFloat(e.target.value) || 0;
    updateInstallmentUI();
  });

  // Bind detail-level controls
  $("trustFilterAuthQuickBtn")?.addEventListener("click", () => {
    state.offerFilters.authorizedOnly = !state.offerFilters.authorizedOnly;
    const cb = $("filterAuthorizedOnly");
    if (cb) cb.checked = state.offerFilters.authorizedOnly;
    const btn = $("trustFilterAuthQuickBtn");
    if (btn) btn.textContent = state.offerFilters.authorizedOnly ? "✓ Sadece Yetkili Aktif" : "Sadece Yetkilileri Göster";
    renderOffersTableBody();
  });
  $("offerStoreFilter")?.addEventListener("input", (e) => {
    state.offerFilters.storeSearch = e.target.value;
    renderOffersTableBody();
  });
  $("filterFreeShipping")?.addEventListener("change", (e) => {
    state.offerFilters.freeShippingOnly = e.target.checked;
    renderOffersTableBody();
  });
  $("filterAuthorizedOnly")?.addEventListener("change", (e) => {
    state.offerFilters.authorizedOnly = e.target.checked;
    const btn = $("trustFilterAuthQuickBtn");
    if (btn) btn.textContent = state.offerFilters.authorizedOnly ? "✓ Sadece Yetkili Aktif" : "Sadece Yetkilileri Göster";
    renderOffersTableBody();
  });
  $("filterHideImporterRefurb")?.addEventListener("change", (e) => {
    state.offerFilters.hideImporterAndRefurb = e.target.checked;
    renderOffersTableBody();
  });
  $("filterHideOutliers")?.addEventListener("change", (e) => {
    state.offerFilters.hideOutliers = e.target.checked;
    renderOffersTableBody();
  });
  $("filterHideSuspicious")?.addEventListener("change", (e) => {
    state.offerFilters.hideSuspicious = e.target.checked;
    renderOffersTableBody();
  });
  $("offerSortSelect")?.addEventListener("change", (e) => {
    state.offerSort = e.target.value;
    renderOffersTableBody();
  });

  $("chartRangePills")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn) return;
    state.chartRange = btn.dataset.range;
    $("chartRangePills")
      .querySelectorAll(".range-pill")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderPriceChart($("priceChartMount"), d.history, state.chartRange);
  });

  $("watchInlineForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const targetRaw = $("targetPriceInput").value.trim();
    const targetPrice = targetRaw ? Number.parseFloat(targetRaw) : null;
    const folder = ($("watchFolderSelect")?.value || "").trim() || suggestClientFolder(d.title);
    try {
      const res = await apiFetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: d.id,
          title: d.title,
          url: d.url,
          image: d.image,
          folder,
          target_price: targetPrice,
          last_net_price: d.stats?.minNet ?? d.lowPrice,
          best_store: d.picks?.cheapestNet?.store || "",
          verdict_score: d.verdict?.score ?? null,
          verdict_label: d.verdict?.label || "",
          fake_discount_status: d.fakeDiscount?.status || "",
          fake_discount_label: d.fakeDiscount?.label || "",
          offer_count: d.totalOfferCount,
        }),
      });
      state.watchlist = res.items || [];
      saveLocalWatchlist(state.watchlist);
      updateWatchlistBadge();
      showToast(
        targetPrice
          ? `"${folder}" klasörüne eklendi (Hedef: ${fmtTL(targetPrice)})`
          : `"${folder}" klasörüne eklendi.`
      );
      renderDetailView();
    } catch (err) {
      showToast(`Hata: ${err.message}`);
    }
  });

  els.detailContainer.querySelectorAll("[data-variant-url]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openProductDetail(a.dataset.variantUrl);
    });
  });
}

function renderPickCard(title, badgeClass, pick, unitInfo, isPrimary) {
  if (!pick) return "";
  return `
    <div class="pick-card ${isPrimary ? "primary-pick" : ""}">
      <div class="pick-header">
        <span class="pick-badge ${badgeClass}">${esc(title)}</span>
        <span class="pick-score">Skor: ${pick.dealScore}/100</span>
      </div>
      <div class="pick-store">
        ${pick.storeLogo ? `<img class="store-logo" src="${esc(pick.storeLogo)}" alt="${esc(pick.platform)}" />` : ""}
        <span>${esc(pick.store)}</span>
      </div>
      <div class="pick-price-row">
        <span class="pick-net">${fmtTL(pick.netPrice)}</span>
        <span class="pick-ship ${pick.shippingCost === 0 ? "free" : ""}">${esc(pick.shippingLabel)}</span>
      </div>
      <div class="pick-meta">
        ${pick.deliveryLabel ? `${esc(pick.deliveryLabel)} · ` : ""}${esc(pick.stockText || "Stokta")}
        ${pick.unitPrice && unitInfo ? ` · ${fmtTL(pick.unitPrice)} / ${esc(unitInfo.unitLabel)}` : ""}
      </div>
      <a href="${esc(pick.url)}" target="_blank" rel="noopener noreferrer" class="btn ${isPrimary ? "btn-good" : "btn-secondary"} btn-sm" style="margin-top:auto;">
        Mağazaya Git ↗
      </a>
    </div>
  `;
}

function renderPlatformBars(breakdown) {
  if (!breakdown?.length) {
    return `<p class="muted-text">Platform verisi bulunamadı.</p>`;
  }
  const minP = breakdown[0].minNet;
  const maxP = Math.max(...breakdown.map((b) => b.minNet));
  const span = maxP - minP || 1;

  return breakdown
    .map((p, idx) => {
      // Bar width scaled nicely between 35% and 100%
      const pct = maxP === minP ? 100 : Math.round(38 + ((p.minNet - minP) / span) * 62);
      return `
        <div class="platform-row">
          <div class="platform-row-top">
            <span class="platform-name">
              ${p.logoUrl ? `<img class="store-logo" src="${esc(p.logoUrl)}" alt="${esc(p.platform)}" style="height:15px;" />` : ""}
              <span>${esc(p.platform)}</span>
              <span class="platform-count">(${p.count})</span>
            </span>
            <span class="platform-price">
              ${fmtTL(p.minNet)}
              ${idx > 0 ? `<span class="muted-text" style="font-size:0.74rem;margin-left:4px;">${fmtPct(p.diffFromGlobalMinPct)}</span>` : ""}
            </span>
          </div>
          <div class="platform-bar-track">
            <div class="platform-bar-fill ${idx === 0 ? "cheapest" : ""}" style="width:${pct}%;"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderOffersTableBody() {
  const tbody = $("offersTableBody");
  const mobileList = $("mobileOffersList");
  const d = state.currentDetail;
  if (!tbody || !d) return;

  const q = state.offerFilters.storeSearch.trim().toLocaleLowerCase("tr-TR");
  let list = [...(d.offers || [])];

  if (state.offerFilters.freeShippingOnly) {
    list = list.filter((o) => o.shipping?.isFree);
  }
  if (state.offerFilters.authorizedOnly) {
    list = list.filter((o) => o.trustShield?.isAuthorized || o.store?.isOfficialSeller);
  }
  if (state.offerFilters.hideImporterAndRefurb) {
    list = list.filter(
      (o) =>
        o.trustShield?.warranty !== "importer" &&
        o.trustShield?.condition !== "refurbished" &&
        o.trustShield?.condition !== "demo"
    );
  }
  if (state.offerFilters.hideOutliers) {
    list = list.filter((o) => !o.isOutlier);
  }
  if (state.offerFilters.hideSuspicious) {
    list = list.filter((o) => !o.isSuspiciousLow);
  }
  if (q) {
    list = list.filter((o) =>
      `${o.store?.displayName || ""} ${o.offerTitle || ""}`.toLocaleLowerCase("tr-TR").includes(q)
    );
  }

  if (state.offerSort === "score_desc") {
    list.sort((a, b) => b.dealScore - a.dealScore || a.netPrice - b.netPrice);
  } else if (state.offerSort === "base_asc") {
    list.sort((a, b) => a.basePrice - b.basePrice || a.netPrice - b.netPrice);
  } else if (state.offerSort === "delivery_asc") {
    list.sort((a, b) => (a.delivery?.days ?? 5) - (b.delivery?.days ?? 5) || a.netPrice - b.netPrice);
  } else {
    list.sort((a, b) => a.netPrice - b.netPrice);
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${d.unitInfo ? 10 : 9}" style="text-align:center;padding:28px;" class="muted-text">Filtre kriterlerinize uyan mağaza teklifi bulunamadı.</td></tr>`;
    if (mobileList) {
      mobileList.innerHTML = `<div class="empty-state" style="padding:24px;"><p class="muted-text">Filtre kriterlerinize uyan mağaza teklifi bulunamadı.</p></div>`;
    }
    return;
  }

  tbody.innerHTML = list
    .map((o, i) => {
      const scoreClass = o.dealScore >= 75 ? "" : o.dealScore >= 50 ? "mid" : "low";
      const rowClass = o.rankByNet === 1 ? "row-best" : o.isOutlier ? "row-outlier" : "";
      return `
        <tr class="${rowClass}">
          <td class="mono muted-text">${i + 1}</td>
          <td>
            <div class="store-cell">
              <div class="store-cell-top">
                ${o.storeLogo ? `<img class="store-logo" src="${esc(o.storeLogo)}" alt="${esc(o.store.platform)}" />` : ""}
                <span>${esc(o.store.platform)}</span>
              </div>
              ${o.store.seller ? `<span class="store-seller-sub">Satıcı: ${esc(o.store.seller)}</span>` : ""}
              ${
                o.store.sellerRating
                  ? `<span class="store-seller-sub">Mağaza Puanı: <strong>${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(o.store.sellerRating)}/10</strong>${o.store.sellerReviews ? ` · ${esc(o.store.sellerReviews)}` : ""}</span>`
                  : ""
              }
              <div class="row-badges">
                ${o.store.isOfficialSeller ? `<span class="mini-badge official">Yetkili / Resmi</span>` : ""}
                ${(o.badges || []).map((b) => `<span class="mini-badge ${esc(b.type)}">${esc(b.label)}</span>`).join("")}
              </div>
            </div>
          </td>
          <td class="num mono">${fmtTL(o.basePrice)}</td>
          <td>
            <span class="ship-tag ${o.shipping?.isFree ? "free" : o.shippingCost > 0 ? "paid" : ""}">
              ${esc(o.shipping?.label || "-")}
            </span>
          </td>
          <td class="num net-price-cell">${fmtTL(o.netPrice)}</td>
          ${
            d.unitInfo
              ? `<td class="num mono" style="font-size:0.82rem;">${o.unitPrice !== null ? fmtTL(o.unitPrice) : "-"}</td>`
              : ""
          }
          <td class="num">
            <div class="diff-cell ${o.diffFromMin === 0 ? "zero" : o.diffFromMinPct > 15 ? "high" : ""}">
              ${o.diffFromMin === 0 ? "En ucuz" : `+${fmtTL(o.diffFromMin)}`}
            </div>
            ${o.diffFromMin > 0 ? `<div class="diff-cell">${fmtPct(o.diffFromMinPct)}</div>` : ""}
          </td>
          <td>
            <div style="font-size:0.82rem;font-weight:600;">${esc(o.delivery?.label || "Standart")}</div>
            <div class="muted-text" style="font-size:0.75rem;margin:0;">${esc(o.stockText)}${o.lastUpdated ? ` · ${esc(o.lastUpdated)}` : ""}</div>
          </td>
          <td class="num">
            <div class="score-bar-wrap">
              <div class="score-bar-track"><div class="score-bar-fill ${scoreClass}" style="width:${o.dealScore}%;"></div></div>
              <span class="score-num">${o.dealScore}</span>
            </div>
          </td>
          <td class="num">
            <a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
              ${o.isDirectLink ? "Mağaza ↗" : "İncele ↗"}
            </a>
          </td>
        </tr>
      `;
    })
    .join("");

  if (mobileList) {
    mobileList.innerHTML = list
      .map((o, i) => {
        const scoreClass = o.dealScore >= 75 ? "" : o.dealScore >= 50 ? "mid" : "low";
        const rowClass = o.rankByNet === 1 ? "row-best" : o.isOutlier ? "row-outlier" : "";
        return `
          <article class="mobile-offer-card ${rowClass}">
            <div class="mobile-offer-top">
              <div class="mobile-offer-store">
                <div class="store-cell-top">
                  <span class="mono muted-text" style="font-size:0.78rem;">#${i + 1}</span>
                  ${o.storeLogo ? `<img class="store-logo" src="${esc(o.storeLogo)}" alt="${esc(o.store.platform)}" />` : ""}
                  <span>${esc(o.store.platform)}</span>
                </div>
                ${o.store.seller ? `<span class="store-seller-sub">Satıcı: ${esc(o.store.seller)}</span>` : ""}
                ${
                  o.store.sellerRating
                    ? `<span class="store-seller-sub">Puan: <strong>${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(o.store.sellerRating)}/10</strong>${o.store.sellerReviews ? ` · ${esc(o.store.sellerReviews)}` : ""}</span>`
                    : ""
                }
              </div>
              <div class="score-bar-wrap">
                <div class="score-bar-track"><div class="score-bar-fill ${scoreClass}" style="width:${o.dealScore}%;"></div></div>
                <span class="score-num">${o.dealScore}</span>
              </div>
            </div>

            <div class="mobile-offer-price-row">
              <div>
                <div class="mobile-offer-net">${fmtTL(o.netPrice)}</div>
                <div class="muted-text" style="font-size:0.75rem;margin:0;">
                  Etiket: ${fmtTL(o.basePrice)} ·
                  <span class="ship-tag ${o.shipping?.isFree ? "free" : o.shippingCost > 0 ? "paid" : ""}">${esc(o.shipping?.label || "-")}</span>
                </div>
              </div>
              <div style="text-align:right;">
                <div class="diff-cell ${o.diffFromMin === 0 ? "zero" : o.diffFromMinPct > 15 ? "high" : ""}">
                  ${o.diffFromMin === 0 ? "En ucuz" : `+${fmtTL(o.diffFromMin)}`}
                </div>
                ${o.diffFromMin > 0 ? `<div class="diff-cell">${fmtPct(o.diffFromMinPct)}</div>` : ""}
              </div>
            </div>

            <div class="mobile-offer-meta">
              <span>${esc(o.delivery?.label || "Standart")} · ${esc(o.stockText)}</span>
              ${o.unitPrice !== null && d.unitInfo ? `<span class="mono">${fmtTL(o.unitPrice)} / ${esc(d.unitInfo.unitLabel)}</span>` : ""}
            </div>

            ${
              o.store.isOfficialSeller || (o.badges && o.badges.length)
                ? `<div class="row-badges">
                    ${o.store.isOfficialSeller ? `<span class="mini-badge official">Yetkili / Resmi</span>` : ""}
                    ${(o.badges || []).map((b) => `<span class="mini-badge ${esc(b.type)}">${esc(b.label)}</span>`).join("")}
                  </div>`
                : ""
            }

            <a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" class="btn ${o.rankByNet === 1 ? "btn-good" : "btn-secondary"} btn-sm mobile-offer-cta">
              ${o.isDirectLink ? "Mağazaya Git ↗" : "Teklifi İncele ↗"}
            </a>
          </article>
        `;
      })
      .join("");
  }
}

// ============================================================================
// MULTI-PRODUCT SIDE-BY-SIDE COMPARE
// ============================================================================
function toggleCompareItem(product) {
  const idx = state.compareBasket.findIndex((p) => p.url === product.url);
  if (idx !== -1) {
    state.compareBasket.splice(idx, 1);
    showToast("Ürün karşılaştırma listesinden çıkarıldı.");
  } else {
    if (state.compareBasket.length >= 4) {
      showToast("En fazla 4 ürünü yan yana karşılaştırabilirsiniz.");
      return;
    }
    state.compareBasket.push({
      id: product.id,
      title: product.title,
      url: product.url,
      image: product.image || "",
      lowestPrice: product.lowestPrice ?? product.stats?.minNet ?? null,
    });
    showToast(`Karşılaştırma listesine eklendi (${state.compareBasket.length}/4).`);
  }
  saveLocalCompare();
  if (state.activeView === "search") renderSearchResults();
  if (state.activeView === "detail") renderDetailView();
  if (state.activeView === "compare") renderCompareView();
}

function renderCompareView() {
  const basket = state.compareBasket;
  els.runCompareBtn.hidden = basket.length < 2;
  els.clearCompareBtn.hidden = basket.length === 0;

  if (!basket.length) {
    els.compareBasketBar.innerHTML = "";
    els.compareResultContainer.innerHTML = `
      <div class="empty-state">
        <h3>Karşılaştırma listeniz boş</h3>
        <p>Arama sonuçlarından veya ürün detay sayfasından 2 ile 4 arası ürün seçip <strong>"+ Kıyasla"</strong> butonuna tıklayın.</p>
      </div>`;
    return;
  }

  els.compareBasketBar.innerHTML = basket
    .map(
      (item, i) => `
      <div class="basket-chip">
        <span>${i + 1}. ${esc(item.title.slice(0, 48))}${item.title.length > 48 ? "…" : ""}</span>
        <button type="button" data-remove-compare="${esc(item.url)}" aria-label="Kaldır">&times;</button>
      </div>`
    )
    .join("");

  if (basket.length < 2) {
    els.compareResultContainer.innerHTML = `
      <div class="empty-state">
        <h3>Karşılaştırma için en az 1 ürün daha ekleyin</h3>
        <p>Şu an 1 ürün seçili. Yan yana fiyat ve özellik kıyaslaması için ikinci bir ürün daha seçin.</p>
      </div>`;
    return;
  }

  // If we already fetched matching compare results, render them; otherwise fetch automatically
  const sameSet =
    state.compareResult &&
    state.compareResult.items.length === basket.length &&
    basket.every((b) => state.compareResult.items.some((r) => r.url === b.url));

  if (sameSet) {
    renderCompareMatrix(state.compareResult);
  } else {
    runSideBySideCompare();
  }
}

async function runSideBySideCompare() {
  if (state.compareBasket.length < 2) return;
  setStatus("loading", `${state.compareBasket.length} ürünün canlı fiyatları ve özellikleri karşılaştırılıyor...`);
  try {
    const res = await apiFetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: state.compareBasket.map((b) => b.url),
        titles: state.compareBasket.map((b) => b.title || ""),
      }),
    });
    setStatus(null);
    state.compareResult = res;
    renderCompareMatrix(res);
  } catch (err) {
    setStatus("error", err.message);
  }
}

function renderCompareMatrix(data) {
  const items = data.items || [];
  if (!items.length) return;

  const minNet = Math.min(...items.map((x) => x.stats?.minNet ?? Infinity));
  const bestVerdict = Math.max(...items.map((x) => x.verdict?.score ?? 0));

  // Only highlight best unit price if all items share the same unitLabel
  const unitLabels = new Set(items.map((x) => x.unitInfo?.unitLabel).filter(Boolean));
  const sameUnit = unitLabels.size === 1 && items.every((x) => x.unitInfo?.unitPrice);
  const minUnit = sameUnit ? Math.min(...items.map((x) => x.unitInfo.unitPrice)) : null;

  const specRows = (data.specKeys || [])
    .map((key) => {
      const cells = items.map((it) => {
        const found = (it.specs || []).find((s) => s.name === key);
        return `<td>${esc(found ? found.value : "—")}</td>`;
      });
      return `<tr><th>${esc(key)}</th>${cells.join("")}</tr>`;
    })
    .join("");

  els.compareResultContainer.innerHTML = `
    <div class="table-scroll">
      <table class="compare-table">
        <thead>
          <tr>
            <th>Karşılaştırma Ölçütü</th>
            ${items
              .map(
                (it) => `
              <td>
                <div style="display:flex;flex-direction:column;gap:8px;min-width:190px;">
                  ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" style="height:82px;object-fit:contain;align-self:flex-start;" />` : ""}
                  <strong style="cursor:pointer;color:var(--primary);" data-open-compared="${esc(it.url)}" data-open-compared-title="${esc(it.title)}">${esc(it.title)}</strong>
                </div>
              </td>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Kargo Dahil En Ucuz</th>
            ${items
              .map((it) => {
                const v = it.stats?.minNet;
                const isBest = v === minNet;
                return `<td class="mono ${isBest ? "best-cell" : ""}">${fmtTL(v)}${isBest ? " ★" : ""}</td>`;
              })
              .join("")}
          </tr>
          <tr>
            <th>En Ucuz Mağaza</th>
            ${items
              .map(
                (it) => `
              <td>
                ${esc(it.picks?.cheapestNet?.store || "-")}
                <div class="muted-text" style="font-size:0.76rem;">${esc(it.picks?.cheapestNet?.shippingLabel || "")}</div>
              </td>`
              )
              .join("")}
          </tr>
          <tr>
            <th>Birim Fiyat</th>
            ${items
              .map((it) => {
                const isBest = sameUnit && it.unitInfo?.unitPrice === minUnit;
                return `<td class="mono ${isBest ? "best-cell" : ""}">${it.unitInfo ? esc(it.unitInfo.formatted) : "—"}${isBest ? " ★" : ""}</td>`;
              })
              .join("")}
          </tr>
          <tr>
            <th>"Şimdi Alınır mı?" Skoru</th>
            ${items
              .map((it) => {
                const sc = it.verdict?.score ?? 0;
                const isBest = sc === bestVerdict && sc > 0;
                return `<td class="${isBest ? "best-cell" : ""}"><strong>${sc}/100</strong> · ${esc(it.verdict?.label || "")}</td>`;
              })
              .join("")}
          </tr>
          <tr>
            <th>Piyasa Medyanı</th>
            ${items.map((it) => `<td class="mono">${fmtTL(it.stats?.medianNet)}</td>`).join("")}
          </tr>
          <tr>
            <th>6 Aylık En Düşük</th>
            ${items
              .map(
                (it) =>
                  `<td class="mono">${it.historySummary ? `${fmtTL(it.historySummary.minPrice)} <div class="muted-text" style="font-size:0.74rem;">${esc(it.historySummary.minDate)}</div>` : "—"}</td>`
              )
              .join("")}
          </tr>
          <tr>
            <th>Toplam Satıcı</th>
            ${items.map((it) => `<td class="mono">${it.totalOfferCount} mağaza</td>`).join("")}
          </tr>
          ${specRows}
        </tbody>
      </table>
    </div>
  `;

  els.compareResultContainer.querySelectorAll("[data-open-compared]").forEach((el) => {
    el.addEventListener("click", () =>
      openProductDetail(el.dataset.openCompared, false, el.dataset.openComparedTitle || "")
    );
  });
}

// ============================================================================
// SHOPPING CART COST OPTIMIZER ("SEPET OPTİMİZATÖRÜ")
// ============================================================================
function toggleCartItem(product) {
  if (!product?.url) return;
  const idx = state.cart.findIndex((c) => c.url === product.url);
  if (idx >= 0) {
    state.cart.splice(idx, 1);
    showToast("Ürün sepetten çıkarıldı.");
  } else {
    if (state.cart.length >= 12) {
      showToast("Sepet optimizatörüne en fazla 12 farklı ürün ekleyebilirsiniz.");
      return;
    }
    state.cart.push({
      id: product.id || "",
      title: product.title || "",
      url: product.url,
      image: product.image || "",
      lowestPrice: product.stats?.minNet ?? product.lowestPrice ?? product.lowPrice ?? null,
      quantity: 1,
    });
    showToast("Ürün sepet optimizatörüne eklendi.");
  }
  state.cartPlan = null;
  saveLocalCart();

  if (state.activeView === "search") renderSearchResults();
  if (state.activeView === "detail") renderDetailView();
  if (state.activeView === "cart") renderCartView();
}

function renderCartView() {
  const items = state.cart;
  if (els.optimizeCartBtn) els.optimizeCartBtn.hidden = items.length === 0;
  if (els.clearCartBtn) els.clearCartBtn.hidden = items.length === 0;

  if (!items.length) {
    els.cartItemsContainer.innerHTML = `
      <div class="empty-state">
        <h3>Sepetiniz henüz boş</h3>
        <p>Arama sonuçlarından veya ürün analiz ekranından <strong>"+ Sepet"</strong> butonuna dokunarak alacağınız ürünleri ekleyin; en ucuz <strong>tek mağaza</strong> veya <strong>karışık mağaza</strong> kombinasyonunu kargo dahil hesaplayalım.</p>
      </div>`;
    els.cartPlanContainer.innerHTML = "";
    return;
  }

  const estTotal = items.reduce(
    (sum, it) => sum + (typeof it.lowestPrice === "number" ? it.lowestPrice * (it.quantity || 1) : 0),
    0
  );

  els.cartItemsContainer.innerHTML = `
    <div class="list-stack">
      ${items
        .map(
          (it, idx) => `
        <div class="cart-item-card" data-cart-idx="${idx}">
          <img class="watch-thumb" src="${esc(it.image || "")}" alt="${esc(it.title)}" />
          <div>
            <h3 class="watch-title" data-open-cart-item="${esc(it.url)}" data-cart-title="${esc(it.title)}">${esc(it.title)}</h3>
            <div class="watch-metrics">
              <span>Tahmini Birim: <strong class="mono">${it.lowestPrice ? fmtTL(it.lowestPrice) : "Hesaplanacak"}</strong></span>
              ${it.lowestPrice ? `<span>Ara Toplam: <strong class="mono">${fmtTL(it.lowestPrice * (it.quantity || 1))}</strong></span>` : ""}
            </div>
          </div>
          <div class="watch-actions">
            <div class="qty-stepper" aria-label="Adet">
              <button type="button" data-cart-dec="${idx}" aria-label="Azalt">&minus;</button>
              <span>${it.quantity || 1}</span>
              <button type="button" data-cart-inc="${idx}" aria-label="Artır">+</button>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-cart-remove="${idx}">Sil</button>
          </div>
        </div>`
        )
        .join("")}
    </div>
    ${
      estTotal > 0
        ? `<div class="muted-text" style="margin-top:10px;text-align:right;">
            Sepet tahmini ön toplam (${items.reduce((s, i) => s + (i.quantity || 1), 0)} adet): <strong class="mono">${fmtTL(estTotal)}</strong>
          </div>`
        : ""
    }
  `;

  if (state.cartPlan) {
    renderCartPlan(state.cartPlan);
  } else {
    els.cartPlanContainer.innerHTML = `
      <div class="empty-state" style="margin-top:16px;">
        <p style="margin:0;">Yukarıdaki <strong>"Maliyeti Optimize Et"</strong> butonuna tıklayarak tüm mağazaların kargo barajlarını ve tek mağaza / karışık sepet farkını canlı hesaplayın.</p>
      </div>`;
  }
}

async function runCartOptimize() {
  if (!state.cart.length) return;
  els.optimizeCartBtn.disabled = true;
  setStatus("loading", `${state.cart.length} ürün için tüm mağaza teklifleri ve kargo barajları optimize ediliyor...`);
  try {
    const plan = await apiFetch("/api/cart/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: state.cart.map((c) => ({
          id: c.id,
          title: c.title,
          url: c.url,
          image: c.image,
          quantity: c.quantity || 1,
        })),
      }),
    });
    setStatus(null);
    state.cartPlan = plan;
    renderCartPlan(plan);
  } catch (err) {
    setStatus("error", err.message);
  } finally {
    els.optimizeCartBtn.disabled = false;
  }
}

function renderCartPlan(plan) {
  if (!plan || !plan.itemCount || !plan.splitStrategy) {
    els.cartPlanContainer.innerHTML = `
      <div class="empty-state" style="margin-top:16px;">
        <h3>Optimizasyon için yeterli fiyatlı teklif bulunamadı</h3>
        <p>Sepetteki ürünlerin canlı mağaza teklifleri alınamadı. Ayarlar'dan Serper API anahtarınızı kontrol edip tekrar deneyebilirsiniz.</p>
      </div>`;
    return;
  }

  const rec = plan.recommendation || {};
  const split = plan.splitStrategy;
  const singles = plan.singleStoreOptions || [];
  const bestSingle = singles.find((s) => s.coversAll) || singles[0] || null;
  const splitWins = rec.winner === "split";

  els.cartPlanContainer.innerHTML = `
    <div class="optimizer-verdict">
      <h3>✓ ${esc(rec.headline || "Sepet Optimizasyon Sonucu")}</h3>
      <p>${esc(rec.detail || "")}</p>
    </div>

    <div class="strategy-grid">
      <!-- Strategy A: Split-Store -->
      <section class="strategy-card ${splitWins ? "winner" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span class="pick-badge ${splitWins ? "cheapest" : "balanced"}">Karışık Mağaza (${split.storeCount} Mağaza)</span>
          ${splitWins ? `<span class="mini-badge cheapest">★ En Avantajlı</span>` : ""}
        </div>
        <div class="strategy-total">${fmtTL(split.total)}</div>
        <div class="muted-text" style="margin:0;font-size:0.82rem;">
          Ürünler: <strong class="mono">${fmtTL(split.subtotal)}</strong> · Kargo: <strong class="mono">${split.shipping === 0 ? "Ücretsiz" : fmtTL(split.shipping)}</strong>
        </div>

        <div class="strategy-list">
          ${split.assignments
            .map(
              (a) => `
            <div class="strategy-line">
              <div style="min-width:0;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(a.title)}">
                  ${a.quantity > 1 ? `${a.quantity}x ` : ""}${esc(a.title)}
                </div>
                <div class="muted-text" style="margin:0;font-size:0.75rem;">
                  ${esc(a.store)} · ${a.isFreeShipping ? "Ücretsiz kargo" : `+${fmtTL(a.unitShipping)} kargo`}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                <strong class="mono">${fmtTL(a.lineBasePrice)}</strong>
                ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Git ↗</a>` : ""}
              </div>
            </div>`
            )
            .join("")}
        </div>
      </section>

      <!-- Strategy B: Single-Store Consolidation -->
      <section class="strategy-card ${!splitWins && bestSingle?.coversAll ? "winner" : ""}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span class="pick-badge ${!splitWins && bestSingle?.coversAll ? "cheapest" : "fast"}">Tek Mağaza Seçenekleri</span>
          ${!splitWins && bestSingle?.coversAll ? `<span class="mini-badge cheapest">★ En Avantajlı</span>` : ""}
        </div>

        ${
          singles.length
            ? `
          <div class="strategy-total">${bestSingle ? fmtTL(bestSingle.total) : "-"}</div>
          <div class="muted-text" style="margin:0;font-size:0.82rem;">
            ${
              bestSingle
                ? `${esc(bestSingle.platform)} (${bestSingle.matchedCount}/${bestSingle.totalItems} ürün) · Kargo: <strong class="mono">${bestSingle.shipping === 0 ? "Ücretsiz" : fmtTL(bestSingle.shipping)}</strong>`
                : ""
            }
          </div>
          <div class="strategy-list">
            ${singles
              .map(
                (s) => `
              <div class="strategy-line">
                <div style="min-width:0;">
                  <div style="font-weight:700;">
                    ${esc(s.platform)}
                    <span class="offer-pill" style="margin-left:4px;">${s.matchedCount}/${s.totalItems} ürün</span>
                  </div>
                  <div class="muted-text" style="margin:0;font-size:0.75rem;">
                    Kargo: ${s.shipping === 0 ? "Ücretsiz (baraj aşıldı / dahil)" : fmtTL(s.shipping)}
                    ${s.missing?.length ? ` · Eksik: ${esc(s.missing.slice(0, 2).join(", "))}` : ""}
                  </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <strong class="mono">${fmtTL(s.total)}</strong>
                  ${
                    typeof s.diffVsSplit === "number"
                      ? `<div class="muted-text" style="margin:0;font-size:0.74rem;color:${s.diffVsSplit <= 0 ? "var(--good)" : "var(--warn)"};">
                          ${s.diffVsSplit <= 0 ? `${fmtTL(Math.abs(s.diffVsSplit))} kâr` : `+${fmtTL(s.diffVsSplit)} fark`}
                        </div>`
                      : ""
                  }
                </div>
              </div>`
              )
              .join("")}
          </div>
        `
            : `<p class="muted-text" style="margin:8px 0 0;">Sepetteki birden fazla ürünü aynı anda satan ortak bir mağaza bulunamadı; her ürünü soldaki en ucuz mağazasından almak en iyi stratejidir.</p>`
        }
      </section>
    </div>
  `;
}

// ============================================================================
// CAMERA BARCODE SCANNER (iPhone Safari & Desktop Compatible)
// ============================================================================
function openScannerModal() {
  if (!els.scannerModal) return;
  els.scannerModal.hidden = false;
  if (els.manualBarcodeInput) els.manualBarcodeInput.value = "";
  startScanner(els.scannerVideo, els.scannerStatus, (code) => {
    closeScannerModal();
    lookupBarcode(code);
  });
}

function closeScannerModal() {
  stopScanner();
  if (els.scannerModal) els.scannerModal.hidden = true;
}

async function lookupBarcode(rawCode) {
  const code = String(rawCode || "").replace(/\D+/g, "").trim();
  if (code.length < 8 || code.length > 14) {
    showToast("Barkod 8 ile 14 haneli rakam olmalıdır.");
    return;
  }

  setStatus("loading", `Barkod (${code}) veritabanlarında çözümleniyor...`);
  try {
    const resolved = await apiFetch(`/api/barcode/${encodeURIComponent(code)}`);
    const query = resolved.query || code;
    showToast(
      resolved.query && resolved.query !== code
        ? `Barkod çözüldü (${resolved.source}): ${query}`
        : `Barkod (${code}) doğrudan aranıyor...`
    );
    await performSearch(query, { fromBarcode: true });
  } catch (err) {
    setStatus("error", err.message);
  }
}

// ============================================================================
// WATCHLIST & SEARCH HISTORY
// ============================================================================
async function loadWatchlist() {
  try {
    const res = await apiFetch("/api/watchlist");
    let items = res.items || [];
    const localItems = loadLocalWatchlist();

    // If cloud server restarted with fresh ephemeral disk (e.g. Render Free Tier),
    // automatically restore user's iPhone watchlist back to server!
    if (items.length === 0 && localItems.length > 0) {
      for (const it of localItems) {
        try {
          await apiFetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(it),
          });
        } catch {
          // Ignore individual restore failure
        }
      }
      const restored = await apiFetch("/api/watchlist").catch(() => ({ items: localItems }));
      items = restored.items?.length ? restored.items : localItems;
    } else {
      saveLocalWatchlist(items);
    }

    state.watchlist = items;
    updateWatchlistBadge();
    if (state.activeView === "watchlist") renderWatchlistView();
  } catch {
    state.watchlist = loadLocalWatchlist();
    updateWatchlistBadge();
    if (state.activeView === "watchlist") renderWatchlistView();
  }
}

function computeClientWatchlistBudget(items, folderFilter = "") {
  const r2 = (n) => Math.round(n * 100) / 100;
  const all = Array.isArray(items) ? items : [];
  const norm = (f) => String(f || "").trim() || "Diğer";

  const folderMap = new Map();
  for (const w of all) {
    const f = norm(w.folder);
    if (!folderMap.has(f)) {
      folderMap.set(f, { folder: f, count: 0, targetHits: 0, currentTotal: 0 });
    }
    const b = folderMap.get(f);
    b.count += 1;
    if (w.targetReached) b.targetHits += 1;
    if (typeof w.last_net_price === "number") b.currentTotal = r2(b.currentTotal + w.last_net_price);
  }
  for (const cf of state.customFolders || []) {
    const f = norm(cf);
    if (!folderMap.has(f)) {
      folderMap.set(f, { folder: f, count: 0, targetHits: 0, currentTotal: 0 });
    }
  }

  const folders = [...folderMap.values()].sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder, "tr"));
  const scoped = folderFilter ? all.filter((w) => norm(w.folder) === norm(folderFilter)) : all;

  let currentTotal = 0;
  let initialTotal = 0;
  let targetTotal = 0;
  let targetHits = 0;
  let itemsWithTarget = 0;

  for (const w of scoped) {
    const cur = typeof w.last_net_price === "number" ? w.last_net_price : 0;
    const init = typeof w.initial_net_price === "number" ? w.initial_net_price : cur;
    const hasTgt = typeof w.target_price === "number" && w.target_price > 0;
    const tgt = hasTgt ? w.target_price : cur;
    currentTotal = r2(currentTotal + cur);
    initialTotal = r2(initialTotal + init);
    targetTotal = r2(targetTotal + tgt);
    if (hasTgt) itemsWithTarget += 1;
    if (w.targetReached) targetHits += 1;
  }

  const netDelta = r2(currentTotal - initialTotal);
  const netDeltaPct = initialTotal > 0 ? r2((netDelta / initialTotal) * 100) : 0;
  const gapToTarget = r2(currentTotal - targetTotal);

  return {
    activeFolder: folderFilter || "Tümü",
    count: scoped.length,
    totalCount: all.length,
    currentTotal,
    initialTotal,
    targetTotal,
    netDelta,
    netDeltaPct,
    gapToTarget,
    itemsWithTarget,
    targetHits,
    folders,
    scoped,
  };
}

function renderWatchFakeDiscountBadge(w) {
  const st = w.fake_discount_status || "";
  const lbl = w.fake_discount_label || "";
  if (!st || st === "insufficient_history" || st === "stable") return "";
  if (st === "fake_discount" || st === "inflated") {
    return `<span class="mini-badge trap">${esc(lbl || "⚠ Sahte İndirim Riski")}</span>`;
  }
  if (st === "partial_discount") {
    return `<span class="mini-badge fast">${esc(lbl || "⚡ Kısmi İndirim")}</span>`;
  }
  if (st === "genuine_discount" || st === "market_deal") {
    return `<span class="mini-badge cheapest">${esc(lbl || "✓ Gerçek İndirim")}</span>`;
  }
  return "";
}

function renderPushAlertCard() {
  if (!els.pushAlertCard) return;
  const env = getPushEnvironment();
  els.pushAlertCard.hidden = false;

  if (env.needsHomeScreenInstall) {
    els.pushAlertCard.className = "push-alert-card ios-guide";
    els.pushAlertCard.innerHTML = `
      <div class="push-alert-copy">
        <span class="push-alert-icon" aria-hidden="true">🔔</span>
        <div>
          <p class="push-alert-title">iPhone Kilit Ekranı Bildirimleri (Telegramsız)</p>
          <p class="push-alert-desc">iPhone'da bildirim alabilmek için önce Safari alt menüsünden <strong>Paylaş (↑) → Ana Ekrana Ekle</strong> yapın, ardından ana ekrandaki FiyatRadar ikonundan açarak bildirimleri tek dokunuşla açın.</p>
        </div>
      </div>
    `;
    return;
  }

  if (!env.supported) {
    els.pushAlertCard.hidden = true;
    return;
  }

  if (state.pushSubscribed) {
    els.pushAlertCard.className = "push-alert-card active";
    els.pushAlertCard.innerHTML = `
      <div class="push-alert-copy">
        <span class="push-alert-icon" aria-hidden="true">✓</span>
        <div>
          <p class="push-alert-title">Kilit Ekranı Bildirimleri Aktif</p>
          <p class="push-alert-desc">Takip ettiğiniz bir ürün hedef fiyata indiğinde veya %10+ düştüğünde doğrudan cihazınıza bildirim düşer.</p>
        </div>
      </div>
      <div class="push-alert-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-push-action="test" ${state.pushBusy ? "disabled" : ""}>Test Bildirimi Gönder</button>
        <button type="button" class="btn btn-ghost btn-sm" data-push-action="disable" ${state.pushBusy ? "disabled" : ""}>Kapat</button>
      </div>
    `;
    return;
  }

  const denied = env.permission === "denied";
  els.pushAlertCard.className = `push-alert-card ${denied ? "ios-guide" : ""}`;
  els.pushAlertCard.innerHTML = `
    <div class="push-alert-copy">
      <span class="push-alert-icon" aria-hidden="true">🔔</span>
      <div>
        <p class="push-alert-title">iPhone / Cihaz Kilit Ekranı Bildirimleri</p>
        <p class="push-alert-desc">${
          denied
            ? "Bildirim izni kapalı görünüyor. iPhone Ayarlar > Bildirimler > FiyatRadar menüsünden izin verip tekrar deneyebilirsiniz."
            : "Hedef fiyata inen veya %10+ düşen ürünlerde Telegram gerekmeden doğrudan kilit ekranınıza anında haber gelsin."
        }</p>
      </div>
    </div>
    <div class="push-alert-actions">
      <button type="button" class="btn btn-primary btn-sm" data-push-action="enable" ${state.pushBusy ? "disabled" : ""}>
        ${state.pushBusy ? "Etkinleştiriliyor..." : "🔔 Bildirimleri Aç"}
      </button>
    </div>
  `;
}

function renderWatchlistView() {
  renderPushAlertCard();
  const list = state.watchlist;
  els.refreshWatchlistBtn.hidden = list.length === 0;

  // Reset active folder if it no longer exists in items or customFolders
  const allFolders = getAllWatchlistFolders();
  if (state.watchlistFolder && !allFolders.includes(state.watchlistFolder)) {
    state.watchlistFolder = "";
  }

  const summary = computeClientWatchlistBudget(list, state.watchlistFolder);

  // Render Folder Filter Bar whenever there are items or custom folders
  if (els.watchlistFolderBar) {
    if (list.length > 0 || (state.customFolders || []).length > 0) {
      els.watchlistFolderBar.hidden = false;
      els.watchlistFolderBar.innerHTML = `
        <button type="button" class="folder-pill ${!state.watchlistFolder ? "active" : ""}" data-watch-folder="">
          <span>Tümü</span>
          <span class="folder-count">${list.length}</span>
        </button>
        ${summary.folders
          .map(
            (f) => `
          <button type="button" class="folder-pill ${state.watchlistFolder === f.folder ? "active" : ""}" data-watch-folder="${esc(f.folder)}">
            <span>${esc(f.folder)}</span>
            <span class="folder-count">${f.count}</span>
            ${f.targetHits > 0 ? `<span class="folder-hit-dot" title="${f.targetHits} ürün hedef fiyatta">${f.targetHits}★</span>` : ""}
          </button>
        `
          )
          .join("")}
      `;
    } else {
      els.watchlistFolderBar.hidden = true;
      els.watchlistFolderBar.innerHTML = "";
    }
  }

  // Render Per-Folder / Overall Budget Summary Cards
  if (els.watchlistBudgetSummary) {
    if (list.length > 0) {
      const deltaClass = summary.netDelta < -0.5 ? "good" : summary.netDelta > 0.5 ? "bad" : "";
      const deltaSign = summary.netDelta > 0 ? "+" : "";
      const gapText =
        summary.itemsWithTarget > 0
          ? summary.gapToTarget <= 0
            ? "Hedef bütçenin altında!"
            : `Hedefe ${fmtTL(summary.gapToTarget)} kaldı`
          : "Ürünlere hedef fiyat girerek bütçe limiti belirleyin";

      els.watchlistBudgetSummary.hidden = false;
      els.watchlistBudgetSummary.innerHTML = `
        <div class="kpi-card budget-card">
          <div class="kpi-label">${esc(summary.activeFolder)} · Güncel Toplam</div>
          <div class="kpi-value mono">${fmtTL(summary.currentTotal)}</div>
          <div class="kpi-sub">${summary.count} takip edilen ürün</div>
        </div>
        <div class="kpi-card budget-card">
          <div class="kpi-label">Hedef Bütçe Toplamı</div>
          <div class="kpi-value mono">${fmtTL(summary.targetTotal)}</div>
          <div class="kpi-sub">${esc(gapText)}</div>
        </div>
        <div class="kpi-card budget-card">
          <div class="kpi-label">Takipten Beri Değişim</div>
          <div class="kpi-value mono ${deltaClass}">${summary.netDelta === 0 ? "0,00 TL" : `${deltaSign}${fmtTL(summary.netDelta)}`}</div>
          <div class="kpi-sub">${summary.netDelta === 0 ? "İlk kayıtla aynı seviyede" : `${fmtPct(summary.netDeltaPct)} net değişim`}</div>
        </div>
        <div class="kpi-card budget-card">
          <div class="kpi-label">Hedef Fiyat Alarmları</div>
          <div class="kpi-value ${summary.targetHits > 0 ? "good" : ""}">${summary.targetHits} / ${summary.itemsWithTarget}</div>
          <div class="kpi-sub">${summary.targetHits > 0 ? `${summary.targetHits} ürün alım hedefinize ulaştı!` : "Hedef bekleyen ürünler"}</div>
        </div>
      `;
    } else {
      els.watchlistBudgetSummary.hidden = true;
      els.watchlistBudgetSummary.innerHTML = "";
    }
  }

  if (!list.length) {
    els.watchlistContainer.innerHTML = `
      <div class="empty-state">
        <h3>Henüz takip ettiğiniz bir ürün yok</h3>
        <p>Herhangi bir ürünün analiz sayfasında klasör ve hedef fiyat belirleyip <strong>"Takibe Al"</strong> butonuna tıklayarak bütçenizi ve sahte indirimleri izleyebilirsiniz.</p>
      </div>`;
    return;
  }

  const visible = summary.scoped;
  if (!visible.length) {
    els.watchlistContainer.innerHTML = `
      <div class="empty-state">
        <h3>"${esc(state.watchlistFolder)}" klasörü henüz boş</h3>
        <p>Diğer klasörlerdeki ürünlerin sağındaki klasör menüsünden bu klasöre ürün taşıyabilir veya yeni ürün eklerken bu klasörü seçebilirsiniz.</p>
      </div>`;
    return;
  }

  els.watchlistContainer.innerHTML = `
    <div class="list-stack">
      ${visible
        .map((w) => {
          const itemFolder = String(w.folder || "").trim() || "Diğer";
          const delta =
            typeof w.priceChangeFromInitial === "number"
              ? w.priceChangeFromInitial
              : typeof w.last_net_price === "number" && typeof w.initial_net_price === "number"
                ? Math.round((w.last_net_price - w.initial_net_price) * 100) / 100
                : 0;
          const deltaPct =
            typeof w.priceChangeFromInitialPct === "number"
              ? w.priceChangeFromInitialPct
              : w.initial_net_price > 0
                ? Math.round((delta / w.initial_net_price) * 1000) / 10
                : 0;
          const deltaPill =
            Math.abs(delta) >= 1
              ? `<span class="watch-delta ${delta < 0 ? "down" : "up"}">${delta < 0 ? "↓" : "↑"} ${delta > 0 ? "+" : ""}${fmtTL(delta)} (${fmtPct(deltaPct)})</span>`
              : "";
          return `
        <div class="watch-card ${w.targetReached ? "target-hit" : ""}" data-watch-id="${esc(w.id)}">
          <img class="watch-thumb" src="${esc(w.image || "")}" alt="${esc(w.title)}" />
          <div>
            <div class="watch-badges-row">
              <span class="offer-pill">${esc(itemFolder)}</span>
              ${deltaPill}
              ${w.targetReached ? `<span class="mini-badge cheapest">✓ Hedef Fiyata Ulaştı!</span>` : ""}
              ${renderWatchFakeDiscountBadge(w)}
            </div>
            <h3 class="watch-title" data-open-watch="${esc(w.url)}" data-watch-title="${esc(w.title)}">${esc(w.title)}</h3>
            <div class="watch-metrics">
              <span>Güncel Net: <strong class="mono">${fmtTL(w.last_net_price)}</strong></span>
              ${w.target_price ? `<span>Hedef: <strong class="mono">${fmtTL(w.target_price)}</strong></span>` : ""}
              ${w.lowest_seen_price ? `<span>Görülen En Düşük: <strong class="mono">${fmtTL(w.lowest_seen_price)}</strong></span>` : ""}
              ${w.best_store ? `<span>Mağaza: <strong>${esc(w.best_store)}</strong></span>` : ""}
            </div>
            <div class="muted-text" style="font-size:0.76rem;">Son kontrol: ${fmtDateTime(w.updated_at)}</div>
          </div>
          <div class="watch-actions">
            <select class="select-sm watch-folder-select" data-folder-select="${esc(w.id)}" aria-label="Klasör değiştir" title="Klasöre taşı">
              ${allFolders
                .map((f) => `<option value="${esc(f)}" ${f === itemFolder ? "selected" : ""}>${esc(f)}</option>`)
                .join("")}
            </select>
            <input type="number" class="input-sm" data-target-input="${esc(w.id)}" value="${w.target_price ?? ""}" placeholder="Hedef TL" />
            <button type="button" class="btn btn-secondary btn-sm" data-save-target="${esc(w.id)}">Hedef Kaydet</button>
            <button type="button" class="btn btn-primary btn-sm" data-open-watch="${esc(w.url)}" data-watch-title="${esc(w.title)}">Analiz</button>
            <button type="button" class="btn btn-ghost btn-sm" data-delete-watch="${esc(w.id)}">Sil</button>
          </div>
        </div>`;
        })
        .join("")}
    </div>
  `;
}

async function loadHistory() {
  try {
    const res = await apiFetch("/api/history");
    state.history = res.items || [];
    renderHistoryView();
  } catch {
    // Non-fatal
  }
}

function renderHistoryView() {
  const list = state.history;
  els.clearHistoryBtn.hidden = list.length === 0;

  if (!list.length) {
    els.historyContainer.innerHTML = `
      <div class="empty-state">
        <h3>Arama geçmişiniz henüz boş</h3>
        <p>Yaptığınız ürün araştırmaları hızlı erişim için burada kaydedilir.</p>
      </div>`;
    return;
  }

  els.historyContainer.innerHTML = `
    <div class="history-grid">
      ${list
        .map(
          (h) => `
        <div class="history-card" data-history-query="${esc(h.query)}">
          <div class="history-query">${esc(h.query)}</div>
          <div class="muted-text" style="margin:0;">
            ${h.result_count} ürün · ${h.min_price ? `Başlangıç: ${fmtTL(h.min_price)}` : "Fiyat bilgisi yok"}
          </div>
          <div class="muted-text" style="font-size:0.74rem;margin:0;">${fmtDateTime(h.searched_at)}</div>
        </div>`
        )
        .join("")}
    </div>
  `;
}

// ============================================================================
// EVENT LISTENERS & INIT
// ============================================================================
function bindEvents() {
  // Top & Mobile bottom navigation
  document.querySelectorAll(".nav-tab, .mobile-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.view);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  $("brandLogo").addEventListener("click", (e) => {
    e.preventDefault();
    state.searchData = null;
    state.currentDetail = null;
    els.searchInput.value = "";
    els.clearSearchBtn.hidden = true;
    setStatus(null);
    switchView("search");
  });

  // Search form & autocomplete
  els.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    els.searchInput.blur(); // Dismiss iPhone keyboard on submit
    performSearch(els.searchInput.value);
  });

  els.searchInput.addEventListener("input", () => {
    const val = els.searchInput.value;
    els.clearSearchBtn.hidden = !val;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => fetchSuggestions(val), 220);
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (els.suggestList.hidden || !state.suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.suggestIndex = (state.suggestIndex + 1) % state.suggestions.length;
      renderSuggestions();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.suggestIndex = (state.suggestIndex - 1 + state.suggestions.length) % state.suggestions.length;
      renderSuggestions();
    } else if (e.key === "Enter" && state.suggestIndex >= 0) {
      e.preventDefault();
      const chosen = state.suggestions[state.suggestIndex];
      hideSuggestions();
      performSearch(chosen);
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });

  els.suggestList.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".suggest-item");
    if (!li) return;
    const chosen = state.suggestions[Number(li.dataset.idx)];
    if (chosen) performSearch(chosen);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-input-wrap")) hideSuggestions();
  });

  els.clearSearchBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    els.clearSearchBtn.hidden = true;
    hideSuggestions();
    els.searchInput.focus();
  });

  // Quick query chips
  $("quickQueries").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-query]");
    if (chip) performSearch(chip.dataset.query);
  });

  // Search sort & price filter
  els.searchSortSelect.addEventListener("change", () => {
    if (state.lastQuery) performSearch(state.lastQuery);
  });

  els.applyPriceFilterBtn.addEventListener("click", () => {
    if (state.lastQuery) performSearch(state.lastQuery);
  });

  // Quick store / accessory / free-shipping filter chips
  els.quickFilterBar?.addEventListener("click", (e) => {
    const qfBtn = e.target.closest("[data-qfilter]");
    if (qfBtn) {
      const key = qfBtn.dataset.qfilter;
      if (key === "reset") {
        state.searchFilters = {
          hideAccessories: false,
          hideListings: false,
          pricedOnly: false,
          officialOnly: false,
          freeShippingOnly: false,
          store: "",
          variantAttr: null,
        };
      } else if (key in state.searchFilters) {
        state.searchFilters[key] = !state.searchFilters[key];
      }
      renderSearchResults();
      return;
    }

    const storeBtn = e.target.closest("[data-qstore]");
    if (storeBtn) {
      const chosen = storeBtn.dataset.qstore;
      state.searchFilters.store = state.searchFilters.store === chosen ? "" : chosen;
      renderSearchResults();
    }
  });

  // Smart Capacity / Color / Size / Volume Variant Group Bar clicks
  els.variantGroupBar?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-vgroup][data-vval]");
    if (!chip) return;
    const group = chip.dataset.vgroup;
    const value = chip.dataset.vval;
    const cur = state.searchFilters.variantAttr;
    if (cur && cur.group === group && cur.value === value) {
      state.searchFilters.variantAttr = null;
    } else {
      state.searchFilters.variantAttr = { group, value };
    }
    renderSearchResults();
  });

  // Retail vs Second-Hand / Tagged (Dolap, Gardrops, sahibinden) mode switcher
  els.searchModeBar?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-search-mode]");
    if (!btn) return;
    const nextMode = btn.dataset.searchMode === "secondhand" ? "secondhand" : "retail";
    if (state.searchMode === nextMode) return;
    state.searchMode = nextMode;
    renderSearchResults();
    if (nextMode === "secondhand") {
      loadSecondHandResults(false);
    }
  });

  els.secondHandPanel?.addEventListener("click", (e) => {
    if (e.target.closest("[data-refresh-secondhand]")) {
      loadSecondHandResults(true);
      return;
    }
    if (e.target.closest("[data-open-settings]")) {
      openSettingsModal();
    }
  });

  // OLED Dark Mode toggle
  els.themeToggleBtn?.addEventListener("click", toggleTheme);

  // Turkish Voice Search (Web Speech API)
  els.voiceSearchBtn?.addEventListener("click", handleVoiceToggle);

  // Screenshot / Photo Product Search (Client-Side OCR)
  els.photoSearchBtn?.addEventListener("click", () => {
    if (els.photoSearchInput) {
      els.photoSearchInput.value = "";
      els.photoSearchInput.click();
    }
  });

  els.photoSearchInput?.addEventListener("change", () => {
    const file = els.photoSearchInput.files?.[0];
    if (file) openPhotoSearchWithFile(file);
  });

  // Also support pasting a screenshot directly into the search box (Desktop / iPad)
  els.searchInput?.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          openPhotoSearchWithFile(file);
          return;
        }
      }
    }
  });

  els.closePhotoModalBtn?.addEventListener("click", closePhotoModal);
  els.photoSearchModal?.addEventListener("click", (e) => {
    if (e.target === els.photoSearchModal) closePhotoModal();
  });
  els.pickAnotherPhotoBtn?.addEventListener("click", () => {
    if (els.photoSearchInput) {
      els.photoSearchInput.value = "";
      els.photoSearchInput.click();
    }
  });
  els.photoCandidatesList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ocr-candidate]");
    if (btn && els.photoQueryInput) {
      els.photoQueryInput.value = btn.dataset.ocrCandidate;
      els.photoQueryInput.focus();
    }
  });
  els.photoSearchConfirmForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = (els.photoQueryInput?.value || "").trim();
    if (!q) return;
    closePhotoModal();
    performSearch(q);
  });

  // Results grid click delegation
  els.resultsGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".product-card");
    if (!card || !state.searchData) return;
    const url = card.dataset.url;
    const product = state.searchData.products.find((p) => p.url === url);
    if (!product) return;

    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === "open-detail") {
      openProductDetail(product.url, false, product.title);
    } else if (action === "toggle-compare") {
      toggleCompareItem(product);
    } else if (action === "toggle-cart") {
      toggleCartItem(product);
    }
  });

  // Detail top-bar buttons
  els.backToResultsBtn.addEventListener("click", () => {
    switchView("search");
  });

  els.detailCartToggleBtn?.addEventListener("click", () => {
    if (state.currentDetail) toggleCartItem(state.currentDetail);
  });

  // WhatsApp / iMessage Visual PNG Price Card modal
  els.detailShareCardBtn?.addEventListener("click", () => {
    if (state.currentDetail) openShareCardModal();
  });
  els.closeShareCardBtn?.addEventListener("click", closeShareCardModal);
  els.shareCardModal?.addEventListener("click", (e) => {
    if (e.target === els.shareCardModal) closeShareCardModal();
  });
  els.shareCardThemePills?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-card-theme]");
    if (!btn) return;
    const theme = btn.dataset.cardTheme === "dark" ? "dark" : "light";
    renderShareCardPreview(theme);
  });
  els.downloadShareCardBtn?.addEventListener("click", downloadCurrentShareCard);
  els.nativeShareCardBtn?.addEventListener("click", async () => {
    const sc = state.shareCard;
    if (!sc.blob || !state.currentDetail) return;
    const outcome = await sharePriceCardBlob(sc.blob, sc.filename, state.currentDetail);
    if (outcome === "shared") {
      showToast("Görsel fiyat kartı paylaşıldı!");
    } else if (outcome === "unsupported") {
      downloadCurrentShareCard();
      showToast("Görsel kart PNG olarak indirildi; WhatsApp'tan kolayca gönderebilirsiniz.");
    }
  });

  els.detailShareBtn?.addEventListener("click", async () => {
    const d = state.currentDetail;
    if (!d) return;
    const best = d.picks?.cheapestNet;
    const shareText = [
      `${d.title}`,
      best ? `Kargo Dahil En Ucuz: ${fmtTL(best.netPrice)} (${best.store} · ${best.shippingLabel})` : "",
      d.verdict ? `Alım Skoru: ${d.verdict.score}/100 (${d.verdict.label})` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const shareUrl = best?.url || d.url;

    if (navigator.share) {
      try {
        await navigator.share({ title: d.title, text: shareText, url: shareUrl });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      showToast("Fiyat özeti panoya kopyalandı.");
    } catch {
      showToast("Paylaşım bu tarayıcıda desteklenmiyor.");
    }
  });

  els.detailCompareToggleBtn.addEventListener("click", () => {
    if (state.currentDetail) toggleCompareItem(state.currentDetail);
  });

  els.detailRefreshBtn.addEventListener("click", () => {
    if (state.currentDetail) openProductDetail(state.currentDetail.url, true, state.currentDetail.title);
  });

  els.exportCsvBtn.addEventListener("click", async () => {
    const d = state.currentDetail;
    if (!d) return;
    showToast("CSV (Excel uyumlu) raporu hazırlanıyor...");
    try {
      const { serperKey, serpApiKey } = getStoredApiKeys();
      const headers = new Headers();
      if (serperKey) headers.set("X-Serper-Key", serperKey);
      if (serpApiKey) headers.set("X-SerpApi-Key", serpApiKey);

      const params = new URLSearchParams({ url: d.url });
      if (d.title) params.set("title", d.title);

      const res = await fetch(`/api/export/csv?${params.toString()}`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `CSV oluşturulamadı (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `fiyatradar-${(d.id || "rapor").replace(/[^a-zA-Z0-9_-]/g, "")}.csv`;
      a.click();
      URL.revokeObjectURL(dlUrl);
      showToast("CSV (Excel uyumlu) raporu indirildi.");
    } catch (err) {
      showToast(`Hata: ${err.message}`);
    }
  });

  els.exportJsonBtn.addEventListener("click", () => {
    if (!state.currentDetail) return;
    const blob = new Blob([JSON.stringify(state.currentDetail, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fiyatradar-${state.currentDetail.id || "rapor"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("JSON analiz raporu indirildi.");
  });

  els.printReportBtn.addEventListener("click", () => window.print());

  // Barcode Scanner Modal handlers
  els.openScannerBtn?.addEventListener("click", openScannerModal);
  els.closeScannerBtn?.addEventListener("click", closeScannerModal);
  els.scannerModal?.addEventListener("click", (e) => {
    if (e.target === els.scannerModal) closeScannerModal();
  });
  els.manualBarcodeForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = (els.manualBarcodeInput?.value || "").trim();
    if (!raw) return;
    closeScannerModal();
    lookupBarcode(raw);
  });

  // Shopping Cart Cost Optimizer actions
  els.cartItemsContainer?.addEventListener("click", (e) => {
    const openEl = e.target.closest("[data-open-cart-item]");
    if (openEl) {
      openProductDetail(openEl.dataset.openCartItem, false, openEl.dataset.cartTitle || "");
      return;
    }

    const decBtn = e.target.closest("[data-cart-dec]");
    if (decBtn) {
      const idx = Number.parseInt(decBtn.dataset.cartDec, 10);
      if (state.cart[idx]) {
        state.cart[idx].quantity = Math.max(1, (state.cart[idx].quantity || 1) - 1);
        state.cartPlan = null;
        saveLocalCart();
        renderCartView();
      }
      return;
    }

    const incBtn = e.target.closest("[data-cart-inc]");
    if (incBtn) {
      const idx = Number.parseInt(incBtn.dataset.cartInc, 10);
      if (state.cart[idx]) {
        state.cart[idx].quantity = Math.min(20, (state.cart[idx].quantity || 1) + 1);
        state.cartPlan = null;
        saveLocalCart();
        renderCartView();
      }
      return;
    }

    const remBtn = e.target.closest("[data-cart-remove]");
    if (remBtn) {
      const idx = Number.parseInt(remBtn.dataset.cartRemove, 10);
      if (idx >= 0 && idx < state.cart.length) {
        state.cart.splice(idx, 1);
        state.cartPlan = null;
        saveLocalCart();
        renderCartView();
        showToast("Ürün sepetten çıkarıldı.");
      }
    }
  });

  els.optimizeCartBtn?.addEventListener("click", () => runCartOptimize());

  els.clearCartBtn?.addEventListener("click", () => {
    state.cart = [];
    state.cartPlan = null;
    saveLocalCart();
    renderCartView();
    showToast("Sepet temizlendi.");
  });

  // Compare view buttons
  els.compareBasketBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-compare]");
    if (!btn) return;
    state.compareBasket = state.compareBasket.filter((b) => b.url !== btn.dataset.removeCompare);
    state.compareResult = null;
    saveLocalCompare();
    renderCompareView();
  });

  els.runCompareBtn.addEventListener("click", () => runSideBySideCompare());

  els.clearCompareBtn.addEventListener("click", () => {
    state.compareBasket = [];
    state.compareResult = null;
    saveLocalCompare();
    renderCompareView();
  });

  els.floatingClearBtn.addEventListener("click", () => {
    state.compareBasket = [];
    state.compareResult = null;
    saveLocalCompare();
    if (state.activeView === "search") renderSearchResults();
  });

  els.floatingOpenBtn.addEventListener("click", () => switchView("compare"));

  // Watchlist actions
  els.watchlistContainer.addEventListener("click", async (e) => {
    const openEl = e.target.closest("[data-open-watch]");
    if (openEl) {
      openProductDetail(openEl.dataset.openWatch, false, openEl.dataset.watchTitle || "");
      return;
    }

    const saveBtn = e.target.closest("[data-save-target]");
    if (saveBtn) {
      const id = saveBtn.dataset.saveTarget;
      const input = els.watchlistContainer.querySelector(`[data-target-input="${CSS.escape(id)}"]`);
      const val = input?.value.trim() ? Number.parseFloat(input.value) : null;
      try {
        const res = await apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_price: val }),
        });
        state.watchlist = res.items || [];
        saveLocalWatchlist(state.watchlist);
        renderWatchlistView();
        showToast("Hedef fiyat güncellendi.");
      } catch (err) {
        showToast(`Hata: ${err.message}`);
      }
      return;
    }

    const delBtn = e.target.closest("[data-delete-watch]");
    if (delBtn) {
      const id = delBtn.dataset.deleteWatch;
      try {
        const res = await apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
        state.watchlist = res.items || [];
        saveLocalWatchlist(state.watchlist);
        updateWatchlistBadge();
        renderWatchlistView();
        showToast("Ürün takip listesinden kaldırıldı.");
      } catch (err) {
        showToast(`Hata: ${err.message}`);
      }
    }
  });

  // Inline folder move selector on each watchlist card
  els.watchlistContainer.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-folder-select]");
    if (!sel) return;
    const id = sel.dataset.folderSelect;
    const folder = (sel.value || "").trim() || "Diğer";
    try {
      const res = await apiFetch(`/api/watchlist/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      state.watchlist = res.items || [];
      saveLocalWatchlist(state.watchlist);
      renderWatchlistView();
      showToast(`Ürün "${folder}" klasörüne taşındı.`);
    } catch (err) {
      showToast(`Hata: ${err.message}`);
    }
  });

  // Watchlist folder filter bar
  els.watchlistFolderBar?.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-watch-folder]");
    if (!pill) return;
    state.watchlistFolder = pill.dataset.watchFolder || "";
    renderWatchlistView();
  });

  // Create custom watchlist folder (e.g. "Çeyiz", "Hediye", "Kışlık")
  els.newFolderBtn?.addEventListener("click", () => {
    const raw = window.prompt("Yeni takip klasörü adı (örn. Çeyiz, Hediye, Kışlık):");
    if (!raw) return;
    const clean = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean) return;
    const existing = getAllWatchlistFolders();
    const match = existing.find((f) => f.toLocaleLowerCase("tr-TR") === clean.toLocaleLowerCase("tr-TR"));
    if (match) {
      state.watchlistFolder = match;
      renderWatchlistView();
      showToast(`"${match}" klasörü zaten mevcut.`);
      return;
    }
    state.customFolders = [...(state.customFolders || []), clean];
    saveLocalCustomFolders();
    state.watchlistFolder = clean;
    renderWatchlistView();
    showToast(`"${clean}" klasörü oluşturuldu.`);
  });

  // Native iOS / Desktop Web Push alert controls (Watchlist view)
  els.pushAlertCard?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-push-action]");
    if (!btn || state.pushBusy) return;
    const action = btn.dataset.pushAction;
    state.pushBusy = true;
    renderPushAlertCard();
    try {
      if (action === "enable") {
        await subscribeToPush(apiFetch);
        state.pushSubscribed = true;
        showToast("✓ Kilit ekranı bildirimleri aktifleştirildi!");
      } else if (action === "test") {
        await sendTestPush(apiFetch);
        showToast("Test bildirimi gönderildi — kilit ekranınızı veya bildirim çubuğunuzu kontrol edin.");
      } else if (action === "disable") {
        await unsubscribeFromPush(apiFetch);
        state.pushSubscribed = false;
        showToast("Kilit ekranı bildirimleri kapatıldı.");
      }
    } catch (err) {
      showToast(err.message || "Bildirim işlemi tamamlanamadı.");
    } finally {
      state.pushBusy = false;
      renderPushAlertCard();
    }
  });

  els.refreshWatchlistBtn.addEventListener("click", async () => {
    els.refreshWatchlistBtn.disabled = true;
    setStatus("loading", "Takip listesindeki tüm ürünlerin canlı fiyatları güncelleniyor...");
    try {
      const res = await apiFetch("/api/watchlist/refresh", { method: "POST" });
      state.watchlist = res.items || [];
      saveLocalWatchlist(state.watchlist);
      // Record refreshed live prices into iPhone's personal price history snapshots
      for (const w of state.watchlist) {
        if (w.url && typeof w.last_net_price === "number" && w.last_net_price > 0) {
          recordLocalSnapshot(w.url, w.last_net_price);
        }
      }
      setStatus(null);
      renderWatchlistView();
      const hits = state.watchlist.filter((w) => w.targetReached).length;
      const pushNote = res.pushSentCount > 0 ? " (Bildirim gönderildi!)" : "";
      showToast(
        hits > 0
          ? `Fiyatlar güncellendi! ${hits} ürün hedef fiyatınıza ulaştı.${pushNote}`
          : `Tüm takip edilen ürünlerin fiyatları güncellendi.${pushNote}`
      );
    } catch (err) {
      setStatus("error", err.message);
    } finally {
      els.refreshWatchlistBtn.disabled = false;
    }
  });

  // History actions
  els.historyContainer.addEventListener("click", (e) => {
    const card = e.target.closest("[data-history-query]");
    if (card) performSearch(card.dataset.historyQuery);
  });

  els.clearHistoryBtn.addEventListener("click", async () => {
    await apiFetch("/api/history", { method: "DELETE" });
    state.history = [];
    renderHistoryView();
    showToast("Arama geçmişi temizlendi.");
  });

  // iOS Safari Install Guide Banner dismiss
  els.dismissIosBannerBtn?.addEventListener("click", () => {
    els.iosInstallBanner.hidden = true;
    try {
      localStorage.setItem("fiyatradar_ios_banner_dismissed", "1");
    } catch {
      // Ignore
    }
  });

  // Apple Shortcuts & Haptic Touch Modal handlers
  els.openShortcutsBtn?.addEventListener("click", openShortcutsModal);
  els.closeShortcutsBtn?.addEventListener("click", closeShortcutsModal);
  els.shortcutsModal?.addEventListener("click", (e) => {
    if (e.target === els.shortcutsModal) closeShortcutsModal();
  });
  els.copyShortcutShareUrlBtn?.addEventListener("click", () => {
    const val = els.shortcutShareBaseUrl?.textContent || "";
    copyTextWithFeedback(val, "Paylaşım kestirme adresi kopyalandı!");
  });
  els.copyShortcutApiUrlBtn?.addEventListener("click", () => {
    const val = els.shortcutApiBaseUrl?.textContent || "";
    copyTextWithFeedback(val, "Hızlı API adresi kopyalandı!");
  });
  els.shortcutQuickGrid?.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy-shortcut]");
    if (copyBtn) {
      copyTextWithFeedback(copyBtn.dataset.copyShortcut, "Kestirme bağlantısı kopyalandı!");
      return;
    }
    const runBtn = e.target.closest("[data-run-shortcut]");
    if (runBtn) {
      closeShortcutsModal();
      handleLaunchUrl(runBtn.dataset.runShortcut);
    }
  });

  // Settings Modal handlers
  els.openSettingsBtn?.addEventListener("click", openSettingsModal);
  els.closeSettingsBtn?.addEventListener("click", closeSettingsModal);
  els.settingsModal?.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
  });

  // Escape key closes open modals cleanly
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (els.scannerModal && !els.scannerModal.hidden) closeScannerModal();
      if (els.photoSearchModal && !els.photoSearchModal.hidden) closePhotoModal();
      if (els.shareCardModal && !els.shareCardModal.hidden) closeShareCardModal();
      if (els.shortcutsModal && !els.shortcutsModal.hidden) closeShortcutsModal();
      if (els.settingsModal && !els.settingsModal.hidden) closeSettingsModal();
    }
  });

  els.settingsForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const serper = (els.serperKeyInput?.value || "").trim();
    const serpApi = (els.serpApiKeyInput?.value || "").trim();
    try {
      if (serper) localStorage.setItem("fiyatradar_serper_key", serper);
      else localStorage.removeItem("fiyatradar_serper_key");
      if (serpApi) localStorage.setItem("fiyatradar_serpapi_key", serpApi);
      else localStorage.removeItem("fiyatradar_serpapi_key");
    } catch {
      // Ignore
    }
    updateApiStatusDot();
    closeSettingsModal();
    showToast(serper || serpApi ? "Google Türkiye (70+ Mağaza) aktif edildi!" : "API anahtarları temizlendi.");
    if (state.lastQuery) performSearch(state.lastQuery, { refresh: true });
  });

  $("testApiKeyBtn")?.addEventListener("click", async () => {
    const key = (els.serperKeyInput?.value || "").trim();
    const statusEl = $("settingsTestStatus");
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.style.color = "var(--ink-secondary)";
    statusEl.textContent = "Serper bağlantısı test ediliyor...";
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serperKey: key }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Doğrulama başarısız");
      statusEl.style.color = "var(--good)";
      statusEl.textContent = `✓ Bağlantı başarılı! Google Türkiye araması çalışıyor (${data.sampleCount} test sonucu alındı). Şimdi "Kaydet ve Aktifleştir"e dokunun.`;
    } catch (err) {
      statusEl.style.color = "var(--bad)";
      statusEl.textContent = `✗ ${err.message}`;
    }
  });

  els.clearApiKeysBtn?.addEventListener("click", () => {
    if (els.serperKeyInput) els.serperKeyInput.value = "";
    if (els.serpApiKeyInput) els.serpApiKeyInput.value = "";
    const statusEl = $("settingsTestStatus");
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }
    try {
      localStorage.removeItem("fiyatradar_serper_key");
      localStorage.removeItem("fiyatradar_serpapi_key");
    } catch {
      // Ignore
    }
    updateApiStatusDot();
    showToast("Kayıtlı API anahtarları temizlendi.");
  });
}

// ============================================================================
// OLED DARK MODE, VOICE SEARCH, PHOTO OCR & PNG SHARE CARD CONTROLLERS
// ============================================================================
function applyTheme(mode, persist = false) {
  const isDark = mode === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  if (els.themeColorMeta) {
    els.themeColorMeta.setAttribute("content", isDark ? "#0b0d12" : "#f7f6f2");
  }
  if (els.themeIconMoon) els.themeIconMoon.hidden = isDark;
  if (els.themeIconSun) els.themeIconSun.hidden = !isDark;
  if (persist) {
    try {
      localStorage.setItem("fiyatradar_theme", isDark ? "dark" : "light");
    } catch {
      // Ignore
    }
  }
  // Re-render SVG chart so gridlines & axis labels adapt immediately
  if (state.activeView === "detail" && state.currentDetail && $("priceChartMount")) {
    renderPriceChart($("priceChartMount"), state.currentDetail.history, state.chartRange);
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next, true);
  showToast(next === "dark" ? "Karanlık Mod (OLED) açıldı." : "Aydınlık Mod açıldı.");
}

function initTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(current, false);
  // Follow iOS system theme live if user has not manually locked a theme
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", (e) => {
      try {
        if (!localStorage.getItem("fiyatradar_theme")) {
          applyTheme(e.matches ? "dark" : "light", false);
        }
      } catch {
        // Ignore
      }
    });
  }
}

function handleVoiceToggle() {
  if (state.isListening) {
    stopVoiceSearch();
    state.isListening = false;
    els.voiceSearchBtn?.classList.remove("listening");
    setStatus(null);
    return;
  }

  if (!isVoiceSearchSupported()) {
    showToast("Sesli arama bu tarayıcıda desteklenmiyor. iPhone Safari veya Chrome kullanabilirsiniz.");
    return;
  }

  startVoiceSearch({
    onStart: () => {
      state.isListening = true;
      els.voiceSearchBtn?.classList.add("listening");
      setStatus("loading", "Dinleniyor... Aramak istediğiniz ürün adını söyleyin (örn. 'iPhone 17 256 GB')");
    },
    onInterim: (text) => {
      els.searchInput.value = text;
      els.clearSearchBtn.hidden = !text;
    },
    onResult: (finalText) => {
      state.isListening = false;
      els.voiceSearchBtn?.classList.remove("listening");
      setStatus(null);
      if (finalText) {
        els.searchInput.value = finalText;
        els.clearSearchBtn.hidden = false;
        performSearch(finalText);
      }
    },
    onError: (msg) => {
      state.isListening = false;
      els.voiceSearchBtn?.classList.remove("listening");
      setStatus(null);
      showToast(msg);
    },
    onEnd: () => {
      state.isListening = false;
      els.voiceSearchBtn?.classList.remove("listening");
    },
  });
}

async function openPhotoSearchWithFile(file) {
  if (!els.photoSearchModal) return;
  els.photoSearchModal.hidden = false;
  els.photoPreviewImg.hidden = true;
  els.photoProgressWrap.hidden = false;
  els.photoProgressBar.style.width = "8%";
  els.photoStatusText.textContent = "Görsel yükleniyor...";
  els.photoCandidatesWrap.hidden = true;
  els.photoCandidatesList.innerHTML = "";
  els.photoQueryInput.value = "";
  if (els.photoConfirmSearchBtn) els.photoConfirmSearchBtn.disabled = true;

  try {
    const res = await extractProductFromImageFile(file, (msg, pct) => {
      els.photoStatusText.textContent = msg;
      els.photoProgressBar.style.width = `${Math.max(8, Math.min(100, pct || 0))}%`;
    });

    if (res.previewDataUrl) {
      els.photoPreviewImg.src = res.previewDataUrl;
      els.photoPreviewImg.hidden = false;
    }

    els.photoProgressBar.style.width = "100%";
    els.photoStatusText.textContent = res.bestQuery
      ? "✓ Ürün metni okundu. Gerekirse düzenleyip 'Tüm Türkiye'de Ara'ya dokunun."
      : "Görselden net ürün adı seçilemedi; ürün adını aşağıya yazıp arayabilirsiniz.";

    if (res.candidates?.length) {
      els.photoCandidatesWrap.hidden = false;
      els.photoCandidatesList.innerHTML = res.candidates
        .map(
          (c) =>
            `<button type="button" class="photo-candidate-chip" data-ocr-candidate="${esc(c)}" title="${esc(c)}">${esc(c)}</button>`
        )
        .join("");
    }

    els.photoQueryInput.value = res.bestQuery || "";
    if (els.photoConfirmSearchBtn) els.photoConfirmSearchBtn.disabled = false;
    if (res.bestQuery) els.photoQueryInput.focus();
  } catch (err) {
    els.photoProgressWrap.hidden = false;
    els.photoProgressBar.style.width = "0%";
    els.photoStatusText.textContent = `✗ ${err.message || "Görsel okunamadı."}`;
    if (els.photoConfirmSearchBtn) els.photoConfirmSearchBtn.disabled = false;
  }
}

function closePhotoModal() {
  if (els.photoSearchModal) els.photoSearchModal.hidden = true;
}

function openShareCardModal() {
  if (!els.shareCardModal || !state.currentDetail) return;
  els.shareCardModal.hidden = false;
  const defaultTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  renderShareCardPreview(defaultTheme);
}

async function renderShareCardPreview(theme) {
  if (!state.currentDetail) return;
  state.shareCard = { blob: null, dataUrl: "", filename: "", theme };

  els.shareCardThemePills?.querySelectorAll("[data-card-theme]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cardTheme === theme);
  });

  if (els.shareCardLoading) {
    els.shareCardLoading.hidden = false;
    els.shareCardLoading.textContent = "Yüksek çözünürlüklü fiyat kartı oluşturuluyor...";
  }
  if (els.shareCardImg) els.shareCardImg.hidden = true;
  if (els.downloadShareCardBtn) els.downloadShareCardBtn.disabled = true;
  if (els.nativeShareCardBtn) els.nativeShareCardBtn.disabled = true;

  try {
    const result = await generatePriceCard(state.currentDetail, { theme });
    state.shareCard = { ...result, theme };
    if (els.shareCardImg) {
      els.shareCardImg.src = result.dataUrl;
      els.shareCardImg.hidden = false;
    }
    if (els.shareCardLoading) els.shareCardLoading.hidden = true;
    if (els.downloadShareCardBtn) els.downloadShareCardBtn.disabled = false;
    if (els.nativeShareCardBtn) els.nativeShareCardBtn.disabled = false;
  } catch (err) {
    if (els.shareCardLoading) {
      els.shareCardLoading.hidden = false;
      els.shareCardLoading.textContent = `Kart oluşturulamadı: ${err.message}`;
    }
  }
}

function downloadCurrentShareCard() {
  const sc = state.shareCard;
  if (!sc.dataUrl) return;
  const a = document.createElement("a");
  a.href = sc.dataUrl;
  a.download = sc.filename || "fiyatradar-kart.png";
  a.click();
  showToast("Görsel fiyat kartı (PNG) indirildi.");
}

function closeShareCardModal() {
  if (els.shareCardModal) els.shareCardModal.hidden = true;
}

async function copyTextWithFeedback(text, successMsg) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg || "Panoya kopyalandı.");
  } catch {
    showToast("Kopyalama desteklenmiyor; adresi manuel seçebilirsiniz.");
  }
}

function openShortcutsModal() {
  if (!els.shortcutsModal) return;
  const origin = window.location.origin;
  if (els.shortcutShareBaseUrl) {
    els.shortcutShareBaseUrl.textContent = `${origin}/share?text=`;
  }
  if (els.shortcutApiBaseUrl) {
    els.shortcutApiBaseUrl.textContent = `${origin}/api/shortcut-search?text=`;
  }
  if (els.shortcutQuickGrid) {
    const actions = [
      {
        title: "📷 Barkod Tara",
        desc: "Mağazada barkod okutup anında kıyasla",
        path: "/?action=scan",
      },
      {
        title: "🎙️ Sesli Ara",
        desc: "Türkçe sesle doğrudan ürün arat",
        path: "/?action=voice",
      },
      {
        title: "🛒 Sepet Optimizatörü",
        desc: "Tek mağaza vs karışık sepet kargo hesabı",
        path: "/?view=cart",
      },
      {
        title: "🔔 Takip Listem",
        desc: "Klasörler, bütçe ve hedef fiyat alarmları",
        path: "/?view=watchlist",
      },
    ];
    els.shortcutQuickGrid.innerHTML = actions
      .map((a) => {
        const full = `${origin}${a.path}`;
        return `
        <div class="shortcut-action-card">
          <strong>${esc(a.title)}</strong>
          <span>${esc(a.desc)}</span>
          <div class="shortcut-action-btns">
            <button type="button" class="btn btn-secondary btn-sm" data-copy-shortcut="${esc(full)}">Kopyala</button>
            <button type="button" class="btn btn-ghost btn-sm" data-run-shortcut="${esc(full)}">Şimdi Dene</button>
          </div>
        </div>`;
      })
      .join("");
  }
  els.shortcutsModal.hidden = false;
}

function closeShortcutsModal() {
  if (els.shortcutsModal) els.shortcutsModal.hidden = true;
}

function extractUrlFromSharedText(str) {
  const txt = String(str || "").trim();
  const m = txt.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0].replace(/[),.;!?]+$/, "") : txt;
}

/**
 * Handles iOS Home-Screen long-press shortcuts (/?action=scan|voice|photo, /?view=cart|watchlist),
 * Apple Shortcuts / Share Sheet links (/?q=..., /?url=..., /?text=...),
 * and iPhone Lock-Screen Push Notification clicks (/?product=...&title=...).
 */
function handleLaunchUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl, window.location.origin);
  } catch {
    return;
  }
  const sp = u.searchParams;
  const productUrl = sp.get("product");
  const productTitle = sp.get("title") || "";
  const queryParam = sp.get("q") || sp.get("url") || sp.get("text") || "";
  const action = (sp.get("action") || "").toLowerCase();
  const view = (sp.get("view") || "").toLowerCase();

  // Clean query params from browser URL bar without reload
  if (rawUrl === window.location.href && (productUrl || queryParam || action || view || sp.get("from"))) {
    try {
      window.history.replaceState({}, "", "/");
    } catch {
      // Ignore
    }
  }

  if (productUrl) {
    openProductDetail(productUrl, false, productTitle);
    return;
  }

  if (queryParam) {
    const cleanQ = extractUrlFromSharedText(queryParam);
    if (cleanQ) {
      performSearch(cleanQ);
      return;
    }
  }

  if (action === "scan") {
    switchView("search");
    setTimeout(() => openScannerModal(), 150);
    return;
  }
  if (action === "voice") {
    switchView("search");
    setTimeout(() => handleVoiceToggle(), 220);
    return;
  }
  if (action === "photo") {
    switchView("search");
    setTimeout(() => els.photoSearchInput?.click(), 180);
    return;
  }

  if (["compare", "cart", "watchlist", "history", "search"].includes(view)) {
    switchView(view);
  }
}

async function initPushClient() {
  try {
    const existing = await getCurrentPushSubscription();
    state.pushSubscribed = Boolean(existing);
    if (state.activeView === "watchlist") renderPushAlertCard();
    if (existing) {
      const synced = await syncExistingPushSubscription(apiFetch);
      state.pushSubscribed = Boolean(synced);
      if (state.activeView === "watchlist") renderPushAlertCard();
    }
  } catch {
    // Non-fatal
  }
}

function openSettingsModal() {
  if (!els.settingsModal) return;
  const { serperKey, serpApiKey } = getStoredApiKeys();
  if (els.serperKeyInput) els.serperKeyInput.value = serperKey;
  if (els.serpApiKeyInput) els.serpApiKeyInput.value = serpApiKey;
  const statusEl = $("settingsTestStatus");
  if (statusEl) statusEl.hidden = true;
  els.settingsModal.hidden = false;
}

function closeSettingsModal() {
  if (els.settingsModal) els.settingsModal.hidden = true;
}

function initPwa() {
  // Register Service Worker & handle Lock-Screen Push Notification clicks while app is open
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "FIYATRADAR_NAVIGATE" && event.data?.url) {
        handleLaunchUrl(event.data.url);
      }
    });
  }

  // Clear iOS Home-Screen notification badge when user opens the app
  if (typeof navigator.clearAppBadge === "function") {
    navigator.clearAppBadge().catch(() => {});
  }

  // Show smart install guide ONLY on iOS Safari when not yet added to Home Screen
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  const dismissed = localStorage.getItem("fiyatradar_ios_banner_dismissed") === "1";

  if (isIos && !isStandalone && !dismissed && els.iosInstallBanner) {
    setTimeout(() => {
      els.iosInstallBanner.hidden = false;
    }, 1200);
  }
}

// Boot
initTheme();
bindEvents();
initPwa();
updateCompareBadges();
updateCartBadges();
updateApiStatusDot();
apiFetch("/api/providers")
  .then((p) => updateApiStatusDot(Boolean(p.googleShoppingReady)))
  .catch(() => {});
loadWatchlist();
initPushClient();
handleLaunchUrl(window.location.href);
