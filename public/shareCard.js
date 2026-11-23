/**
 * FiyatRadar — High-DPI Visual Price Card Generator (PNG 1080x1350)
 * Renders an editorial, WhatsApp/iMessage-ready price summary card with product photo,
 * cheapest net offer, buy-timing verdict score, and top 3 Turkish store offers.
 */

const fmtTL = (val) =>
  typeof val === "number" && Number.isFinite(val)
    ? `${new Intl.NumberFormat("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(val)} TL`
    : "-";

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        const rest = words.slice(i).join(" ");
        let clipped = rest;
        while (clipped.length > 3 && ctx.measureText(`${clipped}…`).width > maxWidth) {
          clipped = clipped.slice(0, -1).trim();
        }
        lines.push(clipped === rest ? clipped : `${clipped}…`);
        return lines;
      }
    }
  }
  lines.push(current);
  return lines.slice(0, maxLines);
}

function loadProxiedImage(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 5500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  });
}

function getCardPalette(theme) {
  if (theme === "dark") {
    return {
      bg: "#0b0d12",
      surface: "#141821",
      surfaceSoft: "#1b2130",
      border: "#262d3d",
      ink: "#f3f4f6",
      inkSecondary: "#b0b8c8",
      inkMuted: "#7d879b",
      primary: "#3b82f6",
      primarySoft: "rgba(59, 130, 246, 0.16)",
      good: "#10b981",
      goodSoft: "rgba(16, 185, 129, 0.14)",
      goodBorder: "rgba(16, 185, 129, 0.35)",
      warn: "#f59e0b",
      warnSoft: "rgba(245, 158, 11, 0.14)",
      bad: "#f87171",
      badSoft: "rgba(248, 113, 113, 0.14)",
      photoBg: "#ffffff",
    };
  }
  return {
    bg: "#f7f6f2",
    surface: "#ffffff",
    surfaceSoft: "#f1efe9",
    border: "#e4e0d8",
    ink: "#141517",
    inkSecondary: "#4e5563",
    inkMuted: "#787f8d",
    primary: "#1d4ed8",
    primarySoft: "#edf2ff",
    good: "#0d7a52",
    goodSoft: "#eaf7f1",
    goodBorder: "#bfe5d4",
    warn: "#b45309",
    warnSoft: "#fef6e7",
    bad: "#be3126",
    badSoft: "#fdf0ef",
    photoBg: "#ffffff",
  };
}

/**
 * Generates a high-DPI PNG Blob + Data URL summarizing a product's live price research.
 */
