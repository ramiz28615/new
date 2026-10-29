// Yörünge — Spaceflight News API + NASA APOD (DEMO_KEY, günde bir kez önbellek). Gerçek haber, gerçek görsel.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
  var ago = function (d) { var s = (Date.now() - new Date(d)) / 1000; return s < 3600 ? rtf.format(-Math.max(1, Math.round(s / 60)), "minute") : s < 86400 ? rtf.format(-Math.round(s / 3600), "hour") : s < 2592000 ? rtf.format(-Math.round(s / 86400), "day") : new Date(d).toLocaleDateString("tr-TR", { dateStyle: "medium" }); };
  var API = "https://api.spaceflightnewsapi.net/v4/";
  var kind = "articles", next = null, term = "", ac = null;

  async function apod() {
    var box = $("apod");
    try {
      var j = await KovanDB.fetchJSON("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&thumbs=true", { ttl: 6 * 3600, storage: "local", cacheKey: "apod-" + new Date().toISOString().slice(0, 10) });
      var img = j.media_type === "image" ? j.url : j.thumbnail_url;
      box.removeAttribute("aria-busy");
      box.innerHTML = (img ? '<img class="apod-img" src="' + esc(img) + '" alt="' + esc(j.title) + '" loading="lazy">' : '<div class="apod-img"></div>') +
        '<div><div class="eyebrow">NASA · Günün astronomi görseli · ' + new Date(j.date + "T12:00:00").toLocaleDateString("tr-TR", { dateStyle: "long" }) + '</div><h1 id="apod-title">' + esc(j.title) + '</h1><p>' + esc(j.explanation) + '</p>' +
        '<a class="btn" href="https://apod.nasa.gov/apod/ap' + j.date.slice(2).replace(/-/g, "") + '.html" target="_blank" rel="noopener">NASA\'da aç ↗</a>' + (j.copyright ? ' <small class="muted">© ' + esc(j.copyright.trim()) + '</small>' : "") + '</div>';
    } catch (e) { box.hidden = true; } // APOD isteğe bağlı: DEMO_KEY kotası dolarsa haberler yine çalışır
  }

  function card(a) {
    return '<a class="post" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
      (a.image_url ? '<img src="' + esc(a.image_url) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=ph></div>\'">' : '<div class="ph"></div>') +
      '<div class="body"><div class="meta"><b>' + esc(a.news_site) + '</b><span>· ' + ago(a.published_at) + '</span></div><h3>' + esc(a.title) + '</h3><p>' + esc(a.summary) + '</p></div></a>';
  }
  function skeleton(n) { return Array.from({ length: n }, function () { return '<div class="post"><div class="sk" style="aspect-ratio:16/9;border-radius:0"></div><div class="body"><div class="sk" style="height:12px;width:40%"></div><div class="sk" style="height:40px"></div><div class="sk" style="height:36px"></div></div></div>'; }).join(""); }

  async function load(append) {
    var box = $("news");
    if (!append) { box.setAttribute("aria-busy", "true"); box.innerHTML = skeleton(6); }
    if (ac) ac.abort();
    ac = new AbortController();
    var url = append && next ? next : API + kind + "/?limit=12&ordering=-published_at" + (term ? "&search=" + encodeURIComponent(term) : "");
    $("more").disabled = true;
    try {
      var j = append ? await (await fetch(url, { signal: ac.signal })).json() : await KovanDB.fetchJSON(url, { ttl: 600 });
      next = j.next;
      var html = (j.results || []).map(card).join("");
      box.removeAttribute("aria-busy");
      if (append) box.insertAdjacentHTML("beforeend", html);
      else box.innerHTML = html || '<p class="empty">“' + esc(term) + '” için haber bulunamadı.</p>';
      $("more").hidden = !next; $("more").disabled = false;
      $("status").className = "chip live"; $("status").textContent = (j.count || 0).toLocaleString("tr-TR") + " kayıt · canlı";
      $("updated").textContent = "Son güncelleme: " + new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      if (e.name === "AbortError") return;
      box.removeAttribute("aria-busy");
      box.innerHTML = '<div class="err" role="alert"><span>Haberler yüklenemedi.</span><button class="btn" id="retry">Tekrar dene</button></div>';
      $("retry").onclick = function () { load(false); };
      $("status").className = "chip stale"; $("status").textContent = "Bağlantı sorunu"; $("more").disabled = false;
    }
  }

  document.querySelector(".tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-kind]"); if (!b) return;
    kind = b.dataset.kind; [].forEach.call(this.children, function (x) { x.setAttribute("aria-selected", String(x === b)); }); load(false);
  });
  var deb = null;
  $("q").addEventListener("input", function () { clearTimeout(deb); var v = this.value.trim(); deb = setTimeout(function () { if (v !== term) { term = v; load(false); } }, 400); });
  $("search").addEventListener("submit", function (e) { e.preventDefault(); term = $("q").value.trim(); load(false); });
  $("more").addEventListener("click", function () { load(true); });
  setInterval(function () { if (!document.hidden && !term && $("news").children.length <= 12) load(false); }, 10 * 60 * 1000);
  apod(); load(false);
})();
