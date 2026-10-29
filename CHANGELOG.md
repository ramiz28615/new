# Değişiklik günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) esinlidir; sürümler [SemVer](https://semver.org/lang/tr/) izler.

## [0.3.0] - 2026-10-30

### Eklenenler — Kovan Studio gerçek bir yapay zekâ uygulama oluşturucu oldu
- **BYOK sağlayıcılar:** OpenRouter (varsayılan, canlı model listesi, ücretsiz filtre, fiyat/görsel bilgisi), Anthropic
  (tarayıcıdan doğrudan erişim başlığı), OpenAI (Chat Completions, OpenAI uyumlu taban adres), Google Gemini
  (`streamGenerateContent?alt=sse`). Hepsi akışlı (SSE); Türkçe hata açıklamaları (anahtar, bakiye, sınır, model, ağ/CORS).
- **Oluşturucu ekranı:** sohbet + çalışma alanı, telefonda sekmeli görünüm; `<file path>` / `<delete>` / `<rename>`
  protokolü için parçalara (etiket ortasından bile) dayanıklı akış ayrıştırıcı; dosyalar akış sırasında ağaçta belirir;
  takip mesajları mevcut projeyi bağlam olarak gönderir ve yalnızca değişen dosyaları uygular; güçlü sistem istemleri.
- **Proje türleri** (istekten otomatik algılama + seçici): Web, React (ESM/import map), Python (Pyodide ile çalıştır/test,
  micropip, stdin, argümanlar), Bash/Linux, Perl, Windows (.bat/.ps1), React Native (Expo Snack ile aç/önizle, EAS Build
  iş akışı). Bash/Perl/Windows için “indir ve çalıştır” komutları, yapay zekâ ile **İncele** (ShellCheck tarzı) ve
  yapıştırılan hata çıktısından **Hatayı düzelt**.
- **Python → .exe/ikili:** PyInstaller ile windows/ubuntu/macos matrisli GitHub Actions iş akışı üretimi; yayınla birlikte
  çalışır, Actions çalıştırma bağlantısı gösterilir.
- **Canlı önizleme:** sanal dosya sisteminden korumalı iframe (CSS/JS satır içi, ES modül importları ve görseller `data:` URL),
  sayfalar arası gezinme, cihaz boyutları, yeni sekmede aç, konsol yakalama ve **Hatayı düzelt**; önizlemede `localStorage` taklidi.
- **Kod editörü** (CodeMirror 5, düz metin yedeği), dosya oluştur/yükle/yeniden adlandır/sil, Ctrl/⌘+S.
- **Projeler:** IndexedDB (bellek yedeği), her turda sürüm, Geri al / Geçmiş, çoğalt, sil, ZIP içe/dışa aktar (JSZip),
  15 şablonluk galeri, anahtarsız denemek için örnek proje.
- **Gerçek yayın:** GitHub token'ı ile depo oluşturma, Git Data API ile tek commit, GitHub Pages'i açma ve derlemeyi
  yoklama, canlı adres, yayın geçmişi; Netlify sürükle-bırak için ZIP. Simüle “Yayınlar” sekmesi kaldırıldı.
- **Ekstralar:** görsel referans (görsel destekli modellere), ✨ Geliştir, token/maliyet tahmini ve gerçek kullanım,
  Durdur, Tekrar dene, klavye kısayolları, koyu/açık tema, Türkçe/İngilizce arayüz, sıkıştırılmış bağlantıyla paylaşım.
- **Testler:** `tests/js` altında Node testleri (sağlayıcı akışları stub fetch ile, ayrıştırıcı, düzenle/sil, ZIP, önizleme,
  GitHub yayın sırası, paylaşım, depolama, tür algılama, Python çalıştırıcı (stub Pyodide), Snack yükü, PyInstaller
  iş akışı, jsdom ile arayüz uçtan uca); CI'a Node işi eklendi.

### Değişenler
- Studio, tek dosyalık sayfadan `docs/js/*.js` ES modüllerine bölündü (derleme adımı yok). Not Defteri (Pyodide) ve
  Motor (yerel motor, token + SSE) korunup kenar menüye taşındı; Motor'da çalıştırma sonuçları Studio projesi olarak açılır.

