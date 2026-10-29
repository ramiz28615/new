// Live data API catalog for generated apps: keyless, CORS-enabled, free public APIs.
// Every entry was checked from a server on 2026-10-30 (HTTP 200 + Access-Control-Allow-Origin present);
// re-run `node tests/live/check-apis.mjs` to check them again. Entries with `status: "limited"` sent CORS headers but
// were not reliably 200 from the shared test server (per-IP quota 429, or intermittent 5xx for NASA APOD); use them
// with caching and graceful fallbacks. Nominatim was dropped: it answered 429 without CORS headers to the test IP.

export const VERIFIED_AT = "2026-10-30";

export const CATEGORIES = {
  hava: "Hava durumu", finans: "Döviz", kripto: "Kripto", harita: "Harita & konum", deprem: "Deprem",
  bilgi: "Bilgi & ansiklopedi", haber: "Haber", uzay: "Uzay", yemek: "Yemek & içecek", eglence: "Film, dizi & müzik",
  ag: "IP & ağ", gorsel: "Görsel & avatar", soz: "Söz & eğlence", hayvan: "Hayvanlar", gelistirici: "Geliştirici", demo: "Yalnızca demo",
};

const E = (o) => Object.freeze({ status: "ok", keywords: [], attribution: "", ...o });

export const CATALOG = Object.freeze([
  // ---------------------------------------------------------------- weather
  E({ id: "open-meteo", name: "Open-Meteo Hava Tahmini", category: "hava", base: "https://api.open-meteo.com/v1",
    example: "https://api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.98&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7",
    sample: '{"current":{"time":"2026-10-30T02:00","temperature_2m":13.4,"weather_code":3,"wind_speed_10m":9.1},"daily":{"time":["2026-10-30",…],"temperature_2m_max":[17.2,…]}}',
    rate: "Anahtarsız, ticari olmayan kullanımda ~10.000 istek/gün/IP. 10–15 dk önbellekle.", status: "limited",
    desc: "Koordinata göre anlık hava, saatlik ve 16 güne kadar günlük tahmin. weather_code WMO kodudur (0 açık, 1–3 bulutlu, 45 sis, 61–65 yağmur, 71–75 kar, 95 fırtına).",
    attribution: 'Hava verisi: <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0)',
    keywords: ["hava", "weather", "sıcaklık", "derece", "tahmin", "forecast", "yağmur", "rüzgar", "iklim", "meteoroloji", "piknik", "tatil"] }),
  E({ id: "open-meteo-geocoding", name: "Open-Meteo Şehir Arama", category: "hava", base: "https://geocoding-api.open-meteo.com/v1",
    example: "https://geocoding-api.open-meteo.com/v1/search?name=Ankara&count=5&language=tr&format=json",
    sample: '{"results":[{"name":"Ankara","latitude":39.92,"longitude":32.85,"country":"Türkiye","admin1":"Ankara","timezone":"Europe/Istanbul"}]}',
    rate: "Anahtarsız; aramaları 300 ms debounce et.",
    desc: "Şehir/ilçe adından koordinat ve saat dilimi bulur (Türkçe sonuç). Hava durumu ile birlikte kullan.",
    attribution: 'Konum verisi: <a href="https://open-meteo.com/">Open-Meteo.com</a> / GeoNames',
    keywords: ["şehir", "city", "il", "ilçe", "koordinat", "geocode", "hava", "weather", "konum"] }),
  E({ id: "open-meteo-air", name: "Open-Meteo Hava Kalitesi", category: "hava", base: "https://air-quality-api.open-meteo.com/v1",
    example: "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=41.01&longitude=28.98&current=european_aqi,pm10,pm2_5,ozone&timezone=auto",
    sample: '{"current":{"time":"2026-10-30T02:00","european_aqi":38,"pm10":21.3,"pm2_5":12.8}}',
    rate: "Anahtarsız, saatlik veri; 30 dk önbellekle.",
    desc: "Hava kalitesi indeksi (Avrupa AQI), PM10, PM2.5, ozon. Sağlık/şehir panolarında kullan.",
    attribution: 'Hava kalitesi: <a href="https://open-meteo.com/">Open-Meteo.com</a> / CAMS',
    keywords: ["hava kalitesi", "air quality", "aqi", "pm2.5", "kirlilik", "polen", "sağlık"] }),
  E({ id: "wttr", name: "wttr.in (yedek hava)", category: "hava", base: "https://wttr.in",
    example: "https://wttr.in/Istanbul?format=j1&lang=tr",
    sample: '{"current_condition":[{"temp_C":"13","FeelsLikeC":"12","humidity":"77","lang_tr":[{"value":"Parçalı bulutlu"}]}],"weather":[{"date":"2026-10-30","maxtempC":"17","mintempC":"11"}]}',
    rate: "Anahtarsız, yoğun kullanımda yavaşlayabilir; yalnızca yedek olarak kullan.",
    desc: "Şehir adıyla anlık hava ve 3 günlük tahmin (Türkçe açıklama). Open-Meteo yanıt vermezse yedek kaynak.",
    attribution: 'Hava: <a href="https://wttr.in">wttr.in</a>',
    keywords: ["hava", "weather", "yedek", "sıcaklık"] }),
  E({ id: "sunrise-sunset", name: "Sunrise-Sunset", category: "hava", base: "https://api.sunrise-sunset.org",
    example: "https://api.sunrise-sunset.org/json?lat=41.01&lng=28.98&formatted=0",
    sample: '{"results":{"sunrise":"2026-10-30T04:32:10+00:00","sunset":"2026-10-30T15:03:01+00:00","day_length":37851},"status":"OK"}',
    rate: "Anahtarsız; günde bir kez önbellekle.",
    desc: "Gün doğumu/batımı, alacakaranlık ve gün uzunluğu (UTC ISO; tr-TR saatine çevir).",
    attribution: 'Güneş saatleri: <a href="https://sunrise-sunset.org/api">Sunrise-Sunset.org</a>',
    keywords: ["gün doğumu", "gün batımı", "sunrise", "sunset", "güneş", "iftar", "sahur", "fotoğraf"] }),

  // ---------------------------------------------------------------- currency
  E({ id: "frankfurter", name: "Frankfurter (ECB kurları)", category: "finans", base: "https://api.frankfurter.dev/v1",
    example: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR,GBP",
    sample: '{"amount":1.0,"base":"USD","date":"2026-10-29","rates":{"TRY":49.837,"EUR":0.86}}',
    rate: "Anahtarsız, sınırsız; kurlar iş günlerinde ~16:00 CET güncellenir. 1 saat önbellekle. Geçmiş: /v1/2026-01-01..?base=USD&symbols=TRY",
    desc: "Avrupa Merkez Bankası referans kurları (TRY dahil), geçmiş tarih ve zaman serisi. Döviz çevirici ve grafikler için.",
    attribution: 'Kurlar: <a href="https://frankfurter.dev">Frankfurter</a> / ECB',
    keywords: ["döviz", "kur", "dolar", "euro", "avro", "sterlin", "currency", "exchange", "çevirici", "converter", "try", "usd", "eur", "finans", "para"] }),
  E({ id: "er-api", name: "ExchangeRate-API (open)", category: "finans", base: "https://open.er-api.com/v6",
    example: "https://open.er-api.com/v6/latest/USD",
    sample: '{"result":"success","time_last_update_utc":"Thu, 30 Oct 2026 00:02:31 +0000","base_code":"USD","rates":{"TRY":49.9,"EUR":0.86,…}}',
    rate: "Anahtarsız, günde 1 güncelleme; 160+ para birimi. Atıf zorunlu.",
    desc: "160'tan fazla para biriminin günlük kurları (Frankfurter'da olmayan birimler için).",
    attribution: '<a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>',
    keywords: ["döviz", "kur", "currency", "exchange", "para birimi", "riyal", "dirhem", "ruble"] }),

  // ---------------------------------------------------------------- crypto
  E({ id: "binance", name: "Binance Piyasa Verisi", category: "kripto", base: "https://data-api.binance.vision/api/v3",
    example: "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCTRY%22,%22ETHTRY%22,%22BTCUSDT%22%5D",
    sample: '[{"symbol":"BTCTRY","lastPrice":"3910681.00","priceChangePercent":"-3.255","highPrice":"4051000.00","volume":"52.1"}]',
    rate: "Anahtarsız salt-okunur uç (data-api.binance.vision; api.binance.com bazı bölgelerde 451 verir). 30–60 sn'de bir yenile. Mum grafiği: /klines?symbol=BTCTRY&interval=1h&limit=48",
    desc: "Kripto paraların anlık fiyatı ve 24 saatlik değişimi, TRY pariteleri (BTCTRY, ETHTRY, …) ve mum verileri.",
    attribution: "Fiyatlar: Binance",
    keywords: ["kripto", "crypto", "bitcoin", "btc", "ethereum", "eth", "coin", "borsa", "fiyat", "binance", "usdt", "takip"] }),
  E({ id: "coingecko", name: "CoinGecko", category: "kripto", base: "https://api.coingecko.com/api/v3",
    example: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=try,usd&include_24hr_change=true",
    sample: '{"bitcoin":{"try":3911000,"usd":78850,"try_24h_change":-3.2}}',
    rate: "Anahtarsız genel uç ~5–15 istek/dk/IP; 429 alırsan geri çekil ve önbellekten göster. /coins/markets?vs_currency=try ile logolu liste.",
    desc: "Binlerce kripto paranın fiyatı, piyasa değeri ve logosu (coins/markets). Logo ve sıralama için Binance'e tamamlayıcı.",
    attribution: 'Veri: <a href="https://www.coingecko.com">CoinGecko</a>', status: "limited",
    keywords: ["kripto", "crypto", "coin", "piyasa değeri", "market cap", "logo", "altcoin", "bitcoin"] }),

  // ---------------------------------------------------------------- maps & geo
  E({ id: "carto-tiles", name: "Leaflet + CARTO harita karoları", category: "harita", base: "https://{s}.basemaps.cartocdn.com",
    example: "https://a.basemaps.cartocdn.com/light_all/5/18/11.png",
    sample: "PNG karo. Leaflet: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19,attribution:'© OpenStreetMap katkıcıları © CARTO'})",
    rate: "Ücretsiz (ticari olmayan, ~75k görüntüleme/ay). Koyu tema: dark_all. Leaflet 1.9.4: unpkg.com/leaflet@1.9.4/dist/leaflet.js + leaflet.css",
    desc: "Etkileşimli harita: Leaflet kütüphanesi + CARTO karoları (OSM verisi). Referer gerektirmediği için önizlemede de çalışır.",
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları © <a href="https://carto.com/attributions">CARTO</a>',
    keywords: ["harita", "map", "konum", "leaflet", "osm", "adres", "işaretçi", "marker", "şube", "rota"] }),
  E({ id: "countriesnow", name: "CountriesNow", category: "harita", base: "https://countriesnow.space/api/v0.1",
    example: "https://countriesnow.space/api/v0.1/countries/capital",
    sample: '{"error":false,"data":[{"name":"Turkey","capital":"Ankara","iso2":"TR"}]}',
    rate: "Anahtarsız; listeler statik, 1 gün önbellekle. Bayrak: /countries/flag/images, şehirler: POST /countries/cities {country}",
    desc: "Ülke, başkent, bayrak ve şehir listeleri (ülke/şehir seçicileri için).",
    keywords: ["ülke", "country", "başkent", "bayrak", "flag", "şehir listesi", "seçici", "quiz"] }),

  // ---------------------------------------------------------------- earthquakes
  E({ id: "usgs", name: "USGS Deprem Akışı", category: "deprem", base: "https://earthquake.usgs.gov/earthquakes/feed/v1.0",
    example: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    sample: '{"type":"FeatureCollection","features":[{"properties":{"mag":4.6,"place":"10 km S of …","time":1793300000000,"url":"https://…"},"geometry":{"coordinates":[28.9,40.8,10]}}]}',
    rate: "Anahtarsız, akış 1 dk'da bir güncellenir; 60 sn'den sık çekme. Diğer akışlar: all_hour, 4.5_week, significant_month",
    desc: "Dünya genelindeki depremler (büyüklük, yer, zaman, derinlik, koordinat) GeoJSON olarak.",
    attribution: 'Deprem verisi: <a href="https://earthquake.usgs.gov">USGS</a>',
    keywords: ["deprem", "earthquake", "sarsıntı", "büyüklük", "fay", "afet", "sismik"] }),
  E({ id: "kandilli", name: "Kandilli Rasathanesi (topluluk API)", category: "deprem", base: "https://api.orhanaydogdu.com.tr/deprem",
    example: "https://api.orhanaydogdu.com.tr/deprem/kandilli/live?limit=50",
    sample: '{"status":true,"result":[{"title":"MARMARA DENIZI","mag":2.1,"depth":7.5,"date":"2026.10.30 01:12:44","geojson":{"coordinates":[28.1,40.8]}}]}',
    rate: "Gönüllü işletilen topluluk API'si (resmî değil); 60 sn önbellek, hata olursa USGS'e düş.",
    desc: "Türkiye ve çevresindeki son depremler (Kandilli verisi, Türkçe yer adları).",
    attribution: "Veri: Boğaziçi Üniv. Kandilli Rasathanesi (api.orhanaydogdu.com.tr üzerinden)",
    keywords: ["deprem", "kandilli", "türkiye", "afad", "son depremler", "earthquake"] }),
  E({ id: "emsc", name: "EMSC SeismicPortal", category: "deprem", base: "https://www.seismicportal.eu/fdsnws/event/1",
    example: "https://www.seismicportal.eu/fdsnws/event/1/query?limit=20&format=json&minlat=35&maxlat=43&minlon=25&maxlon=45",
    sample: '{"type":"FeatureCollection","features":[{"properties":{"mag":3.1,"flynn_region":"WESTERN TURKEY","time":"2026-10-29T22:10:11Z"}}]}',
    rate: "Anahtarsız FDSN servisi; bölge kutusuyla sorgula, 60 sn önbellek.",
    desc: "Avrupa-Akdeniz Sismoloji Merkezi deprem kataloğu; bölge/büyüklük filtresi.",
    attribution: 'Veri: <a href="https://www.emsc-csem.org">EMSC</a>',
    keywords: ["deprem", "earthquake", "emsc", "akdeniz", "avrupa"] }),

  // ---------------------------------------------------------------- knowledge
  E({ id: "wikipedia-summary", name: "Wikipedia Özet", category: "bilgi", base: "https://tr.wikipedia.org/api/rest_v1",
    example: "https://tr.wikipedia.org/api/rest_v1/page/summary/%C4%B0stanbul",
    sample: '{"title":"İstanbul","extract":"İstanbul, Türkiye\'nin en kalabalık…","thumbnail":{"source":"https://upload.wikimedia.org/…jpg"},"content_urls":{"desktop":{"page":"https://tr.wikipedia.org/wiki/İstanbul"}}}',
    rate: "Anahtarsız; ~200 istek/sn sınırı. Başlığı encodeURIComponent ile kodla.",
    desc: "Bir konunun kısa özeti ve gerçek görseli (thumbnail). Şehir, kişi, ürün sayfalarında gerçek içerik/görsel için.",
    attribution: 'İçerik: <a href="https://tr.wikipedia.org">Vikipedi</a> (CC BY-SA 4.0)',
    keywords: ["wikipedia", "vikipedi", "bilgi", "ansiklopedi", "özet", "tarih", "şehir", "biyografi", "görsel", "rehber", "gezi"] }),
  E({ id: "wikipedia-search", name: "Wikipedia Arama", category: "bilgi", base: "https://tr.wikipedia.org/w/api.php",
    example: "https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=kapadokya&format=json&origin=*&srlimit=10",
    sample: '{"query":{"search":[{"title":"Kapadokya","snippet":"…<span class=\\"searchmatch\\">Kapadokya</span>…","pageid":123}]}}',
    rate: "Anahtarsız; CORS için origin=* parametresi ŞART. snippet HTML içerir — temizle.",
    desc: "Vikipedi'de tam metin arama. Arama kutusu + özet kartları için.",
    attribution: 'İçerik: <a href="https://tr.wikipedia.org">Vikipedi</a> (CC BY-SA 4.0)',
    keywords: ["wikipedia", "vikipedi", "ansiklopedi", "bilgi", "arama motoru"] }),
  E({ id: "wikimedia-feed", name: "Vikipedi Günün İçeriği", category: "bilgi", base: "https://api.wikimedia.org/feed/v1/wikipedia",
    example: "https://api.wikimedia.org/feed/v1/wikipedia/tr/featured/2026/10/29",
    sample: '{"mostread":{"articles":[{"title":"…","views":17791,"thumbnail":{…}}]},"onthisday":[{"text":"…","year":1923}]}',
    rate: "Anahtarsız (500 istek/saat/IP); günde bir kez önbellekle. Tarih YYYY/MM/DD.",
    desc: "Günün en çok okunanları, tarihte bugün, günün resmi. Ana sayfa “bugün” kutuları için.",
    attribution: 'İçerik: <a href="https://www.wikimedia.org">Wikimedia</a> (CC BY-SA 4.0)',
    keywords: ["tarihte bugün", "bugün", "gündem", "en çok okunan", "günün", "wikipedia"] }),

  // ---------------------------------------------------------------- news
  E({ id: "spaceflight-news", name: "Spaceflight News API", category: "haber", base: "https://api.spaceflightnewsapi.net/v4",
    example: "https://api.spaceflightnewsapi.net/v4/articles/?limit=12&ordering=-published_at",
    sample: '{"count":36711,"results":[{"title":"…","summary":"…","image_url":"https://…jpg","news_site":"SpaceNews","published_at":"2026-10-29T18:00:00Z","url":"https://…"}]}',
    rate: "Anahtarsız; 10 dk önbellek. Arama: ?search=mars, blog: /blogs/, raporlar: /reports/",
    desc: "Uzay ve havacılık haberleri (gerçek görsel, kaynak, tarih). Haber sitesi şablonları için.",
    attribution: 'Haberler: <a href="https://spaceflightnewsapi.net">Spaceflight News API</a>',
    keywords: ["haber", "news", "uzay", "space", "nasa", "spacex", "roket", "astronomi", "bülten", "blog"] }),
  E({ id: "hackernews", name: "Hacker News", category: "haber", base: "https://hacker-news.firebaseio.com/v0",
    example: "https://hacker-news.firebaseio.com/v0/topstories.json",
    sample: "[50296470,50289418,…]  → /v0/item/50296470.json → {\"title\":\"…\",\"url\":\"…\",\"score\":312,\"by\":\"…\",\"time\":1793300000,\"descendants\":120}",
    rate: "Anahtarsız; ilk 20–30 ID'yi Promise.all ile çek, 5 dk önbellek.",
    desc: "Teknoloji haberleri (en iyi/yeni/sor/göster listeleri, puan, yorum sayısı).",
    attribution: 'Haberler: <a href="https://news.ycombinator.com">Hacker News</a>',
    keywords: ["haber", "news", "teknoloji", "tech", "yazılım", "startup", "hacker news", "gündem"] }),

  // ---------------------------------------------------------------- space
  E({ id: "nasa-apod", name: "NASA Günün Astronomi Görseli", category: "uzay", base: "https://api.nasa.gov/planetary",
    example: "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY",
    sample: '{"date":"2026-10-29","title":"…","explanation":"…","url":"https://apod.nasa.gov/apod/image/…jpg","media_type":"image"}',
    rate: "DEMO_KEY: 30 istek/saat, 50/gün/IP; servis zaman zaman 500 döndürür — günde bir kez çek, localStorage'da tut ve yalnızca isteğe bağlı bölümlerde kullan. media_type 'video' olabilir.", status: "limited",
    desc: "Her gün yeni bir uzay fotoğrafı ve açıklaması (İngilizce). Uzay temalı sayfalara gerçek görsel.",
    attribution: 'Görsel: <a href="https://apod.nasa.gov">NASA APOD</a>',
    keywords: ["nasa", "uzay", "space", "astronomi", "gökyüzü", "galaksi", "yıldız", "apod"] }),

  // ---------------------------------------------------------------- food
  E({ id: "themealdb", name: "TheMealDB", category: "yemek", base: "https://www.themealdb.com/api/json/v1/1",
    example: "https://www.themealdb.com/api/json/v1/1/filter.php?a=Turkish",
    sample: '{"meals":[{"idMeal":"53262","strMeal":"Adana kebab","strMealThumb":"https://www.themealdb.com/images/media/meals/….jpg"}]}',
    rate: "Herkese açık test anahtarı '1' (eğitim/geliştirme). Detay: lookup.php?i=ID, arama: search.php?s=",
    desc: "Gerçek yemek tarifleri, malzemeler ve fotoğraflar (Türk mutfağı: filter.php?a=Turkish). Tarif/restoran menüsü görselleri.",
    attribution: 'Tarifler: <a href="https://www.themealdb.com">TheMealDB</a>',
    keywords: ["yemek", "tarif", "recipe", "mutfak", "restoran", "menü", "kebap", "food", "meal", "aşçı"] }),
  E({ id: "thecocktaildb", name: "TheCocktailDB", category: "yemek", base: "https://www.thecocktaildb.com/api/json/v1/1",
    example: "https://www.thecocktaildb.com/api/json/v1/1/filter.php?a=Non_Alcoholic",
    sample: '{"drinks":[{"idDrink":"12560","strDrink":"Afterglow","strDrinkThumb":"https://…jpg"}]}',
    rate: "Herkese açık test anahtarı '1'. Detay: lookup.php?i=ID",
    desc: "İçecek/kokteyl tarifleri ve fotoğrafları (alkolsüz filtre dahil). Kafe/bar menüleri için.",
    attribution: 'İçecekler: <a href="https://www.thecocktaildb.com">TheCocktailDB</a>',
    keywords: ["içecek", "kokteyl", "cocktail", "bar", "kafe", "drink", "mocktail", "smoothie"] }),
  E({ id: "openfoodfacts", name: "Open Food Facts", category: "yemek", base: "https://world.openfoodfacts.org/api/v2",
    example: "https://world.openfoodfacts.org/api/v2/product/737628064502.json?fields=product_name,brands,nutriments,image_url,nutriscore_grade",
    sample: '{"product":{"product_name":"…","brands":"…","nutriscore_grade":"c","nutriments":{"energy-kcal_100g":385}}}',
    rate: "Anahtarsız okuma; arama 10 istek/dk sınırlı, ürün sorgusu 100/dk. fields= ile yanıtı küçült.",
    desc: "Barkoddan ürün bilgisi, besin değerleri ve Nutri-Score. Kalori/diyet uygulamaları için.",
    attribution: 'Veri: <a href="https://openfoodfacts.org">Open Food Facts</a> (ODbL)',
    keywords: ["barkod", "kalori", "besin", "diyet", "ürün", "nutrition", "beslenme", "market"] }),

  // ---------------------------------------------------------------- entertainment
  E({ id: "tvmaze", name: "TVmaze", category: "eglence", base: "https://api.tvmaze.com",
    example: "https://api.tvmaze.com/search/shows?q=office",
    sample: '[{"score":0.9,"show":{"id":526,"name":"The Office","genres":["Comedy"],"rating":{"average":8.6},"image":{"medium":"https://static.tvmaze.com/…jpg"},"summary":"<p>…</p>","premiered":"2005-03-24"}}]',
    rate: "Anahtarsız; 20 istek/10 sn/IP. Detay: /shows/ID?embed=cast, bölümler: /shows/ID/episodes, yayın akışı: /schedule?country=US",
    desc: "Dizi/TV programı arama, posterler, puanlar, oyuncular, bölümler ve yayın akışı.",
    attribution: 'Veri: <a href="https://www.tvmaze.com">TVmaze</a> (CC BY-SA)',
    keywords: ["dizi", "film", "tv", "show", "series", "movie", "poster", "oyuncu", "izle", "sinema", "imdb"] }),
  E({ id: "itunes", name: "iTunes Search", category: "eglence", base: "https://itunes.apple.com",
    example: "https://itunes.apple.com/search?term=tarkan&media=music&entity=song&limit=10&country=tr",
    sample: '{"resultCount":10,"results":[{"trackName":"Şımarık","artistName":"Tarkan","artworkUrl100":"https://…jpg","previewUrl":"https://…m4a","collectionName":"…"}]}',
    rate: "Anahtarsız; ~20 istek/dk. previewUrl 30 sn'lik gerçek önizleme sesidir. Filmler: media=movie, podcast: media=podcast",
    desc: "Şarkı, albüm, film, podcast ve uygulama arama; kapak görselleri ve 30 sn önizleme.",
    attribution: "Veri: Apple iTunes Search API",
    keywords: ["müzik", "şarkı", "music", "song", "albüm", "sanatçı", "podcast", "çalar", "player", "itunes", "film"] }),
  E({ id: "pokeapi", name: "PokéAPI", category: "eglence", base: "https://pokeapi.co/api/v2",
    example: "https://pokeapi.co/api/v2/pokemon/pikachu",
    sample: '{"id":25,"name":"pikachu","types":[{"type":{"name":"electric"}}],"stats":[…],"sprites":{"other":{"official-artwork":{"front_default":"https://…png"}}}}',
    rate: "Anahtarsız, adil kullanım; yanıtlar değişmez — localStorage'da kalıcı önbellekle.",
    desc: "Pokémon verileri ve resmi görseller. Oyun, quiz ve kart koleksiyonu uygulamaları için.",
    attribution: 'Veri: <a href="https://pokeapi.co">PokéAPI</a>',
    keywords: ["pokemon", "pokédex", "oyun", "game", "kart", "quiz"] }),

  // ---------------------------------------------------------------- ip / network
  E({ id: "ipwho", name: "ipwho.is", category: "ag", base: "https://ipwho.is",
    example: "https://ipwho.is/",
    sample: '{"ip":"…","success":true,"country":"Türkiye","city":"Istanbul","latitude":41.0,"longitude":28.9,"timezone":{"id":"Europe/Istanbul"}}',
    rate: "Anahtarsız, ticari olmayan ~10.000/ay. Yalnızca yaklaşık konum; izin istemeden varsayılan şehir için.",
    desc: "Ziyaretçinin IP'sinden yaklaşık ülke/şehir/saat dilimi (konum izni istemeden varsayılan şehir seçimi).",
    keywords: ["ip", "konumum", "location", "ülke", "otomatik konum", "ziyaretçi"] }),
  E({ id: "ipapi", name: "ipapi.co", category: "ag", base: "https://ipapi.co",
    example: "https://ipapi.co/json/",
    sample: '{"ip":"…","city":"Istanbul","country_name":"Türkiye","currency":"TRY","latitude":41.0,"longitude":28.9}',
    rate: "Anahtarsız 1.000 istek/gün; ipwho.is yedeği olarak kullan.",
    desc: "IP'den şehir, ülke, para birimi ve saat dilimi.",
    keywords: ["ip", "konum", "para birimi", "location"] }),

  // ---------------------------------------------------------------- images
  E({ id: "picsum", name: "Lorem Picsum (gerçek fotoğraflar)", category: "gorsel", base: "https://picsum.photos",
    example: "https://picsum.photos/v2/list?page=2&limit=12",
    sample: '[{"id":"10","author":"Paul Jarvis","width":2500,"height":1667,"download_url":"https://picsum.photos/id/10/2500/1667"}]',
    rate: "Anahtarsız. Sabit görsel: https://picsum.photos/seed/<kelime>/1200/800 veya /id/<id>/800/600; ?grayscale&blur=2",
    desc: "Unsplash fotoğrafçılarının gerçek fotoğrafları; sabit tohumla tutarlı kapak/arka plan görselleri. Gri kutu/yer tutucu yerine.",
    attribution: "Fotoğraflar: Unsplash fotoğrafçıları (picsum.photos)",
    keywords: ["görsel", "fotoğraf", "image", "photo", "galeri", "kapak", "hero", "arka plan", "blog", "portfolyo"] }),
  E({ id: "dicebear", name: "DiceBear Avatarlar", category: "gorsel", base: "https://api.dicebear.com/9.x",
    example: "https://api.dicebear.com/9.x/initials/svg?seed=Ay%C5%9Fe%20Y%C4%B1lmaz",
    sample: "SVG görsel. Stiller: initials, thumbs, notionists, bottts, lorelei. <img src=\"https://api.dicebear.com/9.x/initials/svg?seed=AdSoyad\">",
    rate: "Anahtarsız; ticari olmayan kullanımda serbest (stil lisanslarına bak).",
    desc: "Kullanıcı adından deterministik avatar (baş harfler vb.). Profil, yorum ve ekip listeleri için.",
    keywords: ["avatar", "profil", "kullanıcı", "user", "yorum", "ekip", "team", "üye"] }),

  // ---------------------------------------------------------------- quotes & fun
  E({ id: "dummyjson-quotes", name: "DummyJSON Sözler", category: "soz", base: "https://dummyjson.com",
    example: "https://dummyjson.com/quotes/random",
    sample: '{"id":528,"quote":"…","author":"…"}',
    rate: "Anahtarsız. Gerçek alıntılar (İngilizce); /quotes?limit=30 liste.",
    desc: "Rastgele ünlü söz/alıntı (İngilizce). Motivasyon kutuları, açılış ekranları.",
    keywords: ["söz", "alıntı", "quote", "motivasyon", "ilham", "günün sözü"] }),
  E({ id: "adviceslip", name: "Advice Slip", category: "soz", base: "https://api.adviceslip.com",
    example: "https://api.adviceslip.com/advice",
    sample: '{"slip":{"id":57,"advice":"…"}}',
    rate: "Anahtarsız; aynı yanıt 2 sn önbelleklenir (cache: 'no-store' kullan).",
    desc: "Rastgele kısa tavsiye (İngilizce).",
    keywords: ["tavsiye", "advice", "öneri", "günün"] }),

  // ---------------------------------------------------------------- animals
  E({ id: "dog-ceo", name: "Dog CEO", category: "hayvan", base: "https://dog.ceo/api",
    example: "https://dog.ceo/api/breed/husky/images/random/6",
    sample: '{"message":["https://images.dog.ceo/breeds/husky/n02110185_1469.jpg",…],"status":"success"}',
    rate: "Anahtarsız. Irk listesi: /breeds/list/all",
    desc: "Irklara göre gerçek köpek fotoğrafları. Pet shop, sahiplendirme, veteriner siteleri.",
    keywords: ["köpek", "dog", "evcil", "pet", "hayvan", "sahiplen", "veteriner", "ırk"] }),
  E({ id: "thecatapi", name: "TheCatAPI", category: "hayvan", base: "https://api.thecatapi.com/v1",
    example: "https://api.thecatapi.com/v1/images/search?limit=6",
    sample: '[{"id":"MTc2Mzc0Mw","url":"https://cdn2.thecatapi.com/images/MTc2Mzc0Mw.jpg","width":500,"height":375}]',
    rate: "Anahtarsız 10 görsel/istek; daha fazlası ücretsiz anahtar ister.",
    desc: "Gerçek kedi fotoğrafları.",
    keywords: ["kedi", "cat", "evcil", "pet", "hayvan", "sahiplen"] }),
  E({ id: "catfact", name: "Cat Facts", category: "hayvan", base: "https://catfact.ninja",
    example: "https://catfact.ninja/fact",
    sample: '{"fact":"A cat\'s nose is as unique as a human\'s fingerprint.","length":51}',
    rate: "Anahtarsız.",
    desc: "Kediler hakkında rastgele bilgi (İngilizce).",
    keywords: ["kedi", "cat", "bilgi", "fact"] }),

  // ---------------------------------------------------------------- developer
  E({ id: "github", name: "GitHub REST (genel)", category: "gelistirici", base: "https://api.github.com",
    example: "https://api.github.com/users/torvalds/repos?sort=updated&per_page=6",
    sample: '[{"name":"linux","description":"…","stargazers_count":190000,"language":"C","html_url":"https://github.com/torvalds/linux"}]',
    rate: "Anahtarsız 60 istek/saat/IP — sonuçları en az 10 dk önbellekle. Token'ı ASLA istemci koduna koyma.",
    desc: "Herkese açık kullanıcı, depo, yıldız ve sürüm bilgisi. Geliştirici portfolyoları için gerçek proje listesi.",
    attribution: "Veri: GitHub",
    keywords: ["github", "depo", "repo", "geliştirici", "developer", "portfolyo", "açık kaynak", "yıldız"] }),

  // ---------------------------------------------------------------- demo only
  E({ id: "jsonplaceholder", name: "JSONPlaceholder (yalnızca demo)", category: "demo", base: "https://jsonplaceholder.typicode.com",
    example: "https://jsonplaceholder.typicode.com/todos?_limit=5",
    sample: '[{"userId":1,"id":1,"title":"delectus aut autem","completed":false}]',
    rate: "Sahte veri; yazma istekleri kalıcı değildir. Gerçek uygulamada KULLANMA.",
    desc: "Sahte REST verisi — yalnızca kullanıcı açıkça demo/öğretici isterse.",
    keywords: ["jsonplaceholder", "rest demo", "fetch örneği", "öğretici"] }),
  E({ id: "randomuser", name: "RandomUser (yalnızca demo)", category: "demo", base: "https://randomuser.me/api",
    example: "https://randomuser.me/api/?nat=tr&results=6",
    sample: '{"results":[{"name":{"first":"Gül","last":"Tokgöz"},"picture":{"large":"https://randomuser.me/api/portraits/women/1.jpg"}}]}',
    rate: "Kurgusal kişiler; yalnızca kullanıcı açıkça örnek kullanıcı isterse.",
    desc: "Kurgusal kullanıcı profilleri (Türkçe isimler) — gerçek müşteri/yorum gibi gösterme.",
    keywords: ["örnek kullanıcı", "random user", "sahte profil"] }),
]);

