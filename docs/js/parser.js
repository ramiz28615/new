// Streaming parser for the file protocol the model writes:
//
//   <file path="index.html">
//   ...full file content...
//   </file>
//   <delete path="old.js" />
//   <rename from="a.css" to="styles/a.css" />
//
// Tolerant of: chunks split anywhere (even mid-tag), `kovan-file` tag names, `name=` instead of `path=`,
// single quotes, Markdown code fences inside or around file blocks, and output cut off mid-file.
import { normPath } from "./vfs.js";

const OPEN_RE = /<(?:kovan-)?file\s+(?:path|name)\s*=\s*(["'])([^"'\n]+)\1[^>]*?(\/)?>/i;
const DELETE_RE = /<(?:kovan-)?delete\s+(?:path|name)\s*=\s*(["'])([^"'\n]+)\1[^>]*>(?:\s*<\/(?:kovan-)?delete\s*>)?/i;
const RENAME_RE = /<(?:kovan-)?rename\s+from\s*=\s*(["'])([^"'\n]+)\1\s+to\s*=\s*(["'])([^"'\n]+)\3[^>]*>(?:\s*<\/(?:kovan-)?rename\s*>)?/i;
const CLOSE_RE = /<\/(?:kovan-)?file\s*>/i;
const TAG_NAMES = ["file", "kovan-file", "delete", "kovan-delete", "rename", "kovan-rename"];
const CLOSE_HOLD = 16; // enough to hold a split "</kovan-file >"

/** Strip a Markdown code fence that wraps a file's content, and normalise the trailing newline. */
export function cleanContent(raw, final = true) {
  let s = String(raw).replace(/\r\n/g, "\n");
  s = s.replace(/^[ \t]*\n/, ""); // newline right after the opening tag
  const fence = /^\s*```[\w+.-]*[ \t]*\n/.exec(s);
  if (fence) {
    s = s.slice(fence[0].length);
    if (final) s = s.replace(/\n?[ \t]*```[ \t]*\s*$/, "");
  }
  if (final) s = s.replace(/\s+$/, "") + "\n";
  return s;
}

function couldBeTagStart(tail) {
  // tail starts with "<" and contains no ">"
  if (tail.length > 400) return false;
  const m = /^<([a-z-]*)(\s[\s\S]*)?$/i.exec(tail);
  if (!m) return false;
  const name = m[1].toLowerCase();
  if (m[2] !== undefined) return TAG_NAMES.includes(name);
  return TAG_NAMES.some((t) => t.startsWith(name));
}

export class FileStreamParser {
  constructor() {
    this.buf = "";
    this.cur = null; // { path, raw }
    this.text = ""; // prose outside file blocks
    this.done = false;
  }

  /** Feed a chunk; returns an array of events. */
  feed(chunk) {
    const ev = [];
    if (this.done || !chunk) return ev;
    this.buf += chunk;
    this._drain(ev, false);
    return ev;
  }

  /** Flush at end of stream. A file still open is reported with truncated: true. */
  finish() {
    const ev = [];
    if (this.done) return ev;
    this._drain(ev, true);
    if (this.cur) {
      this.cur.raw += this.buf;
      this.buf = "";
      ev.push({ type: "file-end", path: this.cur.path, content: cleanContent(this.cur.raw), truncated: true });
      this.cur = null;
    } else if (this.buf) {
      this._text(ev, this.buf);
      this.buf = "";
    }
    this.done = true;
    return ev;
  }

  _text(ev, t) {
    if (!t) return;
    this.text += t;
    ev.push({ type: "text", text: t });
  }

  _drain(ev, final) {
    for (let guard = 0; guard < 100000; guard++) {
      if (this.cur) {
        const m = CLOSE_RE.exec(this.buf);
        if (m) {
          this.cur.raw += this.buf.slice(0, m.index);
          this.buf = this.buf.slice(m.index + m[0].length);
          ev.push({ type: "file-end", path: this.cur.path, content: cleanContent(this.cur.raw), truncated: false });
          this.cur = null;
          continue;
        }
        let keep = 0;
        if (!final) {
          const lt = this.buf.lastIndexOf("<");
          if (lt >= 0 && this.buf.length - lt < CLOSE_HOLD && !this.buf.slice(lt).includes(">")) keep = this.buf.length - lt;
        }
        const emit = this.buf.slice(0, this.buf.length - keep);
        if (emit) {
          this.cur.raw += emit;
          this.buf = this.buf.slice(emit.length);
          ev.push({ type: "file-chunk", path: this.cur.path, content: cleanContent(this.cur.raw, false) });
        }
        return;
      }
      // Outside a file block: find the earliest complete tag.
      let best = null;
      for (const [kind, re] of [["open", OPEN_RE], ["delete", DELETE_RE], ["rename", RENAME_RE]]) {
        const m = re.exec(this.buf);
        if (m && (!best || m.index < best.m.index)) best = { kind, m };
      }
      if (best) {
        const { kind, m } = best;
        this._text(ev, this.buf.slice(0, m.index));
        this.buf = this.buf.slice(m.index + m[0].length);
        if (kind === "open") {
          const path = normPath(m[2]);
          if (m[3]) { // self-closing <file path="x"/>: empty file
            if (path) ev.push({ type: "file-start", path }, { type: "file-end", path, content: "", truncated: false });
          } else if (path) {
            this.cur = { path, raw: "" };
            ev.push({ type: "file-start", path });
          } else {
            this.cur = { path: "", raw: "", skip: true };
          }
          if (this.cur && this.cur.skip) {
            // invalid path: swallow until the close tag
            const c = CLOSE_RE.exec(this.buf);
            if (c) { this.buf = this.buf.slice(c.index + c[0].length); this.cur = null; continue; }
            this.cur = null; this.buf = ""; return;
          }
        } else if (kind === "delete") {
          const path = normPath(m[2]);
          if (path) ev.push({ type: "delete", path });
        } else {
          const from = normPath(m[2]), to = normPath(m[4]);
          if (from && to) ev.push({ type: "rename", from, to });
        }
        continue;
      }
      // No complete tag. Hold back a possible partial tag at the end.
      const lt = this.buf.lastIndexOf("<");
      let keep = 0;
      if (!final && lt >= 0) {
        const tail = this.buf.slice(lt);
        if (!tail.includes(">") && couldBeTagStart(tail)) keep = tail.length;
      }
      const emit = this.buf.slice(0, this.buf.length - keep);
      this._text(ev, emit);
      this.buf = this.buf.slice(emit.length);
      return;
    }
  }
}

/** If the model ignored the protocol and answered with a fenced full HTML document, use it as index.html. */
export function fallbackFromText(text) {
  const files = {};
  const re = /```(html|css|javascript|js)?[ \t]*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    const lang = (m[1] || "").toLowerCase(), body = m[2];
    if ((lang === "html" || !lang) && /<(?:!doctype|html)[\s>]/i.test(body) && !files["index.html"]) files["index.html"] = body.replace(/\s+$/, "") + "\n";
  }
  return files;
}

/** Parse a whole response at once. Returns { text, files, deletes, renames, truncated, order }. */
export function parseResponse(full) {
  const p = new FileStreamParser();
  const events = [...p.feed(full), ...p.finish()];
  return collect(events, p.text);
}

export function collect(events, text = "") {
  const out = { text, files: {}, deletes: [], renames: [], truncated: [], order: [] };
  for (const e of events) {
    if (e.type === "file-end") {
      if (e.truncated) { out.truncated.push(e.path); continue; }
      out.files[e.path] = e.content;
      out.order.push(e.path);
    } else if (e.type === "delete") out.deletes.push(e.path);
    else if (e.type === "rename") out.renames.push([e.from, e.to]);
  }
  if (!out.order.length && !out.deletes.length && !out.renames.length) {
    const fb = fallbackFromText(text);
    for (const k of Object.keys(fb)) { out.files[k] = fb[k]; out.order.push(k); }
  }
  return out;
}

/** Apply a parsed change set to a file map, returning a new map. Order: renames, deletes, writes. */
export function applyChanges(files, changes) {
  const next = { ...files };
  for (const [from, to] of changes.renames || []) {
    if (next[from] != null) { next[to] = next[from]; delete next[from]; }
  }
  for (const p of changes.deletes || []) delete next[p];
  for (const [p, c] of Object.entries(changes.files || {})) next[p] = c;
  return next;
}

/** Remove file blocks from an assistant message, leaving the prose (for chat display / history). */
export function stripFileBlocks(text) {
  return String(text)
    .replace(/<(?:kovan-)?file\s[^>]*>[\s\S]*?(?:<\/(?:kovan-)?file\s*>|$)/gi, "")
    .replace(DELETE_RE.source ? new RegExp(DELETE_RE.source, "gi") : /$^/, "")
    .replace(new RegExp(RENAME_RE.source, "gi"), "")
    .replace(/```[\w-]*\s*```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
