// Small live strip on the Studio's empty state: İstanbul weather, USD/TRY, EUR/TRY, BTC/TRY from verified keyless APIs.
// Cached for 5 minutes in sessionStorage; every value degrades to "—" independently when offline.
const CACHE_KEY = "kovan:widgets";
const TTL = 5 * 60 * 1000;

export const WIDGET_SOURCES = {
  weather: "https://api.open-meteo.com/v1/forecast?latitude=41.0138&longitude=28.9497&current=temperature_2m,weather_code&timezone=Europe%2FIstanbul",
  weatherFallback: "https://wttr.in/Istanbul?format=j1",
  fx: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR",
  btc: "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCTRY",
};

const ICON = (c) => (c === 0 ? "☀️" : c <= 2 ? "⛅" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 || (c >= 80 && c <= 82) ? "🌧️" : c <= 86 ? "🌨️" : "⛈️");

async function getJSON(fetchImpl, url, ms = 8000) {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    const r = await fetchImpl(url, ac ? { signal: ac.signal } : {});
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { if (t) clearTimeout(t); }
}

/** Fetch all widget values. Never throws; missing values are null. */
export async function fetchWidgets({ fetchImpl = globalThis.fetch, storage = safeSession(), now = Date.now() } = {}) {
  try {
    const c = storage && JSON.parse(storage.getItem(CACHE_KEY) || "null");
    if (c && now - c.at < TTL && c.data && (c.data.temp != null || c.data.usd != null)) return { ...c.data, cached: true };
  } catch (e) { /* ignore */ }
  const out = { temp: null, icon: "", usd: null, eur: null, btc: null, btcChange: null, at: now, offline: false };
  const tasks = [
    getJSON(fetchImpl, WIDGET_SOURCES.weather).then((j) => { out.temp = j.current.temperature_2m; out.icon = ICON(j.current.weather_code); })
      .catch(() => getJSON(fetchImpl, WIDGET_SOURCES.weatherFallback).then((j) => { out.temp = +j.current_condition[0].temp_C; out.icon = "🌡️"; })),
    getJSON(fetchImpl, WIDGET_SOURCES.fx).then((j) => { out.usd = j.rates.TRY; out.eur = j.rates.TRY / j.rates.EUR; }),
    getJSON(fetchImpl, WIDGET_SOURCES.btc).then((j) => { out.btc = +j.lastPrice; out.btcChange = +j.priceChangePercent; }),
  ];
  await Promise.allSettled(tasks);
  out.offline = out.temp == null && out.usd == null && out.btc == null;
  if (!out.offline) { try { storage && storage.setItem(CACHE_KEY, JSON.stringify({ at: now, data: out })); } catch (e) { /* ignore */ } }
  return out;
}

function safeSession() { try { return globalThis.sessionStorage || null; } catch (e) { return null; } }

const tl = (v, d = 2) => v.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** HTML for the strip (values already fetched). */
export function widgetsHtml(w) {
  const dash = "—";
  const item = (label, value, extra = "") => `<span class="lw-item"><small>${label}</small><b>${value}</b>${extra}</span>`;
  const ch = w.btcChange == null ? "" : `<em class="${w.btcChange >= 0 ? "up" : "down"}">${w.btcChange >= 0 ? "+" : ""}${tl(w.btcChange)}%</em>`;
  return item("İstanbul", w.temp == null ? dash : `${w.icon} ${Math.round(w.temp)}°C`) +
    item("USD/TRY", w.usd == null ? dash : "₺" + tl(w.usd, 4)) +
    item("EUR/TRY", w.eur == null ? dash : "₺" + tl(w.eur, 4)) +
    item("BTC/TRY", w.btc == null ? dash : "₺" + w.btc.toLocaleString("tr-TR", { maximumFractionDigits: 0 }), ch) +
    `<span class="lw-state ${w.offline ? "off" : "on"}">${w.offline ? "çevrimdışı" : "canlı"}</span>`;
}

/** Render into an element; returns the promise of the data. */
export async function mountWidgets(el, opts = {}) {
  if (!el) return null;
  el.innerHTML = widgetsHtml({ temp: null, usd: null, eur: null, btc: null, btcChange: null, offline: false }).replace("canlı", "yükleniyor…");
  el.setAttribute("aria-busy", "true");
  const w = await fetchWidgets(opts);
  if (!el.isConnected && el.isConnected !== undefined) return w;
  el.innerHTML = widgetsHtml(w);
  el.removeAttribute("aria-busy");
  el.title = w.offline ? "Canlı veriye ulaşılamadı (çevrimdışı)." : "Open-Meteo · Frankfurter/ECB · Binance — " + new Date(w.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return w;
}
