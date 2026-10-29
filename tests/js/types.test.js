// Project types: detection, run commands, Expo Snack payload, GitHub Actions generators, Python runner (stub Pyodide).
import test from "node:test";
import assert from "node:assert/strict";
import { detectType, runCommands, pythonEntry, snackPayload, snackUrl, pyinstallerWorkflow, easWorkflow, easConfig, reviewPrompt, TEMPLATES, TYPES,
  PYINSTALLER_WORKFLOW_PATH } from "../../docs/js/projecttypes.js";
import { runPythonProject, parseRequirements, driverCode, PROJECT_DIR, PYODIDE_URL } from "../../docs/js/pyrun.js";
import { dataUrlToBytes } from "../../docs/js/vfs.js";

test("detectType: prompts (Turkish and English)", () => {
  const cases = [
    ["kafe için rezervasyon sitesi yap", "web"],
    ["React ile kanban panosu", "react"],
    ["react native ile alışkanlık takip uygulaması", "reactnative"],
    ["Expo ile mobil uygulama yap", "reactnative"],
    ["iOS ve Android için not uygulaması", "reactnative"],
    ["Python ile harcama takip CLI aracı", "python"],
    ["pandas ile satış analizi", "python"],
    ["windows için exe üreten bir dosya düzenleyici", "python"],
    ["Linux için bash yedekleme betiği", "shell"],
    ["cron ile çalışan kabuk scripti", "shell"],
    ["Perl ile log analizörü", "perl"],
    ["PowerShell ile sistem raporu", "windows"],
    ["disk temizleyen bir .bat dosyası", "windows"],
    ["portfolyo sitesi", "web"],
    ["", "web"],
  ];
  for (const [p, want] of cases) assert.equal(detectType(p), want, p);
});

test("detectType: existing files win over the prompt", () => {
  assert.equal(detectType("renkleri değiştir", { "App.js": "x", "app.json": "{}", "package.json": "{}" }), "reactnative");
  assert.equal(detectType("bash ekle", { "main.py": "", "requirements.txt": "" }), "python");
  assert.equal(detectType("", { "run.ps1": "" }), "windows");
  assert.equal(detectType("", { "backup.sh": "" }), "shell");
  assert.equal(detectType("", { "log.pl": "" }), "perl");
  assert.equal(detectType("", { "index.html": '<script type="module">import React from "https://esm.sh/react@18.3.1"</script>' }), "react");
  assert.equal(detectType("python", { "index.html": "<h1>" }), "web");
});

test("templates cover every type and the original gallery", () => {
  const ids = TEMPLATES.map((t) => t.id);
  for (const id of ["landing", "shop", "blog", "dashboard", "todo", "game", "portfolio", "reservation"]) assert.ok(ids.includes(id), id);
  for (const type of Object.keys(TYPES)) assert.ok(TEMPLATES.some((t) => t.type === type), type);
  assert.match(reviewPrompt("shell"), /ShellCheck/);
});

test("runCommands: download-and-run instructions per type", () => {
  assert.deepEqual(runCommands("shell", { "backup.sh": "", "tests/test.sh": "", "README.md": "" }),
    ["chmod +x backup.sh tests/test.sh", "./backup.sh --help", "shellcheck backup.sh tests/test.sh"]);
  assert.deepEqual(runCommands("perl", { "log.pl": "", cpanfile: "", "t/basic.t": "" }), ["cpanm --installdeps .", "perl log.pl --help", "prove -l t"]);
  assert.deepEqual(runCommands("windows", { "scripts/report.ps1": "", "run.bat": "" }), ["powershell -ExecutionPolicy Bypass -File .\\scripts\\report.ps1", ".\\run.bat"]);
  assert.deepEqual(runCommands("python", { "main.py": "", "requirements.txt": "", "tests/test_x.py": "" }), ["pip install -r requirements.txt", "python main.py", "python -m pytest -q"]);
  assert.equal(pythonEntry({ "tests/test_a.py": "", "app.py": "" }), "app.py");
  assert.equal(pythonEntry({ "tool.py": "", "test_tool.py": "" }), "tool.py");
});