/** Form endpoints (POST from the browser). Formspree's CORS was verified; Web3Forms/FormSubmit block server IPs by design. */
export const FORM_PROVIDERS = Object.freeze({
  web3forms: { label: "Web3Forms", field: "Erişim anahtarı (access key)", help: "web3forms.com'da e-postanı yaz, anahtar e-postana gelir. Ücretsiz 250 gönderim/ay.", endpoint: "https://api.web3forms.com/submit" },
  formsubmit: { label: "FormSubmit", field: "Alıcı e-posta adresi", help: "Kayıt gerekmez; ilk gönderimde e-postana gelen onay bağlantısına bas.", endpoint: "https://formsubmit.co/ajax/" },
  formspree: { label: "Formspree", field: "Form kimliği (ör. xayzabcd)", help: "formspree.io'da ücretsiz form oluştur, /f/ sonrasındaki kimliği yapıştır. 50 gönderim/ay.", endpoint: "https://formspree.io/f/" },
});

// The best source of each category wins ties (e.g. Open-Meteo over the wttr.in fallback).
const PRIMARY = new Set(["open-meteo", "frankfurter", "binance", "usgs", "kandilli", "spaceflight-news", "tvmaze", "wikipedia-summary", "themealdb", "carto-tiles", "picsum", "nasa-apod"]);

