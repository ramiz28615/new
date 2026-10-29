# Değişiklik günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) esinlidir; sürümler [SemVer](https://semver.org/lang/tr/) izler.

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
