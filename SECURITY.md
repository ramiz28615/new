# Güvenlik politikası

## Desteklenen sürümler

| Sürüm | Destek |
|---|---|
| 0.2.x | ✅ |
| 0.1.x | ❌ (yerel API'si kimlik doğrulamasız; lütfen yükseltin) |

## Tehdit modeli

Kovan, bilgisayarında **kod yazıp çalıştırabilen** ajanları (Claude Code, Codex) yöneten yerel bir motordur.
Bu yüzden yerel HTTP API'si uzaktan kod çalıştırma yüzeyi sayılır ve şöyle korunur:

- **Yalnızca loopback:** `kovan dashboard` varsayılan olarak `127.0.0.1`'e bağlanır. Loopback'te `Host` başlığı
  `127.0.0.1` / `localhost` / `::1` değilse istek reddedilir (DNS rebinding koruması).
- **Token:** İlk açılışta rastgele bir token (`secrets.token_urlsafe(32)`) üretilir ve `~/.kovan/token` dosyasına
  `600` izniyle yazılır. `/api/health` dışındaki her `/api/*` isteği `Authorization: Bearer <token>` ister.
  Tarayıcının `EventSource`'u başlık gönderemediği için yalnızca **GET** isteklerinde `?token=` kabul edilir;
  durum değiştiren **POST** istekleri her zaman başlık ister. Karşılaştırma sabit zamanlıdır (`hmac.compare_digest`).
  Token'ı yenilemek için: `kovan token --rotate`.
- **CORS izin listesi:** Yalnızca `http://127.0.0.1:*`, `http://localhost:*` ve `https://ramiz28615.github.io`
  (Kovan Studio). `KOVAN_ALLOWED_ORIGINS` (virgülle ayrılmış) veya `config.toml` içindeki `allowed_origins` ile değiştirilir.
  İzin listesinde olmayan bir `Origin` 403 alır ve CORS başlığı dönmez.
- **yolo kapalı:** Ajanlara izin sormadan tam yetki veren `yolo`, web API'sinden yalnızca pano
  `--allow-yolo` ile başlatıldıysa kabul edilir.
- **Klasör sınırı:** Web'den başlatılan çalışmaların klasörü `projects_root` (varsayılan `~/kovan-projects`,
  `KOVAN_PROJECTS_ROOT`) altında olmak zorundadır. `/api/files` yalnızca çalışmanın klasöründeki dosyaları verir;
  `..`, mutlak yollar ve dışarı işaret eden sembolik bağlar reddedilir.
- **Gövde sınırı:** POST gövdesi en fazla `max_body_bytes` (varsayılan 1 MB).

### Bilinen sınırlar
- Token, aynı kullanıcı hesabıyla çalışan her yerel süreç tarafından okunabilir (dosya izinleri gereği).
- `--host 0.0.0.0` kullanırsan Host denetimi devre dışı kalır; ağdaki herkes token'ı bilirse erişebilir.
  Bunu yalnızca güvendiğin ağlarda ya da konteynerde (`-p 127.0.0.1:7777:7777`) yap.
- Ajanların kendisi (Claude Code / Codex) çalışma klasöründe dosya yazar ve komut çalıştırabilir; `yolo` olmadan bile
  güvenmediğin istekleri çalıştırma.

## Açık bildirme

Lütfen güvenlik açıklarını herkese açık issue olarak değil, GitHub'daki
**Security → Report a vulnerability** (özel bildirim) üzerinden ilet. 72 saat içinde dönüş hedeflenir.
