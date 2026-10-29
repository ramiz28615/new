// Live-data templates: load from docs/templates like the Studio does, assemble the preview, run it in jsdom with a
// stubbed fetch and check that the real endpoints are called and their data is rendered (no hardcoded values).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { LIVE_TEMPLATES, DEMO_TEMPLATE, loadLiveTemplate } from "../../docs/js/livetemplates.js";
import { buildPreview } from "../../docs/js/preview.js";
import { configSource } from "../../docs/js/backend.js";
import { CATALOG } from "../../docs/js/apis.js";

const TPL = pathToFileURL(fileURLToPath(new URL("../../docs/templates/", import.meta.url))).href;
const diskFetch = async (u) => { const f = fileURLToPath(u); return existsSync(f) ? new Response(readFileSync(f, "utf8")) : new Response("", { status: 404 }); };

// Response shapes as documented by each API (values are arbitrary test fixtures).
const today = new Date().toISOString().slice(0, 10);
const hours = Array.from({ length: 48 }, (_, i) => new Date(Date.now() + (i - 2) * 3600e3).toISOString().slice(0, 13) + ":00");
const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 864e5).toISOString().slice(0, 10));
const FIX = [
  [/api\.open-meteo\.com\/v1\/forecast/, () => ({ current: { time: hours[2], temperature_2m: 17.3, apparent_temperature: 16.1, relative_humidity_2m: 71, wind_speed_10m: 12.4, wind_direction_10m: 40, precipitation: 0, weather_code: 2, is_day: 1, surface_pressure: 1013 },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => 15 + (i % 5)), precipitation_probability: hours.map(() => 10), weather_code: hours.map(() => 1) },
    daily: { time: days, weather_code: days.map(() => 3), temperature_2m_max: days.map((_, i) => 19 + i), temperature_2m_min: days.map(() => 11), precipitation_probability_max: days.map(() => 20), sunrise: days, sunset: days } })],
  [/air-quality-api\.open-meteo\.com/, () => ({ current: { european_aqi: 37, pm10: 20.5, pm2_5: 11.2 } })],
  [/geocoding-api\.open-meteo\.com/, () => ({ results: [{ name: "Ankara", admin1: "Ankara", country: "Türkiye", latitude: 39.92, longitude: 32.85, timezone: "Europe/Istanbul" }] })],
  [/api\.frankfurter\.dev\/v1\/latest/, () => ({ amount: 1, base: "USD", date: today, rates: { TRY: 41.9321, EUR: 0.8611, GBP: 0.7512, CHF: 0.79, JPY: 151.2, CNY: 7.1 } })],
  [/api\.frankfurter\.dev\/v1\/\d{4}-\d\d-\d\d\.\./, () => ({ base: "USD", rates: Object.fromEntries(days.map((d, i) => [d, { TRY: 41 + i / 10 }])) })],
  [/open\.er-api\.com/, () => ({ result: "success", rates: { TRY: 41.95, SAR: 3.75, AED: 3.6725 } })],
  [/data-api\.binance\.vision\/api\/v3\/ticker\/24hr/, (u) => {
    const syms = JSON.parse(decodeURIComponent(/symbols=([^&]+)/.exec(u)[1]));
    return syms.map((s, i) => ({ symbol: s, lastPrice: String(1000 * (i + 1) + 0.5), priceChangePercent: i % 2 ? "-1.25" : "2.50", highPrice: "9999", lowPrice: "10", quoteVolume: "123456789" }));
  }],
  [/data-api\.binance\.vision\/api\/v3\/klines/, () => Array.from({ length: 24 }, (_, i) => [0, "1", "1", "1", String(100 + i), "1"])],
  [/earthquake\.usgs\.gov/, () => ({ type: "FeatureCollection", features: [
    { id: "us7000abcd", properties: { mag: 4.7, place: "Marmara Denizi, Silivri açıkları", time: Date.now() - 600e3, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd" }, geometry: { coordinates: [28.2, 40.8, 9.5] } },
    { id: "us7000abce", properties: { mag: 2.1, place: "Akdeniz", time: Date.now() - 7200e3 }, geometry: { coordinates: [30.2, 36.1, 12] } }] })],
  [/api\.spaceflightnewsapi\.net/, () => ({ count: 36711, next: "https://api.spaceflightnewsapi.net/v4/articles/?limit=12&offset=12", results: [
    { title: "Artemis II ekibi fırlatma provasını tamamladı", summary: "NASA ekibi…", image_url: "https://images.example/artemis.jpg", news_site: "SpaceNews", published_at: new Date(Date.now() - 3600e3).toISOString(), url: "https://spacenews.com/a" }] })],
  [/api\.nasa\.gov\/planetary\/apod/, () => ({ date: today, title: "Kartal Bulutsusu", explanation: "Açıklama", url: "https://apod.nasa.gov/apod/image/x.jpg", media_type: "image" })],
  [/api\.tvmaze\.com\/schedule/, () => [{ show: { id: 526, name: "The Office", premiered: "2005-03-24", genres: ["Comedy"], rating: { average: 8.6 }, image: { medium: "https://static.tvmaze.com/526.jpg" } } }, { show: { id: 82, name: "Game of Thrones", premiered: "2011-04-17", genres: ["Drama"], rating: { average: 8.9 }, image: null } }]],
  [/api\.tvmaze\.com\/search\/shows/, () => [{ score: 1, show: { id: 169, name: "Breaking Bad", premiered: "2008-01-20", genres: ["Drama", "Crime"], rating: { average: 9.2 }, image: { medium: "https://static.tvmaze.com/169.jpg" } } }]],
  [/api\.tvmaze\.com\/shows\/\d+/, () => ({ id: 169, name: "Breaking Bad", url: "https://www.tvmaze.com/shows/169", premiered: "2008-01-20", ended: "2013-09-29", status: "Ended", genres: ["Drama"], rating: { average: 9.2 }, runtime: 60, summary: "<p>Bir kimya öğretmeni…</p>", image: { medium: "m.jpg", original: "o.jpg" },
    _embedded: { cast: [{ person: { name: "Bryan Cranston", image: null }, character: { name: "Walter White" } }], episodes: [{ season: 5, number: 16, name: "Felina", airdate: "2013-09-29" }] } })],
  [/themealdb\.com/, () => ({ meals: [{ idMeal: "53262", strMeal: "Adana kebab", strMealThumb: "https://www.themealdb.com/images/media/meals/adana.jpg" }, { idMeal: "1", strMeal: "Menemen", strMealThumb: "https://www.themealdb.com/images/media/meals/menemen.jpg" }] })],
];

function makeFetch(calls, { fail = [] } = {}) {
  return async (url, init = {}) => {
    url = String(url);
    calls.push({ url, method: (init.method || "GET").toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
    if (fail.some((re) => re.test(url))) throw new TypeError("Failed to fetch");
    if (/api\.web3forms\.com|formsubmit\.co|formspree\.io/.test(url)) return { ok: true, status: 200, json: async () => ({ success: true }) };
    const hit = FIX.find(([re]) => re.test(url));
    if (!hit) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    const data = hit[1](url);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) };
  };
}

function fakeLeaflet(log) {
  const chain = () => { const o = { addTo() { return o; }, setView() { return o; }, bindPopup() { return o; }, clearLayers() { log.push("clear"); return o; }, getZoom() { return 6; }, getLatLng() { return [0, 0]; }, openPopup() { return o; } }; return o; };
  return { map: () => chain(), tileLayer: (url) => { log.push("tiles:" + url); return chain(); }, layerGroup: () => chain(), circleMarker: (ll) => { log.push("marker:" + ll.join(",")); return chain(); } };
}

async function run(tpl, { backend = {}, fail = [], leaflet = true, page = "index.html" } = {}) {
  const files = await loadLiveTemplate(tpl, { backend, fetchImpl: diskFetch, base: TPL });
  const html = buildPreview(files, page, { hook: false });
  const calls = [], errors = [], leafletLog = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdom: " + (e.message || e)));
  vc.on("error", (...a) => errors.push(a.map(String).join(" ")));
  const dom = new JSDOM(html, { url: "https://kullanici.github.io/proje/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = makeFetch(calls, { fail });
      if (leaflet) w.L = fakeLeaflet(leafletLog);
      w.alert = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.addEventListener("error", (e) => errors.push("error: " + e.message));
      w.addEventListener("unhandledrejection", (e) => errors.push("unhandled: " + (e.reason && e.reason.stack || e.reason)));
    } });
  const w = dom.window;
  const settle = async (ms = 250) => { for (let i = 0; i < ms / 25; i++) await new Promise((r) => setTimeout(r, 25)); };
  settle.until = async (fn, ms = 5000) => { for (let i = 0; i < ms / 25 && !fn(); i++) await new Promise((r) => setTimeout(r, 25)); };
  await settle();
  return { files, html, w, doc: w.document, calls, errors, leafletLog, settle, close: () => w.close() };
}
const urls = (calls) => calls.map((c) => c.url);
const usesCatalogHost = (u) => CATALOG.some((a) => { try { return new URL(u).host === new URL(a.example).host; } catch (e) { return false; } });

