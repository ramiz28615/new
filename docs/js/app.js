// Kovan Studio — UI wiring. Plain ES modules, no build step.
import { t, setLang, getLang, applyI18n } from "./i18n.js";
import { ProjectStore, newProject, snapshot, restoreVersion, duplicateProject, settings } from "./store.js";
import { PROVIDERS, streamChat, listModels, pickFreeModel, estimateCost, ProviderError } from "./providers.js";
import { FileStreamParser, stripFileBlocks, fallbackFromText } from "./parser.js";
import { systemPrompt, buildMessages, ENHANCE_PROMPT, fixErrorPrompt, projectContext } from "./prompts.js";
import { buildPreview, standaloneDocument, PREVIEW_SANDBOX, PREVIEW_ALLOW } from "./preview.js";
import { CATALOG, CATEGORIES, FORM_PROVIDERS, VERIFIED_AT, searchCatalog, snippetFor, testApi } from "./apis.js";
import { normalizeBackend, ensureHelpers, schemaSql, detectCollections, SCHEMA_STEPS } from "./backend.js";
import { LIVE_TEMPLATES, DEMO_TEMPLATE, loadLiveTemplate } from "./livetemplates.js";
import { mountWidgets } from "./livewidgets.js";
import { exportZip, importZip, loadJSZip } from "./zip.js";
import { deployToGitHub, deployErrorMessage, sanitizeRepoName } from "./deploy.js";
import { encodeShare, decodeShare } from "./share.js";
import { createEditor } from "./editor.js";
import { TYPES, TYPE_IDS, TEMPLATES, detectType, reviewPrompt, runCommands, pythonEntry, snackUrl, snackPayload,
  pyinstallerWorkflow, easWorkflow, easConfig, PYINSTALLER_WORKFLOW_PATH, EAS_WORKFLOW_PATH } from "./projecttypes.js";
import { sortPaths, htmlPages, isBinaryContent, isTextPath, mimeOf, normPath, resolveRef, estimateTokens, slugify, bytesToDataUrl } from "./vfs.js";
import { initMotor } from "./motor.js";
import { initNotebook } from "./notebook.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
const DEFAULT_NAME = () => t("untitled");

const S = {
  store: null, p: null, cfg: null, view: "build", pane: "chat", wtab: "run",
  cur: null, gen: null, streamPaths: {}, attachments: [], logs: [], page: "index.html", dev: 0,
  models: [], py: { worker: null, running: false, stderr: "" }, notebook: null, saveT: null, pvT: null, estT: null,
};

// ---------------------------------------------------------------- helpers
function toast(msg, kind = "info", ms = 4200) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function modal({ title, body = "", input = null, ok = t("ok"), cancel = t("cancel"), danger = false, html = false }) {
  return new Promise((resolve) => {
    const m = $("modal"), inp = $("modal-input");
    $("modal-title").textContent = title;
    if (html) $("modal-body").innerHTML = body; else $("modal-body").textContent = body;
    inp.hidden = !input;
    if (input) { inp.value = input.value || ""; inp.placeholder = input.placeholder || ""; }
    $("modal-ok").textContent = ok;
    $("modal-ok").className = "btn " + (danger ? "btn-danger" : "btn-primary");
    $("modal-cancel").textContent = cancel;
    $("modal-cancel").hidden = cancel === null;
    m.hidden = false;
    const prev = document.activeElement;
    setTimeout(() => (input ? inp : $("modal-ok")).focus(), 30);
    const done = (v) => {
      m.hidden = true;
      $("modal-form").onsubmit = null; $("modal-cancel").onclick = null; m.onclick = null; m.onkeydown = null;
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    $("modal-form").onsubmit = (e) => { e.preventDefault(); done(input ? inp.value : true); };
    $("modal-cancel").onclick = () => done(null);
    m.onclick = (e) => { if (e.target === m) done(null); };
    m.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
  });
}
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) {
    const ta = document.createElement("textarea"); ta.value = s; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (x) { ok = false; }
    ta.remove(); return ok;
  }
}
const fmtTime = (ms) => new Date(ms).toLocaleString(getLang() === "en" ? "en-GB" : "tr-TR", { dateStyle: "short", timeStyle: "short" });
const fmtTok = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));
const fmtUsd = (v) => (v == null ? "" : v === 0 ? "$0" : v < 0.01 ? "<$0.01" : "$" + v.toFixed(v < 1 ? 3 : 2));
const typeOf = () => (S.p && TYPES[S.p.type] ? S.p.type : "web");

// ---------------------------------------------------------------- settings
function loadCfg() {
  const d = settings.get("ai", {}) || {};
  return {
    provider: PROVIDERS[d.provider] ? d.provider : "openrouter",
    keys: d.keys || {}, models: d.models || {}, modelInfo: d.modelInfo || {},
    maxTokens: d.maxTokens || 16000, temperature: d.temperature ?? "", baseUrl: d.baseUrl || "",
    liveData: d.liveData !== false,
  };
}
const backendCfg = () => normalizeBackend(settings.get("backend", {}) || {});
const isWeb = (type) => type === "web" || type === "react";
/** Request text used to pick catalog APIs: the new prompt plus the last user turns (keeps edits on topic). */
function promptText(prompt) {
  const prev = S.p ? S.p.messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join("\n") : "";
  return (prev + "\n" + (prompt || "")).slice(-4000);
}
function sysPrompt(type, prompt) { return systemPrompt(type, { text: promptText(prompt), liveData: S.cfg.liveData, backend: backendCfg() }); }
function saveCfg() { settings.set("ai", S.cfg); }
function activeCfg() {
  const c = S.cfg, p = c.provider;
  return { provider: p, apiKey: c.keys[p] || "", model: c.models[p] || PROVIDERS[p].defaultModel, maxTokens: c.maxTokens, temperature: c.temperature, baseUrl: p === "openai" ? c.baseUrl : "" };
}
function modelInfo() { const c = activeCfg(); return (S.cfg.modelInfo || {})[c.provider + ":" + c.model] || null; }
function renderModelChip() {
  const c = activeCfg();
  const info = modelInfo();
  $("model-chip").textContent = (c.apiKey ? "" : "⚠ ") + PROVIDERS[c.provider].label + " · " + c.model + (info && info.free ? " · " + t("free") : "");
}

// ---------------------------------------------------------------- persistence
async function persist() {
  if (!S.p) return;
  try { await S.store.save(S.p); settings.set("lastProject", S.p.id); }
  catch (e) { toast(e.message, "warn", 7000); }
}
function persistSoon() { clearTimeout(S.saveT); S.saveT = setTimeout(persist, 400); }

async function openProject(p) {
  if (S.gen) stopGeneration();
  S.p = p;
  if (!S.p.type || !TYPES[S.p.type]) S.p.type = detectType("", S.p.files);
  S.cur = null; S.logs = []; S.page = htmlPages(p.files)[0] || "index.html";
  S.streamPaths = {};
  settings.set("lastProject", p.id);
  renderAll();
}
async function createProject(opts = {}) {
  const p = newProject({ name: opts.name || DEFAULT_NAME(), type: opts.type || "web", files: opts.files || {} });
  p.autoType = opts.type ? !!opts.autoType : true;
  await S.store.save(p).catch((e) => toast(e.message, "warn"));
  await openProject(p);
  return p;
}

// ---------------------------------------------------------------- rendering
function renderAll() {
  $("pname").value = S.p.name;
  renderTypeSelect();
  renderMessages();
  renderTree();
  renderRunner();
  renderModelChip();
  updateEstimate();
  openFile(S.cur && S.p.files[S.cur] != null ? S.cur : pickDefaultFile());
}
function renderTypeSelect() {
  const sel = $("ptype");
  sel.innerHTML = `<option value="auto">${esc(t("type.auto"))}${S.p.autoType ? " · " + esc(TYPES[typeOf()].label) : ""}</option>` +
    TYPE_IDS.map((id) => `<option value="${id}">${TYPES[id].icon} ${esc(TYPES[id].label)}</option>`).join("");
  sel.value = S.p.autoType ? "auto" : typeOf();
}
function pickDefaultFile() {
  const paths = sortPaths(Object.keys(S.p.files));
  const entry = TYPES[typeOf()].entry;
  return paths.includes(entry) ? entry : paths[0] || null;
}

