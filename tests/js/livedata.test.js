// Live data (0.4): API catalog, prompt injection, snippets, kovan-db.js runtime, backend config, Supabase schema,
// preview sandbox. Templates are covered in templates.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOG, CATEGORIES, FORM_PROVIDERS, selectApis, catalogPrompt, snippetFor, searchCatalog, testApi, apiById } from "../../docs/js/apis.js";
import { systemPrompt, liveDataPrompt } from "../../docs/js/prompts.js";
import { kovanDbRuntime, kovanDbSource, configSource, normalizeBackend, ensureHelpers, backendPrompt, schemaSql, detectCollections, guessAccess, tableName, SUPABASE_ESM, HELPER_PATH, CONFIG_PATH } from "../../docs/js/backend.js";
import { buildPreview, standaloneDocument, PREVIEW_SANDBOX } from "../../docs/js/preview.js";
import { fetchWidgets, widgetsHtml, WIDGET_SOURCES } from "../../docs/js/livewidgets.js";

const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));

// ---------------------------------------------------------------- catalog
test("catalog: complete, keyless, https, unique ids, Turkish descriptions", () => {
  assert.ok(CATALOG.length >= 30, "at least 30 verified APIs");
  const ids = new Set();
  for (const a of CATALOG) {
    assert.ok(!ids.has(a.id), "duplicate id " + a.id); ids.add(a.id);
    for (const k of ["name", "base", "example", "sample", "rate", "desc"]) assert.ok(a[k] && String(a[k]).length > 3, a.id + " missing " + k);
    assert.ok(CATEGORIES[a.category], a.id + " category");
    assert.match(a.example, /^https:\/\//);
    assert.ok(!/[\s"[\]]/.test(a.example), a.id + " example must be a fetchable URL");
    assert.ok(["ok", "limited"].includes(a.status));
    assert.ok(Array.isArray(a.keywords) && a.keywords.length, a.id + " keywords");
    assert.match(a.desc, /[çğıöşüİ]|\b(ve|için|ile)\b/i, a.id + " desc should be Turkish");
    assert.ok(!/api[_-]?key=(?!DEMO_KEY)/i.test(a.example), a.id + " must be keyless");
  }
  for (const id of ["open-meteo", "open-meteo-geocoding", "frankfurter", "binance", "usgs", "tvmaze", "spaceflight-news", "wikipedia-summary", "picsum", "carto-tiles"]) assert.ok(apiById(id), id);
  assert.ok(!CATALOG.some((a) => /deezer|zenquotes|openaq|restcountries|nominatim|api\.binance\.com/.test(a.example)), "APIs that failed verification are excluded");
  assert.deepEqual(Object.keys(FORM_PROVIDERS).sort(), ["formspree", "formsubmit", "web3forms"]);
});

test("catalog: search is accent-insensitive and filters by category", () => {
  assert.ok(searchCatalog("doviz").some((a) => a.id === "frankfurter"));
  assert.ok(searchCatalog("DEPREM").every((a) => /deprem|earthquake/i.test(a.name + a.desc + a.keywords.join(" ") + a.category)));
  assert.ok(searchCatalog("", "kripto").every((a) => a.category === "kripto"));
  assert.equal(searchCatalog("").length, CATALOG.length);
});

test("selectApis: relevant subset by keywords, companions, demo-only excluded, bounded", () => {
  const ids = (q, o) => selectApis(q, o).map((a) => a.id);
  const w = ids("İstanbul hava durumu sitesi yap");
  assert.equal(w[0], "open-meteo");
  assert.ok(w.includes("open-meteo-geocoding") && w.includes("wttr"));
  assert.ok(ids("Bitcoin ve ethereum fiyat takip").includes("binance"));
  assert.ok(ids("dolar euro kur çevirici").includes("frankfurter"));
  const q = ids("son depremler haritası");
  assert.ok(q.includes("usgs") && q.includes("carto-tiles"));
  assert.equal(ids("dizi arama uygulaması")[0], "tvmaze");
  assert.ok(ids("uzay haberleri").includes("spaceflight-news"));
  assert.ok(ids("yemek tarifleri sitesi").includes("themealdb"));
  assert.ok(!ids("todo uygulaması").some((id) => ["jsonplaceholder", "randomuser"].includes(id)), "demo APIs only when named");
  assert.ok(ids("jsonplaceholder ile rest demo").includes("jsonplaceholder"));
  assert.deepEqual(ids("todo uygulaması"), ["picsum"], "unrelated prompt -> only real images");
  assert.deepEqual(ids("todo uygulaması", { images: false }), []);
  assert.ok(selectApis("hava döviz kripto deprem dizi haber uzay yemek harita kedi köpek", { max: 4 }).length <= 6);
});

test("prompt injection: live rules + only the relevant catalog subset; toggle and project types", () => {
  const s = systemPrompt("web", { text: "İstanbul hava durumu ve dolar kuru" });
  assert.match(s, /# LIVE DATA \(mandatory/);
  assert.match(s, /NEVER invent numbers/);
  assert.match(s, /skeleton/); assert.match(s, /Tekrar dene/); assert.match(s, /tr-TR/); assert.match(s, /Attribution/);
  assert.match(s, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(s, /api\.frankfurter\.dev/);
  assert.ok(!s.includes("api.tvmaze.com"), "unrelated APIs are not injected");
  assert.match(s, /picsum\.photos/);
  assert.match(s, /KovanDB\.fetchJSON/);
  assert.ok(!/simulate data with realistic seeded sample data/.test(s), "old fake-data rule is gone");
  assert.ok(s.length < 16000, "bounded prompt size: " + s.length);
  const off = systemPrompt("web", { text: "hava durumu", liveData: false });
  assert.ok(!off.includes("# LIVE DATA"));
  assert.match(off, /live data disabled/);
  assert.ok(!systemPrompt("python", { text: "hava durumu" }).includes("LIVE DATA"));
  const rn = systemPrompt("reactnative", { text: "hava durumu uygulaması" });
  assert.match(rn, /LIVE DATA/); assert.ok(!rn.includes("KovanDB.fetchJSON"));
  assert.match(liveDataPrompt("kedi fotoğrafları"), /thecatapi/);
  assert.match(catalogPrompt([apiById("coingecko")]), /per-IP quota/);
});

test("snippet for “Projeye ekle”: endpoint, shape, limits and runtime rules", () => {
  const s = snippetFor(apiById("usgs"));
  assert.match(s, /earthquake\.usgs\.gov/);
  assert.match(s, /Yanıt şekli/); assert.match(s, /Sınır/); assert.match(s, /Atıf: Deprem verisi: USGS/);
  assert.match(s, /uydurma sayı kullanma/);
});

test("testApi: live call result (json, http error, network error)", async () => {
  const ok = await testApi(apiById("frankfurter"), { fetchImpl: async (u) => { assert.equal(u, apiById("frankfurter").example); return new Response('{"rates":{"TRY":49.8}}', { headers: { "content-type": "application/json" } }); } });
  assert.equal(ok.ok, true); assert.equal(ok.json.rates.TRY, 49.8); assert.ok(ok.ms >= 0);
  const bad = await testApi(apiById("usgs"), { fetchImpl: async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } }) });
  assert.equal(bad.ok, false); assert.equal(bad.status, 503);
  const net = await testApi(apiById("usgs"), { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(net.status, 0); assert.match(net.error, /Failed to fetch/);
});

// ---------------------------------------------------------------- kovan-db.js runtime
function memStorage(seed = {}) {
  const d = { ...seed };
  return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, dump: () => d };
}
function fakeWindow({ config = {}, fetch, ls = memStorage(), supabase } = {}) {
  return { KOVAN_CONFIG: config, localStorage: ls, sessionStorage: memStorage(), fetch, AbortController, TextEncoder, crypto: globalThis.crypto, document: { title: "Test Sitesi" }, __kovanSupabaseModule: supabase };
}
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });

test("kovan-db.js: local CRUD, ordering, where, subscribe, persistence across reloads", async () => {
  const ls = memStorage();
  const db = kovanDbRuntime(fakeWindow({ ls }));
  assert.equal(db.backend, "local");
  const todos = db.collection("gorevler");
  const seen = [];
  const off = todos.subscribe((rows) => seen.push(rows.length));
  const a = await todos.add({ baslik: "Süt al", oncelik: 2, bitti: false });
  await new Promise((r) => setTimeout(r, 2));
  const b = await todos.add({ baslik: "Faturayı öde", oncelik: 1, bitti: false });
  assert.ok(a.id && a.createdAt && a.id !== b.id);
  assert.deepEqual((await todos.list()).map((r) => r.baslik), ["Süt al", "Faturayı öde"]);
  assert.deepEqual((await todos.list({ orderBy: "oncelik" })).map((r) => r.oncelik), [1, 2]);
  assert.deepEqual((await todos.list({ desc: true, limit: 1 })).map((r) => r.baslik), ["Faturayı öde"]);
  const u = await todos.update(a.id, { bitti: true });
  assert.equal(u.bitti, true); assert.ok(u.updatedAt);
  assert.deepEqual((await todos.list({ where: { bitti: true } })).map((r) => r.id), [a.id]);
  assert.equal((await todos.get(b.id)).baslik, "Faturayı öde");
  await assert.rejects(todos.update("yok", {}), /bulunamadı/);
  assert.equal(await todos.remove(b.id), true);
  off();
  await todos.add({ baslik: "sessiz" });
  assert.deepEqual(seen, [1, 2, 2, 1], "subscribers get every change until unsubscribed");
  // a "reload": new runtime over the same storage keeps the data; the serialized source behaves the same
  const win2 = fakeWindow({ ls });
  new Function("window", kovanDbSource())(win2);
  assert.deepEqual((await win2.KovanDB.collection("gorevler").list()).map((r) => r.baslik), ["Süt al", "sessiz"]);
  assert.ok(JSON.parse(ls.getItem("kovan-db:gorevler")).length === 2);
});

test("kovan-db.js: fetchJSON caches, retries 5xx, falls back to the last copy when offline", async () => {
  let n = 0, mode = "flaky";
  const fetch = async (url) => {
    n++;
    if (mode === "down") throw new TypeError("offline");
    if (mode === "flaky" && n === 1) return json({}, 503);
    return json({ url, n });
  };
  const db = kovanDbRuntime(fakeWindow({ fetch }));
  const r1 = await db.fetchJSON("https://api.example/x", { ttl: 60 });
  assert.equal(r1.n, 2, "retried after 503");
  const r2 = await db.fetchJSON("https://api.example/x", { ttl: 60 });
  assert.equal(r2.n, 2, "served from cache"); assert.equal(n, 2);
  mode = "down";
  const m = await db.fetchJSONMeta("https://api.example/x", { ttl: 0, retries: 0 });
  assert.equal(m.stale, true); assert.equal(m.data.n, 2);
  await assert.rejects(db.fetchJSON("https://api.example/other", { retries: 0 }), /offline/);
  const http = kovanDbRuntime(fakeWindow({ fetch: async () => json({}, 404) }));
  await assert.rejects(http.fetchJSON("https://api.example/404", { retries: 2 }), /HTTP 404/, "4xx is not retried");
  assert.equal(db.formatMoney(1234.5, "TRY").replace(/\s/g, " "), "₺1.234,50");
  assert.match(db.formatDate("2026-10-30T10:00:00Z"), /2026/);
});

test("kovan-db.js: sendForm via Web3Forms / FormSubmit / Formspree and local fallback", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), method: init.method }); return json({ success: true }); };
  const data = { ad: "Ayşe Yılmaz", telefon: "05321234567" };
  let db = kovanDbRuntime(fakeWindow({ fetch, config: { forms: { provider: "web3forms", key: "abc-123" } } }));
  assert.deepEqual(await db.sendForm(data, { subject: "Yeni rezervasyon", collection: "rezervasyonlar" }), { ok: true, via: "web3forms" });
  assert.equal(calls[0].url, "https://api.web3forms.com/submit"); assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.access_key, "abc-123"); assert.equal(calls[0].body.subject, "Yeni rezervasyon"); assert.equal(calls[0].body.ad, "Ayşe Yılmaz");
  assert.equal((await db.collection("rezervasyonlar").list()).length, 1, "copy stored in the collection");
  db = kovanDbRuntime(fakeWindow({ fetch, config: { forms: { provider: "formsubmit", key: "sahip@ornek.com" } } }));
  await db.sendForm(data);
  assert.equal(calls[1].url, "https://formsubmit.co/ajax/sahip%40ornek.com"); assert.equal(calls[1].body._captcha, "false");
  db = kovanDbRuntime(fakeWindow({ fetch, config: { forms: { provider: "formspree", key: "xayzabcd" } } }));
  await db.sendForm(data, { subject: "İletişim" });
  assert.equal(calls[2].url, "https://formspree.io/f/xayzabcd"); assert.equal(calls[2].body._subject, "İletişim");
  // provider error -> rejects with its message
  db = kovanDbRuntime(fakeWindow({ fetch: async () => json({ success: false, message: "Geçersiz anahtar" }, 400), config: { forms: { provider: "web3forms", key: "x" } } }));
  await assert.rejects(db.sendForm(data), /Geçersiz anahtar/);
  // no provider -> stored locally, never a fake "sent"
  const ls = memStorage();
  db = kovanDbRuntime(fakeWindow({ ls, fetch: async () => { throw new Error("must not fetch"); } }));
  const r = await db.sendForm(data);
  assert.equal(r.via, "local"); assert.match(r.warning, /saklandı/);
  assert.equal(JSON.parse(ls.getItem("kovan-db:form_gonderimleri")).length, 1);
});

