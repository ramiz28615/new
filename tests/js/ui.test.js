// UI smoke test: boot docs/index.html + js/app.js in jsdom (no real network), click through the main views,
// open the offline demo project and check the preview/editor/projects render without errors.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  // Block every network request: the boot path must not call any API.
  const fetchCalls = [];
  const realFetch = g.fetch;
  g.fetch = async (u) => { fetchCalls.push(String(u)); throw new TypeError("network disabled in test"); };
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
    for (const v of ["projects", "deploy", "notebook", "motor", "settings", "build"]) {
      w.document.querySelector(`.nav-btn[data-view="${v}"]`).click();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal($("view-" + v).hidden, false, v + " visible");
    }
    // Demo project (works without a key)
    w.document.querySelector('.nav-btn[data-view="projects"]').click();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok($("tpl-grid").children.length >= 15, "templates rendered");
    $("pr-demo").click();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal($("view-build").hidden, false);
    const srcdoc = $("pv-frame").getAttribute("srcdoc") || "";
    assert.match(srcdoc, /Kahve Durağı/);
    assert.match(srcdoc, /<style data-href="style.css">/);
    assert.equal($("pv-page").options.length, 2, "two pages in the selector");
    assert.ok($("tree").textContent.includes("app.js"));
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
    const providerCalls = fetchCalls.filter((u) => !u.startsWith("https://openrouter.ai/api/v1/models"));
    assert.deepEqual(providerCalls, [], "no provider calls without a key (only the public model list)");
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
    const tree = $("tree").textContent;
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