// ----- chat
function renderMessages() {
  const box = $("msgs");
  box.innerHTML = "";
  if (!S.p.messages.length) { box.appendChild(emptyState()); return; }
  for (const m of S.p.messages) box.appendChild(messageEl(m));
  box.scrollTop = box.scrollHeight;
}
function emptyState() {
  const el = document.createElement("div");
  el.className = "empty";
  const hasKey = !!activeCfg().apiKey;
  const type = typeOf();
  const starters = TEMPLATES.filter((x) => (S.p.autoType ? x.type === "web" || ["py-cli", "rn-habits", "bash-backup"].includes(x.id) : x.type === type)).slice(0, 8);
  const live = (S.p.autoType || type === "web") ? LIVE_TEMPLATES : [];
  el.innerHTML = `<h2>${esc(t("empty.title"))}</h2>
    <div class="lw" id="lw" role="status" aria-label="Canlı veri"></div>
    ${hasKey ? `<p class="muted">${esc(t("empty.ready"))}</p>` : `<ol>
      <li>${t("empty.s1")}</li><li>${esc(t("empty.s2"))}</li><li>${esc(t("empty.s3"))}</li></ol>
      <div class="toolbar"><button class="btn btn-primary btn-sm" data-act="settings">${esc(t("empty.setkey"))}</button><button class="btn btn-sm" data-act="demo">${esc(t("demo"))}</button></div>`}
    ${live.length ? `<h3>${esc(t("live.tpls"))}</h3><div class="starters">${live.map((s) => `<button class="starter live" data-tpl="${s.id}"><span aria-hidden="true">${s.icon}</span><span>${esc(t("tpl." + s.id))}<small class="badge-live">● ${esc(t("live.tpl.badge"))}</small></span></button>`).join("")}</div><h3>${esc(t("templates"))}</h3>` : ""}
    <div class="starters">${starters.map((s) => `<button class="starter" data-tpl="${s.id}"><span aria-hidden="true">${s.icon}</span><span>${esc(t("tpl." + s.id))}<small>${esc(TYPES[s.type].label)}</small></span></button>`).join("")}</div>`;
  mountWidgets(el.querySelector("#lw")).catch(() => {});
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tpl],[data-act]");
    if (!b) return;
    if (b.dataset.act === "settings") showView("settings");
    else if (b.dataset.act === "demo") openDemo();
    else useTemplate(findTemplate(b.dataset.tpl));
  });
  return el;
}
function chipsHtml(m) {
  const ch = (m.changed || []).map((p) => `<button class="fchip" data-open="${esc(p)}">${esc(p)}</button>`);
  const del = (m.deleted || []).map((p) => `<span class="fchip del">${esc(p)}</span>`);
  const tr = (m.truncated || []).map((p) => `<span class="fchip trunc" title="${esc(t("trunc.t"))}">${esc(p)} ✗</span>`);
  return ch.concat(del, tr).join("");
}
function messageEl(m) {
  const el = document.createElement("div");
  el.dataset.id = m.id;
  if (m.role === "user") {
    el.className = "msg msg-user";
    el.textContent = m.display || m.content;
    for (const im of m.images || []) { const i = document.createElement("img"); i.src = im.dataUrl; i.alt = t("attach.alt"); el.appendChild(i); }
  } else if (m.role === "error") {
    el.className = "msg msg-err";
    el.innerHTML = `<b>${esc(m.title || t("err.title"))}</b><div>${esc(m.content)}</div><div class="toolbar"><button class="btn btn-sm" data-retry>${esc(t("retry"))}</button>${m.code === "auth" || m.code === "model" ? `<button class="btn btn-sm btn-ghost" data-act="settings">${esc(t("nav.settings"))}</button>` : ""}</div>`;
  } else {
    el.className = "msg msg-ai";
    const prose = stripFileBlocks(m.content || "").replace(/^```\w*\s*$/gm, "").trim();
    const meta = [];
    if (m.usage) meta.push(`${fmtTok(m.usage.input)} → ${fmtTok(m.usage.output)} token`);
    if (m.cost != null) meta.push(fmtUsd(m.cost));
    if (m.stopped) meta.push(t("stopped"));
    el.innerHTML = `<div class="who">✦ Kovan <span>${esc(m.model || "")}</span></div><div class="body"></div><div class="fchips">${chipsHtml(m)}</div>
      <div class="msg-meta">${meta.map(esc).join(" · ")}${m.last ? ` <button class="btn btn-ghost btn-sm" data-retry>↻ ${esc(t("retry"))}</button>` : ""}</div>`;
    el.querySelector(".body").textContent = prose || (m.changed && m.changed.length ? t("ai.updated") : "");
  }
  return el;
}
$("msgs").addEventListener("click", (e) => {
  const o = e.target.closest("[data-open]");
  if (o) { showWorkTab("code"); openFile(o.dataset.open); return; }
  if (e.target.closest("[data-retry]")) { retryLast(); return; }
  if (e.target.closest("[data-act=settings]")) showView("settings");
});

// ----- file tree
function renderTree() {
  const ul = $("tree");
  const paths = sortPaths(Object.keys(S.p.files));
  const streaming = Object.keys(S.streamPaths).filter((p) => p[0] !== "$" && !paths.includes(p));
  const all = paths.concat(streaming);
  if (!all.length) { ul.innerHTML = `<li class="dir">${esc(t("tree.empty"))}</li>`; return; }
  let lastDir = "";
  let html = "";
  for (const p of all) {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (dir && dir !== lastDir) html += `<li class="dir" aria-hidden="true">▾ ${esc(dir)}/</li>`;
    lastDir = dir;
    const name = dir ? p.slice(dir.length + 1) : p;
    const w = S.streamPaths[p] === "writing";
    html += `<li role="option" data-path="${esc(p)}" aria-selected="${p === S.cur}" class="${w ? "writing" : ""}" style="padding-left:${dir ? 22 : 8}px">${w ? '<span class="spin ind"></span>' : ""}${esc(name)}</li>`;
  }
  ul.innerHTML = html;
}
$("tree").addEventListener("click", (e) => {
  const li = e.target.closest("[data-path]");
  if (li) openFile(li.dataset.path);
});

// ----- editor
let editor = null;
function ensureEditor() {
  if (!editor) editor = createEditor($("editor-host"), { onChange: onEditorChange });
  return editor;
}
function openFile(path) {
  S.cur = path;
  const ed = ensureEditor();
  $("ed-path").textContent = path || "—";
  $("ed-state").textContent = "";
  if (!path) { ed.set("", "", true); renderTree(); return; }
  const c = S.p.files[path];
  if (c == null && S.streamPaths[path]) { ed.set(path, S.streamPaths["$" + path] || "", true); }
  else if (isBinaryContent(path, c)) { ed.set(path, `/* ${t("binary")}: ${mimeOf(path)} · ${Math.round(c.length * 0.75 / 1024)} KB */`, true); }
  else ed.set(path, c || "", !!S.gen);
  renderTree();
}
function onEditorChange(v) {
  if (!S.cur || S.gen || isBinaryContent(S.cur, S.p.files[S.cur])) return;
  S.p.files[S.cur] = v;
  $("ed-state").textContent = t("ed.unsaved");
  clearTimeout(S.edT);
  S.edT = setTimeout(() => { persist().then(() => { $("ed-state").textContent = t("ed.saved"); }); schedulePreview(); }, 700);
}
function saveNow() {
  if (!S.p) return;
  clearTimeout(S.edT);
  persist().then(() => { $("ed-state").textContent = t("ed.saved"); toast(t("ed.saved"), "ok", 1500); });
  schedulePreview(0);
}

// ---------------------------------------------------------------- runner panels
function renderRunner() {
  const type = typeOf(), runner = TYPES[type].runner;
  $("run-preview").hidden = runner !== "preview";
  $("run-python").hidden = runner !== "python";
  $("run-snack").hidden = runner !== "snack";
  $("run-none").hidden = runner !== "none";
  const lbl = runner === "preview" ? t("pane.preview") : runner === "python" ? t("pane.terminal") : runner === "snack" ? "Snack" : t("pane.run");
  $("wt-run").textContent = lbl; $("mseg-run").textContent = lbl;
  if (runner === "preview") { renderPages(); schedulePreview(0); renderConsole(); }
  if (runner === "python") renderPython();
  if (runner === "none") renderNone();
  if (runner === "snack") $("sn-stage").innerHTML = `<div class="empty-mini">${esc(t("snack.hint"))}</div>`;
  const binOn = S.p.files[PYINSTALLER_WORKFLOW_PATH] != null;
  $("opt-bin-py").checked = binOn; $("opt-bin").checked = binOn;
  $("opt-bin-wrap").hidden = type !== "python";
  $("gh-go-lbl").textContent = TYPES[type].pages ? t("deploy.go") : t("deploy.push");
}

// ----- web preview
function renderPages() {
  const pages = htmlPages(S.p.files);
  if (!pages.includes(S.page)) S.page = pages[0] || "index.html";
  $("pv-page").innerHTML = (pages.length ? pages : ["index.html"]).map((p) => `<option ${p === S.page ? "selected" : ""}>${esc(p)}</option>`).join("");
  $("pv-page").hidden = pages.length < 2;
}
function schedulePreview(ms = 500) {
  if (TYPES[typeOf()].runner !== "preview") return;
  clearTimeout(S.pvT);
  S.pvT = setTimeout(renderPreview, ms);
}
function renderPreview() {
  if (!S.p || TYPES[typeOf()].runner !== "preview") return;
  renderPages();
  S.logs = []; renderConsole();
  const seed = settings.get("pv:" + S.p.id, {}) || {};
  $("pv-frame").srcdoc = buildPreview(S.p.files, S.page, { seed });
}
function setDevice(w) {
  S.dev = w;
  document.querySelectorAll("[data-dev]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.dev === w)));
  $("pv-frame").style.width = w ? w + "px" : "100%";
  $("stage").classList.toggle("dev", !!w);
}
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.kovan !== 1 || e.source !== $("pv-frame").contentWindow) return;
  if (d.t === "nav") {
    const target = resolveRef(d.from || S.page, d.href);
    const cand = target && (S.p.files[target] != null ? target : S.p.files[target.replace(/\/?$/, "/index.html").replace(/^\//, "")] != null ? target.replace(/\/?$/, "/index.html").replace(/^\//, "") : null);
    if (cand && /\.html?$/i.test(cand)) { S.page = cand; renderPreview(); }
    else addLog("warn", t("pv.nopage", { p: d.href }));
  } else if (d.t === "storage") {
    try { if (JSON.stringify(d.data).length < 200000) settings.set("pv:" + S.p.id, d.data); } catch (x) { /* ignore */ }
  } else if (["log", "info", "warn", "error"].includes(d.t)) addLog(d.t, d.m);
});
function addLog(kind, msg) {
  S.logs.push({ kind, msg: String(msg).slice(0, 4000), at: Date.now() });
  if (S.logs.length > 300) S.logs.shift();
  renderConsole();
}
function renderConsole() {
  const body = $("con-body");
  const errs = S.logs.filter((l) => l.kind === "error");
  $("con-count").hidden = !errs.length; $("con-count").textContent = errs.length;
  $("con-fix").hidden = !errs.length;
  body.innerHTML = S.logs.length ? S.logs.map((l) => `<div class="cl ${l.kind}">${esc(l.msg)}</div>`).join("") : `<div class="cl muted">${esc(t("con.empty"))}</div>`;
  body.scrollTop = body.scrollHeight;
  if (errs.length) $("console").classList.remove("collapsed");
}

// ----- python
function renderPython() {
  const pys = sortPaths(Object.keys(S.p.files).filter((p) => p.endsWith(".py") && !/(^|\/)test_|_test\.py$|^tests?\//.test(p)));
  const entry = pythonEntry(S.p.files);
  $("py-entry").innerHTML = pys.map((p) => `<option ${p === entry ? "selected" : ""}>${esc(p)}</option>`).join("") || `<option>main.py</option>`;
}
function termWrite(text, cls = "") {
  const pre = $("py-term");
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text.endsWith("\n") ? text : text + "\n";
  pre.appendChild(span);
  if (pre.childNodes.length > 4000) pre.removeChild(pre.firstChild);
  pre.scrollTop = pre.scrollHeight;
}
function pyWorker() {
  if (!S.py.worker) {
    S.py.worker = new Worker(new URL("./py-worker.js", import.meta.url), { type: "module" });
    S.py.worker.onerror = (e) => { termWrite(t("py.workerfail") + " " + (e.message || ""), "e"); pyDone({ ok: false }); };
  }
  return S.py.worker;
}
function runPython(mode) {
  if (S.py.running) return;
  if (!Object.keys(S.p.files).some((p) => p.endsWith(".py"))) { toast(t("py.nofiles"), "warn"); return; }
  S.py.running = true; S.py.stderr = "";
  $("py-run").disabled = $("py-test").disabled = true; $("py-stop").hidden = false; $("py-fix").hidden = true;
  $("py-term").innerHTML = "";
  termWrite("$ " + (mode === "test" ? "python -m pytest -q" : "python " + $("py-entry").value + ($("py-args").value ? " " + $("py-args").value : "")), "i");
  const id = Date.now();
  const w = pyWorker();
  w.onmessage = (e) => {
    const m = e.data || {};
    if (m.id !== id) return;
    if (m.type === "out") termWrite(m.data);
    else if (m.type === "err") { S.py.stderr += m.data + "\n"; termWrite(m.data, "e"); }
    else if (m.type === "status") { $("py-status").textContent = m.data; $("py-status").classList.remove("chip--on"); }
    else if (m.type === "done") pyDone(m.data);
  };
  const args = $("py-args").value.trim() ? $("py-args").value.trim().match(/"[^"]*"|'[^']*'|\S+/g).map((a) => a.replace(/^["']|["']$/g, "")) : [];
  w.postMessage({ type: "run", id, files: S.p.files, mode, entry: $("py-entry").value, stdin: $("py-stdin").value, args });
}
function pyDone(res) {
  S.py.running = false;
  $("py-run").disabled = $("py-test").disabled = false; $("py-stop").hidden = true;
  if (!res) return;
  if (res.ok) { termWrite(t("py.exit0", { c: res.exit || 0 }), "ok"); $("py-status").textContent = t("py.ready"); $("py-status").classList.add("chip--on"); }
  else {
    termWrite(t("py.exit", { c: res.exit ?? 1 }) + (res.error ? " · " + res.error : ""), "e");
    if (res.error && !S.py.stderr.includes(res.error)) S.py.stderr += res.error + "\n";
    $("py-status").textContent = t("py.failed");
    $("py-fix").hidden = !S.py.stderr.trim();
  }
}
function stopPython() {
  if (S.py.worker) { S.py.worker.terminate(); S.py.worker = null; }
  if (S.py.running) { termWrite(t("py.stopped"), "w"); pyDone({ ok: false, exit: 130 }); }
}

// ----- bash / perl / windows
function renderNone() {
  const type = typeOf();
  $("none-notice").innerHTML = esc(t("none." + type));
  const cmds = runCommands(type, S.p.files);
  $("none-cmds").innerHTML = cmds.length ? cmds.map((c) => `<li><div class="cmd"><code>${esc(c)}</code><button class="btn btn-sm" data-cp="${esc(c)}">${esc(t("copy"))}</button></div></li>`).join("") : `<li class="muted">${esc(t("none.nocmd"))}</li>`;
}
$("none-cmds").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cp]");
  if (b && await copyText(b.dataset.cp)) { b.textContent = t("copied"); setTimeout(() => { b.textContent = t("copy"); }, 1500); }
});

// ----- expo snack
function openSnack() {
  if (!S.p.files["App.js"] && !Object.keys(S.p.files).some((p) => /^App\.(js|jsx|tsx?)$/.test(p))) { toast(t("snack.noapp"), "warn"); return; }
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const url = snackUrl(S.p.files, { theme, name: S.p.name });
  if (url) { window.open(url, "_blank", "noopener"); return; }
  // Too long for a URL: best-effort POST of the same documented parameters.
  const { params } = snackPayload(S.p.files, S.p.name);
  const f = document.createElement("form");
  f.method = "POST"; f.action = "https://snack.expo.dev"; f.target = "_blank";
  for (const [k, v] of Object.entries({ ...params, theme })) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
  document.body.appendChild(f); f.submit(); f.remove();
  toast(t("snack.post"), "info", 6000);
}
function embedSnack() {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const url = snackUrl(S.p.files, { embedded: true, theme, name: S.p.name, maxLength: 7000 });
  if (!url) { toast(t("snack.toobig"), "warn", 6000); return; }
  $("sn-stage").innerHTML = `<iframe title="Expo Snack" src="${esc(url)}" style="width:100%;height:100%;min-height:520px;border:0;border-radius:10px" allow="clipboard-write"></iframe>`;
}
async function addEas() {
  S.p.files[EAS_WORKFLOW_PATH] = easWorkflow();
  if (!S.p.files["eas.json"]) S.p.files["eas.json"] = easConfig();
  snapshot(S.p, t("snack.eas"));
  await persist(); renderTree();
  toast(t("snack.easadded"), "ok", 7000);
}

// ----- binaries (PyInstaller)
async function setBinaries(on) {
  if (on) S.p.files[PYINSTALLER_WORKFLOW_PATH] = pyinstallerWorkflow({ entry: pythonEntry(S.p.files) || "main.py", name: S.p.name });
  else delete S.p.files[PYINSTALLER_WORKFLOW_PATH];
  $("opt-bin-py").checked = on; $("opt-bin").checked = on;
  snapshot(S.p, on ? t("bin.added") : t("bin.removed"));
  await persist(); renderTree();
  toast(on ? t("bin.added.long") : t("bin.removed"), on ? "ok" : "info", on ? 8000 : 3000);
}

// ---------------------------------------------------------------- AI generation
function errorText(e) {
  const prov = PROVIDERS[activeCfg().provider].label;
  if (!(e instanceof ProviderError)) return { title: t("err.title"), text: String(e && e.message || e), code: "unknown" };
  const map = {
    auth: t("err.auth", { p: prov }), credit: t("err.credit", { p: prov }), rate: t("err.rate"), model: t("err.model", { m: activeCfg().model }),
    badreq: t("err.badreq"), server: t("err.server", { p: prov }), network: t("err.network", { p: prov }), empty: t("err.empty"), unknown: t("err.unknown"),
  };
  const detail = e.message && e.code !== "network" ? "\n(" + e.message.slice(0, 300) + ")" : "";
  return { title: t("err.title." + e.code) || t("err.title"), text: (map[e.code] || map.unknown) + detail, code: e.code };
}

async function send(prompt, opts = {}) {
  prompt = String(prompt || "").trim();
  if (!prompt || S.gen) return;
  const cfg = activeCfg();
  if (!cfg.apiKey) { toast(t("need.key"), "warn", 6000); showView("settings"); $("s-key").focus(); return; }
  const p = S.p;
  // type
  if (p.autoType && !Object.keys(p.files).length) { p.type = detectType(prompt); renderTypeSelect(); renderRunner(); }
  if (p.name === DEFAULT_NAME() || !p.name) { p.name = prompt.replace(/\s+/g, " ").split(" ").slice(0, 5).join(" ").slice(0, 48); $("pname").value = p.name; }
  // Studio-managed data layer for web projects (kovan-config.js + kovan-db.js)
  if (isWeb(p.type)) ensureHelpers(p.files, backendCfg());
  // baseline version for undo / retry
  const last = p.versions[p.versions.length - 1];
  if (!last || JSON.stringify(last.files) !== JSON.stringify(p.files)) snapshot(p, Object.keys(p.files).length ? t("ver.manual") : t("ver.empty"));
  const before = p.versions[p.versions.length - 1].id;

  let images = opts.images || S.attachments.map((a) => ({ dataUrl: a.dataUrl }));
  let vision = true;
  const info = modelInfo();
  if (images.length && cfg.provider === "openrouter" && info && info.vision === false) { toast(t("vision.no"), "warn", 7000); vision = false; }
  const history = p.messages.filter((m) => m.role === "user" || m.role === "assistant");
  const userMsg = { id: "u" + Date.now(), role: "user", content: prompt, display: opts.display || prompt, images: images.length ? images : undefined, before, at: Date.now(), kind: opts.kind || "build" };
  p.messages.forEach((m) => { delete m.last; });
  p.messages.push(userMsg);
  S.attachments = []; renderAttachments();
  if (!opts.keepPrompt) { $("prompt").value = ""; autoGrow(); }
  const aiMsg = { id: "a" + Date.now(), role: "assistant", content: "", model: cfg.model, changed: [], deleted: [], truncated: [], at: Date.now() };
  renderMessages();
  const box = $("msgs");
  const el = messageEl(aiMsg);
  el.querySelector(".body").innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  box.appendChild(el); box.scrollTop = box.scrollHeight;

  const messages = buildMessages({ history, files: p.files, prompt, images: vision ? images : [] });
  const ac = new AbortController();
  S.gen = { ac, aiMsg };
  setGenerating(true);
  const parser = new FileStreamParser();
  let prose = "", raf = 0;
  const live = {};
  const paint = () => {
    raf = 0;
    const body = el.querySelector(".body");
    const shown = prose.replace(/^```\w*\s*$/gm, "").trim();
    if (shown) body.textContent = shown;
    el.querySelector(".fchips").innerHTML = chipsHtml(aiMsg) + Object.keys(S.streamPaths).filter((k) => k[0] !== "$" && S.streamPaths[k] === "writing")
      .map((k) => `<button class="fchip writing" data-open="${esc(k)}"><span class="spin"></span>${esc(k)}</button>`).join("");
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
  };
  const queuePaint = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const handle = (events) => {
    let treeDirty = false;
    for (const ev of events) {
      if (ev.type === "text") prose += ev.text;
      else if (ev.type === "file-start") { S.streamPaths[ev.path] = "writing"; treeDirty = true; if (!S.cur || (isMobile() && S.pane === "code")) openFile(ev.path); }
      else if (ev.type === "file-chunk") {
        S.streamPaths["$" + ev.path] = ev.content;
        if (S.cur === ev.path) { const now = performance.now(); if (!live[ev.path] || now - live[ev.path] > 120) { live[ev.path] = now; ensureEditor().set(ev.path, ev.content, true); } }
      } else if (ev.type === "file-end") {
        delete S.streamPaths[ev.path]; delete S.streamPaths["$" + ev.path]; treeDirty = true;
        if (ev.truncated) { if (!aiMsg.truncated.includes(ev.path)) aiMsg.truncated.push(ev.path); continue; }
        p.files[ev.path] = ev.content;
        if (!aiMsg.changed.includes(ev.path)) aiMsg.changed.push(ev.path);
        if (S.cur === ev.path) ensureEditor().set(ev.path, ev.content, true);
        schedulePreview(800);
      } else if (ev.type === "delete") {
        if (p.files[ev.path] != null) { delete p.files[ev.path]; aiMsg.deleted.push(ev.path); treeDirty = true; if (S.cur === ev.path) S.cur = null; }
      } else if (ev.type === "rename") {
        if (p.files[ev.from] != null) { p.files[ev.to] = p.files[ev.from]; delete p.files[ev.from]; aiMsg.changed.push(ev.to); aiMsg.deleted.push(ev.from); treeDirty = true; if (S.cur === ev.from) S.cur = ev.to; }
      }
    }
    if (treeDirty) renderTree();
    queuePaint();
  };

  let result = null, error = null;
  try {
    result = await streamChat({ cfg, system: sysPrompt(p.type, prompt), messages, signal: ac.signal, vision, onDelta: (chunk) => handle(parser.feed(chunk)) });
  } catch (e) { error = e; }
  handle(parser.finish());
  // Protocol not followed: try a fenced full document.
  if (!error && !aiMsg.changed.length && !aiMsg.deleted.length && result) {
    const fb = fallbackFromText(result.text);
    for (const [k, v] of Object.entries(fb)) { p.files[k] = v; aiMsg.changed.push(k); }
  }
  S.gen = null; S.streamPaths = {};
  setGenerating(false);
  const aborted = error instanceof ProviderError && error.code === "abort";
  aiMsg.content = result ? result.text : parser.text + (aiMsg.changed.length ? "" : "");
  const changedAny = aiMsg.changed.length || aiMsg.deleted.length;
  if (result || aborted || changedAny) {
    if (aborted) aiMsg.stopped = true;
    if (result && result.usage) {
      aiMsg.usage = result.usage;
      const c = result.usage.cost != null ? +result.usage.cost : estimateCost(info && info.pricing, result.usage);
      if (c != null && !Number.isNaN(c)) aiMsg.cost = c;
      p.usage = p.usage || { input: 0, output: 0, cost: 0 };
      p.usage.input += result.usage.input || 0; p.usage.output += result.usage.output || 0; p.usage.cost += aiMsg.cost || 0;
    }
    aiMsg.last = true;
    p.messages.push(aiMsg);
    if (changedAny) snapshot(p, (opts.kind === "fix" ? "🛠 " : opts.kind === "review" ? "🔍 " : "") + (opts.display || prompt).slice(0, 80));
    if (result && result.finish === "length") toast(t("trunc.len"), "warn", 8000);
    if (aiMsg.truncated.length) toast(t("trunc.files", { f: aiMsg.truncated.join(", ") }), "warn", 8000);
  }
  if (error && !aborted) {
    const et = errorText(error);
    p.messages.push({ id: "e" + Date.now(), role: "error", title: et.title, content: et.text, code: et.code, at: Date.now() });
  }
  if (p.autoType && changedAny) { p.type = detectType(prompt, p.files); }
  await persist();
  if (S.p !== p) return;
  renderAll();
  if (changedAny) {
    S.logs = [];
    if (TYPES[p.type].runner === "preview") renderPreview();
    if (isMobile() && S.pane === "chat") setPane("run");
  }
}
function setGenerating(on) {
  $("btn-send").hidden = on; $("btn-stop").hidden = !on;
  $("btn-enhance").disabled = on; $("btn-review").disabled = on;
  document.body.classList.toggle("generating", on);
}
function stopGeneration() { if (S.gen) S.gen.ac.abort(); }

