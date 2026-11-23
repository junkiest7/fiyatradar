/**
 * FiyatRadar — Frontend SPA Controller
 * Handles live search, autocomplete, deep multi-store offer analysis,
 * shipping-trap alerts, interactive 6-month price chart, side-by-side comparison,
 * SQLite-backed watchlist & target price alerts, and CSV/JSON export.
 */

import { renderPriceChart } from "./chart.js";

const state = {
  activeView: "search", // 'search' | 'detail' | 'compare' | 'watchlist' | 'history'
  lastQuery: "",
  searchData: null,
  currentDetail: null,
  chartRange: "all",
  offerSort: "net_asc",
  offerFilters: {
    freeShippingOnly: false,
    inStockOnly: false,
    hideOutliers: false,
    storeSearch: "",
  },
  compareBasket: loadLocalCompare(), // [{ id, title, url, image, lowestPrice }]
  compareResult: null,
  watchlist: [],
  history: [],
  suggestIndex: -1,
  suggestions: [],
};

// DOM Elements
const $ = (id) => document.getElementById(id);

const els = {
  searchHero: $("searchHero"),
  searchForm: $("searchForm"),
  searchInput: $("searchInput"),
  clearSearchBtn: $("clearSearchBtn"),
  suggestList: $("suggestList"),
  statusBanner: $("statusBanner"),
  viewSearch: $("viewSearch"),
  viewDetail: $("viewDetail"),
  viewCompare: $("viewCompare"),
  viewWatchlist: $("viewWatchlist"),
  viewHistory: $("viewHistory"),
  resultsHeading: $("resultsHeading"),
  resultsSubmeta: $("resultsSubmeta"),
  resultsGrid: $("resultsGrid"),
  searchSortSelect: $("searchSortSelect"),
  filterMinPrice: $("filterMinPrice"),
  filterMaxPrice: $("filterMaxPrice"),
  applyPriceFilterBtn: $("applyPriceFilterBtn"),
  detailContainer: $("detailContainer"),
  detailShareBtn: $("detailShareBtn"),
  detailCompareToggleBtn: $("detailCompareToggleBtn"),
  detailRefreshBtn: $("detailRefreshBtn"),
  exportCsvBtn: $("exportCsvBtn"),
  exportJsonBtn: $("exportJsonBtn"),
  printReportBtn: $("printReportBtn"),
  backToResultsBtn: $("backToResultsBtn"),
  compareBadge: $("compareBadge"),
  watchlistBadge: $("watchlistBadge"),
  mobileCompareBadge: $("mobileCompareBadge"),
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
  fallbackNoticeBanner: $("fallbackNoticeBanner"),
  compareBasketBar: $("compareBasketBar"),
  compareResultContainer: $("compareResultContainer"),
  runCompareBtn: $("runCompareBtn"),
  clearCompareBtn: $("clearCompareBtn"),
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
    watchlist: els.viewWatchlist,
    history: els.viewHistory,
  };

  for (const [k, node] of Object.entries(views)) {
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

  // Compact hero when viewing results or detail
  const shouldCompact =
    view === "detail" ||
    view === "compare" ||
    view === "watchlist" ||
    view === "history" ||
    (view === "search" && Boolean(state.searchData));
  els.searchHero.classList.toggle("compact", shouldCompact);

  updateCompareBadges();

  if (view === "compare") renderCompareView();
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

  setStatus("loading", `"${q}" için Türkiye e-ticaret piyasası taranıyor...`);

  try {
    const data = await apiFetch(`/api/search?${params.toString()}`);
    setStatus(null);

    if (data.directProduct && data.detail) {
      state.currentDetail = data.detail;
      switchView("detail");
      renderDetailView();
      return;
    }

    state.searchData = data;
    switchView("search");
    renderSearchResults();
  } catch (err) {
    setStatus("error", err.message);
  }
}

