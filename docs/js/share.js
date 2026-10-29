// Share a small project as a link: JSON -> deflate (CompressionStream) -> base64url in the URL hash.
import { bytesToBase64, base64ToBytes } from "./vfs.js";

export const SHARE_PREFIX = "#p=";
export const MAX_SHARE_CHARS = 60000;

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const b64url = (b) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

/** Encode { name, type, files } into a hash fragment. Throws when too big for a link. */
export async function encodeShare(project) {
  const payload = JSON.stringify({ v: 1, n: project.name || "Paylaşılan proje", t: project.type || "web", f: project.files || {} });
  const raw = new TextEncoder().encode(payload);
  let out;
  if (typeof CompressionStream !== "undefined") out = "z" + b64url(await pipe(raw, new CompressionStream("deflate-raw")));
  else out = "j" + b64url(raw);
  if (out.length > MAX_SHARE_CHARS) {
    const e = new Error("Proje bağlantıyla paylaşmak için çok büyük; ZIP olarak dışa aktar.");
    e.code = "too-big";
    throw e;
  }
  return SHARE_PREFIX + out;
}

export async function decodeShare(hash) {
  const s = String(hash || "");
  if (!s.startsWith(SHARE_PREFIX)) return null;
  const body = s.slice(SHARE_PREFIX.length);
  const kind = body[0], data = fromB64url(body.slice(1));
  let bytes = data;
  if (kind === "z") bytes = await pipe(data, new DecompressionStream("deflate-raw"));
  const j = JSON.parse(new TextDecoder().decode(bytes));
  if (!j || typeof j.f !== "object") throw new Error("Geçersiz paylaşım bağlantısı");
  return { name: String(j.n || "Paylaşılan proje"), type: String(j.t || "web"), files: j.f };
}