async function retryLast() {
  if (S.gen) return;
  const p = S.p;
  let i = p.messages.length - 1;
  while (i >= 0 && p.messages[i].role !== "user") i--;
  if (i < 0) return;
  const u = p.messages[i];
  if (u.before) { const v = p.versions.find((x) => x.id === u.before); if (v) p.files = { ...v.files }; }
  p.messages = p.messages.slice(0, i);
  await send(u.content, { images: u.images || [], display: u.display, kind: u.kind, keepPrompt: true });
}

async function enhance() {
  const txt = $("prompt").value.trim();
  if (!txt) { toast(t("enhance.empty"), "info"); $("prompt").focus(); return; }
  const cfg = activeCfg();
  if (!cfg.apiKey) { toast(t("need.key"), "warn"); showView("settings"); return; }
  const btn = $("btn-enhance");
  btn.disabled = true;
  const ac = new AbortController();
  S.gen = { ac, enhance: true };
  setGenerating(true);
  try {
    const type = TYPES[S.p.autoType ? detectType(txt, S.p.files) : typeOf()].label;
    let out = "";
    await streamChat({ cfg: { ...cfg, maxTokens: 800 }, system: ENHANCE_PROMPT, messages: [{ role: "user", content: `(${type}) ${txt}` }], signal: ac.signal, onDelta: (d) => { out += d; $("prompt").value = out; autoGrow(); } });
    $("prompt").value = out.trim().replace(/^["“]|["”]$/g, "");
    autoGrow(); updateEstimate();
  } catch (e) {
    if (!(e instanceof ProviderError && e.code === "abort")) { $("prompt").value = txt; toast(errorText(e).text, "error", 7000); }
  } finally { S.gen = null; setGenerating(false); btn.disabled = false; }
}