test("templates: six live templates + dashboard ship the files and the Studio helpers", async () => {
  assert.equal(LIVE_TEMPLATES.length, 6);
  for (const tpl of [...LIVE_TEMPLATES, DEMO_TEMPLATE]) {
    const files = await loadLiveTemplate(tpl, { fetchImpl: diskFetch, base: TPL });
    for (const f of ["index.html", "app.js", "style.css", "base.css", "kovan-db.js", "kovan-config.js", "README.md"]) assert.ok(files[f], tpl.id + " " + f);
    assert.match(files["index.html"], /<script src="kovan-config\.js"><\/script>\s*<script src="kovan-db\.js"><\/script>/, tpl.id + " loads helpers");
    assert.match(files["index.html"], /<html lang="tr">/);
    assert.ok(!/lorem ipsum|Math\.random\(\)\s*\*\s*\d+\s*\+/i.test(files["app.js"]), tpl.id + " no fake data");
    assert.match(files["index.html"], /<footer class="src[ "]/, tpl.id + " attribution footer");
  }
  await assert.rejects(loadLiveTemplate({ ...LIVE_TEMPLATES[0], dir: "yok" }, { fetchImpl: diskFetch, base: TPL }), /Şablon dosyası alınamadı/);
});

test("template Hava durumu: Open-Meteo forecast + air quality, city search, wttr.in fallback", async () => {
  const r = await run(LIVE_TEMPLATES.find((x) => x.id === "live-weather"));
  try {
    const u = urls(r.calls);
    assert.ok(u.some((x) => /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=41\.0138&longitude=28\.9497/.test(x)), "İstanbul by default");
    assert.ok(u.some((x) => x.startsWith("https://air-quality-api.open-meteo.com/v1/air-quality?")));
    assert.match(r.doc.getElementById("now").textContent, /İstanbul/);
    assert.match(r.doc.getElementById("now").textContent, /17°/);
    assert.match(r.doc.getElementById("now").textContent, /Parçalı bulutlu/);
    assert.equal(r.doc.getElementById("daily").children.length, 7);
    assert.ok(r.doc.getElementById("hourly").children.length >= 20);
    assert.match(r.doc.getElementById("aq").textContent, /37/);
    assert.match(r.doc.getElementById("status").textContent, /Canlı/);
    // search Ankara -> geocoding -> forecast for Ankara coordinates
    const q = r.doc.getElementById("q");
    q.value = "Ankara"; q.dispatchEvent(new r.w.Event("input"));
    await r.settle(500);
    assert.ok(urls(r.calls).some((x) => /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Ankara&count=6&language=tr/.test(x)));
    r.doc.querySelector("#results [data-i]").click();
    await r.settle(200);
    assert.ok(urls(r.calls).some((x) => /forecast\?latitude=39\.92&longitude=32\.85/.test(x)));
    assert.match(r.doc.getElementById("now").textContent, /Ankara/);
    assert.ok(urls(r.calls).every(usesCatalogHost));
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
  const off = await run(LIVE_TEMPLATES.find((x) => x.id === "live-weather"), { fail: [/open-meteo/, /wttr/] });
  try {
    await off.settle.until(() => /alınamadı/.test(off.doc.getElementById("now").textContent));
    assert.match(off.doc.getElementById("now").textContent, /alınamadı/);
    assert.ok(off.doc.querySelector("#now .err button"), "retry button");
    assert.ok(urls(off.calls).some((x) => x.startsWith("https://wttr.in/")), "fallback tried");
  } finally { off.close(); }
});

test("template Döviz & Kripto: Frankfurter cross rates, Binance TRY pairs, converter, 30-day chart", async () => {
  const r = await run(LIVE_TEMPLATES.find((x) => x.id === "live-fx"));
  try {
    const u = urls(r.calls);
    assert.ok(u.some((x) => x.startsWith("https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,")));
    assert.ok(u.some((x) => /^https:\/\/api\.frankfurter\.dev\/v1\/\d{4}-\d\d-\d\d\.\.\?base=USD&symbols=TRY$/.test(x)));
    assert.ok(u.some((x) => x.startsWith("https://data-api.binance.vision/api/v3/ticker/24hr?symbols=") && decodeURIComponent(x).includes('"BTCTRY"')));
    const fx = r.doc.getElementById("fx").textContent;
    assert.match(fx, /41,9321/, "USD/TRY from the API");
    assert.match(fx, /48,69/, "EUR/TRY = TRY/EUR cross rate"); // 41.9321 / 0.8611 = 48.696
    assert.match(r.doc.getElementById("crypto").textContent, /Bitcoin/);
    assert.match(r.doc.getElementById("crypto").textContent, /1\.000,50/);
    assert.ok(r.doc.querySelector("#chart svg path"), "chart drawn");
    r.doc.getElementById("amount").value = "10"; r.doc.getElementById("from").value = "USD"; r.doc.getElementById("to").value = "TRY";
    r.doc.getElementById("amount").dispatchEvent(new r.w.Event("input"));
    assert.match(r.doc.getElementById("result").textContent, /10 USD = 419,32 TRY/);
    assert.ok(urls(r.calls).every(usesCatalogHost));
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
});

test("template Deprem haritası: USGS query for Türkiye, Leaflet + CARTO markers, filters", async () => {
  const r = await run(LIVE_TEMPLATES.find((x) => x.id === "live-quake"));
  try {
    assert.ok(urls(r.calls).some((x) => /^https:\/\/earthquake\.usgs\.gov\/fdsnws\/event\/1\/query\?format=geojson&minlatitude=34/.test(x)));
    assert.ok(r.leafletLog.some((l) => l.startsWith("tiles:https://{s}.basemaps.cartocdn.com/")));
    assert.ok(r.leafletLog.includes("marker:40.8,28.2"));
    assert.equal(r.doc.querySelectorAll("#list .q").length, 2);
    assert.match(r.doc.getElementById("list").textContent, /Silivri/);
    const min = r.doc.getElementById("min"); min.value = "4"; min.dispatchEvent(new r.w.Event("input"));
    assert.equal(r.doc.querySelectorAll("#list .q").length, 1, "magnitude filter");
    const sel = r.doc.getElementById("region"); sel.value = "week"; sel.dispatchEvent(new r.w.Event("change"));
    await r.settle(150);
    assert.ok(urls(r.calls).includes("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"));
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
  const noMap = await run(LIVE_TEMPLATES.find((x) => x.id === "live-quake"), { leaflet: false });
  try { assert.equal(noMap.doc.getElementById("map-note").hidden, false); assert.equal(noMap.doc.querySelectorAll("#list .q").length, 2); assert.deepEqual(noMap.errors, []); } finally { noMap.close(); }
});

test("template Uzay haberleri: Spaceflight News + NASA APOD, tabs, search", async () => {
  const r = await run(LIVE_TEMPLATES.find((x) => x.id === "live-news"));
  try {
    const u = urls(r.calls);
    assert.ok(u.includes("https://api.spaceflightnewsapi.net/v4/articles/?limit=12&ordering=-published_at"));
    assert.ok(u.some((x) => x.startsWith("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY")));
    assert.match(r.doc.getElementById("news").textContent, /Artemis II/);
    assert.match(r.doc.getElementById("apod").textContent, /Kartal Bulutsusu/);
    assert.equal(r.doc.getElementById("more").hidden, false);
    r.doc.querySelector('[data-kind="blogs"]').click(); await r.settle(100);
    assert.ok(urls(r.calls).some((x) => x.startsWith("https://api.spaceflightnewsapi.net/v4/blogs/")));
    const q = r.doc.getElementById("q"); q.value = "mars"; q.dispatchEvent(new r.w.Event("input")); await r.settle(550);
    assert.ok(urls(r.calls).some((x) => x.includes("search=mars")));
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
});

test("template Dizi arama: TVmaze schedule, search, detail with cast, favourites persisted", async () => {
  const r = await run(LIVE_TEMPLATES.find((x) => x.id === "live-tv"));
  try {
    assert.ok(urls(r.calls).includes("https://api.tvmaze.com/schedule?country=US"));
    assert.equal(r.doc.querySelectorAll("#shows .show").length, 2);
    const q = r.doc.getElementById("q"); q.value = "breaking"; q.dispatchEvent(new r.w.Event("input")); await r.settle(500);
    assert.ok(urls(r.calls).includes("https://api.tvmaze.com/search/shows?q=breaking"));
    assert.match(r.doc.getElementById("shows").textContent, /Breaking Bad/);
    r.doc.querySelector('[data-fav="169"]').click(); await r.settle(100);
    assert.equal(r.doc.getElementById("fav-count").textContent, "1");
    assert.equal(JSON.parse(r.w.localStorage.getItem("kovan-db:favoriler"))[0].show.name, "Breaking Bad");
    r.doc.querySelector('#shows [data-id="169"]').click(); await r.settle(150);
    assert.ok(urls(r.calls).some((x) => /^https:\/\/api\.tvmaze\.com\/shows\/169\?embed/.test(x)));
    assert.match(r.doc.getElementById("sheet").textContent, /Walter White/);
    assert.match(r.doc.getElementById("sheet").textContent, /Bir kimya öğretmeni/);
    assert.ok(!r.doc.getElementById("sheet").innerHTML.includes("&lt;p&gt;"), "summary HTML is stripped, not escaped into view");
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
});

test("template Restoran rezervasyon: validation, sendForm (local / Web3Forms), menu images, forecast", async () => {
  const tpl = LIVE_TEMPLATES.find((x) => x.id === "live-booking");
  const r = await run(tpl);
  try {
    assert.match(r.files["supabase/schema.sql"], /create table if not exists public\.rezervasyonlar/);
    assert.ok(urls(r.calls).includes("https://www.themealdb.com/api/json/v1/1/filter.php?a=Turkish"));
    assert.ok(urls(r.calls).some((x) => x.startsWith("https://api.open-meteo.com/v1/forecast?latitude=40.987")));
    assert.match(r.doc.getElementById("menu-grid").textContent, /Adana kebab/);
    assert.match(r.doc.getElementById("backend-note").textContent, /henüz bağlı değil/);
    const f = r.doc.getElementById("form");
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new r.w.Event("submit", { cancelable: true }));
    await r.settle(50);
    assert.match(r.doc.getElementById("err").textContent, /Adını/);
    f.elements.ad.value = "Ayşe Yılmaz"; f.elements.telefon.value = "0532 123 45 67";
    const later = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    f.elements.tarih.value = later; f.elements.saat.value = "19:30"; f.elements.kisi.value = "4";
    f.dispatchEvent(new r.w.Event("submit", { cancelable: true }));
    await r.settle(150);
    assert.equal(r.doc.getElementById("err").textContent, "");
    assert.equal(JSON.parse(r.w.localStorage.getItem("kovan-db:rezervasyonlar")).length, 1, "stored via KovanDB");
    assert.match(r.doc.getElementById("mine").textContent, /19:30/);
    assert.ok(!r.calls.some((c) => c.method === "POST"), "no form endpoint configured -> no fake send");
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
  const live = await run(tpl, { backend: { forms: { provider: "web3forms", key: "w3f-test" } } });
  try {
    assert.match(live.files["kovan-config.js"], /w3f-test/);
    assert.match(live.doc.getElementById("backend-note").textContent, /Web3Forms/);
    const f = live.doc.getElementById("form");
    f.elements.ad.value = "Mehmet Kaya"; f.elements.telefon.value = "05551112233";
    f.elements.tarih.value = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10); f.elements.saat.value = "20:00";
    f.dispatchEvent(new live.w.Event("submit", { cancelable: true }));
    await live.settle(150);
    const post = live.calls.find((c) => c.method === "POST");
    assert.equal(post.url, "https://api.web3forms.com/submit");
    assert.equal(post.body.access_key, "w3f-test"); assert.equal(post.body.ad, "Mehmet Kaya"); assert.match(post.body.subject, /Yeni rezervasyon: Mehmet Kaya/);
    assert.match(live.doc.getElementById("toast").textContent, /alındı/);
    assert.deepEqual(live.errors, []);
  } finally { live.close(); }
  assert.ok(configSource({ forms: { provider: "web3forms", key: "w3f-test" } }).includes("w3f-test"));
});

test("sample project (Canlı pano): weather + currency + crypto live, no key, two pages", async () => {
  const r = await run(DEMO_TEMPLATE);
  try {
    const u = urls(r.calls);
    assert.ok(u.some((x) => x.startsWith("https://api.open-meteo.com/v1/forecast?latitude=41.0138&longitude=28.9497")));
    assert.ok(u.includes("https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR,GBP"));
    assert.ok(u.some((x) => x.startsWith("https://data-api.binance.vision/api/v3/ticker/24hr?symbols=")));
    assert.ok(u.some((x) => x.startsWith("https://data-api.binance.vision/api/v3/klines?symbol=BTCTRY&interval=1h&limit=24")));
    assert.match(r.doc.getElementById("weather").textContent, /17°/);
    assert.match(r.doc.getElementById("fx").textContent, /Dolar₺41,93/);
    assert.match(r.doc.getElementById("fx").textContent, /Euro₺48,70/);
    assert.equal(r.doc.querySelectorAll("#crypto .coin").length, 3);
    assert.ok(r.doc.querySelector("#crypto svg path"), "24h sparkline");
    assert.match(r.doc.getElementById("status").textContent, /Canlı/);
    assert.ok(u.every(usesCatalogHost));
    assert.deepEqual(r.errors, []);
  } finally { r.close(); }
  const p2 = await run(DEMO_TEMPLATE, { page: "kaynaklar.html" });
  try { assert.match(p2.doc.body.textContent, /Veri kaynakları/); assert.deepEqual(p2.errors, []); } finally { p2.close(); }
  const off = await run(DEMO_TEMPLATE, { fail: [/./] });
  try {
    await off.settle.until(() => off.doc.querySelectorAll(".err").length === 3);
    assert.equal(off.doc.querySelectorAll(".err").length, 3, "each widget fails independently with a retry");
    assert.deepEqual(off.errors, []);
  } finally { off.close(); }
});
