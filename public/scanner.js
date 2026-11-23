/**
 * iPhone-compatible Camera Barcode Scanner (EAN-13, EAN-8, UPC-A, Code-128).
 * Uses native BarcodeDetector when available, and lazily loads @zxing/browser
 * on iOS Safari where native BarcodeDetector is not yet shipped.
 */

let activeStream = null;
let zxingControls = null;
let rafId = null;
let isScanning = false;

export function stopScanner() {
  isScanning = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (zxingControls && typeof zxingControls.stop === "function") {
    try {
      zxingControls.stop();
    } catch {
      // Ignore cleanup errors
    }
    zxingControls = null;
  }
  if (activeStream) {
    for (const track of activeStream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Ignore
      }
    }
    activeStream = null;
  }
}

export async function startScanner(videoEl, statusEl, onDetected) {
  stopScanner();
  isScanning = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = "Kamera erişimi bu tarayıcıda desteklenmiyor. Aşağıdan barkod numarasını elle girebilirsiniz.";
    return;
  }

  statusEl.textContent = "Kamera açılıyor... Barkodu çerçevenin içine tutun.";

  try {
    // Path 1: Native BarcodeDetector (Chrome Android / Desktop / future Safari)
    if ("BarcodeDetector" in window) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (!isScanning) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      activeStream = stream;
      videoEl.srcObject = stream;
      videoEl.setAttribute("playsinline", "true");
      await videoEl.play();

      const detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
      });

      statusEl.textContent = "Barkodu çerçevenin ortasına hizalayın...";

      const tick = async () => {
        if (!isScanning) return;
        try {
          if (videoEl.readyState >= 2) {
            const barcodes = await detector.detect(videoEl);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              const code = String(barcodes[0].rawValue).trim();
              stopScanner();
              onDetected(code);
              return;
            }
          }
        } catch {
          // Ignore single-frame detection errors
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return;
    }

    // Path 2: iOS Safari compatible @zxing/browser ESM (lazy-loaded only when scanner opens)
    statusEl.textContent = "Barkod okuyucu yükleniyor...";
    const { BrowserMultiFormatReader } = await import(
      "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm"
    );
    if (!isScanning) return;

    const reader = new BrowserMultiFormatReader();
    videoEl.setAttribute("playsinline", "true");

    statusEl.textContent = "Barkodu çerçevenin ortasına hizalayın...";
    zxingControls = await reader.decodeFromConstraints(
      {
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      },
      videoEl,
      (result) => {
        if (!isScanning) return;
        if (result && typeof result.getText === "function") {
          const code = String(result.getText()).trim();
          if (code) {
            stopScanner();
            onDetected(code);
          }
        }
      }
    );
  } catch (err) {
    stopScanner();
    if (err?.name === "NotAllowedError") {
      statusEl.textContent = "Kamera izni reddedildi. iPhone Ayarlar > Safari > Kamera iznini açabilir veya barkodu elle girebilirsiniz.";
    } else {
      statusEl.textContent = `Kamera başlatılamadı (${err?.message || "bilinmeyen hata"}). Barkod numarasını aşağıdan elle girebilirsiniz.`;
    }
  }
}
