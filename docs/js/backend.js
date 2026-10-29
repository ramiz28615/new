// Backend features for generated static sites: form sending, Supabase (DB + auth) or a localStorage data layer,
// cached/retrying fetch. The runtime below is serialised into the project as kovan-db.js (Function#toString), so it
// must stay self-contained (no references to this module's scope) and run as a classic script in any browser.
import { FORM_PROVIDERS } from "./apis.js";

export const SUPABASE_ESM = "https://esm.sh/@supabase/supabase-js@2.45.4";
export const KOVAN_DB_VERSION = "1";
export const HELPER_PATH = "kovan-db.js";
export const CONFIG_PATH = "kovan-config.js";
const MARK = "// kovan-db.js v" + KOVAN_DB_VERSION + " — Kovan Studio veri katmanı";

/* eslint-disable */
export function kovanDbRuntime(root) {
  "use strict";
  var SUPA = "https://esm.sh/@supabase/supabase-js@2.45.4";
  var cfg = root.KOVAN_CONFIG || {};
  var listeners = {};
  function store(kind) { try { var s = root[kind]; var k = "__kv"; s.setItem(k, "1"); s.removeItem(k); return s; } catch (e) { return null; } }
  var LS = store("localStorage"), SS = store("sessionStorage");
  var mem = {};
  function read(s, k) { try { if (s) { var v = s.getItem(k); return v == null ? null : JSON.parse(v); } } catch (e) {} return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }
  function write(s, k, v) { mem[k] = v; try { if (s) s.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function uid() { try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) {} return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); }
  function now() { return new Date().toISOString(); }
  function emit(name, rows) { (listeners[name] || []).slice().forEach(function (f) { try { f(rows); } catch (e) { console.warn(e); } }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tableName(n) { return String(n).toLowerCase().replace(/[çğıöşü]/g, function (c) { return { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u" }[c]; }).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "kayitlar"; }

  // ------------------------------------------------------------ supabase client (lazy)
  var sbPromise = null;
  function supabase() {
    if (!cfg.supabase || !cfg.supabase.url || !cfg.supabase.anonKey) return Promise.resolve(null);
    // root.__kovanSupabaseModule lets tests inject a stub; browsers load the pinned ESM build.
    if (!sbPromise) sbPromise = (root.__kovanSupabaseModule ? Promise.resolve(root.__kovanSupabaseModule) : import(SUPA)).then(function (m) { return m.createClient(cfg.supabase.url, cfg.supabase.anonKey, { auth: { persistSession: true, storage: LS || undefined } }); });
    return sbPromise;
  }
  function fromRow(r) { var o = Object.assign({}, r.data || {}); o.id = r.id; o.createdAt = r.created_at; if (r.user_id) o.userId = r.user_id; return o; }
  function sbErr(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }

  // ------------------------------------------------------------ collections
  function sortRows(rows, o) {
    o = o || {};
    var out = rows.slice();
    if (o.where) out = out.filter(function (r) { return Object.keys(o.where).every(function (k) { return r[k] === o.where[k]; }); });
    var by = o.orderBy || "createdAt", sign = o.desc ? -1 : 1;
    out.sort(function (a, b) { var x = a[by], y = b[by]; return (x > y ? 1 : x < y ? -1 : 0) * sign; });
    if (o.limit) out = out.slice(0, o.limit);
    return out;
  }
  function localCollection(name) {
    var key = "kovan-db:" + name;
    var all = function () { var v = read(LS, key); return Array.isArray(v) ? v : []; };
    var save = function (rows) { write(LS, key, rows); emit(name, rows); };
    return {
      name: name, backend: "local",
      list: function (o) { return Promise.resolve(sortRows(all(), o)); },
      get: function (id) { return Promise.resolve(all().filter(function (r) { return r.id === id; })[0] || null); },
      add: function (obj) { var r = Object.assign({}, obj, { id: (obj && obj.id) || uid(), createdAt: now() }); var rows = all(); rows.push(r); save(rows); return Promise.resolve(r); },
      update: function (id, patch) { var rows = all(), hit = null; rows = rows.map(function (r) { if (r.id !== id) return r; hit = Object.assign({}, r, patch, { id: id, updatedAt: now() }); return hit; }); if (!hit) return Promise.reject(new Error("Kayıt bulunamadı: " + id)); save(rows); return Promise.resolve(hit); },
      remove: function (id) { var rows = all(), n = rows.length; rows = rows.filter(function (r) { return r.id !== id; }); save(rows); return Promise.resolve(rows.length < n); },
      clear: function () { save([]); return Promise.resolve(); },
      subscribe: function (fn) { (listeners[name] = listeners[name] || []).push(fn); return function () { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); }; },
    };
  }
  function supaCollection(name) {
    var table = tableName(name);
    var refresh = function () { if (!(listeners[name] || []).length) return Promise.resolve([]); return api.list().then(function (rows) { emit(name, rows); return rows; }); };
    var api = {
      name: name, backend: "supabase", table: table,
      list: function (o) { o = o || {}; return supabase().then(function (sb) { var q = sb.from(table).select("*").order("created_at", { ascending: !o.desc }); if (o.limit && !o.where) q = q.limit(o.limit); return q; }).then(sbErr).then(function (rows) { return sortRows((rows || []).map(fromRow), o); }); },
      get: function (id) { return supabase().then(function (sb) { return sb.from(table).select("*").eq("id", id).maybeSingle(); }).then(sbErr).then(function (r) { return r ? fromRow(r) : null; }); },
      // insert without RETURNING so insert-only RLS policies (public forms) work; the id is generated client-side.
      add: function (obj) { var data = Object.assign({}, obj); delete data.id; var row = { id: uid(), data: data }; return supabase().then(function (sb) { return sb.from(table).insert(row); }).then(sbErr).then(function () { refresh().catch(function () {}); return fromRow({ id: row.id, data: data, created_at: now() }); }); },
      update: function (id, patch) { return api.get(id).then(function (cur) { if (!cur) throw new Error("Kayıt bulunamadı: " + id); var data = Object.assign({}, cur, patch); delete data.id; delete data.createdAt; delete data.userId; return supabase().then(function (sb) { return sb.from(table).update({ data: data }).eq("id", id).select().single(); }); }).then(sbErr).then(function (r) { refresh(); return fromRow(r); }); },
      remove: function (id) { return supabase().then(function (sb) { return sb.from(table).delete().eq("id", id); }).then(sbErr).then(function () { refresh(); return true; }); },
      clear: function () { return Promise.reject(new Error("Supabase'de toplu silme kapalı; kayıtları tek tek sil.")); },
      subscribe: function (fn) {
        (listeners[name] = listeners[name] || []).push(fn);
        var ch = null;
        supabase().then(function (sb) { ch = sb.channel("kovan-" + table).on("postgres_changes", { event: "*", schema: "public", table: table }, refresh).subscribe(); }).catch(function () {});
        return function () { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); if (ch) ch.unsubscribe(); };
      },
    };
    return api;
  }

  // ------------------------------------------------------------ auth
  function sha(text) {
    try { if (root.crypto && root.crypto.subtle && root.TextEncoder) return root.crypto.subtle.digest("SHA-256", new root.TextEncoder().encode(text)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }); } catch (e) {}
    var h = 0; for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return Promise.resolve("h" + h);
  }
  var authFns = [];
  function authEmit(u) { authFns.slice().forEach(function (f) { try { f(u); } catch (e) {} }); }
  var auth = {
    backend: function () { return cfg.supabase && cfg.supabase.url ? "supabase" : "local"; },
    signUp: function (email, password, profile) {
      email = String(email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject(new Error("Geçerli bir e-posta gir."));
      if (String(password || "").length < 6) return Promise.reject(new Error("Şifre en az 6 karakter olmalı."));
      return supabase().then(function (sb) {
        if (sb) return sb.auth.signUp({ email: email, password: password, options: { data: profile || {} } }).then(sbErr).then(function (d) { var u = d.user ? { id: d.user.id, email: d.user.email, profile: d.user.user_metadata || {} } : null; authEmit(u); return u; });
        var users = read(LS, "kovan-auth:users") || [];
        if (users.some(function (u) { return u.email === email; })) throw new Error("Bu e-posta zaten kayıtlı.");
        return sha(email + ":" + password).then(function (h) { var u = { id: uid(), email: email, hash: h, profile: profile || {}, createdAt: now() }; users.push(u); write(LS, "kovan-auth:users", users); var pub = { id: u.id, email: email, profile: u.profile }; write(LS, "kovan-auth:session", pub); authEmit(pub); return pub; });
      });
    },
    signIn: function (email, password) {
      email = String(email || "").trim().toLowerCase();
      return supabase().then(function (sb) {
        if (sb) return sb.auth.signInWithPassword({ email: email, password: password }).then(sbErr).then(function (d) { var u = { id: d.user.id, email: d.user.email, profile: d.user.user_metadata || {} }; authEmit(u); return u; });
        var users = read(LS, "kovan-auth:users") || [];
        return sha(email + ":" + password).then(function (h) { var u = users.filter(function (x) { return x.email === email && x.hash === h; })[0]; if (!u) throw new Error("E-posta veya şifre hatalı."); var pub = { id: u.id, email: u.email, profile: u.profile }; write(LS, "kovan-auth:session", pub); authEmit(pub); return pub; });
      });
    },
    signOut: function () { return supabase().then(function (sb) { if (sb) return sb.auth.signOut(); write(LS, "kovan-auth:session", null); }).then(function () { authEmit(null); }); },
    user: function () { return supabase().then(function (sb) { if (sb) return sb.auth.getUser().then(function (r) { var u = r.data && r.data.user; return u ? { id: u.id, email: u.email, profile: u.user_metadata || {} } : null; }); return read(LS, "kovan-auth:session"); }); },
    onChange: function (fn) { authFns.push(fn); return function () { authFns = authFns.filter(function (f) { return f !== fn; }); }; },
  };

  // ------------------------------------------------------------ forms
  function sendForm(data, opts) {
    opts = opts || {};
    var f = cfg.forms || {};
    var payload = Object.assign({}, data);
    var subject = opts.subject || (root.document && root.document.title ? root.document.title + " — yeni form" : "Yeni form");
    var keep = opts.collection ? KovanDB.collection(opts.collection).add(payload).catch(function (e) { console.warn("Form kaydı saklanamadı:", e && e.message); }) : Promise.resolve();
    var req = null;
    if (f.provider === "web3forms" && f.key) req = { url: "https://api.web3forms.com/submit", body: Object.assign({ access_key: f.key, subject: subject, from_name: opts.fromName || "Web sitesi" }, payload), check: function (j) { return j && j.success; } };
    else if (f.provider === "formsubmit" && f.key) req = { url: "https://formsubmit.co/ajax/" + encodeURIComponent(f.key), body: Object.assign({ _subject: subject, _template: "table", _captcha: "false" }, payload), check: function (j) { return j && (j.success === true || j.success === "true"); } };
    else if (f.provider === "formspree" && f.key) req = { url: "https://formspree.io/f/" + encodeURIComponent(f.key), body: Object.assign({ _subject: subject }, payload), check: function (j, r) { return r.ok && !(j && j.errors); } };
    if (!req) {
      return keep.then(function () {
        if (opts.collection) return { ok: true, via: "database" };
        return KovanDB.collection("form_gonderimleri").add(Object.assign({ _subject: subject }, payload)).then(function () { return { ok: true, via: "local", warning: "Form servisi ayarlanmadı; gönderim bu tarayıcıda saklandı." }; });
      });
    }
    return keep.then(function () {
      return root.fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(req.body) });
    }).then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
      if (!req.check(j, r)) throw new Error((j && (j.message || (j.errors && j.errors[0] && j.errors[0].message))) || "Form gönderilemedi (HTTP " + r.status + ").");
      return { ok: true, via: f.provider };
    }); });
  }

  // ------------------------------------------------------------ fetch with cache + retry
  function fetchJSONMeta(url, o) {
    o = o || {};
    var ttl = (o.ttl == null ? 300 : o.ttl) * 1000, key = "kovan-cache:" + (o.cacheKey || url);
    var st = o.storage === "local" ? LS : SS;
    var hit = read(st, key);
    if (hit && ttl > 0 && Date.now() - hit.at < ttl && !o.force) return Promise.resolve({ data: hit.data, at: hit.at, stale: false, cached: true });
    var tries = o.retries == null ? 2 : o.retries;
    function attempt(n) {
      var ac = root.AbortController ? new root.AbortController() : null;
      var timer = ac ? setTimeout(function () { ac.abort(); }, o.timeout || 10000) : null;
      return root.fetch(url, { signal: ac ? ac.signal : undefined, headers: o.headers || { Accept: "application/json" }, cache: o.noStore ? "no-store" : "default" })
        .then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
          return r.json();
        })
        .catch(function (e) {
          if (timer) clearTimeout(timer);
          var retryable = !e.status || e.status === 429 || e.status >= 500;
          if (n < tries && retryable) return sleep((e.status === 429 ? 1500 : 400) * Math.pow(2, n)).then(function () { return attempt(n + 1); });
          throw e;
        });
    }
    return attempt(0).then(function (data) { var at = Date.now(); write(st, key, { at: at, data: data }); return { data: data, at: at, stale: false, cached: false }; })
      .catch(function (e) { if (hit) return { data: hit.data, at: hit.at, stale: true, cached: true, error: e }; throw e; });
  }

  var KovanDB = {
    version: "1",
    backend: cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey ? "supabase" : "local",
    collection: function (name) { return KovanDB.backend === "supabase" ? supaCollection(name) : localCollection(name); },
    supabase: supabase,
    auth: auth,
    sendForm: sendForm,
    fetchJSON: function (url, o) { return fetchJSONMeta(url, o).then(function (m) { return m.data; }); },
    fetchJSONMeta: fetchJSONMeta,
    formatNumber: function (n, d) { return Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }); },
    formatMoney: function (n, cur) { return Number(n).toLocaleString("tr-TR", { style: "currency", currency: cur || "TRY", maximumFractionDigits: Math.abs(n) < 10 ? 4 : 2 }); },
    formatDate: function (d, opt) { return new Date(d).toLocaleString("tr-TR", opt || { dateStyle: "medium", timeStyle: "short" }); },
    timeAgo: function (d) { var s = Math.round((Date.now() - new Date(d).getTime()) / 1000); var rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" }); if (Math.abs(s) < 60) return rtf.format(-s, "second"); if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), "minute"); if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), "hour"); return rtf.format(-Math.round(s / 86400), "day"); },
  };
  root.KovanDB = KovanDB;
  return KovanDB;
}
/* eslint-enable */

