"""Canlı pano + yerel HTTP API: http://127.0.0.1:7777

Güvenlik modeli
- Varsayılan olarak yalnızca 127.0.0.1'e bağlanır; Host başlığı loopback olmalıdır (DNS rebinding koruması).
- /api/health dışındaki her /api/* uç noktası `Authorization: Bearer <token>` ister.
  Tarayıcı EventSource başlık gönderemediği için GET isteklerinde `?token=` de kabul edilir.
- CORS yalnızca izin listesindeki kaynaklara açılır (KOVAN_ALLOWED_ORIGINS / config.toml).
- `yolo` web'den ancak pano `--allow-yolo` ile başlatıldıysa kabul edilir.
- Çalışma klasörleri `projects_root` altında olmalıdır; dosya okuma yol kaçışlarına kapalıdır.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import __version__, agents, config, db, gitops, report, security
from .orchestrator import Orchestrator, cancel_run

log = logging.getLogger("kovan.dashboard")

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}
MAX_FILE = 300_000
MAX_FILES = 200
MAX_TOTAL = 5_000_000

HTML = (Path(__file__).with_name("dashboard.html")).read_text(encoding="utf-8") \
    if Path(__file__).with_name("dashboard.html").exists() else "<h1>Kovan</h1>"


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def list_files(root: Path, with_content=True):
    root = root.resolve()
    out, total = [], 0
    if not root.is_dir():
        return out
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            p = Path(dirpath) / name
            try:
                real = p.resolve()
                if root not in real.parents or not real.is_file():
                    continue  # kökün dışına işaret eden sembolik bağlar atlanır
                size = real.stat().st_size
            except OSError:
                continue
            item = {"path": p.relative_to(root).as_posix(), "size": size}
            if with_content:
                if size > MAX_FILE or total + size > MAX_TOTAL:
                    continue
                try:
                    item["content"] = real.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                total += size
            out.append(item)
            if len(out) >= MAX_FILES:
                return out
    return out


class KovanServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, token, cfg, allow_yolo=False):
        super().__init__(addr, Handler)
        self.token = token
        self.cfg = cfg
        self.allow_yolo = allow_yolo
        self.allowed_origins = list(cfg["allowed_origins"])
        self.loopback = addr[0] in ("127.0.0.1", "localhost", "::1")
        self.root = config.projects_root(cfg)
        self.threads: dict[int, threading.Thread] = {}


class Handler(BaseHTTPRequestHandler):
    server: KovanServer
    server_version = f"Kovan/{__version__}"

    def log_message(self, fmt, *args):
        log.debug("http", extra={"data": {"client": self.client_address[0], "line": fmt % args}})

    # ---- yardımcılar
    def _origin(self):
        return self.headers.get("Origin")

    def _cors(self):
        origin = self._origin()
        if origin and security.origin_allowed(origin, self.server.allowed_origins):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def _send(self, code, body, ctype="application/json"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if ctype == "text/html":
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False, default=str))

    def _guard(self):
        """Host ve Origin denetimi. Uygunsuzsa ApiError fırlatır."""
        if self.server.loopback and not security.host_is_loopback(self.headers.get("Host")):
            raise ApiError(421, "Geçersiz Host başlığı")
        origin = self._origin()
        if origin and not security.origin_allowed(origin, self.server.allowed_origins):
            raise ApiError(403, f"Bu kaynağın ({origin}) Kovan motoruna erişim izni yok. "
                                "KOVAN_ALLOWED_ORIGINS ile izin verebilirsin.")

    def _auth(self, qs, allow_query):
        tok = security.bearer(self.headers.get("Authorization"))
        if tok is None and allow_query:
            tok = (qs.get("token") or [None])[0]
        if not security.token_ok(tok, self.server.token):
            raise ApiError(401, "Token eksik ya da hatalı. `kovan dashboard` çıktısındaki token'ı kullan.")

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "Geçersiz Content-Length") from None
        if n > int(self.server.cfg["max_body_bytes"]):
            raise ApiError(413, "İstek gövdesi çok büyük")
        raw = self.rfile.read(n) if n > 0 else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError(400, "Gövde geçerli JSON değil") from None
        if not isinstance(data, dict):
            raise ApiError(400, "Gövde bir JSON nesnesi olmalı")
        return data

    def _run_or_404(self, run_id):
        r = db.get_run(int(run_id)) if run_id else (db.get_run(db.latest_run_id()) if db.latest_run_id() else None)
        if not r:
            raise ApiError(404, "Çalışma bulunamadı")
        return r

    def _dispatch(self, fn):
        try:
            fn()
        except ApiError as e:
            self._json(e.code, {"error": e.message})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # pragma: no cover - beklenmeyen
            log.exception("api error")
            try:
                self._json(500, {"error": f"Sunucu hatası: {e}"})
            except OSError:
                pass

    # ---- HTTP fiilleri
    def do_OPTIONS(self):
        def go():
            self._guard()
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
        self._dispatch(go)

    def do_GET(self):
        self._dispatch(self._get)

    def do_POST(self):
        self._dispatch(self._post)

    # ---- GET
    def _get(self):
        self._guard()
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        path = u.path.rstrip("/") or "/"
        if path in ("/", "/index.html"):
            return self._send(200, HTML, "text/html")
        if path == "/api/health":
            return self._json(200, {"ok": True, "version": __version__, "auth": "bearer",
                                    "claude": agents.available("claude"), "codex": agents.available("codex")})
        if not path.startswith("/api/"):
            raise ApiError(404, "Bulunamadı")
        self._auth(qs, allow_query=True)
        one = lambda k: (qs.get(k) or [None])[0]  # noqa: E731
        if path == "/api/state":
            run = one("run")
            s = db.state(int(run) if run and run.isdigit() else None)
            s["server"] = {"allow_yolo": self.server.allow_yolo, "projects_root": str(self.server.root),
                           "version": __version__}
            return self._json(200, s)
        if path == "/api/events":
            run = self._run_or_404(one("run") if (one("run") or "").isdigit() else None)
            after = one("after") or self.headers.get("Last-Event-ID") or "0"
            return self._sse(run["id"], int(after) if str(after).isdigit() else 0)
        if path == "/api/files":
            run = one("run")
            r = self._run_or_404(run if run and run.isdigit() else None)
            root = Path(r["workdir"])
            rel = one("path")
            if rel:
                try:
                    p = security.safe_join(root, rel)
                except security.PathError as e:
                    raise ApiError(403, str(e)) from None
                if not p.is_file():
                    raise ApiError(404, "Dosya yok")
                if p.stat().st_size > MAX_FILE:
                    raise ApiError(413, "Dosya çok büyük")
                return self._json(200, {"path": rel, "content": p.read_text(encoding="utf-8", errors="replace")})
            return self._json(200, list_files(root, with_content=one("content") != "0"))
        m = re.fullmatch(r"/api/runs/(\d+)/report", path)
        if m:
            r = self._run_or_404(m.group(1))
            if one("format") == "json":
                return self._json(200, {"run_id": r["id"], "markdown": report.build(r["id"])})
            return self._send(200, report.build(r["id"]), "text/markdown")
        m = re.fullmatch(r"/api/runs/(\d+)/tasks/(\d+)/diff", path)
        if m:
            r = self._run_or_404(m.group(1))
            t = db.get_task(int(m.group(2)))
            if not t or t["run_id"] != r["id"]:
                raise ApiError(404, "Görev bulunamadı")
            if not t.get("commit_sha"):
                return self._send(200, "Bu görev için kontrol noktası (commit) yok.", "text/plain")
            try:
                return self._send(200, gitops.show(r["workdir"], t["commit_sha"]), "text/plain")
            except gitops.GitError as e:
                raise ApiError(500, str(e)) from None
        raise ApiError(404, "Bulunamadı")

    def _sse(self, run_id, after):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        w = self.wfile
        w.write(b"retry: 2000\n\n")
        w.flush()
        last, beat = after, time.monotonic()
        try:
            while True:
                evs = db.events_after(run_id, last)
                for e in evs:
                    w.write(f"id: {e['id']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n".encode())
                    last = e["id"]
                run = db.get_run(run_id)
                if not evs and run and run["status"] in db.TERMINAL_RUN:
                    end = {"run_id": run_id, "status": run["status"], "summary": run["summary"]}
                    w.write(f"event: end\ndata: {json.dumps(end, ensure_ascii=False)}\n\n".encode())
                    w.flush()
                    return
                if time.monotonic() - beat > 15:
                    w.write(b": ping\n\n")
                    beat = time.monotonic()
                w.flush()
                time.sleep(0.4)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    # ---- POST
    def _post(self):
        self._guard()
        u = urlparse(self.path)
        path = u.path.rstrip("/")
        if not path.startswith("/api/"):
            raise ApiError(404, "Bulunamadı")
        self._auth(parse_qs(u.query), allow_query=False)
        body = self._body()
        if path == "/api/run":
            return self._start_run(body)
        m = re.fullmatch(r"/api/runs/(\d+)/cancel", path)
        if m:
            r = self._run_or_404(m.group(1))
            return self._json(200, {"run_id": r["id"], "status": cancel_run(r["id"])})
        m = re.fullmatch(r"/api/runs/(\d+)/resume", path)
        if m:
            r = self._run_or_404(m.group(1))
            if db.run_options(r).get("yolo") and not self.server.allow_yolo:
                raise ApiError(403, "Bu çalışma yolo modunda; web'den devam etmek için pano --allow-yolo ile başlatılmalı.")
            try:
                orch = Orchestrator.resume(r["id"])
            except RuntimeError as e:
                raise ApiError(409, str(e)) from None
            self._spawn(orch)
            return self._json(200, {"run_id": r["id"], "status": "running"})
        raise ApiError(404, "Bulunamadı")

    def _spawn(self, orch):
        def target():
            try:
                orch.run()
            except Exception:  # durum zaten 'error' olarak kaydedildi
                log.exception("background run failed")
        t = threading.Thread(target=target, daemon=True, name=f"kovan-run-{orch.run_id}")
        self.server.threads[orch.run_id] = t
        t.start()

    def _start_run(self, body):
        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            raise ApiError(400, "prompt boş olamaz")
        if len(prompt) > 20_000:
            raise ApiError(413, "prompt çok uzun")
        if body.get("yolo") and not self.server.allow_yolo:
            raise ApiError(403, "yolo modu web API'sinde kapalı. Gerekirse panoyu `kovan dashboard --allow-yolo` ile başlat.")
        try:
            workdir = security.resolve_under(self.server.root, body.get("workdir") or "kovan-out")
        except security.PathError as e:
            raise ApiError(403, str(e)) from None
        try:
            budget = float(body.get("budget", self.server.cfg["budget"]))
            workers = int(body.get("workers", self.server.cfg["workers"]))
        except (TypeError, ValueError):
            raise ApiError(400, "budget/workers sayı olmalı") from None
        if not (0 <= budget <= 1000) or not (1 <= workers <= 8):
            raise ApiError(400, "budget 0-1000, workers 1-8 aralığında olmalı")
        planner = body.get("planner") if body.get("planner") in ("claude", "codex") else None
        orch = Orchestrator(prompt, workdir, budget, workers, mock=bool(body.get("mock")),
                            yolo=bool(body.get("yolo")) and self.server.allow_yolo, planner=planner,
                            review=None if body.get("review") is None else bool(body.get("review")),
                            cfg=self.server.cfg)
        self._spawn(orch)
        return self._json(200, {"run_id": orch.run_id, "workdir": str(workdir)})


def make_server(host="127.0.0.1", port=7777, allow_yolo=False, token=None, cfg=None) -> KovanServer:
    cfg = cfg or config.load()
    return KovanServer((host, port), token or security.get_token(), cfg, allow_yolo=allow_yolo)


def serve(port=7777, host="127.0.0.1", allow_yolo=False):
    config.setup_logging()
    srv = make_server(host, port, allow_yolo)
    shown = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    url = f"http://{shown}:{srv.server_address[1]}"
    print(f"🐝 Kovan panosu: {url}")
    print(f"🔑 API token'ı: {srv.token}   (dosya: {security.token_path()})")
    print(f"👉 Hazır bağlantı: {url}/?token={srv.token}")
    print(f"   Kovan Studio → Motor sekmesi: adres {url}, token yukarıdaki.")
    print(f"📁 Web'den başlatılan çalışmaların kökü: {srv.root}", flush=True)
    if not srv.loopback:
        print("⚠️  Pano loopback dışı bir adrese bağlandı; ağdaki herkes token ile erişebilir.", flush=True)
    if allow_yolo:
        print("⚠️  --allow-yolo açık: web'den izinsiz tam yetkili ajan çalıştırılabilir.", flush=True)
    log.info("dashboard start", extra={"data": {"host": host, "port": srv.server_address[1], "yolo": allow_yolo}})
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatılıyor…")
    finally:
        srv.server_close()