function updateEstimate() {
  clearTimeout(S.estT);
  S.estT = setTimeout(() => {
    if (!S.p) return;
    const prompt = $("prompt").value;
    const hist = S.p.messages.slice(-8).map((m) => stripFileBlocks(m.content || "")).join("\n");
    const inTok = estimateTokens(sysPrompt(typeOf(), prompt) + projectContext(S.p.files) + hist + prompt) + S.attachments.length * 1000;
    const info = modelInfo();
    const outGuess = Object.keys(S.p.files).length ? 4000 : 9000;
    const cost = info && info.pricing ? estimateCost(info.pricing, { input: inTok, output: outGuess }) : null;
    const total = S.p.usage && (S.p.usage.input || S.p.usage.output) ? ` · ${t("est.total")} ${fmtTok(S.p.usage.input + S.p.usage.output)}${S.p.usage.cost ? " " + fmtUsd(S.p.usage.cost) : ""}` : "";
    $("est").textContent = `~${fmtTok(inTok)} ${t("est.in")}${cost != null ? " · ≈" + fmtUsd(cost) : ""}${total}`;
    $("est").title = t("est.title");
  }, 250);
}

// ----- attachments
async function addImages(fileList) {
  for (const f of [...fileList].filter((x) => x.type.startsWith("image/")).slice(0, 4 - S.attachments.length)) {
    try { S.attachments.push({ name: f.name, dataUrl: await resizeImage(f) }); } catch (e) { toast(t("attach.fail"), "error"); }
  }
  renderAttachments(); updateEstimate();
}
function resizeImage(file, max = 1280) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error("img")); };
    img.src = url;
  });
}
function renderAttachments() {
  const box = $("attach-list");
  box.hidden = !S.attachments.length;
  box.innerHTML = S.attachments.map((a, i) => `<div class="attach"><img src="${a.dataUrl}" alt="${esc(a.name)}"><button type="button" data-rm="${i}" aria-label="${esc(t("remove"))}">×</button></div>`).join("");
}
$("attach-list").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { S.attachments.splice(+b.dataset.rm, 1); renderAttachments(); updateEstimate(); } });

