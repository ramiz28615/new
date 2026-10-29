// Kovan Studio (docs/js) tests — run with: node --test tests/js
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { FileStreamParser, parseResponse, collect, applyChanges, stripFileBlocks, cleanContent } from "../../docs/js/parser.js";
import { streamChat, buildRequest, sseEvents, classifyHttpError, ProviderError, listModels, pickFreeModel, estimateCost } from "../../docs/js/providers.js";
import { buildMessages, systemPrompt, projectContext, fixErrorPrompt } from "../../docs/js/prompts.js";
import { buildPreview, standaloneDocument, rewriteImports } from "../../docs/js/preview.js";
import { exportZip, importZip } from "../../docs/js/zip.js";
import { deployToGitHub, DeployError, pagesUrl, sanitizeRepoName, deployErrorMessage } from "../../docs/js/deploy.js";
import { encodeShare, decodeShare } from "../../docs/js/share.js";
import { ProjectStore, MemoryBackend, newProject, snapshot, restoreVersion, duplicateProject } from "../../docs/js/store.js";
import { normPath, resolveRef, base64ToUtf8, bytesToDataUrl, dataUrlToBytes, slugify } from "../../docs/js/vfs.js";
import { chunkString, streamResponse, jsonResponse, openaiSSE, anthropicSSE, geminiSSE, recordingFetch } from "./helpers.js";

const RESPONSE = `Kafe için rezervasyon sitesini hazırladım.

<file path="index.html">
<!doctype html>
<html lang="tr"><head><link rel="stylesheet" href="css/style.css"></head>
<body><h1>Kahve</h1><a href="menu.html">Menü</a><script src="js/app.js" defer></script></body></html>
</file>
<file path="css/style.css">
\`\`\`css
body { color: #222; }
\`\`\`
</file>
<kovan-file path='js/app.js'>
document.querySelector("h1").textContent = "Merhaba <b>";
if (1 < 2) console.log("</fil" + "e> değil");
</kovan-file>
<file path="menu.html">
<!doctype html><html><body><p>Menü</p></body></html>
</file>
Bitti.`;

function feedAll(chunks) {
  const p = new FileStreamParser();
  const events = [];
  for (const c of chunks) events.push(...p.feed(c));
  events.push(...p.finish());
  return { events, result: collect(events, p.text) };
}

// ---------------------------------------------------------------- parser
test("parser: whole response", () => {
  const r = parseResponse(RESPONSE);
  assert.deepEqual(Object.keys(r.files).sort(), ["css/style.css", "index.html", "js/app.js", "menu.html"]);
  assert.equal(r.files["css/style.css"], "body { color: #222; }\n");
  assert.match(r.files["js/app.js"], /"<\/fil" \+ "e> değil"/);
  assert.match(r.text, /hazırladım/);
  assert.match(r.text, /Bitti/);
  assert.deepEqual(r.truncated, []);
});

test("parser: identical result for every chunking, including splits mid-tag", () => {
  const expected = parseResponse(RESPONSE).files;
  const sizes = [[1], [2], [3], [5, 1, 7], [13], [64], [4, 17, 2, 9]];
  for (const s of sizes) {
    const { result } = feedAll(chunkString(RESPONSE, s));
    assert.deepEqual(result.files, expected, "chunk sizes " + s.join(","));
  }
  // explicit split inside the open and close tags
  const i = RESPONSE.indexOf('<file path="css'), j = RESPONSE.indexOf("</kovan-file>");
  const { result } = feedAll([RESPONSE.slice(0, i + 7), RESPONSE.slice(i + 7, j + 4), RESPONSE.slice(j + 4)]);
  assert.deepEqual(result.files, expected);
});

test("parser: streaming events in order with live chunks", () => {
  const { events } = feedAll(chunkString(RESPONSE, [9]));
  const kinds = events.filter((e) => e.type !== "text" && e.type !== "file-chunk").map((e) => e.type + ":" + e.path);
  assert.deepEqual(kinds, ["file-start:index.html", "file-end:index.html", "file-start:css/style.css", "file-end:css/style.css",
    "file-start:js/app.js", "file-end:js/app.js", "file-start:menu.html", "file-end:menu.html"]);
  const chunks = events.filter((e) => e.type === "file-chunk" && e.path === "index.html");
  assert.ok(chunks.length > 3, "index.html should stream progressively");
  assert.ok(chunks.every((c, k) => k === 0 || c.content.length >= chunks[k - 1].content.length));
  assert.ok(!chunks.some((c) => c.content.includes("</file")), "close tag must never leak into content");
});