test("kovan-db.js: local auth (hashed passwords, sessions)", async () => {
  const ls = memStorage();
  const db = kovanDbRuntime(fakeWindow({ ls }));
  const events = [];
  db.auth.onChange((u) => events.push(u && u.email));
  await assert.rejects(db.auth.signUp("bozuk", "123456"), /e-posta/);
  await assert.rejects(db.auth.signUp("a@b.co", "123"), /6 karakter/);
  const u = await db.auth.signUp("Ali@Ornek.com", "gizli123", { ad: "Ali" });
  assert.equal(u.email, "ali@ornek.com");
  assert.ok(!ls.getItem("kovan-auth:users").includes("gizli123"), "password is not stored in clear text");
  await assert.rejects(db.auth.signUp("ali@ornek.com", "gizli123"), /zaten/);
  await db.auth.signOut();
  assert.equal(await db.auth.user(), null);
  await assert.rejects(db.auth.signIn("ali@ornek.com", "yanlis1"), /hatalı/);
  assert.equal((await db.auth.signIn("ali@ornek.com", "gizli123")).profile.ad, "Ali");
  assert.equal((await db.auth.user()).email, "ali@ornek.com");
  assert.deepEqual(events, ["ali@ornek.com", null, "ali@ornek.com"]);
});

function fakeSupabase() {
  const tables = {}, log = [];
  const client = (url, key) => {
    log.push(["createClient", url, key]);
    const from = (t) => {
      tables[t] = tables[t] || [];
      const q = { op: "select", filters: [], t };
      const run = () => {
        let rows = tables[t];
        for (const [k, v] of q.filters) rows = rows.filter((r) => r[k] === v);
        if (q.op === "insert") { log.push(["insert", t, q.row]); tables[t].push({ ...q.row, created_at: new Date().toISOString(), user_id: null }); return { data: null, error: null }; }
        if (q.op === "update") { rows.forEach((r) => Object.assign(r, q.patch)); return { data: q.single ? rows[0] : rows, error: null }; }
        if (q.op === "delete") { tables[t] = tables[t].filter((r) => !rows.includes(r)); return { data: null, error: null }; }
        return { data: q.single ? rows[0] || null : rows, error: null };
      };
      const b = {
        select() { if (q.op === "select") q.op = "select"; return b; }, order(c, o) { q.order = [c, o]; return b; }, limit(n) { q.limit = n; return b; },
        eq(k, v) { q.filters.push([k, v]); return b; }, maybeSingle() { q.single = true; return b; }, single() { q.single = true; return b; },
        insert(row) { q.op = "insert"; q.row = row; return b; }, update(p) { q.op = "update"; q.patch = p; return b; }, delete() { q.op = "delete"; return b; },
        then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
      };
      return b;
    };
    return { from, channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }), auth: { getUser: async () => ({ data: { user: null } }) } };
  };
  return { module: { createClient: client }, tables, log };
}

