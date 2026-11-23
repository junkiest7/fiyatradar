# FiyatRadar — Türkiye Detaylı Fiyat Araştırma Botu (iOS PWA + Web)

Türkiye e-ticaret piyasasındaki (Trendyol, Hepsiburada, Amazon Türkiye, n11, Stradivarius, Zara, Boyner, Pazarama, idefix, PttAVM, Migros, MediaMarkt, Teknosa, Vatan vb.) ürün fiyatlarını canlı olarak toplayan, **kargo dahil net maliyet**, **birim fiyat**, **taksit hesabı**, **barkod tarama**, **mağaza linki çözümleme** ve **sepet maliyet optimizasyonu** sunan iPhone (iOS PWA) ve web uygulamasıdır.

## Öne Çıkan Özellikler

- **iPhone İçin Yerel Uygulama Deneyimi (iOS PWA):** 5 sekmeli alt bar (Araştır / Kıyasla / Sepet / Takip / Geçmiş), Dynamic Island & güvenli alan (`safe-area-inset`) uyumu, parmakla kaydırılabilir fiyat grafiği, yerel iOS Paylaş menüsü ve özel ana ekran ikonu.
- **Link Yapıştır → Tüm Türkiye'de En Ucuzunu Bul:** Trendyol (`ty.gl`), Hepsiburada, Amazon TR (`amzn.eu`), Stradivarius, Zara, Mango, Boyner, n11, MediaMarkt, Teknosa, Vatan veya Cimri ürün linkini yapıştırdığınızda ürünü otomatik çözer ve rakip mağazalardaki daha ucuz teklifleri listeler.
- **iPhone Kamera Barkod Tarayıcı (EAN-13 / UPC):** Mağazada veya süpermarkette ürün barkodunu kamerayla okutup (iOS Safari `@zxing/browser` destekli) internet fiyatlarıyla anında kıyaslar.
- **Akıllı Arama Motoru v2 + Aksesuar & Şüpheli Ucuz Filtresi:** Türkçe karakter uyumlu yedek sorgular, gerçek ürün görseli zenginleştirme, `kılıf / kordon / pişirme kağıdı` otomatik aksesuar ayrıştırması ve medyanın çok altındaki şüpheli ucuz / muadil ilan tespiti.
- **Hızlı Filtre Çipleri & Kredi Kartı Taksit Hesaplayıcı:** Arama sonuçlarında tek dokunuşla mağaza, ücretsiz kargo ve aksesuar filtreleme; ürün detayında `Peşin / 3 / 6 / 9 / 12 Taksit` ve vade farkı hesabı.
- **Sepet Maliyet Optimizatörü:** Alacağınız birden fazla ürünü ekleyerek kargo barajlarına göre **Karışık Mağaza** mı yoksa **Tek Mağaza** mı daha ucuz otomatik hesaplar.
- **Kargo Dahil Net Maliyet, Kargo Tuzağı Tespiti & Kişisel Fiyat Geçmişi:** Etiket/kargo tuzaklarını yakalar, takip listesindeki ürünlerde her kontrolde kişisel fiyat geçmişi grafiğinizi otomatik biriktirir (iPhone yerel yedeklemeli), Türkçe Excel uyumlu CSV & JSON dışa aktarır.

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