test("parser: delete, rename, truncated output, invalid paths", () => {
  const txt = `Güncelledim.\n<delete path="old.js" />\n<rename from="a.css" to="css/a.css"/>\n<file path="../evil.txt">x</file>\n<file path="ok.txt">bir\n</file>\n<file path="half.html">\n<html><body>yarım`;
  for (const sizes of [[1], [6], [1000]]) {
    const { result } = feedAll(chunkString(txt, sizes));
    assert.deepEqual(result.deletes, ["old.js"]);
    assert.deepEqual(result.renames, [["a.css", "css/a.css"]]);
    assert.deepEqual(Object.keys(result.files), ["ok.txt"]);
    assert.deepEqual(result.truncated, ["half.html"]);
  }
  const next = applyChanges({ "old.js": "1", "a.css": "x{}", "index.html": "<h1>" }, parseResponse(txt));
  assert.deepEqual(Object.keys(next).sort(), ["css/a.css", "index.html", "ok.txt"]);
});

test("parser: fallback to fenced HTML when the protocol is ignored", () => {
  const r = parseResponse("İşte site:\n```html\n<!doctype html><html><body>hi</body></html>\n```\n");
  assert.equal(r.files["index.html"], "<!doctype html><html><body>hi</body></html>\n");
  assert.equal(stripFileBlocks(RESPONSE).includes("<file"), false);
  assert.equal(cleanContent("\n```js\nx\n```\n"), "x\n");
});

