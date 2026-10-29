# 🐝 Kovan — Tek prompt, çok ajan

**Canlı demo (Kovan Studio):** https://ramiz28615.github.io/new/


Tek bir cümle yazarsın; Kovan isteği görevlere böler, **Claude Code** ve **Codex** ajanlarına dağıtır,
ajanlar paralel çalışır, **birbirinin işini inceler** ve sonucu tek klasörde teslim eder.
Ajanlar ortak görev panosunu ve ortak hafızayı **MCP** üzerinden paylaşır.

## Kurulum (2 dakika)
```bash
# 1) Ajanlar (birini veya ikisini kur, giriş yap)
npm i -g @anthropic-ai/claude-code   && claude      # giriş
npm i -g @openai/codex               && codex login

# 2) Kovan
cd kovan && pip install -e .
kovan connect     # Claude Code + Codex'e MCP sunucusunu ekler
kovan doctor      # kontrol
```

## Kullanım
```bash
kovan run "Kafem için menü ve rezervasyon formu olan bir site yap, testlerini yaz" -d ./kafe
kovan dashboard          # http://localhost:7777 → web'den prompt yaz, canlı izle
kovan status
kovan run "deneme" --mock   # anahtarsız deneme
```
Seçenekler: `-b 3` (USD bütçe tavanı), `-w 4` (paralel ajan), `--planner codex`, `--no-review`,
`--yolo` (izin sormadan tam yetki, dikkatli kullan).

## Nasıl çalışır
1. **Planlayıcı** (Claude veya Codex) isteği 2–6 görevlik JSON plana çevirir, her görevi uygun ajana atar.
2. **İşçiler** paralel çalışır; MCP araçlarıyla ortak hafızayı okur/yazar, görev durumunu günceller.
3. **Çapraz inceleme:** Claude'un işini Codex, Codex'in işini Claude inceler. `CHANGES` derse görev 1 tur düzeltilir.
4. **Bütçe tavanı:** Claude'un bildirdiği maliyet tavanı geçerse yeni görev başlamaz.
5. Her şey canlı panoda görünür.

## MCP araçları (her iki ajanda da)
| Araç | İş |
|---|---|
| `kovan_status` | Aktif çalışma ve görevler |
| `kovan_task_list` / `kovan_task_add` / `kovan_task_update` | Ortak görev panosu |
| `kovan_memory_set` / `get` / `search` | Ajanlar arası ortak hafıza |
| `kovan_review_submit` | Onay / düzeltme isteği |
| `kovan_log` | Panoya ilerleme notu |

`kovan connect` sonrası Claude Code veya Codex'i normal kullanırken de bu araçlar hazırdır
(örn. "kovan hafızasına API adresimizi kaydet").

## Mimari
```
kovan/
  server.py        MCP sunucusu (stdio)
  orchestrator.py  plan → paralel işçiler → çapraz inceleme
  agents.py        claude -p / codex exec sarmalayıcıları
  dashboard.py     canlı pano + web'den prompt (stdlib, bağımlılıksız)
  db.py            SQLite ortak durum (~/.kovan/kovan.db, KOVAN_DB ile değişir)
  cli.py           kovan komutları
```

## SaaS'a giden yol
- Panoya kullanıcı girişi + çok kiracılı Postgres
- Ajanları bulutta Docker kum havuzunda çalıştırma
- Şablon pazarı (hazır tek-prompt tarifleri) ve Stripe abonelik
- Uzak MCP (HTTP) ile kullanıcının kendi makinesine bağlanma
