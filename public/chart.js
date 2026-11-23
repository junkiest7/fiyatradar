/**
 * Interactive SVG Price History Chart (zero external dependencies).
 * Renders daily price series, 7-day moving average, period average line,
 * min/max markers, and responsive mouse/touch hover tooltip.
 */

const fmtTL = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} TL`
    : "-";

const fmtShortTL = (n) => {
  if (!Number.isFinite(n)) return "";
  if (n >= 100000) return `${(n / 1000).toFixed(0)}B`;
  if (n >= 10000) return `${(n / 1000).toFixed(1).replace(".", ",")}B`;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
};

export function renderPriceChart(container, allPoints, rangeKey = "all") {
  if (!container) return;
  if (!Array.isArray(allPoints) || allPoints.length < 2) {
    container.innerHTML = `<div class="empty-state" style="padding:28px;"><p class="muted-text">Bu ürün için grafik oluşturmaya yetecek tarihsel fiyat kaydı bulunamadı.</p></div>`;
    return;
  }

  let slice = allPoints;
  if (rangeKey === "7") slice = allPoints.slice(-7);
  else if (rangeKey === "30") slice = allPoints.slice(-30);
  else if (rangeKey === "90") slice = allPoints.slice(-90);
  if (slice.length < 2) slice = allPoints;

  const W = 680;
  const H = 250;
  const pad = { top: 20, right: 16, bottom: 32, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const prices = slice.map((p) => p.price);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const span = rawMax - rawMin || Math.max(1, rawMin * 0.05);
  const yMin = Math.max(0, rawMin - span * 0.14);
  const yMax = rawMax + span * 0.14;
  const avg = prices.reduce((s, v) => s + v, 0) / prices.length;

  const xAt = (i) => pad.left + (slice.length === 1 ? plotW / 2 : (i / (slice.length - 1)) * plotW);
  const yAt = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].price < slice[minIdx].price) minIdx = i;
    if (slice[i].price > slice[maxIdx].price) maxIdx = i;
  }

  const linePath = slice.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.price).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xAt(slice.length - 1).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xAt(0).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;

  const maPath = slice
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.ma7 || p.price).toFixed(1)}`)
    .join(" ");

  // Y grid ticks (4 ticks)
  const yTicks = [];
  for (let t = 0; t <= 3; t++) {
    const val = yMin + ((yMax - yMin) * t) / 3;
    yTicks.push({ val, y: yAt(val) });
  }

  // X ticks (up to 5 dates)
  const xTickIndices = new Set([0, slice.length - 1]);
  const step = Math.max(1, Math.floor((slice.length - 1) / 4));
  for (let i = step; i < slice.length - 1; i += step) {
    if (slice.length - 1 - i > step * 0.45) xTickIndices.add(i);
  }
  const xTicks = [...xTickIndices].sort((a, b) => a - b);

  const avgY = yAt(avg);
  const gradId = `frGrad_${Math.random().toString(36).slice(2, 8)}`;
  const isDark = document.documentElement.dataset.theme === "dark";
  const pal = isDark
    ? {
        line: "#60a5fa",
        ma: "#3b82f6",
        grid: "#232836",
        axisText: "#94a0b8",
        avgLine: "#64748b",
        avgText: "#94a3b8",
        dotStroke: "#12151e",
        good: "#10b981",
        bad: "#f87171",
        hoverLine: "#e5e7eb",
      }
    : {
        line: "#1d4ed8",
        ma: "#93c5fd",
        grid: "#ece8e0",
        axisText: "#787f8d",
        avgLine: "#9ca3af",
        avgText: "#6b7280",
        dotStroke: "#ffffff",
        good: "#0d7a52",
        bad: "#be3126",
        hoverLine: "#141517",
      };

  container.innerHTML = `
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Fiyat geçmişi grafiği">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${pal.line}" stop-opacity="${isDark ? "0.24" : "0.16"}" />
            <stop offset="100%" stop-color="${pal.line}" stop-opacity="0.01" />
          </linearGradient>
        </defs>

        ${yTicks
          .map(
            (t) => `
          <line x1="${pad.left}" y1="${t.y.toFixed(1)}" x2="${W - pad.right}" y2="${t.y.toFixed(1)}" stroke="${pal.grid}" stroke-width="1" />
          <text x="${pad.left - 8}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="${pal.axisText}" font-size="10.5" font-family="IBM Plex Mono, monospace">${fmtShortTL(t.val)}</text>
        `
          )
          .join("")}

        <!-- Period Average Line -->
        <line x1="${pad.left}" y1="${avgY.toFixed(1)}" x2="${W - pad.right}" y2="${avgY.toFixed(1)}" stroke="${pal.avgLine}" stroke-width="1" stroke-dasharray="4 4" />
        <text x="${W - pad.right}" y="${(avgY - 5).toFixed(1)}" text-anchor="end" fill="${pal.avgText}" font-size="10" font-family="Plus Jakarta Sans, sans-serif">Ort. ${fmtShortTL(avg)} TL</text>

        <!-- Area & Main Line -->
        <path d="${areaPath}" fill="url(#${gradId})" />
        <path d="${maPath}" fill="none" stroke="${pal.ma}" stroke-width="1.5" stroke-dasharray="3 3" />
        <path d="${linePath}" fill="none" stroke="${pal.line}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />

        <!-- Min & Max Callout Dots -->
        <circle cx="${xAt(minIdx).toFixed(1)}" cy="${yAt(slice[minIdx].price).toFixed(1)}" r="4.5" fill="${pal.good}" stroke="${pal.dotStroke}" stroke-width="2" />
        <circle cx="${xAt(maxIdx).toFixed(1)}" cy="${yAt(slice[maxIdx].price).toFixed(1)}" r="4.5" fill="${pal.bad}" stroke="${pal.dotStroke}" stroke-width="2" />

        <!-- X Axis Labels -->
        ${xTicks
          .map(
            (idx) => `
          <text x="${xAt(idx).toFixed(1)}" y="${H - 8}" text-anchor="${idx === 0 ? "start" : idx === slice.length - 1 ? "end" : "middle"}" fill="${pal.axisText}" font-size="10.5" font-family="IBM Plex Mono, monospace">${slice[idx].dateLabel.slice(0, 5)}</text>
        `
          )
          .join("")}

        <!-- Interactive Hover Crosshair -->
        <g class="chart-hover-group" style="display:none;">
          <line class="hover-line" x1="0" y1="${pad.top}" x2="0" y2="${pad.top + plotH}" stroke="${pal.hoverLine}" stroke-width="1" stroke-dasharray="3 3" opacity="0.45" />
          <circle class="hover-dot" cx="0" cy="0" r="5" fill="${pal.line}" stroke="${pal.dotStroke}" stroke-width="2" />
        </g>

        <rect class="chart-overlay" x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair;" />
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;

  const wrap = container.querySelector(".chart-wrap");
  const svg = container.querySelector(".chart-svg");
  const overlay = container.querySelector(".chart-overlay");
  const hoverGroup = container.querySelector(".chart-hover-group");
  const hoverLine = container.querySelector(".hover-line");
  const hoverDot = container.querySelector(".hover-dot");
  const tooltip = container.querySelector(".chart-tooltip");

  function handleMove(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * W;
    const clamped = Math.max(pad.left, Math.min(pad.left + plotW, relX));
    const ratio = (clamped - pad.left) / plotW;
    const idx = Math.max(0, Math.min(slice.length - 1, Math.round(ratio * (slice.length - 1))));
    const pt = slice[idx];
    const cx = xAt(idx);
    const cy = yAt(pt.price);

    hoverGroup.style.display = "block";
    hoverLine.setAttribute("x1", cx.toFixed(1));
    hoverLine.setAttribute("x2", cx.toFixed(1));
    hoverDot.setAttribute("cx", cx.toFixed(1));
    hoverDot.setAttribute("cy", cy.toFixed(1));

    const leftPx = (cx / W) * rect.width;
    const topPx = (cy / H) * rect.height;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(84, Math.min(rect.width - 84, leftPx))}px`;
    tooltip.style.top = `${Math.max(54, topPx)}px`;

    const deltaSign = pt.delta > 0 ? "+" : "";
    const deltaHtml =
      pt.delta && pt.delta !== 0
        ? `<div style="color:${pt.delta < 0 ? "#6ee7b7" : "#fca5a5"};font-size:0.74rem;margin-top:2px;">Günlük: ${deltaSign}${fmtTL(pt.delta)} ${pt.pctLabel ? `(${pt.pctLabel})` : ""}</div>`
        : "";

    tooltip.innerHTML = `
      <div style="color:#d1d5db;font-size:0.72rem;">${pt.dateLabel}</div>
      <div class="mono" style="font-weight:700;font-size:0.88rem;">${fmtTL(pt.price)}</div>
      ${deltaHtml}
    `;
  }

  overlay.addEventListener("mousemove", (e) => handleMove(e.clientX));
  overlay.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches[0]) {
        e.preventDefault();
        handleMove(e.touches[0].clientX);
      }
    },
    { passive: false }
  );
  overlay.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches[0]) {
        e.preventDefault();
        handleMove(e.touches[0].clientX);
      }
    },
    { passive: false }
  );
  overlay.addEventListener("touchend", () => {
    setTimeout(() => {
      hoverGroup.style.display = "none";
      tooltip.hidden = true;
    }, 1200);
  });
  wrap.addEventListener("mouseleave", () => {
    hoverGroup.style.display = "none";
    tooltip.hidden = true;
  });
}
