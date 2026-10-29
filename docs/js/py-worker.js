// Module worker: loads Pyodide once and runs Python projects off the main thread (so "Durdur" can terminate it).
import { runPythonProject, PYODIDE_URL } from "./pyrun.js";

let pyPromise = null;
function boot() {
  if (!pyPromise) {
    pyPromise = import(PYODIDE_URL + "pyodide.mjs").then((m) => m.loadPyodide({ indexURL: PYODIDE_URL }));
    pyPromise.catch(() => { pyPromise = null; });
  }
  return pyPromise;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== "run") return;
  const post = (type, data) => self.postMessage({ id: msg.id, type, data });
  try {
    post("status", "Python yükleniyor (ilk seferde ~10 MB)…");
    const py = await boot();
    const res = await runPythonProject(py, msg.files, {
      mode: msg.mode, entry: msg.entry, stdin: msg.stdin, args: msg.args,
      onOut: (s) => post("out", s), onErr: (s) => post("err", s), onStatus: (s) => post("status", s),
    });
    post("done", res);
  } catch (err) {
    post("done", { ok: false, exit: 1, error: String(err && err.message || err), warnings: [] });
  }
};
