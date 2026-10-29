"""kovan komut satırı: connect | run | dashboard | status | doctor"""
import argparse, json, shutil, subprocess, sys
from pathlib import Path
from . import db, agents
from .orchestrator import Orchestrator

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
    block = (f'\n[mcp_servers.kovan]\ncommand = "{sys.executable}"\nargs = ["-m", "kovan.server"]\n'
             f'env = {{ KOVAN_DB = "{db.db_path()}", KOVAN_AGENT = "codex" }}\n')
    cfg.parent.mkdir(parents=True, exist_ok=True)
    text = cfg.read_text() if cfg.exists() else ""
    if "[mcp_servers.kovan]" not in text:
        cfg.write_text(text + block)
    print(f"✅ Codex bağlandı ({cfg})" + ("" if shutil.which("codex") else "  – codex CLI henüz kurulu değil (npm i -g @openai/codex)"))

def cmd_run(a):
    def show(agent, kind, msg):
        print(f"[{agent:>6}] {kind:<11} {msg[:160]}")
    o = Orchestrator(a.prompt, a.dir, a.budget, a.workers, a.mock, a.yolo,
                     planner=a.planner, review=not a.no_review, on_event=show)
    print(f"🐝 Çalışma #{o.run_id} başladı (pano: kovan dashboard)")
    o.run()
    r = db.get_run(o.run_id)
    print(f"\n{r['summary']}  ·  maliyet ${r['cost']:.3f}")

def cmd_status(a):
    s = db.state(a.run)
    if not s["run"]:
        return print("Henüz çalışma yok.")
    r = s["run"]
    print(f"#{r['id']} [{r['status']}] {r['prompt']}\n  maliyet ${r['cost']:.3f}/{r['budget']}")
    for t in s["tasks"]:
        print(f"  #{t['id']:<3} {t['status']:<11} {t['agent']:<6} {t['title']}")

def cmd_doctor(a):
    print(f"Python: {sys.version.split()[0]}  ·  DB: {db.db_path()}")
    for ag in ("claude", "codex"):
        print(f"{ag:<7}: {'✅ ' + shutil.which(ag) if agents.available(ag) else '❌ bulunamadı'}")

def main(argv=None):
    p = argparse.ArgumentParser(prog="kovan", description="Tek prompt, çok ajan")
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("connect", help="Claude Code ve Codex'e MCP olarak bağlan").set_defaults(f=cmd_connect)
    r = sp.add_parser("run", help="Tek prompt ile ajanları çalıştır")
    r.add_argument("prompt"); r.add_argument("-d", "--dir", default="./kovan-out")
    r.add_argument("-b", "--budget", type=float, default=5.0, help="USD tavanı (Claude maliyeti izlenir)")
    r.add_argument("-w", "--workers", type=int, default=3); r.add_argument("--planner", default="claude", choices=["claude", "codex"])
    r.add_argument("--no-review", action="store_true"); r.add_argument("--mock", action="store_true", help="Anahtarsız deneme")
    r.add_argument("--yolo", action="store_true", help="İzin sormadan tam yetki (dikkat)")
    r.set_defaults(f=cmd_run)
    d = sp.add_parser("dashboard", help="Canlı pano ve web'den prompt"); d.add_argument("-p", "--port", type=int, default=7777)
    d.set_defaults(f=lambda a: __import__("kovan.dashboard", fromlist=["serve"]).serve(a.port))
    s = sp.add_parser("status"); s.add_argument("run", nargs="?", type=int); s.set_defaults(f=cmd_status)
    sp.add_parser("doctor", help="Kurulumu kontrol et").set_defaults(f=cmd_doctor)
    a = p.parse_args(argv); a.f(a)

if __name__ == "__main__":
    main()