/** Source of kovan-db.js as written into projects. */
export function kovanDbSource() {
  return MARK + "\n// Bu dosyayı Kovan Studio yönetir; düzenleme yerine kovan-config.js ve uygulama kodunu değiştir.\n" +
    "// API: KovanDB.collection(ad).list/get/add/update/remove/subscribe · KovanDB.auth.signUp/signIn/signOut/user · " +
    "KovanDB.sendForm(veri,{subject,collection}) · KovanDB.fetchJSON(url,{ttl,retries}) · KovanDB.formatMoney/formatDate/timeAgo\n" +
    "(" + kovanDbRuntime.toString() + ")(window);\n";
}

/** Public, non-secret backend settings stored by Studio. */
export function normalizeBackend(b = {}) {
  const forms = b.forms || {};
  const provider = FORM_PROVIDERS[forms.provider] ? forms.provider : "";
  const key = String(forms.key || "").trim();
  const sb = b.supabase || {};
  let url = String(sb.url || "").trim().replace(/\/+$/, "");
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^https:\/\//.test(url)) url = "";
  const anonKey = String(sb.anonKey || "").trim();
  return {
    forms: provider && key ? { provider, key } : { provider: "", key: "" },
    supabase: url && anonKey ? { url, anonKey } : { url: "", anonKey: "" },
  };
}
export function backendStatus(b) {
  const n = normalizeBackend(b);
  return { forms: !!n.forms.provider, supabase: !!n.supabase.url };
}