// ---------------------------------------------------------------- providers (stubbed fetch, streaming)
const KEY = "test-key-not-real";
const providerCases = [
  ["openrouter", (t) => openaiSSE(t), (c) => {
    assert.equal(c.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(c.headers.Authorization, "Bearer " + KEY);
    assert.equal(c.body.stream, true);
    assert.equal(c.body.messages[0].role, "system");
    assert.equal(c.body.model, "openrouter/free");
  }],
  ["openai", (t) => openaiSSE(t, { pieces: 2 }), (c) => {
    assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(c.body.stream_options.include_usage, true);
    assert.ok(c.body.max_completion_tokens > 0);
  }],
  ["anthropic", (t) => anthropicSSE(t), (c) => {
    assert.equal(c.url, "https://api.anthropic.com/v1/messages");
    assert.equal(c.headers["x-api-key"], KEY);
    assert.equal(c.headers["anthropic-version"], "2023-06-01");
    assert.equal(c.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(typeof c.body.system, "string");
    assert.equal(c.body.stream, true);
  }],
  ["gemini", (t) => geminiSSE(t), (c) => {
    assert.match(c.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
    assert.equal(c.headers["x-goog-api-key"], KEY);
    assert.equal(c.body.contents[0].role, "user");
    assert.ok(c.body.systemInstruction.parts[0].text.length > 100);
  }],
];

for (const [provider, sse, check] of providerCases) {
  test(`provider ${provider}: streaming builds the project (chunks split mid-event and mid-tag)`, async () => {
    const raw = sse(RESPONSE);
    const fetchImpl = recordingFetch(async () => streamResponse(chunkString(raw, [7, 1, 23, 3, 64])));
    const parser = new FileStreamParser();
    const events = [];
    const out = await streamChat({
      cfg: { provider, apiKey: KEY, maxTokens: 8000 }, system: systemPrompt("web"),
      messages: buildMessages({ files: {}, prompt: "kafe için rezervasyon sitesi yap" }),
      fetchImpl, onDelta: (d) => events.push(...parser.feed(d)),
    });
    events.push(...parser.finish());
    assert.equal(out.text, RESPONSE);
    assert.ok(out.usage && out.usage.input > 0 && out.usage.output > 0, "usage reported");
    assert.equal(fetchImpl.calls.length, 1);
    check(fetchImpl.calls[0]);
    const r = collect(events, parser.text);
    assert.deepEqual(r.files, parseResponse(RESPONSE).files);
  });
}

test("providers: images are sent in each provider's vision format", () => {
  const img = [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }];
  const msgs = [{ role: "user", content: "bunun gibi", images: img }];
  const oa = buildRequest({ provider: "openrouter", apiKey: "k" }, "s", msgs);
  assert.equal(JSON.parse(oa.init.body).messages[1].content[1].image_url.url, img[0].dataUrl);
  const an = JSON.parse(buildRequest({ provider: "anthropic", apiKey: "k" }, "s", msgs).init.body);
  assert.deepEqual(an.messages[0].content[0].source, { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" });
  const ge = JSON.parse(buildRequest({ provider: "gemini", apiKey: "k" }, "s", msgs).init.body);
  assert.equal(ge.contents[0].parts[0].inline_data.mime_type, "image/png");
  const noVision = JSON.parse(buildRequest({ provider: "openai", apiKey: "k" }, "s", msgs, { vision: false }).init.body);
  assert.equal(noVision.messages[1].content, "bunun gibi");
});

test("providers: HTTP and stream errors are classified", async () => {
  const cases = [[401, { error: { message: "Invalid API key" } }, "auth"], [429, { error: { message: "Rate limit exceeded" } }, "rate"],
    [404, { error: { message: "model not found" } }, "model"], [402, { error: { message: "Insufficient credits" } }, "credit"], [503, {}, "server"]];
  for (const [status, body, code] of cases) {
    const fetchImpl = async () => jsonResponse(body, status);
    await assert.rejects(streamChat({ cfg: { provider: "openrouter", apiKey: KEY }, system: "s", messages: [{ role: "user", content: "x" }], fetchImpl }),
      (e) => e instanceof ProviderError && e.code === code);
  }
  await assert.rejects(streamChat({ cfg: { provider: "anthropic", apiKey: KEY }, system: "s", messages: [{ role: "user", content: "x" }], fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }),
    (e) => e.code === "network");
  const errStream = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
  await assert.rejects(streamChat({ cfg: { provider: "anthropic", apiKey: KEY }, system: "s", messages: [{ role: "user", content: "x" }], fetchImpl: async () => streamResponse([errStream]) }),
    (e) => e.code === "server");
  await assert.rejects(streamChat({ cfg: { provider: "openai", apiKey: "" }, system: "s", messages: [] }), (e) => e.code === "auth");
  assert.equal(classifyHttpError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').code, "auth");
});

test("providers: abort maps to code abort", async () => {
  const ac = new AbortController();
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(openaiSSE("<file path=\"a.txt\">x").split("data: [DONE]")[0])); } });
  const p = streamChat({ cfg: { provider: "openai", apiKey: KEY }, system: "s", messages: [{ role: "user", content: "x" }], signal: ac.signal,
    fetchImpl: async () => new Response(body, { status: 200 }), onDelta: () => ac.abort() });
  await assert.rejects(p, (e) => e.code === "abort");
});

test("providers: SSE parser handles CRLF, comments and multi-line data", async () => {
  const s = ": keep-alive\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\ndata: c\n\n";
  const out = [];
  for await (const e of sseEvents(streamResponse(chunkString(s, [1])).body)) out.push(e);
  assert.deepEqual(out, [{ event: "x", data: "a\nb" }, { event: "message", data: "c" }]);
});

test("providers: OpenRouter model list, free filter and cost", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "https://openrouter.ai/api/v1/models");
    return jsonResponse({ data: [
      { id: "openrouter/free", name: "Free router", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, context_length: 200000 },
      { id: "qwen/qwen3-coder:free", name: "Qwen", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      { id: "x/paid", name: "Paid", pricing: { prompt: "0.000001", completion: "0.000002" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      { id: "x/paid:batch", name: "Batch", pricing: { prompt: "0", completion: "0" } },
      { id: "google/lyria", name: "Music", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["audio"] } },
    ] });
  };
  const models = await listModels({ provider: "openrouter" }, fetchImpl);
  assert.deepEqual(models.map((m) => m.id), ["openrouter/free", "qwen/qwen3-coder:free", "x/paid"]);
  assert.deepEqual(models.filter((m) => m.free).map((m) => m.id), ["openrouter/free", "qwen/qwen3-coder:free"]);
  assert.equal(models[0].vision, true);
  assert.equal(pickFreeModel(models), "openrouter/free");
  assert.equal(pickFreeModel(models.slice(1)), "qwen/qwen3-coder:free");
  assert.ok(Math.abs(estimateCost(models[2].pricing, { input: 1000, output: 500 }) - 0.002) < 1e-12);
});

