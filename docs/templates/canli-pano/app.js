// Canlı Pano — İstanbul hava (Open-Meteo, yedek wttr.in), döviz (Frankfurter/ECB), kripto (Binance). Anahtar gerekmez.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var WMO = { 0: ["Açık", "☀️"], 1: ["Çoğunlukla açık", "🌤️"], 2: ["Parçalı bulutlu", "⛅"], 3: ["Kapalı", "☁️"], 45: ["Sisli", "🌫️"], 48: ["Sisli", "🌫️"], 51: ["Çisenti", "🌦️"], 53: ["Çisenti", "🌦️"], 55: ["Çisenti", "🌧️"],
    61: ["Hafif yağmur", "🌦️"], 63: ["Yağmur", "🌧️"], 65: ["Şiddetli yağmur", "🌧️"], 71: ["Hafif kar", "🌨️"], 73: ["Kar", "🌨️"], 75: ["Yoğun kar", "❄️"], 80: ["Sağanak", "🌦️"], 81: ["Sağanak", "🌧️"], 82: ["Şiddetli sağanak", "⛈️"], 95: ["Fırtına", "⛈️"], 96: ["Dolulu fırtına", "⛈️"], 99: ["Dolulu fırtına", "⛈️"] };
  var wmo = function (c) { return WMO[c] || ["—", "🌡️"]; };
  var tl = function (v) { return Number(v).toLocaleString("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 4 : 2 }); };
  var pct = function (v) { return (v > 0 ? "+" : "") + Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; };
  var errHtml = function (msg, fn) { return '<div class="err" role="alert"><span>' + msg + '</span><button class="btn" data-retry="' + fn + '">Tekrar dene</button></div>'; };
  var stale = false;
  document.addEventListener("click", function (e) { var b = e.target.closest("[data-retry]"); if (b) ({ weather: weather, fx: fx, crypto: crypto })[b.dataset.retry](); });

  function tick() { $("clock").textContent = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "full", timeStyle: "short" }) + " · İstanbul saati"; }

  async function weather() {
    var box = $("weather"), d;
    try {
      d = (await KovanDB.fetchJSONMeta("https://api.open-meteo.com/v1/forecast?latitude=41.0138&longitude=28.9497&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,weather_code&timezone=Europe%2FIstanbul&forecast_days=2", { ttl: 900 }));
      stale = stale || d.stale; d = d.data;
      var c = d.current, i0 = Math.max(0, d.hourly.time.findIndex(function (t) { return t >= c.time.slice(0, 13); }));
      var hours = d.hourly.time.slice(i0 + 1, i0 + 13).map(function (t, k) { return '<div>' + t.slice(11, 16) + '<b>' + Math.round(d.hourly.temperature_2m[i0 + 1 + k]) + '°</b>' + wmo(d.hourly.weather_code[i0 + 1 + k])[1] + '</div>'; }).join("");
      box.removeAttribute("aria-busy");
      box.innerHTML = '<h2 id="h-w">Hava durumu · İstanbul</h2><div class="now"><span class="t">' + Math.round(c.temperature_2m) + '°</span><span class="i" aria-hidden="true">' + wmo(c.weather_code)[1] + '</span></div>' +
        '<p class="d">' + wmo(c.weather_code)[0] + ' · Hissedilen ' + Math.round(c.apparent_temperature) + '° · Nem %' + c.relative_humidity_2m + ' · Rüzgâr ' + Math.round(c.wind_speed_10m) + ' km/sa</p><div class="hours" aria-label="Önümüzdeki saatler">' + hours + '</div>';
    } catch (e) {
      try {
        var w = await KovanDB.fetchJSON("https://wttr.in/Istanbul?format=j1&lang=tr", { ttl: 900 }), cc = w.current_condition[0];
        box.removeAttribute("aria-busy");
        box.innerHTML = '<h2 id="h-w">Hava durumu · İstanbul</h2><div class="now"><span class="t">' + cc.temp_C + '°</span></div><p class="d">' + ((cc.lang_tr && cc.lang_tr[0].value) || cc.weatherDesc[0].value) + ' · Hissedilen ' + cc.FeelsLikeC + '° · Nem %' + cc.humidity + ' · Rüzgâr ' + cc.windspeedKmph + ' km/sa</p><p class="muted small">Kaynak: wttr.in (yedek)</p>';
      } catch (e2) { box.removeAttribute("aria-busy"); box.innerHTML = '<h2 id="h-w">Hava durumu</h2>' + errHtml("Hava durumu alınamadı.", "weather"); }
    }
  }

  async function fx() {
    var box = $("fx");
    try {
      var m = await KovanDB.fetchJSONMeta("https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR,GBP", { ttl: 3600 }), r = m.data.rates;
      stale = stale || m.stale;
      var rows = [["USD", "🇺🇸 Dolar", r.TRY], ["EUR", "🇪🇺 Euro", r.TRY / r.EUR], ["GBP", "🇬🇧 Sterlin", r.TRY / r.GBP]];
      box.removeAttribute("aria-busy");
      box.innerHTML = rows.map(function (x) { return '<div class="kpi"><span>' + x[1] + '</span><b>' + tl(x[2]) + '</b></div>'; }).join("");
      $("fx-note").textContent = "ECB referans kuru · " + new Date(m.data.date + "T12:00:00").toLocaleDateString("tr-TR", { dateStyle: "long" });
    } catch (e) { box.innerHTML = errHtml("Kurlar alınamadı.", "fx"); }
  }

  var COINS = [["BTCTRY", "Bitcoin", "#f7931a"], ["ETHTRY", "Ethereum", "#8c8cff"], ["SOLTRY", "Solana", "#14f195"]];
  function spark(vals, col) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), sp = hi - lo || 1;
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + (i * 200 / (vals.length - 1)).toFixed(1) + " " + (44 - (v - lo) / sp * 40).toFixed(1); }).join(" ");
    return '<svg viewBox="0 0 200 46" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2"/></svg>';
  }
  async function crypto() {
    var box = $("crypto");
    try {
      var syms = encodeURIComponent(JSON.stringify(COINS.map(function (c) { return c[0]; })));
      var m = await KovanDB.fetchJSONMeta("https://data-api.binance.vision/api/v3/ticker/24hr?symbols=" + syms, { ttl: 25 });
      stale = stale || m.stale;
      var by = {}; m.data.forEach(function (t) { by[t.symbol] = t; });
      var lines = await Promise.all(COINS.map(function (c) { return KovanDB.fetchJSON("https://data-api.binance.vision/api/v3/klines?symbol=" + c[0] + "&interval=1h&limit=24", { ttl: 300 }).catch(function () { return []; }); }));
      box.removeAttribute("aria-busy");
      box.innerHTML = COINS.filter(function (c) { return by[c[0]]; }).map(function (c, i) {
        var t = by[c[0]], ch = +t.priceChangePercent, closes = (lines[i] || []).map(function (k) { return +k[4]; });
        return '<div class="coin"><span class="muted">' + c[1] + '</span><span class="p">' + tl(+t.lastPrice) + '</span><span class="' + (ch >= 0 ? "up" : "down") + '">' + pct(ch) + ' · 24s</span>' + (closes.length > 1 ? spark(closes, ch >= 0 ? "#3ddc97" : "#ff6b6b") : "") + '</div>';
      }).join("");
      $("updated").textContent = "Son güncelleme: " + new Date(m.at).toLocaleTimeString("tr-TR");
    } catch (e) { box.innerHTML = errHtml("Kripto fiyatları alınamadı.", "crypto"); }
    $("status").className = "chip " + (stale ? "stale" : "live"); $("status").textContent = stale ? "Çevrimdışı · önbellek" : "Canlı";
  }

  tick(); setInterval(tick, 30000);
  weather(); fx(); crypto();
  setInterval(function () { if (!document.hidden) { stale = false; crypto(); } }, 30000);
  setInterval(function () { if (!document.hidden) { weather(); fx(); } }, 15 * 60 * 1000);
})();
