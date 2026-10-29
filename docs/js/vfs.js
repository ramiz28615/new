// Virtual file system helpers: paths, MIME types, binary <-> data URL.
// Files are stored as { "path/name.ext": "text content" | "data:<mime>;base64,..." }.

const MIME = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", md: "text/markdown", txt: "text/plain", svg: "image/svg+xml", xml: "application/xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", bmp: "image/bmp", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4",
  webm: "video/webm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
  csv: "text/csv", jsx: "text/javascript", ts: "text/plain", tsx: "text/plain", webmanifest: "application/manifest+json",
};
const TEXT_EXT = new Set(["html", "htm", "css", "js", "mjs", "json", "md", "txt", "svg", "xml", "csv", "jsx", "ts", "tsx", "webmanifest", "gitignore", "nojekyll", ""]);

export function ext(path) {
  const base = String(path).split("/").pop();
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : base.startsWith(".") ? base.slice(1).toLowerCase() : "";
}
export function mimeOf(path) { return MIME[ext(path)] || "application/octet-stream"; }
export function isTextPath(path) { return TEXT_EXT.has(ext(path)); }
export function isDataUrl(s) { return typeof s === "string" && /^data:[^,]*;base64,/.test(s); }
export function isBinaryContent(path, content) { return isDataUrl(content) && !isTextPath(path); }

/** Normalise a project path: forward slashes, no leading ./ or /, no "..", no empty segments. Returns "" when invalid. */
export function normPath(p) {
  if (typeof p !== "string") return "";
  const parts = [];
  for (const seg of p.trim().replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return "";
    parts.push(seg);
  }
  const out = parts.join("/");
  return /[\0<>:"|?*]/.test(out) ? "" : out;
}

/** Resolve a relative reference (href/src/import) against the file that contains it. Returns null for external refs. */
export function resolveRef(fromPath, ref) {
  if (typeof ref !== "string") return null;
  ref = ref.trim();
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null; // http:, data:, mailto:, //cdn, #hash
  const clean = ref.split("#")[0].split("?")[0];
  if (!clean) return null;
  let base = clean.startsWith("/") ? [] : String(fromPath || "").split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (base.length) base.pop(); continue; }
    base.push(seg);
  }
  return base.join("/");
}

// --- base64 helpers that work in browsers and Node ---
export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
export function base64ToUtf8(b64) { return new TextDecoder().decode(base64ToBytes(b64)); }

export function dataUrlToBytes(url) {
  const i = url.indexOf(",");
  return base64ToBytes(url.slice(i + 1));
}
export function bytesToDataUrl(bytes, mime) { return "data:" + (mime || "application/octet-stream") + ";base64," + bytesToBase64(bytes); }

/** A data: URL for any project file (text gets encoded as UTF-8). */
export function fileDataUrl(path, content) {
  if (isDataUrl(content)) return content;
  return "data:" + mimeOf(path) + ";base64," + utf8ToBase64(String(content));
}

/** Sorted file list: index.html first, then folders/files alphabetically. */
export function sortPaths(paths) {
  return [...paths].sort((a, b) => {
    if (a === "index.html") return -1;
    if (b === "index.html") return 1;
    const da = a.includes("/"), db = b.includes("/");
    if (da !== db) return da ? 1 : -1;
    return a.localeCompare(b);
  });
}

export function htmlPages(files) { return sortPaths(Object.keys(files).filter((p) => /\.html?$/i.test(p))); }

export function projectSize(files) {
  let n = 0;
  for (const v of Object.values(files)) n += String(v).length;
  return n;
}

/** Rough token estimate (~4 chars per token; Turkish text and code sit near that). */
export function estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }

export function slugify(s, fallback = "kovan-site") {
  const map = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  const out = String(s || "").replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c]).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").replace(/-{2,}/g, "-").slice(0, 60);
  return out || fallback;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