// ---------------------------------------------------------------- versions
function renderHistory() {
  const pop = $("hist-pop");
  const vs = [...(S.p.versions || [])].reverse();
  pop.innerHTML = vs.length ? vs.map((v, i) => `<div class="pop-item" role="menuitem"><div><b>${esc(v.label)}</b><small>${fmtTime(v.at)} · ${Object.keys(v.files).length} ${esc(t("files"))}${i === 0 ? " · " + esc(t("ver.latest")) : ""}</small></div><button class="btn btn-sm" data-ver="${v.id}">${esc(t("restore"))}</button></div>`).join("")
    : `<div class="pop-item"><div><small>${esc(t("ver.none"))}</small></div></div>`;
}
async function restore(id) {
  if (S.gen) return;
  if (restoreVersion(S.p, id)) { await persist(); renderAll(); toast(t("restored"), "ok"); }
}
async function undo() {
  if (S.gen || !S.p) return;
  const vs = S.p.versions || [];
  const cur = JSON.stringify(S.p.files);
  for (let i = vs.length - 1; i >= 0; i--) {
    if (JSON.stringify(vs[i].files) !== cur) { await restore(vs[i].id); return; }
  }
  toast(t("ver.none"), "info");
}

// ---------------------------------------------------------------- file ops
async function newFile() {
  const name = await modal({ title: t("f.new"), input: { placeholder: "css/style.css" }, ok: t("create") });
  const path = normPath(name || "");
  if (!name) return;
  if (!path) { toast(t("f.invalid"), "error"); return; }
  if (S.p.files[path] != null) { toast(t("f.exists"), "error"); return; }
  S.p.files[path] = "";
  await persist(); renderTree(); openFile(path); showWorkTab("code"); ensureEditor().focus();
  if (TYPES[typeOf()].runner === "none") renderNone();
}
async function renameFile() {
  if (!S.cur || S.p.files[S.cur] == null) { toast(t("f.select"), "info"); return; }
  const name = await modal({ title: t("f.rename"), input: { value: S.cur }, ok: t("save") });
  if (name == null) return;
  const path = normPath(name);
  if (!path) { toast(t("f.invalid"), "error"); return; }
  if (path === S.cur) return;
  if (S.p.files[path] != null) { toast(t("f.exists"), "error"); return; }
  S.p.files[path] = S.p.files[S.cur]; delete S.p.files[S.cur];
  snapshot(S.p, t("f.renamed") + ": " + S.cur + " → " + path);
  S.cur = path;
  await persist(); renderAll();
}
async function deleteFile() {
  if (!S.cur || S.p.files[S.cur] == null) { toast(t("f.select"), "info"); return; }
  const ok = await modal({ title: t("f.delete"), body: t("f.delask", { f: S.cur }), ok: t("delete"), danger: true });
  if (!ok) return;
  const last = S.p.versions[S.p.versions.length - 1];
  if (!last || JSON.stringify(last.files) !== JSON.stringify(S.p.files)) snapshot(S.p, t("ver.manual"));
  delete S.p.files[S.cur];
  snapshot(S.p, t("f.deleted") + ": " + S.cur);
  S.cur = null;
  await persist(); renderAll();
}
async function uploadFiles(list) {
  let n = 0;
  for (const f of list) {
    if (f.size > 5 * 1024 * 1024) { toast(t("f.big", { f: f.name }), "warn"); continue; }
    const path = normPath(f.name);
    if (!path) continue;
    const buf = new Uint8Array(await f.arrayBuffer());
    S.p.files[path] = isTextPath(path) ? new TextDecoder().decode(buf) : bytesToDataUrl(buf, f.type || mimeOf(path));
    n++;
  }
  if (n) { snapshot(S.p, t("f.uploaded", { n })); await persist(); renderAll(); toast(t("f.uploaded", { n }), "ok"); }
}

// ---------------------------------------------------------------- zip / share
async function zipBlob(files) {
  const JSZip = await loadJSZip();
  return exportZip(files, JSZip, { type: "blob" });
}
async function downloadZip(suffix = "") {
  if (!Object.keys(S.p.files).length) { toast(t("nofiles"), "info"); return; }
  try { download(slugify(S.p.name) + suffix + ".zip", await zipBlob(S.p.files)); }
  catch (e) { toast(e.message, "error"); }
}
async function importZipFile(file) {
  try {
    const JSZip = await loadJSZip();
    const files = await importZip(await file.arrayBuffer(), JSZip);
    if (!Object.keys(files).length) { toast(t("zip.empty"), "warn"); return; }
    const type = detectType("", files);
    await createProject({ name: file.name.replace(/\.zip$/i, ""), files, type, autoType: false });
    showView("build");
    toast(t("zip.imported", { n: Object.keys(files).length }), "ok");
  } catch (e) { toast(t("zip.fail") + " " + e.message, "error", 7000); }
}
async function share() {
  if (!Object.keys(S.p.files).length) { toast(t("nofiles"), "info"); return; }
  try {
    const hash = await encodeShare({ name: S.p.name, type: S.p.type, files: S.p.files });
    const url = location.origin + location.pathname + hash;
    const copied = await copyText(url);
    await modal({ title: t("share.title"), body: (copied ? t("share.copied") : t("share.copy")) + `<br><input class="input mono" readonly value="${esc(url)}" onfocus="this.select()" style="margin-top:8px">`, html: true, cancel: null });
  } catch (e) { toast(e.message, e.code === "too-big" ? "warn" : "error", 7000); }
}

