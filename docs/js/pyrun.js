// Run a multi-file Python project inside Pyodide: write files to the in-memory FS, install requirements with micropip,
// feed pre-supplied stdin lines, run main.py (or pytest) and report the result. Pure logic: works with a stub Pyodide in tests.
import { isDataUrl, dataUrlToBytes } from "./vfs.js";
import { pythonEntry } from "./projecttypes.js";

export const PYODIDE_VERSION = "0.26.4";
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PROJECT_DIR = "/home/pyodide/kovan_project";

/** Packages that cannot work in the browser (GUI, native extensions not in Pyodide, OS access). */
export const UNSUPPORTED = new Set([
  "tkinter", "tk", "pygame", "pyqt5", "pyqt6", "pyside2", "pyside6", "kivy", "wxpython", "pyautogui", "pynput", "keyboard", "mouse",
  "psycopg2", "psycopg2-binary", "mysqlclient", "pyinstaller", "selenium", "playwright", "torch", "tensorflow", "opencv-python",
  "uvloop", "gunicorn", "uwsgi", "pywin32", "pyaudio", "dbus-python", "psutil",
]);
const STDLIB_NAMES = new Set(["argparse", "json", "os", "sys", "re", "dataclasses", "typing", "pathlib", "datetime", "collections", "itertools", "logging", "unittest", "csv", "sqlite3", "random", "math", "statistics", "asyncio"]);

/** Parse requirements.txt into { install: [...specs], skipped: [...names] }. */
export function parseRequirements(text) {
  const install = [], skipped = [];
  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    const name = line.split(/[\s<>=!~;\[]/)[0].toLowerCase();
    if (!name) continue;
    if (UNSUPPORTED.has(name)) { skipped.push(name); continue; }
    if (STDLIB_NAMES.has(name) || name === "pytest") continue;
    // micropip understands "pkg==1.2"; drop environment markers and extras it may not support
    install.push(line.split(";")[0].trim());
  }
  return { install, skipped };
}

/** Python driver executed inside Pyodide. Returns a JSON string with the outcome. */
export function driverCode({ entry, mode, dir = PROJECT_DIR, args = [] }) {
  return `
import sys, os, json, runpy, traceback
_d = ${JSON.stringify(dir)}
os.chdir(_d)
if _d not in sys.path:
    sys.path.insert(0, _d)
for _m in [k for k, v in list(sys.modules.items()) if getattr(v, "__file__", None) and str(v.__file__).startswith(_d)]:
    del sys.modules[_m]
_res = {"ok": True, "exit": 0, "error": ""}
sys.argv = [${JSON.stringify(entry || "main.py")}] + ${JSON.stringify(args)}
try:
    if ${JSON.stringify(mode)} == "test":
        import pytest
        _target = "tests" if os.path.isdir("tests") else "."
        _code = int(pytest.main(["-q", "-p", "no:cacheprovider", _target]))
        _res["exit"] = _code
        _res["ok"] = _code in (0, 5)
        if _code == 5:
            _res["error"] = "Test bulunamadı"
        elif _code != 0:
            _res["error"] = "Bazı testler başarısız (pytest çıkış kodu %d)" % _code
    else:
        runpy.run_path(${JSON.stringify(entry || "main.py")}, run_name="__main__")
except SystemExit as e:
    _c = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    _res["exit"] = _c
    _res["ok"] = _c == 0
    if _c != 0 and not isinstance(e.code, int) and e.code is not None:
        print(str(e.code), file=sys.stderr)
except BaseException as e:
    _tb = traceback.format_exc()
    print(_tb, file=sys.stderr)
    _res["ok"] = False
    _res["exit"] = 1
    _res["error"] = _tb.strip().splitlines()[-1] if _tb.strip() else repr(e)
finally:
    sys.stdout.flush(); sys.stderr.flush()
json.dumps(_res)
`;
}

function rmTreeCode(dir) {
  return `import shutil, os\nshutil.rmtree(${JSON.stringify(dir)}, ignore_errors=True)\nos.makedirs(${JSON.stringify(dir)}, exist_ok=True)\n"ok"`;
}

/**
 * @param {object} py  a loaded Pyodide instance (or stub)
 * @param {Record<string,string>} files
 * @param {{mode?:"run"|"test", entry?:string, stdin?:string, args?:string[], onOut?:(s:string)=>void, onErr?:(s:string)=>void, onStatus?:(s:string)=>void}} o
 */
export async function runPythonProject(py, files, o = {}) {
  const out = o.onOut || (() => {}), err = o.onErr || (() => {}), status = o.onStatus || (() => {});
  const mode = o.mode === "test" ? "test" : "run";
  const entry = o.entry || pythonEntry(files);
  if (mode === "run" && !entry) return { ok: false, exit: 1, error: "Çalıştırılacak .py dosyası yok (main.py bekleniyor).", warnings: [] };
  const warnings = [];

  // stdout / stderr / stdin
  py.setStdout({ batched: (s) => out(s) });
  py.setStderr({ batched: (s) => err(s) });
  const lines = String(o.stdin || "").split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let li = 0, eofWarned = false;
  py.setStdin({
    stdin: () => {
      if (li < lines.length) return lines[li++] + "\n";
      if (!eofWarned) { eofWarned = true; warnings.push("Program girdi (input) istedi ama stdin kutusu boş/bitti; EOF gönderildi."); }
      return null;
    },
    autoEOF: true,
  });

  // files
  status("Dosyalar hazırlanıyor…");
  await py.runPythonAsync(rmTreeCode(PROJECT_DIR));
  for (const [p, c] of Object.entries(files)) {
    if (p.startsWith(".github/")) continue;
    const full = PROJECT_DIR + "/" + p;
    const dir = full.slice(0, full.lastIndexOf("/"));
    py.FS.mkdirTree(dir);
    py.FS.writeFile(full, isDataUrl(c) ? dataUrlToBytes(c) : String(c));
  }

  // dependencies
  const req = parseRequirements(files["requirements.txt"]);
  if (req.skipped.length) warnings.push("Tarayıcıda çalışmayan paketler atlandı: " + req.skipped.join(", ") + ". Bu kısımlar için projeyi indirip bilgisayarında çalıştır.");
  const toInstall = [...req.install];
  if (mode === "test") toInstall.push("pytest");
  if (toInstall.length) {
    status("Paketler kuruluyor: " + toInstall.join(", "));
    await py.loadPackage("micropip");
    const micropip = py.pyimport("micropip");
    for (const spec of toInstall) {
      try { await micropip.install(spec); }
      catch (e) {
        // retry without the version pin (Pyodide ships its own builds of some packages)
        const bare = spec.split(/[<>=!~\s]/)[0];
        try {
          if (bare !== spec) { await micropip.install(bare); warnings.push(spec + " yerine " + bare + " (uyumlu sürüm) kuruldu."); }
          else throw e;
        } catch (e2) {
          warnings.push(spec + " kurulamadı (saf Python değil ya da Pyodide'de yok).");
        }
      }
    }
  }
  for (const w of warnings) err("⚠ " + w);

  status(mode === "test" ? "Testler çalışıyor…" : entry + " çalışıyor…");
  const raw = await py.runPythonAsync(driverCode({ entry, mode, args: o.args || [] }));
  let res;
  try { res = JSON.parse(String(raw)); } catch (e) { res = { ok: false, exit: 1, error: "Python sonucu okunamadı" }; }
  return { ...res, entry, mode, warnings, installed: toInstall };
}
