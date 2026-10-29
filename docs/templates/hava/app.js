// Hava Durumu — Open-Meteo (tahmin, şehir arama, hava kalitesi) + wttr.in yedeği. Uydurma veri yok.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var DEFAULT = { name: "İstanbul", admin1: "İstanbul", country: "Türkiye", latitude: 41.0138, longitude: 28.9497, timezone: "Europe/Istanbul" };
  var WMO = { 0: ["Açık", "☀️"], 1: ["Çoğunlukla açık", "🌤️"], 2: ["Parçalı bulutlu", "⛅"], 3: ["Kapalı", "☁️"], 45: ["Sisli", "🌫️"], 48: ["Kırağılı sis", "🌫️"],
    51: ["Hafif çisenti", "🌦️"], 53: ["Çisenti", "🌦️"], 55: ["Yoğun çisenti", "🌧️"], 56: ["Dondurucu çisenti", "🌧️"], 57: ["Dondurucu çisenti", "🌧️"],
    61: ["Hafif yağmur", "🌦️"], 63: ["Yağmur", "🌧️"], 65: ["Şiddetli yağmur", "🌧️"], 66: ["Dondurucu yağmur", "🌧️"], 67: ["Dondurucu yağmur", "🌧️"],
    71: ["Hafif kar", "🌨️"], 73: ["Kar", "🌨️"], 75: ["Yoğun kar", "❄️"], 77: ["Kar taneleri", "🌨️"], 80: ["Sağanak", "🌦️"], 81: ["Sağanak", "🌧️"], 82: ["Şiddetli sağanak", "⛈️"],
    85: ["Kar sağanağı", "🌨️"], 86: ["Yoğun kar sağanağı", "❄️"], 95: ["Gök gürültülü fırtına", "⛈️"], 96: ["Dolulu fırtına", "⛈️"], 99: ["Şiddetli dolulu fırtına", "⛈️"] };
  var wmo = function (c) { return WMO[c] || ["Bilinmiyor", "🌡️"]; };
  var n0 = function (v) { return Math.round(v).toLocaleString("tr-TR"); };
  var dayFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "long" });
  var place = load() || DEFAULT, timer = null, reqId = 0;

  function load() { try { return JSON.parse(localStorage.getItem("hava:sehir")); } catch (e) { return null; } }
  function save(p) { try { localStorage.setItem("hava:sehir", JSON.stringify(p)); } catch (e) { /* depolama kapalı */ } }
  function errBox(msg, retry) {
    var d = document.createElement("div"); d.className = "err"; d.setAttribute("role", "alert");
    d.innerHTML = "<span>" + esc(msg) + "</span>"; var b = document.createElement("button"); b.className = "btn"; b.textContent = "Tekrar dene"; b.onclick = retry; d.appendChild(b); return d;
  }

  function forecastUrl(p) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" + p.latitude + "&longitude=" + p.longitude +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day,surface_pressure" +
      "&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      "&timezone=auto&forecast_days=7&wind_speed_unit=kmh";
  }
  // Open-Meteo yanıt vermezse wttr.in'den aynı biçime dönüştür (yalnızca gerçek veriler).
  function fromWttr(j) {
    var c = j.current_condition[0], days = j.weather || [];
    var code = function (desc) { desc = String(desc || "").toLowerCase(); return /kar|snow/.test(desc) ? 73 : /sağanak|shower/.test(desc) ? 80 : /yağmur|rain/.test(desc) ? 63 : /sis|fog|mist/.test(desc) ? 45 : /kapalı|overcast/.test(desc) ? 3 : /bulut|cloud/.test(desc) ? 2 : 0; };
    var desc = (c.lang_tr && c.lang_tr[0] && c.lang_tr[0].value) || (c.weatherDesc && c.weatherDesc[0].value);
    var hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [] };
    days.forEach(function (d) { (d.hourly || []).forEach(function (h) { var hh = String(h.time).padStart(4, "0"); hourly.time.push(d.date + "T" + hh.slice(0, 2) + ":00"); hourly.temperature_2m.push(+h.tempC); hourly.precipitation_probability.push(+h.chanceofrain); hourly.weather_code.push(code(h.lang_tr && h.lang_tr[0] && h.lang_tr[0].value || h.weatherDesc[0].value)); }); });
    return { source: "wttr.in", current: { time: new Date().toISOString().slice(0, 16), temperature_2m: +c.temp_C, apparent_temperature: +c.FeelsLikeC, relative_humidity_2m: +c.humidity, wind_speed_10m: +c.windspeedKmph, precipitation: +c.precipMM, surface_pressure: +c.pressure, weather_code: code(desc), is_day: 1, desc: desc },
      hourly: hourly, daily: { time: days.map(function (d) { return d.date; }), weather_code: days.map(function (d) { return code(d.hourly && d.hourly[4] && d.hourly[4].weatherDesc[0].value); }), temperature_2m_max: days.map(function (d) { return +d.maxtempC; }), temperature_2m_min: days.map(function (d) { return +d.mintempC; }), precipitation_probability_max: days.map(function (d) { return Math.max.apply(null, (d.hourly || []).map(function (h) { return +h.chanceofrain; })); }) } };
  }

  async function refresh() {
    var id = ++reqId;
    $("now").setAttribute("aria-busy", "true");
    $("status").className = "chip"; $("status").textContent = "Güncelleniyor…";
    var data = null, meta = null, source = "Open-Meteo";
    try {
      meta = await KovanDB.fetchJSONMeta(forecastUrl(place), { ttl: 600 });
      data = meta.data;
    } catch (e) {
      try { var w = await KovanDB.fetchJSON("https://wttr.in/" + encodeURIComponent(place.name) + "?format=j1&lang=tr", { ttl: 600 }); data = fromWttr(w); source = "wttr.in"; meta = { at: Date.now(), stale: false }; }
      catch (e2) {
        if (id !== reqId) return;
        $("now").setAttribute("aria-busy", "false");
        $("now").replaceChildren(errBox("Hava durumu alınamadı. İnternet bağlantını kontrol et.", refresh));
        $("status").className = "chip stale"; $("status").textContent = "Bağlantı yok";
        return;
      }
    }
    if (id !== reqId) return;
    render(data, source);
    $("status").className = "chip " + (meta.stale ? "stale" : "live");
    $("status").textContent = meta.stale ? "Çevrimdışı · önbellek" : "Canlı · " + source;
    $("updated").textContent = "Son güncelleme: " + new Date(meta.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    airQuality();
  }

  function render(d, source) {
    var c = d.current, w = wmo(c.weather_code);
    $("now").setAttribute("aria-busy", "false");
    $("now").innerHTML = '<div class="place">' + esc(place.name) + ' <small>' + esc([place.admin1 !== place.name ? place.admin1 : "", place.country].filter(Boolean).join(", ")) + '</small></div>' +
      '<div class="temp" aria-label="Sıcaklık ' + n0(c.temperature_2m) + ' derece">' + n0(c.temperature_2m) + '°<span aria-hidden="true">' + w[1] + '</span></div>' +
      '<div class="desc">' + esc(c.desc || w[0]) + ' · Hissedilen ' + n0(c.apparent_temperature) + '°</div>' +
      '<div class="facts"><div><small>Nem</small><b>%' + n0(c.relative_humidity_2m) + '</b></div><div><small>Rüzgâr</small><b>' + n0(c.wind_speed_10m) + ' km/sa</b></div>' +
      '<div><small>Yağış</small><b>' + Number(c.precipitation || 0).toLocaleString("tr-TR") + ' mm</b></div>' + (c.surface_pressure ? '<div><small>Basınç</small><b>' + n0(c.surface_pressure) + ' hPa</b></div>' : "") + '</div>';
    document.title = n0(c.temperature_2m) + "° " + place.name + " · Hava Durumu";
    // saatlik: şimdiden itibaren 24 saat
    var h = d.hourly, start = Math.max(0, h.time.findIndex(function (t) { return t >= c.time.slice(0, 13); }));
    var hours = [];
    for (var i = start; i < Math.min(h.time.length, start + 24); i++) {
      hours.push('<div class="hour"><small>' + (i === start ? "Şimdi" : h.time[i].slice(11, 16)) + '</small><i aria-hidden="true">' + wmo(h.weather_code[i])[1] + '</i><b>' + n0(h.temperature_2m[i]) + '°</b><small>☔ %' + n0(h.precipitation_probability[i] || 0) + '</small></div>');
    }
    $("hourly").innerHTML = hours.join("") || '<p class="empty">Saatlik veri yok.</p>';
    var dl = d.daily, lo = Math.min.apply(null, dl.temperature_2m_min), hi = Math.max.apply(null, dl.temperature_2m_max), span = Math.max(1, hi - lo);
    $("daily").innerHTML = dl.time.map(function (t, k) {
      var a = (dl.temperature_2m_min[k] - lo) / span * 100, b = (dl.temperature_2m_max[k] - lo) / span * 100;
      return '<li><b>' + (k === 0 ? "Bugün" : dayFmt.format(new Date(t + "T12:00:00"))) + '</b><span aria-hidden="true">' + wmo(dl.weather_code[k])[1] + '</span>' +
        '<div class="bar" title="' + esc(wmo(dl.weather_code[k])[0]) + '"><span style="left:' + a + '%;right:' + (100 - b) + '%"></span></div>' +
        '<span>' + n0(dl.temperature_2m_min[k]) + '° / <b>' + n0(dl.temperature_2m_max[k]) + '°</b> <small class="muted">☔%' + n0(dl.precipitation_probability_max[k] || 0) + '</small></span></li>';
    }).join("");
    void source;
  }

  async function airQuality() {
    var box = $("aq");
    try {
      var j = await KovanDB.fetchJSON("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + place.latitude + "&longitude=" + place.longitude + "&current=european_aqi,pm10,pm2_5&timezone=auto", { ttl: 1800 });
      var v = j.current.european_aqi;
      var lv = v <= 20 ? ["Çok iyi", "#3ddc97"] : v <= 40 ? ["İyi", "#9be15d"] : v <= 60 ? ["Orta", "#ffc857"] : v <= 80 ? ["Kötü", "#ff9f43"] : v <= 100 ? ["Çok kötü", "#ff6b6b"] : ["Aşırı kötü", "#b33939"];
      box.innerHTML = '<div class="aqi"><b>' + n0(v) + '</b><span class="lvl" style="background:' + lv[1] + '22;color:' + lv[1] + '">' + lv[0] + '</span><span class="muted small">Avrupa AQI · PM2.5 ' + Number(j.current.pm2_5).toLocaleString("tr-TR") + ' µg/m³ · PM10 ' + Number(j.current.pm10).toLocaleString("tr-TR") + ' µg/m³</span></div>';
    } catch (e) { box.replaceChildren(errBox("Hava kalitesi şu an alınamadı.", airQuality)); }
  }

  // ---- şehir arama (Open-Meteo geocoding, 350 ms debounce, eski istek iptali)
  var q = $("q"), list = $("results"), deb = null, ac = null, hits = [], sel = -1;
  q.addEventListener("input", function () {
    clearTimeout(deb);
    var term = q.value.trim();
    if (term.length < 2) { list.hidden = true; return; }
    deb = setTimeout(function () { search(term); }, 350);
  });
  async function search(term) {
    if (ac) ac.abort();
    ac = new AbortController();
    try {
      var r = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(term) + "&count=6&language=tr&format=json", { signal: ac.signal });
      var j = await r.json();
      hits = j.results || []; sel = -1;
      list.innerHTML = hits.length ? hits.map(function (p, i) { return '<li role="option" data-i="' + i + '">' + esc(p.name) + ' <small>' + esc([p.admin1, p.country].filter(Boolean).join(", ")) + '</small></li>'; }).join("") : '<li aria-disabled="true">Sonuç bulunamadı</li>';
      list.hidden = false;
    } catch (e) { if (e.name !== "AbortError") { list.innerHTML = '<li aria-disabled="true">Arama yapılamadı, tekrar dene.</li>'; list.hidden = false; } }
  }
  function choose(i) {
    var p = hits[i]; if (!p) return;
    place = { name: p.name, admin1: p.admin1 || "", country: p.country || "", latitude: p.latitude, longitude: p.longitude, timezone: p.timezone };
    save(place); list.hidden = true; q.value = ""; q.blur(); refresh();
  }
  list.addEventListener("click", function (e) { var li = e.target.closest("[data-i]"); if (li) choose(+li.dataset.i); });
  q.addEventListener("keydown", function (e) {
    if (list.hidden || !hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; [].forEach.call(list.children, function (li, i) { li.setAttribute("aria-selected", String(i === sel)); }); }
    if (e.key === "Escape") list.hidden = true;
  });
  $("search").addEventListener("submit", function (e) { e.preventDefault(); if (hits.length) choose(sel >= 0 ? sel : 0); });
  document.addEventListener("click", function (e) { if (!e.target.closest(".search")) list.hidden = true; });

  // ---- 15 dakikada bir yenile, sekme gizliyken bekle
  function schedule() { clearInterval(timer); timer = setInterval(function () { if (!document.hidden) refresh(); }, 15 * 60 * 1000); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  refresh(); schedule();
})();