## [0.2.0] - 2026-10-30

### Güvenlik
- Pano API'si artık **token** istiyor: ilk açılışta üretilip `~/.kovan/token` (chmod 600) dosyasına yazılır,
  `kovan dashboard` hazır bağlantıyla birlikte yazdırır. `/api/health` dışındaki tüm `/api/*` uç noktaları
  `Authorization: Bearer <token>` ister (GET isteklerinde, EventSource için `?token=` de kabul edilir).
- `CORS *` kaldırıldı; yalnızca izin listesi (`http://127.0.0.1:*`, `http://localhost:*`,
  `https://ramiz28615.github.io`, `KOVAN_ALLOWED_ORIGINS` ile değiştirilebilir).
- Varsayılan bağlanma adresi yalnızca `127.0.0.1`; loopback'te Host başlığı denetimi (DNS rebinding koruması).
- Web'den `yolo` yalnızca `kovan dashboard --allow-yolo` ile kabul edilir.
- Web'den açılan çalışma klasörleri `projects_root` (varsayılan `~/kovan-projects`) altında olmak zorunda;
  `/api/files` yol kaçışına (`..`, mutlak yol, dışarı işaret eden sembolik bağ) kapalı.
- İstek gövdesi boyut sınırı (varsayılan 1 MB), geçersiz JSON ve aralık dışı değerler reddedilir.

### Eklenenler
- **Görev bağımlılıkları (DAG):** planlayıcı `depends_on` döner; zamanlayıcı bir görevi bağımlılıkları
  onaylanınca başlatır, başarısız görevin bağımlılarını atlar, döngüleri tespit eder.
- **İptal / devam:** `kovan cancel <id>`, `POST /api/runs/<id>/cancel` (ajan süreç grupları sonlandırılır),
  `kovan resume <id>` ve `POST /api/runs/<id>/resume`.
- **Yeniden deneme:** geçici hatalarda üstel geri çekilmeyle yeniden deneme (varsayılan 1) ve görev başına zaman aşımı.
- **Canlı akış:** `GET /api/events?run=&after=` (Server-Sent Events); yerleşik pano 2 sn yoklama yerine SSE kullanır.
- **Git kontrol noktaları:** onaylanan her görevden sonra commit (`kovan: #id başlık`), `kovan diff`,
  `kovan rollback <run> --task <id>`, `GET /api/runs/<id>/tasks/<tid>/diff`.
- **Maliyet:** Codex token kullanımı çıktıdan ayrıştırılıp fiyat tablosuyla tahmin edilir; bütçe tavanı iki ajanı da kapsar;
  görev başına maliyet (`tasks.cost`).
- **Hafıza kapsamı:** hafıza çalışmaya özel ad alanında tutulur; MCP sunucusu `KOVAN_RUN` ile doğru çalışmayı hedefler;
  `global:` önekli anahtarlar tüm çalışmalarda ortaktır.
- **Rapor:** `kovan report <id>` çalışma klasörüne `REPORT.md` yazar; `GET /api/runs/<id>/report`.
- **Yapılandırma:** `~/.kovan/config.toml`, `kovan config`; JSON satırlı günlük `~/.kovan/kovan.log`; `kovan token [--rotate]`.
- Yerleşik pano yenilendi: token, SSE, iptal/devam, bağımlılıklar, görev maliyeti, dosya listesi, rapor, diff; mobil uyumlu.
- Kovan Studio Motor sekmesi: token alanı, Bearer başlığı, SSE, iptal düğmesi, anlaşılır Türkçe hata mesajları.
- GitHub Actions CI (Python 3.10–3.13, ruff, pytest), Dockerfile, LICENSE (MIT), SECURITY.md.

### Değişenler
- Sahte (mock) ajan artık gerçek CLI'lar gibi ayrı süreçte çalışır; iptal ve zaman aşımı yolları da sınanır.
- Eski veritabanları otomatik ve veri kaybı olmadan taşınır (`ALTER TABLE` + hafıza tablosu yeniden kurulumu).

## [0.1.0]
- İlk sürüm: planlayıcı, paralel Claude Code + Codex işçileri, çapraz inceleme, MCP sunucusu, canlı pano, Kovan Studio.