// ---------------------------------------------------------------- views
function showView(v) {
  S.view = v;
  document.querySelectorAll(".nav-btn").forEach((b) => (b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  document.querySelectorAll(".main > .view").forEach((s) => { s.hidden = s.id !== "view-" + v; });
  if (v === "projects") renderProjects();
  if (v === "deploy") renderDeploy();
  if (v === "settings") renderSettings();
  if (v === "data") renderData();
  if (v === "notebook") { if (!S.notebook) S.notebook = initNotebook(); S.notebook.boot(); }
  if (v === "build" && editor) setTimeout(() => editor.refresh(), 30);
}
function setPane(pn) {
  S.pane = pn;
  $("split").dataset.pane = pn;
  document.querySelectorAll("#mseg [data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === pn)));
  if (pn === "run" || pn === "code") showWorkTab(pn);
  if (pn === "chat") setTimeout(() => { $("msgs").scrollTop = $("msgs").scrollHeight; }, 20);
}
function showWorkTab(w) {
  S.wtab = w;
  $("w-run").hidden = w !== "run"; $("w-code").hidden = w !== "code";
  $("wt-run").setAttribute("aria-selected", String(w === "run")); $("wt-code").setAttribute("aria-selected", String(w === "code"));
  if (isMobile() && S.pane !== "chat" && S.pane !== w) { S.pane = w; $("split").dataset.pane = w; document.querySelectorAll("#mseg [data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === w))); }
  if (w === "code") { ensureEditor(); setTimeout(() => editor.refresh(), 20); }
}

// ----- projects view
async function renderProjects() {
  const list = await S.store.list();
  $("store-state").textContent = S.store.persistent ? t("store.idb") : t("store.mem");
  $("proj-grid").innerHTML = list.length ? list.map((p) => `<div class="card ${S.p && p.id === S.p.id ? "current" : ""}">
      <h3 title="${esc(p.name)}">${TYPES[p.type] ? TYPES[p.type].icon : "🌐"} ${esc(p.name)}</h3>
      <div class="meta">${Object.keys(p.files || {}).length} ${esc(t("files"))} · ${(p.versions || []).length} ${esc(t("versions"))} · ${fmtTime(p.updatedAt)}</div>
      <div class="acts"><button class="btn btn-sm btn-primary" data-pa="open" data-id="${p.id}">${esc(t("open"))}</button><button class="btn btn-sm" data-pa="dup" data-id="${p.id}">${esc(t("duplicate"))}</button><button class="btn btn-sm" data-pa="zip" data-id="${p.id}">ZIP</button><button class="btn btn-sm btn-danger" data-pa="del" data-id="${p.id}">${esc(t("delete"))}</button></div>
    </div>`).join("") : `<p class="muted">${esc(t("projects.none"))}</p>`;
  $("tpl-grid").innerHTML = LIVE_TEMPLATES.map((x) => `<div class="card" role="button" tabindex="0" data-tpl="${x.id}"><h3>${x.icon} ${esc(t("tpl." + x.id))}</h3><div class="meta">● ${esc(t("live.tpl.badge"))} · ${esc(x.apis.join(", "))}</div><p>${esc(x.prompt)}</p></div>`).join("") + TEMPLATES.map((x) => `<div class="card" role="button" tabindex="0" data-tpl="${x.id}"><h3>${x.icon} ${esc(t("tpl." + x.id))}</h3><div class="meta">${esc(TYPES[x.type].label)}</div><p>${esc(x.prompt)}</p></div>`).join("");
}
$("proj-grid").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pa]");
  if (!b) return;
  const p = await S.store.get(b.dataset.id);
  if (!p) return;
  if (b.dataset.pa === "open") { await openProject(p); showView("build"); }
  else if (b.dataset.pa === "dup") { const c = duplicateProject(p); await S.store.save(c).catch((x) => toast(x.message, "warn")); renderProjects(); toast(t("duplicated"), "ok"); }
  else if (b.dataset.pa === "zip") { try { download(slugify(p.name) + ".zip", await zipBlob(p.files)); } catch (x) { toast(x.message, "error"); } }
  else if (b.dataset.pa === "del") {
    if (!(await modal({ title: t("delete"), body: t("p.delask", { n: p.name }), ok: t("delete"), danger: true }))) return;
    await S.store.del(p.id);
    if (S.p && S.p.id === p.id) { const rest = await S.store.list(); if (rest.length) await openProject(rest[0]); else await createProject(); }
    renderProjects();
  }
});
function tplHandler(e) {
  const c = e.target.closest("[data-tpl]");
  if (!c || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  useTemplate(findTemplate(c.dataset.tpl));
}
function findTemplate(id) { return LIVE_TEMPLATES.find((x) => x.id === id) || TEMPLATES.find((x) => x.id === id); }
$("tpl-grid").addEventListener("click", tplHandler);
$("tpl-grid").addEventListener("keydown", tplHandler);
async function useTemplate(tp) {
  if (!tp) return;
  if (S.gen) return;
  if (tp.dir) { await openLiveTemplate(tp); return; }
  if (Object.keys(S.p.files).length || S.p.messages.length) await createProject({ type: tp.type, autoType: false, name: t("tpl." + tp.id) });
  else { S.p.type = tp.type; S.p.autoType = false; S.p.name = t("tpl." + tp.id); renderAll(); }
  showView("build"); setPane("chat");
  $("prompt").value = tp.prompt; autoGrow(); updateEstimate();
  if (activeCfg().apiKey) send(tp.prompt);
  else { toast(t("need.key"), "warn", 6000); $("prompt").focus(); }
}
/** Ready-made live-data project: no AI key needed. */
async function openLiveTemplate(tp, { name, msg } = {}) {
  let files;
  try { files = await loadLiveTemplate(tp, { backend: backendCfg() }); }
  catch (e) { toast(t("live.tpl.fail", { e: e.message }), "error", 8000); return null; }
  const title = name || t("tpl." + tp.id);
  const reuse = S.p && !Object.keys(S.p.files).length && !S.p.messages.length;
  if (reuse) { S.p.files = files; S.p.type = tp.type; S.p.autoType = false; S.p.name = title; snapshot(S.p, title); }
  else await createProject({ name: title, files, type: tp.type, autoType: false });
  S.p.messages.push({ id: "a" + Date.now(), role: "assistant", content: msg || t("live.tpl.msg", { apis: tp.apis.join(", ") }), changed: Object.keys(files), at: Date.now(), model: "şablon" });
  if (reuse) snapshot(S.p, title);
  await persist(); S.page = "index.html"; renderAll(); showView("build");
  if (isMobile()) setPane("run");
  toast(t("live.tpl.loaded", { n: title }), "ok", 3500);
  return S.p;
}
async function openDemo() {
  return openLiveTemplate(DEMO_TEMPLATE, { name: t("demo.name"), msg: t("demo.live.msg") });
}

// ----- deploy view
function renderDeploy() {
  $("gh-token").value = settings.get("ghToken", "") || "";
  $("gh-repo").value = (S.p.settings && S.p.settings.repo) || sanitizeRepoName(S.p.name);
  renderRunner();
  renderDeployHistory();
}
async function renderDeployHistory() {
  const list = await S.store.list();
  const rows = [];
  for (const p of list) for (const d of p.deploys || []) rows.push({ ...d, project: p.name });
  rows.sort((a, b) => b.at - a.at);
  $("dp-rows").innerHTML = rows.length ? rows.slice(0, 50).map((d) => `<tr><td>${esc(d.project)}</td><td>${esc(d.target)}</td><td>${esc(d.status)}</td><td>${fmtTime(d.at)}</td><td>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(t("live"))}</a> ` : ""}${d.repoUrl ? `<a href="${esc(d.repoUrl)}" target="_blank" rel="noopener">${esc(t("repo"))}</a> ` : ""}${d.runUrl || d.actionsUrl ? `<a href="${esc(d.runUrl || d.actionsUrl)}" target="_blank" rel="noopener">Actions</a>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">${esc(t("deploy.none"))}</td></tr>`;
}
async function doDeploy() {
  const token = $("gh-token").value.trim();
  const repo = sanitizeRepoName($("gh-repo").value.trim() || S.p.name);
  if (!token) { toast(t("deploy.notoken"), "warn"); $("gh-token").focus(); return; }
  if (!Object.keys(S.p.files).length) { toast(t("nofiles"), "info"); return; }
  if (settings.get("ghToken", "") !== token) settings.set("ghToken", token);
  S.p.settings = S.p.settings || {}; S.p.settings.repo = repo; $("gh-repo").value = repo;
  const pages = TYPES[typeOf()].pages;
  $("gh-go").disabled = true; $("gh-log").textContent = ""; $("gh-result").hidden = true;
  const log = (s) => { $("gh-log").textContent += s + "\n"; $("gh-log").scrollTop = $("gh-log").scrollHeight; };
  const entry = { at: Date.now(), target: "GitHub" + (pages ? " Pages" : ""), repo, status: "…" };
  try {
    const r = await deployToGitHub({ token, repo, files: S.p.files, pages, private: $("gh-private").checked, message: "Kovan Studio: " + S.p.name, onLog: log });
    Object.assign(entry, { status: pages ? (r.pagesStatus === "built" ? t("st.live") : r.pagesStatus === "errored" ? t("st.error") : t("st.building")) : t("st.pushed"), url: r.url, repoUrl: r.repoUrl, commit: r.commit, runUrl: r.runUrl, actionsUrl: r.actionsUrl });
    $("gh-result").hidden = false;
    $("gh-result").innerHTML = (r.url ? `<b>${esc(t("deploy.live"))}</b> <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a><br>` : "") +
      `${esc(t("repo"))}: <a href="${esc(r.repoUrl)}" target="_blank" rel="noopener">${esc(r.repoUrl)}</a>` +
      (r.actionsUrl ? `<br>Actions: <a href="${esc(r.runUrl || r.actionsUrl)}" target="_blank" rel="noopener">${esc(r.runUrl || r.actionsUrl)}</a> <span class="muted">${esc(t("deploy.artifacts"))}</span>` : "");
    toast(t("deploy.ok"), "ok");
  } catch (e) {
    entry.status = t("st.error");
    log("✗ " + deployErrorMessage(e));
    toast(deployErrorMessage(e), "error", 9000);
  } finally {
    S.p.deploys = (S.p.deploys || []).concat(entry).slice(-30);
    await persist();
    $("gh-go").disabled = false;
    renderDeployHistory();
  }
}

// ----- settings view
function renderSettings() {
  const c = S.cfg;
  $("s-provider").innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join("");
  $("s-provider").value = c.provider;
  fillProviderFields();
  $("s-max").value = c.maxTokens; $("s-temp").value = c.temperature;
  $("s-theme").value = document.documentElement.dataset.theme; $("s-lang").value = getLang();
  $("s-msg").textContent = settings.persistent() ? "" : t("set.nopersist");
  renderBackendForm();
}

// ----- backend (forms + Supabase) settings
function renderBackendForm() {
  const b = settings.get("backend", {}) || {};
  const f = b.forms || {}, sb = b.supabase || {};
  $("be-form-provider").innerHTML = `<option value="">${esc(t("be.forms.none"))}</option>` + Object.entries(FORM_PROVIDERS).map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join("");
  $("be-form-provider").value = FORM_PROVIDERS[f.provider] ? f.provider : "";
  $("be-form-key").value = f.key || "";
  $("be-sb-url").value = sb.url || ""; $("be-sb-key").value = sb.anonKey || "";
  fillFormHelp();
}
function fillFormHelp() {
  const p = FORM_PROVIDERS[$("be-form-provider").value];
  $("be-form-key").disabled = !p;
  $("be-form-key-lbl").textContent = p ? p.field : "Anahtar / e-posta";
  $("be-form-help").textContent = p ? p.help : "Form servisi seçilmezse gönderimler tarayıcıda saklanır (Supabase bağlıysa veritabanına).";
}
async function saveBackend() {
  const url = $("be-sb-url").value.trim();
  if (url && !/^https:\/\//.test(url)) { toast(t("be.badurl"), "warn", 6000); $("be-sb-url").focus(); return; }
  const raw = { forms: { provider: $("be-form-provider").value, key: $("be-form-key").value.trim() }, supabase: { url, anonKey: $("be-sb-key").value.trim() } };
  settings.set("backend", raw);
  const n = normalizeBackend(raw);
  if (S.p && isWeb(typeOf()) && Object.keys(S.p.files).length) {
    const ch = ensureHelpers(S.p.files, n);
    if (ch.length) { snapshot(S.p, "Arka uç ayarları"); await persist(); renderTree(); schedulePreview(0); }
  }
  $("be-msg").textContent = t("be.saved");
  toast(t("be.saved"), "ok", 1800);
  updateEstimate();
}
function backendSummary() {
  const n = backendCfg();
  return t("be.status.forms", { v: n.forms.provider ? FORM_PROVIDERS[n.forms.provider].label : t("be.forms.none") }) + " · " +
    t("be.status.db", { v: n.supabase.url ? "Supabase (" + n.supabase.url.replace(/^https:\/\//, "") + ")" : t("be.local") });
}
async function showSchema() {
  const cols = S.p ? detectCollections(S.p.files) : [];
  const existing = S.p && S.p.files["supabase/schema.sql"];
  const sql = existing || schemaSql(cols);
  const note = !existing && !cols.length ? `<p class="muted">${esc(t("be.sql.none"))}</p>` : "";
  const body = `<ol class="steps">${SCHEMA_STEPS.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>${note}<textarea class="input sql-box mono" id="sql-text" readonly spellcheck="false">${esc(sql)}</textarea>`;
  const p = modal({ title: t("be.sql.title"), body, html: true, ok: t("be.sql.copy"), cancel: t("cancel") });
  const ok = await p;
  if (ok) { const copied = await copyText(sql); toast(copied ? t("copied") : sql.slice(0, 60), copied ? "ok" : "warn", 2000); }
}

// ----- live data catalog view
function renderData() {
  $("d-live").checked = S.cfg.liveData !== false;
  $("d-live-note").textContent = S.cfg.liveData !== false ? t("data.on") : t("data.off");
  if (!$("d-cat").options.length) $("d-cat").innerHTML = `<option value="">Tüm kategoriler</option>` + Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  $("d-be-status").textContent = backendSummary();
  renderApiList();
}
function renderApiList() {
  const list = searchCatalog($("d-search").value, $("d-cat").value);
  $("d-count").textContent = t("data.count", { n: list.length, d: new Date(VERIFIED_AT + "T12:00:00").toLocaleDateString(getLang() === "en" ? "en-GB" : "tr-TR") });
  $("d-list").innerHTML = list.length ? list.map((a) => `<article class="api" role="listitem" data-api="${a.id}">
      <h3>${esc(a.name)} <span class="chip">${esc(CATEGORIES[a.category])}</span>${a.status === "limited" ? `<span class="chip" title="${esc(t("data.limited"))}">kota</span>` : `<span class="chip chip--on">✓ doğrulandı</span>`}</h3>
      <p>${esc(a.desc)}</p>
      <code class="ep">GET ${esc(a.example)}</code>
      <span class="rate">${esc(a.rate)}</span>
      <div class="acts"><button class="btn btn-sm" data-test="${a.id}">▶ ${esc(t("data.test"))}</button><button class="btn btn-sm btn-primary" data-add="${a.id}">＋ ${esc(t("data.add"))}</button></div>
      <pre class="out" hidden></pre></article>`).join("") : `<p class="muted">${esc(t("data.none"))}</p>`;
}
async function runApiTest(id, btn) {
  const api = CATALOG.find((a) => a.id === id);
  const out = btn.closest(".api").querySelector(".out");
  out.hidden = false; out.classList.remove("bad"); out.textContent = t("data.testing");
  btn.disabled = true;
  const r = await testApi(api);
  btn.disabled = false;
  const head = (r.ok ? "✓ " : "✗ ") + (r.status ? "HTTP " + r.status : r.error || "Hata") + " · " + r.ms + " ms\n";
  let body = r.json != null ? JSON.stringify(r.json, null, 2) : r.text || r.error || "";
  if (body.length > 6000) body = body.slice(0, 6000) + "\n…";
  out.textContent = head + body;
  out.classList.toggle("bad", !r.ok);
}
function addApiToChat(id) {
  const api = CATALOG.find((a) => a.id === id);
  const ta = $("prompt");
  ta.value = (ta.value.trim() ? ta.value.trim() + "\n\n" : "") + snippetFor(api);
  showView("build"); setPane("chat"); autoGrow(); updateEstimate(); ta.focus();
  toast(t("data.added"), "ok", 2500);
}
function fillProviderFields() {
  const prov = $("s-provider").value, P = PROVIDERS[prov];
  $("s-key").value = S.cfg.keys[prov] || "";
  $("s-key").placeholder = P.keyHint;
  $("s-model").value = S.cfg.models[prov] || P.defaultModel;
  $("s-key-help").innerHTML = t("set.keyhelp." + prov, { url: P.keyUrl });
  $("s-base-wrap").hidden = prov !== "openai";
  $("s-base").value = S.cfg.baseUrl || "";
  $("s-free-wrap").hidden = prov !== "openrouter";
  S.models = []; renderModelList();
  if (prov === "openrouter") fetchModels(true);
}
async function fetchModels(silent = false) {
  const prov = $("s-provider").value;
  const cfg = { provider: prov, apiKey: $("s-key").value.trim(), baseUrl: $("s-base").value.trim() };
  if (prov !== "openrouter" && !cfg.apiKey) { if (!silent) toast(t("need.key"), "warn"); return; }
  $("s-fetch").disabled = true;
  try {
    S.models = await listModels(cfg);
    renderModelList();
    if (prov === "openrouter") {
      const cur = $("s-model").value.trim();
      if (!S.models.find((m) => m.id === cur)) { const pick = pickFreeModel(S.models); if (pick && !silent) $("s-model").value = pick; }
      rememberModelInfo(prov, $("s-model").value.trim());
    }
    if (!silent) toast(t("set.models", { n: S.models.length }), "ok");
  } catch (e) {
    if (!silent) toast(errorText(e).text, "error", 7000);
  } finally { $("s-fetch").disabled = false; }
}
function renderModelList() {
  const q = $("s-search").value.trim().toLowerCase();
  const free = $("s-free").checked && $("s-provider").value === "openrouter";
  const list = S.models.filter((m) => (!free || m.free) && (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))).slice(0, 300);
  const cur = $("s-model").value.trim();
  $("s-models").innerHTML = list.map((m) => `<li role="option" data-model="${esc(m.id)}" aria-selected="${m.id === cur}"><code>${esc(m.id)}</code>${m.free ? `<span class="chip chip--on">${esc(t("free"))}</span>` : m.pricing && m.pricing.prompt ? `<span class="chip">$${(m.pricing.prompt * 1e6).toFixed(2)}/M</span>` : ""}${m.vision ? '<span class="chip" title="görsel">👁</span>' : ""}${m.context ? `<span class="muted">${fmtTok(m.context)}</span>` : ""}</li>`).join("");
  $("s-model-list").innerHTML = list.slice(0, 100).map((m) => `<option value="${esc(m.id)}">`).join("");
}
function rememberModelInfo(prov, id) {
  const m = S.models.find((x) => x.id === id);
  if (!m) return;
  S.cfg.modelInfo = S.cfg.modelInfo || {};
  S.cfg.modelInfo[prov + ":" + id] = { free: m.free, vision: m.vision, pricing: m.pricing };
}
function saveSettings() {
  const prov = $("s-provider").value;
  S.cfg.provider = prov;
  S.cfg.keys[prov] = $("s-key").value.trim();
  S.cfg.models[prov] = $("s-model").value.trim() || PROVIDERS[prov].defaultModel;
  S.cfg.baseUrl = $("s-base").value.trim();
  S.cfg.maxTokens = Math.max(1024, +$("s-max").value || 16000);
  S.cfg.temperature = $("s-temp").value === "" ? "" : +$("s-temp").value;
  rememberModelInfo(prov, S.cfg.models[prov]);
  saveCfg();
  renderModelChip(); updateEstimate();
  $("s-msg").textContent = settings.persistent() ? t("saved") : t("set.nopersist");
  toast(t("saved"), "ok", 1800);
  if (S.p && !S.p.messages.length) renderMessages();
}

// ----- theme & language
function applyTheme(th) {
  document.documentElement.dataset.theme = th;
  document.querySelector('meta[name="theme-color"]').content = th === "light" ? "#f7f7f9" : "#0f0f12";
  settings.set("theme", th);
}
function applyLanguage(l) {
  setLang(l);
  settings.set("lang", l);
  document.documentElement.lang = l;
  applyI18n(document);
  $("lang-btn").textContent = l === "tr" ? "EN" : "TR";
  if (S.p) renderAll();
}

// ---------------------------------------------------------------- events
function autoGrow() { const ta = $("prompt"); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + "px"; }
function bind() {
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  document.querySelectorAll("#mseg [data-pane]").forEach((b) => b.addEventListener("click", () => setPane(b.dataset.pane)));
  document.querySelectorAll(".wtab").forEach((b) => b.addEventListener("click", () => showWorkTab(b.dataset.w)));
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); send($("prompt").value); });
  $("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send($("prompt").value); } });
  $("prompt").addEventListener("input", () => { autoGrow(); updateEstimate(); });
  $("prompt").addEventListener("paste", (e) => { const fs = [...(e.clipboardData && e.clipboardData.files || [])]; if (fs.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addImages(fs); } });
  $("btn-stop").addEventListener("click", stopGeneration);
  $("btn-attach").addEventListener("click", () => $("file-img").click());
  $("file-img").addEventListener("change", (e) => { addImages(e.target.files); e.target.value = ""; });
  $("btn-enhance").addEventListener("click", enhance);
  $("model-chip").addEventListener("click", () => showView("settings"));
  $("pname").addEventListener("change", () => { S.p.name = $("pname").value.trim() || DEFAULT_NAME(); persist(); });
  $("ptype").addEventListener("change", () => {
    const v = $("ptype").value;
    if (v === "auto") { S.p.autoType = true; S.p.type = detectType($("prompt").value, S.p.files); }
    else { S.p.autoType = false; S.p.type = v; }
    persist(); renderTypeSelect(); renderRunner(); if (!S.p.messages.length) renderMessages(); updateEstimate();
  });
  $("btn-new").addEventListener("click", async () => { await createProject(); setPane("chat"); $("prompt").focus(); });
  $("btn-undo").addEventListener("click", undo);
  $("btn-history").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("hist-pop"), open = pop.hidden;
    if (open) renderHistory();
    pop.hidden = !open; $("btn-history").setAttribute("aria-expanded", String(open));
  });
  $("hist-pop").addEventListener("click", (e) => { const b = e.target.closest("[data-ver]"); if (b) { $("hist-pop").hidden = true; restore(b.dataset.ver); } });
  document.addEventListener("click", (e) => { if (!$("hist-pop").hidden && !e.target.closest("#hist-pop")) { $("hist-pop").hidden = true; $("btn-history").setAttribute("aria-expanded", "false"); } });
  $("btn-share").addEventListener("click", share);
  $("btn-zip").addEventListener("click", () => downloadZip());
  $("btn-publish").addEventListener("click", () => showView("deploy"));
  $("btn-review").addEventListener("click", () => send(reviewPrompt(typeOf()), { display: "🔍 " + t("review.msg"), kind: "review" }));
  // preview
  document.querySelectorAll("[data-dev]").forEach((b) => b.addEventListener("click", () => setDevice(+b.dataset.dev)));
  $("pv-page").addEventListener("change", () => { S.page = $("pv-page").value; renderPreview(); });
  $("pv-refresh").addEventListener("click", renderPreview);
  $("pv-open").addEventListener("click", () => {
    const html = standaloneDocument(S.p.files, S.page, S.p.name);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) download(slugify(S.p.name) + "-onizleme.html", new Blob([html], { type: "text/html" }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  $("con-toggle").addEventListener("click", () => { const c = $("console").classList.toggle("collapsed"); $("con-toggle").setAttribute("aria-expanded", String(!c)); });
  $("con-clear").addEventListener("click", () => { S.logs = []; renderConsole(); });
  $("con-fix").addEventListener("click", () => {
    const errs = [...new Set(S.logs.filter((l) => l.kind === "error").map((l) => l.msg))];
    if (errs.length) send(fixErrorPrompt(errs, getLang()), { display: "🛠 " + t("fix.msg", { n: errs.length }), kind: "fix" });
  });
  // python
  $("py-run").addEventListener("click", () => runPython("run"));
  $("py-test").addEventListener("click", () => runPython("test"));
  $("py-stop").addEventListener("click", stopPython);
  $("py-clear").addEventListener("click", () => { $("py-term").innerHTML = ""; });
  $("py-fix").addEventListener("click", () => { const tail = S.py.stderr.slice(-3000); if (tail.trim()) send(fixErrorPrompt([tail], getLang()), { display: "🛠 " + t("fix.msg", { n: 1 }), kind: "fix" }); });
  $("opt-bin-py").addEventListener("change", (e) => setBinaries(e.target.checked));
  $("opt-bin").addEventListener("change", (e) => setBinaries(e.target.checked));
  // snack
  $("sn-open").addEventListener("click", openSnack);
  $("sn-embed").addEventListener("click", embedSnack);
  $("sn-eas").addEventListener("click", addEas);
  $("sn-fix").addEventListener("click", () => { const v = $("sn-errtext").value.trim(); if (!v) { toast(t("paste.need"), "info"); $("sn-errtext").focus(); return; } send(fixErrorPrompt([v], getLang()), { display: "🛠 " + t("fix.msg", { n: 1 }), kind: "fix" }); $("sn-errtext").value = ""; });
  // none
  $("none-zip").addEventListener("click", () => downloadZip());
  $("none-review").addEventListener("click", () => send(reviewPrompt(typeOf()), { display: "🔍 " + t("review.msg"), kind: "review" }));
  $("none-fix").addEventListener("click", () => { const v = $("none-errtext").value.trim(); if (!v) { toast(t("paste.need"), "info"); $("none-errtext").focus(); return; } send(fixErrorPrompt([v], getLang()), { display: "🛠 " + t("fix.msg", { n: 1 }), kind: "fix" }); $("none-errtext").value = ""; });
  // files
  $("f-new").addEventListener("click", newFile);
  $("f-rename").addEventListener("click", renameFile);
  $("f-delete").addEventListener("click", deleteFile);
  $("f-upload").addEventListener("click", () => $("f-upload-input").click());
  $("f-upload-input").addEventListener("change", (e) => { uploadFiles([...e.target.files]); e.target.value = ""; });
  // projects
  $("pr-new").addEventListener("click", async () => { await createProject(); showView("build"); setPane("chat"); });
  $("pr-import").addEventListener("click", () => $("pr-import-input").click());
  $("pr-import-input").addEventListener("change", (e) => { if (e.target.files[0]) importZipFile(e.target.files[0]); e.target.value = ""; });
  $("pr-demo").addEventListener("click", openDemo);
  // deploy
  $("gh-go").addEventListener("click", doDeploy);
  $("gh-forget").addEventListener("click", () => { settings.set("ghToken", null); $("gh-token").value = ""; toast(t("deploy.forgot"), "ok"); });
  $("dl-netlify").addEventListener("click", () => downloadZip("-netlify"));
  // live data + backend
  $("d-live").addEventListener("change", () => { S.cfg.liveData = $("d-live").checked; saveCfg(); renderData(); updateEstimate(); });
  $("d-search").addEventListener("input", renderApiList);
  $("d-cat").addEventListener("change", renderApiList);
  $("d-list").addEventListener("click", (e) => {
    const tb = e.target.closest("[data-test]"); if (tb) { runApiTest(tb.dataset.test, tb); return; }
    const ab = e.target.closest("[data-add]"); if (ab) addApiToChat(ab.dataset.add);
  });
  $("d-be-settings").addEventListener("click", () => { showView("settings"); setTimeout(() => $("be-panel").scrollIntoView({ block: "start" }), 30); });
  $("d-sql").addEventListener("click", showSchema);
  $("be-form-provider").addEventListener("change", fillFormHelp);
  $("be-save").addEventListener("click", saveBackend);
  $("be-sql").addEventListener("click", showSchema);
  // settings
  $("s-provider").addEventListener("change", fillProviderFields);
  $("s-key-show").addEventListener("click", () => { const k = $("s-key"); k.type = k.type === "password" ? "text" : "password"; $("s-key-show").textContent = k.type === "password" ? t("show") : t("hide"); });
  $("s-fetch").addEventListener("click", () => fetchModels(false));
  $("s-free").addEventListener("change", renderModelList);
  $("s-search").addEventListener("input", renderModelList);
  $("s-models").addEventListener("click", (e) => { const li = e.target.closest("[data-model]"); if (li) { $("s-model").value = li.dataset.model; renderModelList(); } });
  $("s-save").addEventListener("click", saveSettings);
  $("s-clear").addEventListener("click", async () => {
    if (!(await modal({ title: t("set.clear"), body: t("set.clearask"), ok: t("delete"), danger: true }))) return;
    S.cfg.keys = {}; saveCfg(); settings.set("ghToken", null);
    $("s-key").value = ""; $("gh-token").value = ""; renderModelChip(); toast(t("set.cleared"), "ok");
  });
  $("s-theme").addEventListener("change", () => applyTheme($("s-theme").value));
  $("s-lang").addEventListener("change", () => applyLanguage($("s-lang").value));
  $("theme-btn").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("lang-btn").addEventListener("click", () => applyLanguage(getLang() === "tr" ? "en" : "tr"));
  // keyboard
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      if (S.gen) { stopGeneration(); e.preventDefault(); }
      else if (!$("hist-pop").hidden) $("hist-pop").hidden = true;
      return;
    }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); return; }
    if (e.altKey && ["1", "2", "3"].includes(e.key) && S.view === "build") { e.preventDefault(); const pn = ["chat", "run", "code"][+e.key - 1]; if (isMobile()) setPane(pn); else if (pn === "chat") $("prompt").focus(); else showWorkTab(pn); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "z" && !e.target.closest(".CodeMirror, textarea, input")) { e.preventDefault(); undo(); }
  });
  window.addEventListener("beforeunload", (e) => { if (S.gen) { e.preventDefault(); e.returnValue = ""; } });
}

// ---------------------------------------------------------------- boot
async function boot() {
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(settings.get("theme", prefersLight ? "light" : "dark"));
  const lang = settings.get("lang", (navigator.language || "tr").toLowerCase().startsWith("tr") ? "tr" : "tr");
  setLang(lang); document.documentElement.lang = lang; applyI18n(document); $("lang-btn").textContent = lang === "tr" ? "EN" : "TR";
  S.cfg = loadCfg();
  $("pv-frame").setAttribute("sandbox", PREVIEW_SANDBOX);
  $("pv-frame").setAttribute("allow", PREVIEW_ALLOW);
  S.store = await new ProjectStore().init();
  bind();
  initMotor({ toast, onFiles: async (files, prompt) => { await createProject({ name: "Motor: " + prompt.slice(0, 40), files, type: detectType(prompt, files), autoType: false }); showView("build"); } });

  let shared = null;
  if (location.hash.startsWith("#p=")) {
    try { shared = await decodeShare(location.hash); } catch (e) { toast(t("share.bad"), "error"); }
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (shared) {
    await createProject({ name: shared.name, files: shared.files, type: TYPES[shared.type] ? shared.type : detectType("", shared.files), autoType: false });
    toast(t("share.loaded"), "ok");
  } else {
    const last = settings.get("lastProject", null);
    const p = (last && await S.store.get(last)) || (await S.store.list())[0];
    if (p) await openProject(p); else await createProject();
  }
  setDevice(0);
  if (!S.store.persistent) toast(t("store.memwarn"), "warn", 7000);
  document.body.classList.add("ready");
}
boot().catch((e) => { console.error(e); toast("Kovan Studio başlatılamadı: " + (e && e.message || e), "error", 10000); });