// ---------------------------------------------------------------- edit / delete flow
test("edit flow: current files go to the model, only changed files come back", async () => {
  const files = parseResponse(RESPONSE).files;
  const history = [{ role: "user", content: "kafe sitesi" }, { role: "assistant", content: RESPONSE, changed: Object.keys(files) }];
  const msgs = buildMessages({ history, files, prompt: "menüyü kaldır, renkleri koyu yap" });
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[1].role, "assistant");
  assert.ok(!msgs[1].content.includes("<file"), "old file blocks are summarised, not resent");
  assert.match(msgs[1].content, /Changed files: index\.html/);
  const last = msgs[msgs.length - 1].content;
  assert.match(last, /<current_project>/);
  assert.match(last, /<file path="css\/style.css">/);
  assert.match(last, /menüyü kaldır/);
  const edit = `Menüyü kaldırdım ve koyu tema yaptım.\n<delete path="menu.html"/>\n<file path="css/style.css">\nbody { color: #eee; background: #111; }\n</file>\n<file path="index.html">\n<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body><h1>Kahve</h1></body></html>\n</file>`;
  const fetchImpl = async () => streamResponse(chunkString(openaiSSE(edit), [5]));
  const parser = new FileStreamParser();
  const events = [];
  await streamChat({ cfg: { provider: "openrouter", apiKey: KEY }, system: systemPrompt("web"), messages: msgs, fetchImpl, onDelta: (d) => events.push(...parser.feed(d)) });
  events.push(...parser.finish());
  const next = applyChanges(files, collect(events, parser.text));
  assert.deepEqual(Object.keys(next).sort(), ["css/style.css", "index.html", "js/app.js"]);
  assert.match(next["css/style.css"], /#111/);
  assert.equal(next["js/app.js"], files["js/app.js"], "untouched file kept");
  assert.match(fixErrorPrompt(["TypeError: x is null"]), /TypeError/);
});

test("prompts: type-specific system prompts and binary assets in context", () => {
  assert.match(systemPrompt("web"), /WEB TECHNICAL RULES/);
  assert.match(systemPrompt("react"), /htm/);
  assert.match(systemPrompt("python"), /PYTHON/);
  assert.ok(!systemPrompt("python").includes("WEB TECHNICAL RULES"));
  assert.match(systemPrompt("shell"), /ShellCheck/);
  assert.match(systemPrompt("perl"), /use strict/);
  assert.match(systemPrompt("windows"), /CmdletBinding/);
  assert.match(systemPrompt("reactnative"), /Expo/);
  for (const t of ["web", "python", "shell"]) assert.match(systemPrompt(t), /<file path="index.html">/);
  const ctx = projectContext({ "index.html": "<h1>", "img/logo.png": "data:image/png;base64,AAAA" });
  assert.match(ctx, /<project_assets>\nimg\/logo.png \(image\/png\)/);
  assert.ok(!ctx.includes("AAAA"));
});

