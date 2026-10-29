// Assemble a self-contained HTML document from the virtual file system for a sandboxed iframe (srcdoc).
// - <link rel=stylesheet href="x.css"> -> <style> (with url() and @import resolved)
// - <script src="x.js"> -> inline script; ES modules get their relative imports rewritten to data: URLs
// - src/href/poster of project assets -> data: URLs
// - links between .html pages are intercepted by the injected hook and rendered by the parent
// - console output, errors and unhandled rejections are forwarded to the parent with postMessage
// - localStorage/sessionStorage/cookie are shimmed (the sandbox has an opaque origin) and synced to the parent
import { resolveRef, fileDataUrl, utf8ToBase64, isDataUrl } from "./vfs.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Script injected first into every preview page. `seed` = stored localStorage entries for this project. */
export function hookScript(page, seed = {}) {
  return `<script>(function(){
var P=parent,PG=${JSON.stringify(page)};
function S(t,a,x){try{P.postMessage(Object.assign({kovan:1,t:t,page:PG,m:[].map.call(a,function(v){try{if(v instanceof Error)return v.stack||v.message;return typeof v==='object'?JSON.stringify(v):String(v)}catch(e){return String(v)}}).join(' ')},x||{}),'*')}catch(e){}}
['log','info','warn','error','debug'].forEach(function(k){var o=console[k];console[k]=function(){S(k==='debug'?'log':k,arguments);try{o.apply(console,arguments)}catch(e){}}});
addEventListener('error',function(e){if(e&&e.message){S('error',[e.message+(e.lineno?' (satır '+e.lineno+(e.colno?':'+e.colno:'')+')':'')])}else if(e&&e.target&&e.target!==window){var t=e.target;S('error',['Kaynak yüklenemedi: '+(t.src||t.href||t.tagName)])}},true);
addEventListener('unhandledrejection',function(e){var r=e.reason;S('error',['Yakalanmamış Promise: '+(r&&(r.stack||r.message)||r)])});
function mk(seed,sync){var d=Object.assign({},seed||{});function push(){if(sync)try{P.postMessage({kovan:1,t:'storage',data:d},'*')}catch(e){}}
return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v);push()},removeItem:function(k){delete d[String(k)];push()},clear:function(){d={};push()},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
var ls=mk(${JSON.stringify(seed)},true),ss=mk({},false),ck='';
try{Object.defineProperty(window,'localStorage',{value:ls,configurable:true})}catch(e){}
try{Object.defineProperty(window,'sessionStorage',{value:ss,configurable:true})}catch(e){}
try{Object.defineProperty(document,'cookie',{get:function(){return ck},set:function(v){var p=String(v).split(';')[0];ck=ck?ck+'; '+p:p},configurable:true})}catch(e){}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented)return;var h=a.getAttribute('href');
if(!h||h.charAt(0)==='#'||/^(javascript:|mailto:|tel:)/i.test(h))return;
if(/^[a-z][a-z0-9+.-]*:|^\\/\\//i.test(h)){e.preventDefault();window.open(h,'_blank','noopener');return}
e.preventDefault();P.postMessage({kovan:1,t:'nav',href:h,from:PG},'*')},false);
})();<\/script>`;
}

function cssResolve(files, path, css, seen = new Set()) {
  seen.add(path);
  css = String(css).replace(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/g, (m, ref, media) => {
    const r = resolveRef(path, ref);
    if (r && files[r] != null && !seen.has(r) && !isDataUrl(files[r])) {
      const inner = cssResolve(files, r, files[r], seen);
      return media && media.trim() ? `@media ${media.trim()}{${inner}}` : inner;
    }
    return m;
  });
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, ref) => {
    const r = resolveRef(path, ref);
    return r && files[r] != null ? `url("${fileDataUrl(r, files[r])}")` : m;
  });
}

/** Rewrite relative import/export specifiers in an ES module to data: URLs (recursively, cycle-safe). */
export function moduleToDataUrl(files, path, cache = new Map(), stack = new Set()) {
  if (cache.has(path)) return cache.get(path);
  if (stack.has(path)) return null; // cycle: leave as is
  stack.add(path);
  const code = rewriteImports(files, path, String(files[path]), cache, stack);
  stack.delete(path);
  const url = "data:text/javascript;base64," + utf8ToBase64(code);
  cache.set(path, url);
  return url;
}