export async function generatePriceCard(detail, options = {}) {
  const theme = options.theme === "dark" ? "dark" : "light";
  const pal = getCardPalette(theme);

  const W = 1080;
  const H = 1350;
  const PAD = 56;
  const INNER_W = W - PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const fontSans = `"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const fontMono = `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

  // Wait briefly for web fonts if available
  try {
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 400))]);
  } catch {
    // Continue with system fallback fonts
  }

  // Background
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle top accent bar
  ctx.fillStyle = pal.primary;
  ctx.fillRect(0, 0, W, 10);

  // 1. Header Bar
  let y = 52;
  roundRect(ctx, PAD, y, 52, 52, 14);
  ctx.fillStyle = pal.ink;
  ctx.fill();
  ctx.strokeStyle = theme === "dark" ? pal.primary : "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(PAD + 24, y + 24, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(PAD + 33, y + 33);
  ctx.lineTo(PAD + 41, y + 41);
  ctx.stroke();

  ctx.fillStyle = pal.ink;
  ctx.font = `800 32px ${fontSans}`;
  ctx.fillText("FiyatRadar", PAD + 68, y + 32);

  ctx.fillStyle = pal.inkMuted;
  ctx.font = `600 18px ${fontSans}`;
  ctx.fillText("TR Canlı Fiyat Analiz Kartı", PAD + 68, y + 54);

  const nowStr = new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(detail.fetchedAt || Date.now()));
  ctx.textAlign = "right";
  ctx.fillStyle = pal.inkMuted;
  ctx.font = `500 20px ${fontMono}`;
  ctx.fillText(nowStr, W - PAD, y + 34);
  ctx.textAlign = "left";

  // 2. Product Overview Card
  y = 136;
  const prodCardH = 264;
  roundRect(ctx, PAD, y, INNER_W, prodCardH, 24);
  ctx.fillStyle = pal.surface;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Product photo container
  const photoBox = 204;
  const photoX = PAD + 30;
  const photoY = y + 30;
  roundRect(ctx, photoX, photoY, photoBox, photoBox, 18);
  ctx.fillStyle = pal.photoBg;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const img = await loadProxiedImage(detail.image);
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const padImg = 16;
    const avail = photoBox - padImg * 2;
    const ratio = Math.min(avail / img.naturalWidth, avail / img.naturalHeight);
    const dw = img.naturalWidth * ratio;
    const dh = img.naturalHeight * ratio;
    ctx.save();
    roundRect(ctx, photoX, photoY, photoBox, photoBox, 18);
    ctx.clip();
    ctx.drawImage(img, photoX + (photoBox - dw) / 2, photoY + (photoBox - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = "#9ca3af";
    ctx.font = `600 20px ${fontSans}`;
    ctx.textAlign = "center";
    ctx.fillText("FiyatRadar", photoX + photoBox / 2, photoY + photoBox / 2 + 6);
    ctx.textAlign = "left";
  }

  // Product title & tags
  const textX = photoX + photoBox + 32;
  const textMaxW = W - PAD - 32 - textX;

  if (detail.brand || detail.category) {
    ctx.fillStyle = pal.primary;
    ctx.font = `700 20px ${fontSans}`;
    const crumb = String(detail.brand || detail.category).slice(0, 40);
    ctx.fillText(crumb.toUpperCase(), textX, y + 58);
  }

  ctx.fillStyle = pal.ink;
  ctx.font = `800 32px ${fontSans}`;
  const titleLines = wrapText(ctx, detail.title || "Ürün Analizi", textMaxW, 3);
  let ty = y + (detail.brand || detail.category ? 102 : 76);
  for (const line of titleLines) {
    ctx.fillText(line, textX, ty);
    ty += 42;
  }

  // Pill metadata under title
  const pills = [];
  if (detail.totalOfferCount) pills.push(`${detail.totalOfferCount} mağaza tarandı`);
  if (detail.unitInfo?.formatted) pills.push(`Birim: ${detail.unitInfo.formatted}`);
  if (pills.length) {
    let px = textX;
    const py = y + prodCardH - 54;
    ctx.font = `600 19px ${fontSans}`;
    for (const pill of pills.slice(0, 2)) {
      const pw = Math.min(textMaxW - (px - textX), ctx.measureText(pill).width + 28);
      if (pw < 40) break;
      roundRect(ctx, px, py, pw, 36, 10);
      ctx.fillStyle = pal.surfaceSoft;
      ctx.fill();
      ctx.fillStyle = pal.inkSecondary;
      ctx.fillText(pill, px + 14, py + 24);
      px += pw + 12;
    }
  }

  // 3. Key Highlight Row (Cheapest Net Price + Buy Score Verdict)
  y = 432;
  const rowH = 232;
  const gap = 24;
  const leftW = Math.round(INNER_W * 0.58);
  const rightW = INNER_W - leftW - gap;

  const stats = detail.stats || {};
  const best = detail.picks?.cheapestNet || detail.offers?.[0] || null;
  const verdict = detail.verdict || { score: 65, label: "Analiz Özeti", tone: "good-soft", headline: "" };

  // Left card: Cheapest Net Price
  roundRect(ctx, PAD, y, leftW, rowH, 24);
  ctx.fillStyle = pal.goodSoft;
  ctx.fill();
  ctx.strokeStyle = pal.goodBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = pal.good;
  ctx.font = `700 20px ${fontSans}`;
  ctx.fillText("KARGO DAHİL EN UCUZ NET FİYAT", PAD + 28, y + 46);

  ctx.fillStyle = pal.good;
  ctx.font = `800 54px ${fontMono}`;
  ctx.fillText(fmtTL(stats.minNet ?? best?.netPrice ?? detail.lowPrice), PAD + 28, y + 116);

  ctx.fillStyle = pal.ink;
  ctx.font = `700 23px ${fontSans}`;
  const bestStoreLine = best ? `${best.store || best.store?.displayName || "Mağaza"} · ${best.shippingLabel || best.shipping?.label || "Kargo kontrol"}` : "";
  ctx.fillText(wrapText(ctx, bestStoreLine, leftW - 56, 1)[0], PAD + 28, y + 162);

  if (typeof stats.savingsVsMedian === "number" && stats.savingsVsMedian > 0) {
    ctx.fillStyle = pal.inkSecondary;
    ctx.font = `600 20px ${fontSans}`;
    ctx.fillText(
      `Piyasa medyanına göre ${fmtTL(stats.savingsVsMedian)} (%${stats.savingsVsMedianPct}) tasarruf`,
      PAD + 28,
      y + 198
    );
  } else if (stats.medianNet) {
    ctx.fillStyle = pal.inkSecondary;
    ctx.font = `600 20px ${fontSans}`;
    ctx.fillText(`Piyasa medyanı: ${fmtTL(stats.medianNet)}`, PAD + 28, y + 198);
  }

  // Right card: Verdict Score
  const rx = PAD + leftW + gap;
  const vColor =
    verdict.tone === "good" || verdict.tone === "good-soft"
      ? pal.good
      : verdict.tone === "bad"
        ? pal.bad
        : pal.warn;
  const vBg =
    verdict.tone === "good" || verdict.tone === "good-soft"
      ? pal.surface
      : verdict.tone === "bad"
        ? pal.badSoft
        : pal.warnSoft;

  roundRect(ctx, rx, y, rightW, rowH, 24);
  ctx.fillStyle = vBg;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = pal.inkMuted;
  ctx.font = `700 18px ${fontSans}`;
  ctx.fillText("ŞİMDİ ALINIR MI?", rx + 26, y + 46);

  ctx.fillStyle = vColor;
  ctx.font = `800 58px ${fontMono}`;
  ctx.fillText(`${verdict.score ?? 65}`, rx + 26, y + 114);
  const scoreNumW = ctx.measureText(`${verdict.score ?? 65}`).width;
  ctx.fillStyle = pal.inkMuted;
  ctx.font = `600 26px ${fontMono}`;
  ctx.fillText("/100", rx + 30 + scoreNumW, y + 114);

  ctx.fillStyle = pal.ink;
  ctx.font = `700 22px ${fontSans}`;
  const vLabelLines = wrapText(ctx, verdict.label || "Piyasa Özeti", rightW - 52, 2);
  let vy = y + 158;
  for (const vl of vLabelLines) {
    ctx.fillText(vl, rx + 26, vy);
    vy += 28;
  }

  // 4. Top 3 Cheapest Valid Offers Table
  y = 698;
  const validOffers = (detail.offers || [])
    .filter((o) => !o.isSuspiciousLow && typeof o.netPrice === "number")
    .slice(0, 3);
  const offersToShow = validOffers.length ? validOffers : (detail.offers || []).slice(0, 3);

  const tableHeaderY = y;
  ctx.fillStyle = pal.ink;
  ctx.font = `800 28px ${fontSans}`;
  ctx.fillText("En Ucuz 3 Mağaza Teklifi (Kargo Dahil)", PAD, tableHeaderY + 26);

  y = tableHeaderY + 52;
  const rowItemH = 118;
  for (let i = 0; i < Math.max(1, offersToShow.length); i++) {
    const o = offersToShow[i];
    if (!o) break;
    const ry = y + i * (rowItemH + 16);
    const isFirst = i === 0;

    roundRect(ctx, PAD, ry, INNER_W, rowItemH, 20);
    ctx.fillStyle = pal.surface;
    ctx.fill();
    ctx.strokeStyle = isFirst ? pal.good : pal.border;
    ctx.lineWidth = isFirst ? 2.5 : 1.5;
    ctx.stroke();

    // Rank Circle
    roundRect(ctx, PAD + 22, ry + 33, 52, 52, 14);
    ctx.fillStyle = isFirst ? pal.good : pal.surfaceSoft;
    ctx.fill();
    ctx.fillStyle = isFirst ? "#ffffff" : pal.inkSecondary;
    ctx.font = `800 24px ${fontMono}`;
    ctx.textAlign = "center";
    ctx.fillText(`#${i + 1}`, PAD + 48, ry + 68);
    ctx.textAlign = "left";

    // Store name & shipping
    const storeName = o.store?.displayName || o.store?.platform || "Mağaza";
    ctx.fillStyle = pal.ink;
    ctx.font = `700 26px ${fontSans}`;
    ctx.fillText(wrapText(ctx, storeName, 540, 1)[0], PAD + 94, ry + 54);

    const shipLbl = o.shipping?.label || (o.shippingCost === 0 ? "Ücretsiz kargo" : `+${fmtTL(o.shippingCost)} kargo`);
    ctx.fillStyle = o.shippingCost === 0 ? pal.good : pal.inkMuted;
    ctx.font = `600 20px ${fontSans}`;
    ctx.fillText(
      `${shipLbl}${o.delivery?.label ? ` · ${o.delivery.label}` : ""}`,
      PAD + 94,
      ry + 88
    );

    // Right-aligned Net Price + Diff
    ctx.textAlign = "right";
    ctx.fillStyle = isFirst ? pal.good : pal.ink;
    ctx.font = `800 32px ${fontMono}`;
    ctx.fillText(fmtTL(o.netPrice), W - PAD - 26, ry + 56);

    ctx.fillStyle = isFirst ? pal.good : pal.inkMuted;
    ctx.font = `600 19px ${fontSans}`;
    ctx.fillText(
      isFirst ? "★ En Ucuz" : `+${fmtTL(o.diffFromMin)} (+%${o.diffFromMinPct})`,
      W - PAD - 26,
      ry + 88
    );
    ctx.textAlign = "left";
  }

  // 5. Optional History / Spread Summary Strip
  const stripY = 1152;
  roundRect(ctx, PAD, stripY, INNER_W, 92, 20);
  ctx.fillStyle = pal.surfaceSoft;
  ctx.fill();
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const hist = detail.historySummary;
  const cols = hist
    ? [
        { k: "Dönem En Düşük", v: fmtTL(hist.minPrice) },
        { k: "Piyasa Medyanı", v: fmtTL(stats.medianNet) },
        { k: "Dönem En Yüksek", v: fmtTL(hist.maxPrice) },
      ]
    : [
        { k: "En Ucuz Net", v: fmtTL(stats.minNet) },
        { k: "Piyasa Medyanı", v: fmtTL(stats.medianNet) },
        { k: "En Yüksek Teklif", v: fmtTL(stats.maxNet) },
      ];

  const colW = INNER_W / 3;
  cols.forEach((c, idx) => {
    const cx = PAD + idx * colW + 26;
    ctx.fillStyle = pal.inkMuted;
    ctx.font = `600 18px ${fontSans}`;
    ctx.fillText(c.k, cx, stripY + 34);
    ctx.fillStyle = pal.ink;
    ctx.font = `700 24px ${fontMono}`;
    ctx.fillText(c.v, cx, stripY + 68);
  });

  // 6. Footer
  ctx.fillStyle = pal.inkMuted;
  ctx.font = `600 20px ${fontSans}`;
  ctx.fillText("FiyatRadar · Türkiye Detaylı Fiyat Araştırma Botu", PAD, H - 40);
  ctx.textAlign = "right";
  ctx.font = `500 19px ${fontMono}`;
  ctx.fillText("fiyatradar-0c0y.onrender.com", W - PAD, H - 40);
  ctx.textAlign = "left";

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
  const dataUrl = canvas.toDataURL("image/png");
  const slug = String(detail.id || "fiyat-karti").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "fiyat-karti";

  return {
    blob,
    dataUrl,
    filename: `fiyatradar-${slug}.png`,
  };
}

/**
 * Shares the generated PNG card natively (iPhone Share Sheet -> WhatsApp / iMessage / Photos)
 * or returns 'unsupported' so the caller can download the PNG cleanly.
 */
export async function sharePriceCardBlob(blob, filename, detail) {
  if (!blob) return "unsupported";
  try {
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      const best = detail.picks?.cheapestNet;
      const text = best
        ? `${detail.title} — Kargo Dahil En Ucuz: ${fmtTL(best.netPrice)} (${best.store})`
        : detail.title;
      await navigator.share({
        title: detail.title || "FiyatRadar Analiz Kartı",
        text,
        files: [file],
      });
      return "shared";
    }
  } catch (err) {
    if (err?.name === "AbortError") return "aborted";
  }
  return "unsupported";
}