test("kovan-db.js: Supabase backend — table per collection, insert without RETURNING (works with insert-only RLS)", async () => {
  const sb = fakeSupabase();
  const db = kovanDbRuntime(fakeWindow({ config: { supabase: { url: "https://abcd.supabase.co", anonKey: "anon-public" } }, supabase: sb.module }));
  assert.equal(db.backend, "supabase");
  const col = db.collection("Rezervasyonlar Ön");
  assert.equal(col.table, "rezervasyonlar_on");
  const r = await col.add({ ad: "Ayşe", kisi: 2 });
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(sb.log[0], ["createClient", "https://abcd.supabase.co", "anon-public"]);
  const ins = sb.log.find((l) => l[0] === "insert");
  assert.equal(ins[1], "rezervasyonlar_on"); assert.deepEqual(ins[2].data, { ad: "Ayşe", kisi: 2 });
  const list = await col.list();
  assert.equal(list[0].ad, "Ayşe"); assert.equal(list[0].id, r.id);
  await col.update(r.id, { kisi: 4 });
  assert.equal((await col.get(r.id)).kisi, 4);
  await col.remove(r.id);
  assert.deepEqual(await col.list(), []);
});

// ---------------------------------------------------------------- backend config + prompt rules
test("backend config: only public values reach the project; helpers are managed", () => {
  const secret = { keys: { openrouter: "sk-or-v1-SECRET" }, ghToken: "ghp_SECRET", forms: { provider: "web3forms", key: "w3f-key" }, supabase: { url: "https://abcd.supabase.co/", anonKey: "anon-key" } };
  const src = configSource(secret);
  assert.ok(!/SECRET/.test(src), "provider keys / GitHub token never written");
  assert.match(src, /"provider": "web3forms"/); assert.match(src, /"url": "https:\/\/abcd\.supabase\.co"/);
  assert.deepEqual(normalizeBackend({ forms: { provider: "evil", key: "x" } }).forms, { provider: "", key: "" });
  assert.deepEqual(normalizeBackend({ supabase: { url: "javascript:alert(1)", anonKey: "k" } }).supabase, { url: "", anonKey: "" });
  const files = { "index.html": "<h1>x</h1>" };
  assert.deepEqual(ensureHelpers(files, secret).sort(), [CONFIG_PATH, HELPER_PATH].sort());
  assert.deepEqual(ensureHelpers(files, secret), [], "idempotent");
  assert.deepEqual(ensureHelpers(files, {}), [CONFIG_PATH], "config follows the settings");
  files[HELPER_PATH] = "// my own data layer";
  ensureHelpers(files, {});
  assert.equal(files[HELPER_PATH], "// my own data layer", "user-owned helper is not overwritten");
  // preview never contains anything but the project's files
  const html = buildPreview({ ...files, "index.html": '<script src="kovan-config.js"></script><h1>x</h1>' }, "index.html", { seed: { a: "1" } });
  assert.ok(!/SECRET/.test(html));
});

