// UI smoke test: boot docs/index.html + js/app.js in jsdom (no real network), click through the main views,
// open the offline demo project and check the preview/editor/projects render without errors.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { openaiSSE, streamResponse, chunkString } from "./helpers.js";

const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));

test("UI boots, renders the builder and switches views without errors", async () => {
  const html = readFileSync(DOCS + "index.html", "utf8");
  const dom = new JSDOM(html, { url: "https://ramiz28615.github.io/new/", pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  const errors = [];
  const g = globalThis;
  const keep = {};
  const expose = { window: w, document: w.document, navigator: w.navigator, localStorage: w.localStorage, location: w.location, history: w.history,
    HTMLElement: w.HTMLElement, Image: w.Image, getComputedStyle: w.getComputedStyle, requestAnimationFrame: w.requestAnimationFrame, cancelAnimationFrame: w.cancelAnimationFrame,
    matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) };
  w.matchMedia = expose.matchMedia;
  w.open = () => null;
  for (const [k, v] of Object.entries(expose)) { keep[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); }
  const origErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(" ")); };
  w.addEventListener("error", (e) => errors.push(String(e.message)));
  const unhandled = (e) => errors.push("unhandled: " + (e && e.stack || e));
  process.on("unhandledRejection", unhandled);
  // Block every network request (the live widget strip must degrade gracefully); serve the Studio's own template
  // files (file:// URLs relative to docs/js) from disk, like GitHub Pages would.
  const fetchCalls = [];
  const realFetch = g.fetch;
  g.fetch = async (u) => {
    u = String(u);
    if (u.startsWith("file://")) { const f = fileURLToPath(u); return existsSync(f) ? new Response(readFileSync(f, "utf8"), { status: 200 }) : new Response("", { status: 404 }); }
    fetchCalls.push(u); throw new TypeError("network disabled in test");
  };
  try {
    await import(pathToFileURL(DOCS + "js/app.js").href + "?t=" + Date.now());
    for (let i = 0; i < 50 && !w.document.body.classList.contains("ready"); i++) await new Promise((r) => setTimeout(r, 20));
    const $ = (id) => w.document.getElementById(id);
    assert.ok(w.document.body.classList.contains("ready"), "app booted");
    assert.match(w.document.title, /Kovan Studio/);
    assert.equal($("view-build").hidden, false);
    assert.match($("msgs").textContent, /Ne inşa edelim\?/);
    assert.ok($("ptype").options.length >= 8, "type selector populated");
    assert.match($("model-chip").textContent, /OpenRouter · openrouter\/free/);
    // Views
    // Live widget strip on the empty state: offline -> placeholders, no errors
    await new Promise((r) => setTimeout(r, 120));
    assert.match($("lw").textContent, /İstanbul/);
    assert.match($("lw").textContent, /USD\/TRY/);
    assert.match($("lw").textContent, /çevrimdışı/);
    assert.ok($("msgs").querySelectorAll(".starter.live").length === 6, "six live templates on the empty state");
    for (const v of ["projects", "data", "deploy", "notebook", "motor", "settings", "build"]) {
      w.document.querySelector(`.nav-btn[data-view="${v}"]`).click();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal($("view-" + v).hidden, false, v + " visible");
    }
    // Live data view: catalog, search, snippet into the chat
    w.document.querySelector('.nav-btn[data-view="data"]').click();
    await new Promise((r) => setTimeout(r, 30));
    const { CATALOG } = await import(pathToFileURL(DOCS + "js/apis.js").href);
    assert.equal($("d-list").querySelectorAll(".api").length, CATALOG.length);
    assert.equal($("d-live").checked, true, "live data on by default");
    $("d-search").value = "deprem"; $("d-search").dispatchEvent(new w.Event("input"));
    assert.ok($("d-list").querySelectorAll(".api").length >= 2 && $("d-list").querySelectorAll(".api").length < CATALOG.length);
    $("d-list").querySelector('[data-add="usgs"]').click();
    assert.equal($("view-build").hidden, false);
    assert.match($("prompt").value, /earthquake\.usgs\.gov/);
    $("prompt").value = "";
    // Preview sandbox: scripts/forms/modals/popups, never same-origin (keys stay in the Studio's origin)
    const sb = $("pv-frame").getAttribute("sandbox");
    for (const k of ["allow-scripts", "allow-forms", "allow-modals", "allow-popups"]) assert.ok(sb.includes(k), k);
    assert.ok(!sb.includes("allow-same-origin"));
    // Demo project (works without a key): live dashboard
    w.document.querySelector('.nav-btn[data-view="projects"]').click();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok($("tpl-grid").children.length >= 21, "templates rendered (6 live + 15)");
    $("pr-demo").click();
    for (let i = 0; i < 60 && !($("pv-frame").getAttribute("srcdoc") || "").includes("Canlı Pano"); i++) await new Promise((r) => setTimeout(r, 30));
    await new Promise((r) => setTimeout(r, 600));
    assert.equal($("view-build").hidden, false);
    const srcdoc = $("pv-frame").getAttribute("srcdoc") || "";
    assert.match(srcdoc, /Canlı Pano/);
    assert.match(srcdoc, /<style data-href="style.css">/);
    assert.match(srcdoc, /root\.KovanDB = KovanDB/, "kovan-db.js inlined");
    assert.match(srcdoc, /api\.frankfurter\.dev/);
    assert.equal($("pv-page").options.length, 2, "two pages in the selector");
    assert.ok($("tree").textContent.includes("app.js"));
    assert.ok($("tree").textContent.includes("kovan-db.js"));
    $("wt-code").click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal($("w-code").hidden, false);
    // Type switch -> python runner panel
    $("ptype").value = "python"; $("ptype").dispatchEvent(new w.Event("change"));
    assert.equal($("run-python").hidden, false);
    $("ptype").value = "shell"; $("ptype").dispatchEvent(new w.Event("change"));
    assert.equal($("run-none").hidden, false);
    assert.match($("none-notice").textContent, /indir ve çalıştır/);
    $("ptype").value = "reactnative"; $("ptype").dispatchEvent(new w.Event("change"));
    assert.equal($("run-snack").hidden, false);
    // Language switch
    $("lang-btn").click();
    assert.equal(w.document.querySelector('.nav-btn[data-view="projects"] b').textContent, "Projects");
    $("lang-btn").click();
    assert.equal(w.document.querySelector('.nav-btn[data-view="projects"] b').textContent, "Projeler");
    // Sending without a key goes to settings instead of calling a provider
    $("prompt").value = "kafe sitesi yap";
    $("composer").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal($("view-settings").hidden, false);
    await new Promise((r) => setTimeout(r, 300));
    const { WIDGET_SOURCES } = await import(pathToFileURL(DOCS + "js/livewidgets.js").href);
    const widgetUrls = Object.values(WIDGET_SOURCES);
    assert.ok(fetchCalls.some((u) => widgetUrls.includes(u)), "live widget strip tried the verified APIs");
    const providerCalls = fetchCalls.filter((u) => !u.startsWith("https://openrouter.ai/api/v1/models") && !widgetUrls.includes(u));
    assert.deepEqual(providerCalls, [], "no provider calls without a key (only the public model list + live widgets)");
    assert.deepEqual(errors, []);
  } finally {
    console.error = origErr;
    process.off("unhandledRejection", unhandled);
    g.fetch = realFetch;
    // Globals stay pointed at this (closed-over) window: app timers (toasts, debounces) may still fire after the test.
    void keep;
  }
});

