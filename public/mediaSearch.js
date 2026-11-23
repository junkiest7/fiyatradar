/**
 * FiyatRadar — Voice Search (Turkish Web Speech API) & Screenshot/Photo Product OCR
 * Lazily loads Tesseract.js only when the user actually selects a screenshot/photo,
 * keeping initial iPhone PWA load instant (0 KB extra upfront).
 */

let activeRecognition = null;
let tesseractLoadPromise = null;

export function isVoiceSearchSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function stopVoiceSearch() {
  if (activeRecognition) {
    try {
      activeRecognition.abort();
    } catch {
      // Ignore abort errors
    }
    activeRecognition = null;
  }
}

export function startVoiceSearch({ onStart, onInterim, onResult, onError, onEnd } = {}) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    onError?.("Sesli arama bu tarayıcıda desteklenmiyor. iPhone Safari veya Chrome'da kullanabilirsiniz.");
    return false;
  }

  stopVoiceSearch();
  const rec = new SpeechRec();
  activeRecognition = rec;
  rec.lang = "tr-TR";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  let finalText = "";
  let delivered = false;

  rec.onstart = () => {
    onStart?.();
  };

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) {
        finalText += piece;
      } else {
        interim += piece;
      }
    }
    const preview = (finalText || interim).replace(/\s+/g, " ").trim();
    if (preview) onInterim?.(preview);

    if (finalText.trim() && !delivered) {
      delivered = true;
      const cleaned = finalText.replace(/[.?!,;:]+$/g, "").replace(/\s+/g, " ").trim();
      onResult?.(cleaned);
    }
  };

  rec.onerror = (event) => {
    const code = event?.error || "";
    if (code === "not-allowed" || code === "service-not-allowed") {
      onError?.("Mikrofon izni verilmedi. iPhone Ayarlar > Safari > Mikrofon iznini açabilirsiniz.");
    } else if (code === "no-speech") {
      onError?.("Ses algılanamadı. Mikrofon butonuna dokunup ürün adını tekrar söyleyin.");
    } else if (code !== "aborted") {
      onError?.(`Sesli arama başlatılamadı (${code || "hata"}).`);
    }
  };

  rec.onend = () => {
    if (activeRecognition === rec) activeRecognition = null;
    if (!delivered && finalText.trim()) {
      delivered = true;
      onResult?.(finalText.replace(/[.?!,;:]+$/g, "").replace(/\s+/g, " ").trim());
    }
    onEnd?.();
  };

  try {
    rec.start();
    return true;
  } catch (err) {
    activeRecognition = null;
    onError?.(`Mikrofon açılamadı: ${err?.message || "bilinmeyen hata"}`);
    return false;
  }
}

// ============================================================================
// SCREENSHOT / PHOTO PRODUCT OCR
// ============================================================================

const UI_NOISE_PATTERNS = [
  /^(sepete\s*ekle|şimdi\s*al|hemen\s*al|satın\s*al|favorilere\s*ekle|takip\s*et|paylaş|beğen|yorum\s*yap|kaydet)$/i,
  /^(ücretsiz\s*kargo|kargo\s*bedava|hızlı\s*teslimat|aynı\s*gün\s*kargo|yarın\s*kapında|peşin\s*fiyatına)$/i,
  /^(ürün\s*özellikleri|tüm\s*özellikler|ürün\s*açıklaması|değerlendirmeler|satıcıya\s*sor|benzer\s*ürünler|tükendi|stokta)$/i,
  /^(trendyol|hepsiburada|amazon\.com\.tr|n11|instagram|tiktok|safari|ara|anasayfa|sepetim|hesabım|kategoriler|sponsorlu|reklam)$/i,
  /^(?:₺|TL)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:TL|₺|USD|EUR|\$|€)\s*$/i,
  /^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i, // Phone clock "14:32"
  /^(?:LTE|5G|4\.5G|4G|Wi-Fi|Turkcell|Vodafone|Türk\s*Telekom|\d{1,3}%)$/i,
  /^\d+[.,]\d+\s*(?:\(\d+\)|yorum|değerlendirme)?$/i, // Ratings like "4.8 (125)"
  /^@\w[\w.]*$/, // Social handles
];

function scoreCandidateLine(line) {
  let score = 0;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 9) score += 25;
  else if (words.length === 1 && line.length >= 5) score += 8;
  else score -= 10;

  if (line.length >= 10 && line.length <= 68) score += 20;
  // Boost alphanumeric model codes or specs (e.g. "iPhone 17", "256 GB", "GG1221S", "HD9650", "V15")
  if (/\b(?:[A-Z]{1,4}\d{2,5}[A-Z0-9]*|\d+\s*(?:GB|TB|ml|gr|kg|lt|W|inç|mm))\b/i.test(line)) {
    score += 22;
  }
  // Boost capitalized brand-like words
  const capWords = words.filter((w) => /^[A-ZÇĞİÖŞÜ][a-zçğıöşüA-Z0-9]+/.test(w)).length;
  score += Math.min(18, capWords * 5);

  // Penalize noisy punctuation / garbled OCR lines
  const alphaCount = (line.match(/[a-zA-ZçğıöşüÇĞİÖŞÜ0-9]/g) || []).length;
  const ratio = alphaCount / Math.max(1, line.length);
  if (ratio < 0.68) score -= 25;
  if (/[|\\/_~^*=<>{}\[\]]{2,}/.test(line)) score -= 20;

  // Penalize lines mentioning price or discount badges
  if (/\b(indirim|kupon|taksit|kargo|fırsat|kampanya|sepet|satıcı|yorum|puan)\b/i.test(line)) {
    score -= 18;
  }
  return score;
}