test("backend prompt: Supabase rules (pinned supabase-js v2, schema.sql + RLS) vs local KovanDB; forms", () => {
  const sb = backendPrompt({ supabase: { url: "https://abcd.supabase.co", anonKey: "k" } });
  assert.match(sb, /SUPABASE/);
  assert.ok(sb.includes(SUPABASE_ESM)); assert.match(SUPABASE_ESM, /@supabase\/supabase-js@2\.\d+\.\d+$/);
  assert.match(sb, /supabase\/schema\.sql/); assert.match(sb, /row level security/); assert.match(sb, /auth\.uid\(\) = user_id/);
  assert.match(sb, /service_role/); assert.match(sb, /KovanDB\.auth\.signUp/);
  const local = backendPrompt({});
  assert.match(local, /DATABASE = LOCAL/); assert.match(local, /localStorage/); assert.ok(!local.includes(SUPABASE_ESM));
  assert.match(local, /No form service is configured/); assert.match(local, /Never fake a sent e-mail/);
  assert.match(backendPrompt({ forms: { provider: "formsubmit", key: "a@b.co" } }), /Forms are LIVE: the user configured FormSubmit/);
  for (const p of [local, sb]) { assert.match(p, /<script src="kovan-config\.js"><\/script>/); assert.match(p, /Do NOT create, rewrite or delete them/); }
  assert.match(systemPrompt("web", { text: "x", backend: { supabase: { url: "https://abcd.supabase.co", anonKey: "k" } } }), /DATABASE \+ AUTH = SUPABASE/);
});

