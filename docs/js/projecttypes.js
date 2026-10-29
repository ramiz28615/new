// Project types: detection, type-specific prompt rules, run modes, Snack payloads and CI workflow generators.
import { slugify } from "./vfs.js";

export const TYPES = {
  web: { label: "Web", icon: "🌐", runner: "preview", pages: true, entry: "index.html" },
  react: { label: "React", icon: "⚛️", runner: "preview", pages: true, entry: "index.html" },
  python: { label: "Python", icon: "🐍", runner: "python", pages: false, entry: "main.py" },
  shell: { label: "Bash / Linux", icon: "🐧", runner: "none", pages: false, entry: "" },
  perl: { label: "Perl", icon: "🐪", runner: "none", pages: false, entry: "" },
  windows: { label: "Windows (.bat / .ps1)", icon: "🪟", runner: "none", pages: false, entry: "" },
  reactnative: { label: "React Native (Expo)", icon: "📱", runner: "snack", pages: false, entry: "App.js" },
};
export const TYPE_IDS = Object.keys(TYPES);

const RULES = [
  ["reactnative", /react[\s-]?native|\bexpo\b|mobil uygulama|mobile app|ios (ve|and) android|android uygulama|iphone uygulama/i],
  ["windows", /powershell|\.ps1\b|\bps1\b|\.bat\b|\bbatch\b|\bcmd\b|windows (script|betiği|komut)|toplu iş dosyası/i],
  ["perl", /\bperl\b|\.pl\b/i],
  ["shell", /\bbash\b|\bshell\b|\bzsh\b|\.sh\b|kabuk|linux (script|betiği|komut)|cron|terminal (script|betiği)/i],
  ["python", /\bpython\b|\.py\b|pandas|numpy|pyinstaller|\bexe\b|komut satırı (uygulaması|aracı)|\bcli\b|telegram bot|discord bot|web scraper|kazıyıcı/i],
  ["react", /\breact\b|preact|\bjsx\b/i],
];

