// Döviz & Kripto — Frankfurter (ECB) + Binance piyasa verisi. Tüm sayılar canlı API'lerden gelir.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var FIAT = [["USD", "🇺🇸", "ABD doları"], ["EUR", "🇪🇺", "Euro"], ["GBP", "🇬🇧", "İngiliz sterlini"], ["CHF", "🇨🇭", "İsviçre frangı"], ["JPY", "🇯🇵", "Japon yeni (100)"], ["SAR", "🇸🇦", "Suudi riyali"], ["AED", "🇦🇪", "BAE dirhemi"], ["CNY", "🇨🇳", "Çin yuanı"]];
  var ECB = ["USD", "EUR", "GBP", "CHF", "JPY", "CNY"]; // SAR/AED ECB listesinde yok → open.er-api.com
  var COINS = [["BTCTRY", "Bitcoin", "BTC", "#f7931a"], ["ETHTRY", "Ethereum", "ETH", "#8c8cff"], ["BNBTRY", "BNB", "BNB", "#f3ba2f"], ["SOLTRY", "Solana", "SOL", "#14f195"], ["XRPTRY", "XRP", "XRP", "#d8dde6"], ["AVAXTRY", "Avalanche", "AVAX", "#e84142"], ["DOGETRY", "Dogecoin", "DOGE", "#c2a633"], ["USDTTRY", "Tether", "USDT", "#26a17b"]];
  var tl = function (v, max) { return Number(v).toLocaleString("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: max == null ? (v < 10 ? 4 : 2) : max }); };
  var pct = function (v) { return (v > 0 ? "+" : "") + Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; };
  var rates = { TRY: 1 }, last = {}, chartCode = "USD";

  function errBox(msg, retry) { return '<div class="err" role="alert"><span>' + esc(msg) + '</span><button class="btn" data-retry="' + retry + '">Tekrar dene</button></div>'; }
  document.addEventListener("click", function (e) { var b = e.target.closest("[data-retry]"); if (!b) return; ({ fx: loadFx, crypto: loadCrypto, chart: loadChart })[b.dataset.retry](); });

  // ---- fiat: 1 birim kaç ₺ (Frankfurter USD bazlı → çapraz kur)
  async function loadFx() {
    var box = $("fx");
    if (!box.children.length) box.innerHTML = FIAT.map(function () { return '<div class="tile"><div class="sk" style="height:16px;width:50%"></div><div class="sk" style="height:26px;margin-top:8px"></div></div>'; }).join("");
    try {
      var m = await KovanDB.fetchJSONMeta("https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY," + ECB.filter(function (c) { return c !== "USD"; }).join(","), { ttl: 3600 });
      var r = m.data.rates, tryPerUsd = r.TRY;
      ECB.forEach(function (c) { rates[c] = c === "USD" ? tryPerUsd : tryPerUsd / r[c]; });
      try { var er = await KovanDB.fetchJSON("https://open.er-api.com/v6/latest/USD", { ttl: 3600 }); ["SAR", "AED"].forEach(function (c) { if (er.rates && er.rates[c]) rates[c] = er.rates.TRY / er.rates[c]; }); } catch (e) { /* ek kurlar opsiyonel */ }
      box.removeAttribute("aria-busy");
      box.innerHTML = FIAT.filter(function (f) { return rates[f[0]]; }).map(function (f) {
        var v = f[0] === "JPY" ? rates.JPY * 100 : rates[f[0]];
        return '<div class="tile"><div class="code"><span aria-hidden="true">' + f[1] + '</span>' + f[0] + (f[0] === "JPY" ? " ×100" : "") + '</div><div class="val">' + tl(v, 4) + '</div><small>' + esc(f[2]) + '</small></div>';
      }).join("");
      $("fx-date").textContent = "ECB referans tarihi: " + new Date(m.data.date + "T12:00:00").toLocaleDateString("tr-TR", { dateStyle: "long" }) + (m.stale ? " · çevrimdışı" : "");
      fillSelects(); convert();
    } catch (e) { box.innerHTML = errBox("Döviz kurları alınamadı.", "fx"); }
  }

  function fillSelects() {
    var opts = ["TRY"].concat(FIAT.map(function (f) { return f[0]; }).filter(function (c) { return rates[c]; })).concat(COINS.filter(function (c) { return last[c[0]]; }).map(function (c) { return c[2]; }));
    ["from", "to"].forEach(function (id, k) {
      var s = $(id), cur = s.value || (k ? "TRY" : "USD");
      s.innerHTML = opts.map(function (o) { return "<option>" + o + "</option>"; }).join("");
      s.value = opts.indexOf(cur) >= 0 ? cur : opts[k ? 0 : 1];
    });
  }
  function tryValue(code) { if (code === "TRY") return 1; if (rates[code]) return rates[code]; var c = COINS.find(function (x) { return x[2] === code; }); return c && last[c[0]] ? +last[c[0]].lastPrice : null; }
  function convert() {
    var a = parseFloat($("amount").value), f = $("from").value, t = $("to").value, vf = tryValue(f), vt = tryValue(t);
    if (!(a >= 0) || !vf || !vt) { $("result").textContent = "—"; return; }
    var out = a * vf / vt;
    $("result").textContent = a.toLocaleString("tr-TR") + " " + f + " = " + out.toLocaleString("tr-TR", { maximumFractionDigits: out < 1 ? 8 : 2 }) + " " + t;
  }
  ["amount", "from", "to"].forEach(function (id) { $(id).addEventListener("input", convert); });
  $("swap").addEventListener("click", function () { var a = $("from").value; $("from").value = $("to").value; $("to").value = a; convert(); });

  // ---- 30 günlük grafik (Frankfurter zaman serisi, SVG çizgi)
  function isoDaysAgo(n) { var d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); }
  $("chart-pick").innerHTML = ["USD", "EUR", "GBP"].map(function (c) { return '<button type="button" aria-pressed="' + (c === chartCode) + '" data-c="' + c + '">' + c + '</button>'; }).join("");
  $("chart-pick").addEventListener("click", function (e) { var b = e.target.closest("[data-c]"); if (!b) return; chartCode = b.dataset.c; [].forEach.call(this.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); }); loadChart(); });
  async function loadChart() {
    var box = $("chart");
    try {
      var j = await KovanDB.fetchJSON("https://api.frankfurter.dev/v1/" + isoDaysAgo(31) + "..?base=" + chartCode + "&symbols=TRY", { ttl: 3600 });
      var days = Object.keys(j.rates).sort(), vals = days.map(function (d) { return j.rates[d].TRY; });
      if (vals.length < 2) { box.innerHTML = '<p class="empty">Grafik için yeterli veri yok.</p>'; return; }
      var W = 640, H = 200, P = 28, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), sp = hi - lo || 1;
      var pts = vals.map(function (v, i) { return [P + i * (W - 2 * P) / (vals.length - 1), H - P - (v - lo) / sp * (H - 2 * P)]; });
      var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      var ch = (vals[vals.length - 1] - vals[0]) / vals[0] * 100, col = ch >= 0 ? "#3ddc97" : "#ff6b6b";
      box.removeAttribute("aria-busy");
      box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + chartCode + '/TRY son 30 gün: ' + tl(vals[0], 4) + ' → ' + tl(vals[vals.length - 1], 4) + '">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".35"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + line + ' L' + pts[pts.length - 1][0] + ' ' + (H - P) + ' L' + P + ' ' + (H - P) + ' Z" fill="url(#g)"/><path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<text class="lbl" x="' + P + '" y="16">' + tl(hi, 4) + '</text><text class="lbl" x="' + P + '" y="' + (H - 8) + '">' + tl(lo, 4) + '</text>' +
        '<text class="lbl" x="' + (W - P) + '" y="16" text-anchor="end" fill="' + col + '">' + pct(ch) + ' · ' + new Date(days[0]).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) + ' – ' + new Date(days[days.length - 1]).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) + '</text></svg>';
    } catch (e) { box.innerHTML = errBox("Grafik verisi alınamadı.", "chart"); }
  }

  // ---- kripto (Binance 24 saat, 30 sn)
  async function loadCrypto() {
    var body = $("crypto");
    if (!body.children.length) body.innerHTML = COINS.map(function () { return '<tr><td colspan="6"><div class="sk" style="height:30px"></div></td></tr>'; }).join("");
    try {
      var syms = encodeURIComponent(JSON.stringify(COINS.map(function (c) { return c[0]; })));
      var m = await KovanDB.fetchJSONMeta("https://data-api.binance.vision/api/v3/ticker/24hr?symbols=" + syms, { ttl: 25 });
      var by = {}; m.data.forEach(function (t) { by[t.symbol] = t; });
      body.removeAttribute("aria-busy");
      body.innerHTML = COINS.filter(function (c) { return by[c[0]]; }).map(function (c) {
        var t = by[c[0]], ch = +t.priceChangePercent, prev = last[c[0]], flash = prev && +prev.lastPrice !== +t.lastPrice ? (+t.lastPrice > +prev.lastPrice ? "flash-up" : "flash-down") : "";
        return '<tr class="' + flash + '"><td><div class="coin"><span class="ico" style="background:' + c[3] + '" aria-hidden="true">' + c[2].slice(0, 1) + '</span><span><b>' + c[1] + '</b><small>' + c[2] + '</small></span></div></td>' +
          '<td><b>' + tl(+t.lastPrice) + '</b></td><td class="' + (ch >= 0 ? "up" : "down") + '">' + pct(ch) + '</td><td class="hide-sm">' + tl(+t.highPrice) + '</td><td class="hide-sm">' + tl(+t.lowPrice) + '</td>' +
          '<td class="hide-sm">' + Number(t.quoteVolume).toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 }) + ' ₺</td></tr>';
      }).join("");
      COINS.forEach(function (c) { if (by[c[0]]) last[c[0]] = by[c[0]]; });
      $("status").className = "chip " + (m.stale ? "stale" : "live"); $("status").textContent = m.stale ? "Çevrimdışı · önbellek" : "Canlı";
      $("updated").textContent = "Son güncelleme: " + new Date(m.at).toLocaleTimeString("tr-TR");
      if ($("from").options.length && $("from").options.length < 12) fillSelects();
      convert();
    } catch (e) { body.innerHTML = '<tr><td colspan="6">' + errBox("Kripto fiyatları alınamadı.", "crypto") + "</td></tr>"; $("status").className = "chip stale"; $("status").textContent = "Bağlantı sorunu"; }
  }

  $("refresh").addEventListener("click", function () { loadFx(); loadCrypto(); loadChart(); });
  setInterval(function () { if (!document.hidden) loadCrypto(); }, 30000);
  setInterval(function () { if (!document.hidden) loadFx(); }, 3600000);
  loadFx(); loadCrypto(); loadChart();
})();