export function rewriteImports(files, fromPath, code, cache = new Map(), stack = new Set()) {
  const swap = (spec) => {
    if (!/^\.{0,2}\//.test(spec)) return null; // bare or absolute URL: leave for import maps / CDN
    const r = resolveRef(fromPath, spec);
    if (!r || files[r] == null) return null;
    if (/\.(m?js|jsx)$/.test(r)) return moduleToDataUrl(files, r, cache, stack);
    if (r.endsWith(".json")) return "data:text/javascript;base64," + utf8ToBase64("export default " + String(files[r]).trim() + ";");
    if (r.endsWith(".css")) return "data:text/javascript;base64," + utf8ToBase64("const s=document.createElement('style');s.textContent=" + JSON.stringify(cssResolve(files, r, files[r])) + ";document.head.appendChild(s);export default s;");
    return fileDataUrl(r, files[r]);
  };
  return code
    .replace(/(\b(?:import|export)\s[^'";]*?\bfrom\s*)(["'])([^"']+)\2/g, (m, pre, q, spec) => { const u = swap(spec); return u ? pre + q + u + q : m; })
    .replace(/(\bimport\s*)(["'])([^"']+)\2/g, (m, pre, q, spec) => { const u = swap(spec); return u ? pre + q + u + q : m; })
    .replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g, (m, pre, q, spec, post) => { const u = swap(spec); return u ? pre + q + u + q + post : m; });
}

function attr(tag, name) {
  const m = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}
function setAttr(tag, name, value) {
  const re = new RegExp("(\\s" + name + "\\s*=\\s*)(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)", "i");
  return re.test(tag) ? tag.replace(re, (m, pre) => pre + '"' + esc(value) + '"') : tag;
}

/**
 * Build the srcdoc HTML for one page of the project.
 * @param {Record<string,string>} files
 * @param {string} page  path of the HTML file to render
 * @param {{hook?: boolean, seed?: object}} opts
 */
export function buildPreview(files, page = "index.html", opts = {}) {
  const hook = opts.hook !== false;
  let html = files[page];
  if (html == null) {
    const list = Object.keys(files).map((p) => "<li><code>" + esc(p) + "</code></li>").join("");
    html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0f0f12;color:#e8e8ea}main{max-width:420px;padding:24px;text-align:center}code{color:#f5b301}</style></head><body><main><h1>Önizlenecek sayfa yok</h1><p>${esc(page)} bulunamadı.</p>${list ? "<ul style='text-align:left'>" + list + "</ul>" : "<p>Henüz dosya yok. Sohbetten bir şey iste.</p>"}</main></body></html>`;
  }
  html = String(html);
  const modCache = new Map();
  const deferred = [];

  // Stylesheets
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = (attr(tag, "rel") || "").toLowerCase(), href = attr(tag, "href");
    const r = href && resolveRef(page, href);
    if (!r || files[r] == null) return tag;
    if (rel.includes("stylesheet")) {
      const media = attr(tag, "media");
      return `<style data-href="${esc(r)}"${media ? ` media="${esc(media)}"` : ""}>\n${cssResolve(files, r, files[r])}\n</style>`;
    }
    if (rel.includes("modulepreload")) return "";
    return setAttr(tag, "href", fileDataUrl(r, files[r]));
  });

  // Scripts with src
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs, body) => {
    const open = "<script" + attrs + ">";
    const src = attr(open, "src"), type = (attr(open, "type") || "").toLowerCase();
    const isModule = type === "module";
    if (src) {
      const r = resolveRef(page, src);
      if (!r || files[r] == null) return whole;
      const cleaned = open.replace(/\s(src|defer|async|integrity|crossorigin)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "");
      if (isModule) return `<script type="module" src="${moduleToDataUrl(files, r, modCache)}"></script>`;
      const code = String(files[r]).replace(/<\/script/gi, "<\\/script");
      const tag = cleaned.replace(/>$/, "") + ` data-src="${esc(r)}">\n${code}\n</script>`;
      if (/\sdefer\b/i.test(open)) { deferred.push(tag); return ""; } // defer = run after parsing, in order
      return tag;
    }
    if (isModule && body.trim()) return open + rewriteImports(files, page, body, modCache).replace(/<\/script/gi, "<\\/script") + "</script>";
    return whole;
  });

  if (deferred.length) {
    const i = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    html = i >= 0 ? html.slice(0, i) + deferred.join("\n") + "\n" + html.slice(i) : html + "\n" + deferred.join("\n");
  }

  // Asset attributes (img/src, source/srcset is left alone, video poster, a[download])
  html = html.replace(/<(img|source|video|audio|iframe|embed|object|input)\b[^>]*>/gi, (tag) => {
    for (const name of ["src", "poster", "data"]) {
      const v = attr(tag, name);
      const r = v && resolveRef(page, v);
      if (r && files[r] != null) tag = setAttr(tag, name, fileDataUrl(r, files[r]));
    }
    return tag;
  });
  // Inline style url()
  html = html.replace(/\sstyle\s*=\s*"([^"]*url\([^"]*)"/gi, (m, css) => ' style="' + cssResolve(files, page, css.replace(/&quot;/g, '"')).replace(/"/g, "'") + '"');
  // <style> blocks
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + cssResolve(files, page, css) + b);

  if (hook) {
    const h = hookScript(page, opts.seed || {});
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (m) => m + h);
    else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (m) => m + "<head>" + h + "</head>");
    else html = h + html;
  }
  return html;
}

/** A standalone page that shows the project in a sandboxed iframe and handles page links (for "open in new tab"). */
export function standaloneDocument(files, page = "index.html", title = "Kovan önizleme") {
  const pages = {};
  for (const p of Object.keys(files)) if (/\.html?$/i.test(p)) pages[p] = buildPreview(files, p, { hook: true });
  const resolver = `function res(from,ref){ref=ref.split('#')[0].split('?')[0];var b=ref.charAt(0)==='/'?[]:from.split('/').slice(0,-1);ref.split('/').forEach(function(s){if(!s||s==='.')return;if(s==='..'){b.pop();return}b.push(s)});return b.join('/')}`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>
<iframe id="f" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox" title="${esc(title)}"></iframe>
<script>var PAGES=${JSON.stringify(pages).replace(/<\/script/gi, "<\\/script")};var f=document.getElementById('f');${resolver}
function show(p){if(!PAGES[p]){var c=p.replace(/\\/$/,'')+'/index.html';if(PAGES[c])p=c;else return}f.srcdoc=PAGES[p];document.title=${JSON.stringify(title)}+' · '+p}
addEventListener('message',function(e){var d=e.data;if(e.source!==f.contentWindow||!d||!d.kovan)return;if(d.t==='nav')show(res(d.from||'index.html',d.href)||'index.html')});
show(${JSON.stringify(page)});<\/script></body></html>`;
}
