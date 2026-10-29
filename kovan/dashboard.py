"""Canlı pano + tek prompt arayüzü: http://localhost:7777"""
import json, threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from . import db
from .orchestrator import Orchestrator

HTML = r"""<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Kovan</title>
<style>
:root{--bg:#0d0f12;--card:#161a20;--line:#262c35;--txt:#e7e9ee;--mut:#8a93a3;--acc:#f5b301;--ok:#3ecf8e;--bad:#ff5d5d}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto;background:var(--bg);color:var(--txt)}
header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
header b{font-size:20px}header span{color:var(--mut)}
main{max-width:1150px;margin:0 auto;padding:20px;display:grid;gap:16px;grid-template-columns:1fr 1fr}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.full{grid-column:1/-1}h3{margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
textarea{width:100%;min-height:80px;background:#0f1216;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
input{background:#0f1216;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px;width:110px}
button{background:var(--acc);color:#111;border:0;border-radius:10px;padding:10px 18px;font-weight:700;cursor:pointer}
label{color:var(--mut);font-size:13px}
.task{border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px}
.pill{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);margin-left:6px}
.approved,.done{color:var(--ok)}.failed,.error{color:var(--bad)}.in_progress,.running,.planning{color:var(--acc)}
.ev{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;border-bottom:1px dashed var(--line);padding:4px 0;white-space:pre-wrap}
.mut{color:var(--mut)}select{background:#0f1216;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px}
@media(max-width:800px){main{grid-template-columns:1fr}}
</style></head><body>
<header><b>🐝 Kovan</b><span>Tek prompt, çok ajan · Claude Code + Codex</span></header>
<main>
<div class="card full"><h3>Yeni istek</h3>
<textarea id="p" placeholder="Örn: Kafem için menü ve rezervasyon formu olan bir web sitesi yap, testlerini yaz."></textarea>
<div class="row"><label>Klasör <input id="w" value="./kovan-out" style="width:180px"></label>
<label>Bütçe $ <input id="b" type="number" value="5" step="0.5"></label>
<label>Paralel <input id="n" type="number" value="3" min="1" max="8"></label>
<label><input id="m" type="checkbox" style="width:auto"> Deneme (mock)</label>
<button onclick="go()">Ajanları çalıştır</button></div></div>
<div class="card"><h3>Görevler <select id="r" onchange="cur=this.value;load()"></select></h3><div id="t" class="mut">Henüz çalışma yok.</div></div>
<div class="card"><h3>Canlı akış</h3><div id="e" style="max-height:460px;overflow:auto"></div></div>
<div class="card full"><h3>Ortak hafıza</h3><div id="mem" class="mut">Boş.</div></div>
</main>
<script>
let cur="";const esc=s=>(s??"").toString().replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
async function go(){const body={prompt:p.value,workdir:w.value,budget:+b.value,workers:+n.value,mock:m.checked};
if(!body.prompt.trim())return;const r=await fetch("/api/run",{method:"POST",body:JSON.stringify(body)});const j=await r.json();cur=j.run_id;load()}
async function load(){const s=await (await fetch("/api/state"+(cur?"?run="+cur:""))).json();
r.innerHTML=s.runs.map(x=>`<option value="${x.id}" ${s.run&&x.id==s.run.id?"selected":""}>#${x.id} ${esc(x.prompt).slice(0,40)}</option>`).join("");
if(!s.run)return;const R=s.run;
t.innerHTML=`<div class="mut" style="margin-bottom:8px">Durum: <span class="${R.status}">${R.status}</span> · Maliyet $${(+R.cost).toFixed(3)} / $${R.budget}${R.summary?" · "+esc(R.summary):""}</div>`+
s.tasks.map(x=>`<div class="task"><b>#${x.id} ${esc(x.title)}</b><span class="pill">${x.agent}</span><span class="pill ${x.status}">${x.status}</span>
<div class="mut" style="font-size:13px;margin-top:4px">${esc((x.result||x.detail||"")).slice(0,280)}</div>${x.review?`<div style="font-size:12.5px;margin-top:4px">🔍 ${esc(x.reviewer)}: ${esc(x.review).slice(0,160)}</div>`:""}</div>`).join("");
e.innerHTML=s.events.map(v=>`<div class="ev"><span class="mut">${new Date(v.ts*1000).toLocaleTimeString()}</span> <b>${esc(v.agent)}</b> ${esc(v.kind)} · ${esc(v.message)}</div>`).join("");e.scrollTop=e.scrollHeight;
mem.innerHTML=s.memory.length?s.memory.map(x=>`<div class="ev"><b>${esc(x.key)}</b> = ${esc(x.value).slice(0,200)} <span class="mut">(${esc(x.author)})</span></div>`).join(""):"Boş."}
load();setInterval(load,2000);
</script></body></html>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code); self._cors(); self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/":
            return self._send(200, HTML, "text/html")
        if u.path == "/api/state":
            run = parse_qs(u.query).get("run", [None])[0]
            return self._send(200, json.dumps(db.state(int(run) if run else None), default=str, ensure_ascii=False))
        if u.path == "/api/health":
            from . import agents
            return self._send(200, json.dumps({"ok": True, "claude": agents.available("claude"), "codex": agents.available("codex")}))
        if u.path == "/api/files":
            qs = parse_qs(u.query); run = qs.get("run", [None])[0]
            r = db.get_run(int(run)) if run else (db.get_run(db.latest_run_id()) if db.latest_run_id() else None)
            if not r:
                return self._send(200, "[]")
            root = Path(r["workdir"]).resolve(); out = []
            for p in sorted(root.rglob("*")):
                if p.is_file() and not any(x.startswith(".") or x in ("node_modules", "__pycache__") for x in p.relative_to(root).parts) and p.stat().st_size < 300_000:
                    try:
                        out.append({"path": str(p.relative_to(root)), "content": p.read_text(errors="replace")})
                    except Exception:
                        pass
                if len(out) >= 200:
                    break
            return self._send(200, json.dumps(out, ensure_ascii=False))
        self._send(404, "{}")
    def do_POST(self):
        if urlparse(self.path).path != "/api/run":
            return self._send(404, "{}")
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
        orch = Orchestrator(body["prompt"], body.get("workdir", "./kovan-out"), float(body.get("budget", 5)),
                            int(body.get("workers", 3)), bool(body.get("mock")), bool(body.get("yolo")))
        threading.Thread(target=orch.run, daemon=True).start()
        self._send(200, json.dumps({"run_id": orch.run_id}))

def serve(port=7777, host="127.0.0.1"):
    srv = ThreadingHTTPServer((host, port), H)
    print(f"🐝 Kovan panosu: http://{host}:{port}")
    srv.serve_forever()