export function apiById(id) { return CATALOG.find((a) => a.id === id) || null; }

const norm = (s) => String(s || "").toLocaleLowerCase("tr-TR").normalize("NFC");
const fold = (s) => norm(s).replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }[c]));

/** Full text catalog search for the Canlı Veri panel. */
export function searchCatalog(query = "", category = "") {
  const q = fold(query).trim();
  return CATALOG.filter((a) => (!category || a.category === category) &&
    (!q || fold([a.name, a.desc, a.category, CATEGORIES[a.category], a.base, a.keywords.join(" ")].join(" ")).includes(q)));
}

/**
 * Pick the catalog entries relevant to a request. Scored by keyword hits (accent-insensitive, word-prefix aware);
 * demo-only APIs are only picked when named. Image APIs are added as a fallback so generated sites use real photos.
 */
export function selectApis(text, { max = 6, images = true } = {}) {
  const t = " " + fold(text).replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ") + " ";
  const scored = [];
  for (const a of CATALOG) {
    let s = 0;
    for (const k of a.keywords) {
      const kk = fold(k);
      if (!kk) continue;
      if (t.includes(" " + kk + " ")) s += kk.includes(" ") ? 4 : 3;
      else if (kk.length >= 4 && t.includes(" " + kk)) s += 2; // Turkish suffixes: "depremler", "dövizi"
    }
    if (a.category === "demo" && s < 4) s = 0;
    if (s > 0) scored.push({ a, s: s + (PRIMARY.has(a.id) ? 1.5 : 0) + (a.status === "ok" ? 0.2 : 0) });
  }
  scored.sort((x, y) => y.s - x.s);
  const out = scored.slice(0, max).map((x) => x.a);
  // Companions: weather needs geocoding, maps need geocoding; keep within max.
  const add = (id) => { const a = apiById(id); if (a && !out.includes(a) && out.length < max + 2) out.push(a); };
  if (out.some((a) => a.id === "open-meteo")) { add("open-meteo-geocoding"); add("wttr"); }
  if (out.some((a) => a.category === "deprem")) add("carto-tiles");
  if (out.some((a) => a.id === "coingecko")) add("binance");
  if (images && !out.some((a) => a.category === "gorsel")) add("picsum");
  return out;
}

