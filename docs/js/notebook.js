// Not Defteri: real Python via Pyodide (main thread), loaded on first open. Ported from Kovan Studio 0.2.
import { PYODIDE_URL } from "./pyrun.js";

export function initNotebook() {
        var $ = function (id) { return document.getElementById(id); };
        var nb = $("nb"), py = null, booting = null, count = 0, cur = null, queue = Promise.resolve();
        var PRELUDE = [
          "import os", "os.environ['MPLBACKEND'] = 'Agg'", "from pyodide.code import eval_code_async",
          "def show():", "    import io, base64, matplotlib", "    matplotlib.use('Agg')", "    import matplotlib.pyplot as plt",
          "    buf = io.BytesIO()", "    plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)", "    plt.close('all')",
          "    print('__KVIMG__' + base64.b64encode(buf.getvalue()).decode() + '__')",
          "async def _kv_run(src):", "    r = await eval_code_async(src, globals())", "    if r is None: return None", "    globals()['_'] = r",
          "    h = getattr(r, '_repr_html_', None)", "    if callable(h):", "        try:", "            v = h()", "            if v: return ['html', v]",
          "        except Exception: pass", "    return ['text', repr(r)]"
        ].join("\n");
        function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
        function status(t, ok) { $("pystat").textContent = t; $("pystat").classList.toggle("chip--solid", !!ok); }

        function boot() {
          if (booting) return booting;
          status("Python yükleniyor…");
          booting = new Promise(function (ok, no) {
            var s = document.createElement("script");
            s.src = PYODIDE_URL + "pyodide.js";
            s.onload = ok; s.onerror = function () { no(new Error("Pyodide indirilemedi")); };
            document.head.appendChild(s);
          }).then(function () { return window.loadPyodide({ indexURL: PYODIDE_URL }); }).then(function (p) {
            py = p;
            p.setStdout({ batched: function (s) { write(s, ""); } });
            p.setStderr({ batched: function (s) { write(s, "e"); } });
            return p.runPythonAsync(PRELUDE);
          }).then(function () { status("Python hazır", true); return py; },
            function (e) { status("Python yüklenemedi"); booting = null; throw e; });
          return booting;
        }

        function write(s, cls, el) {
          el = el || cur; if (!el) return;
          var m = /^__KVIMG__([A-Za-z0-9+\/=]+)__$/.exec(s);
          if (m) { var img = document.createElement("img"); img.alt = "Matplotlib grafiği"; img.src = "data:image/png;base64," + m[1]; el.appendChild(img); return; }
          var pre = el.lastElementChild;
          if (!pre || pre.tagName !== "PRE") { pre = document.createElement("pre"); el.appendChild(pre); }
          var sp = document.createElement("span"); if (cls) sp.className = cls; sp.textContent = s + "\n"; pre.appendChild(sp);
        }
        function trimTb(msg) {
          var l = msg.split("\n"), i = l.findIndex(function (x) { return x.indexOf('File "<exec>"') > -1; });
          return (i > 0 ? [l[0]].concat(l.slice(i)) : l).join("\n").trim();
        }

        function inline(s) { return s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }
        function md(src) {
          var h = "", list = false;
          src.split("\n").forEach(function (l) {
            var m = /^\s*[-*] (.*)/.exec(l);
            if (m) { if (!list) { h += "<ul>"; list = true; } h += "<li>" + inline(esc(m[1])) + "</li>"; return; }
            if (list) { h += "</ul>"; list = false; }
            if ((m = /^(#{1,3}) (.*)/.exec(l))) { var n = m[1].length + 1; h += "<h" + n + ">" + inline(esc(m[2])) + "</h" + n + ">"; }
            else if (l.trim()) h += "<p>" + inline(esc(l)) + "</p>";
          });
          return h + (list ? "</ul>" : "");
        }
        function renderMd(c, on) {
          var ta = c.querySelector(".x-src"), v = c.querySelector(".x-md");
          if (on) v.innerHTML = md(ta.value) || "<p class='x-st'>Boş metin. Düzenlemek için çift tıkla.</p>";
          ta.hidden = on; v.hidden = !on;
          if (!on) ta.focus();
        }
        function size(ta) { ta.rows = Math.max(2, ta.value.split("\n").length); }

        function add(type, src, after) {
          var c = document.createElement("div"), code = type === "code";
          c.className = "x-cell"; c._t = type;
          c.innerHTML = '<span class="x-cnt">' + (code ? "[ ]" : "") + '</span><div>' +
            '<textarea class="x-src" spellcheck="false" aria-label="' + (code ? "Kod hücresi" : "Metin hücresi") + '"></textarea>' +
            (code ? '<div class="x-out" aria-live="polite"></div>' : '<div class="x-md" tabindex="0" title="Düzenlemek için çift tıkla" hidden></div>') + '</div>' +
            '<div class="x-tools"><button class="x-ib" data-a="run" title="Shift+Enter">Çalıştır</button><button class="x-ib" data-a="up" aria-label="Yukarı taşı">↑</button>' +
            '<button class="x-ib" data-a="down" aria-label="Aşağı taşı">↓</button><button class="x-ib" data-a="del" aria-label="Hücreyi sil">×</button></div>';
          var ta = c.querySelector(".x-src"); ta.value = src || ""; size(ta);
          if (after && after.parentNode === nb) nb.insertBefore(c, after.nextSibling); else nb.appendChild(c);
          if (!code && src) renderMd(c, true);
          return c;
        }

        async function exec(c) {
          if (c._t === "md") return renderMd(c, true);
          var out = c.querySelector(".x-out"), cnt = c.querySelector(".x-cnt"), src = c.querySelector(".x-src").value;
          out.innerHTML = ""; cnt.textContent = "[*]";
          try {
            await boot();
            await py.loadPackagesFromImports(src);
            cur = out;
            var fn = py.globals.get("_kv_run"), r = await fn(src); fn.destroy();
            if (r) {
              var v = r.toJs(); r.destroy();
              var d = document.createElement(v[0] === "html" ? "div" : "pre");
              if (v[0] === "html") d.innerHTML = v[1]; else d.textContent = v[1];
              out.appendChild(d);
            }
          } catch (e) { write(trimTb(String(e && e.message || e)), "e", out); }
          finally { cur = null; c._n = ++count; cnt.textContent = "[" + count + "]"; }
        }
        function run(c) { queue = queue.then(function () { return exec(c); }); return queue; }

        nb.addEventListener("click", function (e) {
          var b = e.target.closest("[data-a]"); if (!b) return;
          var c = b.closest(".x-cell"), a = b.dataset.a;
          if (a === "run") run(c);
          else if (a === "up" && c.previousElementSibling) nb.insertBefore(c, c.previousElementSibling);
          else if (a === "down" && c.nextElementSibling) nb.insertBefore(c.nextElementSibling, c);
          else if (a === "del") c.remove();
          if (a === "up" || a === "down") b.focus();
        });
        nb.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          var c = e.target.closest(".x-cell");
          if (e.target.classList.contains("x-md")) { e.preventDefault(); return renderMd(c, false); }
          if (!e.shiftKey || !e.target.classList.contains("x-src")) return;
          e.preventDefault(); run(c);
          var n = c.nextElementSibling || add("code", "", c), t = n.querySelector(".x-src");
          (t.hidden ? n.querySelector(".x-md") : t).focus();
        });
        nb.addEventListener("dblclick", function (e) { var m = e.target.closest(".x-md"); if (m) renderMd(m.closest(".x-cell"), false); });
        nb.addEventListener("input", function (e) { if (e.target.classList.contains("x-src")) size(e.target); });

        function focused() { return document.activeElement && document.activeElement.closest && document.activeElement.closest(".x-cell"); }
        $("nb-code").addEventListener("click", function () { add("code", "", focused()).querySelector(".x-src").focus(); });
        $("nb-md").addEventListener("click", function () { renderMd(add("md", "", focused()), false); });
        $("nb-all").addEventListener("click", function () { [].forEach.call(nb.children, run); });
        $("nb-clear").addEventListener("click", function () {
          nb.querySelectorAll(".x-out").forEach(function (o) { o.innerHTML = ""; });
          nb.querySelectorAll(".x-cell").forEach(function (c) { if (c._t === "code") { c._n = null; c.querySelector(".x-cnt").textContent = "[ ]"; } });
        });
        $("nb-pkg").addEventListener("click", async function () {
          var b = this; b.disabled = true;
          try { await boot(); status("Paketler yükleniyor…"); await py.loadPackage(["numpy", "pandas", "matplotlib"]); status("Python hazır · numpy, pandas, matplotlib", true); }
          catch (e) { status("Paket yüklenemedi"); }
          b.disabled = false;
        });
        $("nb-dl").addEventListener("click", function () {
          var cells = [].map.call(nb.children, function (c, i) {
            var src = c.querySelector(".x-src").value.split("\n").map(function (l, j, a) { return j < a.length - 1 ? l + "\n" : l; });
            var o = { cell_type: c._t === "md" ? "markdown" : "code", id: "kovan-" + i, metadata: {}, source: src };
            if (c._t !== "md") { o.execution_count = c._n || null; o.outputs = []; }
            return o;
          });
          var doc = { nbformat: 4, nbformat_minor: 5, cells: cells, metadata: {
            kernelspec: { name: "python3", display_name: "Python 3 (Pyodide)", language: "python" }, language_info: { name: "python" } } };
          var url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: "application/x-ipynb+json" }));
          var a = document.createElement("a"); a.href = url; a.download = "kovan.ipynb";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        });

        add("md", "# Kovan Not Defteri\nTarayıcıda çalışan **gerçek Python**. Grafikler için `show()` kullan.\n- Shift+Enter: çalıştır\n- Çift tıkla: metni düzenle");
        add("code", 'print("Merhaba Kovan!")');
        add("code", 'import pandas as pd\n\ndf = pd.DataFrame({\n    "ay": ["Oca", "Şub", "Mar", "Nis", "May", "Haz"],\n    "satis": [120, 135, 150, 142, 170, 188],\n})\nprint(df)\ndf.describe()');
        add("code", 'import matplotlib.pyplot as plt\n\nplt.figure(figsize=(6, 3))\nplt.bar(df["ay"], df["satis"], color="#f5b301")\nplt.title("Aylık satış")\nplt.ylabel("Satış")\nshow()');
        return { boot: function () { return boot().catch(function () {}); } };
      }