function renderSearchResults() {
  const data = state.searchData;
  if (!data) return;

  els.resultsHeading.textContent = `"${data.query}" sonuçları`;
  const providerTag = data.provider ? ` · Kaynak: ${data.provider}` : "";
  els.resultsSubmeta.textContent = `${data.filteredCount} / ${data.totalFound} ürün listelendi${providerTag}${data.cached ? " · Önbellek" : " · Canlı"}`;

  if (els.fallbackNoticeBanner) {
    if (data.fallbackNotice) {
      els.fallbackNoticeBanner.hidden = false;
      els.fallbackNoticeBanner.innerHTML = `
        <div class="fallback-notice-text">
          <strong>Yedek Canlı Kaynak Aktif:</strong> ${esc(data.fallbackNotice)}
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="fallbackOpenSettingsBtn">50+ Mağazayı Aç (Ücretsiz API)</button>
      `;
      $("fallbackOpenSettingsBtn")?.addEventListener("click", openSettingsModal);
    } else {
      els.fallbackNoticeBanner.hidden = true;
      els.fallbackNoticeBanner.innerHTML = "";
    }
  }

  if (!data.products.length) {
    els.resultsGrid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <h3>Eşleşen ürün bulunamadı</h3>
        <p>${
          data.fallbackMode
            ? "Bu ürün Migros Elektronik / T.C. Market Fiyatı kataloğunda bulunamadı. Trendyol, Hepsiburada, Amazon TR, n11 ve MediaMarkt dahil tüm Türkiye mağazalarını taramak için Ayarlar'dan ücretsiz Serper API anahtarı (2.500 ücretsiz arama) ekleyebilirsiniz."
            : "Fiyat filtresini gevşetmeyi veya daha genel bir model adı denemeyi düşünün."
        }</p>
        ${data.fallbackMode ? `<button type="button" class="btn btn-primary btn-sm" id="emptyOpenSettingsBtn" style="margin-top:10px;">Ücretsiz 50+ Mağaza API Ayarla</button>` : ""}
      </div>`;
    $("emptyOpenSettingsBtn")?.addEventListener("click", openSettingsModal);
    return;
  }

  els.resultsGrid.innerHTML = data.products
    .map((p) => {
      const inCompare = state.compareBasket.some((c) => c.url === p.url);
      return `
        <article class="product-card" data-url="${esc(p.url)}">
          <div class="product-card-media" data-action="open-detail">
            ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" />` : `<span class="muted-text">Görsel yok</span>`}
          </div>
          <h3 class="product-card-title" data-action="open-detail" title="${esc(p.title)}">${esc(p.title)}</h3>
          ${p.unitInfo ? `<div class="unit-pill" title="Otomatik birim maliyet (${esc(p.unitInfo.rawMatch)})">${esc(p.unitInfo.formatted)}</div>` : ""}
          <div class="product-card-pricing">
            <span class="price-main">${p.lowestPrice ? fmtTL(p.lowestPrice) : "Fiyat yok"}</span>
            <span class="offer-pill">${p.offerCount > 1 ? `${p.offerCount} satıcı` : "1 satıcı"}</span>
          </div>
          <div class="product-card-footer">
            <button type="button" class="btn btn-primary btn-sm btn-analyze" data-action="open-detail">Detaylı Analiz</button>
            <button type="button" class="btn btn-secondary btn-sm btn-compare-toggle ${inCompare ? "selected" : ""}" data-action="toggle-compare" title="Karşılaştırma listesine ekle/çıkar">
              ${inCompare ? "✓ Listede" : "+ Kıyasla"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

// ============================================================================
// DEEP PRODUCT DETAIL VIEW
// ============================================================================
async function openProductDetail(url, refresh = false) {
  if (!url) return;
  setStatus("loading", "Tüm mağazalardan kargo dahil teklifler ve 6 aylık fiyat geçmişi analiz ediliyor...");
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const params = new URLSearchParams({ url });
    if (refresh) params.set("refresh", "1");
    const detail = await apiFetch(`/api/product?${params.toString()}`);
    setStatus(null);

    state.currentDetail = detail;
    state.chartRange = "all";
    state.offerSort = "net_asc";
    state.offerFilters = {
      freeShippingOnly: false,
      inStockOnly: false,
      hideOutliers: false,
      storeSearch: "",
    };

    switchView("detail");
    renderDetailView();
  } catch (err) {
    setStatus("error", err.message);
  }
}

function renderDetailView() {
  const d = state.currentDetail;
  if (!d) return;

  const inCompare = state.compareBasket.some((c) => c.url === d.url);
  els.detailCompareToggleBtn.textContent = inCompare ? "✓ Karşılaştırmada" : "+ Karşılaştır";
  els.detailCompareToggleBtn.classList.toggle("selected", inCompare);
  els.backToResultsBtn.hidden = !state.searchData;

  const watched = state.watchlist.find((w) => w.url === d.url);
  const stats = d.stats;
  const picks = d.picks;
  const hist = d.historySummary;
  const verdict = d.verdict || { score: 50, label: "Analiz", tone: "neutral", headline: "", reasons: [] };

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
          <label for="targetPriceInput">Hedef Fiyat Alarmı (TL):</label>
          <input
            type="number"
            id="targetPriceInput"
            step="0.01"
            min="1"
            placeholder="${stats?.minNet ? Math.round(stats.minNet * 0.95) : "Örn. 50000"}"
            value="${watched?.target_price ?? ""}"
          />
          <button type="submit" class="btn ${watched ? "btn-good" : "btn-primary"} btn-sm">
            ${watched ? "✓ Takibi Güncelle" : "Takibe Al"}
          </button>
          <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">Akakçe Sayfası ↗</a>
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
          <div class="kpi-label">${hist ? "6 Aylık En Düşük Fiyat" : "Fiyat Aralığı (Min – Max)"}</div>
          <div class="kpi-value">${hist ? fmtTL(hist.minPrice) : fmtTL(stats.maxNet)}</div>
          <div class="kpi-sub">
            ${
              hist
                ? `${esc(hist.minDate)} tarihinde görüldü (${hist.diffFromMinPct <= 0.1 ? "Şu an dip seviyede!" : `şu an ${fmtPct(hist.diffFromMinPct)} yukarıda`})`
                : `Piyasa yayılımı: ${fmtPct(stats.marketSpreadPct, false)}`
            }
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Kargo & Satıcı Özeti</div>
          <div class="kpi-value">${stats.freeShippingCount}/${stats.offerCountAnalyzed} <span style="font-size:0.82rem;font-weight:500;color:var(--ink-muted);">ücretsiz kargo</span></div>
          <div class="kpi-sub">${d.platformBreakdown.length} farklı pazaryeri · ${stats.outlierCount > 0 ? `${stats.outlierCount} fahiş fiyat ayrıştırıldı` : "Fiyat dağılımı tutarlı"}</div>
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

    <!-- Full Multi-Store Comparison Table -->
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Tüm Mağaza Teklifleri (Kargo Dahil Net Sıralama)</h3>
          <p class="muted-text">Fiyatlar kargo maliyeti eklenerek net toplam üzerinden sıralanır; fırsat skoru fiyat, satıcı güveni, kargo ve teslimat hızını birleştirir.</p>
        </div>

        <div class="table-filters">
          <input type="text" id="offerStoreFilter" class="input-sm" style="width:155px;" placeholder="Mağaza / satıcı ara..." value="${esc(state.offerFilters.storeSearch)}" />
          <label class="checkbox-pill">
            <input type="checkbox" id="filterFreeShipping" ${state.offerFilters.freeShippingOnly ? "checked" : ""} />
            Sadece Ücretsiz Kargo
          </label>
          <label class="checkbox-pill">
            <input type="checkbox" id="filterHideOutliers" ${state.offerFilters.hideOutliers ? "checked" : ""} />
            Fahiş Fiyatları Gizle
          </label>
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
            <h3>Fiyat Geçmişi Grafiği</h3>
            <p class="muted-text">${hist ? `${hist.startDate} – ${hist.endDate} arası ${hist.dataPoints} günlük gerçek en düşük piyasa fiyatı` : "Tarihsel fiyat takibi"}</p>
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
              <span class="chart-stat-label">30 Gün Ortalama</span>
              <span class="chart-stat-val">${fmtTL(hist.avg30)}</span>
            </div>
            <div class="chart-stat-item">
              <span class="chart-stat-label">30 Günlük Değişim</span>
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

    <!-- Variants (Colors / Capacities) -->
    ${
      d.variants?.length
        ? `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Diğer Renk / Kapasite Seçenekleri</h3>
            <p class="muted-text">Farklı bir renk veya kapasite daha avantajlı olabilir</p>
          </div>
        </div>
        <div class="variants-grid">
          ${d.variants
            .map(
              (v) => `
            <a class="variant-chip" ${v.isAkakceUrl ? `href="#" data-variant-url="${esc(v.url)}"` : `href="${esc(v.url || d.url)}" target="_blank" rel="noopener noreferrer"`}>
              <span class="variant-name">${esc(v.name)}</span>
              <span class="variant-price">${v.price ? fmtTL(v.price) : "İncele"}</span>
              ${v.seller ? `<span class="muted-text" style="font-size:0.74rem;margin:0;">${esc(v.seller)}</span>` : ""}
            </a>`
            )
            .join("")}
        </div>
      </section>
    `
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

  // Bind detail-level controls
  $("offerStoreFilter")?.addEventListener("input", (e) => {
    state.offerFilters.storeSearch = e.target.value;
    renderOffersTableBody();
  });
  $("filterFreeShipping")?.addEventListener("change", (e) => {
    state.offerFilters.freeShippingOnly = e.target.checked;
    renderOffersTableBody();
  });
  $("filterHideOutliers")?.addEventListener("change", (e) => {
    state.offerFilters.hideOutliers = e.target.checked;
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
    try {
      const res = await apiFetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: d.id,
          title: d.title,
          url: d.url,
          image: d.image,
          target_price: targetPrice,
          last_net_price: d.stats?.minNet ?? d.lowPrice,
          best_store: d.picks?.cheapestNet?.store || "",
          verdict_score: d.verdict?.score ?? null,
          verdict_label: d.verdict?.label || "",
          offer_count: d.totalOfferCount,
        }),
      });
      state.watchlist = res.items || [];
      saveLocalWatchlist(state.watchlist);
      updateWatchlistBadge();
      showToast(targetPrice ? `Takibe alındı (Hedef: ${fmtTL(targetPrice)})` : "Ürün takip listenize eklendi.");
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
  if (state.offerFilters.hideOutliers) {
    list = list.filter((o) => !o.isOutlier);
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
      body: JSON.stringify({ urls: state.compareBasket.map((b) => b.url) }),
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
                  <strong style="cursor:pointer;color:var(--primary);" data-open-compared="${esc(it.url)}">${esc(it.title)}</strong>
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
    el.addEventListener("click", () => openProductDetail(el.dataset.openCompared));
  });
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

function renderWatchlistView() {
  const list = state.watchlist;
  els.refreshWatchlistBtn.hidden = list.length === 0;

  if (!list.length) {
    els.watchlistContainer.innerHTML = `
      <div class="empty-state">
        <h3>Henüz takip ettiğiniz bir ürün yok</h3>
        <p>Herhangi bir ürünün analiz sayfasında hedef fiyat belirleyip <strong>"Takibe Al"</strong> butonuna tıklayarak fiyat düşüşlerini izleyebilirsiniz.</p>
      </div>`;
    return;
  }

  els.watchlistContainer.innerHTML = `
    <div class="list-stack">
      ${list
        .map(
          (w) => `
        <div class="watch-card ${w.targetReached ? "target-hit" : ""}" data-watch-id="${esc(w.id)}">
          <img class="watch-thumb" src="${esc(w.image || "")}" alt="${esc(w.title)}" />
          <div>
            <h3 class="watch-title" data-open-watch="${esc(w.url)}">${esc(w.title)}</h3>
            <div class="watch-metrics">
              <span>Güncel Net: <strong class="mono">${fmtTL(w.last_net_price)}</strong></span>
              ${w.target_price ? `<span>Hedef: <strong class="mono">${fmtTL(w.target_price)}</strong></span>` : ""}
              ${w.lowest_seen_price ? `<span>Görülen En Düşük: <strong class="mono">${fmtTL(w.lowest_seen_price)}</strong></span>` : ""}
              ${w.best_store ? `<span>Mağaza: <strong>${esc(w.best_store)}</strong></span>` : ""}
              ${w.targetReached ? `<span class="mini-badge cheapest">✓ Hedef Fiyata Ulaştı!</span>` : ""}
            </div>
            <div class="muted-text" style="font-size:0.76rem;">Son kontrol: ${fmtDateTime(w.updated_at)}</div>
          </div>
          <div class="watch-actions">
            <input type="number" class="input-sm" data-target-input="${esc(w.id)}" value="${w.target_price ?? ""}" placeholder="Hedef TL" />
            <button type="button" class="btn btn-secondary btn-sm" data-save-target="${esc(w.id)}">Hedef Kaydet</button>
            <button type="button" class="btn btn-primary btn-sm" data-open-watch="${esc(w.url)}">Analiz</button>
            <button type="button" class="btn btn-ghost btn-sm" data-delete-watch="${esc(w.id)}">Sil</button>
          </div>
        </div>`
        )
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
      openProductDetail(product.url);
    } else if (action === "toggle-compare") {
      toggleCompareItem(product);
    }
  });

  // Detail top-bar buttons
  els.backToResultsBtn.addEventListener("click", () => {
    switchView("search");
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
    if (state.currentDetail) openProductDetail(state.currentDetail.url, true);
  });

  els.exportCsvBtn.addEventListener("click", () => {
    if (!state.currentDetail) return;
    window.location.href = `/api/export/csv?url=${encodeURIComponent(state.currentDetail.url)}`;
    showToast("CSV (Excel uyumlu) raporu indiriliyor...");
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
      openProductDetail(openEl.dataset.openWatch);
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

  els.refreshWatchlistBtn.addEventListener("click", async () => {
    els.refreshWatchlistBtn.disabled = true;
    setStatus("loading", "Takip listesindeki tüm ürünlerin canlı fiyatları güncelleniyor...");
    try {
      const res = await apiFetch("/api/watchlist/refresh", { method: "POST" });
      state.watchlist = res.items || [];
      saveLocalWatchlist(state.watchlist);
      setStatus(null);
      renderWatchlistView();
      const hits = state.watchlist.filter((w) => w.targetReached).length;
      showToast(
        hits > 0
          ? `Fiyatlar güncellendi! ${hits} ürün hedef fiyatınıza ulaştı.`
          : "Tüm takip edilen ürünlerin fiyatları güncellendi."
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

  // Settings Modal handlers
  els.openSettingsBtn?.addEventListener("click", openSettingsModal);
  els.closeSettingsBtn?.addEventListener("click", closeSettingsModal);
  els.settingsModal?.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
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
    showToast(serper || serpApi ? "Google Shopping TR (50+ Mağaza) aktif edildi!" : "API anahtarları temizlendi.");
    if (state.lastQuery) performSearch(state.lastQuery, { refresh: true });
  });

  els.clearApiKeysBtn?.addEventListener("click", () => {
    if (els.serperKeyInput) els.serperKeyInput.value = "";
    if (els.serpApiKeyInput) els.serpApiKeyInput.value = "";
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

function openSettingsModal() {
  if (!els.settingsModal) return;
  const { serperKey, serpApiKey } = getStoredApiKeys();
  if (els.serperKeyInput) els.serperKeyInput.value = serperKey;
  if (els.serpApiKeyInput) els.serpApiKeyInput.value = serpApiKey;
  els.settingsModal.hidden = false;
}

function closeSettingsModal() {
  if (els.settingsModal) els.settingsModal.hidden = true;
}

function initPwa() {
  // Register Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
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
bindEvents();
initPwa();
updateCompareBadges();
updateApiStatusDot();
apiFetch("/api/providers")
  .then((p) => updateApiStatusDot(Boolean(p.googleShoppingReady)))
  .catch(() => {});
loadWatchlist();
