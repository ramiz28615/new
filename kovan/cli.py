"""kovan komut satırı.

connect | run | dashboard | status | cancel | resume | report | diff | rollback | config | token | doctor
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__, config, db, gitops, report, security
from .orchestrator import Orchestrator, cancel_run


def _show(agent, kind, msg):
    print(f"[{agent:>6}] {kind:<11} {str(msg)[:160]}", flush=True)


def _run_or_exit(run_id):
    run_id = run_id or db.latest_run_id()
    r = db.get_run(run_id) if run_id else None
    if not r:
        sys.exit(f"Çalışma bulunamadı: #{run_id}" if run_id else "Henüz çalışma yok.")
    return r


def cmd_connect(a):
    env = f"KOVAN_DB={db.db_path()}"
    if shutil.which("claude"):
        subprocess.run(["claude", "mcp", "remove", "kovan", "-s", "user"], capture_output=True)
        r = subprocess.run(["claude", "mcp", "add", "kovan", "-s", "user", "-e", env, "-e", "KOVAN_AGENT=claude",
                            "--", sys.executable, "-m", "kovan.server"], capture_output=True, text=True)
        print("✅ Claude Code bağlandı" if r.returncode == 0 else f"⚠️  Claude Code: {r.stderr.strip()}")
    else:
        print("– Claude Code bulunamadı (npm i -g @anthropic-ai/claude-code)")
    cfg = Path.home() / ".codex" / "config.toml"
    block = (f'\n[mcp_servers.kovan]\ncommand = {json.dumps(sys.executable)}\nargs = ["-m", "kovan.server"]\n'
             f'env = {{ KOVAN_DB = {json.dumps(str(db.db_path()))}, KOVAN_AGENT = "codex" }}\n')
    cfg.parent.mkdir(parents=True, exist_ok=True)
    text = cfg.read_text() if cfg.exists() else ""
    if "[mcp_servers.kovan]" not in text:
        cfg.write_text(text + block)
    print(f"✅ Codex bağlandı ({cfg})"
          + ("" if shutil.which("codex") else "  – codex CLI henüz kurulu değil (npm i -g @openai/codex)"))


def cmd_run(a):
    o = Orchestrator(a.prompt, a.dir, a.budget, a.workers, a.mock, a.yolo, planner=a.planner,
                     review=False if a.no_review else None, on_event=_show, timeout=a.timeout,
                     retries=a.retries, git=False if a.no_git else None)
    print(f"🐝 Çalışma #{o.run_id} başladı · klasör {o.workdir}  (iptal: kovan cancel {o.run_id})", flush=True)
    try:
        o.run()
    except KeyboardInterrupt:
        cancel_run(o.run_id)
        print(f"\n⏹  İptal edildi. Devam etmek için: kovan resume {o.run_id}")
        return 130
    r = db.get_run(o.run_id)
    print(f"\n{r['summary']}  ·  maliyet ${r['cost']:.3f}")
    return 0 if r["status"] == "finished" else 1


def cmd_status(a):
    s = db.state(a.run)
    if not s["run"]:
        print("Henüz çalışma yok.")
        return 0
    r = s["run"]
    print(f"#{r['id']} [{r['status']}] {r['prompt']}\n  maliyet ${r['cost']:.3f}/{r['budget']}  ·  {r['workdir']}")
    for t in s["tasks"]:
        deps = ",".join(f"#{d}" for d in t["depends_on"])
        print(f"  #{t['id']:<3} {t['status']:<11} {t['agent']:<6} ${(t['cost'] or 0):<7.3f} {t['title']}"
              + (f"  ← {deps}" if deps else ""))
    return 0


def cmd_cancel(a):
    r = _run_or_exit(a.run)
    st = cancel_run(r["id"])
    print({"cancelling": f"⏹  #{r['id']} için iptal istendi; ajanlar birkaç saniye içinde durdurulacak.",
           "cancelled": f"⏹  #{r['id']} iptal edildi."}.get(st, f"#{r['id']} zaten bitmiş ({st})."))
    return 0


def cmd_resume(a):
    r = _run_or_exit(a.run)
    try:
        o = Orchestrator.resume(r["id"], on_event=_show, yolo=True if a.yolo else None)
    except RuntimeError as e:
        sys.exit(str(e))
    print(f"▶️  #{r['id']} devam ediyor", flush=True)
    o.run()
    r = db.get_run(r["id"])
    print(f"\n{r['summary']}")
    return 0 if r["status"] == "finished" else 1


def cmd_report(a):
    r = _run_or_exit(a.run)
    if a.stdout:
        print(report.build(r["id"]))
    else:
        print(f"📝 Rapor yazıldı: {report.write(r['id'])}")
    return 0


def _task_or_exit(r, task_id):
    t = db.get_task(task_id)
    if not t or t["run_id"] != r["id"]:
        sys.exit(f"#{task_id} görevi çalışma #{r['id']} içinde yok.")
    if not t.get("commit_sha"):
        sys.exit(f"#{task_id} için kontrol noktası (commit) yok.")
    return t


def cmd_diff(a):
    r = _run_or_exit(a.run)
    t = _task_or_exit(r, a.task)
    print(gitops.show(r["workdir"], t["commit_sha"]))
    return 0


def cmd_rollback(a):
    r = _run_or_exit(a.run)
    t = _task_or_exit(r, a.task)
    try:
        sha = gitops.revert(r["workdir"], t["commit_sha"])
    except gitops.GitError as e:
        sys.exit(f"❌ {e}")
    db.update_task(t["id"], status="rolled_back")
    db.log(r["id"], "kovan", "rollback", f"#{t['id']} geri alındı ({sha[:8]})")
    print(f"↩️  #{t['id']} geri alındı · yeni commit {sha[:8]}")
    return 0


def cmd_config(a):
    cfg = config.load()
    if a.json:
        print(json.dumps({k: v for k, v in cfg.items()}, ensure_ascii=False, indent=2))
    else:
        print(config.show(cfg))
    return 0


def cmd_token(a):
    tok = security.rotate_token() if a.rotate else security.get_token()
    print(tok)
    if a.rotate:
        print("🔑 Yeni token üretildi; açık panoyu yeniden başlat.", file=sys.stderr)
    return 0


def cmd_doctor(a):
    print(f"Kovan {__version__}  ·  Python {sys.version.split()[0]}")
    print(f"DB: {db.db_path()}  ·  Ayar: {config.config_path()}  ·  Günlük: {config.home() / 'kovan.log'}")
    for ag in ("claude", "codex", "git"):
        ok = shutil.which(ag)
        print(f"{ag:<7}: {'✅ ' + ok if ok else '❌ bulunamadı'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    cfg = config.load()
    p = argparse.ArgumentParser(prog="kovan", description="Tek prompt, çok ajan")
    p.add_argument("--version", action="version", version=f"kovan {__version__}")
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("connect", help="Claude Code ve Codex'e MCP olarak bağlan").set_defaults(f=cmd_connect)

    r = sp.add_parser("run", help="Tek prompt ile ajanları çalıştır")
    r.add_argument("prompt")
    r.add_argument("-d", "--dir", default="./kovan-out")
    r.add_argument("-b", "--budget", type=float, default=None, help=f"USD tavanı (varsayılan {cfg['budget']}, 0 = sınırsız)")
    r.add_argument("-w", "--workers", type=int, default=None, help=f"Paralel ajan (varsayılan {cfg['workers']})")
    r.add_argument("--planner", default=None, choices=["claude", "codex"])
    r.add_argument("--timeout", type=float, default=None, help=f"Ajan çağrısı başına sn (varsayılan {cfg['task_timeout']})")
    r.add_argument("--retries", type=int, default=None, help=f"Geçici hatada yeniden deneme (varsayılan {cfg['retries']})")
    r.add_argument("--no-review", action="store_true")
    r.add_argument("--no-git", action="store_true", help="Git kontrol noktalarını kapat")
    r.add_argument("--mock", action="store_true", help="Anahtarsız deneme")
    r.add_argument("--yolo", action="store_true", help="İzin sormadan tam yetki (dikkat)")
    r.set_defaults(f=cmd_run)

    d = sp.add_parser("dashboard", help="Canlı pano ve yerel API")
    d.add_argument("-p", "--port", type=int, default=7777)
    d.add_argument("--host", default="127.0.0.1", help="Bağlanılacak adres (varsayılan yalnızca 127.0.0.1)")
    d.add_argument("--allow-yolo", action="store_true", help="Web API'sinden yolo isteklerine izin ver (tehlikeli)")
    d.set_defaults(f=lambda a: __import__("kovan.dashboard", fromlist=["serve"]).serve(a.port, a.host, a.allow_yolo))

    s = sp.add_parser("status", help="Çalışma durumu")
    s.add_argument("run", nargs="?", type=int)
    s.set_defaults(f=cmd_status)
    c = sp.add_parser("cancel", help="Çalışmayı iptal et")
    c.add_argument("run", type=int)
    c.set_defaults(f=cmd_cancel)
    rs = sp.add_parser("resume", help="Bitmemiş görevleri yeniden çalıştır")
    rs.add_argument("run", type=int)
    rs.add_argument("--yolo", action="store_true")
    rs.set_defaults(f=cmd_resume)
    rp = sp.add_parser("report", help="REPORT.md üret")
    rp.add_argument("run", nargs="?", type=int)
    rp.add_argument("--stdout", action="store_true", help="Dosyaya yazmak yerine ekrana bas")
    rp.set_defaults(f=cmd_report)
    df = sp.add_parser("diff", help="Görevin git değişikliklerini göster")
    df.add_argument("run", type=int)
    df.add_argument("--task", type=int, required=True)
    df.set_defaults(f=cmd_diff)
    rb = sp.add_parser("rollback", help="Görevin commit'ini geri al (git revert)")
    rb.add_argument("run", type=int)
    rb.add_argument("--task", type=int, required=True)
    rb.set_defaults(f=cmd_rollback)
    cf = sp.add_parser("config", help="Etkin yapılandırmayı göster")
    cf.add_argument("--json", action="store_true")
    cf.set_defaults(f=cmd_config)
    tk = sp.add_parser("token", help="API token'ını göster")
    tk.add_argument("--rotate", action="store_true", help="Yeni token üret")
    tk.set_defaults(f=cmd_token)
    sp.add_parser("doctor", help="Kurulumu kontrol et").set_defaults(f=cmd_doctor)
    return p


def main(argv=None):
    config.setup_logging()
    a = build_parser().parse_args(argv)
    code = a.f(a)
    if isinstance(code, int) and code:
        sys.exit(code)


if __name__ == "__main__":
    main()
