// Deprem Haritası — USGS (FDSN sorgusu + özet akışları) + Leaflet/CARTO. Veriler dakikada bir yenilenir.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var SOURCES = {
    tr: function () { return "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=34&maxlatitude=43.5&minlongitude=24&maxlongitude=46&minmagnitude=1.5&orderby=time&limit=300&starttime=" + new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); },
    day: function () { return "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"; },
    week: function () { return "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"; },
  };
  var VIEW = { tr: [[39, 35], 6], day: [[20, 10], 2], week: [[20, 10], 2] };
  var color = function (m) { return m >= 6 ? "#ff3b3b" : m >= 5 ? "#ff7a3d" : m >= 4 ? "#ffb13d" : m >= 3 ? "#ffe066" : "#9be15d"; };
  var fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
  var rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
  var ago = function (t) { var s = (Date.now() - t) / 1000; return s < 3600 ? rtf.format(-Math.max(1, Math.round(s / 60)), "minute") : s < 86400 ? rtf.format(-Math.round(s / 3600), "hour") : rtf.format(-Math.round(s / 86400), "day"); };
  var region = "tr", feats = [], map = null, layer = null, markers = {};
  try { region = localStorage.getItem("deprem:bolge") || "tr"; } catch (e) { region = "tr"; }
  $("region").value = region;

  function initMap() {
    if (!window.L) { $("map").hidden = true; $("map-note").hidden = false; return; }
    map = L.map("map", { worldCopyJump: true, zoomControl: true }).setView(VIEW[region][0], VIEW[region][1]);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 19, attribution: "© OpenStreetMap katkıcıları © CARTO" }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  async function load() {
    $("status").className = "chip"; $("status").textContent = "Güncelleniyor…";
    try {
      var m = await KovanDB.fetchJSONMeta(SOURCES[region](), { ttl: 55, cacheKey: "usgs-" + region });
      feats = (m.data.features || []).filter(function (f) { return f.properties && f.properties.mag != null && f.geometry; }).sort(function (a, b) { return b.properties.time - a.properties.time; });
      render();
      $("status").className = "chip " + (m.stale ? "stale" : "live"); $("status").textContent = m.stale ? "Çevrimdışı · önbellek" : "Canlı · dakikada bir";
      $("updated").textContent = "Son güncelleme: " + new Date(m.at).toLocaleTimeString("tr-TR");
    } catch (e) {
      $("list").removeAttribute("aria-busy");
      $("list").innerHTML = '<li class="err" role="alert"><span>Deprem verisi alınamadı.</span><button class="btn" id="retry">Tekrar dene</button></li>';
      $("retry").onclick = load;
      $("status").className = "chip stale"; $("status").textContent = "Bağlantı sorunu";
    }
  }

  function render() {
    var min = parseFloat($("min").value), list = feats.filter(function (f) { return f.properties.mag >= min; });
    $("list").removeAttribute("aria-busy");
    var max = list.reduce(function (a, f) { return Math.max(a, f.properties.mag); }, 0);
    $("stats").innerHTML = '<div><b>' + list.length.toLocaleString("tr-TR") + '</b><small>deprem</small></div><div><b>' + (list.length ? max.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—") + '</b><small>en büyük</small></div>' +
      '<div><b>' + (list[0] ? ago(list[0].properties.time) : "—") + '</b><small>son deprem</small></div>';
    $("list").innerHTML = list.length ? list.slice(0, 150).map(function (f) {
      var p = f.properties, c = f.geometry.coordinates;
      return '<li class="q" tabindex="0" data-id="' + esc(f.id) + '"><span class="mag" style="background:' + color(p.mag) + '">' + p.mag.toFixed(1).replace(".", ",") + '</span><span><b>' + esc(p.place || "Bilinmeyen konum") + '</b><small>' +
        fmt.format(new Date(p.time)) + ' · ' + ago(p.time) + ' · derinlik ' + Number(c[2]).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + ' km</small></span></li>';
    }).join("") : '<li class="empty">Bu filtreyle deprem yok. Büyüklük sınırını düşür.</li>';
    if (layer) {
      layer.clearLayers(); markers = {};
      list.forEach(function (f) {
        var p = f.properties, c = f.geometry.coordinates;
        var mk = L.circleMarker([c[1], c[0]], { radius: Math.max(4, p.mag * 3.2), color: color(p.mag), weight: 1.5, fillColor: color(p.mag), fillOpacity: .45 })
          .bindPopup("<b>M" + p.mag.toFixed(1) + "</b> · " + esc(p.place || "") + "<br>" + fmt.format(new Date(p.time)) + "<br>Derinlik " + Number(c[2]).toFixed(1) + " km" + (p.url ? '<br><a href="' + esc(p.url) + '" target="_blank" rel="noopener">USGS ayrıntı ↗</a>' : ""));
        mk.addTo(layer); markers[f.id] = mk;
      });
    }
  }

  $("list").addEventListener("click", function (e) { focusQuake(e.target.closest("[data-id]")); });
  $("list").addEventListener("keydown", function (e) { if (e.key === "Enter") focusQuake(e.target.closest("[data-id]")); });
  function focusQuake(li) { if (!li || !map) return; var mk = markers[li.dataset.id]; if (mk) { map.setView(mk.getLatLng(), Math.max(map.getZoom(), 7)); mk.openPopup(); } }
  $("min").addEventListener("input", function () { $("minv").textContent = parseFloat(this.value).toLocaleString("tr-TR", { minimumFractionDigits: 1 }); render(); });
  $("region").addEventListener("change", function () { region = this.value; try { localStorage.setItem("deprem:bolge", region); } catch (e) { /* yok say */ } if (map) map.setView(VIEW[region][0], VIEW[region][1]); load(); });

  initMap(); load();
  setInterval(function () { if (!document.hidden) load(); }, 60000);
})();
