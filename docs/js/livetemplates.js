// Ready-made live-data projects (docs/templates/<id>/). They work out of the box without an AI key: files are loaded
// from the Studio's own site, the Studio-managed kovan-config.js / kovan-db.js are added, and the project can then be
// changed from the chat like any other.
import { ensureHelpers, schemaSql } from "./backend.js";

export const LIVE_TEMPLATES = [
  { id: "live-weather", dir: "hava", type: "web", icon: "⛅", files: ["index.html", "style.css", "app.js"], apis: ["open-meteo", "open-meteo-geocoding", "open-meteo-air", "wttr"],
    prompt: "Open-Meteo ile canlı hava durumu sitesi: İstanbul varsayılan, şehir arama, anlık durum, 24 saatlik ve 7 günlük tahmin, hava kalitesi; 15 dakikada bir yenilensin." },
  { id: "live-fx", dir: "doviz-kripto", type: "web", icon: "💱", files: ["index.html", "style.css", "app.js"], apis: ["frankfurter", "er-api", "binance"],
    prompt: "TRY bazlı canlı döviz ve kripto takip panosu: ECB kurları (Frankfurter), çevirici, 30 günlük grafik, Binance TRY paritelerinde 30 sn'de bir yenilenen fiyatlar." },
  { id: "live-quake", dir: "deprem", type: "web", icon: "🌍", files: ["index.html", "style.css", "app.js"], apis: ["usgs", "carto-tiles"],
    prompt: "USGS verisiyle deprem haritası: Leaflet + CARTO haritada büyüklüğe göre işaretler, Türkiye/dünya filtresi, büyüklük kaydırıcısı, liste ve dakikada bir yenileme." },
  { id: "live-news", dir: "uzay-haber", type: "web", icon: "🚀", files: ["index.html", "style.css", "app.js"], apis: ["spaceflight-news", "nasa-apod"],
    prompt: "Uzay haberleri sitesi: Spaceflight News API'den haber/blog/rapor sekmeleri, arama, daha fazla yükle ve NASA günün astronomi görseli." },
  { id: "live-tv", dir: "dizi-arama", type: "web", icon: "🎬", files: ["index.html", "style.css", "app.js"], apis: ["tvmaze"],
    prompt: "TVmaze ile dizi arama: bugünün yayın akışı, anlık arama, poster kartları, oyuncu ve bölüm ayrıntıları, kalıcı “Listem”." },
  { id: "live-booking", dir: "rezervasyon", type: "web", icon: "🍽️", files: ["index.html", "style.css", "app.js"], apis: ["themealdb", "open-meteo"], collections: ["rezervasyonlar"],
    prompt: "Restoran rezervasyon sitesi: gerçekten gönderilen form (Web3Forms/FormSubmit/Formspree ya da Supabase, yoksa yerel kayıt), TheMealDB'den menü görselleri, seçilen günün hava tahmini." },
];

export const DEMO_TEMPLATE = { id: "live-dashboard", dir: "canli-pano", type: "web", icon: "📡", files: ["index.html", "kaynaklar.html", "style.css", "app.js"], apis: ["open-meteo", "frankfurter", "binance", "wttr"] };

export function templateBase() { return new URL("../templates/", import.meta.url); }

/** Fetch a template's files and add the Studio helpers. Throws with a Turkish message when the files can't be loaded. */
export async function loadLiveTemplate(tpl, { backend = {}, fetchImpl = globalThis.fetch, base = templateBase() } = {}) {
  const get = async (rel) => {
    const r = await fetchImpl(new URL(rel, base).href);
    if (!r.ok) throw new Error("Şablon dosyası alınamadı: " + rel + " (HTTP " + r.status + ")");
    return r.text();
  };
  const files = {};
  const names = ["base.css", ...tpl.files];
  const texts = await Promise.all(names.map((f) => get(f === "base.css" ? "base.css" : tpl.dir + "/" + f)));
  names.forEach((f, i) => { files[f] = texts[i]; });
  ensureHelpers(files, backend);
  if (tpl.collections) files["supabase/schema.sql"] = schemaSql(tpl.collections);
  files["README.md"] = readme(tpl);
  return files;
}

function readme(tpl) {
  return `# ${tpl.icon} ${tpl.id}\n\nKovan Studio canlı veri şablonu. Tüm veriler çalışma anında ücretsiz, anahtarsız açık API'lerden gelir (${tpl.apis.join(", ")}).\n\n` +
    "- `kovan-db.js`: veri katmanı (önbellekli fetch, yerel/Supabase veritabanı, form gönderimi) — Kovan Studio yönetir.\n" +
    "- `kovan-config.js`: yalnızca herkese açık ayarlar (form anahtarı, Supabase URL + anon anahtar).\n" +
    (tpl.collections ? "- `supabase/schema.sql`: Supabase SQL Editor'da çalıştır (RLS politikaları dahil).\n" : "") +
    "\nGitHub Pages veya herhangi bir statik barındırmada olduğu gibi çalışır.\n";
}
