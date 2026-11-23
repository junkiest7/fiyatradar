# FiyatRadar — Türkiye Detaylı Fiyat Araştırma Botu (iOS PWA + Web)

Türkiye e-ticaret piyasasındaki (Trendyol, Hepsiburada, Amazon Türkiye, n11, Pazarama, idefix, PttAVM, Migros, MediaMarkt, Teknosa, Vatan vb.) ürün fiyatlarını canlı olarak toplayan, **kargo dahil net maliyet** ve **birim fiyat** hesaplayan, **kargo tuzaklarını** tespit eden ve **6 aylık gerçek fiyat geçmişine göre "Şimdi Alınır mı?" analizi** sunan iPhone (iOS PWA) ve web uygulamasıdır.

## Öne Çıkan Özellikler

- **iPhone İçin Yerel Uygulama Deneyimi (iOS PWA):** Alt sekme çubuğu (Araştır / Kıyasla / Takip / Geçmiş), Dynamic Island & güvenli alan (`safe-area-inset`) uyumu, iPhone'a özel teklif kartları, parmakla kaydırılabilir 6 aylık fiyat grafiği, yerel iOS Paylaş menüsü ve özel ana ekran ikonu.
- **Canlı Çoklu Mağaza Karşılaştırması:** Tek aramada 50+ mağazanın anlık fiyat, kargo, satıcı puanı (`8,6/10`), stok ve teslimat süresini çeker; doğrudan mağaza bağlantılarını eşleştirir.
- **Kargo Dahil Net Maliyet & Kargo Tuzağı Tespiti:** Etiket fiyatı daha ucuz görünüp kargo eklendiğinde daha pahalıya gelen teklifleri otomatik yakalar ve net maliyete göre yeniden sıralar.
- **Otomatik Birim Fiyat Hesaplayıcı:** Gramaj, litre, çoklu paket ve adet bilgilerini (`1000 gr`, `6x200 ml`, `120'li`, `128 GB`) otomatik ayrıştırır (`TL/kg`, `TL/lt`, `TL/adet`, `TL/GB`).
- **0–100 Fırsat Skoru & "Şimdi Alınır mı?" Karar Motoru:** 6 aylık günlük gerçek fiyat geçmişi üzerinden 30 günlük ortalama, en düşük/en yüksek tarihler ve oynaklık analiziyle alım zamanlaması puanı üretir.
- **Yan Yana Karşılaştırma & Takip Listesi:** En fazla 4 ürünü yan yana kıyaslama, hedef fiyatlı takip listesi (iPhone yerel yedeklemeli), Türkçe Excel uyumlu CSV & JSON dışa aktarma.

## iPhone'da Kullanım (Render + Ana Ekrana Ekle)

### 1. Ücretsiz Render Yayını (1 Dakika)
1. [Render Dashboard](https://dashboard.render.com/blueprint/new?repo=https://github.com/junkiest7/fiyatradar) bağlantısına gidin (`render.yaml` otomatik algılanır).
2. **Apply** butonuna tıklayarak `fiyatradar` servisini ücretsiz (`Free`) planda başlatın.
3. Yayın tamamlandığında Render size `https://fiyatradar-xxxx.onrender.com` benzeri bir HTTPS adresi verecektir.

### 2. iPhone Ana Ekranına Uygulama Olarak Ekleme
1. Render'ın verdiği HTTPS adresini iPhone'unuzda **Safari** ile açın.
2. Alt menüdeki **Paylaş (↑)** simgesine dokunun.
3. **"Ana Ekrana Ekle"** (Add to Home Screen) seçeneğini seçin ve **Ekle**'ye dokunun.
4. FiyatRadar ikonu ana ekranınıza yerleşir; dokunduğunuzda tarayıcı çubuğu olmadan tam ekran iPhone uygulaması olarak açılır!

## Yerel Geliştirme ve Testler

```bash
npm install
npm test
npm start
```

Varsayılan olarak `http://localhost:3456` adresinde çalışır.