/** Guess the project type from a prompt (and existing files, when editing). */
export function detectType(prompt, files) {
  if (files && Object.keys(files).length) {
    const paths = Object.keys(files);
    if (paths.includes("app.json") && paths.some((p) => /^App\.(js|tsx?|jsx)$/.test(p))) return "reactnative";
    if (paths.some((p) => p.endsWith(".py")) && !paths.some((p) => p.endsWith(".html"))) return "python";
    if (paths.some((p) => /\.(ps1|bat|cmd)$/i.test(p))) return "windows";
    if (paths.some((p) => p.endsWith(".pl") || p.endsWith(".pm"))) return "perl";
    if (paths.some((p) => p.endsWith(".sh"))) return "shell";
    if (paths.some((p) => p.endsWith(".html"))) {
      const html = paths.filter((p) => p.endsWith(".html") || p.endsWith(".js")).map((p) => files[p]).join("\n");
      return /esm\.sh\/(react|preact)|from ["']react["']/.test(html) ? "react" : "web";
    }
  }
  const s = String(prompt || "");
  for (const [t, re] of RULES) if (re.test(s)) return t;
  return "web";
}

// ---------- type-specific system prompt sections ----------

const TYPE_PROMPTS = {
  web: `# PROJECT TYPE: WEB (static site / web app)
Follow the technical and design rules above. Entry file: index.html.`,

  react: `# PROJECT TYPE: REACT (no build step)
- index.html with an import map: {"imports":{"react":"https://esm.sh/react@18.3.1","react-dom/client":"https://esm.sh/react-dom@18.3.1/client","htm":"https://esm.sh/htm@3.1.1"}} and <script type="module" src="src/main.js"></script>.
- Components as ES modules in src/ (src/App.js, src/components/*.js). Use htm: const html = htm.bind(React.createElement); return html\`<div>…</div>\`. NO JSX, NO Babel, NO TypeScript, NO npm.
- Hooks (useState/useEffect/useReducer/useMemo), clean component structure, localStorage persistence where useful. Tailwind CDN or a styles.css is fine.`,

  python: `# PROJECT TYPE: PYTHON (command-line / library — no GUI)
Produce a professional, GUI-less Python 3.12 project:
- main.py (entry point with def main() and if __name__ == "__main__": main()), a package or modules for logic (e.g. app/ or src-free modules), requirements.txt (pin versions; only pure-Python PyPI packages or packages bundled with Pyodide such as numpy, pandas, matplotlib; network libraries like requests cannot reach the internet in the browser runner — prefer the standard library), tests/test_*.py written for pytest, README.md (Turkish: what it does, setup, usage examples, how to run tests), and .gitignore.
- The project runs in the browser with Pyodide: no tkinter/pygame/Qt/GUI, no subprocess, no threads requiring real OS, no network sockets. File I/O inside the working directory is OK. Use argparse with sensible defaults so "python main.py" works without arguments and demonstrates the features (print clear, nicely formatted output). If you read input(), keep it optional and handle EOFError gracefully (stdin may be empty).
- Type hints, docstrings, small functions, logging or clear error messages, no global state surprises.`,

  shell: `# PROJECT TYPE: BASH / LINUX SHELL
Produce professional, portable shell scripts:
- Scripts start with #!/usr/bin/env bash and set -Eeuo pipefail, use functions, quote every expansion, use [[ ]], local variables, trap for cleanup, a usage()/--help, getopts or long option parsing, meaningful exit codes, colored output only when stdout is a TTY, and dependency checks (command -v).
- Must pass ShellCheck with no warnings. Prefer POSIX tools available on Ubuntu and macOS (note GNU vs BSD differences).
- Include README.md (Turkish): purpose, requirements, installation (chmod +x), usage examples, cron example if relevant. Add a small tests/ script (bats-style or plain bash asserts) when it makes sense.`,

  perl: `# PROJECT TYPE: PERL
Produce modern Perl 5 scripts:
- #!/usr/bin/env perl, use strict; use warnings; use utf8; Getopt::Long + Pod::Usage with POD documentation (--help), core modules only unless necessary (list any CPAN deps in cpanfile), clear error handling (die with messages, eval), lexical filehandles, 3-arg open.
- README.md (Turkish): purpose, requirements, usage examples. Add t/*.t tests with Test::More when useful.`,

  windows: `# PROJECT TYPE: WINDOWS SCRIPTS (.ps1 PowerShell and/or .bat)
Produce professional Windows automation:
- PowerShell 5.1+ compatible .ps1 with [CmdletBinding()], a param() block with validation, comment-based help (.SYNOPSIS/.DESCRIPTION/.EXAMPLE), Set-StrictMode -Version Latest, $ErrorActionPreference = 'Stop', try/catch, Write-Verbose, approved verbs, and safe defaults (-WhatIf support via SupportsShouldProcess for destructive actions).
- When a .bat is requested, use @echo off, setlocal EnableExtensions EnableDelayedExpansion, chcp 65001 for UTF-8, quoted paths, errorlevel checks; optionally a .bat launcher that calls the .ps1 with -ExecutionPolicy Bypass.
- README.md (Turkish): purpose, requirements, how to run (including execution policy notes), examples.`,

  reactnative: `# PROJECT TYPE: REACT NATIVE (Expo)
Produce an Expo SDK project that runs in Expo Snack and Expo Go:
- App.js (entry, default export), components in src/ (src/components/*.js, src/screens/*.js), package.json (name, main "expo/AppEntry" is NOT needed; include "dependencies" with expo, react, react-native and any extra libs using versions compatible with the latest Expo SDK), app.json (expo.name, slug, version, orientation, userInterfaceStyle "automatic", ios.bundleIdentifier, android.package), babel.config.js (preset babel-preset-expo), README.md (Turkish: Snack/Expo Go usage, npx expo start, EAS build).
- JavaScript (not TypeScript). Use only libraries available in Snack: expo-* modules, @react-navigation/native + native-stack (with react-native-screens and react-native-safe-area-context), @expo/vector-icons, AsyncStorage (@react-native-async-storage/async-storage).
- Polished mobile UI: SafeAreaView, StatusBar, StyleSheet, consistent theme, light/dark support, touch feedback (Pressable), FlatList for lists, KeyboardAvoidingView for forms, accessibilityLabel on controls.`,
};

export function typePrompt(type) { return TYPE_PROMPTS[type] || TYPE_PROMPTS.web; }

// ---------- review ("İncele") prompts ----------

export function reviewPrompt(type) {
  const what = {
    shell: "Review all shell scripts like ShellCheck would (quoting, word splitting, unset variables, pipefail, portability, error handling, security).",
    perl: "Review all Perl code like Perl::Critic would (strict/warnings, error handling, open/close, input validation, portability).",
    windows: "Review all PowerShell/batch code like PSScriptAnalyzer would (approved verbs, error handling, quoting, ShouldProcess, encoding).",
    python: "Review the Python code like ruff/pyflakes/mypy would (bugs, unused code, typing, error handling, tests coverage).",
    reactnative: "Review the Expo/React Native code (runtime errors, hooks rules, Snack-compatible deps, accessibility, performance).",
  }[type] || "Review the code for bugs, accessibility issues, responsive layout problems and console errors.";
  return what + " First list the findings as a short Turkish bullet list (max 8), then output the fixed files using the file protocol. If nothing needs fixing, say so and output no files.";
}

// ---------- non-runnable types: how to run locally ----------

export function runCommands(type, files) {
  const paths = Object.keys(files || {});
  const pick = (re) => paths.filter((p) => re.test(p));
  const out = [];
  if (type === "shell") {
    const sh = pick(/\.sh$/);
    if (sh.length) out.push("chmod +x " + sh.map(q).join(" "));
    for (const s of sh.filter((p) => !/^tests?\//.test(p)).slice(0, 3)) out.push("./" + s + " --help");
    out.push("shellcheck " + (sh.length ? sh.map(q).join(" ") : "*.sh"));
  } else if (type === "perl") {
    const pl = pick(/\.pl$/);
    for (const s of pl.slice(0, 3)) out.push("perl " + q(s) + " --help");
    if (paths.includes("cpanfile")) out.unshift("cpanm --installdeps .");
    if (pick(/^t\/.*\.t$/).length) out.push("prove -l t");
  } else if (type === "windows") {
    for (const s of pick(/\.ps1$/i).slice(0, 3)) out.push("powershell -ExecutionPolicy Bypass -File .\\" + s.replace(/\//g, "\\"));
    for (const s of pick(/\.(bat|cmd)$/i).slice(0, 3)) out.push(".\\" + s.replace(/\//g, "\\"));
  } else if (type === "python") {
    if (paths.includes("requirements.txt")) out.push("pip install -r requirements.txt");
    out.push("python " + (pythonEntry(files) || "main.py"));
    if (pick(/^tests?\/.*\.py$/).length) out.push("python -m pytest -q");
  } else if (type === "reactnative") {
    out.push("npm install", "npx expo start");
  }
  return out;
}
function q(p) { return /[\s'"$]/.test(p) ? "'" + p.replace(/'/g, "'\\''") + "'" : p; }

export function pythonEntry(files) {
  const paths = Object.keys(files || {});
  for (const c of ["main.py", "app.py", "__main__.py", "cli.py"]) if (paths.includes(c)) return c;
  return paths.find((p) => p.endsWith(".py") && !p.includes("/") && !/^test_/.test(p)) || paths.find((p) => p.endsWith(".py") && !/test/.test(p)) || "";
}

// ---------- Expo Snack ----------

const SNACK_BUILTIN = new Set(["expo", "react", "react-native", "react-dom", "react-native-web", "expo-status-bar"]);

/** Build the documented Snack `files` object + dependency list from a project. */
export function snackPayload(files, name = "Kovan") {
  const sfiles = {};
  for (const [p, c] of Object.entries(files)) {
    if (p === "package.json" || p.startsWith(".github/") || /^(README|LICENSE)/i.test(p) || p === "eas.json") continue;
    if (/^data:/.test(c)) continue; // binary assets cannot be inlined (Snack ASSETs must be URLs)
    if (!/\.(js|jsx|ts|tsx|json|md)$/.test(p)) continue;
    sfiles[p] = { type: "CODE", contents: String(c) };
  }
  let deps = [], sdkVersion = "";
  try {
    const pkg = JSON.parse(files["package.json"] || "{}");
    for (const [k, v] of Object.entries(pkg.dependencies || {})) {
      if (SNACK_BUILTIN.has(k)) continue;
      const ver = String(v).replace(/^[~^>=<\s]+/, "");
      deps.push(/^\d/.test(ver) ? k + "@" + ver : k);
    }
    const ev = (pkg.dependencies || {}).expo;
    const m = ev && /(\d+)\./.exec(String(ev));
    if (m) sdkVersion = m[1] + ".0.0";
  } catch (e) { deps = []; }
  try {
    const app = JSON.parse(files["app.json"] || "{}");
    if (app.expo && app.expo.name) name = app.expo.name;
  } catch (e) { /* ignore */ }
  const params = { name, description: "Kovan Studio ile oluşturuldu", files: JSON.stringify(sfiles), dependencies: deps.join(","), platform: "web", supportedPlatforms: "mydevice,ios,android,web" };
  if (sdkVersion) params.sdkVersion = sdkVersion;
  return { files: sfiles, dependencies: deps, sdkVersion, params };
}

/** URL (documented query parameters) for opening or embedding a Snack. Returns null when too long for a GET. */
export function snackUrl(files, { embedded = false, theme = "dark", maxLength = 7500, name } = {}) {
  const { params } = snackPayload(files, name);
  const qs = Object.entries({ ...params, theme, preview: "true" }).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const url = "https://snack.expo.dev/" + (embedded ? "embedded" : "") + "?" + qs;
  return url.length <= maxLength ? url : null;
}

// ---------- GitHub Actions generators ----------

export const PYINSTALLER_WORKFLOW_PATH = ".github/workflows/build-binaries.yml";
export const EAS_WORKFLOW_PATH = ".github/workflows/eas-build.yml";

/** GitHub Actions workflow that builds a one-file executable with PyInstaller on Windows, Linux and macOS. */
export function pyinstallerWorkflow({ entry = "main.py", name = "app", python = "3.12" } = {}) {
  const bin = slugify(name, "app");
  return `name: İkili dosyaları üret (PyInstaller)

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    name: \${{ matrix.os }}
    runs-on: \${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "${python}"
      - name: Bağımlılıkları kur
        shell: bash
        run: |
          python -m pip install --upgrade pip
          if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
          pip install pyinstaller==6.11.1
      - name: PyInstaller ile derle
        shell: bash
        run: pyinstaller --onefile --clean --name "${bin}" "${entry}"
      - name: Çalıştırılabilir dosyayı yükle
        uses: actions/upload-artifact@v4
        with:
          name: ${bin}-\${{ runner.os }}
          path: dist/*
          if-no-files-found: error
`;
}

/** GitHub Actions workflow for EAS Build (needs the EXPO_TOKEN repository secret). */
export function easWorkflow({ platform = "android", profile = "preview" } = {}) {
  return `name: EAS Build (Expo)

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: EXPO_TOKEN kontrolü
        run: |
          if [ -z "\${{ secrets.EXPO_TOKEN }}" ]; then
            echo "EXPO_TOKEN gizli anahtarı yok. Depo > Settings > Secrets and variables > Actions bölümünden ekleyin."
            exit 1
          fi
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: \${{ secrets.EXPO_TOKEN }}
      - run: npm install
      - run: eas build --platform ${platform} --profile ${profile} --non-interactive --no-wait
`;
}

export function easConfig() {
  return JSON.stringify({ cli: { version: ">= 12.0.0" }, build: { preview: { distribution: "internal", android: { buildType: "apk" } }, production: {} } }, null, 2) + "\n";
}

// ---------- templates gallery ----------

export const TEMPLATES = [
  { id: "landing", type: "web", icon: "🚀", title: "Açılış sayfası", prompt: "Yapay zekâ destekli bir not alma uygulaması için modern bir açılış sayfası yap: hero, özellikler, fiyatlandırma (3 paket), müşteri yorumları, SSS akordeonu, e-posta kayıt formu ve footer. Koyu tema, mor-turuncu gradyan." },
  { id: "shop", type: "web", icon: "🛍️", title: "E-ticaret", prompt: "El yapımı seramik satan bir mağaza için e-ticaret sitesi yap: ürün listesi, kategori ve fiyat filtresi, arama, ürün detay modali, sepete ekle, sepet çekmecesi (adet artır/azalt, toplam ₺), localStorage ile kalıcı sepet ve sahte ödeme adımı." },
  { id: "blog", type: "web", icon: "✍️", title: "Blog", prompt: "Seyahat yazıları için çok sayfalı bir blog yap: index.html (öne çıkan yazı + yazı kartları + etiket filtresi), post.html (okuma süresi, içindekiler), about.html. Okunaklı tipografi, açık/koyu tema düğmesi." },
  { id: "dashboard", type: "web", icon: "📊", title: "Dashboard", prompt: "Bir SaaS için yönetim paneli yap: kenar menü, KPI kartları, Chart.js ile gelir ve kullanıcı grafikleri, sıralanabilir ve aranabilir müşteri tablosu, bildirimler, mobilde açılır menü." },
  { id: "todo", type: "web", icon: "✅", title: "Todo uygulaması", prompt: "Gelişmiş bir yapılacaklar uygulaması yap: görev ekle/düzenle/sil, öncelik ve son tarih, filtreler (tümü/aktif/biten), sürükle-bırak sıralama, localStorage, klavye kısayolları ve boş durum ekranı." },
  { id: "game", type: "web", icon: "🎮", title: "Oyun", prompt: "Canvas ile tarayıcıda oynanan bir 'yılan' oyunu yap: başlangıç ekranı, skor ve en yüksek skor (localStorage), hız seviyeleri, dokunmatik kaydırma kontrolü (mobil), duraklat ve ses aç/kapa." },
  { id: "portfolio", type: "web", icon: "🎨", title: "Portfolyo", prompt: "Bir ürün tasarımcısı için portfolyo sitesi yap: etkileyici hero, filtrelenebilir proje galerisi, proje detay modali, hakkımda, beceriler, iletişim formu (doğrulamalı). Minimal ve zarif." },
  { id: "reservation", type: "web", icon: "☕", title: "Rezervasyon", prompt: "Bir kafe için rezervasyon sitesi yap: menü bölümü, tarih-saat-kişi sayısı seçimli rezervasyon formu (doğrulama, uygun saatler), rezervasyonlarımı görüntüle/iptal et (localStorage), konum ve çalışma saatleri. Sıcak, davetkâr tasarım." },
  { id: "kanban", type: "react", icon: "⚛️", title: "React Kanban", prompt: "React (htm, build yok) ile bir Kanban panosu yap: sütunlar, kart ekle/düzenle, sürükle-bırak, etiketler, arama, localStorage." },
  { id: "py-cli", type: "python", icon: "🐍", title: "Python CLI", prompt: "Python ile bir harcama takip komut satırı aracı yap: harcama ekle, kategoriye göre özet, aylık rapor (tablo halinde), JSON dosyasında saklama, argparse alt komutları ve pytest testleri." },
  { id: "py-data", type: "python", icon: "📈", title: "Python veri analizi", prompt: "Python ile örnek satış verisini (kod içinde üretilen CSV) analiz eden bir proje yap: pandas ile aylık toplamlar, en çok satan ürünler, büyüme oranı; sonuçları düzenli tablo olarak yazdır; testler ekle." },
  { id: "bash-backup", type: "shell", icon: "🐧", title: "Bash yedekleme", prompt: "Linux için bir yedekleme betiği yap: belirtilen klasörleri tarih damgalı tar.gz olarak yedekle, eski yedekleri N günden sonra sil, --dry-run, log dosyası, cron örneği ve README." },
  { id: "perl-log", type: "perl", icon: "🐪", title: "Perl log analizi", prompt: "Perl ile bir Nginx erişim logu analizörü yap: en çok istek yapan IP'ler, durum kodu dağılımı, en yavaş URL'ler, tarih aralığı filtresi, --help (POD) ve testler." },
  { id: "ps-sysinfo", type: "windows", icon: "🪟", title: "PowerShell araç", prompt: "Windows için bir PowerShell betiği yap: sistem bilgisi raporu (CPU, RAM, disk, ağ), HTML rapor çıktısı, geçici dosya temizliği (-WhatIf destekli) ve betiği çalıştıran bir .bat başlatıcı." },
  { id: "rn-habits", type: "reactnative", icon: "📱", title: "Mobil alışkanlık", prompt: "React Native (Expo) ile bir alışkanlık takip uygulaması yap: alışkanlık ekle, günlük işaretle, seri (streak) sayacı, haftalık görünüm, AsyncStorage ile kalıcılık, açık/koyu tema." },
];