// ---------------------------------------------------------------- preview
test("preview: inlines css/js, rewrites module imports, assets and adds the hook", () => {
  const files = {
    "index.html": `<!doctype html><html><head><link rel="stylesheet" href="./css/style.css"><script type="importmap">{"imports":{"react":"https://esm.sh/react@18.3.1"}}</script></head>
<body><img src="img/logo.png" alt=""><a href="about.html">Hakkında</a><script src="js/app.js"></script><script type="module" src="src/main.js"></script>
<script type="module">import { n } from "./src/util.js"; console.log(n);</script><script src="https://cdn.tailwindcss.com"></script></body></html>`,
    "about.html": `<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body><a href="index.html">Ana</a></body></html>`,
    "css/style.css": `@import "base.css";\n.hero { background: url("../img/logo.png"); }`,
    "css/base.css": "body{margin:0}",
    "js/app.js": "console.log('</script>');",
    "src/main.js": `import React from "react";\nimport { n } from "./util.js";\nimport data from "../data.json";\nconsole.log(n, data);`,
    "src/util.js": "export const n = 42;",
    "data.json": '{"a":1}',
    "img/logo.png": "data:image/png;base64,iVBORw0KGgo=",
  };
  const html = buildPreview(files, "index.html", { seed: { k: "v" } });
  assert.match(html, /<style data-href="css\/style.css">/);
  assert.match(html, /body\{margin:0\}/, "@import inlined");
  assert.match(html, /url\("data:image\/png;base64,iVBORw0KGgo="\)/, "css url() resolved relative to the css file");
  assert.match(html, /<img src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(html, /<script data-src="js\/app.js">/);
  assert.ok(html.includes("<\\/script>"), "closing script tags escaped inside inline js");
  const mod = /<script type="module" src="data:text\/javascript;base64,([^"]+)"><\/script>/.exec(html);
  assert.ok(mod, "module script turned into a data: URL");
  const mainSrc = base64ToUtf8(mod[1]);
  assert.match(mainSrc, /from "react"/, "bare specifier left for the import map");
  const utilUrl = /from "(data:text\/javascript;base64,[^"]+)"/.exec(mainSrc)[1];
  assert.equal(base64ToUtf8(utilUrl.split(",")[1]), "export const n = 42;");
  assert.match(mainSrc, /import data from "data:text\/javascript;base64,/);
  assert.match(html, /import \{ n \} from "data:text\/javascript;base64,/, "inline module rewritten");
  assert.match(html, /https:\/\/cdn\.tailwindcss\.com/);
  assert.match(html, /<head><script>\(function\(\)\{/, "hook injected first in head");
  assert.match(html, /"k":"v"/, "localStorage seed");
  assert.match(html, /'nav'/);
  const about = buildPreview(files, "about.html", { hook: false });
  assert.ok(!about.includes("kovan:1"));
  assert.match(about, /<style data-href="css\/style.css">/);
  const missing = buildPreview({}, "index.html");
  assert.match(missing, /Önizlenecek sayfa yok/);
  const sa = standaloneDocument(files, "index.html", "Test");
  assert.match(sa, /var PAGES=/);
  assert.match(sa, /"about.html"/);
  assert.match(sa, /sandbox="allow-scripts/);
  assert.equal(rewriteImports(files, "src/main.js", 'import x from "./nope.js"'), 'import x from "./nope.js"');
  const d = buildPreview({ "index.html": '<html><head><script src="a.js" defer></script></head><body><p id="x">x</p></body></html>', "a.js": "document.getElementById('x');" }, "index.html", { hook: false });
  assert.ok(d.indexOf('data-src="a.js"') > d.indexOf('<p id="x">'), "deferred script moved after the body content");
});

test("vfs: paths", () => {
  assert.equal(normPath("./a//b\\c.js"), "a/b/c.js");
  assert.equal(normPath("../x"), "");
  assert.equal(resolveRef("pages/a/b.html", "../../css/s.css?v=1#x"), "css/s.css");
  assert.equal(resolveRef("index.html", "https://x.com/a.js"), null);
  assert.equal(resolveRef("a/index.html", "/img/x.png"), "img/x.png");
  assert.equal(slugify("Kafe Rezervasyon Şık Ürün!"), "kafe-rezervasyon-sik-urun");
  assert.deepEqual([...dataUrlToBytes(bytesToDataUrl(new Uint8Array([1, 2, 255])))], [1, 2, 255]);
});

// ---------------------------------------------------------------- zip
test("zip: export and import round trip (text, nested, binary, top folder stripped)", async () => {
  const files = { "index.html": "<h1>Merhaba ğüşİ</h1>\n", "css/style.css": "a{}", "img/p.png": bytesToDataUrl(new Uint8Array([137, 80, 78, 71, 0, 255]), "image/png") };
  const data = await exportZip(files, JSZip, { folder: "proje" });
  assert.ok(data instanceof Uint8Array && data.length > 50);
  const back = await importZip(data, JSZip);
  assert.deepEqual(back, files);
  const z = new JSZip();
  z.file("site/index.html", "x"); z.file("__MACOSX/site/._index.html", "junk"); z.file("site/.DS_Store", "junk");
  const back2 = await importZip(await z.generateAsync({ type: "uint8array" }), JSZip);
  assert.deepEqual(back2, { "index.html": "x" });
});

// ---------------------------------------------------------------- deploy
function githubStub({ repoExists = false, pagesExists = false, workflowRun = false } = {}) {
  let builds = 0;
  return recordingFetch(async (url, init) => {
    const u = new URL(url), m = (init.method || "GET").toUpperCase(), p = u.pathname;
    assert.equal(init.headers.Authorization, "Bearer ghp_test");
    assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28");
    if (m === "GET" && p === "/user") return jsonResponse({ login: "Ramiz" });
    if (m === "GET" && p === "/repos/Ramiz/kafe-sitesi") return repoExists ? jsonResponse({ default_branch: "main" }) : jsonResponse({ message: "Not Found" }, 404);
    if (m === "POST" && p === "/user/repos") return jsonResponse({ default_branch: "main", name: "kafe-sitesi" }, 201);
    if (m === "GET" && p === "/repos/Ramiz/kafe-sitesi/git/ref/heads/main") return jsonResponse({ object: { sha: "head1" } });
    if (m === "POST" && p.endsWith("/git/blobs")) return jsonResponse({ sha: "blob1" }, 201);
    if (m === "POST" && p.endsWith("/git/trees")) return jsonResponse({ sha: "tree1" }, 201);
    if (m === "POST" && p.endsWith("/git/commits")) return jsonResponse({ sha: "commit1" }, 201);
    if (m === "PATCH" && p.endsWith("/git/refs/heads/main")) return jsonResponse({ object: { sha: "commit1" } });
    if (m === "GET" && p.endsWith("/pages")) return pagesExists ? jsonResponse({ source: { branch: "main", path: "/" } }) : jsonResponse({ message: "Not Found" }, 404);
    if (m === "POST" && p.endsWith("/pages")) return jsonResponse({ html_url: "https://ramiz.github.io/kafe-sitesi/" }, 201);
    if (m === "GET" && p.endsWith("/pages/builds/latest")) return jsonResponse({ status: ++builds < 2 ? "building" : "built", commit: "commit1" });
    if (m === "GET" && p.endsWith("/actions/runs")) return jsonResponse({ workflow_runs: workflowRun ? [{ html_url: "https://github.com/Ramiz/kafe-sitesi/actions/runs/1" }] : [] });
    return jsonResponse({ message: "unexpected " + m + " " + p }, 500);
  });
}

test("deploy: new repo -> git data commit -> pages -> poll (endpoints and order)", async () => {
  const fetchImpl = githubStub();
  const files = { "index.html": "<h1>Kafe</h1>", "img/a.png": "data:image/png;base64,iVBORw0KGgo=" };
  const logs = [];
  const r = await deployToGitHub({ token: "ghp_test", repo: "Kafe Sitesi", files, pages: true, fetchImpl, onLog: (s) => logs.push(s), sleep: async () => {}, pollMs: 1 });
  const seq = fetchImpl.calls.map((c) => c.method + " " + new URL(c.url).pathname);
  assert.deepEqual(seq, [
    "GET /user", "GET /repos/Ramiz/kafe-sitesi", "POST /user/repos", "GET /repos/Ramiz/kafe-sitesi/git/ref/heads/main",
    "POST /repos/Ramiz/kafe-sitesi/git/blobs", "POST /repos/Ramiz/kafe-sitesi/git/trees", "POST /repos/Ramiz/kafe-sitesi/git/commits",
    "PATCH /repos/Ramiz/kafe-sitesi/git/refs/heads/main", "GET /repos/Ramiz/kafe-sitesi/pages", "POST /repos/Ramiz/kafe-sitesi/pages",
    "GET /repos/Ramiz/kafe-sitesi/pages/builds/latest", "GET /repos/Ramiz/kafe-sitesi/pages/builds/latest",
  ]);
  const create = fetchImpl.calls[2].body;
  assert.equal(create.name, "kafe-sitesi"); assert.equal(create.auto_init, true); assert.equal(create.private, false);
  const tree = fetchImpl.calls[5].body.tree;
  assert.deepEqual(tree.map((e) => e.path).sort(), [".nojekyll", "img/a.png", "index.html"]);
  assert.equal(tree.find((e) => e.path === "img/a.png").sha, "blob1");
  assert.equal(tree.find((e) => e.path === "index.html").content, "<h1>Kafe</h1>");
  assert.equal(fetchImpl.calls[4].body.encoding, "base64");
  assert.deepEqual(fetchImpl.calls[6].body.parents, ["head1"]);
  assert.equal(fetchImpl.calls[7].body.sha, "commit1");
  assert.deepEqual(fetchImpl.calls[9].body.source, { branch: "main", path: "/" });
  assert.equal(r.url, "https://ramiz.github.io/kafe-sitesi/");
  assert.equal(r.pagesStatus, "built");
  assert.equal(r.commit, "commit1");
  assert.ok(logs.some((l) => l.startsWith("Yayında")));
});

test("deploy: non-web project with PyInstaller workflow -> no Pages, Actions run link", async () => {
  const fetchImpl = githubStub({ repoExists: true, workflowRun: true });
  const files = { "main.py": "print(1)\n", ".github/workflows/build-binaries.yml": "name: x\n" };
  const r = await deployToGitHub({ token: "ghp_test", repo: "kafe-sitesi", files, pages: false, fetchImpl, sleep: async () => {}, pollMs: 1 });
  const seq = fetchImpl.calls.map((c) => c.method + " " + new URL(c.url).pathname);
  assert.ok(!seq.some((s) => s.includes("/pages")), "no Pages calls for non-web");
  assert.ok(!seq.includes("POST /user/repos"));
  assert.equal(seq[seq.length - 1], "GET /repos/Ramiz/kafe-sitesi/actions/runs");
  assert.ok(!fetchImpl.calls.find((c) => c.url.includes("/git/trees")).body.tree.some((e) => e.path === ".nojekyll"));
  assert.equal(r.url, null);
  assert.equal(r.runUrl, "https://github.com/Ramiz/kafe-sitesi/actions/runs/1");
});

test("deploy: errors", async () => {
  await assert.rejects(deployToGitHub({ token: "", repo: "x", files: { a: "1" } }), (e) => e instanceof DeployError && e.code === "auth");
  const bad = async () => jsonResponse({ message: "Bad credentials" }, 401);
  await assert.rejects(deployToGitHub({ token: "t", repo: "x", files: { a: "1" }, fetchImpl: bad }), (e) => e.code === "auth" && /token/.test(deployErrorMessage(e)));
  assert.equal(pagesUrl("Ramiz", "ramiz.github.io"), "https://ramiz.github.io/");
  assert.equal(sanitizeRepoName("Benim Sitem!"), "benim-sitem");
});

// ---------------------------------------------------------------- share
test("share: compressed hash round trip and size limit", async () => {
  const proj = { name: "Paylaşım ğ", type: "python", files: { "main.py": "print('merhaba')\n".repeat(50) } };
  const hash = await encodeShare(proj);
  assert.match(hash, /^#p=z[A-Za-z0-9_-]+$/);
  assert.ok(hash.length < 400, "compressed");
  assert.deepEqual(await decodeShare(hash), proj);
  assert.equal(await decodeShare("#other"), null);
  let seed = 12345;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const big = { name: "b", files: { "a.txt": Array.from({ length: 120000 }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join("") } };
  await assert.rejects(encodeShare(big), (e) => e.code === "too-big");
});

// ---------------------------------------------------------------- store
test("store: projects, versions, restore, duplicate (memory backend)", async () => {
  const store = await new ProjectStore(new MemoryBackend()).init();
  const p = newProject({ name: "A", files: { "index.html": "1" } });
  assert.equal(p.versions.length, 1);
  await store.save(p);
  p.files["index.html"] = "2"; snapshot(p, "ikinci");
  p.files["index.html"] = "3"; snapshot(p, "üçüncü");
  snapshot(p, "aynı"); // identical files -> no new version
  assert.equal(p.versions.length, 3);
  assert.ok(restoreVersion(p, p.versions[0].id));
  assert.equal(p.files["index.html"], "1");
  assert.equal(p.versions.length, 4);
  await store.save(p);
  const d = duplicateProject(p);
  await store.save(d);
  const list = await store.list();
  assert.equal(list.length, 2);
  assert.notEqual(d.id, p.id);
  await store.del(p.id);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.get(p.id), null);
});