test("Snack: documented files/dependencies payload and URL", () => {
  const files = {
    "App.js": "import { Text } from 'react-native';\nexport default function App(){ return <Text>Merhaba</Text>; }\n",
    "src/screens/Home.js": "export default 1;",
    "package.json": JSON.stringify({ dependencies: { expo: "~52.0.0", react: "18.3.1", "react-native": "0.76.5", "@react-native-async-storage/async-storage": "1.23.1", "@react-navigation/native": "^7.0.0", lodash: "latest" } }),
    "app.json": JSON.stringify({ expo: { name: "Alışkanlık", slug: "aliskanlik" } }),
    "README.md": "# x",
    "assets/icon.png": "data:image/png;base64,AAAA",
    ".github/workflows/eas-build.yml": "name: x",
  };
  const p = snackPayload(files);
  assert.deepEqual(Object.keys(p.files).sort(), ["App.js", "app.json", "src/screens/Home.js"]);
  assert.deepEqual(p.files["App.js"], { type: "CODE", contents: files["App.js"] });
  assert.deepEqual(p.dependencies, ["@react-native-async-storage/async-storage@1.23.1", "@react-navigation/native@7.0.0", "lodash"]);
  assert.equal(p.sdkVersion, "52.0.0");
  assert.equal(p.params.name, "Alışkanlık");
  const url = snackUrl(files, { theme: "dark" });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://snack.expo.dev/");
  assert.deepEqual(JSON.parse(u.searchParams.get("files")), p.files);
  assert.equal(u.searchParams.get("dependencies"), p.dependencies.join(","));
  assert.equal(u.searchParams.get("sdkVersion"), "52.0.0");
  assert.equal(u.searchParams.get("platform"), "web");
  assert.equal(new URL(snackUrl(files, { embedded: true })).pathname, "/embedded");
  assert.equal(snackUrl({ "App.js": "x".repeat(20000) }), null, "too long for GET");
});

