// Persistence: projects in IndexedDB (memory fallback), settings/keys in localStorage (memory fallback).
import { uid } from "./vfs.js";

const DB = "kovan-studio", VER = 1, STORE = "projects";
const MAX_VERSIONS = 40;

export class MemoryBackend {
  constructor() { this.map = new Map(); }
  async all() { return [...this.map.values()].map(clone); }
  async get(id) { const v = this.map.get(id); return v ? clone(v) : null; }
  async put(p) { this.map.set(p.id, clone(p)); return p; }
  async del(id) { this.map.delete(id); }
}

const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

class IdbBackend {
  constructor(db) { this.db = db; }
  tx(mode) { return this.db.transaction(STORE, mode).objectStore(STORE); }
  req(r) { return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
  all() { return this.req(this.tx("readonly").getAll()); }
  get(id) { return this.req(this.tx("readonly").get(id)).then((v) => v || null); }
  put(p) { return this.req(this.tx("readwrite").put(p)).then(() => p); }
  del(id) { return this.req(this.tx("readwrite").delete(id)); }
}

function openIdb() {
  return new Promise((ok, no) => {
    try {
      if (typeof indexedDB === "undefined") return no(new Error("no indexedDB"));
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
      r.onblocked = () => no(new Error("blocked"));
    } catch (e) { no(e); }
  });
}

export class ProjectStore {
  constructor(backend) { this.backend = backend || null; this.persistent = false; }
  async init() {
    if (this.backend) return this;
    try { this.backend = new IdbBackend(await openIdb()); this.persistent = true; }
    catch (e) { this.backend = new MemoryBackend(); this.persistent = false; }
    return this;
  }
  async list() {
    const all = await this.backend.all();
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  get(id) { return this.backend.get(id); }
  async save(p) {
    p.updatedAt = Date.now();
    if (p.versions && p.versions.length > MAX_VERSIONS) p.versions = p.versions.slice(-MAX_VERSIONS);
    try { await this.backend.put(p); }
    catch (e) {
      // Quota or IDB failure: keep working in memory.
      if (!(this.backend instanceof MemoryBackend)) {
        const mem = new MemoryBackend();
        for (const x of await this.backend.all().catch(() => [])) await mem.put(x);
        this.backend = mem; this.persistent = false;
        await mem.put(p);
        throw Object.assign(new Error("Tarayıcı depolaması dolu ya da kullanılamıyor; proje yalnızca bu oturumda tutuluyor."), { code: "storage" });
      }
      throw e;
    }
    return p;
  }
  del(id) { return this.backend.del(id); }
}

export function newProject({ name = "Yeni proje", type = "web", files = {}, messages = [] } = {}) {
  const now = Date.now();
  const p = { id: uid(), name, type, files: { ...files }, messages, versions: [], deploys: [], createdAt: now, updatedAt: now, usage: { input: 0, output: 0, cost: 0 }, settings: {} };
  if (Object.keys(files).length) snapshot(p, "Başlangıç");
  return p;
}

/** Record the current files as a version. */
export function snapshot(p, label) {
  p.versions = p.versions || [];
  const last = p.versions[p.versions.length - 1];
  if (last && JSON.stringify(last.files) === JSON.stringify(p.files)) { last.label = label || last.label; return last; }
  const v = { id: uid(), at: Date.now(), label: String(label || "Sürüm").slice(0, 120), files: { ...p.files } };
  p.versions.push(v);
  return v;
}

export function restoreVersion(p, versionId) {
  const v = (p.versions || []).find((x) => x.id === versionId);
  if (!v) return false;
  p.files = { ...v.files };
  snapshot(p, "Geri yüklendi: " + v.label);
  return true;
}

export function duplicateProject(p) {
  const c = clone(p);
  c.id = uid(); c.name = p.name + " (kopya)"; c.createdAt = c.updatedAt = Date.now(); c.deploys = [];
  return c;
}

// ---------- settings (localStorage with try/catch) ----------
const mem = {};
export const settings = {
  get(k, d = null) {
    try { const v = globalThis.localStorage && localStorage.getItem("kovan:" + k); if (v != null) return JSON.parse(v); } catch (e) { /* blocked */ }
    return k in mem ? mem[k] : d;
  },
  set(k, v) {
    mem[k] = v;
    try { if (globalThis.localStorage) { if (v == null) localStorage.removeItem("kovan:" + k); else localStorage.setItem("kovan:" + k, JSON.stringify(v)); } return true; } catch (e) { return false; }
  },
  persistent() { try { localStorage.setItem("kovan:t", "1"); localStorage.removeItem("kovan:t"); return true; } catch (e) { return false; } },
};