/** Compact prompt rendering of catalog entries. */
export function catalogPrompt(list) {
  return list.map((a) => `- ${a.name} [${a.category}]${a.status === "limited" ? " (per-IP quota: cache hard, back off on 429)" : ""}
  GET ${a.example}
  Response: ${a.sample}
  Limits: ${a.rate}${a.attribution ? "\n  Attribution (show in footer): " + a.attribution.replace(/<[^>]+>/g, "") : ""}
  Use: ${a.desc}`).join("\n");
}

/** Ready-to-paste instruction for the chat composer (“Projeye ekle”). */
export function snippetFor(api) {
  return `Canlı veri olarak ${api.name} kullan (anahtarsız, CORS açık).
Uç nokta: ${api.example}
Yanıt şekli: ${api.sample}
Sınır: ${api.rate}${api.attribution ? "\nAtıf: " + api.attribution.replace(/<[^>]+>/g, "") : ""}
Gerçek veriyi çalışma anında fetch et; yükleniyor iskeleti, hata + “Tekrar dene”, önbellek ve tr-TR biçimlendirme ekle; uydurma sayı kullanma.`;
}

/** Live call from the browser for the panel's “Test et”. Returns { ok, status, ms, json?, text?, error? }. */
export async function testApi(api, { fetchImpl = globalThis.fetch, timeout = 12000 } = {}) {
  const t0 = Date.now();
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeout) : null;
  try {
    const r = await fetchImpl(api.example, { signal: ac ? ac.signal : undefined, headers: { Accept: "application/json, */*" } });
    const ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
    let json = null, text = "";
    if (/json/.test(ct) || /\.(geo)?json(\?|$)/.test(api.example)) { try { json = await r.json(); } catch (e) { text = ""; } }
    else if (/^image\//.test(ct)) text = "[" + ct + " görsel]";
    else text = (await r.text()).slice(0, 4000);
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, json, text };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e && e.name === "AbortError" ? "Zaman aşımı" : String(e && e.message || e) };
  } finally { if (timer) clearTimeout(timer); }
}
