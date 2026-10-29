// Lokanta Nar — rezervasyon formu gerçekten gönderilir (KovanDB.sendForm: Web3Forms/FormSubmit/Formspree, Supabase
// ya da yerel kayıt), menü görselleri TheMealDB'den, seçilen günün hava tahmini Open-Meteo'dan gelir.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var form = $("form"), MINE = "rezervasyonlarim";
  var LAT = 40.987, LON = 29.026; // Moda, Kadıköy

  // saat ve kişi seçenekleri
  for (var h = 12; h <= 22; h++) ["00", "30"].forEach(function (m) { form.elements.saat.add(new Option(String(h).padStart(2, "0") + ":" + m)); });
  for (var k = 1; k <= 12; k++) form.elements.kisi.add(new Option(k + " kişi", k));
  form.elements.kisi.value = "2";
  var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  form.elements.tarih.min = today; form.elements.tarih.value = today;

  var cfg = window.KOVAN_CONFIG || {};
  $("backend-note").textContent = cfg.forms && cfg.forms.provider ? "Gönderim: " + { web3forms: "Web3Forms", formsubmit: "FormSubmit", formspree: "Formspree" }[cfg.forms.provider] + " ile e-posta" + (cfg.supabase && cfg.supabase.url ? " + Supabase kaydı" : "")
    : cfg.supabase && cfg.supabase.url ? "Rezervasyonlar Supabase veritabanına kaydedilir." : "Form servisi henüz bağlı değil — rezervasyonlar bu tarayıcıda saklanır. Kovan Ayarlar'dan Web3Forms/FormSubmit/Formspree veya Supabase ekle.";

  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove("show"); }, 3200); }
  function mine() { try { return JSON.parse(localStorage.getItem(MINE)) || []; } catch (e) { return []; } }
  function saveMine(v) { try { localStorage.setItem(MINE, JSON.stringify(v)); } catch (e) { /* depolama kapalı */ } }
  function renderMine() {
    var list = mine();
    $("mine").innerHTML = list.length ? list.map(function (r, i) {
      return '<li><span><b>' + esc(r.tarihGoster) + ' · ' + esc(r.saat) + '</b><br><small>' + esc(r.kisi) + ' kişi · ' + esc(r.alan) + '</small></span><button class="btn" data-rm="' + i + '" aria-label="Listeden kaldır">✕</button></li>';
    }).join("") : '<li class="muted">Henüz rezervasyon yok.</li>';
  }
  $("mine").addEventListener("click", function (e) { var b = e.target.closest("[data-rm]"); if (!b) return; var v = mine(); v.splice(+b.dataset.rm, 1); saveMine(v); renderMine(); });

  function validate(d) {
    var bad = [];
    if (d.ad.trim().length < 3) bad.push(["ad", "Adını ve soyadını yaz."]);
    if (!/^(\+90|0)?\s*5\d{2}\s*\d{3}\s*\d{2}\s*\d{2}$/.test(d.telefon.trim())) bad.push(["telefon", "Geçerli bir cep telefonu yaz (05xx xxx xx xx)."]);
    if (d.eposta && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.eposta)) bad.push(["eposta", "E-posta adresi geçersiz."]);
    if (!d.tarih || d.tarih < today) bad.push(["tarih", "Bugün veya sonrası için bir tarih seç."]);
    if (d.tarih === today) { var now = new Date(), parts = d.saat.split(":"); if (+parts[0] * 60 + +parts[1] < now.getHours() * 60 + now.getMinutes() + 30) bad.push(["saat", "Bugün için en az 30 dakika sonrasını seç."]); }
    [].forEach.call(form.elements, function (el) { if (el.name) el.removeAttribute("aria-invalid"); });
    bad.forEach(function (b) { form.elements[b[0]].setAttribute("aria-invalid", "true"); });
    if (bad.length) form.elements[bad[0][0]].focus();
    return bad.map(function (b) { return b[1]; });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(form));
    var errs = validate(d);
    $("err").textContent = errs.join(" ");
    if (errs.length) return;
    var btn = $("submit"), label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Gönderiliyor…';
    d.tarihGoster = new Date(d.tarih + "T12:00:00").toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "long" });
    try {
      var res = await KovanDB.sendForm(d, { subject: "Yeni rezervasyon: " + d.ad + " · " + d.tarihGoster + " " + d.saat + " · " + d.kisi + " kişi", collection: "rezervasyonlar", fromName: "Lokanta Nar web sitesi" });
      saveMine(mine().concat([d])); renderMine();
      form.reset(); form.elements.tarih.value = today; form.elements.kisi.value = "2"; $("weather-hint").textContent = "";
      toast(res.via === "local" ? "Rezervasyon kaydedildi (form servisi bağlı değil)." : "Rezervasyonun alındı! Onay için seni arayacağız.");
      $("err").textContent = "";
    } catch (err) { $("err").textContent = "Gönderilemedi: " + err.message + " Lütfen tekrar dene veya bizi ara."; }
    finally { btn.disabled = false; btn.textContent = label; }
  });

  // seçilen günün hava tahmini (7 gün içindeyse) — teras önerisi
  var forecast = null;
  async function loadForecast() {
    try { forecast = await KovanDB.fetchJSON("https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON + "&daily=weather_code,temperature_2m_max,precipitation_probability_max&current=temperature_2m,weather_code&timezone=Europe%2FIstanbul&forecast_days=7", { ttl: 1800 }); }
    catch (e) { forecast = null; }
    hint(); todayBox();
  }
  function hint() {
    var el = $("weather-hint"), d = form.elements.tarih.value;
    if (!forecast || !d) { el.textContent = ""; return; }
    var i = forecast.daily.time.indexOf(d);
    if (i < 0) { el.textContent = ""; return; }
    var t = Math.round(forecast.daily.temperature_2m_max[i]), p = forecast.daily.precipitation_probability_max[i] || 0;
    el.textContent = "O gün Kadıköy'de en yüksek " + t + "°C, yağış ihtimali %" + p + (p < 30 && t >= 18 ? " — teras için güzel bir gün ☀️" : p >= 50 ? " — salonu öneririz ☔" : ".");
  }
  function todayBox() {
    if (!forecast || !forecast.current) { $("today").innerHTML = '<span class="muted">Hava durumu şu an alınamadı.</span>'; return; }
    $("today").innerHTML = '<small class="muted">Şu an Kadıköy</small><b>' + Math.round(forecast.current.temperature_2m) + '°C</b><small class="muted">Open-Meteo · ' + new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) + '</small>';
  }
  form.elements.tarih.addEventListener("change", hint);

  // menü görselleri (TheMealDB, Türk mutfağı)
  async function loadMenu() {
    var box = $("menu-grid");
    box.innerHTML = Array.from({ length: 8 }, function () { return '<div class="dish"><div class="sk" style="aspect-ratio:4/3;border-radius:0"></div><div><div class="sk" style="height:14px"></div></div></div>'; }).join("");
    try {
      var j = await KovanDB.fetchJSON("https://www.themealdb.com/api/json/v1/1/filter.php?a=Turkish", { ttl: 86400, storage: "local" });
      var meals = (j.meals || []).slice(0, 12);
      box.removeAttribute("aria-busy");
      box.innerHTML = meals.map(function (m) { return '<figure class="dish" style="margin:0"><img src="' + esc(m.strMealThumb) + '/medium" alt="' + esc(m.strMeal) + '" loading="lazy" onerror="this.src=\'' + esc(m.strMealThumb) + '\'"><div>' + esc(m.strMeal) + '</div></figure>'; }).join("");
      if (meals[0]) document.getElementById("hero").style.setProperty("--hero", "url('" + meals[0].strMealThumb + "')");
    } catch (e) { box.innerHTML = '<div class="err" role="alert"><span>Menü görselleri yüklenemedi.</span><button class="btn" id="menu-retry">Tekrar dene</button></div>'; $("menu-retry").onclick = loadMenu; }
  }

  renderMine(); loadMenu(); loadForecast();
})();