/**
 * Cleans raw OCR output from a phone screenshot or product label and extracts
 * the most likely searchable Turkish product title + top candidate chips.
 */
export function cleanOcrProductLines(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n+/)
    .map((l) =>
      l
        .replace(/[•·▪▫►▶★☆✓✔✕✖❤️♡🔍🛒📷]+/g, " ")
        .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\s*(?:TL|₺)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((l) => {
      if (l.length < 4 || l.length > 100) return false;
      const letters = (l.match(/[a-zA-ZçğıöşüÇĞİÖŞÜ]/g) || []).length;
      if (letters < 3) return false;
      return !UI_NOISE_PATTERNS.some((rx) => rx.test(l));
    });

  // Deduplicate case-insensitively and rank by product-title likelihood
  const seen = new Set();
  const scored = [];
  for (const line of lines) {
    const key = line.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ line, score: scoreCandidateLine(line) });
  }

  scored.sort((a, b) => b.score - a.score);
  const candidates = scored
    .filter((x) => x.score > 0)
    .slice(0, 5)
    .map((x) => x.line);

  // If top two short lines look like "Brand" + "Product Model", combine them as bestQuery!
  let bestQuery = candidates[0] || lines[0] || "";
  if (
    candidates.length >= 2 &&
    candidates[0].split(/\s+/).length <= 2 &&
    candidates[1].split(/\s+/).length <= 5 &&
    !candidates[1].toLocaleLowerCase("tr-TR").includes(candidates[0].toLocaleLowerCase("tr-TR"))
  ) {
    bestQuery = `${candidates[0]} ${candidates[1]}`.slice(0, 75);
  }

  return { bestQuery, candidates };
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;

  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("OCR kütüphanesi yüklenemedi."));
    };
    script.onerror = () => {
      tesseractLoadPromise = null;
      reject(new Error("OCR motoru indirilemedi. İnternet bağlantınızı kontrol edin."));
    };
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

function preprocessImageForOcr(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Görsel okunamadı."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Desteklenmeyen görsel formatı."));
      img.onload = () => {
        // Resize cleanly so OCR is fast on iPhone while preserving text legibility
        const maxSide = 1400;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        // Mild contrast boost on luminance for sharper OCR on dark-mode screenshots
        try {
          const imgData = ctx.getImageData(0, 0, w, h);
          const d = imgData.data;
          let avgLum = 0;
          for (let i = 0; i < d.length; i += 16) {
            avgLum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          }
          avgLum /= Math.max(1, d.length / 16);
          const invertDark = avgLum < 95;
          for (let i = 0; i < d.length; i += 4) {
            let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (invertDark) g = 255 - g;
            g = Math.max(0, Math.min(255, (g - 128) * 1.25 + 128));
            d[i] = d[i + 1] = d[i + 2] = g;
          }
          ctx.putImageData(imgData, 0, 0);
        } catch {
          // Fallback to original draw if canvas pixel ops fail
        }

        resolve({
          previewDataUrl: reader.result,
          ocrDataUrl: canvas.toDataURL("image/png"),
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function extractProductFromImageFile(file, onProgress) {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("Lütfen geçerli bir görsel veya ekran görüntüsü seçin.");
  }

  onProgress?.("Görsel hazırlanıyor...", 10);
  const { previewDataUrl, ocrDataUrl } = await preprocessImageForOcr(file);

  onProgress?.("Metin okuma motoru (OCR) yükleniyor...", 25);
  const Tesseract = await loadTesseract();

  const runOcr = async (lang) =>
    Tesseract.recognize(ocrDataUrl, lang, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          const pct = Math.round(35 + (m.progress || 0) * 60);
          onProgress?.(`Görseldeki ürün adı okunuyor (%${Math.round((m.progress || 0) * 100)})...`, pct);
        } else if (m.status && m.status.includes("loading")) {
          onProgress?.("Türkçe dil paketi indiriliyor (ilk seferde birkaç saniye sürer)...", 32);
        }
      },
    });

  let result;
  try {
    result = await runOcr("tur+eng");
  } catch {
    result = await runOcr("eng");
  }

  onProgress?.("Ürün adı ayıklanıyor...", 98);
  const rawText = result?.data?.text || "";
  const { bestQuery, candidates } = cleanOcrProductLines(rawText);

  return {
    previewDataUrl,
    rawText,
    bestQuery,
    candidates,
  };
}
