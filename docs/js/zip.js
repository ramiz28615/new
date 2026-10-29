// ZIP export/import with JSZip (loaded lazily from a pinned CDN in the browser, injected in tests).
import { isDataUrl, dataUrlToBytes, bytesToDataUrl, isTextPath, mimeOf, normPath } from "./vfs.js";

export const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
let loading = null;

export function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  if (loading) return loading;
  loading = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = JSZIP_URL;
    s.crossOrigin = "anonymous";
    s.onload = () => (globalThis.JSZip ? ok(globalThis.JSZip) : no(new Error("JSZip yüklenemedi")));
    s.onerror = () => { loading = null; no(new Error("JSZip indirilemedi (internet bağlantısı?)")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Build a ZIP from a file map. Returns a Uint8Array (or Blob when type="blob"). */
export async function exportZip(files, JSZip, { folder = "", type = "uint8array" } = {}) {
  const zip = new JSZip();
  const root = folder ? zip.folder(folder) : zip;
  for (const [p, c] of Object.entries(files)) {
    if (isDataUrl(c)) root.file(p, dataUrlToBytes(c), { binary: true });
    else root.file(p, String(c));
  }
  return zip.generateAsync({ type, compression: "DEFLATE", compressionOptions: { level: 6 } });
}

const SKIP = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git|node_modules)(\/|$)/;
const MAX_FILES = 400, MAX_BYTES = 15 * 1024 * 1024;

/** Read a ZIP into a file map. Strips a single common top-level folder. */
export async function importZip(data, JSZip) {
  const zip = await JSZip.loadAsync(data);
  const entries = [];
  zip.forEach((path, entry) => { if (!entry.dir && !SKIP.test(path)) entries.push([path, entry]); });
  if (entries.length > MAX_FILES) throw new Error("ZIP çok fazla dosya içeriyor (en fazla " + MAX_FILES + ").");
  const tops = new Set(entries.map(([p]) => p.split("/")[0]));
  const strip = tops.size === 1 && entries.every(([p]) => p.includes("/")) ? [...tops][0] + "/" : "";
  const files = {};
  let total = 0;
  for (const [path, entry] of entries) {
    const p = normPath(strip && path.startsWith(strip) ? path.slice(strip.length) : path);
    if (!p) continue;
    if (isTextPath(p)) {
      const s = await entry.async("string");
      total += s.length;
      files[p] = s;
    } else {
      const b = await entry.async("uint8array");
      total += b.length;
      files[p] = bytesToDataUrl(b, mimeOf(p));
    }
    if (total > MAX_BYTES) throw new Error("ZIP içeriği çok büyük (en fazla 15 MB).");
  }
  return files;
}