test("PyInstaller workflow: matrix windows/ubuntu/macos, artifacts, entry", () => {
  const y = pyinstallerWorkflow({ entry: "main.py", name: "Harcama Takip" });
  assert.equal(PYINSTALLER_WORKFLOW_PATH, ".github/workflows/build-binaries.yml");
  assert.match(y, /os: \[windows-latest, ubuntu-latest, macos-latest\]/);
  assert.match(y, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.match(y, /actions\/setup-python@v5/);
  assert.match(y, /pip install pyinstaller==6\.11\.1/);
  assert.match(y, /pyinstaller --onefile --clean --name "harcama-takip" "main\.py"/);
  assert.match(y, /actions\/upload-artifact@v4/);
  assert.match(y, /name: harcama-takip-\$\{\{ runner\.os \}\}/);
  assert.match(y, /path: dist\/\*/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /if \[ -f requirements\.txt \]; then pip install -r requirements\.txt; fi/);
  assert.ok(!/\t/.test(y), "YAML must not contain tabs");
  for (const line of y.split("\n")) assert.equal((line.match(/^ */)[0].length) % 2, 0, "even indentation: " + line);
});

test("EAS workflow and config", () => {
  const y = easWorkflow();
  assert.match(y, /expo\/expo-github-action@v8/);
  assert.match(y, /token: \$\{\{ secrets\.EXPO_TOKEN \}\}/);
  assert.match(y, /eas build --platform android --profile preview --non-interactive --no-wait/);
  assert.equal(JSON.parse(easConfig()).build.preview.android.buildType, "apk");
});

// ---------------------------------------------------------------- Python runner with a stub Pyodide
function stubPyodide({ failInstall = [], script } = {}) {
  const py = {
    fs: {}, dirs: [], installed: [], packages: [], code: [], io: {},
    FS: { mkdirTree: (d) => py.dirs.push(d), writeFile: (p, data) => { py.fs[p] = data; } },
    setStdout: (o) => { py.io.out = o.batched; },
    setStderr: (o) => { py.io.err = o.batched; },
    setStdin: (o) => { py.io.stdin = o.stdin; py.io.autoEOF = o.autoEOF; },
    loadPackage: async (n) => { py.packages.push(n); },
    pyimport: (n) => {
      assert.equal(n, "micropip");
      return { install: async (spec) => { if (failInstall.includes(spec)) throw new Error("no wheel"); py.installed.push(spec); } };
    },
    runPythonAsync: async (code) => {
      py.code.push(code);
      if (code.includes("shutil.rmtree")) return "ok";
      return script(py, code);
    },
  };
  return py;
}

test("pyrun: requirements parsing skips GUI/native packages", () => {
  const r = parseRequirements("# yorum\nrich==13.9.4\ntkinter\npygame>=2\nrequests[socks]>=2.31 ; python_version>'3.8'\n-r other.txt\npytest\nargparse\n");
  assert.deepEqual(r.install, ["rich==13.9.4", "requests[socks]>=2.31"]);
  assert.deepEqual(r.skipped, ["tkinter", "pygame"]);
  assert.match(PYODIDE_URL, /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v\d+\.\d+\.\d+\/full\/$/);
});

test("pyrun: run main.py — files written, deps installed, stdin fed, output streamed", async () => {
  const out = [], err = [], status = [];
  const py = stubPyodide({
    failInstall: ["rich==99.0"],
    script: (p, code) => {
      assert.match(code, /runpy\.run_path\("main\.py", run_name="__main__"\)/);
      assert.match(code, /sys\.argv = \["main\.py"\] \+ \["ozet","--ay","10"\]/);
      assert.ok(code.includes(JSON.stringify(PROJECT_DIR)));
      // simulate the program: two input() calls, then EOF
      const a = p.io.stdin(), b = p.io.stdin(), c = p.io.stdin();
      assert.deepEqual([a, b, c], ["Ayşe\n", "42\n", null]);
      p.io.out("Merhaba Ayşe, 42");
      return JSON.stringify({ ok: true, exit: 0, error: "" });
    },
  });
  const files = { "main.py": "print('x')\n", "app/core.py": "X = 1\n", "requirements.txt": "rich==99.0\ntkinter\n", "data/logo.png": "data:image/png;base64,iVBORw0KGgo=", ".github/workflows/b.yml": "x" };
  const res = await runPythonProject(py, files, { stdin: "Ayşe\n42\n", args: ["ozet", "--ay", "10"], onOut: (s) => out.push(s), onErr: (s) => err.push(s), onStatus: (s) => status.push(s) });
  assert.equal(res.ok, true);
  assert.equal(res.entry, "main.py");
  assert.equal(py.fs[PROJECT_DIR + "/main.py"], "print('x')\n");
  assert.equal(py.fs[PROJECT_DIR + "/app/core.py"], "X = 1\n");
  assert.deepEqual([...py.fs[PROJECT_DIR + "/data/logo.png"]], [...dataUrlToBytes(files["data/logo.png"])]);
  assert.ok(!Object.keys(py.fs).some((k) => k.includes(".github")));
  assert.ok(py.dirs.includes(PROJECT_DIR + "/app"));
  assert.deepEqual(py.packages, ["micropip"]);
  assert.deepEqual(py.installed, ["rich"], "pinned version failed -> retried unpinned");
  assert.deepEqual(out, ["Merhaba Ayşe, 42"]);
  assert.ok(err.some((s) => /tkinter/.test(s)), "unsupported package warned");
  assert.ok(res.warnings.some((w) => /EOF/.test(w)), "EOF warning when stdin runs out");
  assert.ok(status.some((s) => /main\.py/.test(s)));
});

test("pyrun: test mode installs pytest and reports failures", async () => {
  const py = stubPyodide({
    script: (p, code) => {
      assert.match(code, /pytest\.main\(\["-q", "-p", "no:cacheprovider", _target\]\)/);
      p.io.err("FAILED tests/test_core.py::test_x - AssertionError");
      return JSON.stringify({ ok: false, exit: 1, error: "Bazı testler başarısız (pytest çıkış kodu 1)" });
    },
  });
  const err = [];
  const res = await runPythonProject(py, { "main.py": "", "tests/test_core.py": "def test_x(): assert 0\n" }, { mode: "test", onErr: (s) => err.push(s) });
  assert.equal(res.ok, false);
  assert.equal(res.mode, "test");
  assert.deepEqual(py.installed, ["pytest"]);
  assert.match(err.join("\n"), /FAILED/);
});

test("pyrun: no entry file, driver code shape", async () => {
  const py = stubPyodide({ script: () => "{}" });
  const res = await runPythonProject(py, { "README.md": "x" });
  assert.equal(res.ok, false);
  assert.match(res.error, /main\.py/);
  const code = driverCode({ entry: "cli.py", mode: "run" });
  assert.match(code, /except SystemExit as e:/);
  assert.match(code, /traceback\.format_exc\(\)/);
  assert.match(code, /json\.dumps\(_res\)\s*$/);
});
