// Dizi Rehberi — TVmaze (arama, yayın akışı, ayrıntı + oyuncular + bölümler). Listem KovanDB'de kalıcı.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var strip = function (html) { var d = document.createElement("div"); d.innerHTML = html || ""; return d.textContent.trim(); };
  var favs = KovanDB.collection("favoriler"), favList = [], tab = "discover", ac = null, lastQuery = "";
  var API = "https://api.tvmaze.com";

  function showCard(s) {
    var isFav = favList.some(function (f) { return f.showId === s.id; });
    return '<div class="show" role="button" tabindex="0" data-id="' + s.id + '">' +
      (s.image ? '<img src="' + esc(s.image.medium) + '" alt="' + esc(s.name) + ' afişi" loading="lazy">' : '<div class="ph" aria-hidden="true">🎬</div>') +
      (s.rating && s.rating.average ? '<span class="rating">★ ' + s.rating.average.toLocaleString("tr-TR") + '</span>' : "") +
      '<button class="fav" data-fav="' + s.id + '" aria-pressed="' + isFav + '" aria-label="' + (isFav ? "Listemden çıkar" : "Listeme ekle") + '">' + (isFav ? "♥" : "♡") + '</button>' +
      '<div class="info"><b>' + esc(s.name) + '</b><small>' + esc([(s.premiered || "").slice(0, 4), (s.genres || []).slice(0, 2).join(", ")].filter(Boolean).join(" · ")) + '</small></div></div>';
  }
  var cache = {};
  function remember(list) { list.forEach(function (s) { cache[s.id] = s; }); return list; }
  function skeleton() { return Array.from({ length: 12 }, function () { return '<div class="show"><div class="sk" style="aspect-ratio:2/3;border-radius:0"></div><div class="info"><div class="sk" style="height:14px"></div></div></div>'; }).join(""); }
  function fail(msg, retry) { $("shows").removeAttribute("aria-busy"); $("shows").innerHTML = '<div class="err" role="alert" style="grid-column:1/-1"><span>' + esc(msg) + '</span><button class="btn" id="retry">Tekrar dene</button></div>'; $("retry").onclick = retry; }

  async function schedule() {
    $("title").textContent = "Bugün ABD'de yayında"; $("shows").innerHTML = skeleton(); $("shows").setAttribute("aria-busy", "true");
    try {
      var eps = await KovanDB.fetchJSON(API + "/schedule?country=US", { ttl: 1800 });
      var seen = {}, shows = [];
      eps.forEach(function (e) { if (e.show && !seen[e.show.id]) { seen[e.show.id] = 1; shows.push(e.show); } });
      shows.sort(function (a, b) { return ((b.rating && b.rating.average) || 0) - ((a.rating && a.rating.average) || 0) || (b.weight || 0) - (a.weight || 0); });
      render(remember(shows.slice(0, 36)));
      $("updated").textContent = "Yayın akışı: " + new Date().toLocaleDateString("tr-TR", { dateStyle: "full" });
    } catch (e) { fail("Yayın akışı alınamadı.", schedule); }
  }
  async function search(q) {
    if (ac) ac.abort(); ac = new AbortController();
    $("title").textContent = "“" + q + "” için sonuçlar"; $("shows").innerHTML = skeleton(); $("status").textContent = "Aranıyor…";
    try {
      var r = await fetch(API + "/search/shows?q=" + encodeURIComponent(q), { signal: ac.signal });
      if (r.status === 429) throw new Error("rate");
      var j = await r.json();
      render(remember(j.map(function (x) { return x.show; })));
      $("status").textContent = j.length + " sonuç";
    } catch (e) { if (e.name !== "AbortError") { fail(e.message === "rate" ? "Çok hızlı arama yapıldı, birkaç saniye bekle." : "Arama yapılamadı.", function () { search(q); }); $("status").textContent = "Hata"; } }
  }
  function render(list) {
    $("shows").removeAttribute("aria-busy");
    $("shows").innerHTML = list.length ? list.map(showCard).join("") : '<p class="empty" style="grid-column:1/-1">Sonuç bulunamadı. Farklı bir isim dene.</p>';
  }
  function renderFavs() {
    $("title").textContent = "Listem";
    render(favList.map(function (f) { return f.show; }));
    if (!favList.length) $("shows").innerHTML = '<p class="empty" style="grid-column:1/-1">Listen boş. Bir dizinin ♡ düğmesine bas.</p>';
  }

  async function toggleFav(id) {
    var hit = favList.find(function (f) { return f.showId === id; });
    try {
      if (hit) await favs.remove(hit.id);
      else { var s = cache[id]; await favs.add({ showId: id, show: { id: s.id, name: s.name, image: s.image, rating: s.rating, genres: s.genres, premiered: s.premiered } }); }
      await loadFavs();
      if (tab === "list") renderFavs(); else document.querySelectorAll('[data-fav="' + id + '"]').forEach(function (b) { var on = !hit; b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "♥" : "♡"; b.setAttribute("aria-label", on ? "Listemden çıkar" : "Listeme ekle"); });
    } catch (e) { alert("Liste güncellenemedi: " + e.message); }
  }
  async function loadFavs() { try { favList = await favs.list({ orderBy: "createdAt", desc: true }); } catch (e) { favList = []; } $("fav-count").textContent = favList.length; }

  async function detail(id) {
    var m = $("modal"), sh = $("sheet");
    m.hidden = false; sh.innerHTML = '<div class="sk" style="aspect-ratio:2/3"></div><div><div class="sk" style="height:28px;width:60%"></div><div class="sk" style="height:120px;margin-top:12px"></div></div>';
    try {
      var s = await KovanDB.fetchJSON(API + "/shows/" + id + "?embed[]=cast&embed[]=episodes", { ttl: 3600 });
      var cast = (s._embedded && s._embedded.cast || []).slice(0, 12), eps = (s._embedded && s._embedded.episodes || []).slice(-10).reverse();
      sh.innerHTML = '<button class="btn close" id="close" aria-label="Kapat">✕</button>' +
        (s.image ? '<img src="' + esc(s.image.original || s.image.medium) + '" alt="' + esc(s.name) + ' afişi">' : '<div class="ph" style="aspect-ratio:2/3;border-radius:12px;background:var(--panel-2)"></div>') +
        '<div><h3 id="m-title">' + esc(s.name) + '</h3><div class="muted">' + esc([s.premiered && new Date(s.premiered).getFullYear() + (s.ended ? "–" + new Date(s.ended).getFullYear() : "–"), s.network ? s.network.name : s.webChannel ? s.webChannel.name : "", s.status === "Running" ? "Devam ediyor" : s.status === "Ended" ? "Bitti" : s.status].filter(Boolean).join(" · ")) + '</div>' +
        '<div class="tags">' + (s.rating && s.rating.average ? '<span class="chip">★ ' + s.rating.average.toLocaleString("tr-TR") + '</span>' : "") + (s.genres || []).map(function (g) { return '<span class="chip">' + esc(g) + '</span>'; }).join("") + (s.runtime ? '<span class="chip">' + s.runtime + ' dk</span>' : "") + '</div>' +
        '<p>' + esc(strip(s.summary)) + ' <small class="muted">(özet İngilizce, TVmaze)</small></p>' +
        (eps.length ? '<h4>Son bölümler</h4><ul class="eps">' + eps.map(function (e) { return '<li><span>S' + e.season + 'B' + e.number + ' · ' + esc(e.name) + '</span><small class="muted">' + (e.airdate ? new Date(e.airdate).toLocaleDateString("tr-TR") : "") + '</small></li>'; }).join("") + '</ul>' : "") +
        (cast.length ? '<h4>Oyuncular</h4><div class="cast">' + cast.map(function (c) { return '<figure>' + (c.person.image ? '<img src="' + esc(c.person.image.medium) + '" alt="" loading="lazy">' : '<div class="ph"></div>') + '<b>' + esc(c.person.name) + '</b><br><span class="muted">' + esc(c.character.name) + '</span></figure>'; }).join("") + '</div>' : "") +
        '<p><a href="' + esc(s.url) + '" target="_blank" rel="noopener">TVmaze\'de aç ↗</a>' + (s.officialSite ? ' · <a href="' + esc(s.officialSite) + '" target="_blank" rel="noopener">Resmî site ↗</a>' : "") + '</p></div>';
      $("close").focus(); $("close").onclick = close;
    } catch (e) { sh.innerHTML = '<div class="err" role="alert" style="grid-column:1/-1"><span>Ayrıntılar alınamadı.</span><button class="btn" id="close">Kapat</button></div>'; $("close").onclick = close; }
  }
  function close() { $("modal").hidden = true; }
  $("modal").addEventListener("click", function (e) { if (e.target === this) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) close(); });

  $("shows").addEventListener("click", function (e) {
    var f = e.target.closest("[data-fav]"); if (f) { e.stopPropagation(); toggleFav(+f.dataset.fav); return; }
    var c = e.target.closest("[data-id]"); if (c) detail(+c.dataset.id);
  });
  $("shows").addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.matches("[data-id]")) detail(+e.target.dataset.id); });
  var deb = null;
  $("q").addEventListener("input", function () { clearTimeout(deb); var v = this.value.trim(); deb = setTimeout(function () { if (v === lastQuery) return; lastQuery = v; setTab("discover"); if (v.length >= 2) search(v); else if (!v) schedule(); }, 350); });
  $("search").addEventListener("submit", function (e) { e.preventDefault(); var v = $("q").value.trim(); if (v) { lastQuery = v; setTab("discover"); search(v); } });
  function setTab(t) { tab = t; document.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tab === t)); }); }
  document.querySelector(".tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; setTab(b.dataset.tab); if (tab === "list") renderFavs(); else if (lastQuery) search(lastQuery); else schedule(); });

  loadFavs().then(function () { favList.forEach(function (f) { cache[f.showId] = f.show; }); schedule(); });
})();