/** kovan-config.js content: only public values (form key / Supabase anon key are designed to be public). */
export function configSource(b) {
  const n = normalizeBackend(b);
  const pub = {};
  if (n.forms.provider) pub.forms = { provider: n.forms.provider, key: n.forms.key };
  if (n.supabase.url) pub.supabase = { url: n.supabase.url, anonKey: n.supabase.anonKey };
  return "// Kovan Studio tarafından üretildi — yalnızca herkese açık değerler (Supabase anon anahtarı RLS ile korunur; service_role anahtarını ASLA buraya koyma).\n" +
    "window.KOVAN_CONFIG = " + JSON.stringify(pub, null, 2) + ";\n";
}

/**
 * Add/refresh kovan-db.js + kovan-config.js in a web project. Returns the list of changed paths.
 * A user-edited kovan-db.js (without the Studio marker) is left alone.
 */
export function ensureHelpers(files, backend) {
  const changed = [];
  const src = kovanDbSource(), conf = configSource(backend);
  const cur = files[HELPER_PATH];
  if (cur == null || (String(cur).startsWith("// kovan-db.js v") && cur !== src)) { files[HELPER_PATH] = src; changed.push(HELPER_PATH); }
  if (files[CONFIG_PATH] !== conf) { files[CONFIG_PATH] = conf; changed.push(CONFIG_PATH); }
  return changed;
}

