// Code editor: CodeMirror 5 (pinned, lazy-loaded from cdnjs) with a plain <textarea> fallback.
import { ext } from "./vfs.js";

const CM = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/";
const SCRIPTS = ["codemirror.min.js"];
const PLUGINS = ["mode/xml/xml.min.js", "mode/javascript/javascript.min.js", "mode/css/css.min.js", "mode/htmlmixed/htmlmixed.min.js",
  "mode/markdown/markdown.min.js", "mode/python/python.min.js", "mode/shell/shell.min.js", "mode/perl/perl.min.js",
  "mode/powershell/powershell.min.js", "mode/yaml/yaml.min.js", "addon/edit/closebrackets.min.js", "addon/edit/matchbrackets.min.js",
  "addon/fold/xml-fold.min.js", "addon/edit/closetag.min.js"];

function loadScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous";
    s.onload = ok; s.onerror = () => no(new Error("yüklenemedi: " + src));
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href; l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}
let cmPromise = null;
export function loadCodeMirror() {
  if (window.CodeMirror) return Promise.resolve(window.CodeMirror);
  if (!cmPromise) {
    loadCss(CM + "codemirror.min.css");
    cmPromise = loadScript(CM + SCRIPTS[0])
      .then(() => Promise.all(PLUGINS.slice(0, 2).map((p) => loadScript(CM + p))))
      .then(() => Promise.all(PLUGINS.slice(2).map((p) => loadScript(CM + p).catch(() => null))))
      .then(() => window.CodeMirror);
    cmPromise.catch(() => { cmPromise = null; });
  }
  return cmPromise;
}

export function modeFor(path) {
  const e = ext(path);
  return ({ html: "htmlmixed", htm: "htmlmixed", svg: "xml", xml: "xml", css: "css", js: "javascript", mjs: "javascript", jsx: "javascript",
    json: { name: "javascript", json: true }, md: "markdown", py: "python", sh: "shell", bash: "shell", pl: "perl", pm: "perl", t: "perl",
    ps1: "powershell", psm1: "powershell", yml: "yaml", yaml: "yaml", txt: null, bat: null, cmd: null })[e] ?? null;
}

/**
 * Create an editor in `host`. Returns { set(path, value, readOnly), get(), focus(), refresh(), isCM }.
 */
export function createEditor(host, { onChange } = {}) {
  const ta = document.createElement("textarea");
  ta.className = "kv-code"; ta.spellcheck = false; ta.setAttribute("aria-label", "Kod düzenleyici");
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocomplete", "off");
  host.appendChild(ta);
  let cm = null, silent = false, path = "";
  ta.addEventListener("input", () => { if (!silent && onChange) onChange(ta.value); });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !ta._escaped) {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText("  ", s, en, "end");
      if (onChange) onChange(ta.value);
    }
    ta._escaped = e.key === "Escape";
  });

  const api = {
    isCM: false,
    set(p, value, readOnly = false) {
      path = p;
      silent = true;
      if (cm) {
        if (cm.getValue() !== value) {
          const scroll = cm.getScrollInfo();
          cm.setValue(value);
          if (readOnly) cm.scrollTo(0, cm.getScrollInfo().height); else cm.scrollTo(scroll.left, scroll.top);
        }
        cm.setOption("mode", modeFor(p));
        cm.setOption("readOnly", readOnly ? "nocursor" : false);
      } else {
        if (ta.value !== value) ta.value = value;
        ta.readOnly = readOnly;
        if (readOnly) ta.scrollTop = ta.scrollHeight;
      }
      silent = false;
    },
    get() { return cm ? cm.getValue() : ta.value; },
    focus() { (cm || ta).focus(); },
    refresh() { if (cm) cm.refresh(); },
  };

  loadCodeMirror().then((CodeMirror) => {
    if (!CodeMirror || cm) return;
    const value = ta.value, ro = ta.readOnly;
    cm = CodeMirror((el) => host.replaceChild(el, ta), {
      value, mode: modeFor(path), lineNumbers: true, lineWrapping: false, tabSize: 2, indentUnit: 2, indentWithTabs: false,
      autoCloseBrackets: true, matchBrackets: true, autoCloseTags: true, readOnly: ro ? "nocursor" : false,
      inputStyle: "contenteditable", viewportMargin: 50,
      extraKeys: { Tab: (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("  ", "end")), "Shift-Tab": (c) => c.indentSelection("subtract") },
    });
    cm.on("change", () => { if (!silent && onChange) onChange(cm.getValue()); });
    api.isCM = true;
  }).catch(() => { /* textarea fallback stays */ });
  return api;
}
