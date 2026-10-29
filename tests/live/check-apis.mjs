#!/usr/bin/env node
// Live check of the Kovan Studio API catalog (NOT part of CI): every catalog example endpoint, the Studio widget
// sources and the form endpoints' CORS preflight are requested with curl (honours HTTPS_PROXY / SSL_CERT_FILE).
// PASS = HTTP 200 + Access-Control-Allow-Origin present. A 429/5xx that still carries the CORS header is reported as
// LIMITED (per-IP quota or a temporary service error on the machine running the check). Usage: node tests/live/check-apis.mjs [--json]
import { execFile } from "node:child_process";
import { CATALOG } from "../../docs/js/apis.js";
import { WIDGET_SOURCES } from "../../docs/js/livewidgets.js";

const ORIGIN = "https://ramiz28615.github.io";
function curl(url, { method = "GET", headers = [] } = {}) {
  const args = ["-s", "-L", "-m", "20", "-o", "/dev/null", "-D", "-", "-X", method, "-H", "Origin: " + ORIGIN, "-A", "KovanStudio-livecheck/0.4"];
  for (const h of headers) args.push("-H", h);
  if (process.env.SSL_CERT_FILE) args.push("--cacert", process.env.SSL_CERT_FILE);
  args.push(url);
  return new Promise((resolve) => execFile("curl", args, { maxBuffer: 1 << 20 }, (err, out) => {
    const blocks = String(out || "").split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
    const last = blocks.filter((b) => !/^HTTP\/1\.1 200 Connection established/i.test(b.trim())).pop() || "";
    const status = +((/^HTTP\/[\d.]+ (\d{3})/m.exec(last) || [])[1] || 0);
    const acao = (/^access-control-allow-origin:\s*(.+)$/im.exec(last) || [])[1];
    resolve({ status, acao: acao ? acao.trim() : "", error: err && !status ? String(err.message).split("\n")[0] : "" });
  }));
}

const targets = [
  ...CATALOG.map((a) => ({ name: a.id, url: a.example })),
  ...Object.entries(WIDGET_SOURCES).map(([k, url]) => ({ name: "widget:" + k, url })),
  { name: "preflight:formspree", url: "https://formspree.io/f/test", method: "OPTIONS", headers: ["Access-Control-Request-Method: POST", "Access-Control-Request-Headers: content-type"] },
];
const results = [];
const queue = [...targets];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    const r = await curl(t.url, t);
    const verdict = r.acao && (r.status === 200 || (t.method === "OPTIONS" && r.status >= 200 && r.status < 300)) ? "PASS" : r.acao && (r.status === 429 || r.status >= 500) ? "LIMITED" : "FAIL";
    results.push({ ...t, ...r, verdict });
  }
}));
results.sort((a, b) => a.name.localeCompare(b.name));
if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(`${r.verdict.padEnd(7)} ${String(r.status).padEnd(4)} ${(r.acao || "-").padEnd(28)} ${r.name}${r.error ? "  (" + r.error + ")" : ""}`);
const cat = results.filter((r) => !r.name.includes(":"));
const pass = cat.filter((r) => r.verdict === "PASS").length, lim = cat.filter((r) => r.verdict === "LIMITED").length;
console.log(`\nKatalog: ${pass}/${cat.length} PASS, ${lim} LIMITED (CORS var; kota/geçici hata), ${cat.length - pass - lim} FAIL · ek kontroller: ${results.filter((r) => r.name.includes(":") && r.verdict === "PASS").length}/${results.filter((r) => r.name.includes(":")).length} PASS`);
process.exitCode = cat.some((r) => r.verdict === "FAIL") ? 1 : 0;