test("Supabase schema: tables, RLS policies per access type, collections detected from code", () => {
  const files = {
    "app.js": 'const r = KovanDB.collection("rezervasyonlar"); KovanDB.collection(\'gorevler\'); await sb.from("menu_items").select("*");',
    "index.html": '<script>KovanDB.sendForm(d, { subject: "x", collection: "iletisim" })</script>',
    [HELPER_PATH]: 'KovanDB.collection("ignored")',
  };
  assert.deepEqual(detectCollections(files).sort(), ["gorevler", "iletisim", "menu_items", "rezervasyonlar"]);
  assert.equal(guessAccess("rezervasyonlar"), "public-insert"); assert.equal(guessAccess("menu_items"), "public-read"); assert.equal(guessAccess("gorevler"), "owner");
  assert.equal(tableName("Sipariş Listesi"), "siparis_listesi");
  const sql = schemaSql(detectCollections(files));
  for (const tname of ["rezervasyonlar", "gorevler", "menu_items", "iletisim"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${tname} \\(`));
    assert.match(sql, new RegExp(`alter table public\\.${tname} enable row level security;`));
  }
  assert.match(sql, /on public\.rezervasyonlar for insert to anon, authenticated with check \(true\)/);
  assert.match(sql, /on public\.rezervasyonlar for select to authenticated using \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /on public\.menu_items for select to anon, authenticated using \(true\)/);
  assert.match(sql, /on public\.gorevler for all to authenticated using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
  assert.match(sql, /data jsonb not null/); assert.match(sql, /exception when duplicate_object/);
  assert.ok(!/to anon[^;]*for (update|delete)/.test(sql) && !/for (update|delete) to anon/.test(sql), "anon never updates/deletes");
  assert.match(schemaSql([]), /create table if not exists public\.kayitlar/);
});

// ---------------------------------------------------------------- preview sandbox
test("preview sandbox: network-capable, isolated from the Studio origin", () => {
  for (const k of ["allow-scripts", "allow-forms", "allow-modals", "allow-popups"]) assert.ok(PREVIEW_SANDBOX.split(" ").includes(k), k);
  assert.ok(!PREVIEW_SANDBOX.includes("allow-same-origin"), "opaque origin: no access to the Studio's localStorage/IndexedDB keys");
  assert.ok(!PREVIEW_SANDBOX.includes("allow-top-navigation"));
  const html = readFileSync(DOCS + "index.html", "utf8");
  const m = /<iframe id="pv-frame"[^>]*sandbox="([^"]+)"/.exec(html);
  assert.equal(m[1], PREVIEW_SANDBOX, "index.html iframe matches PREVIEW_SANDBOX");
  assert.ok(!/http-equiv="Content-Security-Policy"/i.test(html), "no CSP blocks API calls from the preview");
  const sa = standaloneDocument({ "index.html": "<h1>a</h1>" });
  assert.ok(sa.includes(`sandbox="${PREVIEW_SANDBOX}"`));
});

// ---------------------------------------------------------------- Studio live widget strip
test("live widgets: values from verified APIs, cache, graceful offline", async () => {
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(u);
    if (u === WIDGET_SOURCES.weather) return json({ current: { temperature_2m: 13.6, weather_code: 2 } });
    if (u === WIDGET_SOURCES.fx) return json({ rates: { TRY: 49.837, EUR: 0.86 } });
    if (u === WIDGET_SOURCES.btc) return json({ lastPrice: "3920994.00", priceChangePercent: "-3.25" });
    throw new Error("unexpected " + u);
  };
  const storage = memStorage();
  const w = await fetchWidgets({ fetchImpl, storage, now: 1000 });
  assert.equal(w.temp, 13.6); assert.equal(w.usd, 49.837); assert.ok(Math.abs(w.eur - 57.95) < 0.01); assert.equal(w.btc, 3920994);
  const html = widgetsHtml(w);
  assert.match(html, /14°C/); assert.match(html, /₺49,8370/); assert.match(html, /3\.920\.994/); assert.match(html, /-3,25%/); assert.match(html, /canlı/);
  const again = await fetchWidgets({ fetchImpl: async () => { throw new Error("cached"); }, storage, now: 2000 });
  assert.equal(again.cached, true);
  // weather fallback + partial outage
  const part = await fetchWidgets({ storage: memStorage(), fetchImpl: async (u) => { if (u === WIDGET_SOURCES.weatherFallback) return json({ current_condition: [{ temp_C: "12" }] }); throw new TypeError("down"); } });
  assert.equal(part.temp, 12); assert.equal(part.usd, null); assert.equal(part.offline, false);
  const off = await fetchWidgets({ storage: memStorage(), fetchImpl: async () => { throw new TypeError("offline"); } });
  assert.equal(off.offline, true); assert.match(widgetsHtml(off), /çevrimdışı/); assert.match(widgetsHtml(off), /—/);
  assert.ok(seen.every((u) => Object.values(WIDGET_SOURCES).includes(u)));
});
