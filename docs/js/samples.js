// Offline demo project so the Studio can be explored without an API key.
export function demoFiles() {
  return {
    "index.html": `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kahve Durağı · Rezervasyon</title>
  <meta name="description" content="Kahve Durağı'nda masanı birkaç saniyede ayırt.">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E☕%3C/text%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="nav">
    <a class="logo" href="index.html">☕ Kahve Durağı</a>
    <nav aria-label="Ana menü"><a href="menu.html">Menü</a><a href="#rezervasyon" class="btn btn-sm">Masa ayırt</a></nav>
  </header>
  <main>
    <section class="hero">
      <p class="eyebrow">Kadıköy · 08:00–23:00</p>
      <h1>Kahven hazır,<br>masan da hazır olsun.</h1>
      <p class="lead">Taze kavrulmuş çekirdekler, ev yapımı tatlılar ve sakin bir köşe. Rezervasyonunu birkaç saniyede yap.</p>
      <a href="#rezervasyon" class="btn">Rezervasyon yap</a>
    </section>
    <section id="rezervasyon" class="card" aria-labelledby="rz-title">
      <h2 id="rz-title">Masa ayırt</h2>
      <form id="form" novalidate>
        <div class="grid">
          <label>Ad soyad<input name="ad" required autocomplete="name" placeholder="Ayşe Yılmaz"></label>
          <label>Telefon<input name="tel" required inputmode="tel" placeholder="05xx xxx xx xx"></label>
          <label>Tarih<input name="tarih" type="date" required></label>
          <label>Saat<select name="saat" required></select></label>
          <label>Kişi<input name="kisi" type="number" min="1" max="12" value="2" required></label>
        </div>
        <p class="error" id="err" role="alert"></p>
        <button class="btn" type="submit">Rezervasyonu onayla</button>
      </form>
    </section>
    <section class="card" aria-labelledby="my-title">
      <h2 id="my-title">Rezervasyonlarım</h2>
      <ul id="list" class="list"></ul>
    </section>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script src="app.js" defer></script>
</body>
</html>
`,
    "menu.html": `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Menü · Kahve Durağı</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="nav">
    <a class="logo" href="index.html">☕ Kahve Durağı</a>
    <nav aria-label="Ana menü"><a href="index.html">Ana sayfa</a><a href="index.html#rezervasyon" class="btn btn-sm">Masa ayırt</a></nav>
  </header>
  <main>
    <section class="card">
      <h1>Menü</h1>
      <ul class="menu">
        <li><span>Filtre kahve</span><b>₺95</b></li>
        <li><span>Flat white</span><b>₺120</b></li>
        <li><span>Türk kahvesi</span><b>₺80</b></li>
        <li><span>San Sebastian cheesecake</span><b>₺175</b></li>
        <li><span>Ev yapımı limonata</span><b>₺90</b></li>
      </ul>
    </section>
  </main>
</body>
</html>
`,
    "style.css": `:root{--bg:#fbf6ef;--ink:#2b1d14;--muted:#7a6656;--brand:#b5562d;--card:#fff;--r:18px}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 Inter,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
a{color:inherit}.nav{display:flex;justify-content:space-between;align-items:center;padding:16px clamp(16px,5vw,64px)}
.nav nav{display:flex;gap:16px;align-items:center}.logo{font:600 20px Fraunces,serif;text-decoration:none}
main{max-width:880px;margin:0 auto;padding:0 16px 64px}.hero{padding:48px 0 32px}
.eyebrow{color:var(--brand);font-weight:600;margin:0}h1,h2{font-family:Fraunces,serif;line-height:1.15}
h1{font-size:clamp(34px,6vw,56px);margin:8px 0}.lead{color:var(--muted);max-width:52ch}
.btn{display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:999px;padding:12px 22px;font:600 15px Inter,sans-serif;cursor:pointer;text-decoration:none}
.btn:hover{filter:brightness(1.08)}.btn:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #f2b27f;outline-offset:2px}
.btn-sm{padding:8px 14px}.card{background:var(--card);border-radius:var(--r);padding:24px;margin:16px 0;box-shadow:0 10px 30px -18px #2b1d1455}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
label{display:grid;gap:4px;font-weight:500;font-size:14px}input,select{font:inherit;padding:10px 12px;border:1px solid #e3d6c8;border-radius:12px;background:#fffdfa}
.error{color:#b42318;min-height:1.4em}.list,.menu{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.list li,.menu li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px;border:1px solid #efe4d8;border-radius:12px}
.list button{background:none;border:1px solid #e3d6c8;border-radius:999px;padding:6px 12px;cursor:pointer}
.empty{color:var(--muted)}.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(120px);background:var(--ink);color:#fff;padding:12px 18px;border-radius:999px;transition:transform .3s}
.toast.show{transform:translateX(-50%) translateY(0)}@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`,
    "app.js": `const KEY = "kd-rezervasyon";
const form = document.getElementById("form");
const list = document.getElementById("list");
const err = document.getElementById("err");
const toast = document.getElementById("toast");
const saat = form.elements.saat;

for (let h = 9; h <= 22; h++) for (const m of ["00", "30"]) saat.add(new Option(String(h).padStart(2, "0") + ":" + m));
form.elements.tarih.min = new Date().toISOString().slice(0, 10);

const load = () => JSON.parse(localStorage.getItem(KEY) || "[]");
const save = (v) => localStorage.setItem(KEY, JSON.stringify(v));

function render() {
  const items = load();
  list.innerHTML = items.length ? "" : '<li class="empty">Henüz rezervasyon yok.</li>';
  items.forEach((r, i) => {
    const li = document.createElement("li");
    li.innerHTML = "<span><b></b><br><small></small></span>";
    li.querySelector("b").textContent = r.ad + " · " + r.kisi + " kişi";
    li.querySelector("small").textContent = r.tarih + " " + r.saat;
    const b = document.createElement("button");
    b.textContent = "İptal et";
    b.addEventListener("click", () => { const v = load(); v.splice(i, 1); save(v); render(); show("Rezervasyon iptal edildi"); });
    li.append(b);
    list.append(li);
  });
}
function show(t) { toast.textContent = t; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2200); }

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  if (!d.ad.trim() || !/^0?5\\d{2}\\s?\\d{3}\\s?\\d{2}\\s?\\d{2}$/.test(d.tel.trim()) || !d.tarih) {
    err.textContent = "Lütfen adını, geçerli bir cep telefonunu ve tarihi gir.";
    return;
  }
  err.textContent = "";
  save([...load(), d]);
  form.reset();
  form.elements.kisi.value = 2;
  render();
  show("Masan ayrıldı! ☕");
});
render();
`,
  };
}