/** Make sure an HTML page loads the helpers (config first). */
export function helperTags() { return `<script src="${CONFIG_PATH}"></script>\n<script src="${HELPER_PATH}"></script>`; }

// ---------------------------------------------------------------- Supabase schema
const fold = (s) => String(s).toLowerCase().replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }[c]));
export function tableName(n) { return fold(n).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "kayitlar"; }

/** Collections used by project code: KovanDB.collection("x") and supabase .from("x"). */
export function detectCollections(files) {
  const names = new Set();
  for (const [p, c] of Object.entries(files || {})) {
    if (p === HELPER_PATH || !/\.(m?js|html?|jsx)$/i.test(p)) continue;
    const s = String(c);
    for (const m of s.matchAll(/KovanDB\s*\.\s*collection\(\s*["'`]([^"'`]{1,60})["'`]/g)) names.add(m[1]);
    for (const m of s.matchAll(/\.from\(\s*["'`]([a-z0-9_]{1,60})["'`]\s*\)\s*\.(?:select|insert|update|delete|upsert)/g)) names.add(m[1]);
    for (const m of s.matchAll(/sendForm\([^)]*collection\s*:\s*["'`]([^"'`]{1,60})["'`]/g)) names.add(m[1]);
  }
  return [...names];
}

/** Guess an access policy from a collection name. */
export function guessAccess(name) {
  const n = fold(name);
  if (/rezerv|reserv|booking|randevu|iletisim|contact|mesaj|message|form|basvuru|siparis|order|talep|abone|subscri|yorum|review|feedback/.test(n)) return "public-insert";
  if (/menu|urun|product|blog|post|yazi|haber|etkinlik|event|kategori|category|galeri/.test(n)) return "public-read";
  return "owner";
}

/**
 * SQL for the Supabase SQL editor. Every collection maps to a table with a jsonb `data` column (what KovanDB uses)
 * and RLS policies: owner (signed-in user sees/edits own rows), public-insert (anyone can submit, only the owner/
 * dashboard reads), public-read (everyone reads, signed-in users write their own).
 */
export function schemaSql(collections) {
  const list = (collections || []).map((c) => (typeof c === "string" ? { name: c, access: guessAccess(c) } : { access: guessAccess(c.name), ...c }));
  const out = ["-- Kovan Studio · Supabase şeması", "-- Supabase → SQL Editor → New query → bu metni yapıştır → Run.", "-- Her tablo KovanDB ile uyumludur (data jsonb). RLS açık; politikaları ihtiyacına göre daralt.", "create extension if not exists pgcrypto;", ""];
  for (const c of list) {
    const t = tableName(c.name);
    out.push(`-- ${c.name} (${c.access === "owner" ? "yalnızca sahibi" : c.access === "public-insert" ? "herkes ekler, sahibi/panel okur" : "herkes okur, giriş yapan ekler"})`,
      `create table if not exists public.${t} (`,
      "  id uuid primary key default gen_random_uuid(),",
      "  data jsonb not null default '{}'::jsonb,",
      "  user_id uuid references auth.users(id) on delete set null default auth.uid(),",
      "  created_at timestamptz not null default now()",
      ");",
      `alter table public.${t} enable row level security;`,
      `create index if not exists ${t}_created_at_idx on public.${t} (created_at desc);`);
    const pol = (name, sql) => out.push(`drop policy if exists "${name}" on public.${t};`, sql);
    if (c.access === "public-insert") {
      pol(`${t}_herkes_ekler`, `create policy "${t}_herkes_ekler" on public.${t} for insert to anon, authenticated with check (true);`);
      pol(`${t}_sahibi_okur`, `create policy "${t}_sahibi_okur" on public.${t} for select to authenticated using (auth.uid() = user_id);`);
    } else if (c.access === "public-read") {
      pol(`${t}_herkes_okur`, `create policy "${t}_herkes_okur" on public.${t} for select to anon, authenticated using (true);`);
      pol(`${t}_giris_ekler`, `create policy "${t}_giris_ekler" on public.${t} for insert to authenticated with check (auth.uid() = user_id);`);
      pol(`${t}_sahibi_gunceller`, `create policy "${t}_sahibi_gunceller" on public.${t} for update to authenticated using (auth.uid() = user_id);`);
      pol(`${t}_sahibi_siler`, `create policy "${t}_sahibi_siler" on public.${t} for delete to authenticated using (auth.uid() = user_id);`);
    } else {
      pol(`${t}_sahibi_hepsi`, `create policy "${t}_sahibi_hepsi" on public.${t} for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);`);
    }
    out.push(`do $$ begin alter publication supabase_realtime add table public.${t}; exception when duplicate_object then null; end $$; -- canlı güncelleme`, "");
  }
  if (!list.length) out.push("-- Projede KovanDB.collection(\"...\") kullanımı bulunamadı. Örnek:", ...schemaSql([{ name: "kayitlar", access: "owner" }]).split("\n").slice(5));
  return out.join("\n");
}

export const SCHEMA_STEPS = [
  "supabase.com'da ücretsiz proje oluştur.",
  "Project Settings → API (Data API) sayfasından Project URL ve anon public anahtarını Kovan Ayarlar'a yapıştır.",
  "SQL Editor → New query → aşağıdaki şemayı yapıştır → Run.",
  "Giriş/kayıt kullanacaksan Authentication → Providers → Email'i açık tut; test için “Confirm email”i kapatabilirsin.",
  "Authentication → URL Configuration → Site URL'ye yayın adresini (örn. https://kullanici.github.io/proje/) ekle.",
];

// ---------------------------------------------------------------- prompt rules
/** System prompt section describing the data/backend layer available to generated web projects. */
export function backendPrompt(backend) {
  const n = normalizeBackend(backend);
  const form = n.forms.provider
    ? `Forms are LIVE: the user configured ${FORM_PROVIDERS[n.forms.provider].label}. Submit every contact/booking/order form with
  const res = await KovanDB.sendForm(data, { subject: "Yeni rezervasyon", collection: "rezervasyonlar" }); // collection = also store a copy
  It returns { ok, via } or throws an Error with a Turkish message. Disable the button + show a spinner while sending, show success/error inline, keep the entered values on error.`
    : `No form service is configured yet. Still call KovanDB.sendForm(data, { subject, collection }) — it stores the submission (database or this browser) and returns { ok, via: "local"|"database", warning }.
  When via === "local", show the success state plus a small note: "Form servisi henüz bağlı değil — Kovan Ayarlar'dan Web3Forms/FormSubmit/Formspree ekleyince e-postana gelir." Never fake a sent e-mail.`;
  const db = n.supabase.url
    ? `DATABASE + AUTH = SUPABASE (configured: ${n.supabase.url}). kovan-config.js holds the URL and the public anon key; kovan-db.js loads supabase-js v2 (pinned ESM: import { createClient } from "${SUPABASE_ESM}") lazily.
- Do CRUD through KovanDB.collection("rezervasyonlar") (async list/get/add/update/remove/subscribe; each collection is a table with columns id, data jsonb, user_id, created_at; records come back as { id, ...data, createdAt, userId }).
- For queries KovanDB can't express: const sb = await KovanDB.supabase(); await sb.from("table").select("*").eq(...) — inside type="module" scripts you may also import { createClient } from "${SUPABASE_ESM}" and read window.KOVAN_CONFIG.supabase.
- Auth: KovanDB.auth.signUp(email, password, profile) / signIn / signOut / user() / onChange(fn). Build real sign-in/sign-up screens with validation and Turkish errors.
- ALWAYS also output <file path="supabase/schema.sql"> with: create table for every collection (id uuid primary key default gen_random_uuid(), data jsonb not null default '{}', user_id uuid default auth.uid() references auth.users, created_at timestamptz default now()), alter table … enable row level security, and explicit policies (owner rows: auth.uid() = user_id; public forms: insert for anon with check (true), select only for authenticated owner; public catalogs: select for anon). Never use or mention the service_role key in client code.`
    : `DATABASE = LOCAL (no Supabase configured). kovan-db.js persists data in localStorage with the same async API, so CRUD apps keep their data across reloads:
- KovanDB.collection("gorevler").add({ ... }) / .list({ orderBy, desc, limit, where }) / .get(id) / .update(id, patch) / .remove(id) / .subscribe(rows => render(rows)). Records: { id, ...fields, createdAt }.
- Auth (if needed): KovanDB.auth.signUp/signIn/signOut/user/onChange — local demo accounts (hashed). Say in the UI footer that data is stored in this browser until Supabase is connected in Kovan Settings.
- Write the code against KovanDB only; the same code switches to Supabase when the user adds it.`;
  return `# DATA LAYER & BACKEND (no server needed)
The project already contains two Studio-managed files: "${CONFIG_PATH}" (public settings) and "${HELPER_PATH}" (data layer). Do NOT create, rewrite or delete them.
Every HTML page that saves data, sends forms or fetches APIs must load them before its own scripts:
  <script src="${CONFIG_PATH}"></script>
  <script src="${HELPER_PATH}"></script>
${db}
- ${form}
- Fetch helper: await KovanDB.fetchJSON(url, { ttl: 600 }) — sessionStorage cache (ttl seconds), timeout, 2 retries with backoff on 429/5xx, falls back to the last cached copy when offline. KovanDB.fetchJSONMeta(url, opts) also returns { at, stale, cached }.
- Formatting: KovanDB.formatMoney(n, "TRY"), KovanDB.formatNumber(n, digits), KovanDB.formatDate(d), KovanDB.timeAgo(d) (all tr-TR).`;
}