test("UI end-to-end: key -> prompt -> streamed files -> preview -> edit/delete -> undo", async () => {
  const html = readFileSync(DOCS + "index.html", "utf8");
  const dom = new JSDOM(html, { url: "https://ramiz28615.github.io/new/", pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window, g = globalThis, keep = {}, errors = [];
  const mm = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  w.matchMedia = mm; w.open = () => null;
  const expose = { window: w, document: w.document, navigator: w.navigator, localStorage: w.localStorage, location: w.location, history: w.history,
    HTMLElement: w.HTMLElement, Image: w.Image, getComputedStyle: w.getComputedStyle, requestAnimationFrame: w.requestAnimationFrame, cancelAnimationFrame: w.cancelAnimationFrame, matchMedia: mm };
  for (const [k, v] of Object.entries(expose)) { keep[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); }
  const origErr = console.error; console.error = (...a) => errors.push(a.map(String).join(" "));
  const unhandled = (e) => errors.push("unhandled: " + (e && e.stack || e)); process.on("unhandledRejection", unhandled);
  const FIRST = 'Kafe sitesini hazırladım.\n<file path="index.html">\n<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Kahve Evi</h1><a href="menu.html">Menü</a></body></html>\n</file>\n<file path="style.css">\nh1{color:brown}\n</file>\n<file path="menu.html">\n<!doctype html><html><body>Menü</body></html>\n</file>';
  const SECOND = 'Menüyü kaldırdım.\n<delete path="menu.html" />\n<file path="style.css">\nh1{color:black}\n</file>';
  const replies = [FIRST, SECOND];
  const bodies = [];
  const realFetch = g.fetch;
  g.fetch = async (u, init) => {
    if (String(u).startsWith("https://openrouter.ai/api/v1/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    assert.equal(String(u), "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer sk-or-test");
    bodies.push(JSON.parse(init.body));
    return streamResponse(chunkString(openaiSSE(replies.shift()), [3, 11, 1]));
  };
  const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  try {
    await import(pathToFileURL(DOCS + "js/app.js").href + "?e2e=" + Date.now());
    for (let i = 0; i < 50 && !w.document.body.classList.contains("ready"); i++) await tick(20);
    const $ = (id) => w.document.getElementById(id);
    w.document.querySelector('.nav-btn[data-view="settings"]').click(); await tick();
    $("s-key").value = "sk-or-test"; $("s-save").click(); await tick();
    w.document.querySelector('.nav-btn[data-view="build"]').click(); await tick();
    $("prompt").value = "kafe için rezervasyon sitesi yap";
    $("composer").dispatchEvent(new w.Event("submit", { cancelable: true }));
    for (let i = 0; i < 100 && !$("btn-stop").hidden === true; i++) await tick(20);
    for (let i = 0; i < 100 && $("btn-send").hidden; i++) await tick(20);
    await tick(100);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0].messages[0].content, /OUTPUT PROTOCOL/);
    assert.match(bodies[0].messages[1].content, /kafe için rezervasyon/);
    // live data + backend rules are injected, with the data layer files managed by the Studio
    assert.match(bodies[0].messages[0].content, /# LIVE DATA \(mandatory/);
    assert.match(bodies[0].messages[0].content, /# DATA LAYER & BACKEND/);
    assert.match(bodies[0].messages[0].content, /KovanDB\.sendForm/);
    const tree = $("tree").textContent;
    assert.ok(tree.includes("kovan-db.js") && tree.includes("kovan-config.js"), "helpers added to the web project");
    assert.ok(tree.includes("index.html") && tree.includes("style.css") && tree.includes("menu.html"), tree);
    assert.match($("pv-frame").getAttribute("srcdoc"), /Kahve Evi/);
    assert.match($("pv-frame").getAttribute("srcdoc"), /h1\{color:brown\}/);
    assert.match($("msgs").textContent, /Kafe sitesini hazırladım/);
    assert.equal($("pname").value, "kafe için rezervasyon sitesi yap");
    // follow-up edit
    $("prompt").value = "menüyü kaldır";
    $("composer").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await tick(50);
    for (let i = 0; i < 100 && $("btn-send").hidden; i++) await tick(20);
    await tick(100);
    assert.equal(bodies.length, 2);
    const ctx = bodies[1].messages[bodies[1].messages.length - 1].content;
    assert.match(ctx, /<current_project>/);
    assert.match(ctx, /<file path="menu.html">/);
    assert.match(ctx, /<file path="kovan-db.js" managed="true">/, "managed helper is not resent in full");
    assert.ok(!ctx.includes("supaCollection"), "helper source stays out of the context");
    assert.ok(!$("tree").textContent.includes("menu.html"), "menu.html deleted");
    assert.match($("pv-frame").getAttribute("srcdoc"), /h1\{color:black\}/);
    // undo -> previous version (menu.html back)
    $("btn-undo").click(); await tick(100);
    assert.ok($("tree").textContent.includes("menu.html"), "undo restored menu.html");
    assert.match($("pv-frame").getAttribute("srcdoc"), /h1\{color:brown\}/);
    assert.deepEqual(errors, []);
  } finally {
    console.error = origErr; process.off("unhandledRejection", unhandled); g.fetch = realFetch;
    // Globals stay pointed at this (closed-over) window: app timers (toasts, debounces) may still fire after the test.
    void keep;
  }
});
